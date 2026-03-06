# Test Kai — E2E Testing for Katalon's Kai Agent

Standalone project for testing and benchmarking the Kai orchestrator agent (CopilotKit-based chatbot in Katalon TestOps).

## Architecture

Kai uses a two-endpoint CopilotKit protocol:
1. **POST `/agent/orchestratorAgent/run`** — starts the agent, returns `{"status":"working"}`
2. **POST `/agent/orchestratorAgent/connect`** — returns conversation state with `historyEvents` (messages)

The client polls `/connect` until status changes from `working` to `input-required`, then extracts the assistant's reply from `historyEvents`.

## Scripts

| File | Purpose |
|------|---------|
| `scripts/kai_client.py` | HTTP client for Kai API — auth, chat, polling, response extraction |
| `scripts/kai_actor.py` | E2E test scenario runner — happy path, edge cases, multi-turn |
| `scripts/kai_analytics.py` | Analytics engine — latency, tools, errors, workflow analysis |

## Quick Start

```bash
# Install deps
pip install -r requirements.txt

# Single scenario test
cd scripts
python kai_actor.py run --env --id happy-greeting -o ../results/test.json -v

# All happy path scenarios
python kai_actor.py run --env --scenario happy -o ../results/happy.json -v

# All edge cases
python kai_actor.py run --env --scenario edge -o ../results/edge.json -v

# All scenarios
python kai_actor.py run --env -o ../results/all.json -v

# Direct chat
python kai_client.py chat --env -m "Hello, what can you do?"

# List conversations
python kai_client.py list --env

# Analyze results
python kai_analytics.py analyze ../results/happy.json
python kai_analytics.py analyze ../results/happy.json --json

# Compare two runs
python kai_analytics.py compare ../results/run1.json ../results/run2.json

# Dashboard from all results
python kai_analytics.py dashboard --dir ../results/
```

## Authentication

The `--env` flag auto-generates a bearer token from `.env` credentials via the TestOps login API. Alternatively, pass a token directly with `--token`.

## Scenario Categories

- **happy** — Core functionality: greeting, capabilities, test generation, insights, execution status
- **edge** — Validation: empty input, long input, special chars, ambiguous requests, out-of-scope, hallucination
- **multi-turn** — Context retention: follow-up questions, refinement chains
- **stress** — (TODO) Concurrent sessions, rapid-fire, large payloads

## Key Metrics

- **TTFB** — Time to first byte (POST /run response time)
- **Total** — End-to-end time including polling
- **Poll Count** — Number of /connect polls before completion
- **Response Text** — Kai's actual reply (captured from historyEvents)
- **Tool Calls** — Agent tool invocations detected in response

## Configuration

`.env` requires:
```
TESTOPS_EMAIL=your@email.com
TESTOPS_PASSWORD=your-api-password
TESTOPS_ACCOUNT=account_id_true
TESTOPS_ACCOUNT_ID=account-uuid
```
