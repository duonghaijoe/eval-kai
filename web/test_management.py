"""Test Management — folders, suites, manual case CRUD, execution tracking.

Provides hierarchical folder organization, named test suites,
manual test case creation, and execution tool call tracking.
"""
import json
import logging
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

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

def init_test_management_db():
    """Create test_folders, test_suites, test_suite_cases, test_case_runs, execution_tool_calls tables."""
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS test_folders (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES test_folders(id) ON DELETE CASCADE,
                env_key TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_tf_parent ON test_folders(parent_id);
            CREATE INDEX IF NOT EXISTS idx_tf_env ON test_folders(env_key);

            CREATE TABLE IF NOT EXISTS test_suites (
                id TEXT PRIMARY KEY,
                env_key TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                suite_type TEXT DEFAULT 'manual',
                filter_rule TEXT,
                tags TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_ts_env ON test_suites(env_key);

            CREATE TABLE IF NOT EXISTS test_suite_cases (
                suite_id TEXT NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
                case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
                sort_order INTEGER DEFAULT 0,
                added_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (suite_id, case_id)
            );

            CREATE TABLE IF NOT EXISTS test_case_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
                session_id TEXT,
                match_id TEXT,
                score REAL,
                passed INTEGER DEFAULT 0,
                run_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_tcr_case ON test_case_runs(case_id);
            CREATE INDEX IF NOT EXISTS idx_tcr_session ON test_case_runs(session_id);

            CREATE TABLE IF NOT EXISTS execution_tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                case_id TEXT,
                tool_name TEXT NOT NULL,
                call_count INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_etc_session ON execution_tool_calls(session_id);
            CREATE INDEX IF NOT EXISTS idx_etc_tool ON execution_tool_calls(tool_name);
            CREATE INDEX IF NOT EXISTS idx_etc_case ON execution_tool_calls(case_id);
        """)

        # Migrations for test_cases table
        for col, default in [("folder_id", "NULL"), ("sort_order", "0")]:
            try:
                conn.execute(f"SELECT {col} FROM test_cases LIMIT 1")
            except sqlite3.OperationalError:
                try:
                    conn.execute(f"ALTER TABLE test_cases ADD COLUMN {col} {'TEXT' if col == 'folder_id' else 'INTEGER'} DEFAULT {default}")
                except sqlite3.OperationalError:
                    pass

        # Migration for sessions.case_id
        try:
            conn.execute("SELECT case_id FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            try:
                conn.execute("ALTER TABLE sessions ADD COLUMN case_id TEXT")
            except sqlite3.OperationalError:
                pass

        # Migration for test_cases.depends_on
        try:
            conn.execute("SELECT depends_on FROM test_cases LIMIT 1")
        except sqlite3.OperationalError:
            try:
                conn.execute("ALTER TABLE test_cases ADD COLUMN depends_on TEXT DEFAULT '[]'")
            except sqlite3.OperationalError:
                pass

        # Migration for test_cases.parameters
        try:
            conn.execute("SELECT parameters FROM test_cases LIMIT 1")
        except sqlite3.OperationalError:
            try:
                conn.execute("ALTER TABLE test_cases ADD COLUMN parameters TEXT DEFAULT '[]'")
            except sqlite3.OperationalError:
                pass

        # Migration for test_cases.template
        try:
            conn.execute("SELECT template FROM test_cases LIMIT 1")
        except sqlite3.OperationalError:
            try:
                conn.execute("ALTER TABLE test_cases ADD COLUMN template INTEGER DEFAULT 0")
            except sqlite3.OperationalError:
                pass


# ── Folders CRUD ─────────────────────────────────────────────────

def create_folder(env_key: str, name: str, parent_id: str = None,
                  description: str = None, category: str = None) -> dict:
    folder_id = str(uuid.uuid4())[:8]
    with _get_conn() as conn:
        # Validate parent exists
        if parent_id:
            parent = conn.execute("SELECT id FROM test_folders WHERE id = ?", (parent_id,)).fetchone()
            if not parent:
                raise ValueError(f"Parent folder {parent_id} not found")
        # Get next sort_order
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM test_folders WHERE parent_id IS ? AND env_key = ?",
            (parent_id, env_key),
        ).fetchone()
        conn.execute(
            """INSERT INTO test_folders (id, parent_id, env_key, name, description, category, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (folder_id, parent_id, env_key, name, description, category, row["next_order"]),
        )
    return get_folder(folder_id)


def get_folder(folder_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM test_folders WHERE id = ?", (folder_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        # Count cases in this folder
        cnt = conn.execute("SELECT COUNT(*) as cnt FROM test_cases WHERE folder_id = ?", (folder_id,)).fetchone()
        d["case_count"] = cnt["cnt"]
        return d


def list_folders(env_key: str) -> list:
    """Return flat list of all folders for env (frontend builds the tree)."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM test_folders WHERE env_key = ? ORDER BY sort_order, name",
            (env_key,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            cnt = conn.execute("SELECT COUNT(*) as cnt FROM test_cases WHERE folder_id = ?", (d["id"],)).fetchone()
            d["case_count"] = cnt["cnt"]
            result.append(d)
        return result


def update_folder(folder_id: str, **kwargs) -> Optional[dict]:
    allowed = {"name", "description", "category", "parent_id", "sort_order"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return get_folder(folder_id)
    fields["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [folder_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE test_folders SET {sets} WHERE id = ?", vals)
    return get_folder(folder_id)


def delete_folder(folder_id: str) -> bool:
    """Delete folder. Child folders cascade-delete. Cases in folder get folder_id=NULL."""
    with _get_conn() as conn:
        # Unlink cases (set folder_id=NULL rather than deleting them)
        conn.execute("UPDATE test_cases SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
        # Also unlink cases in child folders (recursive)
        _unlink_child_folder_cases(conn, folder_id)
        result = conn.execute("DELETE FROM test_folders WHERE id = ?", (folder_id,))
        return result.rowcount > 0


def _unlink_child_folder_cases(conn, parent_id: str):
    """Recursively unlink cases in child folders before cascade-delete."""
    children = conn.execute("SELECT id FROM test_folders WHERE parent_id = ?", (parent_id,)).fetchall()
    for child in children:
        conn.execute("UPDATE test_cases SET folder_id = NULL WHERE folder_id = ?", (child["id"],))
        _unlink_child_folder_cases(conn, child["id"])


# ── Suites CRUD ──────────────────────────────────────────────────

def create_suite(env_key: str, name: str, description: str = None,
                 suite_type: str = "manual", filter_rule: str = None,
                 tags: list = None) -> dict:
    suite_id = str(uuid.uuid4())[:8]
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO test_suites (id, env_key, name, description, suite_type, filter_rule, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (suite_id, env_key, name, description, suite_type, filter_rule,
             json.dumps(tags or [])),
        )
    return get_suite(suite_id)


def get_suite(suite_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM test_suites WHERE id = ?", (suite_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["tags"] = json.loads(d.get("tags") or "[]")
        # Count cases
        cnt = conn.execute("SELECT COUNT(*) as cnt FROM test_suite_cases WHERE suite_id = ?", (suite_id,)).fetchone()
        d["case_count"] = cnt["cnt"]
        # Mode breakdown
        modes = conn.execute(
            """SELECT tc.mode, COUNT(*) as cnt
               FROM test_suite_cases tsc JOIN test_cases tc ON tc.id = tsc.case_id
               WHERE tsc.suite_id = ?
               GROUP BY tc.mode""",
            (suite_id,),
        ).fetchall()
        d["mode_breakdown"] = {m["mode"]: m["cnt"] for m in modes}
        return d


def list_suites(env_key: str) -> list:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM test_suites WHERE env_key = ? ORDER BY name",
            (env_key,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["tags"] = json.loads(d.get("tags") or "[]")
            cnt = conn.execute("SELECT COUNT(*) as cnt FROM test_suite_cases WHERE suite_id = ?", (d["id"],)).fetchone()
            d["case_count"] = cnt["cnt"]
            # Mode breakdown
            modes = conn.execute(
                """SELECT tc.mode, COUNT(*) as cnt
                   FROM test_suite_cases tsc JOIN test_cases tc ON tc.id = tsc.case_id
                   WHERE tsc.suite_id = ?
                   GROUP BY tc.mode""",
                (d["id"],),
            ).fetchall()
            d["mode_breakdown"] = {m["mode"]: m["cnt"] for m in modes}
            result.append(d)
        return result


def update_suite(suite_id: str, **kwargs) -> Optional[dict]:
    allowed = {"name", "description", "suite_type", "filter_rule", "tags"}
    fields = {}
    for k, v in kwargs.items():
        if k in allowed:
            if k == "tags" and isinstance(v, list):
                v = json.dumps(v)
            fields[k] = v
    if not fields:
        return get_suite(suite_id)
    fields["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [suite_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE test_suites SET {sets} WHERE id = ?", vals)
    return get_suite(suite_id)


def delete_suite(suite_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM test_suites WHERE id = ?", (suite_id,))
        return result.rowcount > 0


# ── Suite ↔ Case Membership ──────────────────────────────────────

def add_cases_to_suite(suite_id: str, case_ids: list) -> int:
    with _get_conn() as conn:
        count = 0
        for cid in case_ids:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO test_suite_cases (suite_id, case_id) VALUES (?, ?)",
                    (suite_id, cid),
                )
                count += 1
            except sqlite3.IntegrityError:
                pass
        return count


def remove_cases_from_suite(suite_id: str, case_ids: list) -> int:
    with _get_conn() as conn:
        count = 0
        for cid in case_ids:
            r = conn.execute(
                "DELETE FROM test_suite_cases WHERE suite_id = ? AND case_id = ?",
                (suite_id, cid),
            )
            count += r.rowcount
        return count


def get_suite_cases(suite_id: str) -> list:
    """Get all test cases in a suite with their details."""
    from test_generator import _parse_case
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT tc.* FROM test_cases tc
               JOIN test_suite_cases tsc ON tc.id = tsc.case_id
               WHERE tsc.suite_id = ?
               ORDER BY tsc.sort_order, tc.name""",
            (suite_id,),
        ).fetchall()
        return [_parse_case(r) for r in rows]


def resolve_smart_suite(suite_id: str) -> list:
    """Resolve a dynamic/smart suite by evaluating its filter_rule."""
    from test_generator import _parse_case
    suite = get_suite(suite_id)
    if not suite or not suite.get("filter_rule"):
        return get_suite_cases(suite_id)

    try:
        rule = json.loads(suite["filter_rule"])
    except (json.JSONDecodeError, TypeError):
        return get_suite_cases(suite_id)

    # Build dynamic query from rule
    conditions = ["env_key = ?"]
    params = [suite["env_key"]]

    if rule.get("status"):
        conditions.append("status = ?")
        params.append(rule["status"])
    if rule.get("priority"):
        conditions.append("priority = ?")
        params.append(rule["priority"])
    if rule.get("mode"):
        conditions.append("mode = ?")
        params.append(rule["mode"])
    if rule.get("folder_id"):
        conditions.append("folder_id = ?")
        params.append(rule["folder_id"])
    if rule.get("category"):
        conditions.append("category = ?")
        params.append(rule["category"])
    if rule.get("tags"):
        for tag in rule["tags"]:
            conditions.append("tags LIKE ?")
            params.append(f"%{tag}%")
    if rule.get("min_score") is not None:
        conditions.append("(last_run_score IS NULL OR last_run_score < ?)")
        params.append(rule["min_score"])
    if rule.get("never_run"):
        conditions.append("run_count = 0")
    if rule.get("failed_last"):
        conditions.append("last_run_score IS NOT NULL AND last_run_score < 3.0")

    where = " AND ".join(conditions)
    with _get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM test_cases WHERE {where} ORDER BY priority, name",
            params,
        ).fetchall()
        return [_parse_case(r) for r in rows]


# ── Manual Test Case Creation ────────────────────────────────────

def create_test_case(env_key: str, name: str, mode: str = "fixed",
                     description: str = None, priority: str = "medium",
                     category: str = "general", folder_id: str = None,
                     steps: list = None, goal: str = None,
                     max_turns: int = 10, tags: list = None,
                     source_items: list = None, mcp_tools_tested: list = None,
                     depends_on: list = None, parameters: list = None,
                     template: bool = False) -> dict:
    """Create a test case manually (not via AI generation)."""
    from test_generator import get_test_case
    case_id = str(uuid.uuid4())[:8]
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO test_cases
               (id, plan_id, env_key, name, description, mode, priority, category,
                steps, goal, max_turns, tags, status, source_items, mcp_tools_tested,
                folder_id, sort_order, depends_on, parameters, template)
               VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?, ?)""",
            (case_id, env_key, name, description or "", mode, priority, category,
             json.dumps(steps or []), goal or "", max_turns,
             json.dumps(tags or []), json.dumps(source_items or []),
             json.dumps(mcp_tools_tested or []), folder_id,
             json.dumps(depends_on or []), json.dumps(parameters or []),
             1 if template else 0),
        )
    return get_test_case(case_id)


def create_from_template(template_id: str, env_key: str, folder_id: str = None,
                         overrides: dict = None) -> dict:
    """Create a new test case from a template."""
    from test_generator import get_test_case
    template = get_test_case(template_id)
    if not template:
        raise ValueError(f"Template {template_id} not found")

    overrides = overrides or {}
    return create_test_case(
        env_key=env_key,
        name=overrides.get("name", f"{template['name']} (copy)"),
        mode=overrides.get("mode", template["mode"]),
        description=overrides.get("description", template["description"]),
        priority=overrides.get("priority", template["priority"]),
        category=overrides.get("category", template["category"]),
        folder_id=folder_id or template.get("folder_id"),
        steps=overrides.get("steps", template["steps"]),
        goal=overrides.get("goal", template.get("goal")),
        max_turns=overrides.get("max_turns", template["max_turns"]),
        tags=overrides.get("tags", [t for t in template["tags"] if t != "promoted"]),
        source_items=overrides.get("source_items", template.get("source_items", [])),
        mcp_tools_tested=overrides.get("mcp_tools_tested", template.get("mcp_tools_tested", [])),
    )


def bulk_move_cases(case_ids: list, folder_id: str = None) -> int:
    """Move multiple test cases to a folder (or to root if folder_id is None)."""
    with _get_conn() as conn:
        if folder_id:
            folder = conn.execute("SELECT id FROM test_folders WHERE id = ?", (folder_id,)).fetchone()
            if not folder:
                raise ValueError(f"Folder {folder_id} not found")
        placeholders = ",".join("?" for _ in case_ids)
        result = conn.execute(
            f"UPDATE test_cases SET folder_id = ?, updated_at = datetime('now') WHERE id IN ({placeholders})",
            [folder_id] + case_ids,
        )
        return result.rowcount


# ── Execution Tracking ───────────────────────────────────────────

def record_case_run(case_id: str, session_id: str, match_id: str = None,
                    score: float = None, passed: bool = False):
    """Record a test case execution in history."""
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO test_case_runs (case_id, session_id, match_id, score, passed)
               VALUES (?, ?, ?, ?, ?)""",
            (case_id, session_id, match_id, score, 1 if passed else 0),
        )


