"""Fire Runner — Spawns a full Claude Code session that autonomously drives a Kai test.

Claude gets the kai-fire prompt, uses Bash tools to call kai_conversation.py,
drives the conversation, evaluates, and reports. We parse the stream-json output
and forward events to the frontend via callbacks.
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Callable, Optional

import database as db
from env_config import get_active_env, load_env_config

logger = logging.getLogger(__name__)

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
RESULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results")


def _build_fire_prompt(goal: str, max_turns: int, max_time_s: float, session_id: str) -> str:
    """Build the autonomous fire-and-forget prompt for Claude."""
    return f"""You are an autonomous test actor. Run the ENTIRE test session using ONLY the bash commands below. Do NOT read files, explore directories, or run any other commands.

## Objective
{goal}

## Step 1 — Start session
```bash
cd {SCRIPTS_DIR} && python3 kai_conversation.py start --env --max-rounds {max_turns} --max-time {int(max_time_s)}
```
Extract the match_id from the JSON output.

## Step 2 — Send {max_turns} rounds ONE AT A TIME

CRITICAL SEQUENCING RULES:
- You MUST send rounds ONE AT A TIME in separate, sequential bash calls
- You MUST wait for each bash command to FULLY COMPLETE and return its JSON output BEFORE running the next one
- NEVER batch or parallelize round commands — each round takes 30-120 seconds
- After each round completes, read the response JSON, then decide your next message

For each round, run:
```bash
cd {SCRIPTS_DIR} && python3 kai_conversation.py round --match <MATCH_ID> --env --message "<YOUR_MESSAGE>"
```

Message strategy:
- Start with clear, direct questions about the objective
- Get increasingly specific in follow-ups
- Test context retention by referencing earlier responses
- Include at least one edge case or unexpected input
- If a round has `"status": "error"`, wait 10 seconds (`sleep 10`) then try the next round
- If you see 403 errors, the token may have expired — continue to the next round

## Step 3 — End session
```bash
cd {SCRIPTS_DIR} && python3 kai_conversation.py end --match <MATCH_ID> --env --output {RESULTS_DIR}/kai_fire_{session_id}.json
```

## Step 4 — Print report
Print EXACTLY this structure (the backend parses it):
```
===FIRE_REPORT_START===
{{"session_id": "{session_id}", "goal": "{goal}", "turns_completed": N, "turns": [{{"turn_number": 1, "user_message": "...", "assistant_response_preview": "first 300 chars...", "status": "input-required", "ttfb_ms": N, "total_ms": N, "eval": {{"relevance": N, "accuracy": N, "helpfulness": N, "tool_usage": N}}}}], "evaluation": {{"goal_achievement": N, "context_retention": N, "error_handling": N, "response_quality": N, "overall_score": N.N, "summary": "2-3 sentence assessment", "issues": ["issue 1"]}}}}
===FIRE_REPORT_END===
```

## Scoring (1-5 each)
- Relevance: Does the response address the question?
- Accuracy: Is the information correct? No hallucinations?
- Helpfulness: Is it actionable and useful?
- Tool Usage: Did Kai use appropriate tools? (3 if N/A)

