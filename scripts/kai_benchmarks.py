"""
Kai Benchmarks — Industry-standard scoring thresholds for AI agent evaluation.

Based on market research from:
- Forrester Research (2023): 73% users abandon chats after 5s
- Google UX benchmarks: 1.5s optimal for chatbot UX
- Nielsen Norman Group: 0.1s=instant, 1s=flow, 10s=attention limit
- Anthropic agent eval framework: multi-dimensional rubrics
- Microsoft Copilot Studio: completeness, relevance, groundedness
- AgentBench / SWE-agent evaluation standards

Thresholds are STRICT — calibrated against market leaders (ChatGPT-4o,
Copilot, Gemini, Claude) to expose gaps and drive improvement. An agentic
AI in 2026 must compete on speed, not get free passes for being "complex".
"""

# ── TTFT (Time to First Token / First Response) ───────────────────
# How fast Kai acknowledges the request and starts processing.
# This is the initial API round-trip — no excuse for being slow here
# since it's just accepting the request, not doing work yet.
#
# Market reference:
#   ChatGPT-4o: ~800ms    Gemini Pro: ~600ms
#   Claude:     ~700ms    Copilot:    ~1200ms
#
# Research basis:
#   < 0.1s = feels instant (Nielsen)
#   < 1s   = uninterrupted cognitive flow
#   1-2s   = Google UX "acceptable" threshold
#   > 3s   = user notices delay
#   > 5s   = 73% abandon rate (Forrester)

TTFB_THRESHOLDS = {
    "excellent": {"max_ms": 500,  "score": 5, "label": "Excellent", "color": "#22c55e"},
    "good":      {"max_ms": 1000, "score": 4, "label": "Good",      "color": "#84cc16"},
    "acceptable":{"max_ms": 2000, "score": 3, "label": "Acceptable","color": "#eab308"},
    "critical":  {"max_ms": float("inf"), "score": 1, "label": "Critical", "color": "#ef4444"},
}

# ── Total Response Time (Full Answer) ────────────────────────────
# End-to-end time from user message to complete Kai response.
# Includes tool execution, polling, and response generation.
#
# Market reference (complex queries with tool use):
#   ChatGPT-4o: ~12s     Gemini Pro: ~10s
#   Claude:     ~12s     Copilot:    ~15s
#
# Strict thresholds — top competitors deliver complex answers
# in 10-15s. Kai should target the same, not 2-3x slower.

TOTAL_THRESHOLDS = {
    "excellent": {"max_ms": 5000,  "score": 5, "label": "Excellent", "color": "#22c55e"},
    "good":      {"max_ms": 10000, "score": 4, "label": "Good",      "color": "#84cc16"},
    "acceptable":{"max_ms": 20000, "score": 3, "label": "Acceptable","color": "#eab308"},
    "critical":  {"max_ms": float("inf"), "score": 1, "label": "Critical", "color": "#ef4444"},
}

# ── Quality Dimensions ────────────────────────────────────────────
# Based on Anthropic's eval framework, Google Vertex AI eval metrics,
# Microsoft Copilot Studio quality metrics, and Databricks agent eval.
#
# Each dimension is scored 1-5 with clear rubric definitions.

