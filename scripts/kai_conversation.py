"""
Kai Conversation — Round-by-round match driver for Kai.

Designed to be called by Claude Code (or any orchestrator) one round at a time.
Maintains match state, enforces limits, and collects per-round analytics.

Terminology (boxing analogy):
  Match  = one complete conversation test session
  Round  = one user→Kai exchange within a match

Usage (CLI):
    python kai_conversation.py start --env                              # start a match
    python kai_conversation.py round --match <id> --env -m "Hello"      # send a round
    python kai_conversation.py status --match <id>                      # match status
    python kai_conversation.py end --match <id> --env                   # end match + report

Usage (Python):
    from kai_conversation import KaiMatch
    match = KaiMatch(client, max_rounds=10)
    result = match.send_round("Hello!")
    report = match.end()
"""
import json
import os
import sys
import time
import uuid
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

from kai_client import KaiClient

logger = logging.getLogger(__name__)

MATCHES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "matches")


@dataclass
class RoundResult:
    round_number: int
    user_message: str
    assistant_response: str
    status: str
    thread_id: str
    run_id: str
    ttfb_ms: float = 0.0
    total_ms: float = 0.0
    poll_count: int = 0
    tool_calls: list = field(default_factory=list)
    error: Optional[str] = None
    timestamp: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class MatchState:
    match_id: str
    thread_id: Optional[str] = None
    started_at: str = ""
    max_rounds: int = 20
    max_time_s: float = 600.0
    round_count: int = 0
    elapsed_s: float = 0.0
    rounds: list = field(default_factory=list)
    conversation_history: list = field(default_factory=list)
    active: bool = True
    stop_reason: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "match_id": self.match_id,
            "thread_id": self.thread_id,
            "started_at": self.started_at,
            "max_rounds": self.max_rounds,
            "max_time_s": self.max_time_s,
            "round_count": self.round_count,
            "elapsed_s": round(self.elapsed_s, 1),
            "active": self.active,
            "stop_reason": self.stop_reason,
            "rounds": [r if isinstance(r, dict) else r.to_dict() for r in self.rounds],
        }


