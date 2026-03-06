"""
Kai Report — Generate HTML analytics reports with industry benchmarks.

Takes a session JSON (from kai_conversation.py) + optional evaluation JSON,
and produces a self-contained HTML report with:
- Market-benchmarked latency scoring (vs ChatGPT, Copilot, Gemini, Claude)
- Threshold gauge lines on charts (excellent/good/acceptable/slow)
- Quality evaluation with rubric-based scoring
- Grade badges (A+ through F)

Usage:
    python kai_report.py generate results/kai_fire_abc123.json --eval eval.json --open
"""
import json
import html
import os
import logging
from datetime import datetime
from typing import Optional

from kai_benchmarks import (
    score_ttfb, score_total, score_match_latency, get_grade,
    TTFB_THRESHOLDS, TOTAL_THRESHOLDS, QUALITY_RUBRICS,
    COMPETITOR_BENCHMARKS, GRADE_BANDS,
)

logger = logging.getLogger(__name__)
RESULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results")


def _esc(text: str) -> str:
    return html.escape(str(text))


def _md_to_html_basic(text: str) -> str:
    """Minimal markdown to HTML."""
    import re
    if not text:
        return ""
    lines = text.split("\n")
    out = []
    in_table = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if all(set(c) <= set("- :") for c in cells):
                continue
            if not in_table:
                out.append("<table class='md-table'><tbody>")
                in_table = True
            out.append("<tr>" + "".join(f"<td>{_esc(c)}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</tbody></table>")
            in_table = False
        if stripped.startswith("### "):
            out.append(f"<h4>{_esc(stripped[4:])}</h4>")
        elif stripped.startswith("## "):
            out.append(f"<h3>{_esc(stripped[3:])}</h3>")
        elif stripped.startswith("# "):
            out.append(f"<h2>{_esc(stripped[2:])}</h2>")
        elif stripped.startswith("- ") or stripped.startswith("* "):
            out.append(f"<li>{_esc(stripped[2:])}</li>")
        elif stripped.startswith("---"):
            out.append("<hr>")
        elif stripped == "":
            out.append("<br>")
        else:
            out.append(f"<p>{_esc(stripped)}</p>")
    if in_table:
        out.append("</tbody></table>")
    result = "\n".join(out)
    result = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', result)
    return result


def generate_html_report(session_data: dict, evaluation: Optional[dict] = None) -> str:
    """Generate a self-contained HTML report with industry benchmarks."""
    turns = session_data.get("rounds", session_data.get("turns", []))
    session_id = session_data.get("match_id", session_data.get("session_id", "unknown"))
    started = session_data.get("started_at", "")
    stop_reason = session_data.get("stop_reason", "unknown")

    # Compute metrics
    ttfbs = [t.get("ttfb_ms", 0) for t in turns if t.get("ttfb_ms", 0) > 0]
    totals = [t.get("total_ms", 0) for t in turns if t.get("total_ms", 0) > 0]
    polls = [t.get("poll_count", 0) for t in turns]
    all_tools = [tc for t in turns for tc in t.get("tool_calls", [])]
    successful = sum(1 for t in turns if t.get("status") == "input-required")
    failed = sum(1 for t in turns if t.get("status") not in ("input-required", "stopped", ""))
    total_time_s = sum(totals) / 1000 if totals else 0

    def avg(v): return round(sum(v) / len(v), 1) if v else 0
    def pct(v, p):
        if not v: return 0
        s = sorted(v)
        return round(s[min(int(len(s) * p), len(s) - 1)], 1)

    # Benchmark scoring
    bench = score_match_latency(turns)
    ttfb_grade = score_ttfb(avg(ttfbs)) if ttfbs else {"score": 0, "label": "N/A", "color": "#94a3b8"}
    total_grade = score_total(avg(totals)) if totals else {"score": 0, "label": "N/A", "color": "#94a3b8"}

    # Evaluation
    eval_data = evaluation or {}
    turn_evals = eval_data.get("rounds", eval_data.get("turns", []))
    overall = eval_data.get("overall", {})
    issues = eval_data.get("issues", [])
    goal = eval_data.get("goal", "Kai Test")
    overall_score = eval_data.get("overall_score", 0)
    grade = get_grade(overall_score) if overall_score else {"grade": "—", "label": "Not evaluated", "color": "#94a3b8"}

    # Chart data
    turn_labels = json.dumps([f"R{t.get('round_number', t.get('turn_number', i+1))}" for i, t in enumerate(turns)])
    ttfb_data = json.dumps([round(t.get("ttfb_ms", 0), 1) for t in turns])
    total_data = json.dumps([round(t.get("total_ms", 0), 1) for t in turns])
    poll_data = json.dumps([t.get("poll_count", 0) for t in turns])
    resp_len_data = json.dumps([len(t.get("assistant_response", "")) for t in turns])

    # Radar
    latency_score = bench.get("combined_score", 0) if bench and "combined_score" in bench else 0
    radar_labels = json.dumps(["Goal Achievement", "Context Retention", "Error Handling", "Response Quality", "Speed (benchmarked)"])
    radar_scores = json.dumps([
        overall.get("goal_achievement", {}).get("score", 0),
        overall.get("context_retention", {}).get("score", 0),
        overall.get("error_handling", {}).get("score", 0),
        overall.get("response_quality", {}).get("score", 0),
        latency_score,
    ])

    # Competitor comparison data for chart
    comp_labels = ["Kai"]
    comp_ttfb = [avg(ttfbs)]
    comp_total = [avg(totals)]
    for key, comp in COMPETITOR_BENCHMARKS.items():
        comp_labels.append(comp["name"])
        comp_ttfb.append(comp["ttfb_ms"])
        comp_total.append(comp["total_complex_ms"])

    # Build competitor comparison rows
    comp_rows = ""
    if bench and "vs_competitors" in bench:
        for comp in bench["vs_competitors"]:
            ttfb_cls = "comp-slower" if comp["ttfb_diff_pct"] > 0 else "comp-faster"
            total_cls = "comp-slower" if comp["total_diff_pct"] > 0 else "comp-faster"
            comp_rows += f"""
            <tr>
                <td>{_esc(comp['competitor'])}</td>
                <td class="{ttfb_cls}">{'+' if comp['ttfb_diff_pct'] > 0 else ''}{comp['ttfb_diff_pct']}%</td>
                <td class="{total_cls}">{'+' if comp['total_diff_pct'] > 0 else ''}{comp['total_diff_pct']}%</td>
            </tr>"""

    # Turn cards
    turn_rows = []
    for i, t in enumerate(turns):
        te = turn_evals[i] if i < len(turn_evals) else {}
        status = t.get("status", "unknown")
        status_class = "success" if status == "input-required" else "error" if status == "error" else "warning"
        status_label = "OK" if status == "input-required" else status.upper()

        # Per-turn latency grade
        t_ttfb = score_ttfb(t.get("ttfb_ms", 0))
        t_total = score_total(t.get("total_ms", 0))

        scores_html = ""
        if te:
            scores_html = f"""
            <div class="scores">
                <span class="score-pill" title="Relevance">R:{te.get('relevance', '-')}</span>
                <span class="score-pill" title="Accuracy">A:{te.get('accuracy', '-')}</span>
                <span class="score-pill" title="Helpfulness">H:{te.get('helpfulness', '-')}</span>
                <span class="score-pill" title="Tool Usage">T:{te.get('tool_usage', '-')}</span>
            </div>"""
            if te.get("feedback"):
                scores_html += f'<div class="feedback">{_esc(te["feedback"])}</div>'

        tool_html = ""
        if t.get("tool_calls"):
            tool_html = '<div class="tools">Tools: ' + ", ".join(f'<code>{_esc(tc)}</code>' for tc in t["tool_calls"]) + "</div>"

        error_html = ""
        if t.get("error"):
            error_html = f'<div class="turn-error">Error: {_esc(t["error"])}</div>'

        resp_preview = _md_to_html_basic(t.get("assistant_response", "")[:2000])

        turn_rows.append(f"""
        <div class="turn-card">
            <div class="turn-header">
                <div class="turn-num">Round {t.get('round_number', t.get('turn_number', i+1))}</div>
                <span class="status-badge {status_class}">{status_label}</span>
                <span class="latency-badge" style="background:{t_ttfb['color']}20;color:{t_ttfb['color']}" title="How fast Kai started responding">1st byte: {t_ttfb['label']}</span>
                <span class="latency-badge" style="background:{t_total['color']}20;color:{t_total['color']}" title="Total time to complete answer">Answer: {t_total['label']}</span>
                <div class="turn-metrics">
                    <span title="Time until Kai started responding">1st byte: {round(t.get('ttfb_ms', 0))}ms</span>
                    <span title="Total time for complete answer">Answer: {round(t.get('total_ms', 0))}ms</span>
                    <span title="Number of status checks before answer was ready">Polls: {t.get('poll_count', 0)}</span>
                </div>
            </div>
            <div class="turn-user">
                <div class="role-label user-label">USER</div>
                <div class="message-text">{_esc(t.get('user_message', ''))}</div>
            </div>
            <div class="turn-assistant">
                <div class="role-label kai-label">KAI</div>
                <div class="message-text response-text">{resp_preview}</div>
            </div>
            {scores_html}
            {tool_html}
            {error_html}
        </div>""")

    # Overall evaluation section
    overall_html = ""
    if overall:
        rows = []
        for key, label in [
            ("goal_achievement", "Goal Achievement"),
            ("context_retention", "Context Retention"),
            ("error_handling", "Error Handling"),
            ("response_quality", "Response Quality"),
        ]:
            entry = overall.get(key, {})
            score = entry.get("score", 0)
            reason = entry.get("reason", "")
            bar_width = score * 20
            g = get_grade(score)
            rows.append(f"""
            <div class="eval-row">
                <div class="eval-label">{label}</div>
                <div class="eval-bar-container">
                    <div class="eval-bar" style="width:{bar_width}%;background:{g['color']}"></div>
                </div>
                <div class="eval-score" style="color:{g['color']}">{score}/5</div>
                <div class="eval-reason">{_esc(reason)}</div>
            </div>""")
        overall_html = f"""
        <div class="section">
            <h2>Quality Evaluation</h2>
            <div class="grade-hero">
                <div class="grade-badge" style="border-color:{grade['color']};color:{grade['color']}">{grade['grade']}</div>
                <div class="grade-info">
                    <div class="big-score" style="color:{grade['color']}">{overall_score}</div>
                    <div class="big-label">/ 5.0 &mdash; {grade['label']}</div>
                    <div class="grade-desc">{grade.get('description', '')}</div>
                </div>
            </div>
            <div class="eval-grid">{''.join(rows)}</div>
        </div>"""

    # Benchmark thresholds section
    benchmark_html = f"""
    <div class="section">
        <h2>Industry Benchmark Comparison</h2>
        <p class="bench-subtitle">Kai vs market leaders for complex agentic queries (tool execution + reasoning)</p>
        <div class="bench-grid">
            <div class="bench-card">
                <div class="bench-metric">First Response (TTFB)</div>
                <div class="bench-detail">How fast Kai starts responding after you send a message</div>
                <div class="bench-value">{avg(ttfbs)}ms</div>
                <div class="bench-grade" style="background:{ttfb_grade['color']}20;color:{ttfb_grade['color']}">{ttfb_grade['label']} ({ttfb_grade['score']}/5)</div>
                <div class="bench-scale">
                    <div class="scale-bar">
                        <div class="scale-segment" style="width:25%;background:#22c55e" title="Excellent: <500ms"></div>
                        <div class="scale-segment" style="width:25%;background:#84cc16" title="Good: 500ms-1s"></div>
                        <div class="scale-segment" style="width:25%;background:#eab308" title="Acceptable: 1-2s"></div>
                        <div class="scale-segment" style="width:25%;background:#ef4444" title="Critical: >2s"></div>
                    </div>
                    <div class="scale-labels"><span>0</span><span>0.5s</span><span>1s</span><span>2s+</span></div>
                    <div class="scale-marker" style="left:min(95%,{min(avg(ttfbs)/2500*100, 100):.0f}%)"></div>
                </div>
                <div class="bench-ref">Nielsen: &lt;1s users stay in flow. Forrester: 73% of users leave after waiting &gt;5s</div>
            </div>
            <div class="bench-card">
                <div class="bench-metric">Full Answer Time</div>
                <div class="bench-detail">Total time from sending a message to receiving the complete answer</div>
                <div class="bench-value">{avg(totals)}ms</div>
                <div class="bench-grade" style="background:{total_grade['color']}20;color:{total_grade['color']}">{total_grade['label']} ({total_grade['score']}/5)</div>
                <div class="bench-scale">
                    <div class="scale-bar">
                        <div class="scale-segment" style="width:25%;background:#22c55e" title="Excellent: <5s"></div>
                        <div class="scale-segment" style="width:25%;background:#84cc16" title="Good: 5-10s"></div>
                        <div class="scale-segment" style="width:25%;background:#eab308" title="Acceptable: 10-20s"></div>
                        <div class="scale-segment" style="width:25%;background:#ef4444" title="Critical: >20s"></div>
                    </div>
                    <div class="scale-labels"><span>0</span><span>5s</span><span>10s</span><span>20s+</span></div>
                    <div class="scale-marker" style="left:min(95%,{min(avg(totals)/25000*100, 100):.0f}%)"></div>
                </div>
                <div class="bench-ref">Market comparison: ChatGPT w/ tools ~12s, Copilot ~15s, Enterprise AI agents 10-30s</div>
            </div>
        </div>
        <h3 style="margin-top:24px;color:var(--text-dim);font-size:.85rem;text-transform:uppercase;letter-spacing:.5px">Kai vs Competitors (complex queries)</h3>
        <table class="comp-table">
            <thead><tr><th>Competitor</th><th>First Response Diff</th><th>Full Answer Diff</th></tr></thead>
            <tbody>{comp_rows}</tbody>
        </table>
        <div class="bench-note">
            <strong>Methodology:</strong> TTFB thresholds from Nielsen Norman Group perception research &amp; Google UX benchmarks.
            Total response thresholds calibrated for agentic AI with tool execution (not simple chatbots).
            Competitor numbers from Artificial Analysis, public benchmarks, and enterprise reports (2025-2026).
        </div>
    </div>"""

    # Rubric reference section
    rubric_rows = ""
    for dim, cfg in QUALITY_RUBRICS.items():
        rubric_rows += f"<tr><td><strong>{dim.replace('_',' ').title()}</strong><br><span class='rubric-src'>{_esc(cfg['source'])}</span></td>"
        for score in [5, 3, 1]:
            rubric_rows += f"<td class='rubric-cell'><strong>{score}:</strong> {_esc(cfg['rubric'][score])}</td>"
        rubric_rows += "</tr>"

    rubric_html = f"""
    <div class="section">
        <h2>Scoring Rubric Reference</h2>
        <p class="bench-subtitle">Based on Anthropic, Google Vertex AI, Microsoft Copilot Studio, and AgentBench frameworks</p>
        <table class="rubric-table">
            <thead><tr><th>Dimension</th><th>5 (Excellent)</th><th>3 (Acceptable)</th><th>1 (Failing)</th></tr></thead>
            <tbody>{rubric_rows}</tbody>
        </table>
    </div>"""

    # Issues
    issues_html = ""
    if issues:
        items = "".join(f'<li class="issue-item">{_esc(issue)}</li>' for issue in issues)
        issues_html = f"""
        <div class="section">
            <h2>Issues & Findings</h2>
            <ul class="issues-list">{items}</ul>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kai Match Report — {_esc(session_id)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.1.0/dist/chartjs-plugin-annotation.min.js"></script>
<style>
:root {{
    --bg: #0f172a; --surface: #1e293b; --surface2: #334155;
    --text: #e2e8f0; --text-dim: #94a3b8; --accent: #3b82f6;
    --green: #22c55e; --yellow: #eab308; --red: #ef4444; --purple: #a855f7;
    --lime: #84cc16; --orange: #f97316;
    --radius: 12px; --shadow: 0 4px 6px -1px rgba(0,0,0,.3);
}}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:var(--bg); color:var(--text); line-height:1.6; padding:24px; }}
.container {{ max-width:1200px; margin:0 auto; }}
h1 {{ font-size:1.8rem; font-weight:700; margin-bottom:4px; }}
h2 {{ font-size:1.3rem; font-weight:600; margin-bottom:16px; color:var(--accent); }}
h3,h4 {{ font-size:1rem; margin:8px 0 4px; color:var(--text); }}
.subtitle {{ color:var(--text-dim); font-size:.9rem; margin-bottom:24px; }}

.header {{ display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:32px; }}
.header-left {{ flex:1; }}
.header-badge {{ display:inline-flex; align-items:center; gap:8px; background:var(--surface);
    padding:6px 14px; border-radius:20px; font-size:.85rem; color:var(--text-dim); }}
.header-badge .dot {{ width:8px; height:8px; border-radius:50%; background:var(--green); }}

.kpi-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px; margin-bottom:32px; }}
.kpi-card {{ background:var(--surface); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); }}
.kpi-value {{ font-size:1.8rem; font-weight:700; }}
.kpi-label {{ color:var(--text-dim); font-size:.8rem; text-transform:uppercase; letter-spacing:.5px; margin-top:4px; }}
.kpi-sub {{ color:var(--text-dim); font-size:.75rem; margin-top:2px; }}

.chart-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(380px,1fr)); gap:20px; margin-bottom:32px; }}
.chart-card {{ background:var(--surface); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); }}
.chart-card h3 {{ color:var(--text-dim); font-size:.85rem; text-transform:uppercase; letter-spacing:.5px; margin-bottom:12px; }}
.chart-container {{ position:relative; height:280px; }}

.section {{ background:var(--surface); border-radius:var(--radius); padding:24px; margin-bottom:24px; box-shadow:var(--shadow); }}

/* Benchmark */
.bench-subtitle {{ color:var(--text-dim); font-size:.85rem; margin-bottom:16px; }}
.bench-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:20px; }}
.bench-card {{ background:var(--surface2); border-radius:var(--radius); padding:20px; }}
.bench-metric {{ font-size:.75rem; text-transform:uppercase; color:var(--text-dim); letter-spacing:.5px; font-weight:600; }}
.bench-detail {{ font-size:.75rem; color:var(--text-dim); margin-top:2px; font-style:italic; }}
.bench-value {{ font-size:2rem; font-weight:700; margin:4px 0; }}
.bench-grade {{ display:inline-block; font-size:.8rem; font-weight:600; padding:3px 12px; border-radius:12px; margin-bottom:12px; }}
.bench-scale {{ position:relative; margin:16px 0 8px; }}
.scale-bar {{ display:flex; height:8px; border-radius:4px; overflow:hidden; }}
.scale-segment {{ height:100%; }}
.scale-labels {{ display:flex; justify-content:space-between; font-size:.7rem; color:var(--text-dim); margin-top:4px; }}
.scale-marker {{ position:absolute; top:-2px; width:4px; height:12px; background:white; border-radius:2px;
    box-shadow:0 0 6px rgba(255,255,255,.5); transform:translateX(-50%); }}
.bench-ref {{ font-size:.7rem; color:var(--text-dim); margin-top:8px; font-style:italic; }}
.bench-note {{ font-size:.75rem; color:var(--text-dim); margin-top:16px; padding:12px;
    background:rgba(0,0,0,.2); border-radius:8px; }}

.comp-table {{ width:100%; border-collapse:collapse; margin-top:12px; }}
.comp-table th {{ text-align:left; padding:8px 12px; font-size:.8rem; color:var(--text-dim);
    border-bottom:1px solid var(--surface2); text-transform:uppercase; letter-spacing:.5px; }}
.comp-table td {{ padding:8px 12px; font-size:.9rem; border-bottom:1px solid rgba(255,255,255,.05); }}
.comp-faster {{ color:var(--green); }}
.comp-slower {{ color:var(--red); }}

/* Grade */
.grade-hero {{ display:flex; align-items:center; gap:24px; margin-bottom:24px; }}
.grade-badge {{ width:80px; height:80px; border-radius:50%; border:4px solid; display:flex;
    align-items:center; justify-content:center; font-size:2rem; font-weight:800; flex-shrink:0; }}
.grade-info {{ flex:1; }}
.big-score {{ font-size:2.5rem; font-weight:800; }}
.big-label {{ font-size:1rem; color:var(--text-dim); }}
.grade-desc {{ font-size:.85rem; color:var(--text-dim); margin-top:4px; }}

.eval-grid {{ display:flex; flex-direction:column; gap:12px; }}
.eval-row {{ display:grid; grid-template-columns:160px 200px 50px 1fr; align-items:center; gap:12px; }}
.eval-label {{ font-weight:600; font-size:.9rem; }}
.eval-bar-container {{ height:8px; background:var(--surface2); border-radius:4px; overflow:hidden; }}
.eval-bar {{ height:100%; border-radius:4px; transition:width .3s; }}
.eval-score {{ font-weight:700; font-size:.9rem; text-align:center; }}
.eval-reason {{ font-size:.8rem; color:var(--text-dim); }}

/* Rubric */
.rubric-table {{ width:100%; border-collapse:collapse; margin-top:8px; }}
.rubric-table th {{ text-align:left; padding:10px; font-size:.8rem; color:var(--text-dim);
    border-bottom:2px solid var(--surface2); }}
.rubric-table td {{ padding:10px; font-size:.8rem; border-bottom:1px solid rgba(255,255,255,.05); vertical-align:top; }}
.rubric-cell {{ color:var(--text-dim); }}
.rubric-src {{ font-size:.7rem; color:var(--accent); }}

/* Turns */
.turn-card {{ background:var(--surface2); border-radius:var(--radius); padding:16px;
    margin-bottom:12px; border-left:3px solid var(--accent); }}
.turn-header {{ display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }}
.turn-num {{ font-weight:700; font-size:.9rem; }}
.turn-metrics {{ display:flex; gap:12px; font-size:.8rem; color:var(--text-dim); margin-left:auto; }}
.status-badge,.latency-badge {{ font-size:.7rem; font-weight:600; padding:2px 8px; border-radius:10px; }}
.status-badge.success {{ background:rgba(34,197,94,.15); color:var(--green); }}
.status-badge.error {{ background:rgba(239,68,68,.15); color:var(--red); }}
.status-badge.warning {{ background:rgba(234,179,8,.15); color:var(--yellow); }}
.role-label {{ font-size:.7rem; font-weight:700; letter-spacing:.5px; padding:2px 8px;
    border-radius:4px; display:inline-block; margin-bottom:4px; }}
.user-label {{ background:rgba(59,130,246,.15); color:var(--accent); }}
.kai-label {{ background:rgba(168,85,247,.15); color:var(--purple); }}
.message-text {{ font-size:.9rem; margin-bottom:8px; }}
.response-text {{ max-height:300px; overflow-y:auto; padding:8px; background:rgba(0,0,0,.2);
    border-radius:8px; font-size:.85rem; line-height:1.5; }}
.response-text p {{ margin:4px 0; }} .response-text li {{ margin-left:20px; }}
.response-text h2,.response-text h3,.response-text h4 {{ color:var(--accent); }}
.response-text hr {{ border:none; border-top:1px solid var(--surface2); margin:8px 0; }}
.md-table {{ width:100%; border-collapse:collapse; font-size:.8rem; margin:8px 0; }}
.md-table td {{ padding:4px 8px; border:1px solid var(--surface); }}
.md-table tr:first-child td {{ font-weight:600; background:rgba(0,0,0,.2); }}
.scores {{ display:flex; gap:8px; margin-top:8px; }}
.score-pill {{ font-size:.75rem; padding:2px 8px; background:rgba(59,130,246,.15);
    border-radius:8px; color:var(--accent); }}
.feedback {{ font-size:.8rem; color:var(--text-dim); margin-top:6px; font-style:italic; }}
.tools {{ font-size:.8rem; color:var(--text-dim); margin-top:6px; }}
.tools code {{ background:rgba(0,0,0,.3); padding:1px 6px; border-radius:4px; }}
.turn-error {{ font-size:.8rem; color:var(--red); margin-top:6px; }}

.issues-list {{ list-style:none; }}
.issue-item {{ padding:8px 12px; background:rgba(239,68,68,.08); border-left:3px solid var(--red);
    border-radius:0 8px 8px 0; margin-bottom:8px; font-size:.9rem; }}

.footer {{ text-align:center; color:var(--text-dim); font-size:.8rem; margin-top:32px; padding:16px; }}

@media (max-width:768px) {{
    .chart-grid,.bench-grid {{ grid-template-columns:1fr; }}
    .eval-row {{ grid-template-columns:1fr; }}
    .kpi-grid {{ grid-template-columns:repeat(2,1fr); }}
    .grade-hero {{ flex-direction:column; text-align:center; }}
}}
</style>
</head>
<body>
<div class="container">

<div class="header">
    <div class="header-left">
        <h1>Kai Match Report</h1>
        <div class="subtitle">{_esc(goal)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="header-badge"><span class="dot"></span> Match {_esc(session_id)}</span>
            <span class="header-badge">{_esc(stop_reason)}</span>
            <span class="header-badge">{_esc(started[:19] if started else 'N/A')}</span>
        </div>
    </div>
</div>

<div class="kpi-grid">
    <div class="kpi-card">
        <div class="kpi-value">{len(turns)}</div>
        <div class="kpi-label">Rounds</div>
        <div class="kpi-sub">{successful} ok / {failed} failed</div>
    </div>
    <div class="kpi-card" title="Time to First Byte — how fast Kai starts responding after you send a message">
        <div class="kpi-value" style="color:{ttfb_grade['color']}">{avg(ttfbs)}<small>ms</small></div>
        <div class="kpi-label">First Response</div>
        <div class="kpi-sub">{ttfb_grade['label']} | p95: {pct(ttfbs, 0.95)}ms</div>
    </div>
    <div class="kpi-card" title="Total end-to-end time from sending a message to receiving the complete answer">
        <div class="kpi-value" style="color:{total_grade['color']}">{avg(totals)}<small>ms</small></div>
        <div class="kpi-label">Full Answer</div>
        <div class="kpi-sub">{total_grade['label']} | p95: {pct(totals, 0.95)}ms</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-value">{round(total_time_s, 1)}<small>s</small></div>
        <div class="kpi-label">Total Duration</div>
        <div class="kpi-sub">{avg(polls)} avg polls/round</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-value">{len(all_tools)}</div>
        <div class="kpi-label">Tool Calls</div>
        <div class="kpi-sub">{len(set(all_tools))} unique</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-value" style="color:{grade['color']}">{overall_score if overall_score else '—'}</div>
        <div class="kpi-label">Quality Score</div>
        <div class="kpi-sub">{grade.get('grade', '—')} &mdash; {grade.get('label', '')}</div>
    </div>
</div>

<div class="chart-grid">
    <div class="chart-card">
        <h3>Response Time Per Round</h3>
        <div class="chart-container"><canvas id="latencyChart"></canvas></div>
    </div>
    <div class="chart-card">
        <h3>Kai vs Competitors (complex queries)</h3>
        <div class="chart-container"><canvas id="compChart"></canvas></div>
    </div>
    <div class="chart-card">
        <h3>Polling & Response Size</h3>
        <div class="chart-container"><canvas id="pollChart"></canvas></div>
    </div>
    {'<div class="chart-card"><h3>Quality Radar</h3><div class="chart-container"><canvas id="radarChart"></canvas></div></div>' if overall else ''}
</div>

{benchmark_html}

{overall_html}

<div class="section">
    <h2>Match Transcript</h2>
    {''.join(turn_rows)}
</div>

{issues_html}

{rubric_html}

<div class="footer">
    Generated by Kai Match Actor &mdash; {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}<br>
    Benchmarks: Nielsen Norman Group, Forrester Research, Google UX, Artificial Analysis, Anthropic Evals, AgentBench
</div>

</div>

<script>
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.1)';

// Latency with threshold annotation lines
new Chart(document.getElementById('latencyChart'), {{
    type: 'bar',
    data: {{
        labels: {turn_labels},
        datasets: [
            {{ label: 'First Response (ms)', data: {ttfb_data}, backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6, barPercentage: 0.6 }},
            {{ label: 'Full Answer (ms)', data: {total_data}, backgroundColor: 'rgba(168,85,247,0.5)', borderRadius: 6, barPercentage: 0.6 }},
        ]
    }},
    options: {{
        responsive: true, maintainAspectRatio: false,
        plugins: {{
            legend: {{ position: 'top' }},
            annotation: {{
                annotations: {{
                    excellentLine: {{ type: 'line', yMin: 5000, yMax: 5000, borderColor: '#22c55e', borderWidth: 2, borderDash: [6,3],
                        label: {{ display: true, content: 'Excellent (<5s)', position: 'start', backgroundColor: 'transparent', color: '#22c55e', font: {{size:10}} }} }},
                    goodLine: {{ type: 'line', yMin: 10000, yMax: 10000, borderColor: '#84cc16', borderWidth: 2, borderDash: [6,3],
                        label: {{ display: true, content: 'Good (<10s)', position: 'start', backgroundColor: 'transparent', color: '#84cc16', font: {{size:10}} }} }},
                    acceptLine: {{ type: 'line', yMin: 20000, yMax: 20000, borderColor: '#eab308', borderWidth: 2, borderDash: [6,3],
                        label: {{ display: true, content: 'Acceptable (<20s)', position: 'start', backgroundColor: 'transparent', color: '#eab308', font: {{size:10}} }} }},
                }}
            }}
        }},
        scales: {{ y: {{ beginAtZero: true, title: {{ display: true, text: 'ms' }} }} }}
    }}
}});

// Competitor comparison
new Chart(document.getElementById('compChart'), {{
    type: 'bar',
    data: {{
        labels: {json.dumps(comp_labels)},
        datasets: [
            {{ label: 'First Response (ms)', data: {json.dumps(comp_ttfb)}, backgroundColor: (ctx) => ctx.dataIndex === 0 ? 'rgba(59,130,246,0.8)' : 'rgba(148,163,184,0.4)', borderRadius: 6, barPercentage: 0.5 }},
            {{ label: 'Full Answer (ms)', data: {json.dumps(comp_total)}, backgroundColor: (ctx) => ctx.dataIndex === 0 ? 'rgba(168,85,247,0.7)' : 'rgba(148,163,184,0.25)', borderRadius: 6, barPercentage: 0.5 }},
        ]
    }},
    options: {{
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {{ legend: {{ position: 'top' }} }},
        scales: {{ x: {{ beginAtZero: true, title: {{ display: true, text: 'ms' }} }} }}
    }}
}});

// Poll + Response chart
new Chart(document.getElementById('pollChart'), {{
    type: 'bar',
    data: {{
        labels: {turn_labels},
        datasets: [
            {{ label: 'Poll Count', data: {poll_data}, backgroundColor: 'rgba(234,179,8,0.6)', borderRadius: 6, barPercentage: 0.5, yAxisID: 'y' }},
            {{ label: 'Response Chars', data: {resp_len_data}, backgroundColor: 'rgba(34,197,94,0.4)', borderRadius: 6, barPercentage: 0.5, yAxisID: 'y1' }},
        ]
    }},
    options: {{
        responsive: true, maintainAspectRatio: false,
        plugins: {{ legend: {{ position: 'top' }} }},
        scales: {{
            y: {{ beginAtZero: true, position: 'left', title: {{ display: true, text: 'Polls' }} }},
            y1: {{ beginAtZero: true, position: 'right', title: {{ display: true, text: 'Chars' }}, grid: {{ drawOnChartArea: false }} }},
        }}
    }}
}});

// Radar
const radarEl = document.getElementById('radarChart');
if (radarEl) {{
    new Chart(radarEl, {{
        type: 'radar',
        data: {{
            labels: {radar_labels},
            datasets: [{{
                label: 'Kai Score',
                data: {radar_scores},
                backgroundColor: 'rgba(59,130,246,0.2)',
                borderColor: 'rgba(59,130,246,0.8)',
                pointBackgroundColor: 'rgba(59,130,246,1)',
                borderWidth: 2,
            }}]
        }},
        options: {{
            responsive: true, maintainAspectRatio: false,
            scales: {{ r: {{ min: 0, max: 5, ticks: {{ stepSize: 1 }} }} }},
            plugins: {{ legend: {{ display: false }} }}
        }}
    }});
}}
</script>
</body>
</html>"""


def generate_report(session_path: str, eval_path: Optional[str] = None, output: Optional[str] = None) -> str:
    """Load session + evaluation JSON, generate HTML report."""
    with open(session_path) as f:
        session_data = json.load(f)

    evaluation = None
    if eval_path and os.path.exists(eval_path):
        with open(eval_path) as f:
            evaluation = json.load(f)

    html_content = generate_html_report(session_data, evaluation)

    if not output:
        session_id = session_data.get("match_id", session_data.get("session_id", "unknown"))
        output = os.path.join(RESULTS_DIR, f"kai_report_{session_id}.html")

    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with open(output, "w") as f:
        f.write(html_content)

    logger.info(f"Report generated: {output}")
    return output


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Kai Report — HTML analytics report generator")
    sub = parser.add_subparsers(dest="command")

    gen_p = sub.add_parser("generate", help="Generate HTML report")
    gen_p.add_argument("input", help="Session JSON file")
    gen_p.add_argument("--eval", "-e", help="Evaluation JSON file")
    gen_p.add_argument("--output", "-o", help="Output HTML path")
    gen_p.add_argument("--open", action="store_true", help="Open in browser after generating")

    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if args.command == "generate":
        output = generate_report(args.input, args.eval, args.output)
        print(output)
        if args.open:
            import webbrowser
            webbrowser.open(f"file://{os.path.abspath(output)}")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
