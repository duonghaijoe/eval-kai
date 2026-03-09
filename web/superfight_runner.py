"""Superfight Runner — Concurrent load testing of Kai using provisioned alias users.

Terminology (see CLAUDE.md for full glossary):
  Superfight = load test event
  Fighter    = provisioned test user
  xPower     = concurrent chat windows per fighter
  Bout       = one conversation (fighter x window)
  Round      = one exchange within a bout (user msg → Kai response)

Model: N fighters × M xPower = total concurrent bouts
Example: 5 fighters × 4 xPower = 20 simultaneous bouts

Weight classes define recommended bout counts:
- Flyweight:     1-5 bouts (smoke test)
- Featherweight: 5-15 bouts (light load)
- Middleweight:  15-30 bouts (normal load)
- Heavyweight:   30-60 bouts (stress test)
- Superfight:    60-100+ bouts (full arena)

Run strategy:
- Ramp-up: stagger fighter starts over a configurable window
- Interval: configurable delay between rounds within a bout
- Each bout is an independent conversation with Kai
- Bouts share auth token per fighter (authenticate once, reuse for all windows)

Metrics collected per bout:
- Latency: TTFT, total response time per round
- Quality: response status, errors, tool calls
- Auth: authentication time per fighter

Aggregate metrics across the superfight:
- Throughput: total rounds / duration
- Latency percentiles: p50, p95, max
- Error rate: failed bouts / total
- Benchmark grade (A+ to F) using industry-standard thresholds
- Per-fighter breakdown
"""
import asyncio
import concurrent.futures
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

# Add scripts/ for KaiClient import
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from kai_client import KaiClient
from kai_benchmarks import score_superfight, score_ttfb, score_total, get_grade
import database as db
from env_config import load_env_config

logger = logging.getLogger(__name__)

# Dedicated thread pool for Kai API calls (avoid saturating default asyncio executor)
# Each bout uses 1 thread for blocking httpx calls; size for up to 100 concurrent bouts
_kai_executor = concurrent.futures.ThreadPoolExecutor(max_workers=100, thread_name_prefix="kai-bout")

# Weight class definitions
WEIGHT_CLASSES = {
    "flyweight":     {"label": "Flyweight",     "min": 1,   "max": 5,   "icon": "feather"},
    "featherweight": {"label": "Featherweight", "min": 5,   "max": 15,  "icon": "runner"},
    "middleweight":  {"label": "Middleweight",  "min": 15,  "max": 30,  "icon": "boxing"},
    "heavyweight":   {"label": "Heavyweight",   "min": 30,  "max": 60,  "icon": "muscle"},
    "superfight":    {"label": "Superfight",    "min": 60,  "max": 100, "icon": "fire"},
}

# Default messages for load test conversations
DEFAULT_MESSAGES = [
    "Hello! What can you help me with?",
    "Show me the latest test run results for this project.",
    "What are the most common test failures?",
    "Generate test cases for a login feature with email and password.",
    "Give me insights on the testing health of this project.",
]


def _percentile(data: list, pct: float) -> float:
    """Calculate percentile from sorted data."""
    if not data:
        return 0
    s = sorted(data)
    idx = int(len(s) * pct)
    return s[min(idx, len(s) - 1)]