QUALITY_RUBRICS = {
    "relevance": {
        "description": "Does the response directly address the user's question or request?",
        "source": "Google Vertex AI / Microsoft Copilot Studio",
        "rubric": {
            5: "Precisely answers the question with zero filler; every sentence adds value. No boilerplate.",
            4: "Addresses the question well but includes some padding, caveats, or tangential sections that dilute focus",
            3: "Partially addresses the question; mixes relevant content with generic advice or off-topic material",
            2: "Loosely related; mostly boilerplate, generic lists, or template responses not specific to the query",
            1: "Does not address the question; irrelevant, evasive, or entirely off-topic response",
        },
    },
    "accuracy": {
        "description": "Is the information factually correct and grounded in real data (no hallucinations)?",
        "source": "Anthropic eval framework / Databricks groundedness",
        "rubric": {
            5: "Every claim is verifiable against the actual system; data is precise (IDs, numbers, dates match reality)",
            4: "Accurate overall; minor rounding or imprecise phrasing that doesn't mislead",
            3: "Some claims are accurate but others are unverifiable, vague, or potentially fabricated",
            2: "Contains hallucinated data (fake IDs, wrong numbers, invented features) mixed with real info",
            1: "Predominantly fabricated; confidently wrong information that would mislead the user",
        },
    },
    "helpfulness": {
        "description": "Does the response help the user make progress toward their goal?",
        "source": "Anthropic eval framework / AgentBench task completion",
        "rubric": {
            5: "User's task is DONE after this response — no follow-up needed. Actionable, complete, specific.",
            4: "Provides concrete next steps; user needs only minor clarification or one more turn",
            3: "Gives direction but requires significant follow-up; asks clarifying questions instead of acting",
            2: "Mostly filler; lists options or asks questions without making progress toward the goal",
            1: "Blocks progress; no actionable information, or suggests impossible/wrong actions",
        },
    },
    "tool_usage": {
        "description": "Did the agent use appropriate tools/APIs correctly and efficiently?",
        "source": "AgentBench / SWE-agent tool invocation evaluation",
        "rubric": {
            5: "Optimal tool selection and execution; minimal calls, results fully integrated into response",
            4: "Correct tools used but with minor waste (redundant calls, unused results, extra round-trips)",
            3: "Used some tools but missed key ones, or made unnecessary calls that added latency",
            2: "Poor tool strategy; wrong tools chosen, failed calls not recovered, or results ignored",
            1: "No tool usage when tools were clearly needed, or complete tool misuse",
        },
    },
    "context_retention": {
        "description": "Does the agent maintain conversation context across turns?",
        "source": "AgentBench multi-turn evaluation / enterprise AI requirements",
        "rubric": {
            5: "Explicitly references prior turns; builds on previous answers; no redundant re-explanation",
            4: "Maintains context but occasionally re-explains something already covered",
            3: "Some context carried forward but key details from earlier turns are lost or ignored",
            2: "Treats turns mostly independently; repeats introductions, re-fetches data already retrieved",
            1: "Complete context loss; responds as if each turn is a brand new conversation",
        },
    },
}

# ── Overall Score Bands ───────────────────────────────────────────
# STRICT grading — A+ is genuinely hard to achieve.
# Market context: Top AI assistants score 3.5-4.2 in independent evals.
# A score of 4.0+ means genuinely best-in-class.

GRADE_BANDS = {
    "A+": {"min": 4.7, "label": "Best-in-class",   "color": "#22c55e", "description": "Outperforms market leaders; production-ready excellence"},
    "A":  {"min": 4.2, "label": "Strong",           "color": "#4ade80", "description": "Competitive with top AI assistants; minor polish needed"},
    "B":  {"min": 3.5, "label": "Good",             "color": "#84cc16", "description": "Above average but notable gaps vs competitors"},
    "C":  {"min": 2.8, "label": "Needs Work",       "color": "#eab308", "description": "Below market average; multiple areas need improvement"},
    "D":  {"min": 2.0, "label": "Below Standard",   "color": "#f97316", "description": "Significant quality issues; not competitive"},
    "F":  {"min": 0.0, "label": "Failing",          "color": "#ef4444", "description": "Fundamental issues; not ready for users"},
}

# ── Competitor Reference Points ───────────────────────────────────
# Approximate benchmarks for context (sources: Artificial Analysis,
# public benchmarks, enterprise reports).

COMPETITOR_BENCHMARKS = {
    "chatgpt_4o": {
        "name": "ChatGPT-4o",
        "ttfb_ms": 800,
        "total_simple_ms": 3000,
        "total_complex_ms": 12000,
        "quality_avg": 4.2,
    },
    "copilot_m365": {
        "name": "Microsoft 365 Copilot",
        "ttfb_ms": 1200,
        "total_simple_ms": 5000,
        "total_complex_ms": 15000,
        "quality_avg": 3.8,
    },
    "gemini_pro": {
        "name": "Gemini Pro",
        "ttfb_ms": 600,
        "total_simple_ms": 2500,
        "total_complex_ms": 10000,
        "quality_avg": 4.0,
    },
    "claude_sonnet": {
        "name": "Claude Sonnet",
        "ttfb_ms": 700,
        "total_simple_ms": 3000,
        "total_complex_ms": 12000,
        "quality_avg": 4.3,
    },
}


# ── Scoring Functions ─────────────────────────────────────────────

def score_ttfb(ttfb_ms: float) -> dict:
    """Score a TTFB value against industry benchmarks."""
    for tier, cfg in TTFB_THRESHOLDS.items():
        if ttfb_ms <= cfg["max_ms"]:
            return {"tier": tier, "score": cfg["score"], "label": cfg["label"],
                    "color": cfg["color"], "value_ms": round(ttfb_ms, 1)}
    return {"tier": "critical", "score": 1, "label": "Critical",
            "color": "#ef4444", "value_ms": round(ttfb_ms, 1)}