class KaiMatch:
    """Round-by-round match driver with limits and analytics."""

    def __init__(self, client: KaiClient, max_rounds: int = 20, max_time_s: float = 600.0):
        self.client = client
        self.state = MatchState(
            match_id=str(uuid.uuid4())[:8],
            started_at=datetime.now().isoformat(),
            max_rounds=max_rounds,
            max_time_s=max_time_s,
        )
        self._start_time = time.time()

    @property
    def match_id(self) -> str:
        return self.state.match_id

    def can_continue(self) -> tuple[bool, Optional[str]]:
        """Check if match can continue. Returns (can_continue, reason_if_not)."""
        if not self.state.active:
            return False, self.state.stop_reason or "match_ended"
        if self.state.round_count >= self.state.max_rounds:
            return False, f"max_rounds_reached ({self.state.max_rounds})"
        elapsed = time.time() - self._start_time
        if elapsed >= self.state.max_time_s:
            return False, f"time_limit_reached ({self.state.max_time_s}s)"
        return True, None

    def send_round(self, message: str) -> RoundResult:
        """Send one round (message) to Kai and return the result."""
        can, reason = self.can_continue()
        if not can:
            self.state.active = False
            self.state.stop_reason = reason
            return RoundResult(
                round_number=self.state.round_count + 1,
                user_message=message,
                assistant_response="",
                status="stopped",
                thread_id=self.state.thread_id or "",
                run_id="",
                error=f"Match stopped: {reason}",
                timestamp=datetime.now().isoformat(),
            )

        self.state.round_count += 1
        rnd = self.state.round_count

        logger.info(f"[match={self.match_id}] Round {rnd}: sending '{message[:80]}...'")

        # Wait for Kai to be ready before sending (prevents "invalid request" errors)
        if self.state.thread_id:
            self.client.wait_for_ready(self.state.thread_id)

        chat_result = self.client.chat(
            message=message,
            thread_id=self.state.thread_id,
            conversation_history=self.state.conversation_history if self.state.thread_id else None,
        )

        # Update thread for multi-round
        self.state.thread_id = chat_result.thread_id

        # Update conversation history
        self.state.conversation_history.append({
            "id": str(int(time.time() * 1000)),
            "role": "user",
            "content": [{"type": "text", "text": message}],
        })
        if chat_result.text:
            self.state.conversation_history.append({
                "id": str(int(time.time() * 1000) + 1),
                "role": "assistant",
                "content": [{"type": "text", "text": chat_result.text}],
            })

        self.state.elapsed_s = time.time() - self._start_time

        result = RoundResult(
            round_number=rnd,
            user_message=message,
            assistant_response=chat_result.text,
            status=chat_result.status,
            thread_id=chat_result.thread_id,
            run_id=chat_result.run_id,
            ttfb_ms=chat_result.analytics.ttfb_ms,
            total_ms=chat_result.analytics.total_ms,
            poll_count=chat_result.analytics.poll_count,
            tool_calls=[
                {"name": tc.name, "arguments": tc.arguments, "call_id": tc.call_id}
                for tc in chat_result.analytics.tool_calls
            ],
            error=chat_result.analytics.error_message,
            timestamp=datetime.now().isoformat(),
        )

        self.state.rounds.append(result)

        logger.info(
            f"[match={self.match_id}] Round {rnd} done: "
            f"status={result.status} ttfb={result.ttfb_ms:.0f}ms total={result.total_ms:.0f}ms"
        )

        return result

    def end(self) -> dict:
        """End the match and generate the final report."""
        self.state.active = False
        self.state.elapsed_s = time.time() - self._start_time
        if not self.state.stop_reason:
            self.state.stop_reason = "completed"
        return self._generate_report()

    def _generate_report(self) -> dict:
        """Generate a comprehensive match report."""
        rounds = self.state.rounds
        round_dicts = [r if isinstance(r, dict) else r.to_dict() for r in rounds]

        def _get(r, key, default=0):
            return r.get(key, default) if isinstance(r, dict) else getattr(r, key, default)

        ttfbs = [_get(r, "ttfb_ms") for r in rounds if _get(r, "ttfb_ms") > 0]
        totals = [_get(r, "total_ms") for r in rounds if _get(r, "total_ms") > 0]
        all_tools = []
        all_tool_names = []
        for r in rounds:
            tcs = _get(r, "tool_calls", [])
            if isinstance(tcs, list):
                all_tools.extend(tcs)
                for tc in tcs:
                    if isinstance(tc, dict):
                        all_tool_names.append(tc.get("name", "unknown"))
                    else:
                        all_tool_names.append(str(tc))

        def safe_percentile(values, p):
            if not values:
                return 0
            sv = sorted(values)
            idx = min(int(len(sv) * p), len(sv) - 1)
            return round(sv[idx], 1)

        report = {
            "match_id": self.state.match_id,
            "thread_id": self.state.thread_id,
            "started_at": self.state.started_at,
            "ended_at": datetime.now().isoformat(),
            "stop_reason": self.state.stop_reason,
            "limits": {
                "max_rounds": self.state.max_rounds,
                "max_time_s": self.state.max_time_s,
            },
            "summary": {
                "total_rounds": self.state.round_count,
                "total_elapsed_s": round(self.state.elapsed_s, 1),
                "successful_rounds": sum(1 for r in rounds if _get(r, "status") == "input-required"),
                "failed_rounds": sum(1 for r in rounds if _get(r, "status") not in ("input-required", "stopped", "")),
            },
            "latency": {
                "ttfb_avg_ms": round(sum(ttfbs) / len(ttfbs), 1) if ttfbs else 0,
                "ttfb_p50_ms": safe_percentile(ttfbs, 0.5),
                "ttfb_p95_ms": safe_percentile(ttfbs, 0.95),
                "ttfb_max_ms": round(max(ttfbs), 1) if ttfbs else 0,
                "total_avg_ms": round(sum(totals) / len(totals), 1) if totals else 0,
                "total_p50_ms": safe_percentile(totals, 0.5),
                "total_p95_ms": safe_percentile(totals, 0.95),
                "total_max_ms": round(max(totals), 1) if totals else 0,
            },
            "tools": {
                "total_tool_calls": len(all_tools),
                "tools_used": list(set(all_tool_names)),
                "tool_details": all_tools,
            },
            "rounds": round_dicts,
        }

        return report

    # ── Persistence ──────────────────────────────────────────────────

    def save(self):
        """Save match state to disk for resumability."""
        os.makedirs(MATCHES_DIR, exist_ok=True)
        path = os.path.join(MATCHES_DIR, f"{self.match_id}.json")
        with open(path, "w") as f:
            json.dump(self.state.to_dict(), f, indent=2)
        return path

    @classmethod
    def load(cls, match_id: str, client: KaiClient) -> "KaiMatch":
        """Load a match from disk."""
        path = os.path.join(MATCHES_DIR, f"{match_id}.json")
        if not os.path.exists(path):
            raise FileNotFoundError(f"Match {match_id} not found at {path}")

        with open(path) as f:
            data = json.load(f)

        conv = cls(client, max_rounds=data["max_rounds"], max_time_s=data["max_time_s"])
        conv.state.match_id = data["match_id"]
        conv.state.thread_id = data.get("thread_id")
        conv.state.started_at = data["started_at"]
        conv.state.round_count = data["round_count"]
        conv.state.active = data["active"]
        conv.state.stop_reason = data.get("stop_reason")
        conv.state.rounds = data.get("rounds", [])

        # Rebuild conversation history from rounds
        for rnd in conv.state.rounds:
            conv.state.conversation_history.append({
                "id": str(int(time.time() * 1000)),
                "role": "user",
                "content": [{"type": "text", "text": rnd["user_message"]}],
            })
            if rnd.get("assistant_response"):
                conv.state.conversation_history.append({
                    "id": str(int(time.time() * 1000) + 1),
                    "role": "assistant",
                    "content": [{"type": "text", "text": rnd["assistant_response"]}],
                })

        return conv


