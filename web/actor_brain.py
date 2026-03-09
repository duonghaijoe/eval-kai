"""Actor Brain — Uses Claude Code CLI subprocess to decide conversation turns and evaluate responses.

No API key needed — uses the authenticated Claude Code CLI (subscription-based).
Calls `claude -p "prompt" --output-format json` for each decision.
"""
import json
import logging
import os
import asyncio
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# Model to use for Claude CLI calls
TURN_MODEL = "sonnet"
EVAL_MODEL = "sonnet"  # Can be switched to "opus" for deeper analysis


def set_eval_model(model: str):
    global EVAL_MODEL
    EVAL_MODEL = model


def set_turn_model(model: str):
    global TURN_MODEL
    TURN_MODEL = model


def _call_claude(prompt: str, model: str = None, max_tokens: int = 1024) -> str:
    """Call Claude Code CLI synchronously. Returns the text response."""
    cmd = [
        "claude", "-p", prompt,
        "--output-format", "text",
        "--model", model or TURN_MODEL,
        "--max-turns", "1",
    ]
    logger.debug(f"Calling claude CLI: model={model or TURN_MODEL} prompt_len={len(prompt)}")
    try:
        # Strip CLAUDECODE env var to allow spawning inside a Claude Code session
        env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ANTHROPIC_API_KEY")}
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
        if result.returncode != 0:
            logger.warning(f"Claude CLI error (rc={result.returncode}): {result.stderr[:500]}")
            return ""
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        logger.warning("Claude CLI call timed out")
        return ""
    except FileNotFoundError:
        logger.error("Claude CLI not found. Is `claude` installed and in PATH?")
        return ""


async def _call_claude_async(prompt: str, model: str = None) -> str:
    """Async wrapper for _call_claude."""
    return await asyncio.to_thread(_call_claude, prompt, model)


