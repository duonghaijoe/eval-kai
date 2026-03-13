"""Test Generator — AI-powered test case generation from data source items.

Uses Claude CLI subprocess to generate structured test cases from requirements,
MCP tool definitions, and free-text context.
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

def init_test_generator_db():
    """Create test_plans and test_cases tables."""
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS test_plans (
                id TEXT PRIMARY KEY,
                env_key TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                source_ids TEXT DEFAULT '[]',
                source_summary TEXT,
                total_cases INTEGER DEFAULT 0,
                approved_cases INTEGER DEFAULT 0,
                model TEXT DEFAULT 'sonnet',
                error TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS test_cases (
                id TEXT PRIMARY KEY,
                plan_id TEXT REFERENCES test_plans(id) ON DELETE CASCADE,
                env_key TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                mode TEXT NOT NULL DEFAULT 'fixed',
                priority TEXT DEFAULT 'medium',
                category TEXT DEFAULT 'general',
                steps TEXT DEFAULT '[]',
                goal TEXT,
                max_turns INTEGER DEFAULT 10,
                tags TEXT DEFAULT '[]',
                status TEXT DEFAULT 'draft',
                source_items TEXT DEFAULT '[]',
                mcp_tools_tested TEXT DEFAULT '[]',
                last_run_at TEXT,
                last_run_score REAL,
                run_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_tc_plan ON test_cases(plan_id);
            CREATE INDEX IF NOT EXISTS idx_tc_env ON test_cases(env_key);
            CREATE INDEX IF NOT EXISTS idx_tc_status ON test_cases(status);
        """)


# ── Test Plans CRUD ──────────────────────────────────────────────

