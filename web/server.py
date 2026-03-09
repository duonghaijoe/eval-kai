"""FastAPI server for Kai Test Dashboard."""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime
from typing import Optional

# Load .env from project root
_env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database as db
from session_runner import run_session, get_fixed_scenarios, get_semaphore, MAX_CONCURRENT
from actor_brain import set_eval_model, ActorBrain
from rubric import load_rubric, save_rubric, reset_rubric
from env_config import load_env_config, load_env_config_safe, save_env_config, reset_env_config, get_active_env, init_env_db, delete_env_profile
from load_test_users import UserProvisioner
from superfight_runner import run_superfight, get_superfight_state, list_superfight_states, WEIGHT_CLASSES
from kai_benchmarks import score_superfight

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Kai Test Dashboard", version="1.0.0")

# Max concurrent matches (independent of session semaphore)
MAX_CONCURRENT_MATCHES = int(os.environ.get("MAX_CONCURRENT_MATCHES", "3"))
_match_semaphore = asyncio.Semaphore(MAX_CONCURRENT_MATCHES)

# Max concurrent rounds per match (limits parallelism within a single match)
MAX_ROUNDS_PER_MATCH = int(os.environ.get("MAX_ROUNDS_PER_MATCH", "3"))

# Default ring settings
DEFAULT_MAX_TURNS = 10
DEFAULT_MAX_TIME = 600

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Admin auth (simple token-based) ──────────────────────────────
ADMIN_USER = os.environ.get("ADMIN_USER", "Joe")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "admin@123")
_SECRET = os.environ.get("TOKEN_SECRET", "kai-arena-secret-2026")
_TOKEN_TTL = 86400 * 7  # 7 days


def _sign_token(username: str) -> str:
    exp = int(time.time()) + _TOKEN_TTL
    payload = f"{username}:{exp}"
    sig = hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}:{sig}"