def score_total(total_ms: float) -> dict:
    """Score a total response time against industry benchmarks."""
    for tier, cfg in TOTAL_THRESHOLDS.items():
        if total_ms <= cfg["max_ms"]:
            return {"tier": tier, "score": cfg["score"], "label": cfg["label"],
                    "color": cfg["color"], "value_ms": round(total_ms, 1)}
    return {"tier": "critical", "score": 1, "label": "Critical",
            "color": "#ef4444", "value_ms": round(total_ms, 1)}


def score_latency(ttfb_ms: float, total_ms: float) -> dict:
    """Combined latency score (weighted: TTFB 40%, Total 60%)."""
    ttfb = score_ttfb(ttfb_ms)
    total = score_total(total_ms)
    combined = round(ttfb["score"] * 0.4 + total["score"] * 0.6, 1)
    return {
        "ttfb": ttfb,
        "total": total,
        "combined_score": combined,
        "combined_label": get_grade(combined)["label"],
    }


def get_grade(score: float) -> dict:
    """Get letter grade for a numeric score."""
    for grade, cfg in GRADE_BANDS.items():
        if score >= cfg["min"]:
            return {"grade": grade, **cfg}
    return {"grade": "F", **GRADE_BANDS["F"]}


def score_match_latency(rounds: list) -> dict:
    """Score latency across all rounds in a match."""
    ttfbs = [r.get("ttfb_ms", 0) for r in rounds if r.get("ttfb_ms", 0) > 0]
    totals = [r.get("total_ms", 0) for r in rounds if r.get("total_ms", 0) > 0]

    if not ttfbs or not totals:
        return {"error": "No latency data"}

    def avg(v): return sum(v) / len(v) if v else 0
    def pct(v, p):
        s = sorted(v)
        return s[min(int(len(s) * p), len(s) - 1)] if s else 0

    ttfb_avg = avg(ttfbs)
    total_avg = avg(totals)

    per_round = []
    for r in rounds:
        tt = r.get("ttfb_ms", 0)
        to = r.get("total_ms", 0)
        if tt > 0 and to > 0:
            per_round.append(score_latency(tt, to))

    return {
        "ttfb": {
            "avg_ms": round(ttfb_avg, 1),
            "p50_ms": round(pct(ttfbs, 0.5), 1),
            "p95_ms": round(pct(ttfbs, 0.95), 1),
            "max_ms": round(max(ttfbs), 1),
            "score": score_ttfb(ttfb_avg),
        },
        "total": {
            "avg_ms": round(total_avg, 1),
            "p50_ms": round(pct(totals, 0.5), 1),
            "p95_ms": round(pct(totals, 0.95), 1),
            "max_ms": round(max(totals), 1),
            "score": score_total(total_avg),
        },
        "combined_score": round(
            score_ttfb(ttfb_avg)["score"] * 0.4 + score_total(total_avg)["score"] * 0.6, 1
        ),
        "per_round": per_round,
        "vs_competitors": _compare_to_competitors(ttfb_avg, total_avg),
    }


def _compare_to_competitors(ttfb_ms: float, total_ms: float) -> list:
    """Compare Kai's latency against known competitor benchmarks."""
    results = []
    for key, comp in COMPETITOR_BENCHMARKS.items():
        ttfb_diff = ((ttfb_ms - comp["ttfb_ms"]) / comp["ttfb_ms"]) * 100
        total_diff = ((total_ms - comp["total_complex_ms"]) / comp["total_complex_ms"]) * 100
        results.append({
            "competitor": comp["name"],
            "ttfb_diff_pct": round(ttfb_diff, 1),
            "total_diff_pct": round(total_diff, 1),
            "ttfb_label": "faster" if ttfb_diff < 0 else "slower",
            "total_label": "faster" if total_diff < 0 else "slower",
        })
    return results