@dataclass
class SessionResult:
    """Result from a single chat window session."""
    session_key: str  # "{email}#w{window_idx}"
    email: str
    window_idx: int
    status: str = "pending"  # pending, running, completed, error
    turns_completed: int = 0
    turns_total: int = 0
    ttfb_ms: list = field(default_factory=list)
    total_ms: list = field(default_factory=list)
    tool_calls: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    started_at: float = 0.0
    ended_at: float = 0.0
    # Conversation tracking per turn
    messages_sent: list = field(default_factory=list)    # user messages sent
    responses: list = field(default_factory=list)        # response texts
    response_lengths: list = field(default_factory=list) # char counts
    tools_per_turn: list = field(default_factory=list)   # tool call count per turn
    empty_responses: int = 0   # turns with no/empty response
    error_turns: int = 0       # turns that errored

    def quality_score(self) -> dict:
        """Compute lightweight quality metrics (0-1 scale)."""
        if self.turns_total == 0:
            return {"response_rate": 0, "tool_engagement": 0, "completion_rate": 0, "avg_response_length": 0}
        response_rate = 1 - (self.empty_responses / max(self.turns_total, 1))
        tool_engagement = sum(1 for t in self.tools_per_turn if t > 0) / max(len(self.tools_per_turn), 1)
        completion_rate = self.turns_completed / max(self.turns_total, 1)
        avg_len = sum(self.response_lengths) / max(len(self.response_lengths), 1)
        return {
            "response_rate": round(response_rate, 3),
            "tool_engagement": round(tool_engagement, 3),
            "completion_rate": round(completion_rate, 3),
            "avg_response_length": round(avg_len, 0),
        }

    def to_dict(self):
        # Build per-turn detail
        turns = []
        for i in range(max(len(self.messages_sent), len(self.responses))):
            turn = {"turn": i + 1}
            if i < len(self.messages_sent):
                turn["message"] = self.messages_sent[i]
            if i < len(self.responses):
                turn["response"] = self.responses[i]
            if i < len(self.ttfb_ms):
                turn["ttfb_ms"] = round(self.ttfb_ms[i], 1)
            if i < len(self.total_ms):
                turn["total_ms"] = round(self.total_ms[i], 1)
            if i < len(self.tools_per_turn):
                turn["tool_calls"] = self.tools_per_turn[i]
            turns.append(turn)

        return {
            "session_key": self.session_key,
            "email": self.email,
            "window": self.window_idx,
            "status": self.status,
            "turns_completed": self.turns_completed,
            "turns_total": self.turns_total,
            "avg_ttfb_ms": round(sum(self.ttfb_ms) / len(self.ttfb_ms), 1) if self.ttfb_ms else 0,
            "avg_total_ms": round(sum(self.total_ms) / len(self.total_ms), 1) if self.total_ms else 0,
            "duration_s": round(self.ended_at - self.started_at, 1) if self.ended_at and self.started_at else 0,
            "tool_calls": self.tool_calls,
            "errors": self.errors,
            "quality": self.quality_score(),
            "turns": turns,
        }


@dataclass
class FighterState:
    """State for a single user (may have multiple windows)."""
    email: str
    password: str
    windows: int = 1
    auth_ms: float = 0.0
    kai_client: Optional[object] = None  # KaiClient instance (shared across windows)
    sessions: list = field(default_factory=list)  # list of SessionResult

    def to_dict(self):
        completed = sum(1 for s in self.sessions if s.status == "completed")
        errored = sum(1 for s in self.sessions if s.status == "error")
        all_ttfb = [t for s in self.sessions for t in s.ttfb_ms]
        all_total = [t for s in self.sessions for t in s.total_ms]
        return {
            "email": self.email,
            "windows": self.windows,
            "auth_ms": round(self.auth_ms, 1),
            "sessions_completed": completed,
            "sessions_errored": errored,
            "total_turns": sum(s.turns_completed for s in self.sessions),
            "avg_ttfb_ms": round(sum(all_ttfb) / len(all_ttfb), 1) if all_ttfb else 0,
            "avg_total_ms": round(sum(all_total) / len(all_total), 1) if all_total else 0,
        }