def _verify_token(token: str) -> Optional[str]:
    parts = token.split(":")
    if len(parts) != 3:
        return None
    username, exp_str, sig = parts
    try:
        if int(exp_str) < int(time.time()):
            return None
    except ValueError:
        return None
    expected = hmac.new(_SECRET.encode(), f"{username}:{exp_str}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    return username


def require_admin(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Admin login required")
    token = authorization[7:]
    user = _verify_token(token)
    if not user:
        raise HTTPException(401, "Invalid or expired token")
    return user


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(req: LoginRequest):
    if req.username != ADMIN_USER or req.password != ADMIN_PASS:
        raise HTTPException(401, "Invalid credentials")
    token = _sign_token(req.username)
    return {"token": token, "username": req.username}


@app.get("/api/me")
def get_me(user: str = Depends(require_admin)):
    return {"username": user}


# Initialize DB on startup
@app.on_event("startup")
def startup():
    db.init_db()
    init_env_db()
    logger.info(f"Database initialized at {db.get_db_path()}")
    logger.info(f"Max concurrent sessions: {MAX_CONCURRENT}, matches: {MAX_CONCURRENT_MATCHES}")


# ── WebSocket connections ─────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}  # session_id -> [websockets]
        self.global_subs: list[WebSocket] = []  # subscribers to all events

    async def connect(self, ws: WebSocket, session_id: str = None):
        await ws.accept()
        if session_id:
            self.active.setdefault(session_id, []).append(ws)
        else:
            self.global_subs.append(ws)

    def disconnect(self, ws: WebSocket, session_id: str = None):
        if session_id and session_id in self.active:
            self.active[session_id] = [w for w in self.active[session_id] if w != ws]
        if ws in self.global_subs:
            self.global_subs.remove(ws)

    async def broadcast(self, session_id: str, data: dict):
        message = json.dumps(data)
        # Send to session subscribers
        for ws in self.active.get(session_id, []):
            try:
                await ws.send_text(message)
            except Exception:
                pass
        # Send to global subscribers
        for ws in self.global_subs:
            try:
                await ws.send_text(message)
            except Exception:
                pass


manager = ConnectionManager()


# ── Models ────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    actor_mode: str  # explore, hybrid, fixed, fire
    goal: Optional[str] = None
    scenario_id: Optional[str] = None
    max_turns: int = 10
    max_time_s: float = 600
    eval_model: Optional[str] = None  # override eval model (e.g. claude-opus-4-6)


class CreateMatchRequest(BaseModel):
    category: Optional[str] = None  # filter by category, None = all
    max_time_s: float = 600
    eval_model: Optional[str] = None


class ConfigUpdate(BaseModel):
    max_concurrent: Optional[int] = None
    max_concurrent_matches: Optional[int] = None
    max_rounds_per_match: Optional[int] = None
    eval_model: Optional[str] = None
    default_max_turns: Optional[int] = None
    default_max_time: Optional[int] = None


# ── REST Endpoints ────────────────────────────────────────────────

@app.post("/api/sessions")
async def start_session(req: StartSessionRequest):
    # Check concurrency
    active = db.count_active_sessions()
    if active >= MAX_CONCURRENT:
        raise HTTPException(429, f"Max concurrent sessions ({MAX_CONCURRENT}) reached. {active} running.")

    if req.actor_mode == "fixed" and not req.scenario_id:
        raise HTTPException(400, "scenario_id required for fixed mode")
    if req.actor_mode in ("explore", "hybrid", "fire") and not req.goal:
        raise HTTPException(400, "goal required for explore/hybrid/fire mode")

    # Set eval model if specified
    if req.eval_model:
        set_eval_model(req.eval_model)

    session_id = str(uuid.uuid4())[:8]
    env_config = load_env_config()
    active_env_key = env_config.get("active", "production")
    active_env = env_config.get("environments", {}).get(active_env_key, {})
    env_info = {
        "base_url": active_env.get("base_url", ""),
        "platform_url": active_env.get("platform_url", ""),
        "project_id": active_env.get("project_id", ""),
        "project_name": active_env.get("project_name", ""),
        "org_id": active_env.get("org_id", ""),
        "account_name": active_env.get("account_name", ""),
        "joe_model": req.eval_model or "sonnet",
    }
    db.create_session(
        session_id=session_id,
        actor_mode=req.actor_mode,
        goal=req.goal,
        scenario_id=req.scenario_id,
        max_turns=req.max_turns,
        max_time_s=req.max_time_s,
        env_key=active_env_key,
        env_info=env_info,
    )

    # Start session in background
    async def on_turn(sid, data):
        await manager.broadcast(sid, data)

    async def on_complete(sid, data):
        await manager.broadcast(sid, data)

    async def on_error(sid, error):
        await manager.broadcast(sid, {"type": "error", "session_id": sid, "error": error})

    asyncio.create_task(
        run_session(
            session_id=session_id,
            actor_mode=req.actor_mode,
            goal=req.goal,
            scenario_id=req.scenario_id,
            max_turns=req.max_turns,
            max_time_s=req.max_time_s,
            eval_model=req.eval_model or "sonnet",
            on_turn=on_turn,
            on_complete=on_complete,
            on_error=on_error,
        )
    )

    return {"session_id": session_id, "status": "started"}


# ── Match endpoints ──────────────────────────────────────────────

@app.post("/api/matches")
async def create_match(req: CreateMatchRequest):
    """Create a match — runs all (or filtered) fixed scenarios as a match."""
    active_matches = db.count_active_matches()
    if active_matches >= MAX_CONCURRENT_MATCHES:
        raise HTTPException(
            429,
            f"Max concurrent matches ({MAX_CONCURRENT_MATCHES}) reached. {active_matches} running."
        )

    scenarios = get_fixed_scenarios()
    if req.category:
        scenarios = [s for s in scenarios if s["category"] == req.category]

    if not scenarios:
        raise HTTPException(400, f"No scenarios found for category: {req.category}")

    if req.eval_model:
        set_eval_model(req.eval_model)

    match_id = str(uuid.uuid4())[:8]
    env_config = load_env_config()
    active_env_key = env_config.get("active", "production")
    name = f"{'All' if not req.category else req.category.title()} Scenarios"
    db.create_match(
        match_id=match_id,
        name=name,
        category=req.category,
        scenario_count=len(scenarios),
        max_time_s=req.max_time_s,
        eval_model=req.eval_model or "sonnet",
        env_key=active_env_key,
    )

    # Create sessions for each scenario
    active_env = env_config.get("environments", {}).get(active_env_key, {})
    env_info = {
        "base_url": active_env.get("base_url", ""),
        "platform_url": active_env.get("platform_url", ""),
        "project_id": active_env.get("project_id", ""),
        "project_name": active_env.get("project_name", ""),
        "org_id": active_env.get("org_id", ""),
        "account_name": active_env.get("account_name", ""),
        "joe_model": req.eval_model or "sonnet",
    }
    session_ids = []
    for sc in scenarios:
        sid = str(uuid.uuid4())[:8]
        session_ids.append(sid)
        db.create_session(
            session_id=sid,
            actor_mode="fixed",
            goal=sc["description"],
            scenario_id=sc["id"],
            max_turns=len(sc["steps"]),
            max_time_s=req.max_time_s,
            match_id=match_id,
            env_key=active_env_key,
            env_info=env_info,
        )

    # Run sessions in parallel, bounded by the session semaphore
    async def run_match():
        async with _match_semaphore:
            db.update_match(match_id, status="running", started_at=datetime.now().isoformat())
            await manager.broadcast(match_id, {
                "type": "match_started", "match_id": match_id,
            })

            # Per-match semaphore limits how many rounds run in parallel within this match
            match_sem = asyncio.Semaphore(MAX_ROUNDS_PER_MATCH)

            async def run_one(sid, sc):
                async with match_sem:
                    async def on_turn(s, data):
                        data["match_id"] = match_id
                        await manager.broadcast(s, data)
                        await manager.broadcast(match_id, data)

                    async def on_complete(s, data):
                        data["match_id"] = match_id
                        await manager.broadcast(s, data)
                        await manager.broadcast(match_id, data)

                    async def on_error(s, error):
                        await manager.broadcast(s, {"type": "error", "session_id": s, "error": error})
                        await manager.broadcast(match_id, {"type": "session_error", "session_id": s, "error": error})

                    try:
                        await run_session(
                            session_id=sid,
                            actor_mode="fixed",
                            goal=sc["description"],
                            scenario_id=sc["id"],
                            max_turns=len(sc["steps"]),
                            max_time_s=req.max_time_s,
                            eval_model=req.eval_model or "sonnet",
                            on_turn=on_turn,
                            on_complete=on_complete,
                            on_error=on_error,
                        )
                    except Exception as e:
                        logger.exception(f"Match {match_id} session {sid} failed: {e}")

            # Launch all sessions — per-match semaphore limits parallelism
            await asyncio.gather(*(
                run_one(sid, sc) for sid, sc in zip(session_ids, scenarios)
            ))

            # Match complete — compute match-level evaluation
            await _evaluate_match(match_id)

    asyncio.create_task(run_match())

    return {
        "match_id": match_id,
        "session_ids": session_ids,
        "scenario_count": len(scenarios),
        "status": "started",
    }


async def _evaluate_match(match_id: str):
    """Aggregate session evaluations into a match-level evaluation."""
    sessions = db.get_match_sessions(match_id)
    total = len(sessions)
    completed = sum(1 for s in sessions if s["status"] == "completed")
    errors = sum(1 for s in sessions if s["status"] == "error")

    # Collect evaluations
    evals = []
    for s in sessions:
        ev = db.get_evaluation(s["id"])
        if ev:
            evals.append(ev)

    # Compute pass rate — must complete AND score above threshold
    from rubric import load_rubric as _load_rubric
    _rubric = _load_rubric()
    pass_threshold = _rubric.get("pass_threshold", 3.0)

    passed = 0
    for s in sessions:
        if s["status"] == "completed":
            ev = db.get_evaluation(s["id"])
            score = ev.get("overall_score") if ev else None
            if score is not None and score >= pass_threshold:
                passed += 1

    pass_rate = f"{passed}/{total}"

    # Compute average scores from session evaluations
    overall_score = None
    if evals:
        scores = [e["overall_score"] for e in evals if e.get("overall_score")]
        overall_score = round(sum(scores) / len(scores), 2) if scores else None

    # Use AI brain to generate match-level summary if we have evaluations
    summary = f"{passed}/{total} scenarios passed. {completed} completed, {errors} errors."
    issues = []

    if evals:
        brain = ActorBrain()
        match_data = db.get_match(match_id)
        category = match_data.get("category", "all") if match_data else "all"

        # Collect all session summaries
        session_summaries = []
        for s in sessions:
            ev = db.get_evaluation(s["id"])
            session_summaries.append({
                "scenario": s.get("scenario_id"),
                "status": s["status"],
                "score": ev.get("overall_score") if ev else None,
                "summary": ev.get("summary", "") if ev else "",
                "issues": ev.get("issues", []) if ev else [],
            })

        try:
            from actor_brain import _call_claude_async, EVAL_MODEL
            prompt = f"""You are evaluating a complete test match for Kai (Katalon's AI testing orchestrator).

Category: {category}
Total Scenarios: {total}
Passed: {passed}/{total}
Completed: {completed}, Errors: {errors}

Session Results:
{json.dumps(session_summaries, indent=2)[:6000]}

Provide a match-level evaluation. Return ONLY valid JSON:
{{"summary": "2-3 sentence overall assessment of Kai's performance across all scenarios", "issues": ["issue 1", "issue 2"], "recommendations": ["rec 1"]}}"""

            response = await _call_claude_async(prompt, EVAL_MODEL)
            if response:
                parsed = brain._parse_json(response, {})
                if parsed.get("summary"):
                    summary = parsed["summary"]
                if parsed.get("issues"):
                    issues = parsed["issues"]
        except Exception as e:
            logger.warning(f"Match evaluation AI call failed: {e}")

    db.update_match(
        match_id,
        status="completed",
        ended_at=datetime.now().isoformat(),
        overall_score=overall_score,
        pass_rate=pass_rate,
        summary=summary,
        issues=issues,
    )

    await manager.broadcast(match_id, {
        "type": "match_complete",
        "match_id": match_id,
        "pass_rate": pass_rate,
        "overall_score": overall_score,
        "summary": summary,
    })


@app.get("/api/matches")
def list_matches(limit: int = 50):
    matches = db.list_matches(limit)
    active = db.count_active_matches()
    return {
        "matches": matches,
        "active_count": active,
        "max_concurrent": MAX_CONCURRENT_MATCHES,
    }


@app.get("/api/matches/{match_id}")
def get_match_report(match_id: str):
    """Get comprehensive report for a match."""
    match = db.get_match(match_id)
    if not match:
        raise HTTPException(404, "Match not found")

    sessions = db.get_match_sessions(match_id)
    scenarios_map = {s["id"]: s for s in get_fixed_scenarios()}

    from rubric import load_rubric as _load_rubric
    pass_threshold = _load_rubric().get("pass_threshold", 3.0)

    # Collect all turns and evaluations
    all_turns = []
    evaluations = []
    for s in sessions:
        turns = db.get_turns(s["id"])
        all_turns.extend(turns)
        ev = db.get_evaluation(s["id"])
        if ev:
            evaluations.append({**ev, "session_id": s["id"], "scenario_id": s.get("scenario_id")})

    # Latency stats
    ttfbs = [t["ttfb_ms"] for t in all_turns if t.get("ttfb_ms", 0) > 0]
    totals = [t["total_ms"] for t in all_turns if t.get("total_ms", 0) > 0]

    # Per-scenario results
    scenario_results = []
    for s in sessions:
        turns = [t for t in all_turns if t.get("session_id") == s["id"]]
        ev = next((e for e in evaluations if e["session_id"] == s["id"]), None)
        score = ev.get("overall_score") if ev else None
        passed = (
            s["status"] == "completed"
            and score is not None
            and score >= pass_threshold
        )
        scenario_results.append({
            "session_id": s["id"],
            "scenario_id": s.get("scenario_id"),
            "status": s["status"],
            "passed": passed,
            "turns": s.get("turns_completed", len(turns)),
            "avg_ttfb": round(sum(t.get("ttfb_ms", 0) for t in turns) / max(len(turns), 1), 1),
            "avg_total": round(sum(t.get("total_ms", 0) for t in turns) / max(len(turns), 1), 1),
            "evaluation": ev,
        })

    # Categories
    by_category = {}
    for sr in scenario_results:
        sc = scenarios_map.get(sr["scenario_id"], {})
        cat = sc.get("category", "unknown")
        if cat not in by_category:
            by_category[cat] = {"total": 0, "passed": 0, "failed": 0}
        by_category[cat]["total"] += 1
        if sr["passed"]:
            by_category[cat]["passed"] += 1
        else:
            by_category[cat]["failed"] += 1

    total = len(sessions)
    completed = sum(1 for s in sessions if s["status"] == "completed")
    errors = sum(1 for s in sessions if s["status"] == "error")
    running = sum(1 for s in sessions if s["status"] == "running")

    return {
        "match": match,
        "status": "running" if running > 0 else match.get("status", "completed"),
        "summary": {
            "total": total,
            "completed": completed,
            "errors": errors,
            "running": running,
            "pass_rate": match.get("pass_rate") or f"{sum(1 for s in scenario_results if s['passed'])}/{total}",
        },
        "latency": {
            "avg_ttfb": round(sum(ttfbs) / max(len(ttfbs), 1), 1),
            "avg_total": round(sum(totals) / max(len(totals), 1), 1),
            "min_ttfb": round(min(ttfbs), 1) if ttfbs else 0,
            "max_ttfb": round(max(ttfbs), 1) if ttfbs else 0,
        },
        "pass_threshold": pass_threshold,
        "by_category": by_category,
        "scenarios": scenario_results,
        "sessions": [dict(s) for s in sessions],
    }


@app.delete("/api/matches/{match_id}")
def delete_match_endpoint(match_id: str, user: str = Depends(require_admin)):
    match = db.get_match(match_id)
    if not match:
        raise HTTPException(404, "Match not found")
    if match["status"] == "running":
        raise HTTPException(400, "Cannot delete a running match")
    db.delete_match(match_id)
    return {"deleted": match_id}


@app.post("/api/matches/bulk-delete")
def bulk_delete_matches(request: dict, user: str = Depends(require_admin)):
    ids = request.get("ids", [])
    deleted = []
    for mid in ids:
        match = db.get_match(mid)
        if match and match["status"] != "running":
            db.delete_match(mid)
            deleted.append(mid)
    return {"deleted": deleted}


# Keep old batch endpoint as redirect for compatibility
@app.post("/api/sessions/run-all-fixed")
async def run_all_fixed(req: CreateMatchRequest):
    """Redirects to match creation."""
    return await create_match(req)


@app.get("/api/batch/{batch_id}")
def get_batch_report(batch_id: str):
    """Legacy — try as match first, then fall back to old batch format."""
    try:
        return get_match_report(batch_id)
    except HTTPException:
        # Fall back: search for sessions with [batch:xxx] in goal
        with db.get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM sessions WHERE goal LIKE ? ORDER BY created_at",
                (f"%[batch:{batch_id}]%",)
            ).fetchall()
        if not rows:
            raise HTTPException(404, "Match/Batch not found")
        # Return minimal format
        sessions = [dict(r) for r in rows]
        return {"batch_id": batch_id, "sessions": sessions, "status": "completed"}


@app.get("/api/sessions")
def list_sessions(limit: int = 50, offset: int = 0):
    sessions = db.list_sessions(limit, offset)
    active = db.count_active_sessions()
    return {
        "sessions": sessions,
        "active_count": active,
        "max_concurrent": MAX_CONCURRENT,
    }


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    # Backfill env_info from env config if empty (pre-migration sessions)
    env_info = session.get("env_info") or {}
    if not env_info or not env_info.get("base_url"):
        env_key = session.get("env_key", "production")
        env_config = load_env_config()
        envs = env_config.get("environments", {})
        env = envs.get(env_key, envs.get("production", {}))
        session["env_info"] = {
            "base_url": env.get("base_url", ""),
            "platform_url": env.get("platform_url", ""),
            "project_id": env.get("project_id", ""),
            "project_name": env.get("project_name", ""),
            "org_id": env.get("org_id", ""),
            "account_name": env.get("account_name", ""),
            "joe_model": session.get("eval_model", "sonnet"),
        }
    turns = db.get_turns(session_id)
    evaluation = db.get_evaluation(session_id)
    return {"session": session, "turns": turns, "evaluation": evaluation}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str, user: str = Depends(require_admin)):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] == "running":
        raise HTTPException(400, "Cannot delete a running session")
    with db.get_conn() as conn:
        conn.execute("DELETE FROM turns WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM evaluations WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return {"deleted": session_id}


@app.post("/api/sessions/bulk-delete")
def bulk_delete_sessions(request: dict, user: str = Depends(require_admin)):
    ids = request.get("ids", [])
    deleted = []
    for sid in ids:
        session = db.get_session(sid)
        if session and session["status"] != "running":
            with db.get_conn() as conn:
                conn.execute("DELETE FROM turns WHERE session_id = ?", (sid,))
                conn.execute("DELETE FROM evaluations WHERE session_id = ?", (sid,))
                conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
            deleted.append(sid)
    return {"deleted": deleted}


@app.get("/api/scenarios")
def list_scenarios():
    return {"scenarios": get_fixed_scenarios()}


@app.get("/api/reports")
def get_reports(ring: Optional[str] = None):
    return db.get_report_data(ring=ring)


@app.get("/api/match-trends")
def get_match_trends_endpoint(ring: Optional[str] = None):
    from rubric import load_rubric as _load_rubric
    threshold = _load_rubric().get("pass_threshold", 3.0)
    return db.get_match_trends(ring=ring, pass_threshold=threshold)


@app.post("/api/match-trends/analyze")
async def analyze_match_trends(ring: Optional[str] = None):
    """Ask Joe's bot to deeply analyze Kai quality from match trend data."""
    from rubric import load_rubric as _load_rubric
    from actor_brain import _call_claude_async, EVAL_MODEL

    threshold = _load_rubric().get("pass_threshold", 3.0)
    data = db.get_match_trends(ring=ring, pass_threshold=threshold)
    trends = data.get("trends", [])
    categories = data.get("categories", [])

    if not trends:
        return {"analysis": "No match data available for analysis.", "ring": ring}

    # Build comprehensive data summary for Claude
    summary_lines = []
    summary_lines.append(f"Environment: {(ring or 'all').upper()} Ring")
    summary_lines.append(f"Total matches analyzed: {len(trends)}")
    summary_lines.append(f"Categories tested: {', '.join(categories)}")
    summary_lines.append(f"Pass threshold: {threshold}/5")
    summary_lines.append("")

    for i, t in enumerate(trends):
        summary_lines.append(f"--- Match {i+1}: {t['match_name']} ({t.get('created_at', 'unknown date')}) ---")
        summary_lines.append(f"  Overall Score: {t.get('overall_score', 'N/A')}, Pass Rate: {t.get('pass_rate', 'N/A')}")
        for cat in categories:
            c = t.get("categories", {}).get(cat)
            if c:
                summary_lines.append(
                    f"  [{cat}] Score: {c.get('avg_score', 'N/A')}/5, "
                    f"Pass: {c['passed']}/{c['total']} ({round(c['pass_rate']*100)}%), "
                    f"Goal: {c.get('avg_goal', 'N/A')}, Context: {c.get('avg_context', 'N/A')}, "
                    f"Quality: {c.get('avg_quality', 'N/A')}, "
                    f"TTFT: {round(c.get('avg_ttfb_ms', 0))}ms, Total: {round(c.get('avg_total_ms', 0))}ms"
                )
        summary_lines.append("")

    data_text = "\n".join(summary_lines)

    prompt = f"""You are Joe, a senior QA engineer analyzing Katalon's Kai AI orchestrator agent for release readiness.

You have comprehensive test data from automated match runs against Kai. Analyze this data and provide a release quality assessment.

{data_text}

Provide your analysis in this EXACT JSON format (no markdown, no code blocks):
{{
    "overall_quality": "PASS|FAIL|CAUTION",
    "quality_score": N.N,
    "release_recommendation": "GO|NO-GO|CONDITIONAL",
    "executive_summary": "2-3 sentence high-level assessment for stakeholders",
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"],
    "trend_analysis": "2-3 sentences on whether quality is improving, stable, or declining across matches",
    "category_breakdown": {{
        "category_name": "1 sentence assessment"
    }},
    "latency_assessment": "1-2 sentences on response time performance",
    "recommendations": ["actionable recommendation 1", "actionable recommendation 2"],
    "risk_factors": ["risk 1", "risk 2"],
    "release_notes": "2-3 sentences suitable for a release quality note"
}}"""

    response = await _call_claude_async(prompt, EVAL_MODEL)

    # Parse JSON response
    import json as _json
    try:
        clean = response.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        analysis = _json.loads(clean)
    except (_json.JSONDecodeError, IndexError):
        analysis = {"executive_summary": response, "overall_quality": "UNKNOWN", "release_recommendation": "UNKNOWN"}

    return {"analysis": analysis, "ring": ring, "matches_analyzed": len(trends)}


@app.get("/api/config")
def get_config():
    from actor_brain import EVAL_MODEL, TURN_MODEL
    # Check if claude CLI is available
    import subprocess
    _clean_env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ANTHROPIC_API_KEY")}
    claude_ok = False
    try:
        r = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=5, env=_clean_env)
        claude_ok = r.returncode == 0
    except Exception:
        pass
    env = get_active_env()
    env_config = load_env_config()
    return {
        "max_concurrent": MAX_CONCURRENT,
        "max_concurrent_matches": MAX_CONCURRENT_MATCHES,
        "max_rounds_per_match": MAX_ROUNDS_PER_MATCH,
        "turn_model": TURN_MODEL,
        "eval_model": EVAL_MODEL,
        "default_max_turns": DEFAULT_MAX_TURNS,
        "default_max_time": DEFAULT_MAX_TIME,
        "claude_cli_available": claude_ok,
        "active_env": env_config.get("active", "production"),
        "active_env_name": env.get("name", "Production"),
        "active_project": env.get("project_name", ""),
        "active_base_url": env.get("base_url", ""),
    }


