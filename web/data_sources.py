"""Data Sources — CRUD, sync engine, and change detection for Jira, Confluence, MCP tools, and free-text context.

Data sources are per-environment. Each source syncs its content into data_source_items
for downstream consumption by the test generator.
"""
import hashlib
import json
import logging
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(_data_dir, "kai_tests.db")


@contextmanager
def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── DB Init ──────────────────────────────────────────────────────

def init_data_sources_db():
    """Create data_sources and data_source_items tables."""
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS data_sources (
                id TEXT PRIMARY KEY,
                env_key TEXT NOT NULL,
                source_type TEXT NOT NULL,
                name TEXT NOT NULL,
                config TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER DEFAULT 1,
                last_synced_at TEXT,
                sync_status TEXT DEFAULT 'never',
                sync_error TEXT,
                item_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS data_source_items (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
                external_id TEXT,
                external_url TEXT,
                title TEXT NOT NULL,
                content TEXT,
                item_type TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                content_hash TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_ds_items_source ON data_source_items(source_id);
            CREATE INDEX IF NOT EXISTS idx_ds_env ON data_sources(env_key);
        """)


# Shared source types (cross-environment) vs per-environment
SHARED_SOURCE_TYPES = {"jira", "confluence"}
PER_ENV_SOURCE_TYPES = {"mcp_tools", "context"}
SHARED_ENV_KEY = "_shared"


def is_shared_type(source_type: str) -> bool:
    return source_type in SHARED_SOURCE_TYPES


# ── CRUD: Data Sources ───────────────────────────────────────────

def create_data_source(env_key: str, source_type: str, name: str, config: dict) -> dict:
    source_id = str(uuid.uuid4())[:8]
    # Jira/Confluence are shared across environments
    actual_env_key = SHARED_ENV_KEY if is_shared_type(source_type) else env_key
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO data_sources (id, env_key, source_type, name, config)
               VALUES (?, ?, ?, ?, ?)""",
            (source_id, actual_env_key, source_type, name, json.dumps(config)),
        )
    return get_data_source(source_id)


def get_data_source(source_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM data_sources WHERE id = ?", (source_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["config"] = json.loads(d.get("config") or "{}")
        d["enabled"] = bool(d.get("enabled", 1))
        d["shared"] = d["env_key"] == SHARED_ENV_KEY
        return d


def list_data_sources(env_key: str = None) -> list:
    """List data sources. When env_key is given, returns both env-specific AND shared sources."""
    with _get_conn() as conn:
        if env_key:
            # Return shared (Jira/Confluence) + env-specific (MCP/Context)
            rows = conn.execute(
                "SELECT * FROM data_sources WHERE env_key = ? OR env_key = ? ORDER BY env_key, created_at DESC",
                (env_key, SHARED_ENV_KEY),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM data_sources ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["config"] = json.loads(d.get("config") or "{}")
            d["enabled"] = bool(d.get("enabled", 1))
            d["shared"] = d["env_key"] == SHARED_ENV_KEY
            result.append(d)
        return result


def update_data_source(source_id: str, **kwargs) -> Optional[dict]:
    allowed = {"name", "config", "enabled", "source_type"}
    fields = {}
    for k, v in kwargs.items():
        if k in allowed:
            if k == "config" and isinstance(v, dict):
                v = json.dumps(v)
            if k == "enabled":
                v = 1 if v else 0
            fields[k] = v
    if not fields:
        return get_data_source(source_id)
    fields["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [source_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE data_sources SET {sets} WHERE id = ?", vals)
    return get_data_source(source_id)


def delete_data_source(source_id: str) -> bool:
    with _get_conn() as conn:
        # Items deleted via CASCADE
        result = conn.execute("DELETE FROM data_sources WHERE id = ?", (source_id,))
        return result.rowcount > 0


def _update_sync_status(source_id: str, status: str, error: str = None, item_count: int = None):
    with _get_conn() as conn:
        fields = {
            "sync_status": status,
            "sync_error": error,
            "updated_at": datetime.utcnow().isoformat(),
        }
        if status == "synced":
            fields["last_synced_at"] = datetime.utcnow().isoformat()
        if item_count is not None:
            fields["item_count"] = item_count
        sets = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [source_id]
        conn.execute(f"UPDATE data_sources SET {sets} WHERE id = ?", vals)


# ── CRUD: Data Source Items ──────────────────────────────────────

def get_items_for_source(source_id: str) -> list:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM data_source_items WHERE source_id = ? ORDER BY title",
            (source_id,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["metadata"] = json.loads(d.get("metadata") or "{}")
            result.append(d)
        return result


def get_items_for_env(env_key: str, source_ids: list = None) -> list:
    """Get all items for an environment (env-specific + shared), optionally filtered by source IDs."""
    with _get_conn() as conn:
        if source_ids:
            placeholders = ",".join("?" for _ in source_ids)
            rows = conn.execute(
                f"""SELECT i.* FROM data_source_items i
                    JOIN data_sources s ON s.id = i.source_id
                    WHERE (s.env_key = ? OR s.env_key = ?) AND i.source_id IN ({placeholders})
                    ORDER BY i.item_type, i.title""",
                [env_key, SHARED_ENV_KEY] + source_ids,
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT i.* FROM data_source_items i
                   JOIN data_sources s ON s.id = i.source_id
                   WHERE s.env_key = ? OR s.env_key = ?
                   ORDER BY i.item_type, i.title""",
                (env_key, SHARED_ENV_KEY),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["metadata"] = json.loads(d.get("metadata") or "{}")
            result.append(d)
        return result


def _upsert_item(conn, source_id: str, external_id: str, title: str, content: str,
                 item_type: str, external_url: str = None, metadata: dict = None) -> str:
    """Upsert an item. Returns item ID. Skips update if content hash unchanged."""
    content_hash = _compute_hash(title, content)
    existing = conn.execute(
        "SELECT id, content_hash FROM data_source_items WHERE source_id = ? AND external_id = ?",
        (source_id, external_id),
    ).fetchone()

    if existing:
        if existing["content_hash"] == content_hash:
            return existing["id"]  # No change
        conn.execute(
            """UPDATE data_source_items
               SET title=?, content=?, item_type=?, external_url=?, metadata=?,
                   content_hash=?, updated_at=datetime('now')
               WHERE id=?""",
            (title, content, item_type, external_url,
             json.dumps(metadata or {}), content_hash, existing["id"]),
        )
        return existing["id"]
    else:
        item_id = str(uuid.uuid4())[:8]
        conn.execute(
            """INSERT INTO data_source_items
               (id, source_id, external_id, external_url, title, content, item_type, metadata, content_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (item_id, source_id, external_id, external_url, title, content,
             item_type, json.dumps(metadata or {}), content_hash),
        )
        return item_id


def _compute_hash(title: str, content: str) -> str:
    """Hash title + content for change detection."""
    raw = f"{title or ''}|{content or ''}"
    return hashlib.md5(raw.encode()).hexdigest()


def _remove_stale_items(conn, source_id: str, current_external_ids: set):
    """Remove items that no longer exist in the source."""
    rows = conn.execute(
        "SELECT id, external_id FROM data_source_items WHERE source_id = ?",
        (source_id,),
    ).fetchall()
    for row in rows:
        if row["external_id"] not in current_external_ids:
            conn.execute("DELETE FROM data_source_items WHERE id = ?", (row["id"],))


# ── Sync Engine ──────────────────────────────────────────────────

def sync_source(source_id: str) -> dict:
    """Sync a single data source. Returns {status, items_count, changes}."""
    source = get_data_source(source_id)
    if not source:
        return {"status": "error", "error": "Source not found"}

    _update_sync_status(source_id, "syncing")

    try:
        source_type = source["source_type"]
        config = source["config"]

        env_key = source["env_key"]

        if source_type == "jira":
            result = _sync_jira(source_id, config)
        elif source_type == "confluence":
            result = _sync_confluence(source_id, config)
        elif source_type == "mcp_tools":
            result = _sync_mcp_tools(source_id, config, env_key)
        elif source_type == "context":
            result = _sync_context(source_id, config)
        else:
            raise ValueError(f"Unknown source type: {source_type}")

        _update_sync_status(source_id, "synced", item_count=result.get("items_count", 0))
        return {"status": "synced", **result}

    except Exception as e:
        logger.exception(f"Failed to sync source {source_id}: {e}")
        _update_sync_status(source_id, "error", error=str(e))
        return {"status": "error", "error": str(e)}


def sync_all_sources(env_key: str) -> list:
    """Sync all enabled sources for an environment (includes shared Jira/Confluence)."""
    sources = list_data_sources(env_key)  # Already includes shared sources
    results = []
    for src in sources:
        if src["enabled"]:
            r = sync_source(src["id"])
            results.append({"source_id": src["id"], "name": src["name"], **r})
    return results


# ── Jira Sync ────────────────────────────────────────────────────

def _sync_jira(source_id: str, config: dict) -> dict:
    """Fetch Jira issues and store as items.

    Auth priority:
    1. Data source config (username + api_token)
    2. Bug Settings (jira_config table)
    3. .env JIRA_USERNAME / JIRA_TOKEN
    """
    from jira_integration import get_jira_config_full, JiraClient

    jira_cfg = get_jira_config_full()

    # Override with data-source-level credentials if provided
    ds_username = config.get("username", "").strip()
    ds_token = config.get("api_token", "").strip()
    if ds_username and ds_token:
        jira_cfg = {**jira_cfg, "username": ds_username, "api_token": ds_token}
        if config.get("base_url"):
            jira_cfg["base_url"] = config["base_url"]

    client = JiraClient(jira_cfg)

    project_key = config.get("project_key") or jira_cfg.get("project_key", "QUAL")
    epic_keys = config.get("epic_keys", [])
    jql_filter = config.get("jql_filter", "")
    include_subtasks = config.get("include_subtasks", True)

    # Build JQL
    if jql_filter:
        jql = jql_filter
    elif epic_keys:
        epic_list = ",".join(f'"{k}"' for k in epic_keys)
        jql = f"project = {project_key} AND 'Epic Link' IN ({epic_list})"
        if not include_subtasks:
            jql += " AND issuetype NOT IN (Sub-task)"
    else:
        jql = f"project = {project_key} AND issuetype IN (Epic, Story, Task, Bug) ORDER BY created DESC"

    # Fetch issues via JiraClient
    issues = client.search_tickets(jql, max_results=200)

    current_ids = set()
    with _get_conn() as conn:
        for issue in issues:
            key = issue.get("key", "")
            fields = issue.get("fields", {})
            summary = fields.get("summary", "")
            status = fields.get("status", {}).get("name", "")
            issue_type = fields.get("issuetype", {}).get("name", "").lower()
            labels = fields.get("labels", [])
            description_text = _extract_jira_description(fields.get("description"))

            content = f"Status: {status}\n{description_text}" if description_text else f"Status: {status}"
            item_type = _map_jira_issue_type(issue_type)
            external_url = f"{client.base_url}/browse/{key}"

            _upsert_item(
                conn, source_id, external_id=key, title=f"[{key}] {summary}",
                content=content, item_type=item_type, external_url=external_url,
                metadata={"status": status, "labels": labels, "issue_type": issue_type},
            )
            current_ids.add(key)

        _remove_stale_items(conn, source_id, current_ids)
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM data_source_items WHERE source_id = ?", (source_id,)
        ).fetchone()["cnt"]

    return {"items_count": count, "fetched": len(issues)}


def _extract_jira_description(desc) -> str:
    """Extract text from Jira ADF description or plain text."""
    if not desc:
        return ""
    if isinstance(desc, str):
        return desc
    # ADF format — extract text content recursively
    texts = []
    _extract_adf_text(desc, texts)
    return "\n".join(texts)


def _extract_adf_text(node: dict, texts: list):
    """Recursively extract text from Atlassian Document Format."""
    if not isinstance(node, dict):
        return
    if node.get("type") == "text":
        texts.append(node.get("text", ""))
    for child in node.get("content", []):
        _extract_adf_text(child, texts)


def _map_jira_issue_type(issue_type: str) -> str:
    mapping = {"epic": "epic", "story": "story", "bug": "bug", "task": "story", "sub-task": "story"}
    return mapping.get(issue_type, "story")


# ── Confluence Sync ──────────────────────────────────────────────

def _sync_confluence(source_id: str, config: dict) -> dict:
    """Fetch Confluence pages and store as items.

    Auth priority:
    1. Data source config (username + api_token)
    2. Bug Settings (jira_config table)
    3. .env JIRA_USERNAME / JIRA_TOKEN
    """
    from jira_integration import get_jira_config_full

    jira_cfg = get_jira_config_full()

    # Override with data-source-level credentials if provided
    ds_username = config.get("username", "").strip()
    ds_token = config.get("api_token", "").strip()
    base_url = (config.get("base_url", "") or jira_cfg.get("base_url", "")).rstrip("/")
    username = ds_username or jira_cfg.get("username", "")
    api_token = ds_token or jira_cfg.get("api_token", "")

    if not base_url or not username or not api_token:
        raise ValueError("Confluence sync requires Atlassian credentials — set in Bug Settings or on this data source")

    # Confluence REST API uses same Atlassian cloud auth
    confluence_base = base_url.replace("/rest/api", "").rstrip("/")
    if "/wiki" not in confluence_base:
        confluence_base += "/wiki"

    space_key = config.get("space_key", "")
    page_ids = config.get("page_ids", [])
    include_children = config.get("include_children", False)

    pages = []
    with httpx.Client(timeout=60) as http:
        auth = (username, api_token)
        headers = {"Accept": "application/json"}

        if page_ids:
            for pid in page_ids:
                try:
                    resp = http.get(
                        f"{confluence_base}/rest/api/content/{pid}",
                        params={"expand": "body.storage,children.page"},
                        auth=auth, headers=headers,
                    )
                    resp.raise_for_status()
                    pages.append(resp.json())

                    if include_children:
                        children = resp.json().get("children", {}).get("page", {}).get("results", [])
                        for child in children:
                            cresp = http.get(
                                f"{confluence_base}/rest/api/content/{child['id']}",
                                params={"expand": "body.storage"},
                                auth=auth, headers=headers,
                            )
                            if cresp.status_code == 200:
                                pages.append(cresp.json())
                except Exception as e:
                    logger.warning(f"Failed to fetch Confluence page {pid}: {e}")

        elif space_key:
            try:
                resp = http.get(
                    f"{confluence_base}/rest/api/content",
                    params={"spaceKey": space_key, "type": "page", "limit": 100, "expand": "body.storage"},
                    auth=auth, headers=headers,
                )
                resp.raise_for_status()
                pages = resp.json().get("results", [])
            except Exception as e:
                raise ValueError(f"Failed to fetch Confluence space {space_key}: {e}")

    current_ids = set()
    with _get_conn() as conn:
        for page in pages:
            page_id = str(page.get("id", ""))
            title = page.get("title", "Untitled")
            body_html = page.get("body", {}).get("storage", {}).get("value", "")
            # Strip HTML for content storage
            content = _strip_html(body_html)
            external_url = f"{confluence_base}{page.get('_links', {}).get('webui', '')}"

            _upsert_item(
                conn, source_id, external_id=page_id, title=title,
                content=content, item_type="page", external_url=external_url,
                metadata={"space": space_key or page.get("space", {}).get("key", "")},
            )
            current_ids.add(page_id)

        _remove_stale_items(conn, source_id, current_ids)
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM data_source_items WHERE source_id = ?", (source_id,)
        ).fetchone()["cnt"]

    return {"items_count": count, "fetched": len(pages)}


def _strip_html(html: str) -> str:
    """Basic HTML tag stripping."""
    import re
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── MCP Tools Sync ───────────────────────────────────────────────

def _sync_mcp_tools(source_id: str, config: dict, env_key: str = None) -> dict:
    """Fetch MCP tools from a server URL or use manually entered definitions.

    Config options:
    - url: MCP server URL to auto-discover tools (uses env Bearer token for auth)
    - tools: Manual fallback — array of {name, description, parameters}
    """
    mcp_url = config.get("url", "").strip()
    tools = config.get("tools", [])

    # Auto-discover from URL if provided
    if mcp_url:
        tools = _fetch_mcp_tools_from_url(mcp_url, env_key=env_key)

    current_ids = set()
    with _get_conn() as conn:
        for tool in tools:
            tool_name = tool.get("name", "")
            if not tool_name:
                continue
            description = tool.get("description", "")
            parameters = tool.get("parameters", {})
            content = f"{description}\nParameters: {json.dumps(parameters)}" if parameters else description

            _upsert_item(
                conn, source_id, external_id=tool_name, title=tool_name,
                content=content, item_type="tool",
                metadata={"parameters": parameters, "description": description},
            )
            current_ids.add(tool_name)

        _remove_stale_items(conn, source_id, current_ids)
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM data_source_items WHERE source_id = ?", (source_id,)
        ).fetchone()["cnt"]

    return {"items_count": count, "fetched": len(tools)}


def _fetch_mcp_tools_from_url(mcp_url: str, env_key: str = None) -> list:
    """Fetch tool definitions from an MCP server using JSON-RPC 2.0 protocol.

    Auth: Bearer token (from env credentials via Puppeteer login) + X-Account-Id header.
    Public MCP endpoints may not require auth.

    Protocol:
    1. POST initialize → get mcp-session-id from response header
    2. POST notifications/initialized
    3. POST tools/list → get tool definitions
    """
    url = mcp_url.rstrip("/")

    # Get auth from environment config
    auth_headers = _get_mcp_auth_headers(env_key)

    base_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        **auth_headers,
    }

    with httpx.Client(timeout=30) as http:
        # Step 1: Initialize
        init_payload = {
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {"sampling": {}, "roots": {"listChanged": True}},
                "clientInfo": {"name": "test-kai-scout", "version": "1.0"},
            },
            "jsonrpc": "2.0",
            "id": 0,
        }
        resp = http.post(url, json=init_payload, headers=base_headers)
        if resp.status_code != 200:
            raise ValueError(f"MCP initialize failed (HTTP {resp.status_code}): {resp.text[:200]}")

        session_id = resp.headers.get("mcp-session-id", "")
        if not session_id:
            raise ValueError("MCP initialize did not return a session ID (mcp-session-id header)")

        session_headers = {**base_headers, "mcp-session-id": session_id}

        # Step 2: Send initialized notification
        http.post(url, json={
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }, headers=session_headers)

        # Step 3: List tools
        import time
        time.sleep(0.5)  # Brief pause for server readiness
        tools_resp = http.post(url, json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {},
        }, headers=session_headers)

        if tools_resp.status_code != 200:
            raise ValueError(f"MCP tools/list failed (HTTP {tools_resp.status_code}): {tools_resp.text[:200]}")

        data = _parse_sse_json(tools_resp.text)
        # JSON-RPC response: {"result": {"tools": [...]}}
        tools_list = []
        if isinstance(data, dict):
            result = data.get("result", data)
            if isinstance(result, dict):
                tools_list = result.get("tools", [])
            elif isinstance(result, list):
                tools_list = result

        logger.info(f"Discovered {len(tools_list)} tools from {url}")

        # Normalize tool objects to {name, description, parameters}
        normalized = []
        for tool in tools_list:
            if isinstance(tool, dict) and tool.get("name"):
                normalized.append({
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("inputSchema", tool.get("parameters", {})),
                })

        return normalized


