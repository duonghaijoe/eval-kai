# Kai Quality Sandbox — Product Slide Deck

> Comprehensive content for generating a presentation via Gamma or similar tools.
> Theme: Professional, clean, tech-forward. Color accent: Indigo (#6366f1).

---

## SLIDE 1: Title

**Kai Quality Sandbox**
*The AI-Powered Testing Platform for Katalon's Kai Agent*

Built by Joe (Chau Duong) — Quality Engineering Director, Katalon
"The goal isn't to destroy Kai — it's to make Kai undestroyable."

Version 2.0 | Live at 10.18.3.20:3006

> SCREENSHOT: Landing page (SessionLauncher) showing the full dashboard with sidebar navigation

---

## SLIDE 2: The Problem

**Why We Built This**

Kai is Katalon's customer-facing AI assistant embedded in TestOps. Before every release, we need answers:

- Does Kai respond accurately to testing questions?
- Does Kai use tools correctly (requirements, test cases, insights)?
- Does Kai maintain context across multi-turn conversations?
- Does Kai handle edge cases and adversarial inputs?
- Does Kai perform within acceptable latency bounds?
- Does Kai hold up under concurrent user load?

**The old way:** Manual testing. Slow. Subjective. No metrics. No data-driven decisions.

**The new way:** Kai Quality Sandbox. Automated. Repeatable. Measurable.

---

## SLIDE 3: Solution Overview

**What Kai Quality Sandbox Does**

1. **Drives real conversations** with Kai using 4 test strategies
2. **Evaluates every exchange** with AI scoring (5 dimensions, 1-5 scale)
3. **Load-tests under concurrency** with the Superfight system
4. **Manages test scenarios** with full CRUD and user submissions
5. **Integrates with Jira** for automated bug logging
6. **Provides AI insights** via Ask Joe chatbot
7. **Delivers release recommendations** — GO / NO-GO / CONDITIONAL

Tech Stack: FastAPI + React 18 + SQLite + Claude Code CLI
Deployment: Docker on internal server (Katalon VPN)

---

## SLIDE 4: Architecture Overview

**System Architecture**

The platform consists of 4 layers:

| Layer | Components |
|-------|-----------|
| **Frontend** | React SPA with 17 components, WebSocket real-time updates |
| **API** | FastAPI with 50+ REST endpoints + WebSocket |
| **Core Engine** | Session Runner, Fire Runner, Superfight Runner, Actor Brain, Rubric Engine |
| **External** | Kai Agent API, Claude Code CLI, TestOps Login API, Jira Cloud, Katalon Platform |

Storage: SQLite (WAL mode) with 13 tables, persisted via Docker volume

> SCREENSHOT: Full page view of the app showing sidebar + main content area

---

## SLIDE 5: Four Fight Modes

**How We Test Kai**

| Mode | Icon | Description | Best For |
|------|------|-------------|----------|
| **Fixed** | Green | Predefined scenarios with exact messages | Regression testing, CI/CD |
| **Explore** | Indigo | AI decides each message dynamically | Exploratory testing |
| **Hybrid** | Orange | AI plans then adapts per exchange | Structured exploration |
| **Fire** | Red | Fully autonomous Claude session | Deep stress testing |

Each mode drives multi-turn conversations with Kai, measures latency, and evaluates quality.

> SCREENSHOT: SessionLauncher page showing the 4 fight mode cards with descriptions

---

## SLIDE 6: Scenario Management

**Full CRUD for Test Scenarios**

**24+ builtin scenarios** across 6 categories:
- Happy Path (6) — core capabilities
- Functional (5) — feature-specific testing
- Edge Cases (6) — boundary and error testing
- Multi-Turn (2) — context retention
- Stress (2) — rapid topic switching
- Guardrails (3) — prompt injection resistance

**Admin operations:** Create, Edit, Clone, Hide/Unhide, Delete
**User submissions:** Anyone can submit → Admin reviews → Approve or Reject

> SCREENSHOT: EnvironmentSettings page → "Fixed Scenarios" tab showing the scenario list with category filter and CRUD buttons

---

## SLIDE 7: Scenario Submission Workflow

**Community-Driven Testing**

1. User submits a new scenario (name, category, steps, tags)
2. Submission appears in the **Submission Pool** tab
3. Admin reviews: **Approve** (converts to custom scenario) or **Reject** (with reason)
4. Notification sent to user about the decision

This creates a collaborative, ever-growing test suite.

> SCREENSHOT: EnvironmentSettings page → "Submission Pool" tab showing pending submissions with Approve/Reject buttons

---

## SLIDE 8: Match System

**Batch Testing at Scale**

A **Match** runs multiple scenarios in parallel:

- **Quick Test**: One-click smoke check
- **Category Match**: All scenarios in a category (e.g., "Happy Path")
- **Full Match**: All scenarios (builtin + custom)

Features:
- Configurable concurrency (default: 3 rounds in parallel per match)
- Per-scenario pass/fail based on rubric threshold
- Match-level aggregation: overall score, pass rate, summary
- Match history cleanup: delete by date range or "older than X days"

> SCREENSHOT: MatchList page showing several matches with status badges, scores, and latency metrics

---

## SLIDE 9: Match Report

**Deep Dive Into Results**

Each match produces a detailed report:

- Scenario-by-scenario breakdown with pass/fail status
- Per-round latency (TTFT and total response time)
- AI evaluation scores per exchange
- Category-level pass rates
- Overall match score and AI-generated summary
- Identified issues and recommendations

> SCREENSHOT: MatchReport page showing the scenario breakdown table with scores, latency, and status badges

---

## SLIDE 10: AI-Powered Evaluation

**How We Score Kai**

**Per-Exchange (5 dimensions):**

| Dimension | Method | What It Measures |
|-----------|--------|-----------------|
| Relevance | Claude AI | Is the response on-topic? |
| Accuracy | Claude AI | Is the information correct? |
| Helpfulness | Claude AI | Does it solve the user's need? |
| Tool Usage | Claude AI | Are tools used appropriately? |
| Latency | Auto-scored | Is the response fast enough? |

**Per-Session (4 additional dimensions):**
- Goal Achievement (1.5x weight)
- Context Retention
- Error Handling
- Response Quality

**Overall Score** = weighted average using configurable rubric (snapshotted at eval time)

> SCREENSHOT: SessionDetail page showing a conversation with per-turn scores and the evaluation summary

---

## SLIDE 11: Configurable Rubric

**Customize What Matters**

Admins can tune:
- **Dimension weights** — e.g., make latency 4x more important than tool usage
- **Score descriptions** — define what 1, 2, 3, 4, 5 means for each dimension
- **Latency thresholds** — e.g., TTFT ≤3s = Excellent, ≤6s = Good, ...
- **Pass threshold** — minimum score to "pass" (default 3.0/5.0)

Weights are **snapshotted** when scoring runs — changing the rubric doesn't affect historical data.

> SCREENSHOT: RubricSettings page showing the dimension weight sliders and latency threshold table

---

## SLIDE 12: Superfight — Load Testing

**Concurrent User Simulation**

The Superfight system tests Kai under real concurrent load:

| Concept | Meaning |
|---------|---------|
| **Fighter** | A provisioned test user account |
| **xPower** | Concurrent chat windows per fighter |
| **Bout** | One conversation (= one match) |
| **Weight Class** | Preset concurrency level (Flyweight → Superfight) |

Formula: N fighters × M xPower = N×M concurrent bouts

**Weight Classes:**

| Class | Fighters | xPower | Bouts |
|-------|----------|--------|-------|
| Flyweight | 2-4 | 1-2 | 2-8 |
| Middleweight | 10-15 | 2-3 | 20-45 |
| Heavyweight | 20-30 | 3-4 | 60-120 |
| Superfight | 50+ | 4+ | 200+ |

> SCREENSHOT: SuperfightArena page showing weight class selection, fighter count, and the start button

---

## SLIDE 13: Load Test Benchmarks

**Grading Performance Under Pressure**

| Grade | TTFT p95 | Total p95 | Response Rate |
|-------|----------|-----------|---------------|
| A+ | < 3s | < 15s | ≥ 99% |
| A | < 5s | < 25s | ≥ 95% |
| B | < 8s | < 40s | ≥ 90% |
| C | < 12s | < 60s | ≥ 80% |
| D | < 20s | < 90s | ≥ 70% |
| F | ≥ 20s | ≥ 90s | < 70% |

Metrics collected: TTFT (p50, p95, max), Total (p50, p95, max), Response Rate, Completion Rate, Error Rate

> SCREENSHOT: Superfight detail page showing the benchmark scorecard and latency charts

---

## SLIDE 14: Fighter Provisioning

**Manage Test Users**

- **Provision**: Create N test accounts on Katalon Platform
- **Sync**: Import existing test users
- **Teardown**: Clean up after load testing
- Per-environment user pools (production, staging)
- Track registration, first login, last activity

> SCREENSHOT: LoadTestUsers page showing the user list with status, environment, and action buttons

---

## SLIDE 15: Ask Joe — AI Chatbot

**Your In-App Testing Companion**

A floating chatbot powered by Claude Code that:

- Explains fight modes, scoring, and platform features
- Reads test scenarios from the database
- Suggests which scenarios to run for specific goals
- Can **launch matches** directly (with user confirmation)
- Renders rich markdown responses
- Refuses off-topic questions, exploits, and injection attempts

"Ask Joe anything about testing Kai."

> SCREENSHOT: AskJoePanel floating chat open with a conversation showing markdown formatting and an action card for launching a match

---

## SLIDE 16: Jira Integration

**Automated Bug Tracking**

| Feature | Description |
|---------|-------------|
| Per-turn bug logging | Click "Log Bug" on any exchange |
| Session-level logging | Log entire session as one Jira issue |
| Auto-logging | Triggers when quality scores drop below threshold |
| Duplicate detection | JQL search + Claude AI analysis prevents noise |
| Assignee routing | Keyword-based rules assign to the right team member |
| Ticket tracking | Jira ticket links shown in session and round views |

> SCREENSHOT: SessionDetail page showing the Jira bug button on a turn, with a linked Jira ticket badge visible

---

## SLIDE 17: Analytics & Trends

**Data-Driven Quality Insights**

- **Trend Charts**: Score and pass rate over time (line charts)
- **Category Breakdown**: Which areas are strong vs weak
- **Latency Analysis**: TTFT and total response time percentiles
- **Ring Comparison**: Production vs Staging side-by-side
- **AI Analysis**: Claude-powered release recommendations

The "Ask Joe" trend analyzer provides:
- GO / NO-GO / CONDITIONAL release recommendation
- Strengths and weaknesses summary
- Risk factors and regressions detected

> SCREENSHOT: MatchTrends page showing trend line charts and the AI analysis panel

---

## SLIDE 18: Reports Dashboard

**Aggregate Intelligence**

The Reports page provides:
- Total sessions, exchanges, pass rate across all time
- Score distribution by fight mode (fixed, explore, hybrid, fire)
- Latency trends (TTFT avg, total avg over time)
- Per-ring comparison (production vs staging scores)
- Historical evaluation dimension breakdown

> SCREENSHOT: Reports page showing aggregate cards, charts, and per-ring comparison

---

## SLIDE 19: Real-Time Monitoring

**Watch Kai Fight Live**

During test execution:
- WebSocket pushes live turn updates
- See each message sent and Kai's response as it happens
- Latency measured per exchange (TTFT + total)
- Scores appear as Claude evaluates each turn
- Tool calls tracked and displayed
- Auto-scroll follows the conversation

> SCREENSHOT: SessionDetail page during a RUNNING session with the spinner and live conversation

---

## SLIDE 20: Multi-Environment Support

**Test Across Rings**

| Environment | Use Case |
|-------------|----------|
| Production | Release validation on live system |
| Staging | Pre-release testing on staging |
| Custom | Feature branch or dev environment testing |

Each environment has:
- Independent credentials (stored securely, never exposed to frontend)
- Project context (project ID, org ID, account)
- Health check endpoint
- Token cache (JWT auto-refresh)

> SCREENSHOT: EnvironmentSettings page → "Sandbox Settings" tab showing environment profiles with health check buttons

---

## SLIDE 21: Notification & Feedback System

**Keep Users Informed**

**Notifications:**
- Feature announcements (auto-seeded for new capabilities)
- Scenario approval/rejection alerts
- Deep links to relevant pages

**Feedback:**
- Users can submit bugs, feature requests, praise
- No authentication required
- Admin dashboard for managing submissions

> SCREENSHOT: NotificationPanel dropdown showing feature announcements with "View" links

---

## SLIDE 22: Admin Controls

**Fine-Grained Configuration**

| Control | Default | Purpose |
|---------|---------|---------|
| Global Concurrency | 10 | Max parallel sessions |
| Match Concurrency | 3 | Max parallel matches |
| Rounds per Match | 3 | Parallel sessions within a match |
| Eval Model | Sonnet | Claude model for scoring |
| Pass Threshold | 3.0/5.0 | Minimum score to pass |

Plus: Admin auth (HMAC-SHA256), bulk operations, match history cleanup with date filtering, confirmation modals for all destructive actions.

> SCREENSHOT: The config section showing concurrency sliders and eval model dropdown

---

## SLIDE 23: Fight Manual

**In-App Documentation**

The Fight Manual teaches users:
- Boxing terminology mapping (why we use "Match", "Round", "Exchange")
- Fight mode explanations with use case guidance
- Scoring system deep dive (dimensions, weights, thresholds)
- Load test concepts (Superfight, Fighter, xPower, Bout)
- Latency grading reference table

Accessible from sidebar navigation and "Under the Hood" links throughout the app.

> SCREENSHOT: Guideline page showing the terminology table and fight mode explanations

---

## SLIDE 24: Security & UX

**Built Secure, Built Usable**

| Security | UX |
|----------|-----|
| Admin auth (HMAC-SHA256, 7-day TTL) | Confirmation modals for all destructive ops |
| Credentials never sent to frontend | Inline error/success banners (no browser alerts) |
| Parameterized SQL queries | Real-time WebSocket updates |
| Chatbot hardened against exploits | Match-belongs warning when deleting rounds |
| VPN/office network only | Custom day input for cleanup |
| Bearer JWT cached + auto-refreshed | Category filters, search, bulk operations |

---

## SLIDE 25: Deployment

**Simple, Reproducible, Persistent**

```
Docker Multi-Stage Build:
  Stage 1: Node 20 → build React frontend
  Stage 2: Python 3.11 + Node 20 → FastAPI + Claude CLI

Volumes:
  kai-data    → SQLite DB + rubric.json
  claude-auth → Claude CLI auth tokens

Deploy: rsync → docker compose up --build -d
Server: 10.18.3.20:3006 (Katalon VPN)
```

One command to deploy. Database persists across restarts. Zero downtime for viewers.

---

## SLIDE 26: Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 7, React Router, Recharts, Lucide React |
| Backend | FastAPI, Uvicorn, SQLite (WAL), httpx |
| AI Engine | Claude Code CLI (Haiku / Sonnet / Opus) |
| Integrations | Jira Cloud API, Katalon Platform API |
| Infrastructure | Docker, Docker Compose, rsync deploy |
| Runtime | Python 3.11, Node 20 |

---

## SLIDE 27: Roadmap

| Version | Features | Status |
|---------|----------|--------|
| v1.0 | Core testing, evaluation, dashboard, multi-env | Done |
| v1.1 | AI trend analysis, configurable rubric, concurrency | Done |
| v1.2 | Superfight load testing, user provisioning, benchmarks | Done |
| v1.3 | Jira integration, auto-bug logging, duplicate detection | Done |
| v2.0 | Scenario CRUD, Ask Joe chatbot, notifications, modals, turn sequencing, cleanup | Done |
| v2.1 | CI/CD integration, scheduled matches, Slack alerts | Planned |
| v2.2 | A/B env comparison, scenario analytics | Planned |
| v3.0 | TestOps integration, release gate automation | Planned |

---

## SLIDE 28: Vision

**From Internal Tool to Product Feature**

Joe's vision for Kai Quality Sandbox:

> "The goal isn't to destroy Kai — it's to make Kai undestroyable."

- Started as a weekend project to automate Kai testing
- Evolved into a full-featured quality platform
- Goal: integrate into Katalon's product pipeline
- Every release backed by data, not guesswork
- Continuous quality improvement through automated regression + AI evaluation

Built with caffeine, Claude Code, and an unhealthy obsession with latency percentiles.

---

## APPENDIX: Boxing Terminology Reference

| Single-User | Load Test | Generic |
|------------|-----------|---------|
| Match | Bout | Conversation |
| Round | Round | Topic segment |
| Exchange | Punch | User msg + Kai response |
| — | Fighter | Test user |
| — | xPower | Concurrency multiplier |
| — | Superfight | Load test event |
