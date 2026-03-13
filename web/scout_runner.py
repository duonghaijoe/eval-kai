"""Scout Runner — Scheduled sync, test generation, and match execution pipeline.

Orchestrates: sync data sources → detect changes → generate test plan → approve → run match.
Includes an asyncio-based scheduler with preset intervals.
"""
import asyncio
import json
import logging
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(_data_dir, "kai_tests.db")

INTERVAL_SECONDS = {
    "hourly": 3600,
    "6h": 21600,
    "daily": 86400,
    "weekly": 604800,
}


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

def init_scout_db():
    """Create scout_schedules and scout_runs tables."""
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS scout_schedules (
                id TEXT PRIMARY KEY,
                env_key TEXT NOT NULL,
                name TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                interval TEXT DEFAULT 'daily',
                source_ids TEXT DEFAULT '[]',
                auto_generate INTEGER DEFAULT 1,
                auto_run INTEGER DEFAULT 0,
                auto_approve INTEGER DEFAULT 0,
                model TEXT DEFAULT 'sonnet',
                last_run_at TEXT,
                next_run_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS scout_runs (
                id TEXT PRIMARY KEY,
                schedule_id TEXT REFERENCES scout_schedules(id) ON DELETE SET NULL,
                env_key TEXT NOT NULL,
                trigger_type TEXT DEFAULT 'manual',
                status TEXT DEFAULT 'pending',
                steps_log TEXT DEFAULT '[]',
                changes_detected INTEGER DEFAULT 0,
                cases_generated INTEGER DEFAULT 0,
                match_id TEXT,
                plan_id TEXT,
                started_at TEXT,
                ended_at TEXT,
                error TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_sr_env ON scout_runs(env_key);
            CREATE INDEX IF NOT EXISTS idx_ss_env ON scout_schedules(env_key);
        """)


# ── Scout Schedules CRUD ─────────────────────────────────────────

def create_schedule(env_key: str, name: str, interval: str = "daily",
                    source_ids: list = None, auto_generate: bool = True,
                    auto_run: bool = False, auto_approve: bool = False,
                    model: str = "sonnet") -> dict:
    sched_id = str(uuid.uuid4())[:8]
    next_run = (datetime.utcnow() + timedelta(seconds=INTERVAL_SECONDS.get(interval, 86400))).isoformat()
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO scout_schedules
               (id, env_key, name, interval, source_ids, auto_generate, auto_run, auto_approve, model, next_run_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sched_id, env_key, name, interval, json.dumps(source_ids or []),
             int(auto_generate), int(auto_run), int(auto_approve), model, next_run),
        )
    return get_schedule(sched_id)


def get_schedule(sched_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM scout_schedules WHERE id = ?", (sched_id,)).fetchone()
        if not row:
            return None
        return _parse_schedule(row)


def _parse_schedule(row) -> dict:
    d = dict(row)
    d["source_ids"] = json.loads(d.get("source_ids") or "[]")
    d["enabled"] = bool(d.get("enabled", 1))
    d["auto_generate"] = bool(d.get("auto_generate", 1))
    d["auto_run"] = bool(d.get("auto_run", 0))
    d["auto_approve"] = bool(d.get("auto_approve", 0))
    return d


def list_schedules(env_key: str = None) -> list:
    with _get_conn() as conn:
        if env_key:
            rows = conn.execute(
                "SELECT * FROM scout_schedules WHERE env_key = ? ORDER BY created_at DESC",
                (env_key,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM scout_schedules ORDER BY created_at DESC").fetchall()
        return [_parse_schedule(r) for r in rows]


def update_schedule(sched_id: str, **kwargs) -> Optional[dict]:
    allowed = {"name", "enabled", "interval", "source_ids", "auto_generate",
               "auto_run", "auto_approve", "model"}
    fields = {}
    for k, v in kwargs.items():
        if k in allowed:
            if k == "source_ids" and isinstance(v, list):
                v = json.dumps(v)
            if k in ("enabled", "auto_generate", "auto_run", "auto_approve"):
                v = 1 if v else 0
            fields[k] = v
    if not fields:
        return get_schedule(sched_id)
    fields["updated_at"] = datetime.utcnow().isoformat()
    # Recalculate next_run if interval changed
    if "interval" in fields:
        interval_str = kwargs.get("interval", "daily")
        fields["next_run_at"] = (datetime.utcnow() + timedelta(
            seconds=INTERVAL_SECONDS.get(interval_str, 86400)
        )).isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [sched_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE scout_schedules SET {sets} WHERE id = ?", vals)
    return get_schedule(sched_id)


def delete_schedule(sched_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM scout_schedules WHERE id = ?", (sched_id,))
        return result.rowcount > 0


# ── Scout Runs ───────────────────────────────────────────────────

def _parse_run(row) -> dict:
    d = dict(row)
    d["steps_log"] = json.loads(d.get("steps_log") or "[]")
    return d


def list_runs(env_key: str = None, limit: int = 50) -> list:
    with _get_conn() as conn:
        if env_key:
            rows = conn.execute(
                "SELECT * FROM scout_runs WHERE env_key = ? ORDER BY created_at DESC LIMIT ?",
                (env_key, limit),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM scout_runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [_parse_run(r) for r in rows]


def _create_run(env_key: str, schedule_id: str = None, trigger_type: str = "manual") -> str:
    run_id = str(uuid.uuid4())[:8]
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO scout_runs (id, env_key, schedule_id, trigger_type, status, started_at)
               VALUES (?, ?, ?, ?, 'running', datetime('now'))""",
            (run_id, env_key, schedule_id, trigger_type),
        )
    return run_id


def _update_run(run_id: str, **kwargs):
    allowed = {"status", "steps_log", "changes_detected", "cases_generated", "match_id", "plan_id", "ended_at", "error"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    for k in ("steps_log",):
        if k in fields and isinstance(fields[k], list):
            fields[k] = json.dumps(fields[k])
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [run_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE scout_runs SET {sets} WHERE id = ?", vals)


def _append_step(run_id: str, step: str):
    """Append a step message to the run's steps_log."""
    with _get_conn() as conn:
        row = conn.execute("SELECT steps_log FROM scout_runs WHERE id = ?", (run_id,)).fetchone()
        if row:
            steps = json.loads(row["steps_log"] or "[]")
            steps.append({"time": datetime.utcnow().isoformat(), "message": step})
            conn.execute(
                "UPDATE scout_runs SET steps_log = ? WHERE id = ?",
                (json.dumps(steps), run_id),
            )


# ── Scout Execution Pipeline ────────────────────────────────────

def run_scout(env_key: str, source_ids: list = None, auto_generate: bool = True,
              auto_run: bool = False, auto_approve: bool = False,
              model: str = "sonnet", schedule_id: str = None,
              trigger_type: str = "manual") -> dict:
    """Execute the scout pipeline synchronously.

    Steps:
    1. Sync all specified data sources
    2. Detect changes
    3. If auto_generate and changes → generate test plan
    4. If auto_approve → bulk-approve cases
    5. If auto_run → create and return match info (actual match run is async)
    """
    from data_sources import sync_all_sources, sync_source, list_data_sources, get_items_for_env
    from test_generator import generate_test_plan, list_test_cases, bulk_approve_cases

    run_id = _create_run(env_key, schedule_id, trigger_type)

    try:
        # Step 1: Sync data sources
        _append_step(run_id, "Syncing data sources...")
        if source_ids:
            sync_results = []
            for sid in source_ids:
                r = sync_source(sid)
                sync_results.append(r)
        else:
            sync_results = sync_all_sources(env_key)

        synced_count = sum(1 for r in sync_results if isinstance(r, dict) and r.get("status") == "synced")
        _append_step(run_id, f"Synced {synced_count} sources")

        # Step 2: Check for items (change detection is built into sync via content_hash)
        items = get_items_for_env(env_key, source_ids)
        changes = len(items) > 0
        _update_run(run_id, changes_detected=1 if changes else 0)
        _append_step(run_id, f"Found {len(items)} items total")

        if not changes:
            _append_step(run_id, "No items found — done")
            _update_run(run_id, status="completed", ended_at=datetime.utcnow().isoformat())
            return {"run_id": run_id, "status": "completed", "changes": False}

        # Step 3: Generate test plan
        plan_id = None
        cases_count = 0
        if auto_generate:
            _append_step(run_id, "Generating test plan...")
            plan = generate_test_plan(env_key, source_ids or [], model)
            plan_id = plan["id"]
            cases_count = plan.get("total_cases", 0)
            _update_run(run_id, plan_id=plan_id, cases_generated=cases_count)
            _append_step(run_id, f"Generated {cases_count} test cases (plan: {plan_id})")

            if plan.get("status") == "error":
                _append_step(run_id, f"Generation error: {plan.get('error', 'unknown')}")
                _update_run(run_id, status="completed", ended_at=datetime.utcnow().isoformat(),
                           error=plan.get("error"))
                return {"run_id": run_id, "status": "completed", "plan_id": plan_id, "error": plan.get("error")}

        # Step 4: Auto-approve
        if auto_approve and plan_id:
            _append_step(run_id, "Auto-approving draft cases...")
            cases = list_test_cases(plan_id=plan_id, status="draft")
            if cases:
                approved = bulk_approve_cases([c["id"] for c in cases])
                _append_step(run_id, f"Approved {approved} cases")

        # Step 5: Auto-run (just log intent — actual match creation is done by caller)
        match_id = None
        if auto_run and plan_id:
            _append_step(run_id, "Auto-run requested — match will be created by the system")
            # The actual match creation is handled in the async wrapper in server.py

        _append_step(run_id, "Scout run completed")
        _update_run(run_id, status="completed", ended_at=datetime.utcnow().isoformat(), match_id=match_id)

        return {
            "run_id": run_id, "status": "completed",
            "changes": True, "plan_id": plan_id,
            "cases_generated": cases_count, "match_id": match_id,
        }

    except Exception as e:
        logger.exception(f"Scout run {run_id} failed: {e}")
        _append_step(run_id, f"Error: {e}")
        _update_run(run_id, status="error", ended_at=datetime.utcnow().isoformat(), error=str(e))
        return {"run_id": run_id, "status": "error", "error": str(e)}


# ── Scheduler ────────────────────────────────────────────────────

_scheduler_task = None


async def start_scheduler():
    """Start the asyncio background scheduler. Checks every 60s for due schedules."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return  # Already running

    async def _loop():
        logger.info("Scout scheduler started")
        while True:
            try:
                await _check_schedules()
            except Exception as e:
                logger.exception(f"Scheduler error: {e}")
            await asyncio.sleep(60)

    _scheduler_task = asyncio.create_task(_loop())


async def _check_schedules():
    """Check for due schedules and trigger them."""
    now = datetime.utcnow()
    schedules = list_schedules()

    for sched in schedules:
        if not sched["enabled"]:
            continue
        next_run_str = sched.get("next_run_at")
        if not next_run_str:
            continue

        try:
            next_run = datetime.fromisoformat(next_run_str)
        except ValueError:
            continue

        if now >= next_run:
            logger.info(f"Triggering scheduled scout: {sched['name']} ({sched['id']})")

            # Run scout in thread to avoid blocking
            await asyncio.to_thread(
                run_scout,
                sched["env_key"],
                sched["source_ids"] or None,
                sched["auto_generate"],
                sched["auto_run"],
                sched["auto_approve"],
                sched.get("model", "sonnet"),
                sched["id"],
                "scheduled",
            )

            # Update schedule with next run time
            interval_s = INTERVAL_SECONDS.get(sched["interval"], 86400)
            new_next = (now + timedelta(seconds=interval_s)).isoformat()
            with _get_conn() as conn:
                conn.execute(
                    "UPDATE scout_schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
                    (now.isoformat(), new_next, now.isoformat(), sched["id"]),
                )