def _parse_sse_json(text: str) -> dict:
    """Parse Server-Sent Events response to extract JSON data.

    MCP servers return text/event-stream with format:
        event: message
        data: {"jsonrpc":"2.0","result":{...}}
    """
    # Try direct JSON parse first
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass
    # Parse SSE: find the last 'data:' line with JSON
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("data:"):
            json_str = line[5:].strip()
            try:
                return json.loads(json_str)
            except (json.JSONDecodeError, ValueError):
                continue
    raise ValueError(f"Could not parse MCP response as JSON or SSE: {text[:200]}")


def _get_mcp_auth_headers(env_key: str = None) -> dict:
    """Get auth headers for MCP connection from env credentials.

    Uses the Puppeteer login API to get a bearer token, same as load test auth.
    Falls back to .env MCP_BEARER_TOKEN / MCP_BASIC_TOKEN if env login fails.
    """
    headers = {}

    # Try env-based auth first
    if env_key:
        try:
            from env_config import load_env_config
            config = load_env_config()
            env = config.get("environments", {}).get(env_key, {})
            account_id = env.get("account_id", "")
            org_id = env.get("org_id", "")

            if account_id:
                headers["X-Account-Id"] = account_id
            if org_id:
                headers["X-Organization-Id"] = org_id

            # Get bearer token via Puppeteer login
            creds = env.get("credentials", {})
            email = creds.get("email", "")
            password = creds.get("password", "")
            base_url = env.get("base_url", "")
            login_url = env.get("login_url", "https://to3-devtools.vercel.app/api/login")
            account = creds.get("account", "")

            if email and password and base_url:
                token = _get_bearer_token(login_url, base_url, email, password, account)
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                    return headers
        except Exception as e:
            logger.warning(f"Env-based MCP auth failed: {e}")

    # Fallback: check .env for MCP tokens
    bearer = os.environ.get("MCP_BEARER_TOKEN") or os.environ.get("KATALON_MCP_BEARER_TOKEN", "")
    basic = os.environ.get("MCP_BASIC_TOKEN") or os.environ.get("KATALON_MCP_BASIC_TOKEN", "")

    if bearer:
        headers["Authorization"] = bearer if bearer.startswith("Bearer ") else f"Bearer {bearer}"
    elif basic:
        headers["Authorization"] = basic

    # Account ID from env var fallback
    if "X-Account-Id" not in headers:
        acct = os.environ.get("MCP_ACCOUNT_ID", "")
        if acct:
            headers["X-Account-Id"] = acct

    return headers


def _get_bearer_token(login_url: str, base_url: str, email: str, password: str, account: str) -> Optional[str]:
    """Get bearer token via Puppeteer login API."""
    try:
        resp = httpx.post(login_url, json={
            "url": base_url,
            "email": email,
            "password": password,
            "account": account,
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        token_data = data.get("token", {})
        if isinstance(token_data, dict):
            return token_data.get("access_token") or token_data.get("token")
        return token_data or None
    except Exception as e:
        logger.warning(f"Bearer token login failed: {e}")
        return None


# ── Context (Free Text) Sync ────────────────────────────────────

def _sync_context(source_id: str, config: dict) -> dict:
    """Store free-text context as a single item."""
    text = config.get("text", "").strip()
    if not text:
        # Clear items if text removed
        with _get_conn() as conn:
            conn.execute("DELETE FROM data_source_items WHERE source_id = ?", (source_id,))
        return {"items_count": 0, "fetched": 0}

    with _get_conn() as conn:
        _upsert_item(
            conn, source_id, external_id="context-main", title="Context",
            content=text, item_type="context",
        )
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM data_source_items WHERE source_id = ?", (source_id,)
        ).fetchone()["cnt"]

    return {"items_count": count, "fetched": 1}
