const BASE = '';

// ── Duration formatting ─────────────────────────────────────────

export function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) {
    const s = Math.floor(ms / 1000)
    const rem = Math.round(ms % 1000)
    return rem > 0 ? `${s}s ${rem}ms` : `${s}s`
  }
  if (ms < 3600000) {
    const m = Math.floor(ms / 60000)
    const s = Math.round((ms % 60000) / 1000)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function formatSec(sec) {
  if (!sec && sec !== 0) return '-'
  return formatMs(sec * 1000)
}

// ── Date formatting (UTC+7) ─────────────────────────────────────

const TZ = 'Asia/Bangkok';

export function formatDt(dateStr) {
  if (!dateStr) return '-';
  const d = dateStr.endsWith('Z') ? new Date(dateStr) : new Date(dateStr + 'Z');
  return d.toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = dateStr.endsWith('Z') ? new Date(dateStr) : new Date(dateStr + 'Z');
  return d.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' });
}

export function formatTime(dateStr) {
  if (!dateStr) return '-';
  const d = dateStr.endsWith('Z') ? new Date(dateStr) : new Date(dateStr + 'Z');
  return d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

// ── Auth ─────────────────────────────────────────────────────────

const TOKEN_KEY = 'kai_admin_token';

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders() {
  const token = getAdminToken();
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function login(username, password) {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Login failed');
  }
  const data = await res.json();
  setAdminToken(data.token);
  return data;
}

export async function logout() {
  clearAdminToken();
}

export async function getMe() {
  const token = getAdminToken();
  if (!token) return null;
  const res = await fetch(`${BASE}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { clearAdminToken(); return null; }
  return res.json();
}

export async function startSession({ actorMode, goal, scenarioId, maxTurns, maxTimeS, evalModel }) {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      actor_mode: actorMode,
      goal,
      scenario_id: scenarioId,
      max_turns: maxTurns,
      max_time_s: maxTimeS,
      eval_model: evalModel,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to start session');
  }
  return res.json();
}

export async function listSessions(limit = 50) {
  const res = await fetch(`${BASE}/api/sessions?limit=${limit}`);
  return res.json();
}

export async function getSession(sessionId) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}`);
  if (!res.ok) throw new Error('Session not found');
  return res.json();
}

export async function deleteSession(sessionId) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}`, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete');
  }
  return res.json();
}

export async function bulkDeleteSessions(ids) {
  const res = await fetch(`${BASE}/api/sessions/bulk-delete`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete');
  }
  return res.json();
}

// ── Matches ──────────────────────────────────────────────────────

export async function createMatch({ category, maxTimeS, evalModel } = {}) {
  const res = await fetch(`${BASE}/api/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: category || null,
      max_time_s: maxTimeS || 600,
      eval_model: evalModel,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to start match');
  }
  return res.json();
}

export async function listMatches(limit = 50) {
  const res = await fetch(`${BASE}/api/matches?limit=${limit}`);
  return res.json();
}

export async function getMatchReport(matchId) {
  const res = await fetch(`${BASE}/api/matches/${matchId}`);
  if (!res.ok) throw new Error('Match not found');
  return res.json();
}

export async function deleteMatch(matchId) {
  const res = await fetch(`${BASE}/api/matches/${matchId}`, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete match');
  }
  return res.json();
}

export async function bulkDeleteMatches(ids) {
  const res = await fetch(`${BASE}/api/matches/bulk-delete`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete');
  }
  return res.json();
}

// Legacy
export async function runAllFixed(opts) {
  return createMatch(opts);
}

export async function getBatchReport(batchId) {
  const res = await fetch(`${BASE}/api/batch/${batchId}`);
  if (!res.ok) throw new Error('Batch not found');
  return res.json();
}

// ── Rubric ───────────────────────────────────────────────────────

export async function getRubric() {
  const res = await fetch(`${BASE}/api/rubric`);
  return res.json();
}

export async function updateRubric(rubric) {
  const res = await fetch(`${BASE}/api/rubric`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(rubric),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to save');
  }
  return res.json();
}

export async function resetRubric() {
  const res = await fetch(`${BASE}/api/rubric/reset`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to reset');
  }
  return res.json();
}

// ── Environment Config ───────────────────────────────────────────

export async function getEnvConfig() {
  const res = await fetch(`${BASE}/api/env-config`);
  return res.json();
}

export async function updateEnvConfig(config) {
  const res = await fetch(`${BASE}/api/env-config`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(config),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to save');
  }
  return res.json();
}