@app.get("/api/health")
async def health_check():
    """Quick health check — tests Kai API on the active environment."""
    import time as _time

    result = {
        "kai_api": {"ok": False, "response": None, "latency_ms": 0},
    }

    # Check Kai API with a quick auth + ping — in thread to avoid blocking
    try:
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
        from kai_client import KaiClient
        t0 = _time.time()
        client = await asyncio.to_thread(KaiClient.from_env)
        latency = (_time.time() - t0) * 1000
        result["kai_api"]["ok"] = True
        result["kai_api"]["response"] = "authenticated"
        result["kai_api"]["latency_ms"] = round(latency, 1)
        client.close()
    except Exception as e:
        result["kai_api"]["response"] = str(e)[:200]

    result["healthy"] = result["kai_api"]["ok"]
    return result


@app.get("/api/rubric")
def get_rubric():
    return load_rubric()


@app.put("/api/rubric")
async def update_rubric(request: dict, user: str = Depends(require_admin)):
    """Update rubric configuration (admin only). Accepts full or partial rubric."""
    current = load_rubric()
    # Merge: if partial, update only provided keys
    if "turn_dimensions" in request:
        current["turn_dimensions"].update(request["turn_dimensions"])
    if "session_dimensions" in request:
        current["session_dimensions"].update(request["session_dimensions"])
    save_rubric(current)
    return current


