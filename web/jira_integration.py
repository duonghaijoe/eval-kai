"""Jira Integration — Log bugs per round from Kai test sessions.

Features:
- Create/update Jira tickets for failed or low-quality rounds
- Duplicate detection via JQL search + AI analysis
- Keyword-based assignee routing
- Auto-trigger on configurable thresholds
- Comprehensive ticket body in Jira wiki markup
"""
import json
import logging
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Optional, Union

import httpx

logger = logging.getLogger(__name__)

# ── Config Storage ────────────────────────────────────────────────

_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(_data_dir, "kai_tests.db")

SERVER_BASE = os.environ.get("SERVER_BASE_URL", "http://10.18.3.20:3006")

@contextmanager
def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_jira_db():
    """Create Jira config and ticket tracking tables."""
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jira_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                base_url TEXT DEFAULT 'https://katalon.atlassian.net',
                project_key TEXT DEFAULT 'QUAL',
                username TEXT DEFAULT '',
                api_token TEXT DEFAULT '',
                label TEXT DEFAULT 'boxing-test-kai',
                default_assignee TEXT DEFAULT '',
                auto_enabled INTEGER DEFAULT 0,
                auto_quality_threshold REAL DEFAULT 3.0,
                auto_on_error INTEGER DEFAULT 1,
                auto_latency_grade TEXT DEFAULT 'D',
                assignment_rules TEXT DEFAULT '[]',
                updated_at TEXT
            )
        """)
        # Seed default row if missing
        row = conn.execute("SELECT id FROM jira_config WHERE id = 1").fetchone()
        if not row:
            # Read defaults from .env
            env = _read_env()
            conn.execute("""
                INSERT INTO jira_config (id, username, api_token, default_assignee)
                VALUES (1, ?, ?, ?)
            """, (
                env.get("JIRA_USERNAME", ""),
                env.get("JIRA_TOKEN", ""),
                env.get("JIRA_USERNAME", ""),
            ))

        conn.execute("""
            CREATE TABLE IF NOT EXISTS jira_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_key TEXT NOT NULL,
                session_id TEXT NOT NULL,
                turn_number INTEGER NOT NULL,
                goal TEXT,
                error_pattern TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                UNIQUE(session_id, turn_number)
            )
        """)


def _read_env() -> dict:
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    result = {}
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    result[k.strip()] = v.strip().strip('"').strip("'")
    return result


def get_jira_config() -> dict:
    """Return Jira config (safe for API — token masked)."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM jira_config WHERE id = 1").fetchone()
        if not row:
            return {}
        d = dict(row)
        d["has_token"] = bool(d.get("api_token"))
        d["api_token"] = ""  # never send token to frontend
        # Parse assignment_rules JSON
        try:
            d["assignment_rules"] = json.loads(d.get("assignment_rules", "[]"))
        except (json.JSONDecodeError, TypeError):
            d["assignment_rules"] = []
        return d


