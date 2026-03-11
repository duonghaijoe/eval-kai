# Architecture Document

## Kai Quality Sandbox — System Architecture (v2.0)

---

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph Client["Browser (React SPA)"]
        UI[Dashboard UI]
        WS_C[WebSocket Client]
        API_C[REST Client]
        JOE[Ask Joe Chatbot]
    end

    subgraph Server["FastAPI Server :8000"]
        REST[REST API Layer]
        WSM[WebSocket Manager]
        AUTH[Admin Auth]
        NOTIFY[Notification Engine]
    end

    subgraph Core["Core Engine"]
        SR[Session Runner]
        FR[Fire Runner]
        SF[Superfight Runner]
        AB[Actor Brain]
        RB[Rubric Engine]
        LTU[Load Test Users]
    end

    subgraph External["External Services"]
        KAI[Kai Agent API]
        CLAUDE[Claude Code CLI]
        LOGIN[TestOps Login API]
        JIRA[Jira Cloud API]
        PLATFORM[Katalon Platform API]
    end

    subgraph Storage["Persistence"]
        DB[(SQLite DB)]
        RUBRIC[rubric.json]
        VOL[Docker Volumes]
    end

    UI --> API_C --> REST
    UI --> WS_C --> WSM
    JOE --> REST

    REST --> SR
    REST --> FR
    REST --> SF
    REST --> AUTH
    REST --> NOTIFY
    SR --> AB
    SR --> RB
    FR --> CLAUDE
    SF --> LTU

    SR --> KAI
    AB --> CLAUDE
    SR --> LOGIN
    SF --> KAI
    REST --> JIRA
    LTU --> PLATFORM

    SR --> DB
    FR --> DB
    SF --> DB
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
        R6[EnvironmentSettings<br/>3-tab: Sandbox / Scenarios / Pool]
        R7[SuperfightArena]
        R8[LoadTestUsers]
        R9[Guideline — Fight Manual]
        R10[AskJoePanel — AI Chatbot]
        R11[NotificationPanel]
        R12[FeedbackPanel]
        R13[ConfirmModal]
    end

    subgraph API["API Layer (FastAPI)"]
        direction TB
        A1[Session Endpoints]
        A2[Match Endpoints]
        A3[Config Endpoints]
        A4[Report Endpoints]
        A5[WebSocket Endpoints]
        A6[Scenario CRUD Endpoints]
        A7[Superfight Endpoints]
        A8[Jira Integration Endpoints]
        A9[Ask Joe Endpoint]
        A10[Notification / Feedback]
    end

    subgraph Business["Business Logic"]
        direction TB
        B1[Session Runner]
        B2[Fire Runner]
        B3[Actor Brain]
        B4[Rubric Engine]
        B5[Env Config Manager]
        B6[Superfight Runner]
        B7[Load Test User Provisioner]
        B8[Jira Integration]
        B9[Kai Benchmarks]
    end

    subgraph Data["Data Layer"]
        direction TB
        D1[Database CRUD — 13 tables]
        D2[Token Cache]
        D3[Rubric Storage]
    end

    Presentation --> API --> Business --> Data