@app.post("/api/rubric/reset")
def rubric_reset(user: str = Depends(require_admin)):
    return reset_rubric()


# ── Environment Config (admin only for writes) ──────────────────

@app.get("/api/env-config")
def get_env_config_endpoint():
    """Return env config with passwords masked."""
    return load_env_config_safe()


@app.put("/api/env-config")
def update_env_config(request: dict, user: str = Depends(require_admin)):
    """Update environment config (switch active env, edit env settings, credentials)."""
    from session_runner import invalidate_client_cache
    invalidate_client_cache()
    return save_env_config(request)


@app.get("/api/env-config/{env_key}/health")
async def env_health_check(env_key: str):
    """Health check for a specific environment — tests Kai API (say Hi)."""
    import time as _time

    # Use full config (with real credentials, not the safe/masked version)
    config = load_env_config()
    envs = config.get("environments", {})
    if env_key not in envs:
        raise HTTPException(404, f"Environment '{env_key}' not found")

    env = envs[env_key]
    creds = env.get("credentials", {})
    result = {
        "env_key": env_key,
        "env_name": env.get("name", env_key),
        "kai": {"ok": False, "response": None, "latency_ms": 0},
    }

    # 1. Test Kai — authenticate and send "Hi"
    try:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
        from kai_client import KaiClient

        client_kwargs = dict(
            base_url=env.get("base_url"),
            login_url=env.get("login_url"),
            platform_url=env.get("platform_url"),
            project_id=env.get("project_id", ""),
            project_name=env.get("project_name", ""),
            org_id=env.get("org_id", ""),
            account_id=env.get("account_id", ""),
            account_name=env.get("account_name", ""),
        )

        has_creds = creds.get("email") and creds.get("password") and creds.get("account")
        result["kai"]["auth_method"] = "credentials" if has_creds else ".env fallback"
        result["kai"]["login_url"] = env.get("login_url", "")
        result["kai"]["platform_url"] = env.get("platform_url", "")

        # Step 1: Authenticate (get bearer token) — in thread to avoid blocking
        t0 = _time.time()
        try:
            if has_creds:
                kai = await asyncio.to_thread(
                    KaiClient.from_credentials,
                    creds["email"], creds["password"], creds["account"], **client_kwargs
                )
            else:
                kai = await asyncio.to_thread(KaiClient.from_env, **client_kwargs)
            auth_ms = (_time.time() - t0) * 1000
            result["kai"]["auth_ms"] = round(auth_ms, 1)
            result["kai"]["auth_ok"] = True
        except Exception as auth_err:
            auth_ms = (_time.time() - t0) * 1000
            result["kai"]["auth_ms"] = round(auth_ms, 1)
            result["kai"]["auth_ok"] = False
            err_msg = str(auth_err)
            if "500" in err_msg:
                result["kai"]["response"] = f"Login API returned 500 — check credentials (email, password, account) for {env.get('name', env_key)}. POST {env.get('login_url')} with platform_url={env.get('platform_url')}"
            else:
                result["kai"]["response"] = f"Auth failed: {err_msg[:250]}"
            raise

        # Step 2: Send "Hi" to Kai (run in thread to avoid blocking event loop)
        def _kai_chat():
            return kai.chat("Hi")

        chat_result = await asyncio.to_thread(_kai_chat)
        latency = (_time.time() - t0) * 1000
        kai.close()

        result["kai"]["latency_ms"] = round(latency, 1)
        if chat_result.text:
            result["kai"]["ok"] = True
            result["kai"]["response"] = chat_result.text[:300]
            result["kai"]["status"] = chat_result.status
            result["kai"]["ttfb_ms"] = round(chat_result.analytics.ttfb_ms, 1)
            result["kai"]["total_ms"] = round(chat_result.analytics.total_ms, 1)
        else:
            err_detail = chat_result.analytics.error_message or ""
            if "500" in err_detail or "Internal Server Error" in err_detail:
                result["kai"]["response"] = f"Kai agent returned 500 on {env.get('base_url')} — Kai may not be deployed or working on this environment"
            elif "403" in err_detail or "Forbidden" in err_detail:
                result["kai"]["response"] = f"Kai agent returned 403 — check org_id, project_id, account_id headers"
            else:
                result["kai"]["response"] = f"No response (status: {chat_result.status})"
                if err_detail:
                    result["kai"]["response"] += f" — {err_detail}"
    except Exception as e:
        if not result["kai"].get("response"):
            err_str = str(e)
            if "500" in err_str:
                result["kai"]["response"] = f"Kai agent error on {env.get('base_url')} — Kai may not be deployed on this environment"
            else:
                result["kai"]["response"] = err_str[:300]

    result["healthy"] = result["kai"]["ok"]
    return result