def get_case_run_history(case_id: str, limit: int = 20) -> list:
    """Get execution history for a test case."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM test_case_runs
               WHERE case_id = ?
               ORDER BY run_at DESC LIMIT ?""",
            (case_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def record_tool_calls(session_id: str, case_id: str = None, tool_calls: dict = None):
    """Record actual tool calls from a session execution.

    tool_calls: {tool_name: call_count}
    """
    if not tool_calls:
        return
    with _get_conn() as conn:
        for tool_name, call_count in tool_calls.items():
            conn.execute(
                """INSERT INTO execution_tool_calls (session_id, case_id, tool_name, call_count)
                   VALUES (?, ?, ?, ?)""",
                (session_id, case_id, tool_name, call_count),
            )


def aggregate_session_tool_calls(session_id: str, case_id: str = None):
    """Aggregate tool calls from turns table for a completed session."""
    import database as db
    turns = db.get_turns(session_id)
    tool_counts = {}
    for turn in turns:
        calls = json.loads(turn.get("tool_calls") or "[]")
        for tool_name in calls:
            tool_counts[tool_name] = tool_counts.get(tool_name, 0) + 1
    if tool_counts:
        record_tool_calls(session_id, case_id, tool_counts)
    return tool_counts


def get_actual_tool_coverage(env_key: str) -> dict:
    """Get actual tool call data across all sessions for an environment."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT etc.tool_name,
                      COUNT(DISTINCT etc.session_id) as session_count,
                      SUM(etc.call_count) as total_calls,
                      MAX(etc.created_at) as last_called_at,
                      COUNT(DISTINCT etc.case_id) as case_count
               FROM execution_tool_calls etc
               JOIN sessions s ON s.id = etc.session_id
               WHERE s.env_key = ?
               GROUP BY etc.tool_name
               ORDER BY total_calls DESC""",
            (env_key,),
        ).fetchall()
        return {r["tool_name"]: dict(r) for r in rows}


