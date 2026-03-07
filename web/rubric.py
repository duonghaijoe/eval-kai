"""Rubric configuration for Kai evaluation scoring.

The rubric defines scoring criteria for each dimension (1-5).
It can be modified via API or directly in this file as defaults.
Runtime changes are persisted to data/rubric.json.
"""
import json
import os

_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_rubric_path = os.path.join(_data_dir, "rubric.json")

DEFAULT_RUBRIC = {
    "turn_dimensions": {
        "relevance": {
            "name": "Relevance",
            "description": "Did Kai's response address the question?",
            "weight": 1.0,
            "scores": {
                "1": "Completely off-topic or ignores the question",
                "2": "Partially related but misses the main point",
                "3": "Addresses the question but lacks depth or precision",
                "4": "Good, relevant response with minor gaps",
                "5": "Perfectly addresses the question with clear focus",
            },
        },
        "accuracy": {
            "name": "Accuracy",
            "description": "Was the information correct? No hallucinations?",
            "weight": 1.0,
            "scores": {
                "1": "Mostly incorrect or fabricated information",
                "2": "Several factual errors or misleading claims",
                "3": "Generally correct with some inaccuracies",
                "4": "Accurate with only minor imprecisions",
                "5": "Fully accurate, no hallucinations or errors",
            },
        },
        "helpfulness": {
            "name": "Helpfulness",
            "description": "Was the response actionable and useful?",
            "weight": 1.0,
            "scores": {
                "1": "Not useful at all, no actionable information",
                "2": "Minimally useful, vague or generic advice",
                "3": "Somewhat useful but could be more specific",
                "4": "Helpful with clear, actionable guidance",
                "5": "Exceptionally useful, detailed and actionable",
            },
        },
        "tool_usage": {
            "name": "Tool Usage",
            "description": "Did Kai appropriately use tools/capabilities? Score 5 if no tools were needed and none were used.",
            "weight": 1.0,
            "scores": {
                "1": "Failed to use necessary tools or used them incorrectly",
                "2": "Poor tool selection or execution, missed obvious tool need",
                "3": "Used tools but with suboptimal selection or execution",
                "4": "Good tool selection and execution with minor inefficiencies",
                "5": "Optimal tool usage — or no tools needed and none were used",
            },
        },
        "latency": {
            "name": "Latency",
            "description": "Response time performance (auto-scored from thresholds)",
            "weight": 1.0,
            "auto_score": True,
            "thresholds": {
                "ttfb_ms": {"5": 3000, "4": 6000, "3": 10000, "2": 20000, "1": 999999},
                "total_ms": {"5": 15000, "4": 30000, "3": 60000, "2": 120000, "1": 999999},
            },
            "scores": {
                "1": "Very slow (TTFT >20s or total >120s)",
                "2": "Slow (TTFT >10s or total >60s)",
                "3": "Acceptable (TTFT >6s or total >30s)",
                "4": "Fast (TTFT >3s or total >15s)",
                "5": "Excellent (TTFT <3s and total <15s)",
            },
        },
    },
    "session_dimensions": {
        "goal_achievement": {
            "name": "Goal Achievement",
            "description": "Did Kai accomplish the test objective?",
            "weight": 1.5,
            "scores": {
                "1": "Failed completely, objective not met",
                "2": "Minimal progress toward the goal",
                "3": "Partially achieved the goal",
                "4": "Mostly achieved with minor gaps",
                "5": "Fully achieved the test objective",
            },
        },
        "context_retention": {
            "name": "Context Retention",
            "description": "Did Kai maintain context across turns?",
            "weight": 1.0,
            "scores": {
                "1": "No context awareness, each turn treated independently",
                "2": "Minimal context, frequent contradictions",
                "3": "Some context retained but inconsistent",
                "4": "Good context retention with minor lapses",
                "5": "Perfect context awareness across all turns",
            },
        },
        "error_handling": {
            "name": "Error Handling",
            "description": "How did Kai handle edge cases or errors?",
            "weight": 1.0,
            "scores": {
                "1": "Crashed or gave no useful error response",
                "2": "Poor error messages, no recovery",
                "3": "Basic error handling, some recovery",
                "4": "Good error handling with graceful recovery",
                "5": "Excellent — clear errors, smooth recovery, helpful guidance",
            },
        },
        "response_quality": {
            "name": "Response Quality",
            "description": "Overall quality of responses across the session",
            "weight": 1.0,
            "scores": {
                "1": "Very poor quality throughout",
                "2": "Below average, inconsistent quality",
                "3": "Average quality, meets basic expectations",
                "4": "High quality, well-structured responses",
                "5": "Exceptional quality, professional and thorough",
            },
        },
    },
    "pass_threshold": 3.0,  # Minimum overall score to pass (1-5)
}


def load_rubric() -> dict:
    """Load rubric from persisted file, or return defaults."""
    if os.path.exists(_rubric_path):
        try:
            with open(_rubric_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return DEFAULT_RUBRIC.copy()


def save_rubric(rubric: dict):
    """Persist rubric to file."""
    os.makedirs(_data_dir, exist_ok=True)
    with open(_rubric_path, "w") as f:
        json.dump(rubric, f, indent=2)


def reset_rubric() -> dict:
    """Reset rubric to defaults."""
    save_rubric(DEFAULT_RUBRIC)
    return DEFAULT_RUBRIC.copy()


def score_latency(ttfb_ms: float, total_ms: float, rubric: dict = None) -> int:
    """Auto-score latency based on rubric thresholds. Returns 1-5."""
    if rubric is None:
        rubric = load_rubric()
    thresholds = rubric.get("turn_dimensions", {}).get("latency", {}).get("thresholds", {})
    ttfb_th = thresholds.get("ttfb_ms", {})
    total_th = thresholds.get("total_ms", {})

    # Score is the minimum of TTFB score and total score
    ttfb_score = 1
    for score in ["5", "4", "3", "2"]:
        if ttfb_ms <= ttfb_th.get(score, 999999):
            ttfb_score = int(score)
            break

    total_score = 1
    for score in ["5", "4", "3", "2"]:
        if total_ms <= total_th.get(score, 999999):
            total_score = int(score)
            break

    return min(ttfb_score, total_score)


def format_rubric_for_prompt(rubric: dict = None) -> str:
    """Format turn dimensions as text for inclusion in evaluation prompts."""
    if rubric is None:
        rubric = load_rubric()
    lines = []
    for key, dim in rubric.get("turn_dimensions", {}).items():
        if dim.get("auto_score"):
            continue  # Skip auto-scored dimensions like latency
        lines.append(f"- {key}: {dim['description']}")
        for score, desc in dim.get("scores", {}).items():
            lines.append(f"  {score} = {desc}")
    return "\n".join(lines)


def format_session_rubric_for_prompt(rubric: dict = None) -> str:
    """Format session dimensions as text for inclusion in session evaluation prompts."""
    if rubric is None:
        rubric = load_rubric()
    lines = []
    for key, dim in rubric.get("session_dimensions", {}).items():
        lines.append(f"- {key}: {dim['description']}")
        for score, desc in dim.get("scores", {}).items():
            lines.append(f"  {score} = {desc}")
    return "\n".join(lines)