@app.get("/api/joe-bot/health")
async def joe_bot_health():
    """Health check for Joe's AI Bot (Claude CLI)."""
    import subprocess
    import time as _time
    from actor_brain import TURN_MODEL

    _clean_env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ANTHROPIC_API_KEY")}
    result = {"ok": False, "response": None, "latency_ms": 0, "needs_auth": False}

    try:
        def _check():
            return subprocess.run(
                ["claude", "-p", "Say hi back in one short sentence.", "--output-format", "text", "--model", TURN_MODEL, "--max-turns", "1"],
                capture_output=True, text=True, timeout=30, env=_clean_env,
            )
        t0 = _time.time()
        r = await asyncio.to_thread(_check)
        latency = (_time.time() - t0) * 1000
        result["latency_ms"] = round(latency, 1)
        if r.returncode == 0 and r.stdout.strip():
            result["ok"] = True
            result["response"] = r.stdout.strip()[:200]
        else:
            stderr = r.stderr.strip() if r.stderr else ""
            result["response"] = stderr[:300] or "empty response"
            if "api key" in stderr.lower() or "auth" in stderr.lower() or "login" in stderr.lower():
                result["needs_auth"] = True
    except FileNotFoundError:
        result["response"] = "Claude CLI not found. Is `claude` installed?"
    except Exception as e:
        result["response"] = str(e)[:200]

    return result


