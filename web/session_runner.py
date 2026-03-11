"""Session Runner — Executes a test session in a background task, broadcasting turns via callback."""
import asyncio
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime
from typing import Callable, Optional

# Add scripts/ to path for importing kai_client
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from kai_client import KaiClient
from kai_actor import SCENARIOS
from actor_brain import ActorBrain
from rubric import score_latency, load_rubric
from env_config import get_active_env
import database as db

logger = logging.getLogger(__name__)

# Concurrency semaphore — limits simultaneous sessions
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT_SESSIONS", "10"))
_semaphore = asyncio.Semaphore(MAX_CONCURRENT)

# Cached instances to avoid re-init overhead per session
_cached_brain: Optional[ActorBrain] = None
_cached_kai_client = None
_cached_env_key: Optional[str] = None


def get_semaphore():
    return _semaphore


def set_max_concurrent(n: int):
    global _semaphore, MAX_CONCURRENT
    MAX_CONCURRENT = n
    _semaphore = asyncio.Semaphore(n)


def invalidate_client_cache():
    """Clear cached KaiClient when env config changes."""
    global _cached_kai_client, _cached_env_key
    _cached_kai_client = None
    _cached_env_key = None
    logger.info("KaiClient cache invalidated")


def get_fixed_scenarios():
    """Return available fixed scenarios from kai_actor.py + custom DB scenarios, excluding hidden."""
    try:
        hidden_ids = set(db.list_hidden_scenarios())
    except Exception:
        hidden_ids = set()

    builtin = [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "category": s.category,
            "steps": [{"name": st.name, "message": st.message} for st in s.steps],
            "tags": s.tags,
            "source": "builtin",
        }
        for s in SCENARIOS
        if s.id not in hidden_ids
    ]
    # Merge custom scenarios from DB
    try:
        custom = db.list_custom_scenarios()
        for cs in custom:
            if cs["id"] not in hidden_ids:
                builtin.append({
                    "id": cs["id"],
                    "name": cs["name"],
                    "description": cs["description"],
                    "category": cs["category"],
                    "steps": cs["steps"] if isinstance(cs["steps"], list) else [],
                    "tags": cs["tags"] if isinstance(cs["tags"], list) else [],
                    "source": "custom",
                })
    except Exception as e:
        logger.warning(f"Failed to load custom scenarios: {e}")
    return builtin


def strip_brackets(message: str) -> str:
    """Strip [bracketed notes] from a message before sending to Kai."""
    import re
    return re.sub(r'\s*\[.*?\]', '', message).strip()


async def run_session(
    session_id: str,
    actor_mode: str,
    goal: str = None,
    scenario_id: str = None,
    max_turns: int = 10,
    max_time_s: float = 600,
    eval_model: str = "sonnet",
    on_turn: Callable = None,
    on_complete: Callable = None,
    on_error: Callable = None,
):
    """Run a full test session. Called as a background task."""
    async with _semaphore:
        try:
            # Fire mode: spawn full autonomous Claude session
            if actor_mode == "fire":
                from fire_runner import run_fire_session
                await run_fire_session(
                    session_id=session_id,
                    goal=goal or "Smoke test Kai's capabilities",
                    max_turns=max_turns,
                    max_time_s=max_time_s,
                    model=eval_model,
                    on_event=on_turn,
                    on_complete=on_complete,
                    on_error=on_error,
                )
                return

            await _execute_session(
                session_id, actor_mode, goal, scenario_id,
                max_turns, max_time_s, on_turn, on_complete, on_error,
            )
        except Exception as e:
            logger.exception(f"Session {session_id} failed: {e}")
            db.update_session(session_id, status="error", stop_reason=str(e),
                              ended_at=datetime.now().isoformat())
            if on_error:
                await _safe_callback(on_error, session_id, str(e))