def get_jira_config_full() -> dict:
    """Return Jira config WITH token (internal use only)."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM jira_config WHERE id = 1").fetchone()
        if not row:
            return {}
        d = dict(row)
        try:
            d["assignment_rules"] = json.loads(d.get("assignment_rules", "[]"))
        except (json.JSONDecodeError, TypeError):
            d["assignment_rules"] = []
        return d


def update_jira_config(updates: dict) -> dict:
    """Update Jira config fields."""
    with _get_conn() as conn:
        current = conn.execute("SELECT * FROM jira_config WHERE id = 1").fetchone()
        if not current:
            init_jira_db()

        sets = []
        params = []
        allowed = [
            "base_url", "project_key", "username", "api_token", "label",
            "default_assignee", "auto_enabled", "auto_quality_threshold",
            "auto_on_error", "auto_latency_grade", "assignment_rules",
        ]
        for key in allowed:
            if key in updates:
                val = updates[key]
                if key == "assignment_rules" and isinstance(val, list):
                    val = json.dumps(val)
                # Don't overwrite token with empty string
                if key == "api_token" and not val:
                    continue
                sets.append(f"{key} = ?")
                params.append(val)
        if sets:
            sets.append("updated_at = ?")
            params.append(datetime.now().isoformat())
            params.append(1)
            conn.execute(
                f"UPDATE jira_config SET {', '.join(sets)} WHERE id = ?",
                params,
            )
    return get_jira_config()


# ── Jira API Client ──────────────────────────────────────────────

class JiraClient:
    """Minimal Jira REST API client."""

    def __init__(self, config: dict = None):
        cfg = config or get_jira_config_full()
        self.base_url = cfg.get("base_url", "").rstrip("/")
        self.project_key = cfg.get("project_key", "QUAL")
        self.label = cfg.get("label", "boxing-test-kai")
        self.username = cfg.get("username", "")
        self.api_token = cfg.get("api_token", "")
        self.default_assignee = cfg.get("default_assignee", "")
        self.assignment_rules = cfg.get("assignment_rules", [])
        self.client = httpx.Client(timeout=60)

    def _auth(self) -> tuple:
        return (self.username, self.api_token)

    def _headers(self) -> dict:
        return {"Content-Type": "application/json", "Accept": "application/json"}

    def test_connection(self) -> dict:
        """Test Jira connection. Returns project info or error."""
        try:
            resp = self.client.get(
                f"{self.base_url}/rest/api/3/project/{self.project_key}",
                auth=self._auth(),
                headers=self._headers(),
            )
            if resp.status_code == 200:
                data = resp.json()
                return {"ok": True, "project": data.get("name", self.project_key)}
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def search_tickets(self, jql: str, max_results: int = 20, fields: list = None) -> list:
        """Search Jira tickets via JQL with automatic pagination.

        Jira Cloud caps at 100 per request. This method paginates to fetch
        up to max_results total issues.
        Raises on HTTP errors so callers can handle failures explicitly.
        """
        if fields is None:
            fields = ["summary", "status", "assignee", "labels"]

        all_issues = []
        start_at = 0
        page_size = min(max_results, 100)  # Jira caps at 100

        while len(all_issues) < max_results:
            resp = self.client.post(
                f"{self.base_url}/rest/api/3/search/jql",
                json={"jql": jql, "maxResults": page_size, "startAt": start_at, "fields": fields},
                auth=self._auth(),
                headers=self._headers(),
            )
            if resp.status_code != 200:
                error_text = resp.text[:300]
                raise ValueError(f"Jira search failed (HTTP {resp.status_code}): {error_text}")

            data = resp.json()
            batch = data.get("issues", [])
            all_issues.extend(batch)
            total = data.get("total", 0)

            start_at += len(batch)
            if not batch or start_at >= total:
                break

        return all_issues[:max_results]

    def search_tickets_safe(self, jql: str, max_results: int = 20, fields: list = None) -> list:
        """Like search_tickets but returns [] on error (for non-critical callers)."""
        try:
            return self.search_tickets(jql, max_results, fields)
        except Exception as e:
            logger.warning(f"Jira search failed: {e}")
            return []

    def get_board_sprints(self, board_id: Union[int, str], state: str = None) -> list:
        """Get sprints for a Jira board (Agile API).

        Args:
            state: Optional filter — 'active', 'closed', or 'future'.
                   None returns all sprints.
        Returns empty list for Kanban boards (which don't support sprints).
        """
        try:
            sprints = []
            start_at = 0
            while True:
                params = {"startAt": start_at, "maxResults": 50}
                if state:
                    params["state"] = state
                resp = self.client.get(
                    f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint",
                    params=params,
                    auth=self._auth(),
                    headers=self._headers(),
                )
                # 400 = board doesn't support sprints (Kanban)
                if resp.status_code == 400:
                    logger.info(f"Board {board_id} does not support sprints (Kanban)")
                    return []
                resp.raise_for_status()
                data = resp.json()
                batch = data.get("values", [])
                sprints.extend(batch)
                if data.get("isLast", True) or not batch:
                    break
                start_at += len(batch)
            return sprints
        except Exception as e:
            logger.warning(f"Failed to get sprints for board {board_id}: {e}")
            return []

    def get_board_config(self, board_id: Union[int, str]) -> dict:
        """Get board configuration (includes project info)."""
        try:
            resp = self.client.get(
                f"{self.base_url}/rest/agile/1.0/board/{board_id}/configuration",
                auth=self._auth(),
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"Failed to get board config for {board_id}: {e}")
            return {}

    def find_duplicates(self, goal: str, error: str = None) -> list:
        """Search for potential duplicate tickets."""
        # Search by label + open status
        jql = f'project = "{self.project_key}" AND labels = "{self.label}" AND status != Done'
        if error:
            # Also search by error text in summary
            safe_err = error[:80].replace('"', '\\"')
            jql += f' AND summary ~ "{safe_err}"'
        issues = self.search_tickets_safe(jql, max_results=10)
        return issues

    def create_ticket(self, summary: str, description: str, priority: str = "Medium",
                      assignee_id: str = None, issue_type: str = "Bug") -> dict:
        """Create a Jira ticket."""
        fields = {
            "project": {"key": self.project_key},
            "summary": summary[:255],
            "description": _text_to_adf(description),
            "issuetype": {"name": issue_type},
            "labels": [self.label],
            "priority": {"name": priority},
        }
        if assignee_id:
            fields["assignee"] = {"accountId": assignee_id}

        try:
            resp = self.client.post(
                f"{self.base_url}/rest/api/3/issue",
                json={"fields": fields},
                auth=self._auth(),
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return {"ok": True, "key": data.get("key", ""), "id": data.get("id", ""), "url": f"{self.base_url}/browse/{data.get('key', '')}"}
        except httpx.HTTPStatusError as e:
            return {"ok": False, "error": f"HTTP {e.response.status_code}: {e.response.text[:300]}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def attach_text_file(self, issue_key: str, filename: str, content: str) -> dict:
        """Attach a text file to a Jira ticket."""
        try:
            resp = self.client.post(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/attachments",
                auth=self._auth(),
                headers={"X-Atlassian-Token": "no-check"},
                files={"file": (filename, content.encode("utf-8"), "text/plain")},
            )
            resp.raise_for_status()
            return {"ok": True}
        except Exception as e:
            logger.warning(f"Failed to attach file to {issue_key}: {e}")
            return {"ok": False, "error": str(e)}

    def add_comment(self, issue_key: str, comment: str) -> dict:
        """Add a comment to an existing ticket."""
        try:
            resp = self.client.post(
                f"{self.base_url}/rest/api/3/issue/{issue_key}/comment",
                json={"body": _text_to_adf(comment)},
                auth=self._auth(),
                headers=self._headers(),
            )
            resp.raise_for_status()
            return {"ok": True, "key": issue_key}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def lookup_assignee(self, query: str) -> Optional[str]:
        """Lookup Jira user accountId by email or display name."""
        if not query:
            return None
        try:
            resp = self.client.get(
                f"{self.base_url}/rest/api/3/user/search",
                params={"query": query, "maxResults": 1},
                auth=self._auth(),
                headers=self._headers(),
            )
            if resp.status_code == 200:
                users = resp.json()
                if users:
                    return users[0].get("accountId")
        except Exception:
            pass
        return None

    def resolve_assignee(self, goal: str, error: str = None) -> Optional[str]:
        """Resolve assignee based on keyword rules, falling back to default."""
        text = f"{goal or ''} {error or ''}".lower()
        for rule in self.assignment_rules:
            keywords = [k.strip().lower() for k in rule.get("keywords", "").split(",")]
            if any(kw and kw in text for kw in keywords):
                assignee_query = rule.get("assignee", "")
                if assignee_query:
                    aid = self.lookup_assignee(assignee_query)
                    if aid:
                        return aid
        # Fallback to default
        if self.default_assignee:
            return self.lookup_assignee(self.default_assignee)
        return None

    def close(self):
        self.client.close()


# ── ADF (Atlassian Document Format) ──────────────────────────────

def _text_to_adf(text: str) -> dict:
    """Convert plain text / wiki markup to Atlassian Document Format (ADF).

    Jira Cloud API v3 requires ADF for description and comments.
    We convert our structured text into ADF paragraphs, headings, tables, and panels.
    Caps total ADF nodes to avoid oversized payloads.
    """
    doc = {"version": 1, "type": "doc", "content": []}
    MAX_NODES = 200  # Cap to avoid huge ADF payloads
    in_panel = False

    for line in text.split("\n"):
        if len(doc["content"]) >= MAX_NODES:
            doc["content"].append({
                "type": "paragraph",
                "content": [{"type": "text", "text": "... (content truncated, see attachment for full details)",
                             "marks": [{"type": "em"}]}],
            })
            break

        stripped = line.strip()
        if not stripped:
            continue

        # Headings: h3. Title
        m = re.match(r'^h(\d)\.\s+(.*)', stripped)
        if m:
            level = int(m.group(1))
            doc["content"].append({
                "type": "heading",
                "attrs": {"level": level},
                "content": [{"type": "text", "text": m.group(2)}],
            })
            continue

        # Table header row: ||Col1||Col2||
        if stripped.startswith("||") and stripped.endswith("||"):
            cells = [c.strip() for c in stripped.strip("|").split("||") if c.strip()]
            row = {
                "type": "tableRow",
                "content": [
                    {"type": "tableHeader", "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": c}]}
                    ]} for c in cells
                ],
            }
            if doc["content"] and doc["content"][-1].get("type") == "table":
                doc["content"][-1]["content"].append(row)
            else:
                doc["content"].append({"type": "table", "content": [row]})
            continue

        # Table data row: |val1|val2|
        if stripped.startswith("|") and stripped.endswith("|") and "||" not in stripped:
            cells = [c.strip() for c in stripped.strip("|").split("|") if c.strip()]
            row = {
                "type": "tableRow",
                "content": [
                    {"type": "tableCell", "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": c}]}
                    ]} for c in cells
                ],
            }
            if doc["content"] and doc["content"][-1].get("type") == "table":
                doc["content"][-1]["content"].append(row)
            else:
                doc["content"].append({"type": "table", "content": [row]})
            continue

        # Panel: {panel:...} or {panel}
        if stripped.startswith("{panel"):
            if stripped == "{panel}":
                in_panel = False
                continue
            # Start panel — extract content after closing }
            inner = re.sub(r'^\{panel[^}]*\}', '', stripped).strip()
            panel_node = {
                "type": "panel",
                "attrs": {"panelType": "warning"},
                "content": [],
            }
            if inner:
                panel_node["content"].append({
                    "type": "paragraph",
                    "content": [{"type": "text", "text": inner}],
                })
            doc["content"].append(panel_node)
            in_panel = True
            continue

        # Append to current panel if inside one
        if in_panel and doc["content"] and doc["content"][-1].get("type") == "panel":
            doc["content"][-1]["content"].append({
                "type": "paragraph",
                "content": _parse_inline_markup(stripped[:500]),
            })
            continue

        # Bullet list: * item
        if stripped.startswith("* "):
            item_text = stripped[2:]
            list_item = {
                "type": "listItem",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": item_text[:500]}]}],
            }
            if doc["content"] and doc["content"][-1].get("type") == "bulletList":
                doc["content"][-1]["content"].append(list_item)
            else:
                doc["content"].append({"type": "bulletList", "content": [list_item]})
            continue

        # Regular paragraph — limit line length to avoid ADF bloat
        content = _parse_inline_markup(stripped[:500])
        doc["content"].append({"type": "paragraph", "content": content})

    # Ensure doc has at least one content node
    if not doc["content"]:
        doc["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "(empty)"}]})

    return doc


def _parse_inline_markup(text: str) -> list:
    """Parse inline bold (*text*) and links [text|url] into ADF text nodes."""
    nodes = []
    i = 0
    while i < len(text):
        # Link: [text|url]
        if text[i] == '[':
            end = text.find(']', i)
            if end > i:
                inner = text[i + 1:end]
                if '|' in inner:
                    link_text, url = inner.split('|', 1)
                    nodes.append({
                        "type": "text",
                        "text": link_text,
                        "marks": [{"type": "link", "attrs": {"href": url}}],
                    })
                else:
                    nodes.append({"type": "text", "text": inner})
                i = end + 1
                continue
        # Bold: *text*
        if text[i] == '*':
            end = text.find('*', i + 1)
            if end > i:
                nodes.append({
                    "type": "text",
                    "text": text[i + 1:end],
                    "marks": [{"type": "strong"}],
                })
                i = end + 1
                continue
        # Regular text — collect until next special char
        start = i
        while i < len(text) and text[i] not in ('[', '*'):
            i += 1
        if i > start:
            nodes.append({"type": "text", "text": text[start:i]})
    return nodes or [{"type": "text", "text": text}]


# ── Ticket Body Builder ──────────────────────────────────────────

def build_ticket_body(session: dict, turn: dict, goal: str = "",
                      eval_data: dict = None, env_name: str = "") -> str:
    """Build comprehensive ticket description in wiki markup format."""
    session_id = session.get("id", "")
    turn_num = turn.get("turn_number", 0)
    session_url = f"{SERVER_BASE}/sessions/{session_id}"
    match_id = session.get("match_id")
    match_url = f"{SERVER_BASE}/matches/{match_id}" if match_id else ""

    lines = []

    # Config section
    lines.append("h3. Test Configuration")
    lines.append("||Field||Value||")
    lines.append(f"|Mode|{session.get('actor_mode', '-')}|")
    lines.append(f"|Goal|{goal or session.get('goal', '-')}|")
    lines.append(f"|Environment|{env_name or session.get('env_key', '-')}|")
    lines.append(f"|Judge Model|{session.get('eval_model', '-')}|")
    lines.append(f"|Round|{turn_num} of {session.get('max_turns', '-')}|")
    lines.append("")

    # Metrics section
    lines.append("h3. Round Metrics")
    lines.append("||Metric||Value||")
    lines.append(f"|TTFT|{_fmt_ms(turn.get('ttfb_ms'))}|")
    lines.append(f"|Total Response Time|{_fmt_ms(turn.get('total_ms'))}|")
    lines.append(f"|Poll Count|{turn.get('poll_count', 0)}|")
    lines.append(f"|Status|{turn.get('status', '-')}|")
    tools = turn.get("tool_calls", [])
    if isinstance(tools, list) and tools:
        lines.append(f"|Tools Used|{', '.join(str(t) for t in tools)}|")
    lines.append("")

    # Quality scores
    scores = {}
    for dim in ("eval_relevance", "eval_accuracy", "eval_helpfulness", "eval_tool_usage", "eval_latency"):
        val = turn.get(dim)
        if val is not None:
            label = dim.replace("eval_", "").replace("_", " ").title()
            scores[label] = val
    if scores:
        lines.append("h3. Quality Scores")
        lines.append("||Dimension||Score||")
        for label, val in scores.items():
            lines.append(f"|{label}|{val}/5|")
        lines.append("")

    # Session-level eval
    if eval_data:
        lines.append("h3. Session Evaluation")
        lines.append("||Dimension||Score||")
        for dim in ("goal_achievement", "context_retention", "error_handling", "response_quality"):
            val = eval_data.get(dim)
            if val is not None:
                label = dim.replace("_", " ").title()
                lines.append(f"|{label}|{val}/5|")
        overall = eval_data.get("overall_score")
        if overall is not None:
            lines.append(f"|*Overall*|*{overall}/5*|")
        lines.append("")

    # Conversation transcript
    lines.append("h3. Conversation Transcript")
    lines.append(f"*User (Round {turn_num}):*")
    user_msg = turn.get("user_message", "")
    lines.append(user_msg[:2000])
    lines.append("")

    response = turn.get("assistant_response", "")
    if response:
        lines.append(f"*Kai (Round {turn_num}):*")
        lines.append(response[:3000])
        lines.append("")
    elif turn.get("error"):
        lines.append(f"*Error:* {turn.get('error')}")
        lines.append("")

    # Reference links
    lines.append("h3. Reference")
    lines.append(f"[Session Detail|{session_url}]")
    if match_url:
        lines.append(f"[Match Report|{match_url}]")

    return "\n".join(lines)


def build_ticket_summary(turn: dict, goal: str = "") -> str:
    """Generate a concise ticket summary."""
    error = turn.get("error")
    status = turn.get("status", "")

    if error:
        # Error-based summary
        err_short = error[:80].replace("\n", " ")
        return f"[KAI-BUG] Error: {err_short}"

    # Quality-based summary
    scores = []
    for dim in ("eval_relevance", "eval_accuracy", "eval_helpfulness"):
        val = turn.get(dim)
        if val is not None:
            scores.append(val)

    if scores:
        avg = sum(scores) / len(scores)
        if avg < 3:
            goal_short = (goal or "unknown goal")[:60]
            return f"[KAI-BUG] Low quality ({avg:.1f}/5) on \"{goal_short}\""

    if status == "error":
        return f"[KAI-BUG] Kai returned error status on round"

    goal_short = (goal or "test round")[:80]
    return f"[KAI-BUG] Issue on \"{goal_short}\""


def determine_priority(turn: dict) -> str:
    """Determine Jira priority from round metrics."""
    error = turn.get("error")
    if error:
        return "High"

    scores = []
    for dim in ("eval_relevance", "eval_accuracy", "eval_helpfulness"):
        val = turn.get(dim)
        if val is not None:
            scores.append(val)

    if scores:
        avg = sum(scores) / len(scores)
        if avg < 2:
            return "Critical"
        if avg < 3:
            return "High"
        if avg < 4:
            return "Medium"
    return "Medium"


def _fmt_ms(ms) -> str:
    if not ms or ms <= 0:
        return "-"
    if ms < 1000:
        return f"{int(ms)}ms"
    if ms < 60000:
        s = int(ms / 1000)
        rem = int(ms % 1000)
        return f"{s}s {rem}ms" if rem else f"{s}s"
    m = int(ms / 60000)
    s = int((ms % 60000) / 1000)
    return f"{m}m {s}s" if s else f"{m}m"


# ── High-Level Operations ────────────────────────────────────────

def log_bug_for_round(session_id: str, turn_number: int,
                      force: bool = False) -> dict:
    """Log a Jira bug for a specific round. Handles dedup.

    Args:
        session_id: Session ID
        turn_number: Round number
        force: If True, skip duplicate check and always create

    Returns: {action: "created"|"updated"|"skipped", ticket_key, url}
    """
    import database as db

    session = db.get_session(session_id)
    if not session:
        return {"ok": False, "error": "Session not found"}

    turn = db.get_turns(session_id, turn_number)
    if not turn:
        return {"ok": False, "error": f"Round {turn_number} not found"}

    # Get evaluation data if available
    eval_data = db.get_evaluation(session_id)
    goal = session.get("goal", "")
    env_name = session.get("env_key", "")

    config = get_jira_config_full()
    if not config.get("api_token"):
        return {"ok": False, "error": "Jira API token not configured"}

    client = JiraClient(config)

    try:
        summary = build_ticket_summary(turn, goal)
        body = build_ticket_body(session, turn, goal, eval_data, env_name)
        priority = determine_priority(turn)

        # Check for existing ticket for this exact round
        existing = _get_ticket_for_round(session_id, turn_number)
        if existing and not force:
            # Update existing ticket with a comment
            comment = f"Re-run detected for session {session_id}, round {turn_number}.\n\n{body}"
            result = client.add_comment(existing["ticket_key"], comment)
            _update_ticket_record(session_id, turn_number, existing["ticket_key"])
            return {
                "ok": True,
                "action": "updated",
                "ticket_key": existing["ticket_key"],
                "url": f"{config['base_url']}/browse/{existing['ticket_key']}",
            }

        # Check for duplicate by goal/error pattern
        if not force:
            dupes = client.find_duplicates(goal, turn.get("error"))
            if dupes:
                # Add comment to first matching ticket
                dupe_key = dupes[0]["key"]
                comment = f"Similar issue found in session {session_id}, round {turn_number}.\n\n{body}"
                result = client.add_comment(dupe_key, comment)
                _save_ticket_record(session_id, turn_number, dupe_key, goal, turn.get("error"))
                return {
                    "ok": True,
                    "action": "updated_duplicate",
                    "ticket_key": dupe_key,
                    "url": f"{config['base_url']}/browse/{dupe_key}",
                }

        # Create new ticket
        assignee_id = client.resolve_assignee(goal, turn.get("error"))
        result = client.create_ticket(summary, body, priority, assignee_id)

        if result.get("ok"):
            _save_ticket_record(session_id, turn_number, result["key"], goal, turn.get("error"))
            return {
                "ok": True,
                "action": "created",
                "ticket_key": result["key"],
                "url": result["url"],
            }
        return result

    finally:
        client.close()


def log_bug_for_session(session_id: str, force: bool = False) -> dict:
    """Log a Jira bug for an entire session (round/conversation).

    Creates one ticket covering all exchanges in the session.
    """
    import database as db

    session = db.get_session(session_id)
    if not session:
        return {"ok": False, "error": "Session not found"}

    turns = db.get_turns(session_id)
    if not turns:
        return {"ok": False, "error": "No exchanges found in this session"}

    eval_data = db.get_evaluation(session_id)
    goal = session.get("goal", "")
    env_name = session.get("env_key", "")

    config = get_jira_config_full()
    if not config.get("api_token"):
        return {"ok": False, "error": "Jira API token not configured"}

    client = JiraClient(config)

    try:
        # Use turn_number=0 as sentinel for session-level tickets
        existing = _get_ticket_for_round(session_id, 0)
        if existing and not force:
            body = _build_session_ticket_body(session, turns, goal, eval_data, env_name)
            comment = f"Session re-evaluated.\n\n{body}"
            client.add_comment(existing["ticket_key"], comment)
            _update_ticket_record(session_id, 0, existing["ticket_key"])
            return {
                "ok": True,
                "action": "updated",
                "ticket_key": existing["ticket_key"],
                "url": f"{config['base_url']}/browse/{existing['ticket_key']}",
            }

        # Check for duplicate by goal
        if not force:
            dupes = client.find_duplicates(goal, None)
            if dupes:
                dupe_key = dupes[0]["key"]
                body = _build_session_ticket_body(session, turns, goal, eval_data, env_name)
                comment = f"Similar issue in session {session_id}.\n\n{body}"
                client.add_comment(dupe_key, comment)
                _save_ticket_record(session_id, 0, dupe_key, goal, None)
                return {
                    "ok": True,
                    "action": "updated_duplicate",
                    "ticket_key": dupe_key,
                    "url": f"{config['base_url']}/browse/{dupe_key}",
                }

        summary = _build_session_summary(session, turns, goal, eval_data)
        full_body = _build_session_ticket_body(session, turns, goal, eval_data, env_name)
        priority = _determine_session_priority(turns, eval_data)
        assignee_id = client.resolve_assignee(goal, None)

        # Jira description limit ~32KB. If body is too long, truncate and attach full transcript.
        MAX_DESC_LEN = 25000
        attach_transcript = len(full_body) > MAX_DESC_LEN
        if attach_transcript:
            # Use truncated body for description, note about attachment
            body = _build_session_ticket_body_truncated(session, turns, goal, eval_data, env_name)
        else:
            body = full_body

        result = client.create_ticket(summary, body, priority, assignee_id)

        if result.get("ok"):
            ticket_key = result["key"]
            # Attach full transcript if it was too long
            if attach_transcript:
                transcript = _build_full_transcript_text(session, turns, goal, eval_data)
                client.attach_text_file(ticket_key, f"transcript_{session_id}.txt", transcript)

            _save_ticket_record(session_id, 0, ticket_key, goal, None)
            return {
                "ok": True,
                "action": "created",
                "ticket_key": ticket_key,
                "url": result["url"],
            }
        return result

    finally:
        client.close()


def _is_internal_error(session: dict) -> bool:
    """Check if the session's stop_reason indicates a Test Kai internal error (not a Kai agent bug)."""
    stop = (session.get("stop_reason") or "").lower()
    internal_patterns = [
        "error binding parameter",
        "sqlite", "database", "type 'dict'",
        "attributeerror", "typeerror", "keyerror",
        "cannot reach login service",
        "admin login failed",
    ]
    return any(p in stop for p in internal_patterns)


def _build_session_summary(session: dict, turns: list, goal: str, eval_data: dict = None) -> str:
    """Generate summary for a session-level ticket."""
    # Distinguish internal Test Kai errors from Kai agent bugs
    prefix = "[TESTKAI-BUG]" if _is_internal_error(session) else "[KAI-BUG]"

    overall = eval_data.get("overall_score") if eval_data else None
    error_turns = [t for t in turns if t.get("error") or t.get("status") == "error"]
    total = len(turns)

    if _is_internal_error(session):
        stop = (session.get("stop_reason") or "unknown")[:80]
        return f"{prefix} Internal error: {stop}"
    if error_turns:
        return f"{prefix} {len(error_turns)}/{total} exchanges errored — \"{(goal or 'test session')[:60]}\""
    if overall is not None and overall < 3:
        return f"{prefix} Low quality ({overall}/5) — \"{(goal or 'test session')[:60]}\""
    return f"{prefix} Issue in session — \"{(goal or 'test session')[:60]}\""


def _build_session_ticket_body(session: dict, turns: list, goal: str = "",
                                eval_data: dict = None, env_name: str = "") -> str:
    """Build ticket body for a session (all exchanges)."""
    session_id = session.get("id", "")
    session_url = f"{SERVER_BASE}/sessions/{session_id}"
    match_id = session.get("match_id")
    match_url = f"{SERVER_BASE}/matches/{match_id}" if match_id else ""

    lines = []

    # Internal error banner
    if _is_internal_error(session):
        lines.append("{color:red}*This is an internal Test Kai error, not a Kai agent bug.*{color}")
        lines.append(f"Stop reason: {session.get('stop_reason', '')[:300]}")
        lines.append("")

    # Config
    lines.append("h3. Test Configuration")
    lines.append("||Field||Value||")
    lines.append(f"|Mode|{session.get('actor_mode', '-')}|")
    lines.append(f"|Goal|{goal or session.get('goal', '-')}|")
    lines.append(f"|Environment|{env_name or session.get('env_key', '-')}|")
    lines.append(f"|Judge Model|{session.get('eval_model', '-')}|")
    lines.append(f"|Total Exchanges|{len(turns)}|")
    stop_reason = session.get("stop_reason", "")
    if stop_reason and stop_reason != "completed":
        lines.append(f"|Stop Reason|{stop_reason[:200]}|")
    lines.append("")

    # Session eval
    if eval_data:
        lines.append("h3. Session Evaluation")
        lines.append("||Dimension||Score||")
        for dim in ("goal_achievement", "context_retention", "error_handling", "response_quality"):
            val = eval_data.get(dim)
            if val is not None:
                label = dim.replace("_", " ").title()
                lines.append(f"|{label}|{val}/5|")
        overall = eval_data.get("overall_score")
        if overall is not None:
            lines.append(f"|*Overall*|*{overall}/5*|")
        summary_text = eval_data.get("summary")
        if summary_text:
            lines.append("")
            lines.append(f"_{summary_text}_")
        lines.append("")

    # Per-exchange summary table
    lines.append("h3. Exchange Summary")
    lines.append("||#||Status||TTFT||Total||Rel||Acc||Help||Error||")
    for t in turns:
        err_short = (t.get("error") or "-")[:40].replace("|", "/")
        lines.append(
            f"|{t.get('turn_number', '?')}"
            f"|{t.get('status', '-')}"
            f"|{_fmt_ms(t.get('ttfb_ms'))}"
            f"|{_fmt_ms(t.get('total_ms'))}"
            f"|{t.get('eval_relevance', '-')}"
            f"|{t.get('eval_accuracy', '-')}"
            f"|{t.get('eval_helpfulness', '-')}"
            f"|{err_short}|"
        )
    lines.append("")

    # Full conversation transcript
    lines.append("h3. Conversation Transcript")
    for t in turns:
        turn_num = t.get("turn_number", "?")
        lines.append(f"*User (Exchange {turn_num}):*")
        lines.append((t.get("user_message") or "")[:1000])
        lines.append("")
        response = t.get("assistant_response", "")
        if response:
            lines.append(f"*Kai (Exchange {turn_num}):*")
            lines.append(response[:1500])
            lines.append("")
        elif t.get("error"):
            lines.append(f"*Error (Exchange {turn_num}):* {t.get('error')}")
            lines.append("")

    # Issues from eval
    if eval_data and eval_data.get("issues"):
        issues = eval_data["issues"]
        if isinstance(issues, str):
            try:
                issues = json.loads(issues)
            except Exception:
                issues = [issues]
        if issues:
            lines.append("h3. Issues Found")
            for issue in issues:
                lines.append(f"* {issue}")
            lines.append("")

    # Reference
    lines.append("h3. Reference")
    lines.append(f"[Session Detail|{session_url}]")
    if match_url:
        lines.append(f"[Match Report|{match_url}]")

    return "\n".join(lines)


def _build_session_ticket_body_truncated(session: dict, turns: list, goal: str = "",
                                         eval_data: dict = None, env_name: str = "") -> str:
    """Build a truncated ticket body — config + scores + exchange table. Full transcript is attached."""
    session_id = session.get("id", "")
    session_url = f"{SERVER_BASE}/sessions/{session_id}"
    match_id = session.get("match_id")
    match_url = f"{SERVER_BASE}/matches/{match_id}" if match_id else ""

    lines = []

    lines.append("{panel:bgColor=#fffde7}")
    lines.append("*Note:* Full conversation transcript attached as a .txt file (content too large for description).")
    lines.append("{panel}")
    lines.append("")

    # Config
    lines.append("h3. Test Configuration")
    lines.append("||Field||Value||")
    lines.append(f"|Mode|{session.get('actor_mode', '-')}|")
    lines.append(f"|Goal|{goal or session.get('goal', '-')}|")
    lines.append(f"|Environment|{env_name or session.get('env_key', '-')}|")
    lines.append(f"|Judge Model|{session.get('eval_model', '-')}|")
    lines.append(f"|Total Exchanges|{len(turns)}|")
    lines.append("")

    # Session eval
    if eval_data:
        lines.append("h3. Session Evaluation")
        lines.append("||Dimension||Score||")
        for dim in ("goal_achievement", "context_retention", "error_handling", "response_quality"):
            val = eval_data.get(dim)
            if val is not None:
                label = dim.replace("_", " ").title()
                lines.append(f"|{label}|{val}/5|")
        overall = eval_data.get("overall_score")
        if overall is not None:
            lines.append(f"|*Overall*|*{overall}/5*|")
        summary_text = eval_data.get("summary")
        if summary_text:
            lines.append("")
            lines.append(f"_{summary_text}_")
        lines.append("")

    # Per-exchange summary table
    lines.append("h3. Exchange Summary")
    lines.append("||#||Status||TTFT||Total||Rel||Acc||Help||Error||")
    for t in turns:
        err_short = (t.get("error") or "-")[:40].replace("|", "/")
        lines.append(
            f"|{t.get('turn_number', '?')}"
            f"|{t.get('status', '-')}"
            f"|{_fmt_ms(t.get('ttfb_ms'))}"
            f"|{_fmt_ms(t.get('total_ms'))}"
            f"|{t.get('eval_relevance', '-')}"
            f"|{t.get('eval_accuracy', '-')}"
            f"|{t.get('eval_helpfulness', '-')}"
            f"|{err_short}|"
        )
    lines.append("")

    # Issues from eval
    if eval_data and eval_data.get("issues"):
        issues = eval_data["issues"]
        if isinstance(issues, str):
            try:
                issues = json.loads(issues)
            except Exception:
                issues = [issues]
        if issues:
            lines.append("h3. Issues Found")
            for issue in issues:
                lines.append(f"* {issue}")
            lines.append("")

    # Reference
    lines.append("h3. Reference")
    lines.append(f"[Session Detail|{session_url}]")
    if match_url:
        lines.append(f"[Match Report|{match_url}]")

    return "\n".join(lines)


def _build_full_transcript_text(session: dict, turns: list, goal: str = "",
                                eval_data: dict = None) -> str:
    """Build a plain-text transcript file for attachment."""
    lines = []
    session_id = session.get("id", "")
    lines.append(f"KAI TEST TRANSCRIPT — Session {session_id}")
    lines.append(f"Goal: {goal or session.get('goal', '-')}")
    lines.append(f"Mode: {session.get('actor_mode', '-')}")
    lines.append(f"Exchanges: {len(turns)}")
    lines.append("=" * 60)
    lines.append("")

    for t in turns:
        turn_num = t.get("turn_number", "?")
        lines.append(f"--- Exchange {turn_num} ---")
        lines.append(f"Status: {t.get('status', '-')} | TTFT: {_fmt_ms(t.get('ttfb_ms'))} | Total: {_fmt_ms(t.get('total_ms'))}")
        scores_parts = []
        for dim in ("eval_relevance", "eval_accuracy", "eval_helpfulness", "eval_tool_usage", "eval_latency"):
            val = t.get(dim)
            if val is not None:
                scores_parts.append(f"{dim.replace('eval_', '').title()}={val}/5")
        if scores_parts:
            lines.append(f"Scores: {', '.join(scores_parts)}")
        if t.get("error"):
            lines.append(f"Error: {t['error']}")
        lines.append("")

        lines.append(f"[User]")
        lines.append(t.get("user_message", "(empty)"))
        lines.append("")

        response = t.get("assistant_response", "")
        if response:
            lines.append(f"[Kai]")
            lines.append(response)
            lines.append("")
        lines.append("")

    if eval_data:
        lines.append("=" * 60)
        lines.append("SESSION EVALUATION")
        for dim in ("goal_achievement", "context_retention", "error_handling", "response_quality", "overall_score"):
            val = eval_data.get(dim)
            if val is not None:
                lines.append(f"  {dim.replace('_', ' ').title()}: {val}/5")
        if eval_data.get("summary"):
            lines.append(f"\nSummary: {eval_data['summary']}")
        issues = eval_data.get("issues", [])
        if isinstance(issues, str):
            try:
                issues = json.loads(issues)
            except Exception:
                issues = [issues]
        if issues:
            lines.append("\nIssues:")
            for issue in issues:
                lines.append(f"  - {issue}")

    return "\n".join(lines)


def _determine_session_priority(turns: list, eval_data: dict = None) -> str:
    """Determine priority for session-level ticket."""
    error_turns = [t for t in turns if t.get("error") or t.get("status") == "error"]
    error_ratio = len(error_turns) / max(len(turns), 1)

    if error_ratio > 0.5:
        return "Critical"
    if error_ratio > 0:
        return "High"

    overall = eval_data.get("overall_score") if eval_data else None
    if overall is not None:
        if overall < 2:
            return "Critical"
        if overall < 3:
            return "High"
    return "Medium"


def should_auto_log(turn: dict, config: dict = None) -> bool:
    """Check if a round should trigger automatic Jira bug logging."""
    cfg = config or get_jira_config_full()
    if not cfg.get("auto_enabled"):
        return False

    # Check error status
    if cfg.get("auto_on_error") and turn.get("status") == "error":
        return True
    if cfg.get("auto_on_error") and turn.get("error"):
        return True

    # Check quality threshold
    threshold = cfg.get("auto_quality_threshold", 3.0)
    scores = []
    for dim in ("eval_relevance", "eval_accuracy", "eval_helpfulness"):
        val = turn.get(dim)
        if val is not None:
            scores.append(val)
    if scores and (sum(scores) / len(scores)) < threshold:
        return True

    # Check latency grade
    grade_threshold = cfg.get("auto_latency_grade", "D")
    latency_score = turn.get("eval_latency")
    if latency_score is not None:
        grade_map = {5: "A", 4: "B", 3: "C", 2: "D", 1: "F"}
        threshold_map = {"A": 5, "B": 4, "C": 3, "D": 2, "F": 1}
        if latency_score <= threshold_map.get(grade_threshold, 2):
            return True

    return False


def get_tickets_for_session(session_id: str) -> list:
    """Get all Jira tickets linked to a session."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM jira_tickets WHERE session_id = ? ORDER BY turn_number",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_jira_filter_url() -> str:
    """Return URL to a JQL filter showing all boxing-test-kai tickets."""
    cfg = get_jira_config_full()
    base = cfg.get("base_url", "https://katalon.atlassian.net").rstrip("/")
    label = cfg.get("label", "boxing-test-kai")
    project = cfg.get("project_key", "QUAL")
    jql = f'project = "{project}" AND labels = "{label}" ORDER BY created DESC'
    from urllib.parse import quote
    return f"{base}/issues/?jql={quote(jql)}"


# ── Internal helpers ─────────────────────────────────────────────

def _save_ticket_record(session_id: str, turn_number: int,
                        ticket_key: str, goal: str, error: str = None):
    with _get_conn() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO jira_tickets
            (ticket_key, session_id, turn_number, goal, error_pattern, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        """, (ticket_key, session_id, turn_number, goal, error))


def _update_ticket_record(session_id: str, turn_number: int, ticket_key: str):
    with _get_conn() as conn:
        conn.execute(
            "UPDATE jira_tickets SET updated_at = datetime('now') WHERE session_id = ? AND turn_number = ?",
            (session_id, turn_number),
        )


def _get_ticket_for_round(session_id: str, turn_number: int) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM jira_tickets WHERE session_id = ? AND turn_number = ?",
            (session_id, turn_number),
        ).fetchone()
        return dict(row) if row else None