@app.post("/api/joe-bot/auth/start")
async def joe_bot_auth_start():
    """Start Claude CLI OAuth flow. Returns the auth URL for the user to visit."""
    import subprocess
    import re
    _clean_env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ANTHROPIC_API_KEY")}

    try:
        # Run `claude auth login` which outputs the OAuth URL
        proc = await asyncio.create_subprocess_exec(
            "claude", "auth", "login",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.PIPE,
            env=_clean_env,
        )
        # Read output for a few seconds to get the URL
        output = ""
        try:
            stdout_data = await asyncio.wait_for(proc.stdout.read(4096), timeout=10)
            output = stdout_data.decode("utf-8", errors="replace")
        except asyncio.TimeoutError:
            pass

        # Also check stderr
        try:
            stderr_data = await asyncio.wait_for(proc.stderr.read(4096), timeout=2)
            output += stderr_data.decode("utf-8", errors="replace")
        except asyncio.TimeoutError:
            pass

        # Try to find URL in output
        url_match = re.search(r'https?://[^\s]+', output)

        # Kill the process (we just needed the URL)
        try:
            proc.kill()
        except Exception:
            pass

        if url_match:
            return {"url": url_match.group(), "output": output[:500]}
        else:
            return {"url": None, "output": output[:500], "error": "Could not find auth URL in output"}
    except FileNotFoundError:
        raise HTTPException(400, "Claude CLI not found")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/joe-bot/auth/complete")
async def joe_bot_auth_complete(request: dict):
    """Complete Claude CLI OAuth flow with the auth code from the user."""
    code = request.get("code", "").strip()
    if not code:
        raise HTTPException(400, "Auth code is required")

    import subprocess
    _clean_env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ANTHROPIC_API_KEY")}

    try:
        # Pipe the code to `claude auth login`
        proc = await asyncio.create_subprocess_exec(
            "claude", "auth", "login",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.PIPE,
            env=_clean_env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=code.encode()), timeout=30
        )
        output = stdout.decode("utf-8", errors="replace") + stderr.decode("utf-8", errors="replace")

        if proc.returncode == 0 or "success" in output.lower() or "logged in" in output.lower():
            return {"ok": True, "output": output[:500]}
        else:
            return {"ok": False, "output": output[:500]}
    except asyncio.TimeoutError:
        raise HTTPException(500, "Auth process timed out")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/api/env-config/{env_key}")
def delete_env_config(env_key: str, user: str = Depends(require_admin)):
    """Delete a non-active environment profile."""
    delete_env_profile(env_key)
    return load_env_config_safe()


@app.post("/api/env-config/reset")
def reset_env_config_endpoint(user: str = Depends(require_admin)):
    return reset_env_config()


@app.put("/api/config")
def update_config(req: ConfigUpdate, user: str = Depends(require_admin)):
    global MAX_CONCURRENT_MATCHES, _match_semaphore, MAX_ROUNDS_PER_MATCH
    from session_runner import set_max_concurrent
    from actor_brain import set_turn_model
    if req.max_concurrent is not None:
        set_max_concurrent(req.max_concurrent)
    if req.max_concurrent_matches is not None:
        MAX_CONCURRENT_MATCHES = req.max_concurrent_matches
        _match_semaphore = asyncio.Semaphore(MAX_CONCURRENT_MATCHES)
    if req.max_rounds_per_match is not None:
        MAX_ROUNDS_PER_MATCH = req.max_rounds_per_match
    if req.eval_model is not None:
        set_eval_model(req.eval_model)
        set_turn_model(req.eval_model)
    if req.default_max_turns is not None:
        global DEFAULT_MAX_TURNS
        DEFAULT_MAX_TURNS = req.default_max_turns
    if req.default_max_time is not None:
        global DEFAULT_MAX_TIME
        DEFAULT_MAX_TIME = req.default_max_time
    return get_config()


# ── Load Test Users ──────────────────────────────────────────────

class ProvisionRequest(BaseModel):
    count: int = 1
    env_key: Optional[str] = None  # defaults to active env


class TeardownRequest(BaseModel):
    email: Optional[str] = None  # single user
    env_key: Optional[str] = None


# Track active provisioning tasks
_provision_tasks: dict[str, dict] = {}


@app.get("/api/load-test/users")
def list_load_test_users(env_key: Optional[str] = None, include_removed: bool = False):
    """List provisioned load test users (excludes removed by default)."""
    if not env_key:
        env_config = load_env_config()
        env_key = env_config.get("active", "production")
    all_users = db.list_load_test_users(env_key)
    users = all_users if include_removed else [u for u in all_users if u.get("status") != "removed"]

    # Check which users are currently fighting
    fighting_emails = set()
    for state in list_superfight_states():
        if state.get("status") == "running":
            for f in state.get("fighters", []):
                fighting_emails.add(f.get("email"))
    for u in users:
        if u.get("email") in fighting_emails:
            u["fighting"] = True

    summary = {
        "total": len(users),
        "active": sum(1 for u in users if u.get("status") == "active"),
        "pending": sum(1 for u in users if u.get("status") == "pending"),
        "error": sum(1 for u in users if u.get("status") == "error"),
        "fighting": len(fighting_emails & {u.get("email") for u in users}),
    }
    return {"users": users, "summary": summary, "env_key": env_key}


@app.post("/api/load-test/sync")
async def sync_load_test_users(env_key: Optional[str] = None):
    """Sync existing kai alias users from TestOps platform into local DB."""
    env_config = load_env_config()
    ek = env_key or env_config.get("active", "production")
    env = env_config.get("environments", {}).get(ek)
    if not env:
        raise HTTPException(400, f"Environment '{ek}' not found")
    try:
        provisioner = UserProvisioner(env_key=ek)
        result = await provisioner.sync_from_platform()
        await provisioner.close()
        return {"ok": True, **result, "env_key": ek}
    except Exception as e:
        logger.exception(f"Sync failed: {e}")
        raise HTTPException(500, str(e))