def create_test_plan(env_key: str, name: str, source_ids: list, model: str = "sonnet") -> dict:
    plan_id = str(uuid.uuid4())[:8]
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO test_plans (id, env_key, name, source_ids, model, status)
               VALUES (?, ?, ?, ?, ?, 'pending')""",
            (plan_id, env_key, name, json.dumps(source_ids), model),
        )
    return get_test_plan(plan_id)


def get_test_plan(plan_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM test_plans WHERE id = ?", (plan_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["source_ids"] = json.loads(d.get("source_ids") or "[]")
        return d


def list_test_plans(env_key: str = None) -> list:
    with _get_conn() as conn:
        if env_key:
            rows = conn.execute(
                "SELECT * FROM test_plans WHERE env_key = ? ORDER BY created_at DESC",
                (env_key,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM test_plans ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["source_ids"] = json.loads(d.get("source_ids") or "[]")
            result.append(d)
        return result


def _update_plan(plan_id: str, **kwargs):
    allowed = {"status", "source_summary", "total_cases", "approved_cases", "error"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    fields["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [plan_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE test_plans SET {sets} WHERE id = ?", vals)


def delete_test_plan(plan_id: str) -> bool:
    with _get_conn() as conn:
        result = conn.execute("DELETE FROM test_plans WHERE id = ?", (plan_id,))
        return result.rowcount > 0


# ── Test Cases CRUD ──────────────────────────────────────────────

def _parse_case(row) -> dict:
    d = dict(row)
    for field in ("steps", "tags", "source_items", "mcp_tools_tested", "depends_on", "parameters"):
        d[field] = json.loads(d.get(field) or "[]")
    return d


def get_test_case(case_id: str) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM test_cases WHERE id = ?", (case_id,)).fetchone()
        return _parse_case(row) if row else None


def list_test_cases(plan_id: str = None, env_key: str = None, status: str = None,
                     folder_id: str = None) -> list:
    with _get_conn() as conn:
        conditions = []
        params = []
        if plan_id:
            conditions.append("plan_id = ?")
            params.append(plan_id)
        if env_key:
            conditions.append("env_key = ?")
            params.append(env_key)
        if status:
            conditions.append("status = ?")
            params.append(status)
        if folder_id == "__unorganized":
            conditions.append("folder_id IS NULL")
        elif folder_id:
            conditions.append("folder_id = ?")
            params.append(folder_id)
        where = " AND ".join(conditions) if conditions else "1=1"
        rows = conn.execute(
            f"SELECT * FROM test_cases WHERE {where} ORDER BY sort_order, priority, name",
            params,
        ).fetchall()
        return [_parse_case(r) for r in rows]


def update_test_case(case_id: str, **kwargs) -> Optional[dict]:
    allowed = {"name", "description", "mode", "priority", "category", "steps", "goal",
               "max_turns", "tags", "status", "source_items", "mcp_tools_tested",
               "last_run_at", "last_run_score", "run_count",
               "folder_id", "sort_order", "depends_on", "parameters", "template"}
    fields = {}
    for k, v in kwargs.items():
        if k in allowed:
            if k in ("steps", "tags", "source_items", "mcp_tools_tested", "depends_on", "parameters") and isinstance(v, list):
                v = json.dumps(v)
            fields[k] = v
    if not fields:
        return get_test_case(case_id)
    fields["updated_at"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [case_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE test_cases SET {sets} WHERE id = ?", vals)
    return get_test_case(case_id)


def bulk_approve_cases(case_ids: list) -> int:
    with _get_conn() as conn:
        count = 0
        for cid in case_ids:
            r = conn.execute(
                "UPDATE test_cases SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'draft'",
                (cid,),
            )
            count += r.rowcount
        # Update plan counts
        plans = conn.execute(
            "SELECT DISTINCT plan_id FROM test_cases WHERE id IN ({})".format(
                ",".join("?" for _ in case_ids)
            ), case_ids,
        ).fetchall()
        for p in plans:
            _recount_plan_approvals(conn, p["plan_id"])
    return count


def delete_test_case(case_id: str) -> bool:
    with _get_conn() as conn:
        row = conn.execute("SELECT plan_id FROM test_cases WHERE id = ?", (case_id,)).fetchone()
        result = conn.execute("DELETE FROM test_cases WHERE id = ?", (case_id,))
        if result.rowcount > 0 and row:
            _recount_plan_totals(conn, row["plan_id"])
        return result.rowcount > 0


def bulk_delete_cases(case_ids: list) -> int:
    with _get_conn() as conn:
        count = 0
        plan_ids = set()
        for cid in case_ids:
            row = conn.execute("SELECT plan_id FROM test_cases WHERE id = ?", (cid,)).fetchone()
            if row:
                plan_ids.add(row["plan_id"])
            r = conn.execute("DELETE FROM test_cases WHERE id = ?", (cid,))
            count += r.rowcount
        for pid in plan_ids:
            _recount_plan_totals(conn, pid)
    return count


def _recount_plan_totals(conn, plan_id: str):
    row = conn.execute(
        "SELECT COUNT(*) as total FROM test_cases WHERE plan_id = ?", (plan_id,)
    ).fetchone()
    conn.execute(
        "UPDATE test_plans SET total_cases = ?, updated_at = datetime('now') WHERE id = ?",
        (row["total"], plan_id),
    )
    _recount_plan_approvals(conn, plan_id)


def _recount_plan_approvals(conn, plan_id: str):
    row = conn.execute(
        "SELECT COUNT(*) as cnt FROM test_cases WHERE plan_id = ? AND status = 'approved'",
        (plan_id,),
    ).fetchone()
    conn.execute(
        "UPDATE test_plans SET approved_cases = ?, updated_at = datetime('now') WHERE id = ?",
        (row["cnt"], plan_id),
    )


# ── Generation Engine ────────────────────────────────────────────

def generate_test_plan(env_key: str, source_ids: list, model: str = "sonnet",
                       name: str = None) -> dict:
    """Generate test cases from data source items using Claude CLI.

    Returns the created test plan dict.
    """
    from data_sources import get_items_for_env

    plan_name = name or f"Test Plan {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
    plan = create_test_plan(env_key, plan_name, source_ids, model)
    plan_id = plan["id"]

    try:
        _update_plan(plan_id, status="generating")

        # Gather items from data sources
        items = get_items_for_env(env_key, source_ids if source_ids else None)
        if not items:
            _update_plan(plan_id, status="error", error="No data source items found. Sync your sources first.")
            return get_test_plan(plan_id)

        # Group items by type for the prompt
        requirements = [i for i in items if i["item_type"] in ("epic", "story", "bug", "page", "context")]
        tools = [i for i in items if i["item_type"] == "tool"]

        # Build summary
        summary_parts = []
        for item in requirements[:50]:
            summary_parts.append(f"- [{item['item_type'].upper()}] {item['title']}: {(item.get('content') or '')[:200]}")
        source_summary = "\n".join(summary_parts[:50])
        _update_plan(plan_id, source_summary=source_summary[:5000])

        # Chunk large requirement sets by groups of 20
        req_chunks = [requirements[i:i+20] for i in range(0, len(requirements), 20)] if requirements else [[]]

        all_cases = []
        # Pass 1: requirement-driven generation (tools as context only)
        for chunk in req_chunks:
            prompt = _build_generation_prompt(chunk, tools)
            cases = _call_claude_for_cases(prompt, model)
            all_cases.extend(cases)

        # Pass 2: dedicated MCP tool coverage generation
        # Collect tools already covered by Pass 1
        covered_tools = set()
        for case in all_cases:
            for t in case.get("mcp_tools_tested", []):
                covered_tools.add(t)
        uncovered_tools = [t for t in tools if t["title"] not in covered_tools]
        if uncovered_tools:
            logger.info(f"Pass 2: {len(uncovered_tools)} uncovered tools out of {len(tools)} total")
            tool_chunks = [uncovered_tools[i:i+15] for i in range(0, len(uncovered_tools), 15)]
            for chunk in tool_chunks:
                prompt = _build_tool_coverage_prompt(chunk)
                cases = _call_claude_for_cases(prompt, model)
                all_cases.extend(cases)

        # Store generated cases
        with _get_conn() as conn:
            for case in all_cases:
                case_id = str(uuid.uuid4())[:8]
                conn.execute(
                    """INSERT INTO test_cases
                       (id, plan_id, env_key, name, description, mode, priority, category,
                        steps, goal, max_turns, tags, status, source_items, mcp_tools_tested)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)""",
                    (case_id, plan_id, env_key,
                     case.get("name", "Unnamed Test"),
                     case.get("description", ""),
                     case.get("mode", "fixed"),
                     case.get("priority", "medium"),
                     case.get("category", "general"),
                     json.dumps(case.get("steps", [])),
                     case.get("goal", ""),
                     case.get("max_turns", 10),
                     json.dumps(case.get("tags", [])),
                     json.dumps(case.get("source_items", [])),
                     json.dumps(case.get("mcp_tools_tested", []))),
                )

        _update_plan(plan_id, status="ready", total_cases=len(all_cases))
        return get_test_plan(plan_id)

    except Exception as e:
        logger.exception(f"Test generation failed for plan {plan_id}: {e}")
        _update_plan(plan_id, status="error", error=str(e))
        return get_test_plan(plan_id)


def _build_generation_prompt(requirements: list, tools: list) -> str:
    """Build the prompt for Claude to generate test cases."""
    req_text = ""
    for item in requirements:
        req_text += f"\n### {item['title']}\n{item.get('content', '')[:500]}\n"

    tool_text = ""
    if tools:
        tool_text = "\n## Available MCP Tools\n"
        for t in tools:
            tool_text += f"- **{t['title']}**: {t.get('content', '')[:300]}\n"

    prompt = f"""You are a test case generator for Kai, an AI coding agent. Generate test cases from the following requirements and tool definitions.