@dataclass
class SuperfightState:
    """Full state of a running superfight."""
    id: str
    weight_class: str
    env_key: str
    status: str = "pending"
    num_users: int = 1
    windows_per_user: int = 1
    turns_per_session: int = 3
    ramp_up_s: float = 0.0
    interval_s: float = 0.0
    fight_mode: str = "fixed"
    scenario_category: Optional[str] = None
    messages: list = field(default_factory=list)
    fighters: dict = field(default_factory=dict)  # email -> FighterState
    sessions: dict = field(default_factory=dict)  # session_key -> SessionResult
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    error: Optional[str] = None

    @property
    def total_sessions(self):
        return len(self.sessions)

    @property
    def completed_sessions(self):
        return sum(1 for s in self.sessions.values() if s.status == "completed")

    @property
    def error_sessions(self):
        return sum(1 for s in self.sessions.values() if s.status == "error")

    @property
    def running_sessions(self):
        return sum(1 for s in self.sessions.values() if s.status == "running")

    def summary(self):
        all_ttfb = [t for s in self.sessions.values() for t in s.ttfb_ms]
        all_total = [t for s in self.sessions.values() for t in s.total_ms]
        all_auth = [f.auth_ms for f in self.fighters.values() if f.auth_ms > 0]
        total_turns = sum(s.turns_completed for s in self.sessions.values())
        duration = (self.ended_at or time.time()) - self.started_at if self.started_at else 0

        # Aggregate quality metrics across all sessions
        quality_scores = [s.quality_score() for s in self.sessions.values() if s.turns_completed > 0]
        all_resp_lengths = [l for s in self.sessions.values() for l in s.response_lengths]
        total_empty = sum(s.empty_responses for s in self.sessions.values())
        total_error_turns = sum(s.error_turns for s in self.sessions.values())
        total_attempted = sum(s.turns_total for s in self.sessions.values())
        total_tool_turns = sum(1 for s in self.sessions.values() for t in s.tools_per_turn if t > 0)
        total_turn_count = sum(len(s.tools_per_turn) for s in self.sessions.values())

        return {
            "id": self.id,
            "weight_class": self.weight_class,
            "weight_class_label": WEIGHT_CLASSES.get(self.weight_class, {}).get("label", self.weight_class),
            "env_key": self.env_key,
            "status": self.status,
            "config": {
                "num_users": self.num_users,
                "windows_per_user": self.windows_per_user,
                "turns_per_session": self.turns_per_session,
                "total_sessions": self.num_users * self.windows_per_user,
                "ramp_up_s": self.ramp_up_s,
                "interval_s": self.interval_s,
                "fight_mode": self.fight_mode,
                "scenario_category": self.scenario_category,
            },
            "progress": {
                "total_sessions": self.total_sessions,
                "completed": self.completed_sessions,
                "errors": self.error_sessions,
                "running": self.running_sessions,
                "total_turns": total_turns,
            },
            "latency": {
                "avg_ttfb_ms": round(sum(all_ttfb) / len(all_ttfb), 1) if all_ttfb else 0,
                "avg_total_ms": round(sum(all_total) / len(all_total), 1) if all_total else 0,
                "p50_ttfb_ms": round(_percentile(all_ttfb, 0.5), 1),
                "p95_ttfb_ms": round(_percentile(all_ttfb, 0.95), 1),
                "p50_total_ms": round(_percentile(all_total, 0.5), 1),
                "p95_total_ms": round(_percentile(all_total, 0.95), 1),
                "max_ttfb_ms": round(max(all_ttfb), 1) if all_ttfb else 0,
                "max_total_ms": round(max(all_total), 1) if all_total else 0,
            },
            "quality": {
                "response_rate": round(1 - total_empty / max(total_attempted, 1), 3),
                "tool_engagement": round(total_tool_turns / max(total_turn_count, 1), 3),
                "completion_rate": round(total_turns / max(total_attempted, 1), 3),
                "error_turn_rate": round(total_error_turns / max(total_attempted, 1), 3),
                "avg_response_length": round(sum(all_resp_lengths) / max(len(all_resp_lengths), 1), 0),
                "p50_response_length": round(_percentile(all_resp_lengths, 0.5), 0),
            },
            "throughput": {
                "total_turns": total_turns,
                "turns_per_second": round(total_turns / duration, 2) if duration > 0 else 0,
                "sessions_per_minute": round(self.completed_sessions / (duration / 60), 2) if duration > 60 else 0,
            },
            "auth": {
                "avg_ms": round(sum(all_auth) / len(all_auth), 1) if all_auth else 0,
                "max_ms": round(max(all_auth), 1) if all_auth else 0,
            },
            "error_rate": round(self.error_sessions / max(self.total_sessions, 1), 3),
            "benchmark": self._benchmark_score(all_ttfb, all_total, total_empty, total_attempted, total_tool_turns, total_turn_count),
            "duration_s": round(duration, 1),
            "started_at": datetime.fromtimestamp(self.started_at).isoformat() if self.started_at else None,
            "ended_at": datetime.fromtimestamp(self.ended_at).isoformat() if self.ended_at else None,
            "error": self.error,
            "fighters": [f.to_dict() for f in self.fighters.values()],
            "sessions": [s.to_dict() for s in self.sessions.values()],
        }

    def _benchmark_score(self, all_ttfb, all_total, total_empty, total_attempted, total_tool_turns, total_turn_count):
        """Apply industry benchmark scoring (same as match eval)."""
        if not all_ttfb or not all_total:
            return None
        latency = {
            "avg_ttfb_ms": sum(all_ttfb) / len(all_ttfb),
            "avg_total_ms": sum(all_total) / len(all_total),
            "p95_ttfb_ms": _percentile(all_ttfb, 0.95),
            "p95_total_ms": _percentile(all_total, 0.95),
        }
        quality = {
            "response_rate": 1 - total_empty / max(total_attempted, 1),
            "completion_rate": sum(1 for s in self.sessions.values() if s.status == "completed") / max(len(self.sessions), 1),
            "tool_engagement": total_tool_turns / max(total_turn_count, 1),
        }
        error_rate = self.error_sessions / max(self.total_sessions, 1)
        return score_superfight(latency, quality, error_rate)