@app.post("/api/load-test/provision")
async def provision_load_test_users(req: ProvisionRequest, user: str = Depends(require_admin)):
    """Provision load test alias users (admin only). Runs in background."""
    env_config = load_env_config()
    env_key = req.env_key or env_config.get("active", "production")
    env = env_config.get("environments", {}).get(env_key)
    if not env:
        raise HTTPException(404, f"Environment '{env_key}' not found")

    creds = env.get("credentials", {})
    if not creds.get("email") or not creds.get("password"):
        raise HTTPException(400, f"No credentials configured for environment '{env_key}'")

    primary_email = creds["email"]
    task_id = str(uuid.uuid4())[:8]

    _provision_tasks[task_id] = {
        "id": task_id,
        "type": "provision",
        "status": "running",
        "env_key": env_key,
        "count": req.count,
        "completed": 0,
        "errors": 0,
        "results": [],
    }

    async def run_provision():
        provisioner = UserProvisioner(env_key=env_key)
        try:
            results = await provisioner.provision_batch(primary_email, req.count)
            _provision_tasks[task_id]["results"] = results
            _provision_tasks[task_id]["completed"] = sum(
                1 for r in results if r.get("status") == "active"
            )
            _provision_tasks[task_id]["errors"] = sum(
                1 for r in results if r.get("status") == "error"
            )
            _provision_tasks[task_id]["status"] = "completed"
        except Exception as e:
            _provision_tasks[task_id]["status"] = "error"
            _provision_tasks[task_id]["error"] = str(e)
            logger.exception(f"Provision task {task_id} failed: {e}")
        finally:
            await provisioner.close()

    asyncio.create_task(run_provision())

    return {
        "task_id": task_id,
        "status": "started",
        "count": req.count,
        "env_key": env_key,
    }


@app.get("/api/load-test/provision/{task_id}")
def get_provision_status(task_id: str):
    """Get provisioning task status."""
    task = _provision_tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@app.post("/api/load-test/teardown")
async def teardown_load_test_users(req: TeardownRequest, user: str = Depends(require_admin)):
    """Teardown load test users (admin only). Single user or all."""
    env_config = load_env_config()
    env_key = req.env_key or env_config.get("active", "production")

    task_id = str(uuid.uuid4())[:8]
    _provision_tasks[task_id] = {
        "id": task_id,
        "type": "teardown",
        "status": "running",
        "env_key": env_key,
        "email": req.email,
        "completed": 0,
        "errors": 0,
        "results": [],
    }

    async def run_teardown():
        provisioner = UserProvisioner(env_key=env_key)
        try:
            if req.email:
                result = await provisioner.teardown_user(req.email)
                results = [result]
            else:
                results = await provisioner.teardown_all(env_key)

            _provision_tasks[task_id]["results"] = results
            _provision_tasks[task_id]["completed"] = sum(
                1 for r in results if r.get("status") == "removed"
            )
            _provision_tasks[task_id]["errors"] = sum(
                1 for r in results if r.get("status") == "error"
            )
            _provision_tasks[task_id]["status"] = "completed"
        except Exception as e:
            _provision_tasks[task_id]["status"] = "error"
            _provision_tasks[task_id]["error"] = str(e)
            logger.exception(f"Teardown task {task_id} failed: {e}")
        finally:
            await provisioner.close()

    asyncio.create_task(run_teardown())

    return {"task_id": task_id, "status": "started", "env_key": env_key}


@app.delete("/api/load-test/users/{email:path}")
def delete_load_test_user_record(email: str, env_key: Optional[str] = None,
                                  user: str = Depends(require_admin)):
    """Delete a load test user record from DB (does not teardown from platform)."""
    if not env_key:
        env_config = load_env_config()
        env_key = env_config.get("active", "production")
    db.delete_load_test_user(email, env_key)
    return {"deleted": email, "env_key": env_key}


# ── Superfight (Load Test) ───────────────────────────────────────

class SuperfightRequest(BaseModel):
    weight_class: str = "flyweight"
    num_users: Optional[int] = None  # auto from active users if not set
    windows_per_user: int = 1  # chat windows per user (xPower)
    turns_per_session: int = 3
    ramp_up_s: float = 0.0  # stagger user starts over this window (0 = all at once)
    interval_s: float = 0.0  # delay between turns within a session
    messages: Optional[list] = None
    env_key: Optional[str] = None
    fight_mode: str = "fixed"  # fixed, fire, explore, hybrid
    scenario_category: Optional[str] = None  # filter scenarios by category (for fixed mode)


@app.get("/api/superfight/weight-classes")
def get_weight_classes():
    return {"weight_classes": WEIGHT_CLASSES}


@app.post("/api/superfight/start")
async def start_superfight(req: SuperfightRequest, user: str = Depends(require_admin)):
    """Start a superfight (load test). N users × M windows. Admin only."""
    env_config = load_env_config()
    env_key = req.env_key or env_config.get("active", "production")

    wc = WEIGHT_CLASSES.get(req.weight_class)
    if not wc:
        raise HTTPException(400, f"Unknown weight class: {req.weight_class}. Options: {list(WEIGHT_CLASSES.keys())}")

    # Check active users
    all_users = db.list_load_test_users(env_key)
    active_users = [u for u in all_users if u.get("status") == "active"]
    if not active_users:
        raise HTTPException(400, f"No active load test users in '{env_key}'. Provision users first.")

    num_users = min(req.num_users or len(active_users), len(active_users))
    total_sessions = num_users * req.windows_per_user

    # Build messages based on fight mode
    fight_messages = req.messages
    fight_mode = req.fight_mode or "fixed"
    if fight_mode == "fixed" and not fight_messages:
        # Use predefined scenarios as messages
        scenarios = get_fixed_scenarios()
        if req.scenario_category:
            scenarios = [s for s in scenarios if s["category"] == req.scenario_category]
        if scenarios:
            # Collect all step messages from matching scenarios
            fight_messages = []
            for sc in scenarios:
                for step in sc.get("steps", []):
                    fight_messages.append(step.get("message", ""))
            fight_messages = [m for m in fight_messages if m.strip()]

    fight_id = str(uuid.uuid4())[:8]

    async def on_progress(fid, summary):
        await manager.broadcast(fid, {"type": "superfight_progress", "fight_id": fid, **summary})

    asyncio.create_task(run_superfight(
        fight_id=fight_id,
        weight_class=req.weight_class,
        env_key=env_key,
        num_users=num_users,
        windows_per_user=req.windows_per_user,
        turns_per_session=req.turns_per_session,
        ramp_up_s=req.ramp_up_s,
        interval_s=req.interval_s,
        messages=fight_messages,
        fight_mode=fight_mode,
        scenario_category=req.scenario_category,
        on_progress=on_progress,
    ))

    return {
        "fight_id": fight_id,
        "weight_class": req.weight_class,
        "fight_mode": fight_mode,
        "num_users": num_users,
        "windows_per_user": req.windows_per_user,
        "total_sessions": total_sessions,
        "turns_per_session": req.turns_per_session if fight_mode != "fixed" else len(fight_messages or []),
        "ramp_up_s": req.ramp_up_s,
        "interval_s": req.interval_s,
        "status": "started",
    }