```

### 2.2 Backend Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **REST API** | `server.py` | 50+ HTTP endpoints, request validation, admin auth |
| **WebSocket Manager** | `server.py` | Real-time event broadcasting to connected clients |
| **Session Runner** | `session_runner.py` | Orchestrates test sessions: message flow, turn sequencing, evaluation, DB writes |
| **Fire Runner** | `fire_runner.py` | Autonomous Claude Code sessions for fire mode |
| **Superfight Runner** | `superfight_runner.py` | Load test executor: concurrent bouts, metrics collection, benchmarking |
| **Actor Brain** | `actor_brain.py` | Claude CLI wrapper for message decisions and evaluations |
| **Rubric Engine** | `rubric.py` | Scoring criteria, latency thresholds, weight management |
| **Kai Benchmarks** | `kai_benchmarks.py` | Latency grading (A+ to F), quality scoring for load tests |
| **Env Config** | `env_config.py` | Multi-environment credential and URL management |
| **Database** | `database.py` | SQLite CRUD operations, 13 tables, schema migrations |
| **Kai Client** | `kai_client.py` | Kai API protocol implementation (CopilotKit polling) |
| **Kai Actor** | `kai_actor.py` | Predefined test scenario definitions |
| **Jira Integration** | `jira_integration.py` | Bug logging, duplicate detection, assignee routing |
| **Load Test Users** | `load_test_users.py` | Test user provisioning via Katalon Platform API |

### 2.3 Frontend Components

```mermaid
graph TD
    App[App.jsx<br/>Layout + Router + AdminContext] --> SL[SessionLauncher<br/>New Match / Quick Test]
    App --> SList[SessionList<br/>Browse + Filter + Bulk Delete + Jira]
    App --> SD[SessionDetail<br/>Real-time Turn Viewer + Jira]
    App --> ML[MatchList<br/>Browse + Rerun + Date Cleanup]
    App --> MR[MatchReport<br/>Per-Scenario Breakdown]
    App --> MT[MatchTrends<br/>Trend Charts + AI Analysis]
    App --> RP[Reports<br/>Aggregate Dashboards]
    App --> RS[RubricSettings<br/>Edit Scoring Criteria]
    App --> ES[EnvironmentSettings<br/>3-Tab: Sandbox / Scenarios / Pool]
    App --> SA[SuperfightArena<br/>Load Test Control Panel]
    App --> LTU[LoadTestUsers<br/>Fighter Provisioning]
    App --> GL[Guideline<br/>Fight Manual]
    App --> NP[NotificationPanel<br/>Feature Announcements]
    App --> FP[FeedbackPanel<br/>User Feedback]
    App --> AJ[AskJoePanel<br/>Floating AI Chatbot]
    App --> CM[ConfirmModal<br/>Reusable Danger Dialog]

    SL -->|POST /api/sessions| API[api.js]
    SL -->|POST /api/matches| API
    SD -->|WebSocket /ws/id| WS[WebSocket]
    ML -->|GET+DELETE /api/matches| API
    MR -->|GET /api/matches/id| API
    MT -->|POST /api/match-trends/analyze| API
    AJ -->|POST /api/ask-joe| API
    SA -->|POST /api/superfight/start| API
    ES -->|CRUD /api/scenarios| API