# ── Import Hardcoded Scenarios ───────────────────────────────────

def import_builtin_scenarios(env_key: str, folder_id: str = None) -> list:
    """Import hardcoded SCENARIOS from kai_actor.py into test_cases."""
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
    try:
        from kai_actor import SCENARIOS
    except ImportError:
        logger.warning("Could not import SCENARIOS from kai_actor.py")
        return []

    from test_generator import get_test_case
    imported = []
    with _get_conn() as conn:
        for sc in SCENARIOS:
            # Check if already imported (by name match)
            existing = conn.execute(
                "SELECT id FROM test_cases WHERE env_key = ? AND name = ? AND plan_id IS NULL AND folder_id IS ?",
                (env_key, sc.name, folder_id),
            ).fetchone()
            if existing:
                continue

            case_id = str(uuid.uuid4())[:8]
            steps = [{"name": s.name, "message": s.message} for s in sc.steps]
            tags = list(sc.tags) if sc.tags else []
            tags.append("builtin")

            conn.execute(
                """INSERT INTO test_cases
                   (id, plan_id, env_key, name, description, mode, priority, category,
                    steps, goal, max_turns, tags, status, source_items, mcp_tools_tested,
                    folder_id, sort_order)
                   VALUES (?, NULL, ?, ?, ?, 'fixed', 'medium', ?, ?, '', ?, ?, 'approved', '[]', '[]', ?, 0)""",
                (case_id, env_key, sc.name, sc.description, sc.category,
                 json.dumps(steps), len(steps), json.dumps(tags), folder_id),
            )
            imported.append({"id": case_id, "name": sc.name, "category": sc.category})

    return imported