# ── CLI ──────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Kai Match — Round-by-round conversation driver")
    sub = parser.add_subparsers(dest="command")

    # start
    start_p = sub.add_parser("start", help="Start a new match")
    start_p.add_argument("--env", action="store_true", help="Auto-generate token from .env")
    start_p.add_argument("--token", help="Auth token")
    start_p.add_argument("--project", default="1782829")
    start_p.add_argument("--max-rounds", type=int, default=20)
    start_p.add_argument("--max-time", type=float, default=600.0, help="Max time in seconds")
    start_p.add_argument("-v", "--verbose", action="store_true")

    # round
    round_p = sub.add_parser("round", help="Send a round (one exchange)")
    round_p.add_argument("--match", "-m", required=True, help="Match ID")
    round_p.add_argument("--message", required=True, help="Message to send")
    round_p.add_argument("--env", action="store_true")
    round_p.add_argument("--token", help="Auth token")
    round_p.add_argument("--project", default="1782829")
    round_p.add_argument("-v", "--verbose", action="store_true")

    # status
    status_p = sub.add_parser("status", help="Get match status")
    status_p.add_argument("--match", "-m", required=True)

    # end
    end_p = sub.add_parser("end", help="End match and get report")
    end_p.add_argument("--match", "-m", required=True)
    end_p.add_argument("--env", action="store_true")
    end_p.add_argument("--token", help="Auth token")
    end_p.add_argument("--project", default="1782829")
    end_p.add_argument("--output", "-o", help="Save report to file")
    end_p.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if getattr(args, "verbose", False) else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    def make_client(args):
        if getattr(args, "env", False):
            return KaiClient.from_env(project_id=getattr(args, "project", "1782829"))
        token = getattr(args, "token", None) or os.environ.get("KAI_TOKEN", "")
        if not token:
            print("Error: provide --token, --env, or set KAI_TOKEN", file=sys.stderr)
            sys.exit(1)
        return KaiClient(token=token, project_id=getattr(args, "project", "1782829"))

    if args.command == "start":
        client = make_client(args)
        match = KaiMatch(client, max_rounds=args.max_rounds, max_time_s=args.max_time)
        match.save()
        print(json.dumps({
            "match_id": match.match_id,
            "max_rounds": args.max_rounds,
            "max_time_s": args.max_time,
            "status": "ready",
        }, indent=2))

    elif args.command == "round":
        client = make_client(args)
        match = KaiMatch.load(args.match, client)
        result = match.send_round(args.message)
        match.save()
        print(json.dumps(result.to_dict() if isinstance(result, RoundResult) else result, indent=2))

    elif args.command == "status":
        path = os.path.join(MATCHES_DIR, f"{args.match}.json")
        if not os.path.exists(path):
            print(f"Match {args.match} not found", file=sys.stderr)
            sys.exit(1)
        with open(path) as f:
            data = json.load(f)
        summary = {k: v for k, v in data.items() if k != "rounds"}
        summary["round_count"] = data.get("round_count", 0)
        print(json.dumps(summary, indent=2))

    elif args.command == "end":
        client = make_client(args)
        match = KaiMatch.load(args.match, client)
        report = match.end()
        match.save()

        if args.output:
            with open(args.output, "w") as f:
                json.dump(report, f, indent=2)
            print(f"Report saved to {args.output}", file=sys.stderr)

        print(json.dumps(report, indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
