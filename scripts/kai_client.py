"""
Kai Agent Client — Interact with Katalon's orchestrator agent chatbot.

Supports:
- Conversation management (create, list, get, archive)
- Message sending with SSE streaming
- Analytics tracking (latency, tool calls, token usage)
- Multi-turn conversation flows

Usage:
    from kai_client import KaiClient

    client = KaiClient(token="...", project_id="1782829")
    result = client.chat("What can you help me with?")
    print(result.text)
    print(result.analytics)
"""
import json
import os
import time
import uuid
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class ConversationStatus(str, Enum):
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    ERROR = "error"


@dataclass
class SSEEvent:
    event: Optional[str] = None
    data: str = ""
    id: Optional[str] = None
    retry: Optional[int] = None
    raw: Optional[str] = None


@dataclass
class ToolCall:
    name: str
    arguments: dict
    call_id: Optional[str] = None
    timestamp: float = 0.0


@dataclass
class Analytics:
    """Tracks latency, tool calls, and agent workflow details."""
    request_start: float = 0.0
    first_byte: float = 0.0
    response_end: float = 0.0
    ttfb_ms: float = 0.0  # time to first token
    total_ms: float = 0.0
    poll_count: int = 0
    poll_total_ms: float = 0.0
    tool_calls: list = field(default_factory=list)
    sse_events: list = field(default_factory=list)
    sse_event_count: int = 0
    final_status: str = ""
    error_message: Optional[str] = None
    raw_chunks: list = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "ttfb_ms": round(self.ttfb_ms, 1),
            "total_ms": round(self.total_ms, 1),
            "poll_count": self.poll_count,
            "poll_total_ms": round(self.poll_total_ms, 1),
            "sse_event_count": self.sse_event_count,
            "tool_calls": [{"name": tc.name, "args": tc.arguments} for tc in self.tool_calls],
            "final_status": self.final_status,
            "error": self.error_message,
        }


@dataclass
class ChatResponse:
    thread_id: str
    run_id: str
    status: str
    text: str = ""
    messages: list = field(default_factory=list)
    tool_calls: list = field(default_factory=list)
    analytics: Analytics = field(default_factory=Analytics)
    raw_events: list = field(default_factory=list)


@dataclass
class Conversation:
    id: str
    name: str
    status: str
    archived: bool = False
    updated_at: str = ""
    app_name: str = "orchestrator-agent"
    user_id: str = ""


# Default tools the browser sends to Kai
DEFAULT_TOOLS = [
    {
        "name": "frontend_render_link",
        "description": (
            "Render a clickable link in the chat for navigation in TestOps. "
            "Use this when you see a URL field that can provide the user with "
            "a link to navigate to a specific page or section."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "response": {
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
                "text": {"type": "string"},
            },
        },
    }
]