async def _execute_session(
    session_id: str,
    actor_mode: str,
    goal: str,
    scenario_id: str,
    max_turns: int,
    max_time_s: float,
    on_turn: Callable,
    on_complete: Callable,
    on_error: Callable,
):
    # Reuse cached Kai client if same environment, otherwise create new
    global _cached_kai_client, _cached_env_key, _cached_brain

    env = get_active_env()
    env_key = env.get("name", "default")
    creds = env.get("credentials", {})
    client_kwargs = dict(
        base_url=env.get("base_url"),
        login_url=env.get("login_url"),
        platform_url=env.get("platform_url"),
        project_id=env.get("project_id", "1782829"),
        project_name=env.get("project_name", "TestOps - RA"),
        org_id=env.get("org_id", "1670719"),
        account_id=env.get("account_id", ""),
        account_name=env.get("account_name", ""),
    )

    if _cached_kai_client and _cached_env_key == env_key:
        kai_client = _cached_kai_client
        logger.info(f"Reusing cached KaiClient for env={env_key}")
    else:
        if creds.get("email") and creds.get("password") and creds.get("account"):
            kai_client = await asyncio.to_thread(
                KaiClient.from_credentials,
                creds["email"], creds["password"], creds["account"],
                **client_kwargs,
            )
        else:
            kai_client = await asyncio.to_thread(
                KaiClient.from_env,
                **client_kwargs,
            )
        _cached_kai_client = kai_client
        _cached_env_key = env_key
        logger.info(f"Created new KaiClient for env={env_key}")

    # Reuse brain singleton (CLI verification only runs once)
    if _cached_brain is None:
        _cached_brain = ActorBrain()
    brain = _cached_brain

    # Get messages plan
    messages = []
    plan = None

    if actor_mode == "fixed":
        # Check hardcoded scenarios first, then custom DB scenarios
        scenario = next((s for s in SCENARIOS if s.id == scenario_id), None)
        if scenario:
            messages = [step.message for step in scenario.steps]
            goal = goal or scenario.description
        else:
            # Check custom scenarios from DB
            custom_scenarios = db.list_custom_scenarios()
            custom = next((cs for cs in custom_scenarios if cs["id"] == scenario_id), None)
            if not custom:
                raise ValueError(f"Scenario {scenario_id} not found")
            steps = custom["steps"] if isinstance(custom["steps"], list) else []
            messages = [s.get("message", "") for s in steps]
            goal = goal or custom["description"]
        # Strip [bracketed notes] from messages before sending
        messages = [strip_brackets(m) for m in messages]
        max_turns = len(messages)
    elif actor_mode == "hybrid":
        plan = await brain.generate_hybrid_plan(goal, max_turns)
        messages = plan

    db.update_session(session_id, status="running",
                      started_at=datetime.now().isoformat())

    conversation_history = []
    thread_id = None
    start_time = time.time()

    for turn_num in range(1, max_turns + 1):
        # Check time limit
        elapsed = time.time() - start_time
        if elapsed >= max_time_s:
            db.update_session(session_id, stop_reason="time_limit_reached")
            break

        # Decide message
        if actor_mode == "fixed":
            if turn_num > len(messages):
                break
            message = messages[turn_num - 1]
        elif actor_mode == "hybrid":
            message = await brain.decide_next_message(
                goal, conversation_history, turn_num, max_turns, "hybrid", plan,
            )
        elif actor_mode == "explore":
            message = await brain.decide_next_message(
                goal, conversation_history, turn_num, max_turns, "explore",
            )
        else:
            raise ValueError(f"Unknown actor mode: {actor_mode}")

        # Save pending turn to DB immediately so UI polling picks it up
        db.insert_turn(
            session_id=session_id,
            turn_number=turn_num,
            user_message=message,
            status="pending",
        )

        # Notify turn start (WebSocket)
        if on_turn:
            await _safe_callback(on_turn, session_id, {
                "type": "turn_start",
                "turn_number": turn_num,
                "user_message": message,
            })

        # Wait for Kai to be fully ready before sending next message
        if thread_id:
            ready_status = await asyncio.to_thread(kai_client.wait_for_ready, thread_id, 120.0)
            if ready_status == "timeout":
                logger.error(f"Session {session_id} turn {turn_num}: Kai still working after 120s, skipping turn")
                db.update_turn_response(
                    session_id=session_id, turn_number=turn_num,
                    assistant_response="", status="error",
                    ttfb_ms=0, total_ms=0, poll_count=0, tool_calls=[],
                    error="Kai was still processing the previous response (timeout waiting for input-required)",
                    eval_latency={"grade": "F", "ttfb_grade": "F", "total_grade": "F"},
                )
                if on_turn:
                    await _safe_callback(on_turn, session_id, {
                        "type": "turn_complete", "turn_number": turn_num,
                        "user_message": message, "assistant_response": "",
                        "status": "error", "ttfb_ms": 0, "total_ms": 0,
                        "poll_count": 0, "tool_calls": [],
                        "error": "Kai still processing previous response",
                        "eval": {}, "eval_latency": {"grade": "F"},
                    })
                continue
            elif ready_status == "error":
                logger.warning(f"Session {session_id} turn {turn_num}: Kai in error state, proceeding with new message")

        # Simulate typing delay between exchanges (skip before first turn)
        if turn_num > 1:
            await asyncio.sleep(2)

        # Build poll callback to stream partial responses via WebSocket
        _poll_loop = asyncio.get_event_loop()

        def _on_poll(partial_text, status):
            if on_turn and partial_text:
                asyncio.run_coroutine_threadsafe(
                    _safe_callback(on_turn, session_id, {
                        "type": "turn_streaming",
                        "turn_number": turn_num,
                        "user_message": message,
                        "partial_response": partial_text,
                    }),
                    _poll_loop,
                )

        # Send to Kai
        chat_result = await asyncio.to_thread(
            kai_client.chat,
            message,
            thread_id,
            None,  # tools
            None,  # page_context
            conversation_history if thread_id else None,
            _on_poll,  # on_poll callback for partial responses
        )

        thread_id = chat_result.thread_id
        db.update_session(session_id, thread_id=thread_id)

        # Verify Kai actually finished responding before proceeding
        if chat_result.status == "working":
            logger.warning(f"Session {session_id} turn {turn_num}: chat() returned but Kai still working (poll timeout). Marking as incomplete.")
            chat_result.analytics.error_message = (chat_result.analytics.error_message or "") + " [Kai response may be incomplete — poll timeout reached]"

        # Update conversation history
        conversation_history.append({
            "id": str(int(time.time() * 1000)),
            "role": "user",
            "content": [{"type": "text", "text": message}],
        })
        if chat_result.text:
            conversation_history.append({
                "id": str(int(time.time() * 1000) + 1),
                "role": "assistant",
                "content": [{"type": "text", "text": chat_result.text}],
            })

        # Auto-score latency from rubric thresholds
        latency_score = score_latency(
            chat_result.analytics.ttfb_ms,
            chat_result.analytics.total_ms,
        )

        # Update the pending turn with Kai's response (without eval scores yet)
        db.update_turn_response(
            session_id=session_id,
            turn_number=turn_num,
            assistant_response=chat_result.text,
            status=chat_result.status,
            ttfb_ms=chat_result.analytics.ttfb_ms,
            total_ms=chat_result.analytics.total_ms,
            poll_count=chat_result.analytics.poll_count,
            tool_calls=[tc.name for tc in chat_result.analytics.tool_calls],
            error=chat_result.analytics.error_message,
            eval_latency=latency_score,
        )

        # Broadcast turn_complete immediately so UI shows the response
        if on_turn:
            await _safe_callback(on_turn, session_id, {
                "type": "turn_complete",
                "turn_number": turn_num,
                "user_message": message,
                "assistant_response": chat_result.text,
                "status": chat_result.status,
                "ttfb_ms": round(chat_result.analytics.ttfb_ms, 1),
                "total_ms": round(chat_result.analytics.total_ms, 1),
                "poll_count": chat_result.analytics.poll_count,
                "tool_calls": [tc.name for tc in chat_result.analytics.tool_calls],
                "error": chat_result.analytics.error_message,
                "eval": {},
                "eval_latency": latency_score,
            })

        # Evaluate turn in background (Claude CLI ~20-30s) — don't block UI
        eval_scores = {}
        if brain and chat_result.text:
            eval_scores = await brain.evaluate_turn(
                message, chat_result.text, goal or "", turn_num,
            )
            # Update turn with eval scores
            db.update_turn_eval(
                session_id=session_id,
                turn_number=turn_num,
                eval_relevance=eval_scores.get("relevance"),
                eval_accuracy=eval_scores.get("accuracy"),
                eval_helpfulness=eval_scores.get("helpfulness"),
                eval_tool_usage=eval_scores.get("tool_usage"),
            )
            # Notify UI that scores are ready
            if on_turn:
                await _safe_callback(on_turn, session_id, {
                    "type": "turn_scored",
                    "turn_number": turn_num,
                    "eval": eval_scores,
                    "eval_latency": latency_score,
                })

            # Auto-log Jira bug if thresholds are met
            try:
                from jira_integration import should_auto_log, log_bug_for_round
                turn_data = db.get_turns(session_id, turn_num)
                if turn_data and should_auto_log(turn_data):
                    jira_result = await asyncio.to_thread(log_bug_for_round, session_id, turn_num)
                    if jira_result.get("ok"):
                        logger.info(f"Auto-logged Jira bug {jira_result.get('ticket_key')} for session {session_id} round {turn_num}")
            except Exception as e:
                logger.debug(f"Jira auto-log skipped: {e}")

        # Rate limit between turns
        await asyncio.sleep(1)

    # Session complete — run overall evaluation

    turns = db.get_turns(session_id)
    session_eval = {}
    if brain and turns:
        session_eval = await brain.evaluate_session(goal or "", turns, actor_mode)

        # Compute overall_score from per-exchange dimensions using rubric weights
        rubric = load_rubric()
        turn_dims = rubric.get("turn_dimensions", {})
        weights = {
            "relevance": turn_dims.get("relevance", {}).get("weight", 1),
            "accuracy": turn_dims.get("accuracy", {}).get("weight", 1),
            "helpfulness": turn_dims.get("helpfulness", {}).get("weight", 1),
            "tool_usage": turn_dims.get("tool_usage", {}).get("weight", 1),
            "latency": turn_dims.get("latency", {}).get("weight", 1),
        }

        # Average each dimension across all turns
        def avg_dim(key):
            vals = [t.get(key, 0) for t in turns if t.get(key)]
            return sum(vals) / len(vals) if vals else 3

        avgs = {
            "relevance": avg_dim("eval_relevance"),
            "accuracy": avg_dim("eval_accuracy"),
            "helpfulness": avg_dim("eval_helpfulness"),
            "tool_usage": avg_dim("eval_tool_usage"),
            "latency": avg_dim("eval_latency"),
        }

        total_weight = sum(weights.values())
        overall = sum(avgs[k] * weights[k] for k in weights) / total_weight
        overall = round(overall, 1)

        db.save_evaluation(
            session_id=session_id,
            goal_achievement=session_eval.get("goal_achievement", 3),
            context_retention=session_eval.get("context_retention", 3),
            error_handling=session_eval.get("error_handling", 3),
            response_quality=session_eval.get("response_quality", 3),
            overall_score=overall,
            summary=session_eval.get("summary", ""),
            issues=session_eval.get("issues", []),
            rubric_weights=weights,
        )

    db.update_session(
        session_id,
        status="completed",
        ended_at=datetime.now().isoformat(),
        stop_reason=db.get_session(session_id).get("stop_reason") or "completed",
    )

    if on_complete:
        await _safe_callback(on_complete, session_id, {
            "type": "session_complete",
            "session_id": session_id,
            "evaluation": session_eval,
            "turns_completed": len(turns),
        })


async def _safe_callback(fn, *args):
    try:
        if asyncio.iscoroutinefunction(fn):
            await fn(*args)
        else:
            fn(*args)
    except Exception as e:
        logger.warning(f"Callback error: {e}")
