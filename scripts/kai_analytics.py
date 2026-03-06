"""
Kai Analytics — Deep insights into Kai orchestrator agent behavior.

Analyzes results from kai_actor.py runs to produce:
- Latency analysis (TTFB, total, polling overhead)
- Tool call patterns (frequency, sequences, timing)
- Agent workflow visualization
- Error analysis and classification
- Performance trends over time

Usage:
    python scripts/kai_analytics.py analyze kai_results.json
    python scripts/kai_analytics.py compare results_v1.json results_v2.json
    python scripts/kai_analytics.py dashboard --dir ./kai-runs/
"""
import json
import os
import sys
import logging
from collections import Counter, defaultdict
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


class KaiAnalytics:
    """Analyze Kai agent test results for deep insights."""

    def __init__(self, results: list[dict] = None):
        self.results = results or []

    def load(self, filepath: str):
        with open(filepath) as f:
            data = json.load(f)
        if "scenarios" in data:
            self.results.append(data)
        elif isinstance(data, list):
            self.results.extend(data)
        return self

    def load_dir(self, dirpath: str):
        for fname in sorted(os.listdir(dirpath)):
            if fname.endswith(".json"):
                self.load(os.path.join(dirpath, fname))
        return self

    def _all_steps(self) -> list[dict]:
        steps = []
        for result in self.results:
            for scenario in result.get("scenarios", []):
                for step in scenario.get("steps", []):
                    step["_scenario_id"] = scenario.get("id", "")
                    step["_scenario_name"] = scenario.get("name", "")
                    step["_category"] = scenario.get("category", "")
                    step["_generated_at"] = result.get("generated_at", "")
                    steps.append(step)
        return steps

    # ── Analysis ────────────────────────────────────────────────────

    def latency_analysis(self) -> dict:
        """Detailed latency breakdown."""
        steps = self._all_steps()
        if not steps:
            return {"error": "No data"}

        ttfbs = [s["ttfb_ms"] for s in steps if s.get("ttfb_ms", 0) > 0]
        totals = [s["total_ms"] for s in steps if s.get("total_ms", 0) > 0]
        polls = [s.get("poll_count", 0) for s in steps]

        def percentiles(values):
            if not values:
                return {}
            sv = sorted(values)
            n = len(sv)
            return {
                "min": round(sv[0], 1),
                "p25": round(sv[max(0, n // 4 - 1)], 1),
                "p50": round(sv[n // 2], 1),
                "p75": round(sv[max(0, int(n * 0.75) - 1)], 1),
                "p90": round(sv[max(0, int(n * 0.9) - 1)], 1),
                "p95": round(sv[max(0, int(n * 0.95) - 1)], 1),
                "p99": round(sv[max(0, int(n * 0.99) - 1)], 1),
                "max": round(sv[-1], 1),
                "avg": round(sum(sv) / n, 1),
                "count": n,
            }

        # Polling overhead = total - ttfb (time spent polling after initial response)
        poll_overheads = []
        for s in steps:
            if s.get("total_ms", 0) > 0 and s.get("ttfb_ms", 0) > 0:
                poll_overheads.append(s["total_ms"] - s["ttfb_ms"])

        return {
            "ttfb": percentiles(ttfbs),
            "total": percentiles(totals),
            "poll_overhead": percentiles(poll_overheads),
            "poll_count": percentiles([float(p) for p in polls]),
            "slowest_steps": sorted(
                [{"name": s["name"], "scenario": s["_scenario_name"],
                  "total_ms": s["total_ms"], "ttfb_ms": s.get("ttfb_ms", 0)}
                 for s in steps if s.get("total_ms", 0) > 0],
                key=lambda x: x["total_ms"],
                reverse=True,
            )[:10],
        }

    def tool_analysis(self) -> dict:
        """Analyze tool call patterns."""
        steps = self._all_steps()
        all_tools = []
        tool_by_scenario = defaultdict(list)

        for s in steps:
            for tc in s.get("tool_calls", []):
                all_tools.append(tc)
                tool_by_scenario[s["_scenario_id"]].append(tc)

        tool_freq = Counter(all_tools)

        return {
            "total_tool_calls": len(all_tools),
            "unique_tools": len(tool_freq),
            "frequency": dict(tool_freq.most_common()),
            "by_scenario": {k: dict(Counter(v)) for k, v in tool_by_scenario.items()},
            "avg_tools_per_step": round(len(all_tools) / max(len(steps), 1), 2),
        }

    def error_analysis(self) -> dict:
        """Classify and analyze errors."""
        steps = self._all_steps()
        errors = [s for s in steps if not s.get("passed", True)]

        error_types = Counter()
        error_by_category = defaultdict(list)
        error_by_scenario = defaultdict(list)

        for e in errors:
            error_msg = e.get("error") or e.get("status", "unknown")
            error_types[error_msg] += 1
            error_by_category[e["_category"]].append(e["name"])
            error_by_scenario[e["_scenario_id"]].append(e["name"])

        return {
            "total_errors": len(errors),
            "total_steps": len(steps),
            "error_rate": f"{len(errors) / max(len(steps), 1) * 100:.1f}%",
            "error_types": dict(error_types.most_common()),
            "by_category": {k: len(v) for k, v in error_by_category.items()},
            "by_scenario": {k: v for k, v in error_by_scenario.items()},
        }

    def workflow_analysis(self) -> dict:
        """Analyze agent workflow patterns."""
        steps = self._all_steps()

        # Conversation status transitions
        status_counts = Counter(s.get("status", "unknown") for s in steps)

        # SSE event patterns
        sse_counts = [s.get("sse_events", 0) for s in steps]

        # Multi-turn patterns
        multi_turn_scenarios = defaultdict(list)
        for result in self.results:
            for scenario in result.get("scenarios", []):
                if len(scenario.get("steps", [])) > 1:
                    multi_turn_scenarios[scenario["id"]] = [
                        {"name": s["name"], "status": s["status"], "total_ms": s["total_ms"]}
                        for s in scenario["steps"]
                    ]

        return {
            "status_distribution": dict(status_counts),
            "sse_events": {
                "total": sum(sse_counts),
                "avg_per_step": round(sum(sse_counts) / max(len(sse_counts), 1), 1),
                "max": max(sse_counts) if sse_counts else 0,
            },
            "multi_turn_flows": dict(multi_turn_scenarios),
        }

    def full_report(self) -> dict:
        """Generate comprehensive analytics report."""
        return {
            "generated_at": datetime.now().isoformat(),
            "data_sources": len(self.results),
            "latency": self.latency_analysis(),
            "tools": self.tool_analysis(),
            "errors": self.error_analysis(),
            "workflow": self.workflow_analysis(),
        }

    def compare(self, other_filepath: str) -> dict:
        """Compare current results with a previous run."""
        other = KaiAnalytics()
        other.load(other_filepath)

        current_lat = self.latency_analysis()
        other_lat = other.latency_analysis()

        def delta(cur, prev, key):
            c = cur.get(key, {}).get("avg", 0)
            p = prev.get(key, {}).get("avg", 0)
            if p == 0:
                return "N/A"
            change = ((c - p) / p) * 100
            return f"{change:+.1f}%"

        current_err = self.error_analysis()
        other_err = other.error_analysis()

        return {
            "latency_changes": {
                "ttfb_avg": delta(current_lat, other_lat, "ttfb"),
                "total_avg": delta(current_lat, other_lat, "total"),
            },
            "error_rate_change": {
                "current": current_err.get("error_rate", "N/A"),
                "previous": other_err.get("error_rate", "N/A"),
            },
            "current_summary": {r.get("summary", {}) for r in self.results} if self.results else {},
            "previous_summary": {r.get("summary", {}) for r in other.results} if other.results else {},
        }

    # ── Display ──────────────────────────────────────────────────────

    def print_dashboard(self):
        """Print a terminal-friendly dashboard."""
        report = self.full_report()

        print("\n" + "=" * 70)
        print("  KAI AGENT ANALYTICS DASHBOARD")
        print("=" * 70)

        # Latency
        lat = report["latency"]
        print("\n📊 LATENCY ANALYSIS")
        print("-" * 50)
        if "ttfb" in lat and lat["ttfb"]:
            t = lat["ttfb"]
            print(f"  TTFB:          avg={t.get('avg',0)}ms  p50={t.get('p50',0)}ms  p95={t.get('p95',0)}ms  max={t.get('max',0)}ms")
        if "total" in lat and lat["total"]:
            t = lat["total"]
            print(f"  Total:         avg={t.get('avg',0)}ms  p50={t.get('p50',0)}ms  p95={t.get('p95',0)}ms  max={t.get('max',0)}ms")
        if "poll_overhead" in lat and lat["poll_overhead"]:
            t = lat["poll_overhead"]
            print(f"  Poll Overhead: avg={t.get('avg',0)}ms  p50={t.get('p50',0)}ms  p95={t.get('p95',0)}ms")
        if lat.get("slowest_steps"):
            print(f"\n  Slowest Steps:")
            for s in lat["slowest_steps"][:5]:
                print(f"    {s['name']:<30} {s['total_ms']:>8.0f}ms  ({s['scenario']})")

        # Tools
        tools = report["tools"]
        print(f"\n🔧 TOOL CALLS")
        print("-" * 50)
        print(f"  Total: {tools['total_tool_calls']}  Unique: {tools['unique_tools']}  Avg/step: {tools['avg_tools_per_step']}")
        if tools["frequency"]:
            print(f"  Frequency:")
            for tool, count in tools["frequency"].items():
                print(f"    {tool:<40} {count:>4}x")

        # Errors
        errors = report["errors"]
        print(f"\n❌ ERROR ANALYSIS")
        print("-" * 50)
        print(f"  Error Rate: {errors['error_rate']} ({errors['total_errors']}/{errors['total_steps']} steps)")
        if errors["error_types"]:
            print(f"  Types:")
            for etype, count in errors["error_types"].items():
                print(f"    {etype[:50]:<50} {count:>4}x")

        # Workflow
        wf = report["workflow"]
        print(f"\n🔄 WORKFLOW")
        print("-" * 50)
        if wf["status_distribution"]:
            print(f"  Status Distribution:")
            for status, count in wf["status_distribution"].items():
                bar = "█" * min(count, 30)
                print(f"    {status:<20} {count:>4}  {bar}")
        print(f"  SSE Events: total={wf['sse_events']['total']}  avg/step={wf['sse_events']['avg_per_step']}")

        print("\n" + "=" * 70)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Kai Analytics")
    sub = parser.add_subparsers(dest="command")

    analyze_parser = sub.add_parser("analyze", help="Analyze test results")
    analyze_parser.add_argument("input", help="Results JSON file")
    analyze_parser.add_argument("--json", action="store_true", help="Output as JSON")

    compare_parser = sub.add_parser("compare", help="Compare two result sets")
    compare_parser.add_argument("current", help="Current results file")
    compare_parser.add_argument("previous", help="Previous results file")

    dash_parser = sub.add_parser("dashboard", help="Show dashboard from multiple runs")
    dash_parser.add_argument("--dir", "-d", default=".", help="Directory with result files")

    args = parser.parse_args()

    if args.command == "analyze":
        analytics = KaiAnalytics()
        analytics.load(args.input)
        if args.json:
            print(json.dumps(analytics.full_report(), indent=2))
        else:
            analytics.print_dashboard()

    elif args.command == "compare":
        analytics = KaiAnalytics()
        analytics.load(args.current)
        comparison = analytics.compare(args.previous)
        print(json.dumps(comparison, indent=2))

    elif args.command == "dashboard":
        analytics = KaiAnalytics()
        analytics.load_dir(args.dir)
        analytics.print_dashboard()


if __name__ == "__main__":
    main()