# Active superfight states
_superfight_states: dict[str, SuperfightState] = {}


def get_superfight_state(fight_id: str) -> Optional[SuperfightState]:
    return _superfight_states.get(fight_id)


def list_superfight_states() -> list:
    return [s.summary() for s in sorted(
        _superfight_states.values(),
        key=lambda s: s.started_at or 0,
        reverse=True,
    )]


async def _authenticate_user(
    email: str, password: str, env: dict, login_url: str,
) -> Optional[KaiClient]:
    """Authenticate a user and return a KaiClient. Token is reused for all windows."""
    account = env.get("credentials", {}).get("account", "")
    try:
        loop = asyncio.get_running_loop()
        client = await loop.run_in_executor(
            _kai_executor,
            lambda: KaiClient.from_credentials(
                email, password, account,
                base_url=env.get("base_url", ""),
                login_url=login_url,
                platform_url=env.get("platform_url", ""),
                project_id=env.get("project_id", ""),
                project_name=env.get("project_name", ""),
                org_id=env.get("org_id", ""),
                account_id=env.get("account_id", ""),
                account_name=env.get("account_name", ""),
            ),
        )
        return client
    except Exception as e:
        logger.warning(f"Auth failed for {email}: {e}")
        return None


async def _run_session_window(
    kai_client: KaiClient,
    session_result: SessionResult,
    messages: list,
    interval_s: float = 0.0,
):
    """Run a single chat window session using an already-authenticated KaiClient."""
    session_result.status = "running"
    session_result.started_at = time.time()
    session_result.turns_total = len(messages)

    thread_id = None
    conversation_history = []

    try:
        for i, msg in enumerate(messages):
            session_result.messages_sent.append(msg)
            try:
                loop = asyncio.get_running_loop()

                # Wait for Kai to be ready before sending next message
                if thread_id:
                    await loop.run_in_executor(
                        _kai_executor, kai_client.wait_for_ready, thread_id,
                    )

                chat_result = await loop.run_in_executor(
                    _kai_executor,
                    kai_client.chat,
                    msg,
                    thread_id,
                    None,  # tools
                    None,  # page_context
                    conversation_history if thread_id else None,
                )

                thread_id = chat_result.thread_id
                session_result.ttfb_ms.append(chat_result.analytics.ttfb_ms)
                session_result.total_ms.append(chat_result.analytics.total_ms)
                session_result.turns_completed += 1

                # Track tool calls
                turn_tools = [tc.name for tc in chat_result.analytics.tool_calls]
                session_result.tool_calls.extend(turn_tools)
                session_result.tools_per_turn.append(len(turn_tools))

                # Track response quality
                resp_text = chat_result.text or ""
                session_result.responses.append(resp_text[:500])  # cap stored text
                session_result.response_lengths.append(len(resp_text))
                if not resp_text.strip():
                    session_result.empty_responses += 1

                # Update conversation history
                conversation_history.append({
                    "id": str(int(time.time() * 1000)),
                    "role": "user",
                    "content": [{"type": "text", "text": msg}],
                })
                if resp_text:
                    conversation_history.append({
                        "id": str(int(time.time() * 1000) + 1),
                        "role": "assistant",
                        "content": [{"type": "text", "text": resp_text}],
                    })

                if chat_result.analytics.error_message:
                    session_result.errors.append(
                        f"Turn {i+1}: {chat_result.analytics.error_message}"
                    )

                # Inter-turn interval
                if interval_s > 0 and i < len(messages) - 1:
                    await asyncio.sleep(interval_s)

            except Exception as e:
                session_result.errors.append(f"Turn {i+1}: {str(e)[:200]}")
                session_result.error_turns += 1
                session_result.tools_per_turn.append(0)
                session_result.response_lengths.append(0)
                session_result.empty_responses += 1
                logger.warning(f"Session {session_result.session_key} turn {i+1} error: {e}")

        session_result.status = "completed"
    except Exception as e:
        session_result.status = "error"
        session_result.errors.append(str(e)[:300])
    finally:
        session_result.ended_at = time.time()