class ActorBrain:
    """Uses Claude Code CLI to decide next messages and evaluate Kai's responses."""

    _verified = False

    def __init__(self):
        # Verify claude CLI once (not every session)
        if not ActorBrain._verified:
            try:
                env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ANTHROPIC_API_KEY")}
                result = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=10, env=env)
                if result.returncode == 0:
                    logger.info(f"Claude CLI available: {result.stdout.strip()}")
                    ActorBrain._verified = True
                else:
                    logger.warning(f"Claude CLI check failed: {result.stderr}")
            except (FileNotFoundError, subprocess.TimeoutExpired):
                logger.error("Claude CLI not found or timed out")

    async def decide_next_message(
        self,
        goal: str,
        conversation_history: list,
        turn_number: int,
        max_turns: int,
        actor_mode: str = "explore",
        plan: list = None,
    ) -> str:
        """Decide what message to send next to Kai."""
        history_text = self._format_history(conversation_history)
        turns_remaining = max_turns - turn_number + 1

        if actor_mode == "hybrid" and plan:
            current_plan_step = plan[min(turn_number - 1, len(plan) - 1)] if plan else None
            prompt = f"""You are a test actor having a multi-turn conversation with an AI assistant called Kai (Katalon's testing orchestrator).

Goal: {goal}
Turn: {turn_number}/{max_turns} ({turns_remaining} remaining)
Planned message for this turn: {current_plan_step}

Conversation so far:
{history_text}

Based on Kai's last response and the planned message, decide the actual message to send.
- If Kai's response suggests a different follow-up would be more valuable, adapt
- If Kai asked for clarification, respond to that first
- If the plan step is still relevant, use it (possibly modified)
- Keep it focused on the test goal

Return ONLY the message to send, nothing else."""
        else:
            prompt = f"""You are a test actor having a multi-turn conversation with an AI assistant called Kai (Katalon's testing orchestrator).

Goal: {goal}
Turn: {turn_number}/{max_turns} ({turns_remaining} remaining)

Conversation so far:
{history_text}

Decide the next message to send to Kai. Strategy:
- Turn 1-2: Start with clear, direct questions about the goal
- Mid turns: Get increasingly specific, test depth
- Test context retention by referencing earlier responses
- Include at least one challenging/edge-case question
- Final turns: Summarize or test recovery from edge cases
- If Kai asked for clarification, provide it
- If Kai errored, try a recovery message

Return ONLY the message to send, nothing else."""

        response = await _call_claude_async(prompt, TURN_MODEL)
        return response or f"What can you tell me about {goal}?"

    async def generate_hybrid_plan(self, goal: str, max_turns: int) -> list:
        """Generate a conversation plan for hybrid mode."""
        prompt = f"""Generate a {max_turns}-turn conversation plan for testing an AI assistant called Kai (Katalon's testing orchestrator).

Goal: {goal}

Create exactly {max_turns} messages, one per line. The plan should:
1. Start with a clear question about the goal
2. Progressively get more specific
3. Test context retention (reference earlier turns)
4. Include one edge case or challenging request
5. End with a summary or synthesis request

Return ONLY the messages, one per line, numbered like:
1. First message
2. Second message
..."""

        response = await _call_claude_async(prompt, TURN_MODEL)
        if not response:
            return [f"Tell me about {goal}"] * max_turns

        lines = response.strip().split("\n")
        plan = []
        for line in lines:
            line = line.strip()
            if line and line[0].isdigit():
                msg = line.split(".", 1)[1].strip() if "." in line else line
                plan.append(msg)
        return plan[:max_turns] if plan else [f"Tell me about {goal}"] * max_turns

    async def evaluate_turn(
        self,
        user_message: str,
        assistant_response: str,
        goal: str,
        turn_number: int,
        rubric: dict = None,
    ) -> dict:
        """Evaluate a single turn. Returns scores 1-5 for each dimension."""
        from rubric import format_rubric_for_prompt, load_rubric
        if rubric is None:
            rubric = load_rubric()
        rubric_text = format_rubric_for_prompt(rubric)

        prompt = f"""Evaluate this AI assistant (Kai) response. Kai is Katalon's testing orchestrator agent.

Test Goal: {goal}
Turn: {turn_number}
User message: {user_message}
Kai response: {assistant_response}

Score each dimension 1-5 using this rubric:
{rubric_text}

IMPORTANT: For tool_usage, if the question did not require any tool calls and Kai did not use any, score 5 (optimal — no tools needed, none used). Only score lower if tools WERE needed but not used, or used incorrectly.

Return ONLY valid JSON, no markdown:
{{"relevance": N, "accuracy": N, "helpfulness": N, "tool_usage": N, "notes": "brief observation"}}"""

        response = await _call_claude_async(prompt, EVAL_MODEL)
        return self._parse_json(response, {
            "relevance": 3, "accuracy": 3, "helpfulness": 3, "tool_usage": 3, "notes": "eval parse error"
        })

    async def evaluate_session(
        self,
        goal: str,
        turns: list,
        actor_mode: str,
        rubric: dict = None,
    ) -> dict:
        """Comprehensive evaluation of the entire session."""
        from rubric import format_session_rubric_for_prompt, load_rubric
        if rubric is None:
            rubric = load_rubric()
        rubric_text = format_session_rubric_for_prompt(rubric)

        transcript = ""
        for t in turns:
            transcript += f"\n[Turn {t.get('turn_number', '?')}]\n"
            transcript += f"User: {t.get('user_message', '')}\n"
            resp = t.get('assistant_response', '') or ''
            transcript += f"Kai: {resp}\n"
            if t.get('error'):
                transcript += f"Error: {t['error']}\n"
            # Include latency data
            ttfb = t.get('ttfb_ms', 0)
            total = t.get('total_ms', 0)
            if ttfb or total:
                transcript += f"Latency: TTFT={ttfb:.0f}ms, Total={total:.0f}ms\n"

        # Compute latency summary
        ttfbs = [t.get('ttfb_ms', 0) for t in turns if t.get('ttfb_ms', 0) > 0]
        totals = [t.get('total_ms', 0) for t in turns if t.get('total_ms', 0) > 0]
        latency_summary = ""
        if ttfbs:
            latency_summary = f"""
Latency Summary:
- Avg TTFT: {sum(ttfbs)/len(ttfbs):.0f}ms, Max: {max(ttfbs):.0f}ms
- Avg Total: {sum(totals)/len(totals):.0f}ms, Max: {max(totals):.0f}ms"""

        prompt = f"""You are evaluating a test session with Kai (Katalon's AI testing orchestrator).

Test Goal: {goal}
Actor Mode: {actor_mode}
Total Turns: {len(turns)}
{latency_summary}

Full Transcript:
{transcript}

Provide a comprehensive evaluation. Score each dimension 1-5 using this rubric:
{rubric_text}

Return ONLY valid JSON, no markdown:
{{
    "goal_achievement": N,
    "context_retention": N,
    "error_handling": N,
    "response_quality": N,
    "overall_score": N.N,
    "summary": "2-3 sentence overall assessment",
    "issues": ["issue 1", "issue 2"]
}}"""

        response = await _call_claude_async(prompt, EVAL_MODEL)
        return self._parse_json(response, {
            "goal_achievement": 3, "context_retention": 3, "error_handling": 3,
            "response_quality": 3, "overall_score": 3.0,
            "summary": "Evaluation parsing failed", "issues": [],
        })

    def _parse_json(self, text: str, fallback: dict) -> dict:
        if not text:
            return fallback
        try:
            # Strip markdown code blocks if present
            clean = text.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            return json.loads(clean)
        except (json.JSONDecodeError, IndexError):
            logger.warning(f"Failed to parse JSON response: {text[:200]}")
            return fallback

    def _derive_opening_message(self, goal: str) -> str:
        """Derive a natural opening message from the goal without calling Claude CLI.

        For turn 1 with no history, the opening message is straightforward:
        extract the intent from the goal and phrase it as a direct question.
        """
        g = goal.lower().strip()
        # Common patterns — map to natural first messages
        if "greeting" in g or "hello" in g or "greet" in g:
            return "Hello! What can you help me with?"
        if "capabilities" in g or "what can you do" in g:
            return "What are all the things you can do? List your capabilities."
        if "requirement" in g:
            return "Show me all available requirements in this project."
        if "test case" in g or "generate test" in g:
            return "Generate test cases for a login feature with email and password authentication."
        if "insight" in g or "health" in g or "test result" in g:
            return "Give me insights on the latest testing health and results for this project."
        if "test run" in g or "execution" in g:
            return "Show me the latest test run results."
        # Generic: turn the goal into a question
        return f"I need help with: {goal.rstrip('.')}. What can you do for me?"

    def _format_history(self, conversation_history: list) -> str:
        if not conversation_history:
            return "(no conversation yet - this is the first turn)"
        parts = []
        for msg in conversation_history:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    p.get("text", "") if isinstance(p, dict) else str(p)
                    for p in content
                )
            else:
                text = str(content)
            parts.append(f"{'User' if role == 'user' else 'Kai'}: {text}")
        return "\n".join(parts)