export async function deleteEnvProfile(envKey) {
  const res = await fetch(`${BASE}/api/env-config/${envKey}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete');
  }
  return res.json();
}

export async function resetEnvConfig() {
  const res = await fetch(`${BASE}/api/env-config/reset`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Admin login required');
  return res.json();
}

// ── Load Test Users ─────────────────────────────────────────────

export async function listLoadTestUsers(envKey) {
  const params = envKey ? `?env_key=${envKey}` : '';
  const res = await fetch(`${BASE}/api/load-test/users${params}`);
  return res.json();
}

export async function syncLoadTestUsers(envKey) {
  const params = envKey ? `?env_key=${envKey}` : '';
  const res = await fetch(`${BASE}/api/load-test/sync${params}`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Sync failed');
  }
  return res.json();
}

export async function provisionLoadTestUsers({ count, envKey }) {
  const res = await fetch(`${BASE}/api/load-test/provision`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ count, env_key: envKey }),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to provision');
  }
  return res.json();
}

export async function getProvisionStatus(taskId) {
  const res = await fetch(`${BASE}/api/load-test/provision/${taskId}`);
  if (!res.ok) throw new Error('Task not found');
  return res.json();
}

export async function teardownLoadTestUsers({ email, envKey }) {
  const res = await fetch(`${BASE}/api/load-test/teardown`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email: email || null, env_key: envKey }),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to teardown');
  }
  return res.json();
}

export async function deleteLoadTestUserRecord(email, envKey) {
  const params = envKey ? `?env_key=${envKey}` : '';
  const res = await fetch(`${BASE}/api/load-test/users/${encodeURIComponent(email)}${params}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete');
  }
  return res.json();
}

// ── Superfight (Load Test) ───────────────────────────────────────

export async function getWeightClasses() {
  const res = await fetch(`${BASE}/api/superfight/weight-classes`);
  return res.json();
}

export async function startSuperfight({ weightClass, numUsers, windowsPerUser, turnsPerSession, rampUpS, intervalS, messages, envKey, fightMode, scenarioCategory }) {
  const res = await fetch(`${BASE}/api/superfight/start`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      weight_class: weightClass,
      num_users: numUsers || null,
      windows_per_user: windowsPerUser || 1,
      turns_per_session: turnsPerSession || 3,
      ramp_up_s: rampUpS || 0,
      interval_s: intervalS || 0,
      messages: messages || null,
      env_key: envKey,
      fight_mode: fightMode || 'fixed',
      scenario_category: scenarioCategory || null,
    }),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to start superfight');
  }
  return res.json();
}

export async function getActiveSuperfight() {
  const res = await fetch(`${BASE}/api/superfight/active`);
  if (!res.ok) return null;
  return res.json();
}

export async function getSuperfight(fightId) {
  const res = await fetch(`${BASE}/api/superfight/${fightId}`);
  if (!res.ok) throw new Error('Superfight not found');
  return res.json();
}

export async function listSuperfights(limit = 50, envKey = null) {
  const params = envKey ? `?limit=${limit}&env_key=${envKey}` : `?limit=${limit}`;
  const res = await fetch(`${BASE}/api/superfights${params}`);
  return res.json();
}

export async function compareSuperfights(envKey = null, limit = 10) {
  const params = new URLSearchParams({ limit });
  if (envKey) params.set('env_key', envKey);
  const res = await fetch(`${BASE}/api/superfights/compare?${params}`);
  return res.json();
}

export async function deleteSuperfight(fightId) {
  const res = await fetch(`${BASE}/api/superfight/${fightId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to delete');
  }
  return res.json();
}

// ── Other ────────────────────────────────────────────────────────

export async function getScenarios() {
  const res = await fetch(`${BASE}/api/scenarios`);
  return res.json();
}

export async function getReports(ring = null) {
  const params = ring && ring !== 'all' ? `?ring=${ring}` : '';
  const res = await fetch(`${BASE}/api/reports${params}`);
  return res.json();
}

export async function getMatchTrends(ring = null) {
  const params = ring ? `?ring=${ring}` : '';
  const res = await fetch(`${BASE}/api/match-trends${params}`);
  return res.json();
}

export async function analyzeMatchTrends(ring = null) {
  const params = ring ? `?ring=${ring}` : '';
  const res = await fetch(`${BASE}/api/match-trends/analyze${params}`, { method: 'POST' });
  if (!res.ok) throw new Error('Analysis failed');
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(`${BASE}/api/health`);
  return res.json();
}

export async function checkEnvHealth(envKey) {
  const res = await fetch(`${BASE}/api/env-config/${envKey}/health`);
  return res.json();
}

export async function getConfig() {
  const res = await fetch(`${BASE}/api/config`);
  return res.json();
}

export async function updateConfig(config) {
  const res = await fetch(`${BASE}/api/config`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(config),
  });
  if (res.status === 401) throw new Error('Admin login required');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to update config');
  }
  return res.json();
}

// ── Joe Bot ─────────────────────────────────────────────────────

export async function checkJoeBotHealth() {
  const res = await fetch(`${BASE}/api/joe-bot/health`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function startJoeBotAuth() {
  const res = await fetch(`${BASE}/api/joe-bot/auth/start`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function completeJoeBotAuth(code) {
  const res = await fetch(`${BASE}/api/joe-bot/auth/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function connectWebSocket(sessionId = null) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const path = sessionId ? `/ws/${sessionId}` : '/ws';
  return new WebSocket(`${protocol}//${host}${path}`);
}
