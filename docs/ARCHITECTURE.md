# Architecture Document

## Kai Quality Sandbox — System Architecture

---

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph Client["Browser (React SPA)"]
        UI[Dashboard UI]
        WS_C[WebSocket Client]
        API_C[REST Client]
    end

    subgraph Server["FastAPI Server :8000"]
        REST[REST API Layer]
        WSM[WebSocket Manager]
        AUTH[Admin Auth]
    end

    subgraph Core["Core Engine"]
        SR[Session Runner]
        FR[Fire Runner]
        AB[Actor Brain]
        RB[Rubric Engine]
    end

    subgraph External["External Services"]
        KAI[Kai Agent API]
        CLAUDE[Claude Code CLI]
        LOGIN[TestOps Login API]
    end

    subgraph Storage["Persistence"]
        DB[(SQLite DB)]
        RUBRIC[rubric.json]
        VOL[Docker Volumes]
    end

    UI --> API_C --> REST
    UI --> WS_C --> WSM

    REST --> SR
    REST --> FR
    REST --> AUTH
    SR --> AB
    SR --> RB
    FR --> CLAUDE

    SR --> KAI
    AB --> CLAUDE
    SR --> LOGIN

    SR --> DB
    FR --> DB
    RB --> RUBRIC
    DB --> VOL
```

---

## 2. Component Architecture

### 2.1 System Layers

```mermaid
graph LR
    subgraph Presentation["Presentation Layer"]
        direction TB
        R1[SessionLauncher]
        R2[SessionDetail]
        R3[MatchList / MatchReport]
        R4[MatchTrends / Reports]
        R5[RubricSettings]
        R6[EnvironmentSettings]
    end

    subgraph API["API Layer (FastAPI)"]
        direction TB
        A1[Session Endpoints]
        A2[Match Endpoints]
        A3[Config Endpoints]
        A4[Report Endpoints]
        A5[WebSocket Endpoints]
    end

    subgraph Business["Business Logic"]
        direction TB
        B1[Session Runner]
        B2[Fire Runner]
        B3[Actor Brain]
        B4[Rubric Engine]
        B5[Env Config Manager]
    end

    subgraph Data["Data Layer"]
        direction TB
        D1[Database CRUD]
        D2[Token Cache]
        D3[Rubric Storage]
    end

    Presentation --> API --> Business --> Data
```

### 2.2 Backend Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **REST API** | `server.py` | HTTP endpoints, request validation, admin auth |
| **WebSocket Manager** | `server.py` | Real-time event broadcasting to connected clients |
| **Session Runner** | `session_runner.py` | Orchestrates test sessions: message flow, evaluation, DB writes |
| **Fire Runner** | `fire_runner.py` | Autonomous Claude Code sessions for fire mode |
| **Actor Brain** | `actor_brain.py` | Claude CLI wrapper for message decisions and evaluations |
| **Rubric Engine** | `rubric.py` | Scoring criteria, latency thresholds, weight management |
| **Env Config** | `env_config.py` | Multi-environment credential and URL management |
| **Database** | `database.py` | SQLite CRUD operations, schema migrations |
| **Kai Client** | `kai_client.py` | Kai API protocol implementation (CopilotKit polling) |
| **Kai Actor** | `kai_actor.py` | Predefined test scenario definitions |

### 2.3 Frontend Components

```mermaid
graph TD
    App[App.jsx<br/>Layout + Router + AdminContext] --> SL[SessionLauncher<br/>New Match / Quick Test]
    App --> SList[SessionList<br/>Browse + Filter + Bulk Delete]
    App --> SD[SessionDetail<br/>Real-time Turn Viewer]
    App --> ML[MatchList<br/>Browse + Rerun + Bulk Delete]
    App --> MR[MatchReport<br/>Per-Scenario Breakdown]
    App --> MT[MatchTrends<br/>Trend Charts + Ask Joe]
    App --> RP[Reports<br/>Aggregate Dashboards]
    App --> RS[RubricSettings<br/>Edit Scoring Criteria]
    App --> ES[EnvironmentSettings<br/>Multi-Env + Concurrency]

    SL -->|POST /api/sessions| API[api.js]
    SL -->|POST /api/matches| API
    SD -->|WebSocket /ws/id| WS[WebSocket]
    ML -->|GET /api/matches| API
    MR -->|GET /api/matches/id| API
    MT -->|POST /api/match-trends/analyze| API
