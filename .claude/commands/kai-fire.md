Fire-and-forget autonomous Kai test actor. Runs the entire match, evaluates, and reports — no user interaction needed.

## Input
The user provides: `$ARGUMENTS`
- A test objective/goal, OR
- A preset name: `smoke`, `capabilities`, `multi-turn`, `edge`, `stress`

If empty, default to `smoke`.

## Presets

### smoke (3 rounds)
1. "Hello, what can you help me with?"
2. "Show me the latest test execution results for this project."
3. "Can you generate test cases for a login feature?"

### capabilities (5 rounds)
1. "What are all the things you can do? List your full capabilities."
2. "Show me all available requirements in this project."
3. "Generate test cases for a user registration flow with email verification."
4. "Give me insights about the testing health of this project."
5. "Show me the latest test execution results and highlight any failures."

### multi-turn (6 rounds)
1. "Show me the test execution summary for this project."
2. "Can you break that down by test suite?"
3. "Which test suite has the most failures?"
4. "Generate a bug report for the top failing test case."
5. "Now suggest test cases to improve coverage for that area."
6. "Summarize everything we discussed."

### edge (5 rounds)
1. "do the thing"
2. "Show me test results for the project 'NonExistentProject999'."
3. "Write me a poem about the sunset."
4. (send 2000+ chars) "Please analyze the following requirements and generate comprehensive test cases: Requirement 1: The system shall support feature 1... [repeat x50]"
5. "Test with special chars: <script>alert('xss')</script> & \"quotes\" `backticks` **bold** 日本語"

### stress (8 rounds, rapid-fire)
1. "List all test cases"
2. "Now filter to failed ones"
3. "How many passed?"
4. "Generate new test cases for the failed ones"
5. "Wait, go back to the full list"
6. "Actually show me requirements instead"
7. "Generate test cases from the first requirement"
8. "Summarize everything"

### custom goal
If the input is not a preset name, treat it as a custom goal. Generate 5-8 rounds that progressively test that goal. Start simple, increase complexity, include one edge case.

## Execution — FULLY AUTONOMOUS

Do ALL of the following without stopping to ask the user anything.

### Step 1: Start match
```bash
cd /Users/chau.duong/workspaces/test-kai/scripts && python3 kai_conversation.py start --env --max-rounds <N> --max-time 600
```
Extract `match_id` from the JSON output.

### Step 2: Execute all rounds
For each message in the plan, run:
```bash
cd /Users/chau.duong/workspaces/test-kai/scripts && python3 kai_conversation.py round --match <MATCH_ID> --env --message "<MESSAGE>"
```

After each round, briefly note (internally, don't print yet):
- Did Kai respond? (status = input-required)
- Response length and whether it seems relevant
- Latency numbers
- Any errors

Do NOT stop between rounds. Do NOT ask the user anything. Just keep going.

If a round errors, note it and continue to the next round.

### Step 3: End match
```bash
cd /Users/chau.duong/workspaces/test-kai/scripts && python3 kai_conversation.py end --match <MATCH_ID> --env --output ../results/kai_fire_<MATCH_ID>.json
```

### Step 4: Print the full report

Print a single comprehensive report at the end:

```
============================================================
KAI MATCH REPORT — <preset/goal>
============================================================
Match: <match_id>  |  Rounds: <N>  |  Duration: <X>s

MATCH TRANSCRIPT
------------------------------------------------------------
[Round 1] User: <message>
          Kai:  <first 200 chars of response>...
          Status: <status> | 1st byte: <X>ms | Answer: <X>ms
          Score: Relevance=<1-5> Accuracy=<1-5> Helpful=<1-5>

[Round 2] ...
...

PERFORMANCE SUMMARY
------------------------------------------------------------
1st byte: avg=<X>ms  p50=<X>ms  p95=<X>ms  max=<X>ms
Answer:   avg=<X>ms  p50=<X>ms  p95=<X>ms  max=<X>ms
Polls:    avg=<X>  max=<X>
Tools:    <list of tools used, or "none">

QUALITY EVALUATION
------------------------------------------------------------
Per-round scores (1-5):
  Round 1: Relevance=X Accuracy=X Helpful=X
  Round 2: ...

Overall:
  Goal Achievement:   X/5 — <brief reason>
  Context Retention:  X/5 — <brief reason>
  Error Handling:     X/5 — <brief reason>
  Response Quality:   X/5 — <brief reason>
  OVERALL SCORE:      X.X/5

ISSUES FOUND
------------------------------------------------------------
- <any problems, hallucinations, errors, or concerns>

Results saved to: results/kai_fire_<MATCH_ID>.json
============================================================
```

### Step 5: Generate HTML report with benchmarked evaluation

After printing the text report, save your evaluation as a JSON file and generate an HTML report.

**Use these STRICT industry-standard rubrics when scoring (from kai_benchmarks.py):**

**Relevance** — 5: Zero filler, every sentence adds value. 3: Mixes relevant with generic. 1: Off-topic.
**Accuracy** — 5: Every claim verifiable (IDs, numbers match reality). 3: Some unverifiable claims. 1: Fabricated.
**Helpfulness** — 5: Task is DONE, no follow-up needed. 3: Asks questions instead of acting. 1: Blocks progress.
**Tool Usage** — 5: Optimal selection, minimal calls. 3: Missed key tools. 1: No tools when needed.

Be strict. A score of 4+ should be genuinely impressive. Most responses should land at 2-4.

1. Write the evaluation JSON to `results/kai_eval_<MATCH_ID>.json`:
```json
{
  "goal": "<the test preset or goal>",
  "overall_score": 3.2,
  "rounds": [
    {"relevance": 4, "accuracy": 3, "helpfulness": 3, "tool_usage": 3, "feedback": "..."},
    ...
  ],
  "overall": {
    "goal_achievement": {"score": 3, "reason": "..."},
    "context_retention": {"score": 3, "reason": "..."},
    "error_handling": {"score": 3, "reason": "..."},
    "response_quality": {"score": 3, "reason": "..."}
  },
  "issues": ["Issue 1...", "Issue 2..."]
}
```

2. Generate the HTML report (includes benchmark comparison + threshold charts):
```bash
cd /Users/chau.duong/workspaces/test-kai/scripts && python3 kai_report.py generate ../results/kai_fire_<MATCH_ID>.json --eval ../results/kai_eval_<MATCH_ID>.json --open
```

## Rules
- FULLY AUTONOMOUS — do not ask the user anything during execution
- Use `--env` flag always
- Do NOT mock data — all real API calls
- If Kai is slow (>60s per round), note it but continue
- If auth fails on start, stop and report the error immediately
- Save results to `results/` directory
- For the "edge" preset long message, use: "Please analyze the following requirements and generate comprehensive test cases: " + " ".join([f"Requirement {i}: The system shall support feature {i} with comprehensive validation." for i in range(1, 51)])