## Requirements
{req_text}
{tool_text}

## Instructions
Generate test cases in JSON format. Each test case should:
1. Cover a specific requirement or user story
2. Be either "fixed" mode (step-by-step messages) or "hybrid" mode (goal-based)
3. Include traceability to source requirements
4. Test specific MCP tools when applicable
5. Have clear priority (high/medium/low) and category

Output a JSON array of test case objects with this structure:
```json
[
  {{
    "name": "Test case name",
    "description": "What this test verifies",
    "mode": "fixed",
    "priority": "high",
    "category": "functional",
    "steps": [{{"name": "Step 1", "message": "User message to send"}}],
    "goal": "",
    "max_turns": 5,
    "tags": ["auth", "login"],
    "source_items": [{{"external_id": "QUAL-123", "title": "Story title"}}],
    "mcp_tools_tested": ["create_test", "run_test"]
  }},
  {{
    "name": "Explore test name",
    "description": "Goal-based exploration test",
    "mode": "hybrid",
    "priority": "medium",
    "category": "exploratory",
    "steps": [],
    "goal": "Test whether Kai can help with X by doing Y",
    "max_turns": 10,
    "tags": ["exploration"],
    "source_items": [{{"external_id": "QUAL-456", "title": "Epic title"}}],
    "mcp_tools_tested": []
  }}
]
```

Generate 10-20 test cases covering ALL the requirements provided. For each MCP tool listed above, create at least one test case that exercises it. Mix fixed and hybrid modes (roughly 60% fixed, 40% hybrid).
Output ONLY the JSON array, no other text."""

    return prompt


def _build_tool_coverage_prompt(tools: list) -> str:
    """Build a prompt specifically for generating test cases to cover MCP tools."""
    tool_text = ""
    for t in tools:
        tool_text += f"- **{t['title']}**: {t.get('content', '')[:300]}\n"

    prompt = f"""You are a test case generator for Kai, an AI coding agent. Generate test cases that specifically exercise the following MCP tools. Each tool MUST have at least one dedicated test case.