## CRITICAL RULES
- ONLY run the 3 commands above (start, round, end). Do NOT run cat, ls, grep, sleep, or any other command.
- SEQUENTIAL ONLY: Send ONE round at a time. Wait for the complete JSON response before sending the next round. Each round command blocks for 30-120 seconds — this is normal.
- Do NOT stop or ask questions. Run everything autonomously.
- Use --env flag always. Auth is pre-configured — do not inspect or modify credentials.
- If auth fails on start, print the error in the report and stop.
- You MUST print ===FIRE_REPORT_START=== / ===FIRE_REPORT_END=== at the very end.
"""


async def run_fire_session(
    session_id: str,
    goal: str,
    max_turns: int = 10,
    max_time_s: float = 600,
    model: str = "sonnet",
    on_event: Callable = None,
    on_complete: Callable = None,
    on_error: Callable = None,
):
    """Spawn a full Claude session that autonomously runs a Kai test."""
    prompt = _build_fire_prompt(goal, max_turns, max_time_s, session_id)

    db.update_session(session_id, status="running", started_at=datetime.now().isoformat())

    if on_event:
        await _safe_callback(on_event, session_id, {
            "type": "fire_started",
            "session_id": session_id,
            "goal": goal,
            "model": model,
        })

    cmd = [
        "claude", "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--model", model,
        "--max-turns", str(max_turns * 3 + 10),  # each round = ~2 turns (tool_use + result), plus start/end/report
    ]

    # Build env vars so kai_conversation.py --env uses the active profile
    env = get_active_env()
    creds = env.get("credentials", {})

    # Pre-resolve bearer token so subprocess doesn't need to login
    # This reuses the cached token from session_runner (same DB, same cache key)
    pre_token = ""
    try:
        import sys as _sys
        _sys.path.insert(0, SCRIPTS_DIR)
        from kai_client import KaiClient
        client_kwargs = {}
        if env.get("base_url"):
            client_kwargs["base_url"] = env["base_url"]
        if env.get("login_url"):
            client_kwargs["login_url"] = env["login_url"]
        if env.get("platform_url"):
            client_kwargs["platform_url"] = env["platform_url"]
        if env.get("project_id"):
            client_kwargs["project_id"] = env["project_id"]
        if env.get("org_id"):
            client_kwargs["org_id"] = env["org_id"]
        if env.get("account_id"):
            client_kwargs["account_id"] = env["account_id"]

        kai = await asyncio.to_thread(
            KaiClient.from_credentials,
            creds.get("email", ""), creds.get("password", ""), creds.get("account", ""),
            **client_kwargs,
        )
        pre_token = kai.token
        kai.close()
        logger.info(f"Fire {session_id}: pre-resolved bearer token ({len(pre_token)} chars)")
    except Exception as e:
        logger.warning(f"Fire {session_id}: failed to pre-resolve token: {e}")

    subprocess_env = dict(os.environ)
    # Allow spawning Claude CLI even when running inside another Claude Code session
    # Strip Claude Code session vars so spawned CLI uses subscription auth
    subprocess_env.pop("CLAUDECODE", None)
    subprocess_env.pop("ANTHROPIC_API_KEY", None)
    subprocess_env.update({
        "TESTOPS_EMAIL": creds.get("email", ""),
        "TESTOPS_PASSWORD": creds.get("password", ""),
        "TESTOPS_ACCOUNT": creds.get("account", ""),
        "KAI_BASE_URL": env.get("base_url", ""),
        "KAI_LOGIN_URL": env.get("login_url", ""),
        "KAI_PLATFORM_URL": env.get("platform_url", ""),
        "KAI_PROJECT_ID": env.get("project_id", ""),
        "KAI_ORG_ID": env.get("org_id", ""),
        "KAI_ACCOUNT_ID": env.get("account_id", ""),
        "KAI_PROJECT_NAME": env.get("project_name", ""),
        "KAI_ACCOUNT_NAME": env.get("account_name", ""),
    })
    # Pass pre-resolved token so subprocess skips login entirely
    if pre_token:
        subprocess_env["KAI_TOKEN"] = pre_token
    logger.info(f"Fire {session_id}: using env profile base_url={env.get('base_url')} project={env.get('project_id')} token_pre_resolved={bool(pre_token)}")

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=subprocess_env,
        )

        full_output = []
        current_text = ""

        async for line in process.stdout:
            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str:
                continue

            full_output.append(line_str)

            # Parse stream-json events
            try:
                event = json.loads(line_str)
            except json.JSONDecodeError:
                logger.debug(f"Fire {session_id}: non-JSON line: {line_str[:200]}")
                continue

            event_type = event.get("type", "")
            if event_type not in ("rate_limit_event",):
                msg = event.get("message", {})
                if isinstance(msg, dict):
                    msg_type = msg.get("type", "?")
                    # Log content structure for assistant messages
                    content = msg.get("content", [])
                    content_types = [c.get("type", "?") if isinstance(c, dict) else type(c).__name__ for c in content] if isinstance(content, list) else [type(content).__name__]
                    logger.info(f"Fire {session_id}: event={event_type} msg_type={msg_type} content_types={content_types[:3]}")
                else:
                    logger.info(f"Fire {session_id}: event={event_type}")

            # Forward meaningful events to frontend
            # Verbose stream-json format: event.message.content[] has typed items
            if event_type == "assistant" and "message" in event:
                msg = event.get("message", {})
                content_items = msg.get("content", []) if isinstance(msg, dict) else []
                if isinstance(content_items, list):
                    for item in content_items:
                        if not isinstance(item, dict):
                            continue
                        item_type = item.get("type", "")
                        if item_type == "text":
                            text_chunk = item.get("text", "")
                            if text_chunk:
                                current_text += text_chunk
                                if on_event:
                                    await _safe_callback(on_event, session_id, {
                                        "type": "fire_text",
                                        "content": text_chunk,
                                    })
                        elif item_type == "tool_use":
                            if on_event:
                                await _safe_callback(on_event, session_id, {
                                    "type": "fire_tool_call",
                                    "tool": item.get("name", ""),
                                    "input_preview": str(item.get("input", {}))[:500],
                                })
                elif isinstance(content_items, str) and content_items:
                    # Old format fallback
                    current_text += content_items
                    if on_event:
                        await _safe_callback(on_event, session_id, {
                            "type": "fire_text",
                            "content": content_items,
                        })

            elif event_type == "user" and "message" in event:
                msg = event.get("message", {})
                content_items = msg.get("content", []) if isinstance(msg, dict) else []
                if isinstance(content_items, list):
                    for item in content_items:
                        if not isinstance(item, dict):
                            continue
                        item_type = item.get("type", "")
                        if item_type == "tool_result":
                            content = item.get("content", "")
                            if on_event:
                                await _safe_callback(on_event, session_id, {
                                    "type": "fire_tool_result",
                                    "content_preview": str(content)[:1000],
                                })

            elif event_type == "result":
                result_text = event.get("result", "")
                if on_event:
                    await _safe_callback(on_event, session_id, {
                        "type": "fire_result",
                        "content": result_text[:2000],
                    })

        # Wait for process to finish
        await process.wait()

        stderr_output = ""
        if process.stderr:
            stderr_bytes = await process.stderr.read()
            stderr_output = stderr_bytes.decode("utf-8", errors="replace")

        if process.returncode != 0:
            logger.warning(f"Fire session {session_id} exited with rc={process.returncode}: {stderr_output[:500]}")

        # Parse the final report from Claude's output
        all_text = "\n".join(full_output)
        report = _extract_fire_report(all_text)

        if report:
            # Save turns and evaluation to DB
            _save_fire_report_to_db(session_id, report)

        db.update_session(
            session_id,
            status="completed",
            ended_at=datetime.now().isoformat(),
            stop_reason="fire_completed",
        )

        if on_complete:
            await _safe_callback(on_complete, session_id, {
                "type": "session_complete",
                "session_id": session_id,
                "evaluation": report.get("evaluation", {}) if report else {},
                "turns_completed": report.get("turns_completed", 0) if report else 0,
            })

    except Exception as e:
        logger.exception(f"Fire session {session_id} error: {e}")
        db.update_session(session_id, status="error", stop_reason=str(e),
                          ended_at=datetime.now().isoformat())
        if on_error:
            await _safe_callback(on_error, session_id, str(e))


def _extract_fire_report(output: str) -> Optional[dict]:
    """Extract the structured JSON report from Claude's output."""
    # Look through all stream-json lines for the result or final assistant text
    all_text_parts = []
    for line in output.split("\n"):
        try:
            event = json.loads(line)
            if event.get("type") == "result":
                result_text = event.get("result", "")
                report = _parse_report_text(result_text)
                if report:
                    return report
            # Also collect text from assistant messages (verbose format)
            if event.get("type") == "assistant":
                msg = event.get("message", {})
                for item in (msg.get("content", []) if isinstance(msg, dict) else []):
                    if isinstance(item, dict) and item.get("type") == "text":
                        all_text_parts.append(item.get("text", ""))
        except json.JSONDecodeError:
            continue

    # Fallback: try to find markers in collected text or raw output
    if all_text_parts:
        report = _parse_report_text("\n".join(all_text_parts))
        if report:
            return report
    return _parse_report_text(output)