async def _run_fighter_with_windows(
    fighter: FighterState,
    env: dict,
    login_url: str,
    messages: list,
    interval_s: float,
    ramp_delay: float,
):
    """Authenticate a user once, then launch M window sessions concurrently."""
    # Ramp-up delay
    if ramp_delay > 0:
        await asyncio.sleep(ramp_delay)

    # Authenticate once
    t0 = time.time()
    kai_client = await _authenticate_user(fighter.email, fighter.password, env, login_url)
    fighter.auth_ms = (time.time() - t0) * 1000
    fighter.kai_client = kai_client

    if not kai_client:
        for sr in fighter.sessions:
            sr.status = "error"
            sr.errors.append("Authentication failed")
            sr.ended_at = time.time()
        return

    # Launch all windows concurrently for this user
    # Each window gets its own independent conversation (new thread_id)
    # But shares the same auth token
    tasks = []
    for sr in fighter.sessions:
        # Create a new KaiClient sharing the same token for each window
        # (KaiClient is synchronous internally, so each window needs its own instance)
        window_client = KaiClient(
            token=kai_client.token,
            base_url=kai_client.BASE_URL,
            project_id=kai_client.project_id,
            org_id=kai_client.org_id,
            account_id=kai_client.account_id,
            project_name=kai_client.project_name,
            account_name=kai_client.account_name,
        )
        tasks.append(_run_session_window(window_client, sr, messages, interval_s))

    await asyncio.gather(*tasks)

    # Clean up
    try:
        kai_client.close()
    except Exception:
        pass


