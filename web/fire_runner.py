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

logger = logging.getLogger(__name__)

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
RESULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results")


def _build_fire_prompt(goal: str, max_turns: int, max_time_s: float, session_id: str) -> str:
    """Build the autonomous fire-and-forget prompt for Claude."""
    return f"""You are an autonomous test actor for Katalon's Kai orchestrator agent. Run the ENTIRE test session without stopping.

## Objective
{goal}

## Instructions

1. Start a conversation session:
```bash
cd {SCRIPTS_DIR} && python3 kai_conversation.py start --env --max-turns {max_turns} --max-time {int(max_time_s)}
```
Extract the session_id from the JSON output.

2. For each turn, send a message to Kai:
```bash
cd {SCRIPTS_DIR} && python3 kai_conversation.py turn --session <SESSION_ID> --env -m "<YOUR_MESSAGE>"
```

3. After each turn, read Kai's response and decide the next message:
   - Start with clear, direct questions about the objective
   - Get increasingly specific in follow-ups
   - Test context retention by referencing earlier responses
   - Include at least one edge case
   - If Kai errors, note it and try recovery

4. After all turns, end the session:
```bash
cd {SCRIPTS_DIR} && python3 kai_conversation.py end --session <SESSION_ID> --env --output {RESULTS_DIR}/kai_fire_{session_id}.json
```

5. Print a structured report in EXACTLY this format (the backend parses it):

```
===FIRE_REPORT_START===
{{
  "session_id": "<session_id>",
  "goal": "{goal}",
  "turns_completed": N,
  "turns": [
    {{
      "turn_number": 1,
      "user_message": "...",
      "assistant_response_preview": "first 300 chars...",
      "status": "input-required",
      "ttfb_ms": N,
      "total_ms": N,
      "eval": {{"relevance": N, "accuracy": N, "helpfulness": N, "tool_usage": N}}
    }}
  ],
  "evaluation": {{
    "goal_achievement": N,
    "context_retention": N,
    "error_handling": N,
    "response_quality": N,
    "overall_score": N.N,
    "summary": "2-3 sentence assessment",
    "issues": ["issue 1", "issue 2"]
  }}
}}
===FIRE_REPORT_END===
```

## Scoring Rubric (use these when evaluating)
- Relevance 1-5: Does the response address the question?
- Accuracy 1-5: Is the information correct? No hallucinations?
- Helpfulness 1-5: Is it actionable and useful?
- Tool Usage 1-5: Did Kai use appropriate tools? (3 if N/A)

## Rules
- Do NOT stop or ask questions. Run everything autonomously.
- Use --env flag always.
- If a turn errors, note it and continue to the next.
- If auth fails on start, print the error and stop.
- Print the ===FIRE_REPORT_START=== / ===FIRE_REPORT_END=== block at the very end.
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
        "--max-turns", str(max_turns + 5),  # extra headroom for tool calls
    ]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
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
                logger.info(f"Fire {session_id}: event type={event_type} msg_type={event.get('message',{}).get('type','?') if isinstance(event.get('message'), dict) else '?'} keys={list(event.keys())[:6]}")

            # Forward meaningful events to frontend
            # Handle both old and new (--verbose) stream-json formats
            if event_type == "assistant" and "message" in event:
                msg = event["message"]
                msg_type = msg.get("type", "") if isinstance(msg, dict) else ""
                if msg_type == "text":
                    text_chunk = msg.get("content", "")
                    if text_chunk:
                        current_text += text_chunk
                        if on_event:
                            await _safe_callback(on_event, session_id, {
                                "type": "fire_text",
                                "content": text_chunk,
                            })
                elif msg_type == "tool_use":
                    tool_name = msg.get("name", "")
                    tool_input = msg.get("input", {})
                    if on_event:
                        await _safe_callback(on_event, session_id, {
                            "type": "fire_tool_call",
                            "tool": tool_name,
                            "input_preview": str(tool_input)[:500],
                        })
                elif msg_type == "tool_result":
                    content = msg.get("content", "")
                    if on_event:
                        await _safe_callback(on_event, session_id, {
                            "type": "fire_tool_result",
                            "content_preview": str(content)[:1000],
                        })

            elif event_type == "tool_use":
                tool_name = event.get("name", "")
                tool_input = event.get("input", {})
                if on_event:
                    await _safe_callback(on_event, session_id, {
                        "type": "fire_tool_call",
                        "tool": tool_name,
                        "input_preview": str(tool_input)[:500],
                    })

            elif event_type == "tool_result":
                content = event.get("content", "")
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
    # Try to find the report block markers
    # Look through all stream-json lines for the result content
    for line in output.split("\n"):
        try:
            event = json.loads(line)
            if event.get("type") == "result":
                result_text = event.get("result", "")
                return _parse_report_text(result_text)
        except json.JSONDecodeError:
            continue

    # Fallback: try to find markers in raw output
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
