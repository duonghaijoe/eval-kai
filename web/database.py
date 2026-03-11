"""SQLite database for Kai test sessions, turns, evaluations, and matches."""
import json
import sqlite3
import os
import time
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(_data_dir, exist_ok=True)
DB_PATH = os.path.join(_data_dir, "kai_tests.db")


def get_db_path():
    return DB_PATH


@contextmanager
def get_conn():
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


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                name TEXT,
                category TEXT,
                env_key TEXT DEFAULT 'production',
                status TEXT DEFAULT 'pending',
                scenario_count INTEGER DEFAULT 0,
                max_time_s REAL DEFAULT 600,
                eval_model TEXT DEFAULT 'sonnet',
                started_at TEXT,
                ended_at TEXT,
                -- Match-level evaluation (aggregated from sessions)
                overall_score REAL,
                pass_rate TEXT,
                summary TEXT,
                issues TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                actor_mode TEXT NOT NULL,
                goal TEXT,
                scenario_id TEXT,
                match_id TEXT,
                env_key TEXT DEFAULT 'production',
                status TEXT DEFAULT 'pending',
                max_turns INTEGER DEFAULT 10,
                max_time_s REAL DEFAULT 600,
                thread_id TEXT,
                started_at TEXT,
                ended_at TEXT,
                stop_reason TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                turn_number INTEGER NOT NULL,
                user_message TEXT NOT NULL,
                assistant_response TEXT,
                status TEXT,
                ttfb_ms REAL DEFAULT 0,
                total_ms REAL DEFAULT 0,
                poll_count INTEGER DEFAULT 0,
                tool_calls TEXT DEFAULT '[]',
                error TEXT,
                eval_relevance INTEGER,
                eval_accuracy INTEGER,
                eval_helpfulness INTEGER,
                eval_tool_usage INTEGER,
                eval_latency INTEGER,
                timestamp TEXT,
                UNIQUE(session_id, turn_number)
            );

            CREATE TABLE IF NOT EXISTS evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
                goal_achievement INTEGER,
                context_retention INTEGER,
                error_handling INTEGER,
                response_quality INTEGER,
                overall_score REAL,
                summary TEXT,
                issues TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS load_test_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                env_key TEXT NOT NULL,
                email TEXT NOT NULL,
                password TEXT NOT NULL,
                user_id INTEGER,
                testops_user_id INTEGER,
                account_user_id INTEGER,
                project_user_id INTEGER,
                license_allocation_id INTEGER,
                status TEXT DEFAULT 'pending',
                error TEXT,
                bearer_token TEXT,
                token_expires_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                UNIQUE(env_key, email)
            );

            CREATE TABLE IF NOT EXISTS superfights (
                id TEXT PRIMARY KEY,
                weight_class TEXT NOT NULL,
                env_key TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                concurrency INTEGER DEFAULT 1,
                turns_per_fighter INTEGER DEFAULT 3,
                total_fighters INTEGER DEFAULT 0,
                completed INTEGER DEFAULT 0,
                errors INTEGER DEFAULT 0,
                latency TEXT DEFAULT '{}',
                auth TEXT DEFAULT '{}',
                fighters TEXT DEFAULT '[]',
                sessions_data TEXT DEFAULT '[]',
                config TEXT DEFAULT '{}',
                throughput TEXT DEFAULT '{}',
                quality TEXT DEFAULT '{}',
                error_rate REAL DEFAULT 0,
                duration_s REAL DEFAULT 0,
                started_at TEXT,
                ended_at TEXT,
                error TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Scenario submissions (community-contributed scenarios)
            CREATE TABLE IF NOT EXISTS scenario_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                steps TEXT NOT NULL DEFAULT '[]',
                tags TEXT DEFAULT '[]',
                submitted_by TEXT DEFAULT 'anonymous',
                status TEXT DEFAULT 'pending',
                reject_reason TEXT,
                reviewed_by TEXT,
                reviewed_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Custom scenarios (approved submissions, supplements hardcoded SCENARIOS)
            CREATE TABLE IF NOT EXISTS custom_scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                steps TEXT NOT NULL DEFAULT '[]',
                tags TEXT DEFAULT '[]',
                submission_id INTEGER REFERENCES scenario_submissions(id),
                approved_by TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Hidden scenarios (to hide builtin scenarios)
            CREATE TABLE IF NOT EXISTS hidden_scenarios (
                id TEXT PRIMARY KEY,
                hidden_by TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Notifications (central announcement panel)
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                link TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Anonymous feedback
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT DEFAULT 'anonymous',
                message TEXT NOT NULL,
                type TEXT DEFAULT 'general',
                created_at TEXT DEFAULT (datetime('now'))
            );

            -- Clean up stale running sessions/matches from previous container runs
            UPDATE sessions SET status = 'error', stop_reason = 'server_restart',
                ended_at = datetime('now') WHERE status IN ('running', 'pending');
            UPDATE matches SET status = 'error', ended_at = datetime('now')
                WHERE status IN ('running', 'pending');
            UPDATE superfights SET status = 'error', ended_at = datetime('now')
                WHERE status IN ('running', 'pending');
        """)
        # Migrations for existing DBs
        try:
            conn.execute("SELECT match_id FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE sessions ADD COLUMN match_id TEXT")
        try:
            conn.execute("SELECT eval_latency FROM turns LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE turns ADD COLUMN eval_latency INTEGER")
        # Add env_key to sessions and matches
        try:
            conn.execute("SELECT env_key FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE sessions ADD COLUMN env_key TEXT DEFAULT 'production'")
        try:
            conn.execute("SELECT env_key FROM matches LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE matches ADD COLUMN env_key TEXT DEFAULT 'production'")
        # Add env_info JSON column to sessions (stores full env details at creation time)
        try:
            conn.execute("SELECT env_info FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE sessions ADD COLUMN env_info TEXT DEFAULT '{}'")
        # Add rubric_weights snapshot to evaluations
        try:
            conn.execute("SELECT rubric_weights FROM evaluations LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE evaluations ADD COLUMN rubric_weights TEXT DEFAULT '{}'")
        # Add testops_user_id and project_user_id to load_test_users
        try:
            conn.execute("SELECT testops_user_id FROM load_test_users LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE load_test_users ADD COLUMN testops_user_id INTEGER")
        try:
            conn.execute("SELECT project_user_id FROM load_test_users LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE load_test_users ADD COLUMN project_user_id INTEGER")
        # Add quality and sessions_data columns to superfights
        for col, default in [("quality", "'{}'"), ("sessions_data", "'[]'")]:
            try:
                conn.execute(f"SELECT {col} FROM superfights LIMIT 1")
            except sqlite3.OperationalError:
                try:
                    conn.execute(f"ALTER TABLE superfights ADD COLUMN {col} TEXT DEFAULT {default}")
                except sqlite3.OperationalError:
                    pass


# ── Matches ──────────────────────────────────────────────────────

def create_match(match_id: str, name: str, category: str = None,
                 scenario_count: int = 0, max_time_s: float = 600,
                 eval_model: str = "sonnet", env_key: str = "production") -> dict:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO matches (id, name, category, scenario_count, max_time_s, eval_model, env_key, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (match_id, name, category, scenario_count, max_time_s, eval_model, env_key),
        )
    return get_match(match_id)


def get_match(match_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM matches WHERE id = ?", (match_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        if isinstance(d.get("issues"), str):
            d["issues"] = json.loads(d["issues"])
        return d


def update_match(match_id: str, **kwargs):
    allowed = {"status", "started_at", "ended_at", "overall_score", "pass_rate", "summary", "issues"}
    fields = {}
    for k, v in kwargs.items():
        if k in allowed:
            if k == "issues" and isinstance(v, list):
                v = json.dumps(v)
            fields[k] = v
    if not fields:
        return
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [match_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE matches SET {sets} WHERE id = ?", vals)


def list_matches(limit: int = 50, offset: int = 0) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT m.*,
                      COALESCE(s.session_count, 0) as sessions_completed,
                      s.avg_ttfb_ms, s.avg_total_ms, s.avg_score
               FROM matches m
               LEFT JOIN (
                   SELECT match_id,
                          COUNT(*) as session_count,
                          ROUND(AVG(t.avg_ttfb), 1) as avg_ttfb_ms,
                          ROUND(AVG(t.avg_total), 1) as avg_total_ms,
                          ROUND(AVG(e.overall_score), 2) as avg_score
                   FROM sessions s2
                   LEFT JOIN (
                       SELECT session_id,
                              AVG(CASE WHEN ttfb_ms > 0 THEN ttfb_ms END) as avg_ttfb,
                              AVG(CASE WHEN total_ms > 0 THEN total_ms END) as avg_total
                       FROM turns GROUP BY session_id
                   ) t ON t.session_id = s2.id
                   LEFT JOIN evaluations e ON e.session_id = s2.id
                   WHERE s2.match_id IS NOT NULL
                   GROUP BY match_id
               ) s ON s.match_id = m.id
               ORDER BY m.created_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def count_active_matches() -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM matches WHERE status = 'running'"
        ).fetchone()
        return row["cnt"]


def get_match_sessions(match_id: str) -> list:
    """Get all sessions belonging to a match, with their analytics."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT s.*,
                      COALESCE(t.turn_count, 0) as turns_completed,
                      t.avg_ttfb_ms, t.avg_total_ms,
                      e.overall_score, e.goal_achievement, e.context_retention,
                      e.error_handling, e.response_quality, e.summary as eval_summary
               FROM sessions s
               LEFT JOIN (
                   SELECT session_id,
                          COUNT(*) as turn_count,
                          ROUND(AVG(CASE WHEN ttfb_ms > 0 THEN ttfb_ms END), 1) as avg_ttfb_ms,
                          ROUND(AVG(CASE WHEN total_ms > 0 THEN total_ms END), 1) as avg_total_ms
                   FROM turns GROUP BY session_id
               ) t ON t.session_id = s.id
               LEFT JOIN evaluations e ON e.session_id = s.id
               WHERE s.match_id = ?
               ORDER BY s.created_at""",
            (match_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_match(match_id: str):
    """Delete a match and all its sessions/turns/evaluations."""
    with get_conn() as conn:
        session_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM sessions WHERE match_id = ?", (match_id,)
        ).fetchall()]
        for sid in session_ids:
            conn.execute("DELETE FROM turns WHERE session_id = ?", (sid,))
            conn.execute("DELETE FROM evaluations WHERE session_id = ?", (sid,))
        conn.execute("DELETE FROM sessions WHERE match_id = ?", (match_id,))
        conn.execute("DELETE FROM matches WHERE id = ?", (match_id,))


# ── Sessions ─────────────────────────────────────────────────────

def create_session(session_id: str, actor_mode: str, goal: str = None,
                   scenario_id: str = None, max_turns: int = 10,
                   max_time_s: float = 600, match_id: str = None,
                   env_key: str = "production", env_info: dict = None) -> dict:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO sessions (id, actor_mode, goal, scenario_id, max_turns, max_time_s, match_id, env_key, env_info, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (session_id, actor_mode, goal, scenario_id, max_turns, max_time_s, match_id, env_key,
             json.dumps(env_info or {})),
        )
    return get_session(session_id)


def get_session(session_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        if isinstance(d.get("env_info"), str):
            try:
                d["env_info"] = json.loads(d["env_info"])
            except (json.JSONDecodeError, TypeError):
                d["env_info"] = {}
        return d


def update_session(session_id: str, **kwargs):
    allowed = {"status", "thread_id", "started_at", "ended_at", "stop_reason"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [session_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE sessions SET {sets} WHERE id = ?", vals)


def list_sessions(limit: int = 50, offset: int = 0) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT s.*,
                      COALESCE(t.turn_count, 0) as turns_completed,
                      t.avg_ttfb_ms, t.avg_total_ms,
                      e.overall_score, e.goal_achievement, e.context_retention,
                      e.error_handling, e.response_quality, e.summary as eval_summary
               FROM sessions s
               LEFT JOIN (
                   SELECT session_id,
                          COUNT(*) as turn_count,
                          ROUND(AVG(CASE WHEN ttfb_ms > 0 THEN ttfb_ms END), 1) as avg_ttfb_ms,
                          ROUND(AVG(CASE WHEN total_ms > 0 THEN total_ms END), 1) as avg_total_ms
                   FROM turns GROUP BY session_id
               ) t ON t.session_id = s.id
               LEFT JOIN evaluations e ON e.session_id = s.id
               ORDER BY s.created_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def count_active_sessions() -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM sessions WHERE status = 'running'"
        ).fetchone()
        return row["cnt"]


# ── Turns ─────────────────────────────────────────────────────────

def insert_turn(session_id: str, turn_number: int, user_message: str,
                assistant_response: str = None, status: str = None,
                ttfb_ms: float = 0, total_ms: float = 0, poll_count: int = 0,
                tool_calls: list = None, error: str = None,
                eval_relevance: int = None, eval_accuracy: int = None,
                eval_helpfulness: int = None, eval_tool_usage: int = None,
                eval_latency: int = None) -> dict:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO turns
               (session_id, turn_number, user_message, assistant_response, status,
                ttfb_ms, total_ms, poll_count, tool_calls, error,
                eval_relevance, eval_accuracy, eval_helpfulness, eval_tool_usage,
                eval_latency, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, turn_number, user_message, assistant_response, status,
             ttfb_ms, total_ms, poll_count, json.dumps(tool_calls or []), error,
             eval_relevance, eval_accuracy, eval_helpfulness, eval_tool_usage,
             eval_latency, datetime.now().isoformat()),
        )
    return get_turns(session_id, turn_number)


def update_turn_response(session_id: str, turn_number: int,
                         assistant_response: str = None, status: str = None,
                         ttfb_ms: float = 0, total_ms: float = 0, poll_count: int = 0,
                         tool_calls: list = None, error: str = None,
                         eval_latency: int = None):
    """Update a pending turn with Kai's response data."""
    with get_conn() as conn:
        conn.execute(
            """UPDATE turns SET assistant_response = ?, status = ?,
               ttfb_ms = ?, total_ms = ?, poll_count = ?,
               tool_calls = ?, error = ?, eval_latency = ?
               WHERE session_id = ? AND turn_number = ?""",
            (assistant_response, status, ttfb_ms, total_ms, poll_count,
             json.dumps(tool_calls or []), error, eval_latency,
             session_id, turn_number),
        )


def update_turn_eval(session_id: str, turn_number: int,
                     eval_relevance: int = None, eval_accuracy: int = None,
                     eval_helpfulness: int = None, eval_tool_usage: int = None):
    """Update evaluation scores on an existing turn (called after async eval completes)."""
    with get_conn() as conn:
        conn.execute(
            """UPDATE turns SET eval_relevance = ?, eval_accuracy = ?,
               eval_helpfulness = ?, eval_tool_usage = ?
               WHERE session_id = ? AND turn_number = ?""",
            (eval_relevance, eval_accuracy, eval_helpfulness, eval_tool_usage,
             session_id, turn_number),
        )


def get_turns(session_id: str, turn_number: int = None) :
    with get_conn() as conn:
        if turn_number is not None:
            row = conn.execute(
                "SELECT * FROM turns WHERE session_id = ? AND turn_number = ?",
                (session_id, turn_number),
            ).fetchone()
            return _parse_turn(row) if row else None
        rows = conn.execute(
            "SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number",
            (session_id,),
        ).fetchall()
        return [_parse_turn(r) for r in rows]


def _parse_turn(row) -> dict:
    d = dict(row)
    if isinstance(d.get("tool_calls"), str):
        d["tool_calls"] = json.loads(d["tool_calls"])
    return d


# ── Evaluations ───────────────────────────────────────────────────

def save_evaluation(session_id: str, goal_achievement: int, context_retention: int,
                    error_handling: int, response_quality: int, overall_score: float,
                    summary: str = "", issues: list = None, rubric_weights: dict = None):
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO evaluations
               (session_id, goal_achievement, context_retention, error_handling,
                response_quality, overall_score, summary, issues, rubric_weights)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, goal_achievement, context_retention, error_handling,
             response_quality, overall_score, summary, json.dumps(issues or []),
             json.dumps(rubric_weights or {})),
        )


