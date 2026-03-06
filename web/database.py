"""SQLite database for Kai test sessions, turns, evaluations, and matches."""
import json
import sqlite3
import os
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

            -- Clean up stale running sessions/matches from previous container runs
            UPDATE sessions SET status = 'error', stop_reason = 'server_restart',
                ended_at = datetime('now') WHERE status IN ('running', 'pending');
            UPDATE matches SET status = 'error', ended_at = datetime('now')
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
                   env_key: str = "production") -> dict:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO sessions (id, actor_mode, goal, scenario_id, max_turns, max_time_s, match_id, env_key, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (session_id, actor_mode, goal, scenario_id, max_turns, max_time_s, match_id, env_key),
        )
    return get_session(session_id)


def get_session(session_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return None
        return dict(row)


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
                    summary: str = "", issues: list = None):
    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO evaluations
               (session_id, goal_achievement, context_retention, error_handling,
                response_quality, overall_score, summary, issues)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, goal_achievement, context_retention, error_handling,
             response_quality, overall_score, summary, json.dumps(issues or [])),
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
        return d


# ── Reports / Analytics ──────────────────────────────────────────

def get_report_data() -> dict:
    """Get aggregate data for the reports dashboard."""
    with get_conn() as conn:
        sessions = conn.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC"
        ).fetchall()
        sessions = [dict(r) for r in sessions]

        # Aggregate latency stats
        stats = conn.execute("""
            SELECT
                COUNT(*) as total_turns,
                AVG(ttfb_ms) as avg_ttfb,
                AVG(total_ms) as avg_total,
                MAX(ttfb_ms) as max_ttfb,
                MAX(total_ms) as max_total,
                MIN(ttfb_ms) as min_ttfb,
                MIN(total_ms) as min_total,
                AVG(poll_count) as avg_polls
            FROM turns WHERE ttfb_ms > 0
        """).fetchone()

        # Per-mode stats
        mode_stats = conn.execute("""
            SELECT
                s.actor_mode,
                COUNT(DISTINCT s.id) as session_count,
                AVG(t.total_ms) as avg_total_ms,
                AVG(t.ttfb_ms) as avg_ttfb_ms
            FROM sessions s
            LEFT JOIN turns t ON s.id = t.session_id AND t.ttfb_ms > 0
            GROUP BY s.actor_mode
        """).fetchall()

        # Evaluation averages
        eval_stats = conn.execute("""
            SELECT
                AVG(goal_achievement) as avg_goal,
                AVG(context_retention) as avg_context,
                AVG(error_handling) as avg_error,
                AVG(response_quality) as avg_quality,
                AVG(overall_score) as avg_overall
            FROM evaluations
        """).fetchone()

        # Recent turns for latency trend
        latency_trend = conn.execute("""
            SELECT t.session_id, t.turn_number, t.ttfb_ms, t.total_ms, t.timestamp
            FROM turns t
            WHERE t.ttfb_ms > 0
            ORDER BY t.timestamp DESC
            LIMIT 100
        """).fetchall()

        # Per-environment (ring) stats
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

        return {
            "sessions": sessions,
            "latency": dict(stats) if stats else {},
            "by_mode": [dict(r) for r in mode_stats],
            "evaluations": dict(eval_stats) if eval_stats else {},
            "latency_trend": [dict(r) for r in latency_trend],
            "by_ring": [dict(r) for r in env_stats],
        }