```

---

## 3. Data Architecture

### 3.1 Entity Relationship

```mermaid
erDiagram
    MATCHES ||--o{ SESSIONS : contains
    SESSIONS ||--o{ TURNS : has
    SESSIONS ||--o| EVALUATIONS : evaluated_by
    SESSIONS ||--o{ JIRA_TICKETS : linked_to
    SUPERFIGHTS ||--o{ BOUTS : contains

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

    CUSTOM_SCENARIOS {
        text id PK
        text name
        text description
        text category
        text steps_json
        text tags_json
        text source
        text created_by
    }

    HIDDEN_SCENARIOS {
        text id PK
        text hidden_by
        text created_at
    }

    SCENARIO_SUBMISSIONS {
        text id PK
        text name
        text description
        text category
        text steps_json
        text tags
        text status
        text submitted_by
        text reviewed_by
    }

    NOTIFICATIONS {
        text id PK
        text type
        text title
        text message
        text link
        text created_at
    }

    FEEDBACK {
        text id PK
        text type
        text name
        text message
        text created_at
    }

    JIRA_TICKETS {
        text ticket_key PK
        text session_id FK
        int turn_number
        text created_at
    }

    JIRA_CONFIG {
        text key PK
        text base_url
        text project_key
        text auth_token
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
        int is_active
    }

    TOKEN_CACHE {
        text env_key PK
        text token
        real expires_at
    }

    LOAD_TEST_USERS {
        text email PK
        text env_key
        text password
        text status
        text registered_at
    }

    SUPERFIGHTS {
        text id PK
        text weight_class
        text env_key
        text fight_mode
        int num_fighters
        int windows_per_fighter
        text status
        text metrics_json
        text benchmark_json
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
| Tables | 13 tables |
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

### Turn Sequencing (v2.0)

```mermaid
sequenceDiagram
    participant SR as Session Runner
    participant KC as Kai Client
    participant Kai as Kai Agent

    SR->>KC: wait_for_ready(thread_id, 120s)
    KC->>Kai: Poll /connect until input-required
    alt Ready
        Kai-->>KC: status: input-required
        KC-->>SR: ready
        SR->>SR: Sleep 2s (typing delay)
        SR->>KC: chat(message)
    else Timeout (120s)
        KC-->>SR: timeout
        SR->>SR: Skip turn with error
        Note right of SR: Continue to next turn
    else Error
        KC-->>SR: error
        SR->>SR: Proceed with new message
    end
```

Three-layer protection against overlapping requests:
1. **wait_for_ready** — polls Kai before sending next message (120s timeout)
2. **chat() polls** — waits for complete response during send
3. **Post-chat verification** — flags incomplete responses if status still "working"

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
    MODE -->|fixed| FIXED[Load Scenario Steps<br/>builtin or custom]
    MODE -->|explore| EXPLORE[AI Decides Message]
    MODE -->|hybrid| HYBRID[Generate Plan → AI Adapts]

    FIXED --> LOOP
    EXPLORE --> LOOP
    HYBRID --> LOOP

    subgraph LOOP["Turn Loop"]
        direction TB
        CHECK[Check Time/Turn Limits] --> READY[wait_for_ready<br/>120s timeout]
        READY -->|ready| DELAY[Sleep 2s Typing Delay]
        READY -->|timeout| SKIP[Skip Turn with Error]
        DELAY --> MSG[Get Message]
        MSG --> PENDING[Save Pending Turn to DB]
        PENDING --> WS1[Broadcast turn_start]
        WS1 --> SEND[Send to Kai via Client]
        SEND --> VERIFY{Status == working?}
        VERIFY -->|yes| FLAG[Flag as Incomplete]
        VERIFY -->|no| OK[Response Complete]
        FLAG --> SCORE
        OK --> SCORE
        SCORE --> SCORE_L[Auto-Score Latency]
        SCORE_L --> SAVE_T[Update Turn in DB]
        SAVE_T --> WS2[Broadcast turn_complete]
        WS2 --> EVAL_T[Evaluate Turn via Claude]
        EVAL_T --> WS_SCORE[Broadcast turn_scored]
        WS_SCORE --> JIRA{Auto-log Jira?}
        JIRA -->|threshold met| LOG[Log Bug to Jira]
        JIRA -->|no| SLEEP[Sleep 1s Rate Limit]
        LOG --> SLEEP
        SLEEP --> CHECK
        SKIP --> CHECK
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
    FILTER -->|yes| SUBSET[Filter Scenarios<br/>builtin + custom, excl. hidden]
    FILTER -->|no| ALL[All Scenarios]

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

### 5.4 Superfight (Load Test) Execution

```mermaid
flowchart TD
    START[POST /api/superfight/start] --> CONFIG[Select Weight Class<br/>+ Fighters + xPower]
    CONFIG --> PROVISION[Verify Provisioned Users]
    PROVISION --> RAMP[Ramp-up Phase]

    RAMP --> BOUTS["Launch N×M Concurrent Bouts"]

    subgraph BOUTS
        direction TB
        B1[Fighter 1 × Window 0] --> R1[Execute Rounds]
        B2[Fighter 1 × Window 1] --> R2[Execute Rounds]
        B3[Fighter 2 × Window 0] --> R3[Execute Rounds]
        BN[...] --> RN[...]
    end

    BOUTS --> COLLECT[Collect Metrics per Bout]
    COLLECT --> AGG[Aggregate: TTFT p50/p95/max<br/>Response Rate, Completion Rate]
    AGG --> BENCH[Benchmark Grade A+ to F]
    BENCH --> SAVE[Save Superfight to DB]
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

### 6.3 Load Test Benchmarks (Superfight Grading)

| Grade | TTFT p95 | Total p95 | Response Rate | Description |
|-------|----------|-----------|---------------|-------------|
| A+ | < 3s | < 15s | >= 99% | Exceptional |
| A | < 5s | < 25s | >= 95% | Excellent |
| B | < 8s | < 40s | >= 90% | Good |
| C | < 12s | < 60s | >= 80% | Acceptable |
| D | < 20s | < 90s | >= 70% | Poor |
| F | >= 20s | >= 90s | < 70% | Critical |

### 6.4 Rubric Weight Snapshot

```mermaid
flowchart LR
    R[rubric.json] -->|load at eval time| W[Extract Weights]
    W --> S[Snapshot as JSON]
    S --> DB[(evaluations.rubric_weights)]
    DB -->|display| UI[Show weights in UI<br/>even if rubric changes later]
```

---

## 7. Ask Joe — AI Chatbot Architecture

```mermaid
flowchart TD
    USER[User types question] --> PANEL[AskJoePanel.jsx<br/>floating chat widget]
    PANEL -->|POST /api/ask-joe| SERVER[FastAPI]
    SERVER --> INJECT[Inject scenario data<br/>from DB into prompt]
    INJECT --> CLAUDE[Claude CLI subprocess<br/>--model haiku --max-turns 1]
    CLAUDE --> PARSE[Parse response]
    PARSE --> MD[Markdown text]
    PARSE --> ACTION["Action block<br/>(```action {...}```)"]

    MD --> RENDER[MarkdownText renderer<br/>bold, italic, code, lists]
    ACTION --> CARD[ActionCard component<br/>match config preview]
    CARD -->|user confirms| LAUNCH[POST /api/matches<br/>create + navigate]
```

**Security Hardening:**
- Read-only: can read scenarios from DB, cannot write
- Refuses code generation, config changes, prompt injection attempts
- Only triggers match execution with explicit user confirmation
- Scoped to tool usage questions only

---

## 8. Scenario Management Architecture

```mermaid
flowchart TD
    subgraph Sources["Scenario Sources"]
        BUILTIN[24 Builtin Scenarios<br/>kai_actor.py]
        CUSTOM[Custom Scenarios<br/>custom_scenarios table]
        SUBMIT[User Submissions<br/>scenario_submissions table]
    end

    subgraph Visibility["Visibility Control"]
        HIDDEN[hidden_scenarios table<br/>soft-delete for builtins]
    end

    subgraph Operations["Admin Operations"]
        CREATE[Create Custom]
        EDIT_C[Edit Custom In-Place]
        CLONE[Clone Builtin → Custom]
        HIDE[Hide Builtin]
        UNHIDE[Unhide Builtin]
        DELETE[Delete Custom]
    end

    subgraph Review["Submission Review"]
        APPROVE[Approve → Custom]
        REJECT[Reject + Reason]
    end

    BUILTIN --> HIDDEN
    HIDDEN -->|filtered| LAUNCHER[Session Launcher]
    CUSTOM --> LAUNCHER
    SUBMIT --> Review
    APPROVE --> CUSTOM

    Operations --> CUSTOM
    Operations --> HIDDEN
```

---

## 9. Jira Integration Architecture

```mermaid
flowchart TD
    subgraph Triggers["Bug Logging Triggers"]
        MANUAL[Manual: Admin clicks Log Bug]
        AUTO[Auto: Quality threshold met]
        SESSION[Session-level: Log all turns]
    end

    Triggers --> CHECK[Duplicate Detection<br/>JQL search + Claude AI analysis]
    CHECK -->|duplicate| SKIP[Skip — link existing]
    CHECK -->|new| CREATE[Create Jira Issue]
    CREATE --> ASSIGN[Keyword-based Assignee Routing]
    ASSIGN --> JIRA[Jira Cloud API]
    JIRA --> SAVE[Save ticket_key to DB]
    SAVE --> NOTIFY[Notification to UI]
```

---

## 10. Concurrency Model

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

## 11. Real-Time Communication

### 11.1 WebSocket Architecture

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
        E3[turn_scored]
        E4[session_complete]
    end

    C1 --> ACTIVE
    C2 --> ACTIVE
    C3 --> GLOBAL

    Events -->|broadcast| ACTIVE
    Events -->|broadcast| GLOBAL
```

### 11.2 Event Payloads

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
  "eval": {},
  "eval_latency": 3
}
```

**turn_scored:**
```json
{
  "type": "turn_scored",
  "turn_number": 1,
  "eval": {"relevance": 5, "accuracy": 5, "helpfulness": 4, "tool_usage": 5},
  "eval_latency": 3
}
```

**session_complete:**
```json
{
  "type": "session_complete",
  "session_id": "abc123",
  "evaluation": {"goal_achievement": 5, "context_retention": 4},
  "turns_completed": 1
}
```

---

## 12. Deployment Architecture

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

### 12.1 Dockerfile (Multi-Stage)

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

### 12.2 Deploy Commands

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

## 13. Security

| Concern | Implementation |
|---------|---------------|
| **Admin Auth** | HMAC-SHA256 token, 7-day TTL, required for destructive ops |
| **Credential Storage** | SQLite (server-only), passwords never sent to frontend |
| **API Auth** | Bearer JWT cached in SQLite, auto-refreshed on expiry |
| **Network Access** | Katalon VPN or office network only (no public exposure) |
| **Secrets** | `.env` file, never committed, mounted read-only in Docker |
| **XSS Prevention** | React auto-escaping, no `dangerouslySetInnerHTML` |
| **SQL Injection** | Parameterized queries throughout |
| **Chatbot Hardening** | Ask Joe: read-only, refuses exploits/injection/code generation |
| **Confirmation Modals** | All destructive operations use ConfirmModal with danger warnings |

---

## 14. Performance Optimizations

| Optimization | Impact |
|-------------|--------|
| **KaiClient singleton** | Avoids re-auth per session (saves 5-10s login) |
| **Token cache (SQLite)** | Bearer JWT reused across container restarts |
| **ActorBrain singleton** | `claude --version` check runs once, not per session |
| **SQLite WAL mode** | Concurrent reads during writes |
| **Per-match semaphore** | Parallel session execution within matches |
| **WebSocket broadcasting** | Efficient real-time updates (no polling) |
| **Rubric weight snapshot** | Avoids re-computation when rubric changes |
| **Turn sequencing** | wait_for_ready prevents overlapping Kai requests |
| **Notification seeding** | Release notifications auto-seeded on startup |

---

## 15. API Reference

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
| POST | `/api/matches/delete-by-date` | Admin | Delete by date range or older-than |

### Scenarios

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/scenarios` | - | List all scenarios (builtin + custom, excl. hidden) |
| POST | `/api/scenarios/custom` | Admin | Create custom scenario |
| PUT | `/api/scenarios/custom/{id}` | Admin | Update custom scenario |
| DELETE | `/api/scenarios/custom/{id}` | Admin | Delete custom scenario |
| POST | `/api/scenarios/{id}/hide` | Admin | Hide scenario (soft-delete) |
| POST | `/api/scenarios/{id}/unhide` | Admin | Unhide scenario |
| POST | `/api/scenarios/submit` | - | Submit scenario for review |
| GET | `/api/scenarios/submissions` | Admin | List pending submissions |
| POST | `/api/scenarios/submissions/{id}/approve` | Admin | Approve submission |
| POST | `/api/scenarios/submissions/{id}/reject` | Admin | Reject submission |

### Configuration

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/config` | - | Get config (concurrency, model, CLI status) |
| PUT | `/api/config` | Admin | Update config |
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
| POST | `/api/match-trends/analyze` | - | AI quality analysis |

### Ask Joe (AI Chatbot)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/ask-joe` | - | Chat with Joe (Claude CLI subprocess) |

### Superfight (Load Testing)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/load-test/weight-classes` | - | List weight class definitions |
| POST | `/api/load-test/sync` | Admin | Sync test users from platform |
| POST | `/api/load-test/provision` | Admin | Provision N new test users |
| GET | `/api/load-test/provision/{task_id}` | - | Poll provision task |
| POST | `/api/load-test/teardown` | Admin | Teardown test users |
| GET | `/api/load-test/users` | - | List provisioned users |
| DELETE | `/api/load-test/users/{email}` | Admin | Delete user record |
| POST | `/api/superfight/start` | - | Start superfight |
| GET | `/api/superfight/active` | - | Get running superfight |
| GET | `/api/superfight/{id}` | - | Superfight detail + benchmark |
| GET | `/api/superfights` | - | List superfight history |
| GET | `/api/superfights/compare` | - | Compare superfights |
| DELETE | `/api/superfight/{id}` | Admin | Delete superfight |

### Jira Integration

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/jira/config` | - | Get Jira config |
| PUT | `/api/jira/config` | Admin | Update Jira config |
| POST | `/api/jira/test` | Admin | Test connection |
| POST | `/api/jira/log-bug` | Admin | Log per-turn bug |
| POST | `/api/jira/log-session-bug` | Admin | Log session bug |
| GET | `/api/jira/tickets/{session_id}` | - | Get linked tickets |
| GET | `/api/jira/filter-url` | - | Jira filter URL |

### Notifications & Feedback

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/notifications` | - | List notifications |
| POST | `/api/notifications` | Admin | Create notification |
| DELETE | `/api/notifications/{id}` | Admin | Delete notification |
| POST | `/api/feedback` | - | Submit feedback |
| GET | `/api/feedback` | Admin | List feedback |
| DELETE | `/api/feedback/{id}` | Admin | Delete feedback |

### Auth & Bot

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/login` | - | Admin login |
| GET | `/api/me` | Bearer | Check auth status |
| GET | `/api/joe-bot/health` | - | Claude CLI availability |
| POST | `/api/joe-bot/auth/start` | - | Start Claude OAuth |
| POST | `/api/joe-bot/auth/complete` | - | Complete OAuth |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws` | Global subscription (all session events) |
| `/ws/{session_id}` | Session-specific subscription |

---

## 16. Tech Stack Summary

```mermaid
graph LR
    subgraph Frontend
        REACT[React 18]
        VITE[Vite 7]
        RR[React Router v6]
        RC[Recharts]
        LR[Lucide React]
    end

    subgraph Backend
        FAST[FastAPI]
        UVICORN[Uvicorn]
        SQLITE[SQLite WAL]
        HTTPX[httpx]
    end

    subgraph AI
        CLAUDE[Claude Code CLI<br/>Haiku / Sonnet / Opus]
    end

    subgraph Integrations
        JIRA_I[Jira Cloud]
        PLATFORM_I[Katalon Platform]
    end

    subgraph Infra
        DOCKER[Docker]
        COMPOSE[Docker Compose]
        RSYNC[rsync deploy]
    end

    Frontend --> Backend --> AI
    Backend --> SQLITE
    Backend --> Integrations
    Infra --> Backend
```

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 19.x |
| **Bundler** | Vite | 7.3 |
| **Routing** | React Router | 7.x |
| **Charts** | Recharts | 3.7 |
| **Icons** | Lucide React | 0.577 |
| **Backend** | FastAPI | 0.115+ |
| **Server** | Uvicorn | 0.30+ |
| **HTTP Client** | httpx | 0.27+ |
| **Database** | SQLite | 3 (stdlib) |
| **AI Eval** | Claude Code CLI | latest |
| **Container** | Docker + Compose | latest |
| **Runtime** | Python 3.11, Node 20 | |