def score_superfight(latency: dict, quality: dict, error_rate: float) -> dict:
    """Score a superfight (load test) using the same benchmarks as matches.

    Args:
        latency: dict with avg_ttfb_ms, avg_total_ms, p95_ttfb_ms, p95_total_ms
        quality: dict with response_rate, completion_rate, tool_engagement
        error_rate: fraction of bouts that errored (0.0 - 1.0)

    Returns:
        Comprehensive scoring with grades, matching the match eval format.
    """
    avg_ttfb = latency.get("avg_ttfb_ms", 0)
    avg_total = latency.get("avg_total_ms", 0)
    p95_ttfb = latency.get("p95_ttfb_ms", 0)
    p95_total = latency.get("p95_total_ms", 0)

    # Score latency (same thresholds as matches)
    ttfb_score = score_ttfb(avg_ttfb) if avg_ttfb > 0 else {"tier": "n/a", "score": 0}
    total_score = score_total(avg_total) if avg_total > 0 else {"tier": "n/a", "score": 0}
    p95_ttfb_score = score_ttfb(p95_ttfb) if p95_ttfb > 0 else {"tier": "n/a", "score": 0}
    p95_total_score = score_total(p95_total) if p95_total > 0 else {"tier": "n/a", "score": 0}

    # Quality scoring (convert 0-1 rates to 1-5 scale)
    resp_rate = quality.get("response_rate", 0)
    comp_rate = quality.get("completion_rate", 0)
    tool_eng = quality.get("tool_engagement", 0)

    def rate_to_score(rate):
        if rate >= 0.98: return 5
        if rate >= 0.90: return 4
        if rate >= 0.75: return 3
        if rate >= 0.50: return 2
        return 1

    # Error rate scoring (inverted — lower is better)
    def error_to_score(rate):
        if rate <= 0.02: return 5
        if rate <= 0.05: return 4
        if rate <= 0.15: return 3
        if rate <= 0.30: return 2
        return 1

    response_score = rate_to_score(resp_rate)
    completion_score = rate_to_score(comp_rate)
    tool_score = rate_to_score(tool_eng)
    error_score = error_to_score(error_rate)

    # Overall: weighted combination
    # Latency 40% (avg 20% + p95 20%), Quality 35%, Reliability 25%
    latency_avg_score = (ttfb_score.get("score", 0) * 0.4 + total_score.get("score", 0) * 0.6) if avg_ttfb > 0 else 0
    latency_p95_score = (p95_ttfb_score.get("score", 0) * 0.4 + p95_total_score.get("score", 0) * 0.6) if p95_ttfb > 0 else 0
    quality_score = (response_score * 0.4 + completion_score * 0.3 + tool_score * 0.3)
    reliability_score = error_score

    overall = round(
        latency_avg_score * 0.2 +
        latency_p95_score * 0.2 +
        quality_score * 0.35 +
        reliability_score * 0.25,
        1
    )

    grade = get_grade(overall)

    return {
        "overall_score": overall,
        "grade": grade["grade"],
        "grade_label": grade["label"],
        "grade_color": grade["color"],
        "latency": {
            "avg": {"ttfb": ttfb_score, "total": total_score, "combined": round(latency_avg_score, 1)},
            "p95": {"ttfb": p95_ttfb_score, "total": p95_total_score, "combined": round(latency_p95_score, 1)},
        },
        "quality": {
            "response_rate": {"value": resp_rate, "score": response_score},
            "completion_rate": {"value": comp_rate, "score": completion_score},
            "tool_engagement": {"value": tool_eng, "score": tool_score},
        },
        "reliability": {
            "error_rate": {"value": error_rate, "score": error_score},
        },
        "vs_competitors": _compare_to_competitors(avg_ttfb, avg_total) if avg_ttfb > 0 else [],
    }


def generate_evaluation_template(rounds: list, goal: str = "") -> dict:
    """Generate an evaluation template with benchmarked latency scores pre-filled."""
    latency = score_match_latency(rounds)

    round_evals = []
    for i, r in enumerate(rounds):
        tt = r.get("ttfb_ms", 0)
        to = r.get("total_ms", 0)
        round_evals.append({
            "round": i + 1,
            "latency_score": score_latency(tt, to) if tt > 0 else None,
            # These should be filled by Claude's qualitative evaluation:
            "relevance": 0,
            "accuracy": 0,
            "helpfulness": 0,
            "tool_usage": 0,
            "feedback": "",
        })

    return {
        "goal": goal,
        "overall_score": 0,
        "latency_benchmark": latency,
        "rounds": round_evals,
        "overall": {
            "goal_achievement": {"score": 0, "reason": ""},
            "context_retention": {"score": 0, "reason": ""},
            "error_handling": {"score": 0, "reason": ""},
            "response_quality": {"score": 0, "reason": ""},
        },
        "issues": [],
        "rubrics": {k: {s: d for s, d in v["rubric"].items()} for k, v in QUALITY_RUBRICS.items()},
    }
