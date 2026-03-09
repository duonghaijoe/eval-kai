# Test Kai — AI Coding Guidelines

## Project Context
Standalone E2E testing project for Katalon's Kai orchestrator agent.
- Python scripts in `scripts/` — client, actor (test runner), analytics
- Web dashboard in `web/` — FastAPI backend + React frontend
- Results stored as JSON in `results/`
- Auth via `.env` credentials (TestOps login API → bearer token)

---

## TECH STACK

```yaml
frontend:
  framework: React 18 (JSX, no TypeScript)
  bundler: Vite
  styling: CSS custom properties (Katalon brand theme)
  icons: Lucide React
  charts: Recharts
  routing: React Router v6

backend:
  runtime: Python 3.9+
  framework: FastAPI + Uvicorn
  database: SQLite (WAL mode, foreign keys)
  ai_brain: Claude Code CLI subprocess (subscription-based, no API key)
  websocket: FastAPI native WebSocket

scripts:
  language: Python 3.9+
  http: httpx (async)
  auth: TestOps login API → bearer token

devops:
  containerization: Docker + Docker Compose
  deployment: rsync + docker compose up --build
  server: 10.18.3.20:3006
  persistence: Docker volumes (claude-auth, kai-data)
```

---

## CODING PRINCIPLES

### Python (Backend & Scripts)
```python
# DO
- Use type hints for function signatures
- Use async/await for I/O operations
- Handle errors with try/except and meaningful messages
- Use contextmanager for database connections
- Keep functions focused (< 40 lines)
- Use f-strings for formatting
- Validate at system boundaries (API inputs, env vars)

# DON'T
- Never use mock data — fail explicitly instead
- Never log passwords, tokens, or bearer auth
- Never hardcode URLs or secrets (use .env)
- Never skip error handling on external API calls
- Never write functions > 100 lines
```

### JavaScript/React (Frontend)
```javascript
// DO
- Use functional components with hooks
- Use CSS custom properties for theming (Katalon brand)
- Use Lucide React for all icons
- Handle loading/error/empty states in every component
- Use meaningful component and variable names

// DON'T
- Never hardcode colors — use CSS variables
- Never skip loading states for async operations
- Never ignore WebSocket cleanup in useEffect
- Never create documentation files unless explicitly requested
```

---

## Terminology (Boxing Analogy)

All UI, code, and documentation MUST use these terms consistently.

### Single-User Testing (Matches)
| Term | Meaning | Example |
|------|---------|---------|
| **Match** | One complete test conversation with Kai (1+ rounds) | A fire/explore/hybrid test run |
| **Round** | A segment within a match (1+ exchanges) | "Test the login flow" — a themed block of conversation |
| **Exchange** | One pair of turns — user msg + Kai response | "Show me test results" → Kai responds |

Hierarchy: `Match > Round > Exchange`

### Load Testing (Superfight Camp)
| Term | Meaning | Example |
|------|---------|---------|
| **Superfight** | The entire load test event | "Flyweight with 4 bouts x 6 rounds" |
| **Fighter** | A provisioned test user | `kai_1772983749_0` |
| **xPower** | Concurrent chat windows per fighter | 2 xPower = 2 parallel conversations |
| **Bout** | One conversation = one Match (fighter x window) | Fighter #1, Window #0 = 1 bout |
| **Round** | A segment within a bout (1+ punches) | Same as a Match round |
| **Punch** | A single turn — one message sent or received | User sends "Hello" = 1 punch, Kai responds = 1 punch |

Hierarchy: `Superfight > Fighter > Bout (=Match) > Round > Punch (=Turn)`

Formula: `N fighters x M xPower = N*M bouts x R rounds`

### Equivalence Table
| Match Context | Superfight Context | Generic |
|--------------|-------------------|---------|
| Match | Bout | Conversation |
| Round | Round | Segment / topic block |
| Exchange | Punch | User msg + Kai response |
| — | Fighter | Test user |
| — | xPower | Concurrency multiplier |
| — | Superfight | Load test event |

### Scoring (applies to BOTH Match and Superfight)
| Metric | Source | Description |
|--------|--------|-------------|
| **TTFT** | Nielsen/Google UX | Time to First Token — how fast Kai starts responding |
| **Full Answer** | Forrester/AgentBench | Total time from message to complete response |
| **Latency Grade** | `kai_benchmarks.py` | A+ to F, 4-tier thresholds (Excellent/Good/Acceptable/Critical) |
| **Quality Score** | Anthropic/AgentBench | Relevance, Accuracy, Helpfulness, Tool Usage (1-5 each) |
| **Response Rate** | Load test only | % of rounds that got a non-empty response |
| **Completion Rate** | Load test only | % of bouts that completed all rounds |
| **Error Rate** | Load test only | % of bouts that errored |