async def run_superfight(
    fight_id: str,
    weight_class: str,
    env_key: str,
    num_users: int,
    windows_per_user: int = 1,
    turns_per_session: int = 3,
    ramp_up_s: float = 0.0,
    interval_s: float = 0.0,
    messages: list = None,
    fight_mode: str = "fixed",
    scenario_category: str = None,
    on_progress: Callable = None,
):
    """Run a superfight — N fighters × M xPower concurrent conversations with Kai.

    Args:
        fight_id: Unique fight identifier
        weight_class: Weight class name (for labeling)
        env_key: Environment to test against
        num_users: Number of provisioned fighters to use
        windows_per_user: xPower — concurrent sessions per fighter
        turns_per_session: Rounds per session
        ramp_up_s: Total time to stagger all fighter starts (0 = all at once)
        interval_s: Delay between rounds within a session
        messages: Custom messages (defaults to scenario steps or DEFAULT_MESSAGES)
        fight_mode: Fight style — fixed, fire, explore, hybrid
        scenario_category: Filter scenarios by category (for fixed mode)
        on_progress: Async callback for progress updates
    """
    env_config = load_env_config()
    env = env_config.get("environments", {}).get(env_key)
    if not env:
        raise ValueError(f"Environment '{env_key}' not found")

    login_url = env.get("login_url", "https://to3-devtools.vercel.app/api/login")

    # Get active users
    all_users = db.list_load_test_users(env_key)
    active_users = [u for u in all_users if u.get("status") == "active"]

    if not active_users:
        raise ValueError(f"No active load test users in '{env_key}'. Provision users first.")

    selected_users = active_users[:num_users]
    actual_users = len(selected_users)
    if actual_users < num_users:
        logger.warning(f"Only {actual_users} active users available, requested {num_users}")

    # Build message list
    fight_messages = list(messages or DEFAULT_MESSAGES[:turns_per_session])
    while len(fight_messages) < turns_per_session:
        fight_messages.extend(DEFAULT_MESSAGES)
    fight_messages = fight_messages[:turns_per_session]

    # Create state
    state = SuperfightState(
        id=fight_id,
        weight_class=weight_class,
        env_key=env_key,
        num_users=actual_users,
        windows_per_user=windows_per_user,
        turns_per_session=turns_per_session,
        ramp_up_s=ramp_up_s,
        interval_s=interval_s,
        fight_mode=fight_mode,
        scenario_category=scenario_category,
        messages=fight_messages,
    )

    # Create fighters and sessions
    for u in selected_users:
        fighter = FighterState(
            email=u["email"],
            password=u["password"],
            windows=windows_per_user,
        )
        for w in range(windows_per_user):
            key = f"{u['email']}#w{w}"
            sr = SessionResult(
                session_key=key,
                email=u["email"],
                window_idx=w,
                turns_total=turns_per_session,
            )
            fighter.sessions.append(sr)
            state.sessions[key] = sr
        state.fighters[u["email"]] = fighter

    _superfight_states[fight_id] = state

    # Run
    state.status = "running"
    state.started_at = time.time()

    # Progress reporting
    async def report_progress():
        while state.status == "running":
            await asyncio.sleep(3)
            if on_progress:
                try:
                    await on_progress(fight_id, state.summary())
                except Exception:
                    pass

    progress_task = asyncio.create_task(report_progress())

    try:
        # Calculate per-user ramp-up delay
        ramp_delay_per_user = ramp_up_s / max(actual_users, 1) if ramp_up_s > 0 else 0

        # Launch all fighters concurrently
        # Each fighter authenticates once and opens M windows
        await asyncio.gather(*(
            _run_fighter_with_windows(
                fighter=state.fighters[u["email"]],
                env=env,
                login_url=login_url,
                messages=fight_messages,
                interval_s=interval_s,
                ramp_delay=ramp_delay_per_user * i,
            )
            for i, u in enumerate(selected_users)
        ))

        state.status = "completed"
    except Exception as e:
        state.status = "error"
        state.error = str(e)
        logger.exception(f"Superfight {fight_id} failed: {e}")
    finally:
        state.ended_at = time.time()
        progress_task.cancel()

        # Save to DB
        _save_superfight_to_db(state)

        # Final progress report
        if on_progress:
            try:
                await on_progress(fight_id, state.summary())
            except Exception:
                pass

    return state.summary()


def _save_superfight_to_db(state: SuperfightState):
    """Persist superfight results to database."""
    summary = state.summary()
    db.save_superfight(
        fight_id=state.id,
        weight_class=state.weight_class,
        env_key=state.env_key,
        status=state.status,
        concurrency=state.num_users * state.windows_per_user,
        turns_per_fighter=state.turns_per_session,
        total_fighters=state.total_sessions,
        completed=state.completed_sessions,
        errors=state.error_sessions,
        latency=json.dumps(summary["latency"]),
        auth=json.dumps(summary["auth"]),
        fighters=json.dumps(summary["fighters"]),
        sessions_data=json.dumps(summary["sessions"]),
        duration_s=summary["duration_s"],
        started_at=summary["started_at"],
        ended_at=summary["ended_at"],
        error=state.error,
        config=json.dumps(summary["config"]),
        throughput=json.dumps(summary["throughput"]),
        quality=json.dumps(summary["quality"]),
        error_rate=summary["error_rate"],
    )