def get_evaluation(session_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM evaluations WHERE session_id = ?", (session_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        if isinstance(d.get("issues"), str):
            d["issues"] = json.loads(d["issues"])
        if isinstance(d.get("rubric_weights"), str):
            try:
                d["rubric_weights"] = json.loads(d["rubric_weights"])
            except (json.JSONDecodeError, TypeError):
                d["rubric_weights"] = {}
        return d


# ── Reports / Analytics ──────────────────────────────────────────

def get_report_data(ring: str = None) -> dict:
    """Get aggregate data for the reports dashboard, optionally filtered by ring."""
    with get_conn() as conn:
        # Ring filter clause for sessions
        ring_clause = ""
        ring_params = []
        if ring and ring != "all":
            ring_clause = " WHERE COALESCE(s.env_key, 'production') = ?"
            ring_params = [ring]

        sessions = conn.execute(
            "SELECT * FROM sessions s" + ring_clause + " ORDER BY s.created_at DESC",
            ring_params
        ).fetchall()
        sessions = [dict(r) for r in sessions]
        session_ids = [s["id"] for s in sessions]

        # Aggregate latency stats (filtered by ring sessions)
        if session_ids:
            placeholders = ",".join("?" * len(session_ids))
            stats = conn.execute(f"""
                SELECT
                    COUNT(*) as total_turns,
                    AVG(ttfb_ms) as avg_ttfb,
                    AVG(total_ms) as avg_total,
                    MAX(ttfb_ms) as max_ttfb,
                    MAX(total_ms) as max_total,
                    MIN(ttfb_ms) as min_ttfb,
                    MIN(total_ms) as min_total,
                    AVG(poll_count) as avg_polls
                FROM turns WHERE ttfb_ms > 0 AND session_id IN ({placeholders})
            """, session_ids).fetchone()

            # Per-mode stats
            mode_stats = conn.execute(f"""
                SELECT
                    s.actor_mode,
                    COUNT(DISTINCT s.id) as session_count,
                    AVG(t.total_ms) as avg_total_ms,
                    AVG(t.ttfb_ms) as avg_ttfb_ms
                FROM sessions s
                LEFT JOIN turns t ON s.id = t.session_id AND t.ttfb_ms > 0
                WHERE s.id IN ({placeholders})
                GROUP BY s.actor_mode
            """, session_ids).fetchall()

            # Evaluation averages
            eval_stats = conn.execute(f"""
                SELECT
                    AVG(goal_achievement) as avg_goal,
                    AVG(context_retention) as avg_context,
                    AVG(error_handling) as avg_error,
                    AVG(response_quality) as avg_quality,
                    AVG(overall_score) as avg_overall
                FROM evaluations WHERE session_id IN ({placeholders})
            """, session_ids).fetchone()

            # Recent turns for latency trend
            latency_trend = conn.execute(f"""
                SELECT t.session_id, t.turn_number, t.ttfb_ms, t.total_ms, t.timestamp
                FROM turns t
                WHERE t.ttfb_ms > 0 AND t.session_id IN ({placeholders})
                ORDER BY t.timestamp DESC
                LIMIT 100
            """, session_ids).fetchall()
        else:
            stats = None
            mode_stats = []
            eval_stats = None
            latency_trend = []

        # Per-environment (ring) stats — always unfiltered for ring tabs
        env_stats = conn.execute("""
            SELECT
                COALESCE(s.env_key, 'production') as env_key,
                COUNT(DISTINCT s.id) as session_count,
                SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) as errors,
                ROUND(AVG(t.ttfb_ms), 1) as avg_ttfb_ms,
                ROUND(AVG(t.total_ms), 1) as avg_total_ms,
                ROUND(AVG(e.overall_score), 2) as avg_score
            FROM sessions s
            LEFT JOIN (
                SELECT session_id, AVG(CASE WHEN ttfb_ms > 0 THEN ttfb_ms END) as ttfb_ms,
                       AVG(CASE WHEN total_ms > 0 THEN total_ms END) as total_ms
                FROM turns GROUP BY session_id
            ) t ON t.session_id = s.id
            LEFT JOIN evaluations e ON e.session_id = s.id
            GROUP BY COALESCE(s.env_key, 'production')
        """).fetchall()

        # Per-ring breakdowns for comparison (only when viewing all rings)
        by_mode_by_ring = {}
        evals_by_ring = {}
        trend_by_ring = {}
        if not ring or ring == "all":
            # Mode stats per ring
            mode_ring_rows = conn.execute("""
                SELECT
                    COALESCE(s.env_key, 'production') as env_key,
                    s.actor_mode,
                    COUNT(DISTINCT s.id) as session_count,
                    AVG(t.total_ms) as avg_total_ms,
                    AVG(t.ttfb_ms) as avg_ttfb_ms
                FROM sessions s
                LEFT JOIN turns t ON s.id = t.session_id AND t.ttfb_ms > 0
                GROUP BY COALESCE(s.env_key, 'production'), s.actor_mode
            """).fetchall()
            for r in mode_ring_rows:
                rd = dict(r)
                rk = rd.pop("env_key")
                by_mode_by_ring.setdefault(rk, []).append(rd)

            # Eval averages per ring
            eval_ring_rows = conn.execute("""
                SELECT
                    COALESCE(s.env_key, 'production') as env_key,
                    AVG(e.goal_achievement) as avg_goal,
                    AVG(e.context_retention) as avg_context,
                    AVG(e.error_handling) as avg_error,
                    AVG(e.response_quality) as avg_quality,
                    AVG(e.overall_score) as avg_overall
                FROM evaluations e
                JOIN sessions s ON s.id = e.session_id
                GROUP BY COALESCE(s.env_key, 'production')
            """).fetchall()
            for r in eval_ring_rows:
                rd = dict(r)
                rk = rd.pop("env_key")
                evals_by_ring[rk] = rd

            # Latency trend per ring
            trend_ring_rows = conn.execute("""
                SELECT
                    COALESCE(s.env_key, 'production') as env_key,
                    t.session_id, t.turn_number, t.ttfb_ms, t.total_ms, t.timestamp
                FROM turns t
                JOIN sessions s ON s.id = t.session_id
                WHERE t.ttfb_ms > 0
                ORDER BY t.timestamp DESC
                LIMIT 200
            """).fetchall()
            for r in trend_ring_rows:
                rd = dict(r)
                rk = rd.pop("env_key")
                trend_by_ring.setdefault(rk, []).append(rd)
            # Limit each ring to 100
            for rk in trend_by_ring:
                trend_by_ring[rk] = trend_by_ring[rk][:100]

        return {
            "sessions": sessions,
            "latency": dict(stats) if stats else {},
            "by_mode": [dict(r) for r in mode_stats],
            "evaluations": dict(eval_stats) if eval_stats else {},
            "latency_trend": [dict(r) for r in latency_trend],
            "by_ring": [dict(r) for r in env_stats],
            "by_mode_by_ring": by_mode_by_ring,
            "evals_by_ring": evals_by_ring,
            "trend_by_ring": trend_by_ring,
        }


def get_match_trends(ring: str = None, pass_threshold: float = 3.0) -> dict:
    """Get match-level trends over time for regression analysis.

    Returns per-match, per-category aggregated metrics ordered by time.
    """
    with get_conn() as conn:
        ring_clause = ""
        ring_params = []
        if ring:
            ring_clause = " AND COALESCE(m.env_key, 'production') = ?"
            ring_params = [ring]

        # All completed/error matches ordered by time
        matches = conn.execute(
            """SELECT m.id, m.name, m.category, m.env_key, m.status,
                      m.overall_score, m.pass_rate, m.created_at, m.ended_at
               FROM matches m
               WHERE m.status IN ('completed', 'error')""" + ring_clause + """
               ORDER BY m.created_at ASC""",
            ring_params,
        ).fetchall()
        matches = [dict(r) for r in matches]

        if not matches:
            return {"matches": [], "categories": [], "trends": [], "rings": []}

        match_ids = [m["id"] for m in matches]
        placeholders = ",".join("?" * len(match_ids))

        # Per-session data with scenario category extracted from scenarios
        # scenario_id maps to a category — we need to look it up
        rows = conn.execute(f"""
            SELECT
                s.match_id,
                s.scenario_id,
                s.status,
                COALESCE(t.avg_ttfb_ms, 0) as avg_ttfb_ms,
                COALESCE(t.avg_total_ms, 0) as avg_total_ms,
                e.overall_score,
                e.goal_achievement,
                e.context_retention,
                e.error_handling,
                e.response_quality
            FROM sessions s
            LEFT JOIN (
                SELECT session_id,
                       ROUND(AVG(CASE WHEN ttfb_ms > 0 THEN ttfb_ms END), 1) as avg_ttfb_ms,
                       ROUND(AVG(CASE WHEN total_ms > 0 THEN total_ms END), 1) as avg_total_ms
                FROM turns GROUP BY session_id
            ) t ON t.session_id = s.id
            LEFT JOIN evaluations e ON e.session_id = s.id
            WHERE s.match_id IN ({placeholders})
            ORDER BY s.created_at
        """, match_ids).fetchall()

        # Build scenario → category map from the session_runner scenarios
        scenario_map = {}
        try:
            import sys, os
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from session_runner import get_fixed_scenarios
            for sc in get_fixed_scenarios():
                scenario_map[sc["id"]] = sc["category"]
        except Exception:
            pass

        # Aggregate per match, per category
        from collections import defaultdict
        match_cat_data = defaultdict(lambda: defaultdict(list))
        for r in rows:
            rd = dict(r)
            cat = scenario_map.get(rd["scenario_id"], "other")
            match_cat_data[rd["match_id"]][cat].append(rd)

        # Build trend rows: one entry per match with per-category metrics
        trends = []
        all_categories = set()
        for m in matches:
            entry = {
                "match_id": m["id"],
                "match_name": m["name"] or m["id"][:8],
                "created_at": m["created_at"],
                "overall_score": m["overall_score"],
                "pass_rate": m["pass_rate"],
                "categories": {},
            }
            cats = match_cat_data.get(m["id"], {})
            for cat, sessions_list in cats.items():
                all_categories.add(cat)
                scored = [s for s in sessions_list if s["overall_score"] is not None]
                passed = [s for s in scored if s["overall_score"] >= pass_threshold]
                entry["categories"][cat] = {
                    "total": len(sessions_list),
                    "passed": len(passed),
                    "pass_rate": len(passed) / len(sessions_list) if sessions_list else 0,
                    "avg_score": round(sum(s["overall_score"] for s in scored) / len(scored), 2) if scored else None,
                    "avg_goal": round(sum(s["goal_achievement"] for s in scored if s["goal_achievement"]) / max(len([s for s in scored if s["goal_achievement"]]), 1), 2) if scored else None,
                    "avg_context": round(sum(s["context_retention"] for s in scored if s["context_retention"]) / max(len([s for s in scored if s["context_retention"]]), 1), 2) if scored else None,
                    "avg_quality": round(sum(s["response_quality"] for s in scored if s["response_quality"]) / max(len([s for s in scored if s["response_quality"]]), 1), 2) if scored else None,
                    "avg_ttfb_ms": round(sum(s["avg_ttfb_ms"] for s in sessions_list) / len(sessions_list), 1) if sessions_list else 0,
                    "avg_total_ms": round(sum(s["avg_total_ms"] for s in sessions_list) / len(sessions_list), 1) if sessions_list else 0,
                }
            trends.append(entry)

        # Available rings
        ring_rows = conn.execute(
            "SELECT DISTINCT COALESCE(env_key, 'production') as env_key FROM matches WHERE status IN ('completed', 'error')"
        ).fetchall()

        return {
            "matches": matches,
            "categories": sorted(all_categories),
            "trends": trends,
            "rings": [r["env_key"] for r in ring_rows],
        }


# ── Load Test Users ──────────────────────────────────────────────

def save_load_test_user(env_key: str, email: str, password: str,
                        user_id: int = None, testops_user_id: int = None,
                        account_user_id: int = None, project_user_id: int = None,
                        license_allocation_id: int = None,
                        status: str = "pending", error: str = None):
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO load_test_users
               (env_key, email, password, user_id, testops_user_id,
                account_user_id, project_user_id,
                license_allocation_id, status, error, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (env_key, email, password, user_id, testops_user_id,
             account_user_id, project_user_id,
             license_allocation_id, status, error),
        )


def get_load_test_user(email: str, env_key: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM load_test_users WHERE email = ? AND env_key = ?",
            (email, env_key),
        ).fetchone()
        return dict(row) if row else None


def list_load_test_users(env_key: str = None) -> list:
    with get_conn() as conn:
        if env_key:
            rows = conn.execute(
                "SELECT * FROM load_test_users WHERE env_key = ? ORDER BY created_at",
                (env_key,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM load_test_users ORDER BY env_key, created_at"
            ).fetchall()
        return [dict(r) for r in rows]


def update_load_test_user(email: str, env_key: str, **kwargs):
    allowed = {"status", "error", "user_id", "testops_user_id",
               "account_user_id", "project_user_id",
               "license_allocation_id", "bearer_token", "token_expires_at"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    fields["updated_at"] = datetime.now().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [email, env_key]
    with get_conn() as conn:
        conn.execute(f"UPDATE load_test_users SET {sets} WHERE email = ? AND env_key = ?", vals)


def delete_load_test_user(email: str, env_key: str):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM load_test_users WHERE email = ? AND env_key = ?",
            (email, env_key),
        )


# ── Superfights ─────────────────────────────────────────────────

def save_superfight(fight_id: str, weight_class: str, env_key: str,
                    status: str = "pending", concurrency: int = 1,
                    turns_per_fighter: int = 3, total_fighters: int = 0,
                    completed: int = 0, errors: int = 0,
                    latency: str = "{}", auth: str = "{}",
                    fighters: str = "[]", sessions_data: str = "[]",
                    config: str = "{}",
                    throughput: str = "{}", quality: str = "{}",
                    error_rate: float = 0,
                    duration_s: float = 0,
                    started_at: str = None, ended_at: str = None,
                    error: str = None):
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO superfights
               (id, weight_class, env_key, status, concurrency, turns_per_fighter,
                total_fighters, completed, errors, latency, auth, fighters,
                sessions_data, config, throughput, quality, error_rate,
                duration_s, started_at, ended_at, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (fight_id, weight_class, env_key, status, concurrency,
             turns_per_fighter, total_fighters, completed, errors,
             latency, auth, fighters, sessions_data, config, throughput, quality, error_rate,
             duration_s, started_at, ended_at, error),
        )


def get_superfight(fight_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM superfights WHERE id = ?", (fight_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        for k in ("latency", "auth", "fighters", "sessions_data", "config", "throughput", "quality"):
            if isinstance(d.get(k), str):
                try:
                    d[k] = json.loads(d[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d


def list_superfights(limit: int = 50, env_key: str = None) -> list:
    with get_conn() as conn:
        if env_key:
            rows = conn.execute(
                "SELECT * FROM superfights WHERE env_key = ? ORDER BY created_at DESC LIMIT ?",
                (env_key, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM superfights ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        results = []
        for row in rows:
            d = dict(row)
            for k in ("latency", "auth", "fighters", "config", "throughput", "quality"):
                if isinstance(d.get(k), str):
                    try:
                        d[k] = json.loads(d[k])
                    except (json.JSONDecodeError, TypeError):
                        pass
            results.append(d)
        return results


def delete_superfight(fight_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM superfights WHERE id = ?", (fight_id,))


# ── Scenario Submissions ─────────────────────────────────────────

def create_submission(name: str, description: str, category: str,
                      steps: list, tags: list = None, submitted_by: str = "anonymous") -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO scenario_submissions (name, description, category, steps, tags, submitted_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, description, category, json.dumps(steps), json.dumps(tags or []), submitted_by),
        )
        row = conn.execute("SELECT * FROM scenario_submissions WHERE id = ?", (cur.lastrowid,)).fetchone()
        d = dict(row)
        for k in ("steps", "tags"):
            if isinstance(d.get(k), str):
                try:
                    d[k] = json.loads(d[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d


def get_submission(submission_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM scenario_submissions WHERE id = ?", (submission_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        for k in ("steps", "tags"):
            if isinstance(d.get(k), str):
                try:
                    d[k] = json.loads(d[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d


def list_submissions(status: str = None, limit: int = 100) -> list:
    with get_conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM scenario_submissions WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM scenario_submissions ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        results = []
        for row in rows:
            d = dict(row)
            for k in ("steps", "tags"):
                if isinstance(d.get(k), str):
                    try:
                        d[k] = json.loads(d[k])
                    except (json.JSONDecodeError, TypeError):
                        pass
            results.append(d)
        return results


def approve_submission(submission_id: int, reviewed_by: str = "admin") -> Optional[dict]:
    """Approve a submission: create a custom_scenario and update submission status."""
    sub = get_submission(submission_id)
    if not sub or sub["status"] != "pending":
        return None

    import hashlib
    scenario_id = f"custom-{hashlib.md5(sub['name'].encode()).hexdigest()[:8]}"

    with get_conn() as conn:
        conn.execute(
            """UPDATE scenario_submissions SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
               WHERE id = ?""",
            (reviewed_by, submission_id),
        )
        conn.execute(
            """INSERT OR REPLACE INTO custom_scenarios (id, name, description, category, steps, tags, submission_id, approved_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (scenario_id, sub["name"], sub["description"], sub["category"],
             json.dumps(sub["steps"]), json.dumps(sub["tags"]), submission_id, reviewed_by),
        )
    return {"scenario_id": scenario_id, "submission_id": submission_id}


def reject_submission(submission_id: int, reason: str = "", reviewed_by: str = "admin") -> bool:
    with get_conn() as conn:
        affected = conn.execute(
            """UPDATE scenario_submissions SET status = 'rejected', reject_reason = ?,
               reviewed_by = ?, reviewed_at = datetime('now')
               WHERE id = ? AND status = 'pending'""",
            (reason, reviewed_by, submission_id),
        ).rowcount
    return affected > 0


def list_custom_scenarios() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM custom_scenarios ORDER BY created_at DESC").fetchall()
        results = []
        for row in rows:
            d = dict(row)
            for k in ("steps", "tags"):
                if isinstance(d.get(k), str):
                    try:
                        d[k] = json.loads(d[k])
                    except (json.JSONDecodeError, TypeError):
                        pass
            results.append(d)
        return results


def create_custom_scenario(name: str, description: str, category: str, steps: list, tags: list = None) -> dict:
    scenario_id = f"custom-{name.lower().replace(' ', '-').replace('/', '-')[:40]}-{int(time.time())}"
    steps_json = json.dumps(steps) if not isinstance(steps, str) else steps
    tags_json = json.dumps(tags or []) if not isinstance(tags or [], str) else (tags or "[]")
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO custom_scenarios (id, name, description, category, steps, tags)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (scenario_id, name, description, category, steps_json, tags_json),
        )
        row = conn.execute("SELECT * FROM custom_scenarios WHERE id = ?", (scenario_id,)).fetchone()
        d = dict(row)
        for k in ("steps", "tags"):
            if isinstance(d.get(k), str):
                try:
                    d[k] = json.loads(d[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d


def update_custom_scenario(scenario_id: str, name: str, description: str, category: str, steps: list, tags: list = None) -> dict:
    steps_json = json.dumps(steps) if not isinstance(steps, str) else steps
    tags_json = json.dumps(tags or []) if not isinstance(tags or [], str) else (tags or "[]")
    with get_conn() as conn:
        conn.execute(
            """UPDATE custom_scenarios SET name = ?, description = ?, category = ?, steps = ?, tags = ?
               WHERE id = ?""",
            (name, description, category, steps_json, tags_json, scenario_id),
        )
        row = conn.execute("SELECT * FROM custom_scenarios WHERE id = ?", (scenario_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        for k in ("steps", "tags"):
            if isinstance(d.get(k), str):
                try:
                    d[k] = json.loads(d[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d


def delete_custom_scenario(scenario_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM custom_scenarios WHERE id = ?", (scenario_id,))


def hide_scenario(scenario_id: str, hidden_by: str = "admin"):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO hidden_scenarios (id, hidden_by) VALUES (?, ?)",
            (scenario_id, hidden_by),
        )


def unhide_scenario(scenario_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM hidden_scenarios WHERE id = ?", (scenario_id,))


def list_hidden_scenarios() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT id FROM hidden_scenarios").fetchall()
        return [r["id"] for r in rows]


# ── Notifications ─────────────────────────────────────────────────

def create_notification(type_: str, title: str, message: str, link: str = None) -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO notifications (type, title, message, link) VALUES (?, ?, ?, ?)",
            (type_, title, message, link),
        )
        row = conn.execute("SELECT * FROM notifications WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row) if row else {}


def list_notifications(limit: int = 50) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def delete_notification(notification_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM notifications WHERE id = ?", (notification_id,))


# ── Feedback ──────────────────────────────────────────────────────

def create_feedback(message: str, name: str = "anonymous", type_: str = "general") -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO feedback (name, message, type) VALUES (?, ?, ?)",
            (name or "anonymous", message, type_),
        )
        row = conn.execute("SELECT * FROM feedback WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row) if row else {}


def list_feedback(limit: int = 100) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def delete_feedback(feedback_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM feedback WHERE id = ?", (feedback_id,))
