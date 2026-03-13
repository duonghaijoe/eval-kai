"""Coverage Analytics — Requirement coverage, MCP tool coverage, env comparison, trending.

Computes coverage by joining data_source_items with test_cases traceability fields.
"""
import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
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


def init_coverage_db():
    """Create coverage_snapshots table for caching expensive computations."""
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS coverage_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                env_key TEXT NOT NULL,
                snapshot_type TEXT NOT NULL,
                data TEXT DEFAULT '{}',
                total_items INTEGER DEFAULT 0,
                covered_items INTEGER DEFAULT 0,
                coverage_pct REAL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_cov_env ON coverage_snapshots(env_key, snapshot_type);
        """)


# ── Requirement Coverage ─────────────────────────────────────────

def compute_requirement_coverage(env_key: str) -> dict:
    """Compute which data source items are covered by test cases.

    Returns: {items: [{id, title, item_type, covered, test_cases: [...]}], total, covered, pct}
    """
    with _get_conn() as conn:
        # Get all requirement items for this env (env-specific + shared Jira/Confluence)
        items = conn.execute(
            """SELECT i.id, i.external_id, i.title, i.item_type, i.external_url
               FROM data_source_items i
               JOIN data_sources s ON s.id = i.source_id
               WHERE (s.env_key = ? OR s.env_key = '_shared')
                 AND i.item_type IN ('epic', 'story', 'bug', 'page', 'context')
               ORDER BY i.item_type, i.title""",
            (env_key,),
        ).fetchall()

        # Get all approved/draft test cases for this env with their source_items
        cases = conn.execute(
            """SELECT id, name, status, source_items, last_run_score, run_count
               FROM test_cases
               WHERE env_key = ? AND status IN ('draft', 'approved')""",
            (env_key,),
        ).fetchall()

    # Build coverage map: external_id → [case info]
    coverage_map = {}
    for case in cases:
        source_items = json.loads(case["source_items"] or "[]")
        for si in source_items:
            ext_id = si.get("external_id", "")
            if ext_id:
                coverage_map.setdefault(ext_id, []).append({
                    "id": case["id"], "name": case["name"],
                    "status": case["status"],
                    "score": case["last_run_score"],
                    "runs": case["run_count"],
                })

    result_items = []
    covered_count = 0
    for item in items:
        ext_id = item["external_id"] or item["id"]
        matching_cases = coverage_map.get(ext_id, [])
        covered = len(matching_cases) > 0
        if covered:
            covered_count += 1
        result_items.append({
            "id": item["id"],
            "external_id": item["external_id"],
            "title": item["title"],
            "item_type": item["item_type"],
            "external_url": item["external_url"],
            "covered": covered,
            "test_cases": matching_cases,
        })

    total = len(result_items)
    pct = round((covered_count / total * 100), 1) if total > 0 else 0

    # Cache snapshot
    _save_snapshot(env_key, "requirement", {
        "items_count": total, "covered_count": covered_count,
    }, total, covered_count, pct)

    return {
        "items": result_items,
        "total": total,
        "covered": covered_count,
        "coverage_pct": pct,
    }


# ── MCP Tool Coverage ────────────────────────────────────────────

def compute_mcp_tool_coverage(env_key: str) -> dict:
    """Compute which MCP tools are tested by test cases.

    Returns: {tools: [{name, description, covered, test_cases: [...]}], total, covered, pct}
    """
    with _get_conn() as conn:
        # Get MCP tool items (per-env only — tools are environment-specific)
        tools = conn.execute(
            """SELECT i.id, i.external_id, i.title, i.content, i.metadata
               FROM data_source_items i
               JOIN data_sources s ON s.id = i.source_id
               WHERE s.env_key = ? AND i.item_type = 'tool'
               ORDER BY i.title""",
            (env_key,),
        ).fetchall()

        # Get all test cases with their mcp_tools_tested
        cases = conn.execute(
            """SELECT id, name, status, mcp_tools_tested, last_run_score, run_count
               FROM test_cases
               WHERE env_key = ? AND status IN ('draft', 'approved')""",
            (env_key,),
        ).fetchall()

    # Build tool coverage map: tool_name → [case info]
    tool_map = {}
    for case in cases:
        tested_tools = json.loads(case["mcp_tools_tested"] or "[]")
        for tool_name in tested_tools:
            tool_map.setdefault(tool_name, []).append({
                "id": case["id"], "name": case["name"],
                "status": case["status"],
                "score": case["last_run_score"],
                "runs": case["run_count"],
            })

    result_tools = []
    covered_count = 0
    for tool in tools:
        tool_name = tool["title"] or tool["external_id"]
        matching_cases = tool_map.get(tool_name, [])
        covered = len(matching_cases) > 0
        if covered:
            covered_count += 1
        metadata = json.loads(tool["metadata"] or "{}")
        result_tools.append({
            "name": tool_name,
            "description": metadata.get("description", tool["content"] or "")[:200],
            "covered": covered,
            "test_cases": matching_cases,
        })

    total = len(result_tools)
    pct = round((covered_count / total * 100), 1) if total > 0 else 0

    _save_snapshot(env_key, "mcp_tool", {
        "tools_count": total, "covered_count": covered_count,
    }, total, covered_count, pct)

    return {
        "tools": result_tools,
        "total": total,
        "covered": covered_count,
        "coverage_pct": pct,
    }


# ── Coverage Summary ─────────────────────────────────────────────

def compute_coverage_summary(env_key: str) -> dict:
    """Quick summary without full item details."""
    with _get_conn() as conn:
        # Requirements count (env-specific + shared)
        req_total = conn.execute(
            """SELECT COUNT(*) as cnt FROM data_source_items i
               JOIN data_sources s ON s.id = i.source_id
               WHERE (s.env_key = ? OR s.env_key = '_shared')
                 AND i.item_type IN ('epic', 'story', 'bug', 'page', 'context')""",
            (env_key,),
        ).fetchone()["cnt"]

        # Tools count (env-specific only)
        tool_total = conn.execute(
            """SELECT COUNT(*) as cnt FROM data_source_items i
               JOIN data_sources s ON s.id = i.source_id
               WHERE s.env_key = ? AND i.item_type = 'tool'""",
            (env_key,),
        ).fetchone()["cnt"]

        # Test cases counts
        total_cases = conn.execute(
            "SELECT COUNT(*) as cnt FROM test_cases WHERE env_key = ?",
            (env_key,),
        ).fetchone()["cnt"]

        approved_cases = conn.execute(
            "SELECT COUNT(*) as cnt FROM test_cases WHERE env_key = ? AND status = 'approved'",
            (env_key,),
        ).fetchone()["cnt"]

        # Avg score of approved cases
        avg_row = conn.execute(
            "SELECT AVG(last_run_score) as avg_score FROM test_cases WHERE env_key = ? AND last_run_score IS NOT NULL",
            (env_key,),
        ).fetchone()
        avg_score = round(avg_row["avg_score"], 2) if avg_row["avg_score"] else None

        # Latest coverage snapshots
        req_snap = conn.execute(
            "SELECT coverage_pct FROM coverage_snapshots WHERE env_key = ? AND snapshot_type = 'requirement' ORDER BY created_at DESC LIMIT 1",
            (env_key,),
        ).fetchone()

        tool_snap = conn.execute(
            "SELECT coverage_pct FROM coverage_snapshots WHERE env_key = ? AND snapshot_type = 'mcp_tool' ORDER BY created_at DESC LIMIT 1",
            (env_key,),
        ).fetchone()

    return {
        "requirement_total": req_total,
        "requirement_coverage_pct": req_snap["coverage_pct"] if req_snap else 0,
        "tool_total": tool_total,
        "tool_coverage_pct": tool_snap["coverage_pct"] if tool_snap else 0,
        "total_cases": total_cases,
        "approved_cases": approved_cases,
        "avg_score": avg_score,
    }


# ── Environment Comparison ───────────────────────────────────────

def compute_env_comparison() -> list:
    """Compare metrics across all environments that have data sources."""
    with _get_conn() as conn:
        envs = conn.execute(
            "SELECT DISTINCT env_key FROM data_sources ORDER BY env_key"
        ).fetchall()

    results = []
    for env_row in envs:
        env_key = env_row["env_key"]
        summary = compute_coverage_summary(env_key)
        results.append({"env_key": env_key, **summary})

    return results


# ── Trending ─────────────────────────────────────────────────────

def compute_trending(env_key: str, days: int = 30) -> dict:
    """Get time-series data for scores, case counts, and coverage."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

    with _get_conn() as conn:
        # Coverage snapshots over time
        snapshots = conn.execute(
            """SELECT snapshot_type, coverage_pct, total_items, covered_items, created_at
               FROM coverage_snapshots
               WHERE env_key = ? AND created_at >= ?
               ORDER BY created_at""",
            (env_key, cutoff),
        ).fetchall()

        # Test case creation over time
        case_counts = conn.execute(
            """SELECT DATE(created_at) as date, COUNT(*) as count
               FROM test_cases WHERE env_key = ? AND created_at >= ?
               GROUP BY DATE(created_at) ORDER BY date""",
            (env_key, cutoff),
        ).fetchall()

        # Score trends from test case runs
        score_trends = conn.execute(
            """SELECT DATE(last_run_at) as date, AVG(last_run_score) as avg_score, COUNT(*) as runs
               FROM test_cases
               WHERE env_key = ? AND last_run_at IS NOT NULL AND last_run_at >= ?
               GROUP BY DATE(last_run_at) ORDER BY date""",
            (env_key, cutoff),
        ).fetchall()

    return {
        "coverage_snapshots": [dict(s) for s in snapshots],
        "case_counts": [dict(c) for c in case_counts],
        "score_trends": [dict(s) for s in score_trends],
    }


# ── Helpers ──────────────────────────────────────────────────────

def _save_snapshot(env_key: str, snapshot_type: str, data: dict,
                   total: int, covered: int, pct: float):
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO coverage_snapshots (env_key, snapshot_type, data, total_items, covered_items, coverage_pct)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (env_key, snapshot_type, json.dumps(data), total, covered, pct),
        )