```

---

## 3. Data Architecture

### 3.1 Entity Relationship

```mermaid
erDiagram
    MATCHES ||--o{ SESSIONS : contains
    SESSIONS ||--o{ TURNS : has
    SESSIONS ||--o| EVALUATIONS : evaluated_by

    MATCHES {
        text id PK
        text name
        text category
        text env_key
        text status
        int scenario_count
        real max_time_s
        text eval_model
        text started_at
        text ended_at
        real overall_score
        text pass_rate
        text summary
        text issues
    }

    SESSIONS {
        text id PK
        text match_id FK
        text actor_mode
        text goal
        text scenario_id
        text env_key
        text status
        int max_turns
        real max_time_s
        text thread_id
        text started_at
        text ended_at
        text stop_reason
        text env_info
    }

    TURNS {
        int id PK
        text session_id FK
        int turn_number
        text user_message
        text assistant_response
        text status
        real ttfb_ms
        real total_ms
        int poll_count
        text tool_calls
        text error
        int eval_relevance
        int eval_accuracy
        int eval_helpfulness
        int eval_tool_usage
        int eval_latency
    }

    EVALUATIONS {
        int id PK
        text session_id FK
        int goal_achievement
        int context_retention
        int error_handling
        int response_quality
        real overall_score
        text summary
        text issues
        text rubric_weights
    }

    ENV_PROFILES {
        text key PK
        text name
        text base_url
        text login_url
        text platform_url
        text project_id
        text org_id
        text cred_email
        text cred_password
        text cred_account
        int is_active
    }

    TOKEN_CACHE {
        text env_key PK
        text email
        text platform_url
        text token
        real expires_at
    }
```

### 3.2 Database Configuration

| Setting | Value |
|---------|-------|
| Engine | SQLite 3 |
| WAL Mode | Enabled (concurrent reads during writes) |
| Foreign Keys | Enabled |
| Location | `web/data/kai_tests.db` |
| Persistence | Docker volume `kai-data` |
| Migrations | Auto-applied on startup (ALTER TABLE IF NOT EXISTS) |

---

## 4. Kai API Protocol

Kai uses a CopilotKit-based two-endpoint polling protocol (no SSE streaming):

```mermaid
sequenceDiagram
    participant Client as Kai Client
    participant Run as POST /agent/.../run
    participant Connect as POST /agent/.../connect

    Client->>Run: Send message + thread_id
    Run-->>Client: {"status": "working"}
    Note right of Client: TTFT measured here

    loop Poll every 2s
        Client->>Connect: {thread_id, run_id}
        Connect-->>Client: {"status": "working", "historyEvents": [...]}
    end

    Client->>Connect: {thread_id, run_id}
    Connect-->>Client: {"status": "input-required", "historyEvents": [...]}
    Note right of Client: Total time measured here

    Client->>Client: Extract assistant messages from historyEvents
```

### Key Protocol Details

- **No partial content**: During `working` status, `historyEvents` may be incomplete
- **TTFT**: Measured when `/run` returns (API acceptance time, not first content)
- **Total**: Measured when final `/connect` returns `input-required`
- **Thread ID**: Maintained across turns for multi-turn context
- **Tool calls**: Extracted from `historyEvents` entries with `role: "tool"` or `toolCalls` array
- **Response concatenation**: All assistant messages concatenated (forward order) from `historyEvents`

### Authentication Chain

```mermaid
flowchart TD
    A[Session Start] --> B{Token Cached?}
    B -->|Yes, valid > 5min| C[Use Cached Token]
    B -->|No or expired| D[Login API]
    D -->|POST /login| E[TestOps Puppeteer Auth]
    E -->|JWT Token| F[Cache in SQLite]
    F --> C
    C --> G[Set Bearer Header]
    G --> H[Call Kai API]
```

---

## 5. Session Execution Flow

### 5.1 Standard Modes (Fixed/Explore/Hybrid)

```mermaid
flowchart TD
    START[POST /api/sessions] --> CREATE[Create Session Record]
    CREATE --> BG[Launch Background Task]
    BG --> SEM[Acquire Semaphore]
    SEM --> INIT[Init KaiClient + ActorBrain<br/>cached singletons]

    INIT --> MODE{Actor Mode?}
    MODE -->|fixed| FIXED[Load Scenario Steps]
    MODE -->|explore| EXPLORE[AI Decides Message]
    MODE -->|hybrid| HYBRID[Generate Plan → AI Adapts]

    FIXED --> LOOP
    EXPLORE --> LOOP
    HYBRID --> LOOP

    subgraph LOOP["Turn Loop"]
        direction TB
        CHECK[Check Time/Turn Limits] --> MSG[Get Message]
        MSG --> WS1[Broadcast turn_start]
        WS1 --> SEND[Send to Kai via Client]
        SEND --> EVAL_T[Evaluate Turn via Claude]
        EVAL_T --> SCORE_L[Auto-Score Latency]
        SCORE_L --> SAVE_T[Save Turn to DB]
        SAVE_T --> WS2[Broadcast turn_complete]
        WS2 --> SLEEP[Sleep 1s Rate Limit]
        SLEEP --> CHECK
    end

    LOOP --> EVAL_S[Evaluate Session via Claude]
    EVAL_S --> CALC[Compute Overall Score<br/>weighted avg with rubric]
    CALC --> SNAP[Snapshot Rubric Weights]
    SNAP --> SAVE_E[Save Evaluation to DB]
    SAVE_E --> DONE[Update Session → completed]
    DONE --> WS3[Broadcast session_complete]
```

### 5.2 Fire Mode

```mermaid
flowchart TD
    START[POST /api/sessions<br/>mode=fire] --> SPAWN[Spawn Claude CLI Process]
    SPAWN --> STREAM[Stream JSON Output]

    subgraph CLAUDE["Autonomous Claude Session"]
        direction TB
        C1[Claude reads fire prompt] --> C2[Decides test strategy]
        C2 --> C3[Sends messages to Kai]
        C3 --> C4[Evaluates responses]
        C4 --> C5[Generates structured report]
    end

    STREAM --> PARSE[Parse stream-json Events]
    PARSE --> FWD[Forward to WebSocket]
    PARSE --> EXTRACT[Extract Report JSON]
    EXTRACT --> SAVE[Save Turns + Evaluation to DB]
```

### 5.3 Match Execution

```mermaid
flowchart TD
    MATCH[POST /api/matches] --> CREATE[Create Match Record]
    CREATE --> FILTER{Category Filter?}
    FILTER -->|yes| SUBSET[Filter Scenarios]
    FILTER -->|no| ALL[All 24 Scenarios]

    SUBSET --> LAUNCH
    ALL --> LAUNCH

    LAUNCH[Launch Match Background Task] --> MSEM[Acquire Match Semaphore]
    MSEM --> SESSIONS[Create Session per Scenario]

    SESSIONS --> PAR["Parallel Execution<br/>(per-match semaphore)"]

    subgraph PAR
        S1[Session 1] --> R1[Run Session]
        S2[Session 2] --> R2[Run Session]
        S3[Session 3] --> R3[Run Session]
        SN[...] --> RN[...]
    end

    PAR --> AGG[Aggregate Results]
    AGG --> EVAL_M[Evaluate Match<br/>pass_rate, overall_score]
    EVAL_M --> DONE[Update Match → completed]
```

---

## 6. Evaluation Architecture

### 6.1 Scoring Pipeline

```mermaid
flowchart LR
    subgraph PerTurn["Per-Turn Scoring"]
        direction TB
        T_REL[Relevance 1-5]
        T_ACC[Accuracy 1-5]
        T_HLP[Helpfulness 1-5]
        T_TOOL[Tool Usage 1-5]
        T_LAT[Latency 1-5<br/>auto-scored]
    end

    subgraph PerSession["Per-Session Scoring"]
        direction TB
        S_GOAL[Goal Achievement 1-5]
        S_CTX[Context Retention 1-5]
        S_ERR[Error Handling 1-5]
        S_QUAL[Response Quality 1-5]
    end

    subgraph Overall["Overall Score"]
        direction TB
        AVG[Weighted Average<br/>of turn dimensions]
    end

    PerTurn -->|avg across turns| AVG
    AVG --> PASS{>= threshold?}
    PASS -->|yes| PASSED[PASSED]
    PASS -->|no| FAILED[FAILED]
```

### 6.2 Latency Thresholds (Default)

| Score | TTFT (ms) | Total (ms) | Description |
|-------|-----------|------------|-------------|
| 5 | <= 3,000 | <= 15,000 | Excellent |
| 4 | <= 6,000 | <= 30,000 | Good |
| 3 | <= 10,000 | <= 60,000 | Acceptable |
| 2 | <= 20,000 | <= 120,000 | Slow |
| 1 | > 20,000 | > 120,000 | Unacceptable |

### 6.3 Rubric Weight Snapshot

```mermaid
flowchart LR
    R[rubric.json] -->|load at eval time| W[Extract Weights]
    W --> S[Snapshot as JSON]
    S --> DB[(evaluations.rubric_weights)]
    DB -->|display| UI[Show weights in UI<br/>even if rubric changes later]
```

---

## 7. Concurrency Model

```mermaid
flowchart TD
    subgraph Global["Global Semaphore (default: 10)"]
        direction LR
        G1[Round 1]
        G2[Round 2]
        G3[Round 3]
        GN[... Round N]
    end

    subgraph MatchSem["Match Semaphore (default: 3)"]
        direction LR
        M1[Match A]
        M2[Match B]
        M3[Match C]
    end

    subgraph PerMatch["Per-Match Semaphore (default: 3)"]
        direction LR
        PM1[Round 1]
        PM2[Round 2]
        PM3[Round 3]
    end

    MatchSem --> Global
    PerMatch --> Global
```

| Layer | Default | Controls |
|-------|---------|----------|
| **Global Rounds** | 10 | Total concurrent sessions across entire system |
| **Concurrent Matches** | 3 | How many matches can run simultaneously |
| **Rounds per Match** | 3 | How many sessions within one match run in parallel |

All configurable via admin API (`PUT /api/config`).

---

## 8. Real-Time Communication

### 8.1 WebSocket Architecture

```mermaid
flowchart TD
    subgraph Clients
        C1[Browser 1<br/>/ws/abc123]
        C2[Browser 2<br/>/ws/abc123]
        C3[Browser 3<br/>/ws global]
    end

    subgraph Manager["Connection Manager"]
        ACTIVE["active: {session_id: [ws1, ws2]}"]
        GLOBAL["global_subs: [ws3]"]
    end

    subgraph Events
        E1[turn_start]
        E2[turn_complete]
        E3[session_complete]
    end

    C1 --> ACTIVE
    C2 --> ACTIVE
    C3 --> GLOBAL

    Events -->|broadcast| ACTIVE
    Events -->|broadcast| GLOBAL
```

### 8.2 Event Payloads

**turn_start:**
```json
{"type": "turn_start", "turn_number": 1, "user_message": "Hello!"}
```

**turn_complete:**
```json
{
  "type": "turn_complete",
  "turn_number": 1,
  "user_message": "Hello!",
  "assistant_response": "Hi! I'm Kai...",
  "status": "input-required",
  "ttfb_ms": 3251.2,
  "total_ms": 52100.0,
  "poll_count": 8,
  "tool_calls": ["frontend_render_link"],
  "eval": {"relevance": 5, "accuracy": 5, "helpfulness": 4, "tool_usage": 5},
  "eval_latency": 3
}
```

**session_complete:**
```json
{
  "type": "session_complete",
  "session_id": "abc123",
  "evaluation": {"goal_achievement": 5, "context_retention": 4, ...},
  "turns_completed": 1
}
```

---

## 9. Environment Configuration

```mermaid
flowchart LR
    subgraph Profiles["Environment Profiles (SQLite)"]
        P[Production<br/>katalonhub.katalon.io]
        S[Staging<br/>staginggen3platform...com]
        C[Custom<br/>user-defined]
    end

    subgraph Creds["Credential Sources"]
        DB[(env_profiles table)]
        ENV[.env file]
    end

    subgraph Cache["Token Cache"]
        TC[(token_cache table<br/>JWT + expiry)]
    end

    Profiles -->|active profile| A[get_active_env]
    A -->|lookup creds| DB
    DB -->|fallback| ENV
    A -->|get token| Cache
    Cache -->|miss| LOGIN[TestOps Login API]
    LOGIN -->|cache JWT| Cache
    A -->|create| CLIENT[KaiClient Instance<br/>cached singleton]
```

---

## 10. Deployment Architecture

```mermaid
graph TB
    subgraph Docker["Docker Container"]
        subgraph App["Application"]
            UVICORN[Uvicorn :8000]
            FASTAPI[FastAPI App]
            REACT[React SPA<br/>static files in /dist]
            CLAUDE_CLI[Claude Code CLI<br/>Node.js global]
        end

        subgraph Volumes["Persistent Volumes"]
            V1["kai-data<br/>/app/web/data/<br/>SQLite DB + rubric.json"]
            V2["claude-auth<br/>/root/.claude/<br/>Claude CLI auth tokens"]
        end
    end

    subgraph Host["Host: 10.18.3.20"]
        DOTENV[".env file<br/>(credentials)"]
        PORT["Port 3006"]
    end

    subgraph Network["Katalon Network"]
        VPN[Katalon VPN]
        OFFICE[Office Network]
    end

    PORT --> UVICORN
    DOTENV -.->|mounted| Docker
    VPN --> PORT
    OFFICE --> PORT

    FASTAPI --> V1
    CLAUDE_CLI --> V2
```

### 10.1 Dockerfile (Multi-Stage)

```
Stage 1: frontend-build (node:20-slim)
  ├── npm ci
  └── npm run build → /app/web/frontend/dist

Stage 2: runtime (python:3.11-slim)
  ├── Install Node.js 20 (for Claude CLI)
  ├── npm install -g @anthropic-ai/claude-code
  ├── pip install -r requirements.txt
  ├── Copy scripts/, web/, frontend dist
  └── Entrypoint: uvicorn server:app
```

### 10.2 Deploy Commands

```bash
# Build + deploy
cd /Users/chau.duong/workspaces/test-kai
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude '.env' \
  . katalon@10.18.3.20:/home/katalon/test-kai/
ssh katalon@10.18.3.20 "cd /home/katalon/test-kai && docker compose up --build -d"

# Verify
curl http://10.18.3.20:3006/api/health
```

---

## 11. Security

| Concern | Implementation |
|---------|---------------|
| **Admin Auth** | HMAC-SHA256 token, 7-day TTL, required for destructive ops |
| **Credential Storage** | SQLite (server-only), passwords never sent to frontend |
| **API Auth** | Bearer JWT cached in SQLite, auto-refreshed on expiry |
| **Network Access** | Katalon VPN or office network only (no public exposure) |
| **Secrets** | `.env` file, never committed, mounted read-only in Docker |
| **XSS Prevention** | React auto-escaping, no `dangerouslySetInnerHTML` |
| **SQL Injection** | Parameterized queries throughout |

---

## 12. Performance Optimizations

| Optimization | Impact |
|-------------|--------|
| **KaiClient singleton** | Avoids re-auth per session (saves 5-10s login) |
| **Token cache (SQLite)** | Bearer JWT reused across container restarts |
| **ActorBrain singleton** | `claude --version` check runs once, not per session |
| **SQLite WAL mode** | Concurrent reads during writes |
| **Per-match semaphore** | Parallel session execution within matches |
| **WebSocket broadcasting** | Efficient real-time updates (no polling) |
| **Rubric weight snapshot** | Avoids re-computation when rubric changes |

---

## 13. API Reference

### Sessions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/sessions` | - | Start a new test session |
| GET | `/api/sessions` | - | List sessions (paginated) |
| GET | `/api/sessions/{id}` | - | Get session with turns + evaluation |
| DELETE | `/api/sessions/{id}` | Admin | Delete session (not running) |
| POST | `/api/sessions/bulk-delete` | Admin | Bulk delete sessions |

### Matches

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/matches` | - | Create match (batch test) |
| GET | `/api/matches` | - | List matches |
| GET | `/api/matches/{id}` | - | Match report with scenario breakdown |
| DELETE | `/api/matches/{id}` | Admin | Delete match + cascade |
| POST | `/api/matches/bulk-delete` | Admin | Bulk delete matches |

### Configuration

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/config` | - | Get config (concurrency, model, CLI status) |
| PUT | `/api/config` | Admin | Update config |
| GET | `/api/scenarios` | - | List predefined test scenarios |
| GET | `/api/rubric` | - | Get current rubric |
| PUT | `/api/rubric` | Admin | Update rubric |
| POST | `/api/rubric/reset` | Admin | Reset rubric to defaults |

### Environment

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/env-config` | - | Get environments (passwords masked) |
| PUT | `/api/env-config` | Admin | Update environments |
| DELETE | `/api/env-config/{key}` | Admin | Delete environment profile |
| POST | `/api/env-config/reset` | Admin | Reset to defaults |
| GET | `/api/env-config/{key}/health` | - | Health check for environment |

### Reports & Analytics

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/reports` | - | Aggregate stats (filter by ring) |
| GET | `/api/match-trends` | - | Historical match trends |
| POST | `/api/match-trends/analyze` | - | AI quality analysis (Ask Joe) |
| GET | `/api/health` | - | System health check |

### Auth & Bot

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/login` | - | Admin login |
| GET | `/api/me` | Bearer | Check auth status |
| GET | `/api/joe-bot/health` | - | Claude CLI availability |
| POST | `/api/joe-bot/auth/start` | - | Start Claude OAuth |
| POST | `/api/joe-bot/auth/complete` | - | Complete OAuth with code |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws` | Global subscription (all session events) |
| `/ws/{session_id}` | Session-specific subscription |

---

## 14. Tech Stack Summary

```mermaid
graph LR
    subgraph Frontend
        REACT[React 18]
        VITE[Vite]
        RR[React Router v6]
        RC[Recharts]
        LR[Lucide React]
        RM[React Markdown]
    end

    subgraph Backend
        FAST[FastAPI]
        UVICORN[Uvicorn]
        SQLITE[SQLite WAL]
        HTTPX[httpx]
    end

    subgraph AI
        CLAUDE[Claude Code CLI<br/>Sonnet / Opus]
    end

    subgraph Infra
        DOCKER[Docker]
        COMPOSE[Docker Compose]
        RSYNC[rsync deploy]
    end

    Frontend --> Backend --> AI
    Backend --> SQLITE
    Infra --> Backend
```

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 19.2 |
| **Bundler** | Vite | 7.3 |
| **Routing** | React Router | 7.13 |
| **Charts** | Recharts | 3.7 |
| **Icons** | Lucide React | 0.577 |
| **Markdown** | React Markdown | 10.1 |
| **Backend** | FastAPI | 0.115+ |
| **Server** | Uvicorn | 0.30+ |
| **HTTP Client** | httpx | 0.27+ |
| **Database** | SQLite | 3 (stdlib) |
| **AI Eval** | Claude Code CLI | latest |
| **Container** | Docker + Compose | latest |
| **Runtime** | Python 3.11, Node 20 | |