@app.get("/api/superfight/active")
def get_active_superfight():
    """Get currently running superfight (if any)."""
    states = list_superfight_states()
    running = [s for s in states if s.get("status") == "running"]
    if running:
        return running[0]
    return None


@app.get("/api/superfight/{fight_id}")
def get_superfight(fight_id: str):
    """Get superfight status (live state or from DB)."""
    # Check live state first
    state = get_superfight_state(fight_id)
    if state:
        return state.summary()
    # Fall back to DB
    record = db.get_superfight(fight_id)
    if not record:
        raise HTTPException(404, "Superfight not found")
    # Merge sessions_data into sessions field for consistent frontend access
    if record.get("sessions_data") and not record.get("sessions"):
        record["sessions"] = record["sessions_data"]
    _attach_benchmark(record)
    return record


def _attach_benchmark(fight: dict) -> dict:
    """Compute and attach benchmark scoring to a superfight record."""
    latency = fight.get("latency") or {}
    quality = fight.get("quality") or {}
    error_rate = fight.get("error_rate", 0)
    if latency.get("avg_ttfb_ms", 0) > 0:
        fight["benchmark"] = score_superfight(latency, quality, error_rate)
    return fight


@app.get("/api/superfights")
def list_superfights(limit: int = 50, env_key: Optional[str] = None):
    """List superfight history."""
    fights = db.list_superfights(limit, env_key)
    for f in fights:
        _attach_benchmark(f)
    active = [s for s in list_superfight_states() if s.get("status") == "running"]
    return {"fights": fights, "active_count": len(active)}


@app.get("/api/superfights/compare")
def compare_superfights(env_key: Optional[str] = None, limit: int = 10):
    """Compare results across multiple superfight runs for trend analysis."""
    fights = db.list_superfights(limit, env_key)
    if not fights:
        return {"comparison": [], "summary": {}}

    comparison = []
    for f in fights:
        lat = f.get("latency", {})
        thr = f.get("throughput", {})
        cfg = f.get("config", {})
        qual = f.get("quality", {})
        comparison.append({
            "id": f["id"],
            "weight_class": f["weight_class"],
            "status": f["status"],
            "config": cfg,
            "total_sessions": f.get("total_fighters", 0),
            "completed": f.get("completed", 0),
            "errors": f.get("errors", 0),
            "error_rate": f.get("error_rate", 0),
            "avg_ttfb_ms": lat.get("avg_ttfb_ms", 0),
            "p95_ttfb_ms": lat.get("p95_ttfb_ms", 0),
            "avg_total_ms": lat.get("avg_total_ms", 0),
            "p95_total_ms": lat.get("p95_total_ms", 0),
            "turns_per_second": thr.get("turns_per_second", 0) if isinstance(thr, dict) else 0,
            "quality": {
                "response_rate": qual.get("response_rate", 0) if isinstance(qual, dict) else 0,
                "tool_engagement": qual.get("tool_engagement", 0) if isinstance(qual, dict) else 0,
                "completion_rate": qual.get("completion_rate", 0) if isinstance(qual, dict) else 0,
                "avg_response_length": qual.get("avg_response_length", 0) if isinstance(qual, dict) else 0,
            },
            "duration_s": f.get("duration_s", 0),
            "created_at": f.get("created_at"),
        })

    # Aggregate summary across all completed runs
    completed_runs = [c for c in comparison if c["status"] == "completed"]
    summary = {}
    if completed_runs:
        avg_quality = {
            "response_rate": round(sum(c["quality"]["response_rate"] for c in completed_runs) / len(completed_runs), 3),
            "tool_engagement": round(sum(c["quality"]["tool_engagement"] for c in completed_runs) / len(completed_runs), 3),
            "completion_rate": round(sum(c["quality"]["completion_rate"] for c in completed_runs) / len(completed_runs), 3),
        }
        summary = {
            "total_runs": len(completed_runs),
            "avg_error_rate": round(sum(c["error_rate"] for c in completed_runs) / len(completed_runs), 3),
            "avg_ttfb_ms": round(sum(c["avg_ttfb_ms"] for c in completed_runs) / len(completed_runs), 1),
            "avg_p95_ttfb_ms": round(sum(c["p95_ttfb_ms"] for c in completed_runs) / len(completed_runs), 1),
            "avg_total_ms": round(sum(c["avg_total_ms"] for c in completed_runs) / len(completed_runs), 1),
            "avg_throughput": round(sum(c["turns_per_second"] for c in completed_runs) / len(completed_runs), 2),
            "avg_quality": avg_quality,
            "trend": "improving" if len(completed_runs) >= 2 and completed_runs[0]["avg_ttfb_ms"] < completed_runs[-1]["avg_ttfb_ms"] else
                     "degrading" if len(completed_runs) >= 2 and completed_runs[0]["avg_ttfb_ms"] > completed_runs[-1]["avg_ttfb_ms"] * 1.1 else
                     "stable",
        }

    return {"comparison": comparison, "summary": summary}


@app.delete("/api/superfight/{fight_id}")
def delete_superfight_endpoint(fight_id: str, user: str = Depends(require_admin)):
    record = db.get_superfight(fight_id)
    if not record:
        raise HTTPException(404, "Superfight not found")
    if record["status"] == "running":
        raise HTTPException(400, "Cannot delete a running superfight")
    db.delete_superfight(fight_id)
    return {"deleted": fight_id}


# ── WebSocket ─────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_global(ws: WebSocket):
    """Subscribe to all session events."""
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.websocket("/ws/{session_id}")
async def websocket_session(ws: WebSocket, session_id: str):
    """Subscribe to a specific session's events."""
    await manager.connect(ws, session_id)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws, session_id)


# ── Serve React build (production) ───────────────────────────────

frontend_build = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.isdir(frontend_build):
    from fastapi.responses import FileResponse

    # Serve static assets (js, css, etc.)
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_build, "assets")), name="assets")

    # Catch-all: serve index.html for any non-API route (SPA client-side routing)
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        # If a static file exists, serve it
        file_path = os.path.join(frontend_build, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html for client-side routing
        return FileResponse(os.path.join(frontend_build, "index.html"))