def _parse_report_text(text: str) -> Optional[dict]:
    """Parse the report JSON from text that may contain markers."""
    # Try ===FIRE_REPORT_START=== markers
    match = re.search(r'===FIRE_REPORT_START===\s*(.*?)\s*===FIRE_REPORT_END===', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            logger.warning("Found report markers but failed to parse JSON")

    # Try to find any large JSON block that looks like a report
    for match in re.finditer(r'\{[^{}]*"evaluation"[^{}]*\{.*?\}.*?\}', text, re.DOTALL):
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            continue

    return None


def _save_fire_report_to_db(session_id: str, report: dict):
    """Save the fire report turns and evaluation to the database."""
    turns = report.get("turns", [])
    for t in turns:
        eval_data = t.get("eval", {})
        db.insert_turn(
            session_id=session_id,
            turn_number=t.get("turn_number", 0),
            user_message=t.get("user_message", ""),
            assistant_response=t.get("assistant_response_preview", ""),
            status=t.get("status", ""),
            ttfb_ms=t.get("ttfb_ms", 0),
            total_ms=t.get("total_ms", 0),
            poll_count=t.get("poll_count", 0),
            tool_calls=t.get("tool_calls", []),
            error=t.get("error"),
            eval_relevance=eval_data.get("relevance"),
            eval_accuracy=eval_data.get("accuracy"),
            eval_helpfulness=eval_data.get("helpfulness"),
            eval_tool_usage=eval_data.get("tool_usage"),
        )

    evaluation = report.get("evaluation", {})
    if evaluation:
        db.save_evaluation(
            session_id=session_id,
            goal_achievement=evaluation.get("goal_achievement", 3),
            context_retention=evaluation.get("context_retention", 3),
            error_handling=evaluation.get("error_handling", 3),
            response_quality=evaluation.get("response_quality", 3),
            overall_score=evaluation.get("overall_score", 3.0),
            summary=evaluation.get("summary", ""),
            issues=evaluation.get("issues", []),
        )


async def _safe_callback(fn, *args):
    try:
        if asyncio.iscoroutinefunction(fn):
            await fn(*args)
        else:
            fn(*args)
    except Exception as e:
        logger.warning(f"Callback error: {e}")
