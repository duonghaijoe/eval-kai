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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Kai Test Dashboard", version="1.0.0")

# Max concurrent matches (independent of session semaphore)
MAX_CONCURRENT_MATCHES = int(os.environ.get("MAX_CONCURRENT_MATCHES", "3"))
_match_semaphore = asyncio.Semaphore(MAX_CONCURRENT_MATCHES)

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
    eval_model: Optional[str] = None


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

            async def run_one(sid, sc):
                # Closure captures sid/sc correctly
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

            # Launch all sessions in parallel — session_runner's semaphore
            # limits how many actually run at once
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

    # Compute pass rate (completed with all turns status = input-required)
    passed = 0
    for s in sessions:
        if s["status"] == "completed":
            turns = db.get_turns(s["id"])
            if turns and all(t.get("status") == "input-required" for t in turns if t.get("status")):
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
        passed = s["status"] == "completed" and all(
            t.get("status") == "input-required" for t in turns if t.get("status")
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
def get_match_trends(ring: Optional[str] = None):
    return db.get_match_trends(ring=ring)


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
        "turn_model": TURN_MODEL,
        "eval_model": EVAL_MODEL,
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
def update_config(req: ConfigUpdate):
    from session_runner import set_max_concurrent
    from actor_brain import set_turn_model
    if req.max_concurrent is not None:
        set_max_concurrent(req.max_concurrent)
    if req.eval_model is not None:
        set_eval_model(req.eval_model)
        set_turn_model(req.eval_model)
    return get_config()


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