## MCP Tools to Cover
{tool_text}

## Instructions
Generate EXACTLY one test case per tool listed above ({len(tools)} test cases total). Each test case should:
1. Specifically exercise the named MCP tool
2. Be either "fixed" mode (step-by-step messages to trigger tool usage) or "hybrid" mode (goal-based)
3. Include the tool name in "mcp_tools_tested"
4. Have realistic user messages that would naturally trigger the tool
5. Have clear priority (high/medium/low) and category

Output a JSON array of test case objects with this structure:
```json
[
  {{
    "name": "Test [tool_name] functionality",
    "description": "Verify Kai can use [tool_name] to accomplish X",
    "mode": "fixed",
    "priority": "medium",
    "category": "tool_coverage",
    "steps": [{{"name": "Step 1", "message": "User message that triggers the tool"}}],
    "goal": "",
    "max_turns": 5,
    "tags": ["mcp_tool", "tool_coverage"],
    "source_items": [],
    "mcp_tools_tested": ["tool_name"]
  }}
]
```

IMPORTANT: Generate exactly {len(tools)} test cases — one per tool. Do not skip any tool.
Mix fixed and hybrid modes (roughly 60% fixed, 40% hybrid).
Output ONLY the JSON array, no other text."""

    return prompt


def _call_claude_for_cases(prompt: str, model: str = "sonnet") -> list:
    """Call Claude CLI and parse the JSON response into test cases."""
    from actor_brain import _call_claude

    response = _call_claude(prompt, model=model, max_tokens=8192)
    if not response:
        raise ValueError("Claude CLI returned empty response")

    # Extract JSON array from response
    return _parse_json_cases(response)


def _parse_json_cases(text: str) -> list:
    """Parse JSON array from Claude's response, handling markdown code blocks."""
    # Try direct parse first
    text = text.strip()
    if text.startswith("["):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

    # Try extracting from code block
    import re
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try finding array in text
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse test cases from Claude response: {text[:200]}")


# ── Regenerate & Promote ─────────────────────────────────────────

def regenerate_case(case_id: str, feedback: str = "", model: str = "sonnet") -> Optional[dict]:
    """Re-generate a single test case with optional feedback."""
    from actor_brain import _call_claude

    case = get_test_case(case_id)
    if not case:
        return None

    prompt = f"""Regenerate this test case based on feedback.

## Current Test Case
Name: {case['name']}
Description: {case['description']}
Mode: {case['mode']}
Steps: {json.dumps(case['steps'])}
Goal: {case.get('goal', '')}

## Feedback
{feedback or 'Improve the quality and coverage of this test case.'}

Output ONLY a single JSON object (not an array) with the same structure:
{{"name": "...", "description": "...", "mode": "fixed|hybrid", "priority": "high|medium|low", "category": "...", "steps": [...], "goal": "...", "max_turns": N, "tags": [...], "source_items": [...], "mcp_tools_tested": [...]}}"""

    response = _call_claude(prompt, model=model, max_tokens=2048)
    if not response:
        return case

    try:
        # Parse single object
        text = response.strip()
        import re
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            new_case = json.loads(match.group(0))
            update_test_case(case_id, **{k: v for k, v in new_case.items()
                                          if k in ("name", "description", "mode", "priority",
                                                    "category", "steps", "goal", "max_turns",
                                                    "tags", "source_items", "mcp_tools_tested")})
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse regenerated case: {e}")

    return get_test_case(case_id)


def promote_case_to_scenario(case_id: str) -> Optional[dict]:
    """Copy an approved test case to custom_scenarios for backward compatibility."""
    case = get_test_case(case_id)
    if not case:
        return None

    scenario_id = f"gen-{case_id}"
    with _get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO custom_scenarios (id, name, description, category, steps, tags)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (scenario_id, case["name"], case["description"] or case["name"],
             case["category"], json.dumps(case["steps"]), json.dumps(case["tags"])),
        )
        # Mark test case as promoted
        tags = case.get("tags", [])
        if "promoted" not in tags:
            tags.append("promoted")
        conn.execute(
            "UPDATE test_cases SET tags = ?, updated_at = datetime('now') WHERE id = ?",
            (json.dumps(tags), case_id),
        )
    return {"scenario_id": scenario_id, "case_id": case_id}