class _TokenCache:
    """SQLite-based bearer token cache. Avoids repeated Puppeteer logins.

    Stores tokens in the same DB as the web app (web/data/kai_tests.db).
    Table: token_cache (env_key, email, platform_url, token, expires_at).
    """

    @classmethod
    def _db_path(cls) -> str:
        # Try web/data/ first (same DB as dashboard), fallback to scripts/data/
        web_data = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "data")
        if os.path.isdir(web_data):
            return os.path.join(web_data, "kai_tests.db")
        # Docker layout: /app/web/data/
        app_data = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "data")
        if os.path.isdir(app_data):
            return os.path.join(app_data, "kai_tests.db")
        # Fallback: create in scripts/data/
        fallback = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
        os.makedirs(fallback, exist_ok=True)
        return os.path.join(fallback, "kai_tests.db")

    @classmethod
    def _ensure_table(cls, conn):
        conn.execute("""
            CREATE TABLE IF NOT EXISTS token_cache (
                env_key TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                platform_url TEXT NOT NULL,
                token TEXT NOT NULL,
                expires_at REAL NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

    @classmethod
    def _env_key(cls, email: str, platform_url: str, account: str) -> str:
        """Derive a stable env key from credentials."""
        import hashlib
        raw = f"{email}|{platform_url}|{account}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    @classmethod
    def _decode_jwt_exp(cls, token: str) -> float:
        """Extract expiry from JWT. Returns epoch seconds or now+1h as fallback."""
        try:
            import base64
            parts = token.split(".")
            if len(parts) >= 2:
                payload = parts[1] + "=" * (4 - len(parts[1]) % 4)
                decoded = json.loads(base64.urlsafe_b64decode(payload))
                if "exp" in decoded:
                    return float(decoded["exp"])
        except Exception:
            pass
        return time.time() + 3600

    @classmethod
    def get(cls, email: str, platform_url: str, account: str) -> Optional[str]:
        """Return cached token if still valid (>5 min remaining), else None."""
        import sqlite3
        env_key = cls._env_key(email, platform_url, account)
        try:
            conn = sqlite3.connect(cls._db_path())
            cls._ensure_table(conn)
            row = conn.execute(
                "SELECT token, expires_at FROM token_cache WHERE env_key = ?", (env_key,)
            ).fetchone()
            conn.close()
            if row:
                token, expires_at = row
                remaining = expires_at - time.time()
                if remaining > 300:
                    logger.info(f"Token cache hit for {email} on {platform_url} (expires in {int(remaining)}s)")
                    return token
                logger.info(f"Token cache expired for {email} on {platform_url}")
        except Exception as e:
            logger.debug(f"Token cache read error: {e}")
        return None

    @classmethod
    def put(cls, email: str, platform_url: str, account: str, token: str):
        """Cache a token. Extracts expiry from JWT payload."""
        import sqlite3
        env_key = cls._env_key(email, platform_url, account)
        expires_at = cls._decode_jwt_exp(token)
        logger.info(f"Caching token for {email} on {platform_url} (expires in {int(expires_at - time.time())}s)")
        try:
            conn = sqlite3.connect(cls._db_path())
            cls._ensure_table(conn)
            conn.execute(
                "INSERT OR REPLACE INTO token_cache (env_key, email, platform_url, token, expires_at) VALUES (?, ?, ?, ?, ?)",
                (env_key, email, platform_url, token, expires_at),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.warning(f"Token cache write error: {e}")

    @classmethod
    def clear(cls, email: str = None, platform_url: str = None, account: str = None):
        """Clear cached tokens."""
        import sqlite3
        try:
            conn = sqlite3.connect(cls._db_path())
            cls._ensure_table(conn)
            if email and platform_url and account:
                env_key = cls._env_key(email, platform_url, account)
                conn.execute("DELETE FROM token_cache WHERE env_key = ?", (env_key,))
            else:
                conn.execute("DELETE FROM token_cache")
            conn.commit()
            conn.close()
        except Exception as e:
            logger.debug(f"Token cache clear error: {e}")


class KaiClient:
    """Client for interacting with Katalon's Kai orchestrator agent."""

    # Defaults (production)
    DEFAULT_BASE_URL = "https://katalonhub.katalon.io"
    DEFAULT_LOGIN_URL = "https://to3-devtools.vercel.app/api/login"
    DEFAULT_PLATFORM_URL = "https://platform.katalon.com"

    @classmethod
    def from_env(cls, env_path: str = None, **kwargs):
        """Create a KaiClient using credentials from .env file + optional overrides."""
        import os
        env_path = env_path or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
        )
        env = {}
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        env[key] = value.strip('"').strip("'")

        # Env vars override .env file (fire_runner passes active profile via env vars)
        email = os.environ.get("TESTOPS_EMAIL") or env.get("TESTOPS_EMAIL", "")
        password = os.environ.get("TESTOPS_PASSWORD") or env.get("TESTOPS_PASSWORD", "")
        account = os.environ.get("TESTOPS_ACCOUNT") or env.get("TESTOPS_ACCOUNT", "")

        if not all([email, password, account]):
            raise ValueError("Missing TESTOPS_EMAIL, TESTOPS_PASSWORD, or TESTOPS_ACCOUNT in .env")

        # Allow overrides from kwargs or env vars
        base_url = kwargs.pop("base_url", None) or os.environ.get("KAI_BASE_URL", cls.DEFAULT_BASE_URL)
        login_url = kwargs.pop("login_url", None) or os.environ.get("KAI_LOGIN_URL", cls.DEFAULT_LOGIN_URL)
        platform_url = kwargs.pop("platform_url", None) or os.environ.get("KAI_PLATFORM_URL", cls.DEFAULT_PLATFORM_URL)
        # Also allow project/org/account overrides via env vars
        if "project_id" not in kwargs and os.environ.get("KAI_PROJECT_ID"):
            kwargs["project_id"] = os.environ["KAI_PROJECT_ID"]
        if "org_id" not in kwargs and os.environ.get("KAI_ORG_ID"):
            kwargs["org_id"] = os.environ["KAI_ORG_ID"]
        if "account_id" not in kwargs and os.environ.get("KAI_ACCOUNT_ID"):
            kwargs["account_id"] = os.environ["KAI_ACCOUNT_ID"]
        if "project_name" not in kwargs and os.environ.get("KAI_PROJECT_NAME"):
            kwargs["project_name"] = os.environ["KAI_PROJECT_NAME"]
        if "account_name" not in kwargs and os.environ.get("KAI_ACCOUNT_NAME"):
            kwargs["account_name"] = os.environ["KAI_ACCOUNT_NAME"]

        token = cls._get_or_refresh_token(email, password, account, login_url, platform_url, base_url)
        return cls(token=token, base_url=base_url, **kwargs)

    @classmethod
    def from_credentials(cls, email: str, password: str, account: str, **kwargs):
        """Create a KaiClient using explicit credentials (no .env file needed)."""
        if not all([email, password, account]):
            raise ValueError("Missing email, password, or account")

        base_url = kwargs.pop("base_url", None) or cls.DEFAULT_BASE_URL
        login_url = kwargs.pop("login_url", None) or cls.DEFAULT_LOGIN_URL
        platform_url = kwargs.pop("platform_url", None) or cls.DEFAULT_PLATFORM_URL

        token = cls._get_or_refresh_token(email, password, account, login_url, platform_url, base_url)
        return cls(token=token, base_url=base_url, **kwargs)

    @classmethod
    def _get_or_refresh_token(cls, email, password, account, login_url, platform_url, base_url):
        """Get token from cache or login API. Caches for reuse."""
        # Check cache first
        cached = _TokenCache.get(email, platform_url, account)
        if cached:
            return cached

        # Login via Puppeteer API (slow ~5-10s)
        logger.info(f"Requesting new bearer token for {email} on {platform_url}...")
        resp = httpx.post(
            login_url,
            json={"url": platform_url, "email": email, "password": password, "account": account},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        token_data = data.get("token", {})
        token = token_data.get("access_token") if isinstance(token_data, dict) else token_data
        if not token:
            raise ValueError(f"Failed to get bearer token: {data}")

        # Cache for next time
        _TokenCache.put(email, platform_url, account, token)
        logger.info(f"Generated & cached bearer token for {email} on {base_url}")
        return token

    def __init__(
        self,
        token: str,
        project_id: str = "1782829",
        org_id: str = "1670719",
        account_id: str = "9be50327-d44f-4def-8620-c04a1ffc93ac",
        user_uuid: str = "c7aec1fd-5ba9-43c7-927c-71b351b148b1",
        user_name: str = "Chau Joe Duong",
        user_email: str = "chau.duong@katalon.com",
        project_name: str = "TestOps - RA",
        account_name: str = "Katalon Hub",
        base_url: str = None,
        poll_interval: float = 2.0,
        poll_timeout: float = 300.0,
    ):
        self.token = token
        self.BASE_URL = base_url or self.DEFAULT_BASE_URL
        self.project_id = project_id
        self.org_id = org_id
        self.account_id = account_id
        self.user_uuid = user_uuid
        self.user_name = user_name
        self.user_email = user_email
        self.project_name = project_name
        self.account_name = account_name
        self.poll_interval = poll_interval
        self.poll_timeout = poll_timeout

        self._client = httpx.Client(timeout=300.0, follow_redirects=True)

    def _headers(self, accept: str = "application/json") -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Organization-Id": self.org_id,
            "x-project-id": self.project_id,
            "x-account-id": self.account_id,
            "Content-Type": "application/json",
            "Accept": accept,
            "Referer": f"{self.BASE_URL}/project/{self.project_id}/admin/project/general",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        }

    def _context(self, page_context: Optional[str] = None) -> list:
        return [
            {
                "description": "General context: Shows the account, user info, and their current project",
                "value": (
                    f"[Project Context] Project ID: {self.project_id} "
                    f"Project Name: {self.project_name} "
                    f"[Account Context] Account Name: {self.account_name} "
                    f"[User Context] User UUID: {self.user_uuid} "
                    f"Name: {self.user_name} Email: {self.user_email}"
                ),
            },
            {
                "description": "Current page context: Shows what page the user is on, and the content of the page.",
                "value": page_context or "null",
            },
        ]

    # ── Conversation Management ──────────────────────────────────────

    def list_conversations(self) -> list[Conversation]:
        resp = self._client.get(
            f"{self.BASE_URL}/agent/conversations",
            params={"appName": "orchestrator-agent"},
            headers=self._headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        return [
            Conversation(
                id=c["id"],
                name=c["name"],
                status=c["status"],
                archived=c.get("archived", False),
                updated_at=c.get("updatedAt", ""),
                app_name=c.get("appName", ""),
                user_id=c.get("userId", ""),
            )
            for c in data.get("conversations", [])
        ]

    def get_conversation(self, thread_id: str) -> Conversation:
        resp = self._client.get(
            f"{self.BASE_URL}/agent/conversations/{thread_id}",
            headers=self._headers(),
        )
        resp.raise_for_status()
        c = resp.json()["conversation"]
        return Conversation(
            id=c["id"],
            name=c["name"],
            status=c["status"],
            archived=c.get("archived", False),
            updated_at=c.get("updatedAt", ""),
            app_name=c.get("appName", ""),
            user_id=c.get("userId", ""),
        )

    # ── Chat ─────────────────────────────────────────────────────────

    def chat(
        self,
        message: str,
        thread_id: Optional[str] = None,
        tools: Optional[list] = None,
        page_context: Optional[str] = None,
        conversation_history: Optional[list] = None,
    ) -> ChatResponse:
        """
        Send a message to Kai and wait for the response.

        Args:
            message: The user message to send
            thread_id: Existing thread ID for multi-turn conversation
            tools: Custom tools (defaults to frontend_render_link)
            page_context: Current page context for the agent
            conversation_history: Previous messages for context
        """
        thread_id = thread_id or str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        msg_id = str(int(time.time() * 1000))
        analytics = Analytics()

        # Build messages list
        messages = []
        if conversation_history:
            messages.extend(conversation_history)
        messages.append({
            "id": msg_id,
            "role": "user",
            "content": [{"type": "text", "text": message}],
        })

        payload = {
            "threadId": thread_id,
            "runId": run_id,
            "tools": tools or DEFAULT_TOOLS,
            "context": self._context(page_context),
            "forwardedProps": {},
            "state": {},
            "messages": messages,
        }

        logger.info(f"Sending message to Kai: thread={thread_id} run={run_id}")

        # ── Phase 1: POST to start the run ───────────────────────────
        analytics.request_start = time.time()

        response = ChatResponse(
            thread_id=thread_id,
            run_id=run_id,
            status="pending",
            analytics=analytics,
        )

        try:
            resp = self._send_run(payload, analytics)
            response.status = resp.get("status", "unknown")
            # TTFT: time until Kai accepted the request and started working
            analytics.first_byte = time.time()
            analytics.ttfb_ms = (analytics.first_byte - analytics.request_start) * 1000
        except Exception as e:
            analytics.response_end = time.time()
            analytics.total_ms = (analytics.response_end - analytics.request_start) * 1000
            analytics.error_message = str(e)
            response.status = "error"
            return response

        # ── Phase 2: Poll /connect until agent completes ─────────────
        # Use a connect-specific payload (same thread, empty messages)
        connect_payload = {
            "threadId": thread_id,
            "runId": str(uuid.uuid4()),
            "tools": payload.get("tools", []),
            "context": payload.get("context", []),
            "forwardedProps": {},
            "state": {},
            "messages": [],
        }

        if response.status == "working":
            self._poll_for_completion(thread_id, connect_payload, response, analytics)

        analytics.response_end = time.time()
        analytics.total_ms = (analytics.response_end - analytics.request_start) * 1000
        analytics.final_status = response.status

        return response

    def _send_run(self, payload: dict, analytics: Analytics) -> dict:
        """POST to /agent/orchestratorAgent/run to start the agent."""
        resp = self._client.post(
            f"{self.BASE_URL}/agent/orchestratorAgent/run",
            headers=self._headers(),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

    def _connect(self, payload: dict) -> dict:
        """POST to /agent/orchestratorAgent/connect to get conversation state."""
        resp = self._client.post(
            f"{self.BASE_URL}/agent/orchestratorAgent/connect",
            headers=self._headers(),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

    def _poll_for_completion(
        self, thread_id: str, payload: dict, response: ChatResponse, analytics: Analytics
    ):
        """Poll via /connect until agent completes, capturing response text.

        TTFT measurement: Since Kai uses a poll-based protocol (not streaming),
        we track two timestamps:
        - TTFT: first poll that returns new history events (Kai started producing content)
        - Total: final poll when status is input-required (Kai finished)
        """
        poll_start = time.time()
        deadline = poll_start + self.poll_timeout

        while time.time() < deadline:
            time.sleep(self.poll_interval)
            analytics.poll_count += 1

            try:
                data = self._connect(payload)
                status = data.get("status", "unknown")
                response.status = status
                history = data.get("historyEvents", [])
                logger.debug(f"Poll #{analytics.poll_count}: status={status} events={len(history)}")

                if status in (ConversationStatus.INPUT_REQUIRED, "input-required"):
                    self._extract_response(history, response, analytics)
                    break
                elif status in (ConversationStatus.ERROR, "error"):
                    analytics.error_message = "Agent returned error status"
                    self._extract_response(history, response, analytics)
                    break
                elif status != ConversationStatus.WORKING and status != "working":
                    break
            except Exception as e:
                logger.warning(f"Poll error: {e}")

        analytics.poll_total_ms = (time.time() - poll_start) * 1000

    def _extract_response(
        self, history: list, response: ChatResponse, analytics: Analytics
    ):
        """Extract assistant reply and tool calls from historyEvents."""
        response.messages = history

        # Pass 1: Extract ALL tool calls from the history
        for msg in history:
            role = msg.get("role", "")
            # Tool calls come in role="tool" messages with toolCalls array
            if role == "tool" and "toolCalls" in msg:
                for tc in msg["toolCalls"]:
                    func = tc.get("function", {})
                    args = func.get("arguments", "{}")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except (json.JSONDecodeError, TypeError):
                            args = {"raw": args}
                    analytics.tool_calls.append(ToolCall(
                        name=func.get("name", "unknown"),
                        arguments=args,
                        call_id=tc.get("id"),
                        timestamp=time.time(),
                    ))
            # Also check assistant messages for inline tool-call content parts
            elif role == "assistant":
                content = msg.get("content", "")
                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "tool-call":
                            analytics.tool_calls.append(ToolCall(
                                name=part.get("toolName", "unknown"),
                                arguments=part.get("args", {}),
                                call_id=part.get("toolCallId"),
                                timestamp=time.time(),
                            ))

        # Pass 2: Concatenate ALL assistant text from all assistant messages (in order)
        all_text_parts = []
        for msg in history:
            if msg.get("role") == "assistant":
                content = msg.get("content", "")
                if isinstance(content, str):
                    if content.strip():
                        all_text_parts.append(content)
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, str):
                            if part.strip():
                                all_text_parts.append(part)
                        elif isinstance(part, dict) and part.get("type") == "text":
                            text = part.get("text", "")
                            if text.strip():
                                all_text_parts.append(text)
        response.text = "\n".join(all_text_parts)

        # Also store tool_calls on the response object
        response.tool_calls = analytics.tool_calls

        logger.info(f"Extracted response: {len(response.text)} chars, {len(analytics.tool_calls)} tool calls from {len(history)} events")

    # ── Cleanup ──────────────────────────────────────────────────────

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# ── CLI ──────────────────────────────────────────────────────────────

def main():
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Kai Agent CLI")
    parser.add_argument("command", choices=["chat", "list", "status"], help="Command to run")
    parser.add_argument("--message", "-m", help="Message to send (for chat)")
    parser.add_argument("--thread", "-t", help="Thread ID (for follow-up or status)")
    parser.add_argument("--token", help="Auth token (or KAI_TOKEN env)")
    parser.add_argument("--env", action="store_true", help="Auto-generate token from .env credentials")
    parser.add_argument("--project", default="1782829", help="Project ID")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if args.env:
        client_instance = KaiClient.from_env(project_id=args.project)
    else:
        token = args.token or os.environ.get("KAI_TOKEN", "")
        if not token:
            parser.error("Provide --token, --env, or set KAI_TOKEN env variable")
        client_instance = KaiClient(token=token, project_id=args.project)

    with client_instance as client:
        if args.command == "list":
            convs = client.list_conversations()
            print(f"{'ID':<40} {'Status':<18} {'Name'}")
            print("-" * 90)
            for c in convs:
                print(f"{c.id:<40} {c.status:<18} {c.name[:40]}")

        elif args.command == "status":
            if not args.thread:
                parser.error("--thread required for status command")
            conv = client.get_conversation(args.thread)
            print(json.dumps({
                "id": conv.id,
                "name": conv.name,
                "status": conv.status,
                "updated_at": conv.updated_at,
            }, indent=2))

        elif args.command == "chat":
            if not args.message:
                parser.error("--message required for chat command")
            result = client.chat(args.message, thread_id=args.thread)
            print(f"\nThread:  {result.thread_id}")
            print(f"Run:     {result.run_id}")
            print(f"Status:  {result.status}")
            if result.text:
                print(f"\nKai: {result.text}")
            print(f"\n--- Analytics ---")
            for k, v in result.analytics.summary().items():
                print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
