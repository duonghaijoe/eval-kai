const BASE = '';

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
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