### Terms to NEVER use
- ~~Session~~ → use **Match** (single-user) or **Bout** (load test)
- ~~Turn~~ → use **Punch** (load test) or **Exchange** (single-user)
- ~~TTFB~~ → use **TTFT** (Time to First Token) in UI
- ~~steps~~ → use **Rounds**

---

## Kai API Protocol
Kai uses a CopilotKit-based two-endpoint protocol:
1. **POST `/agent/orchestratorAgent/run`** — starts agent, returns `{"status":"working"}`
2. **POST `/agent/orchestratorAgent/connect`** — returns `{"status":"...", "historyEvents":[...]}` with conversation messages
- Poll `/connect` until status is `input-required` or `error`
- Extract assistant reply from the last `historyEvents` entry with `role: "assistant"`
- No SSE streaming — server returns fixed JSON responses
- No `/messages` endpoint exists — all message data comes from `/connect`

---

## UI THEME

White theme with indigo accent:

```css
:root {
  --accent: #6366f1;          /* Indigo — primary actions, links, active states */
  --accent-hover: #4f46e5;    /* Dark Indigo — hover states */
  --bg-primary: #f8f9fb;      /* Light Gray — page background */
  --bg-secondary: #ffffff;    /* White — sidebar */
  --bg-card: #ffffff;          /* White — cards */
  --bg-hover: #f0f1f3;        /* Hover state */
  --text-primary: #1a1d27;    /* Dark */
  --text-secondary: #4b5563;  /* Gray */
  --text-muted: #9ca3af;      /* Light Gray */
  --green: #16a34a;            /* Success */
  --red: #dc2626;              /* Error */
  --yellow: #ca8a04;          /* Warning */
  --orange: #ea580c;          /* Hybrid mode */
  --blue: #2563eb;            /* Running state */
  --border: #e5e7eb;
  --radius: 8px;
}
```

### Badge Color Mapping
- `running` → blue | `completed` → green | `error` → red | `pending` → yellow
- `explore` → accent (indigo) | `hybrid` → orange | `fixed` → green | `fire` → red

---

## PROJECT STRUCTURE

```
test-kai/
├── scripts/                  # Standalone Python scripts
│   ├── kai_client.py         # Core Kai API client (auth, chat, poll)
│   ├── kai_actor.py          # Predefined test scenarios runner
│   ├── kai_conversation.py   # Turn-by-turn conversation driver (CLI)
│   ├── kai_analytics.py      # Results analysis
│   └── kai_report.py         # Report generation
├── web/                      # Web dashboard
│   ├── server.py             # FastAPI app (REST + WebSocket)
│   ├── database.py           # SQLite schema + CRUD (data/ subdir)
│   ├── session_runner.py     # Session orchestrator (semaphore concurrency)
│   ├── actor_brain.py        # Claude CLI subprocess brain
│   ├── fire_runner.py        # Autonomous Claude session spawner
│   ├── data/                 # SQLite DB (Docker volume mounted)
│   └── frontend/             # React app (Vite)
│       ├── src/
│       │   ├── App.jsx       # Layout + routing
│       │   ├── App.css       # Component styles
│       │   ├── index.css     # Base styles + Katalon theme
│       │   ├── api.js        # API client functions
│       │   └── components/   # Page components
│       └── dist/             # Production build
├── results/                  # JSON test results
├── Dockerfile                # Multi-stage (Node build + Python runtime)
├── docker-compose.yml        # Deployment config (port 3006)
└── .env                      # Credentials (never commit)
```

---

## Development Rules
- Do not use mock data — fail explicitly instead
- Do not create documentation files unless explicitly requested
- Keep it simple — minimal abstractions
- All scripts run from `scripts/` directory
- Use `--env` flag to auto-generate bearer tokens from `.env`
- Max 3 concurrent sessions (configurable via `MAX_CONCURRENT_SESSIONS`)

## Common Commands
```bash
# Scripts
cd scripts
python kai_actor.py run --env --id happy-greeting -v        # single test
python kai_actor.py run --env --scenario happy -v           # category
python kai_client.py chat --env -m "Hello"                  # direct chat
python kai_analytics.py analyze ../results/file.json        # analyze

# Frontend dev
cd web/frontend && npm run dev                              # dev server (proxy to :8000)
cd web/frontend && npm run build                            # production build

# Backend dev
cd web && python -m uvicorn server:app --reload --port 8000

# Deploy
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude '.env' . katalon@10.18.3.20:/home/katalon/test-kai/
ssh katalon@10.18.3.20 "cd /home/katalon/test-kai && docker compose up --build -d"
```
