import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Settings, Globe, CheckCircle, Save, RotateCcw, Lock, Plus, Trash2, ExternalLink, Key, Heart, HeartOff, Activity, Bot, Bug, AlertCircle, FileCheck, XCircle, ChevronRight, ChevronDown, Eye, Edit3, Send, Copy, RefreshCw, Building2, FolderOpen, Database } from 'lucide-react'
import { getEnvConfig, updateEnvConfig, resetEnvConfig, deleteEnvProfile, checkEnvHealth, checkJoeBotHealth, startJoeBotAuth, completeJoeBotAuth, getConfig, updateConfig, getJiraConfig, updateJiraConfig, testJiraConnection, getJiraFilterUrl, getSubmissions, approveSubmission, rejectSubmission, deleteCustomScenario, createCustomScenario, updateCustomScenario, getScenarios, hideScenario, discoverAccounts, discoverProjects, discoverLicenseSources, listDataSources, createDataSource, updateDataSource, deleteDataSource, syncDataSource, syncAllDataSources, getDataSourceItems } from '../api'
import { useAdmin } from '../AdminContext'

function HealthResult({ health }) {
  if (!health) return null
  const { kai } = health
  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        {kai.ok
          ? <Heart size={11} style={{ color: 'var(--green)' }} />
          : <HeartOff size={11} style={{ color: 'var(--red)' }} />
        }
        <strong>Kai:</strong>
        <span style={{ color: kai.ok ? 'var(--green)' : 'var(--red)' }}>
          {kai.ok ? 'OK' : 'Failed'}
        </span>
        {kai.ok && kai.ttfb_ms > 0 && (
          <span style={{ color: 'var(--text-muted)' }}>
            (TTFT {Math.round(kai.ttfb_ms)}ms, Total {Math.round(kai.total_ms)}ms)
          </span>
        )}
      </div>
      {kai.ok && kai.response && (
        <div style={{ marginTop: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.72rem', lineHeight: '1.5' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.2rem', color: 'var(--text-primary)' }}>Kai says:</div>
          <div
            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border)', whiteSpace: 'pre-line' }}
            dangerouslySetInnerHTML={{ __html: kai.response.slice(0, 400)
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/- /g, '<br/>• ')
              .replace(/\n/g, '<br/>')
            }}
          />
        </div>
      )}
      {!kai.ok && kai.response && (
        <div style={{ marginTop: '0.3rem', color: 'var(--red)', fontSize: '0.68rem' }}>
          Kai: {kai.response.slice(0, 300)}
          {kai.auth_ok === false && kai.auth_method && (
            <div style={{ marginTop: '0.15rem', color: 'var(--text-muted)' }}>
              Auth method: {kai.auth_method}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function JoeBotCard() {
  const [health, setHealth] = useState(null)
  const [checking, setChecking] = useState(false)
  const [authUrl, setAuthUrl] = useState(null)
  const [authCode, setAuthCode] = useState('')
  const [authStatus, setAuthStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const runCheck = async () => {
    setChecking(true)
    setHealth(null)
    try {
      const result = await checkJoeBotHealth()
      setHealth(result)
    } catch (e) {
      setHealth({ ok: false, response: e.message })
    } finally {
      setChecking(false)
    }
  }

  const startAuth = async () => {
    setAuthStatus(null)
    try {
      const result = await startJoeBotAuth()
      if (result.url) {
        setAuthUrl(result.url)
      } else {
        setAuthStatus({ ok: false, message: result.error || 'Could not get auth URL' })
      }
    } catch (e) {
      setAuthStatus({ ok: false, message: e.message })
    }
  }

  const submitCode = async () => {
    if (!authCode.trim()) return
    setSubmitting(true)
    setAuthStatus(null)
    try {
      const result = await completeJoeBotAuth(authCode.trim())
      if (result.ok) {
        setAuthStatus({ ok: true, message: 'Authorized successfully!' })
        setAuthUrl(null)
        setAuthCode('')
        // Re-run health check
        setTimeout(runCheck, 1000)
      } else {
        setAuthStatus({ ok: false, message: result.output || 'Auth failed' })
      }
    } catch (e) {
      setAuthStatus({ ok: false, message: e.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>
          <Bot size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
          Joe's AI Bot (Claude)
        </h3>
        <button onClick={runCheck} disabled={checking} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
          {checking
            ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Testing...</>
            : <><Activity size={11} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />Health Check</>
          }
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        Joe's AI Bot uses Claude to drive conversations and evaluate Kai's responses. It's shared across all environments.
      </div>

      {health && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            {health.ok
              ? <Heart size={11} style={{ color: 'var(--green)' }} />
              : <HeartOff size={11} style={{ color: 'var(--red)' }} />
            }
            <strong>Status:</strong>
            <span style={{ color: health.ok ? 'var(--green)' : 'var(--red)' }}>
              {health.ok ? 'OK' : 'Not Available'}
            </span>
            {health.latency_ms > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>({Math.round(health.latency_ms)}ms)</span>
            )}
          </div>
          {health.ok && health.response && (
            <div style={{ marginTop: '0.3rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              "{health.response.slice(0, 150)}"
            </div>
          )}
          {!health.ok && health.response && (
            <div style={{ marginTop: '0.3rem', color: 'var(--red)', fontSize: '0.68rem' }}>
              {health.response.slice(0, 300)}
            </div>
          )}
          {!health.ok && (health.needs_auth || health.response?.toLowerCase().includes('api key') || health.response?.toLowerCase().includes('auth')) && !authUrl && (
            <button onClick={startAuth} style={{ marginTop: '0.4rem', fontSize: '0.7rem', padding: '0.25em 0.6em' }} className="primary">
              Authorize Claude
            </button>
          )}
        </div>
      )}

      {authUrl && (
        <div style={{ marginTop: '0.5rem', padding: '0.6rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', border: '1px solid var(--accent)', fontSize: '0.75rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Step 1: Open this URL and authorize</div>
          <a href={authUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>
            {authUrl} <ExternalLink size={9} style={{ verticalAlign: 'middle' }} />
          </a>
          <div style={{ fontWeight: 600, marginTop: '0.5rem', marginBottom: '0.3rem' }}>Step 2: Paste the auth code below</div>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <input
              value={authCode}
              onChange={e => setAuthCode(e.target.value)}
              placeholder="Paste authorization code..."
              style={{ flex: 1, fontSize: '0.75rem' }}
              onKeyDown={e => e.key === 'Enter' && submitCode()}
            />
            <button onClick={submitCode} disabled={!authCode.trim() || submitting} className="primary" style={{ fontSize: '0.7rem' }}>
              {submitting ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Submit'}
            </button>
          </div>
          {authStatus && (
            <div style={{ marginTop: '0.3rem', color: authStatus.ok ? 'var(--green)' : 'var(--red)', fontSize: '0.7rem' }}>
              {authStatus.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function JiraConfigCard({ readOnly }) {
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [filterUrl, setFilterUrl] = useState(null)
  const [newRule, setNewRule] = useState({ keywords: '', assignee: '' })

  useEffect(() => {
    getJiraConfig().then(d => { setCfg(d); setLoading(false) }).catch(() => setLoading(false))
    getJiraFilterUrl().then(d => setFilterUrl(d.url)).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const updated = await updateJiraConfig(cfg)
      setCfg(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testJiraConnection()
      setTestResult(result)
    } catch (e) {
      setTestResult({ ok: false, error: e.message })
    } finally {
      setTesting(false)
    }
  }

  const addRule = () => {
    if (!newRule.keywords.trim() || !newRule.assignee.trim()) return
    const rules = [...(cfg.assignment_rules || []), {
      keywords: newRule.keywords.split(',').map(k => k.trim()).filter(Boolean),
      assignee: newRule.assignee.trim(),
    }]
    setCfg(c => ({ ...c, assignment_rules: rules }))
    setNewRule({ keywords: '', assignee: '' })
  }

  const removeRule = (idx) => {
    setCfg(c => ({ ...c, assignment_rules: (c.assignment_rules || []).filter((_, i) => i !== idx) }))
  }

  if (loading) return <div className="card"><span className="spinner" /> Loading Jira config...</div>
  if (!cfg) return null

  const rules = typeof cfg.assignment_rules === 'string' ? JSON.parse(cfg.assignment_rules || '[]') : (cfg.assignment_rules || [])

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>
          <Bug size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
          Jira Bug Tracking
        </h3>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {filterUrl && (
            <a href={filterUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.68rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '0.15rem', textDecoration: 'none' }}>
              View All Tickets <ExternalLink size={9} />
            </a>
          )}
          <button onClick={handleTest} disabled={testing || readOnly} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
            {testing
              ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Testing...</>
              : <><Activity size={11} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />Test Connection</>
            }
          </button>
          {!readOnly && (
            <button className="primary" onClick={handleSave} disabled={saving} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
              {saving
                ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Saving...</>
                : saved
                  ? <><CheckCircle size={11} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} /> Saved</>
                  : <><Save size={11} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} /> Save</>
              }
            </button>
          )}
        </div>
      </div>

      {testResult && (
        <div style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', marginBottom: '0.5rem', fontSize: '0.73rem', background: testResult.ok ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', border: `1px solid ${testResult.ok ? 'var(--green)' : 'var(--red)'}` }}>
          {testResult.ok
            ? <span style={{ color: 'var(--green)' }}><CheckCircle size={11} style={{ verticalAlign: 'middle' }} /> Connected — {testResult.user || 'OK'}</span>
            : <span style={{ color: 'var(--red)' }}><AlertCircle size={11} style={{ verticalAlign: 'middle' }} /> {testResult.error}</span>
          }
        </div>
      )}

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Automatically or manually log bugs to Jira when rounds have errors or low quality scores.
      </div>

      {/* Connection Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', marginBottom: '0.75rem' }}>
        <div>
          <label>Jira Base URL</label>
          <input value={cfg.base_url || ''} onChange={e => setCfg(c => ({ ...c, base_url: e.target.value }))} disabled={readOnly} placeholder="https://your-domain.atlassian.net" />
        </div>
        <div>
          <label>Project Key</label>
          <input value={cfg.project_key || ''} onChange={e => setCfg(c => ({ ...c, project_key: e.target.value }))} disabled={readOnly} placeholder="QUAL" />
        </div>
        <div>
          <label>Ticket Label</label>
          <input value={cfg.label || ''} onChange={e => setCfg(c => ({ ...c, label: e.target.value }))} disabled={readOnly} placeholder="boxing-test-kai" />
        </div>
        <div>
          <label>Username (email)</label>
          <input value={cfg.username || ''} onChange={e => setCfg(c => ({ ...c, username: e.target.value }))} disabled={readOnly} placeholder="user@company.com" />
        </div>
        <div>
          <label>API Token {cfg.api_token ? <span style={{ color: 'var(--green)', fontSize: '0.65rem' }}>(set)</span> : null}</label>
          <input type="password" defaultValue="" onChange={e => setCfg(c => ({ ...c, api_token: e.target.value }))} disabled={readOnly} placeholder={cfg.api_token ? 'Leave blank to keep' : 'Jira API token'} />
        </div>
        <div>
          <label>Default Assignee</label>
          <input value={cfg.default_assignee || ''} onChange={e => setCfg(c => ({ ...c, default_assignee: e.target.value }))} disabled={readOnly} placeholder="user@company.com" />
        </div>
      </div>

      {/* Auto-trigger Settings */}
      <div style={{ padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px', marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.4rem' }}>Auto-Trigger</div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.auto_enabled} onChange={e => setCfg(c => ({ ...c, auto_enabled: e.target.checked }))} disabled={readOnly} />
            Enable auto-logging
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
            <span>Quality &lt;</span>
            <input type="number" min={1} max={5} step={0.5} value={cfg.auto_quality_threshold || 3} onChange={e => setCfg(c => ({ ...c, auto_quality_threshold: +e.target.value }))} disabled={readOnly} style={{ width: '3.5rem' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.auto_on_error} onChange={e => setCfg(c => ({ ...c, auto_on_error: e.target.checked }))} disabled={readOnly} />
            On error status
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
            <span>Latency grade &le;</span>
            <select value={cfg.auto_latency_grade || 'D'} onChange={e => setCfg(c => ({ ...c, auto_latency_grade: e.target.value }))} disabled={readOnly} style={{ fontSize: '0.75rem', padding: '0.15em 0.3em' }}>
              <option value="F">F</option>
              <option value="D">D</option>
              <option value="C">C</option>
              <option value="B">B</option>
            </select>
          </div>
        </div>
      </div>

      {/* Assignment Rules */}
      <div style={{ padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
        <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.4rem' }}>Assignment Rules (keyword → assignee)</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
          If Kai's response or user message matches keywords, assign to the specified person. Falls back to default assignee.
        </div>
        {rules.map((rule, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.25rem', fontSize: '0.73rem' }}>
            <span style={{ background: 'white', padding: '0.15em 0.4em', borderRadius: '4px', border: '1px solid var(--border)', flex: 1 }}>
              {(rule.keywords || []).join(', ')}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <span style={{ fontWeight: 500 }}>{rule.assignee}</span>
            {!readOnly && (
              <button onClick={() => removeRule(idx)} style={{ fontSize: '0.6rem', padding: '0.1em 0.3em', color: 'var(--red)' }}>
                <Trash2 size={10} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.35rem' }}>
            <input value={newRule.keywords} onChange={e => setNewRule(r => ({ ...r, keywords: e.target.value }))} placeholder="Keywords (comma separated)" style={{ flex: 2, fontSize: '0.73rem' }} />
            <input value={newRule.assignee} onChange={e => setNewRule(r => ({ ...r, assignee: e.target.value }))} placeholder="Assignee email" style={{ flex: 1, fontSize: '0.73rem' }} />
            <button onClick={addRule} disabled={!newRule.keywords.trim() || !newRule.assignee.trim()} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
              <Plus size={10} style={{ verticalAlign: 'middle' }} /> Add
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function EnvCard({ envKey, env, isActive, onSelect, onEdit, onDelete, readOnly }) {
  const [editing, setEditing] = useState(false)
  const [healthChecking, setHealthChecking] = useState(false)
  const [health, setHealth] = useState(null)
  // Discovery state
  const [discoveredAccounts, setDiscoveredAccounts] = useState([])
  const [discoveredProjects, setDiscoveredProjects] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [accountError, setAccountError] = useState(null)
  const [projectError, setProjectError] = useState(null)
  const [discoveredLicenses, setDiscoveredLicenses] = useState([])
  const [loadingLicenses, setLoadingLicenses] = useState(false)
  const [licenseError, setLicenseError] = useState(null)
  const creds = env.credentials || {}
  const hasCreds = creds.has_credentials
  const hasPassword = creds.has_password

  const runHealthCheck = async () => {
    setHealthChecking(true)
    setHealth(null)
    try {
      const result = await checkEnvHealth(envKey)
      setHealth(result)
    } catch (e) {
      setHealth({ kai: { ok: false, response: e.message }, healthy: false })
    } finally {
      setHealthChecking(false)
    }
  }

  const updateCred = (field, value) => {
    onEdit(envKey, {
      ...env,
      credentials: { ...creds, [field]: value },
    })
  }

  return (
    <div
      style={{
        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        background: isActive ? 'rgba(0,137,123,0.05)' : 'transparent',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isActive && <CheckCircle size={14} style={{ color: 'var(--accent)' }} />}
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{env.name || envKey}</span>
          {isActive && <span className="badge completed" style={{ fontSize: '0.6rem' }}>active</span>}
          {hasCreds
            ? <span style={{ fontSize: '0.62rem', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}><Key size={9} /> creds set</span>
            : <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>no creds (uses .env)</span>
          }
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            onClick={runHealthCheck}
            disabled={healthChecking}
            style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}
            title="Test Kai connectivity"
          >
            {healthChecking
              ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Testing...</>
              : <><Activity size={11} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />Health Check</>
            }
          </button>
          {!readOnly && !isActive && (
            <button className="primary" onClick={() => onSelect(envKey)} style={{ fontSize: '0.68rem', padding: '0.2em 0.6em' }}>
              Switch
            </button>
          )}
          {!readOnly && (
            <button onClick={() => setEditing(!editing)} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
              {editing ? 'Close' : 'Edit'}
            </button>
          )}
          {!readOnly && !isActive && (
            <button className="danger" onClick={() => onDelete(envKey)} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <span>
            <strong>URL:</strong>{' '}
            <a href={env.base_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
              {env.base_url} <ExternalLink size={9} style={{ verticalAlign: 'middle' }} />
            </a>
          </span>
          <span><strong>Project:</strong> {env.project_name} ({env.project_id})</span>
        </div>
      </div>

      <HealthResult health={health} />

      {editing && !readOnly && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.78rem' }}>
          {/* URLs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            <div>
              <label>Name</label>
              <input value={env.name || ''} onChange={e => onEdit(envKey, { ...env, name: e.target.value })} />
            </div>
            <div>
              <label>Environment URL (for discovery)</label>
              <input value={env.platform_url || ''} onChange={e => onEdit(envKey, { ...env, platform_url: e.target.value })} placeholder="https://platform.staging.katalon.com" />
            </div>
          </div>

          {/* Step 1: Credentials */}
          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Key size={12} /> Step 1: Credentials
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <div>
                <label>Email</label>
                <input value={creds.email || ''} onChange={e => updateCred('email', e.target.value)} placeholder="user@katalon.com" />
              </div>
              <div>
                <label>Password / API Key {hasPassword && <span style={{ color: 'var(--green)', fontSize: '0.65rem' }}>(set)</span>}</label>
                <input type="password" defaultValue="" onChange={e => updateCred('password', e.target.value)} placeholder={hasPassword ? 'Leave blank to keep current' : 'Enter password'} />
              </div>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Leave blank to fall back to server .env credentials.
            </div>
          </div>

          {/* Step 2: Account Discovery */}
          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Building2 size={12} /> Step 2: Choose Account
              </div>
              <button
                onClick={async () => {
                  setLoadingAccounts(true)
                  setAccountError(null)
                  setDiscoveredAccounts([])
                  try {
                    const result = await discoverAccounts({
                      platform_url: env.platform_url,
                      email: creds.email,
                      password: creds.password,
                      ...(creds.has_password && !creds.password ? { env_key: envKey } : {}),
                    })
                    setDiscoveredAccounts(result.accounts || [])
                    if (!result.accounts?.length) {
                      setAccountError('Single account detected — enter Account ID manually or use the project discovery below')
                    }
                  } catch (e) {
                    setAccountError(e.message)
                  } finally {
                    setLoadingAccounts(false)
                  }
                }}
                disabled={loadingAccounts || (!creds.email || (!creds.password && !creds.has_password)) || !env.platform_url}
                style={{ fontSize: '0.68rem', padding: '0.2em 0.6em' }}
                title={!env.platform_url ? 'Enter Platform URL first' : (!creds.email ? 'Enter email first' : '')}
              >
                {loadingAccounts
                  ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Fetching...</>
                  : <><RefreshCw size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} /> Fetch Accounts</>
                }
              </button>
            </div>

            {accountError && (
              <div style={{ fontSize: '0.7rem', color: 'var(--red)', marginBottom: '0.4rem', padding: '0.3rem 0.5rem', background: 'rgba(220,38,38,0.06)', borderRadius: '4px' }}>
                {accountError}
              </div>
            )}

            {discoveredAccounts.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {discoveredAccounts.map(acct => (
                  <div
                    key={acct.id}
                    onClick={() => {
                      onEdit(envKey, (currentEnv) => {
                        const currentCreds = currentEnv.credentials || {}
                        const updates = {
                          ...currentEnv,
                          account_name: acct.name,
                          credentials: { ...currentCreds, account: acct.id },
                        }
                        if (acct.url) {
                          updates.base_url = acct.url.split('/organization/')[0]
                        }
                        return updates
                      })
                      setDiscoveredProjects([])
                      setProjectError(null)
                    }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.35rem 0.6rem', borderRadius: '4px', cursor: 'pointer',
                      border: `1px solid ${creds.account === acct.id || creds.account === acct.id + '_true' ? 'var(--accent)' : 'var(--border)'}`,
                      background: creds.account === acct.id || creds.account === acct.id + '_true' ? 'rgba(99,102,241,0.06)' : 'white',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem' }}>
                        <strong>{acct.name}</strong>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>#{acct.id}</span>
                      </div>
                      {acct.url && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{acct.url}</div>
                      )}
                    </div>
                    {(creds.account === acct.id || creds.account === acct.id + '_true') && (
                      <CheckCircle size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                <div>
                  <label>Account ID</label>
                  <input value={creds.account || ''} onChange={e => updateCred('account', e.target.value)} placeholder="e.g. 1996096" />
                </div>
                <div>
                  <label>Account Name</label>
                  <input value={env.account_name || ''} onChange={e => onEdit(envKey, { ...env, account_name: e.target.value })} placeholder="e.g. Katalon on Katalon" />
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Project Discovery */}
          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <FolderOpen size={12} /> Step 3: Choose Project
              </div>
              <button
                onClick={async () => {
                  setLoadingProjects(true)
                  setProjectError(null)
                  setDiscoveredProjects([])
                  try {
                    const result = await discoverProjects({
                      platform_url: env.base_url || env.platform_url,
                      login_url: env.login_url || 'https://to3-devtools.vercel.app/api/login',
                      email: creds.email,
                      password: creds.password,
                      account: creds.account,
                      ...(creds.has_password && !creds.password ? { env_key: envKey } : {}),
                    })
                    setDiscoveredProjects(result.projects || [])
                    if (!result.projects?.length) {
                      setProjectError('No projects found for this account')
                    }
                  } catch (e) {
                    setProjectError(e.message)
                  } finally {
                    setLoadingProjects(false)
                  }
                }}
                disabled={loadingProjects || !creds.account}
                style={{ fontSize: '0.68rem', padding: '0.2em 0.6em' }}
                title={!creds.account ? 'Select an account first' : 'Fetch projects for this account'}
              >
                {loadingProjects
                  ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Fetching...</>
                  : <><RefreshCw size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} /> Fetch Projects</>
                }
              </button>
            </div>

            {projectError && (
              <div style={{ fontSize: '0.7rem', color: 'var(--red)', marginBottom: '0.4rem', padding: '0.3rem 0.5rem', background: 'rgba(220,38,38,0.06)', borderRadius: '4px' }}>
                {projectError}
              </div>
            )}

            {discoveredProjects.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '200px', overflowY: 'auto', marginBottom: '0.5rem' }}>
                {discoveredProjects.map(proj => (
                  <div
                    key={proj.id}
                    onClick={() => {
                      onEdit(envKey, (currentEnv) => ({
                        ...currentEnv,
                        project_id: String(proj.id),
                        project_name: proj.name,
                        org_id: proj.org_id ? String(proj.org_id) : currentEnv.org_id,
                        account_id: proj.account_uuid || currentEnv.account_id,
                        account_name: proj.org_name || currentEnv.account_name,
                      }))
                    }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.35rem 0.6rem', borderRadius: '4px', cursor: 'pointer',
                      border: `1px solid ${env.project_id === String(proj.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: env.project_id === String(proj.id) ? 'rgba(99,102,241,0.06)' : 'white',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{proj.name}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        ID: {proj.id} | Org: {proj.org_name || 'N/A'} ({proj.org_id || '-'})
                      </div>
                    </div>
                    {env.project_id === String(proj.id) && (
                      <CheckCircle size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Always show config fields — populated by project selection or editable manually */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <div>
                <label>Project ID</label>
                <input value={env.project_id || ''} onChange={e => onEdit(envKey, { ...env, project_id: e.target.value })} />
              </div>
              <div>
                <label>Project Name</label>
                <input value={env.project_name || ''} onChange={e => onEdit(envKey, { ...env, project_name: e.target.value })} />
              </div>
              <div>
                <label>Org ID</label>
                <input value={env.org_id || ''} onChange={e => onEdit(envKey, { ...env, org_id: e.target.value })} />
              </div>
              <div>
                <label>Account UUID</label>
                <input value={env.account_id || ''} onChange={e => onEdit(envKey, { ...env, account_id: e.target.value })} />
              </div>
              <div>
                <label>Base URL (Kai agent)</label>
                <input value={env.base_url || ''} onChange={e => onEdit(envKey, { ...env, base_url: e.target.value })} placeholder="Auto-set from account domain" />
              </div>
              <div>
                <label>Account Name</label>
                <input value={env.account_name || ''} onChange={e => onEdit(envKey, { ...env, account_name: e.target.value })} />
              </div>
            </div>
          </div>

          {/* MCP Endpoints */}
          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Globe size={12} /> MCP Endpoints
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <div>
                <label>Public MCP URL</label>
                <input value={env.mcp_public_url || ''} onChange={e => onEdit(envKey, { ...env, mcp_public_url: e.target.value })} placeholder="https://mcp.katalon.com/mcp" />
              </div>
              <div>
                <label>Protected MCP URL</label>
                <input value={env.mcp_protected_url || ''} onChange={e => onEdit(envKey, { ...env, mcp_protected_url: e.target.value })} placeholder="https://platform.katalon.io/mcp" />
              </div>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Auth uses same credentials above. Data Sources will auto-discover tools from these URLs.
            </div>
          </div>

          {/* License Source Discovery — for Scout Fighters */}
          <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
                License Source (for Scout Fighters)
              </label>
              <button
                onClick={async () => {
                  setLoadingLicenses(true)
                  setLicenseError(null)
                  setDiscoveredLicenses([])
                  try {
                    const result = await discoverLicenseSources({ env_key: envKey })
                    setDiscoveredLicenses(result.sources || [])
                    if (!result.sources?.length) {
                      setLicenseError('No license sources found for this account')
                    }
                  } catch (e) {
                    setLicenseError(e.message)
                  } finally {
                    setLoadingLicenses(false)
                  }
                }}
                disabled={loadingLicenses || !creds.account}
                style={{
                  padding: '0.2rem 0.5rem', fontSize: '0.65rem', borderRadius: '4px',
                  border: '1px solid var(--border)', background: 'white', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  opacity: (!creds.account) ? 0.5 : 1,
                }}
              >
                <Key size={10} />
                {loadingLicenses ? 'Discovering...' : 'Discover Licenses'}
              </button>
            </div>

            {licenseError && (
              <div style={{ fontSize: '0.68rem', color: 'var(--red)', marginBottom: '0.3rem' }}>
                {licenseError}
              </div>
            )}

            {discoveredLicenses.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '260px', overflowY: 'auto', marginBottom: '0.4rem' }}>
                {discoveredLicenses.map(lic => {
                  const isSelected = env.license_source_id === String(lic.id)
                  const availPct = lic.purchased > 0 ? Math.round((lic.available / lic.purchased) * 100) : 0
                  const availColor = lic.available <= 0 ? 'var(--red)' : lic.available < 5 ? 'var(--yellow)' : 'var(--green)'
                  return (
                    <div
                      key={lic.id}
                      onClick={() => {
                        onEdit(envKey, (currentEnv) => ({
                          ...currentEnv,
                          license_source_id: String(lic.id),
                          license_feature: lic.feature || currentEnv.license_feature,
                        }))
                      }}
                      style={{
                        padding: '0.4rem 0.6rem', borderRadius: '4px', cursor: 'pointer',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(99,102,241,0.06)' : 'white',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                          {lic.feature || `Source #${lic.id}`}
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem' }}>#{lic.id}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: availColor }}>
                            {lic.available}/{lic.purchased}
                          </span>
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>avail</span>
                          {isSelected && <CheckCircle size={12} style={{ color: 'var(--accent)' }} />}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        Purchased: {lic.purchased} | Dedicated to orgs: {lic.dedicated} ({lic.org_count} orgs) | Pool: {lic.pool} | Assigned: {lic.assigned}
                        {lic.expiry_date && ` | Expires: ${lic.expiry_date}`}
                      </div>
                      {/* Usage bar */}
                      <div style={{ marginTop: '0.25rem', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: '2px',
                          width: `${lic.purchased > 0 ? Math.min(100, Math.round(((lic.assigned + lic.dedicated) / lic.purchased) * 100)) : 0}%`,
                          background: `linear-gradient(90deg, var(--accent) ${lic.purchased > 0 ? Math.round((lic.dedicated / lic.purchased) * 100) : 0}%, ${availColor} 0%)`,
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <div>
                <label>License Source ID</label>
                <input value={env.license_source_id || ''} onChange={e => onEdit(envKey, { ...env, license_source_id: e.target.value })} placeholder="e.g. 49" />
              </div>
              <div>
                <label>License Feature</label>
                <input value={env.license_feature || ''} onChange={e => onEdit(envKey, { ...env, license_feature: e.target.value })} placeholder="e.g. TESTOPS_G3_FULL" />
              </div>
            </div>
          </div>

          {/* Summary of selected config */}
          {(env.project_id || env.org_id || env.account_id || env.base_url) && (
            <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: 'rgba(99,102,241,0.04)', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <strong>Selected:</strong>{' '}
              {env.account_name && <span>Account: {env.account_name} | </span>}
              {env.base_url && <span>Domain: {env.base_url} | </span>}
              {env.project_name && <span>Project: {env.project_name} ({env.project_id}) | </span>}
              {env.org_id && <span>Org: {env.org_id} | </span>}
              {env.license_source_id && <span>License: #{env.license_source_id} ({env.license_feature || 'N/A'}) | </span>}
              {(env.mcp_public_url || env.mcp_protected_url) && <span>MCP: {[env.mcp_public_url && 'Public', env.mcp_protected_url && 'Protected'].filter(Boolean).join(' + ')}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Scenario Editor Form (Create / Edit) ──
function ScenarioEditorForm({ initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [category, setCategory] = useState(initial?.category || 'general')
  const [tags, setTags] = useState((initial?.tags || []).join(', '))
  const [steps, setSteps] = useState(initial?.steps?.length > 0 ? initial.steps : [{ name: 'Step 1', message: '' }])

  const addStep = () => setSteps(s => [...s, { name: `Step ${s.length + 1}`, message: '' }])
  const removeStep = (idx) => setSteps(s => s.filter((_, i) => i !== idx))
  const updateStep = (idx, field, value) => setSteps(s => s.map((st, i) => i === idx ? { ...st, [field]: value } : st))

  const valid = name.trim() && description.trim() && steps.length > 0 && steps.every(s => s.message.trim())

  return (
    <div style={{ padding: '0.75rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.5rem' }}>
        <div>
          <label style={{ fontSize: '0.72rem' }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Scenario name" style={{ fontSize: '0.78rem' }} />
        </div>
        <div>
          <label style={{ fontSize: '0.72rem' }}>Category</label>
          <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. general, auth, testing" style={{ fontSize: '0.78rem' }} />
        </div>
      </div>
      <div style={{ marginBottom: '0.5rem' }}>
        <label style={{ fontSize: '0.72rem' }}>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this scenario test?" style={{ fontSize: '0.78rem' }} />
      </div>
      <div style={{ marginBottom: '0.5rem' }}>
        <label style={{ fontSize: '0.72rem' }}>Tags (comma separated)</label>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. smoke, login, api" style={{ fontSize: '0.78rem' }} />
      </div>
      <div style={{ marginBottom: '0.5rem' }}>
        <label style={{ fontSize: '0.72rem', fontWeight: 600 }}>Exchanges</label>
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
          Use [bracket notes] for internal instructions — they'll be stripped before sending to Kai.
        </div>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', minWidth: 18 }}>{i + 1}.</span>
            <input value={step.message} onChange={e => updateStep(i, 'message', e.target.value)}
              placeholder={`Exchange ${i + 1} message...`} style={{ flex: 1, fontSize: '0.75rem' }} />
            {steps.length > 1 && (
              <button onClick={() => removeStep(i)} style={{ fontSize: '0.6rem', padding: '0.1em 0.25em', color: 'var(--red)' }}>
                <Trash2 size={10} />
              </button>
            )}
          </div>
        ))}
        <button onClick={addStep} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em', marginTop: '0.2rem' }}>
          <Plus size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} /> Add Exchange
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ fontSize: '0.72rem', padding: '0.3em 0.7em' }}>Cancel</button>
        <button className="primary" disabled={!valid || saving} onClick={() => onSave({
          name: name.trim(), description: description.trim(), category: category.trim() || 'general',
          steps, tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        })} style={{ fontSize: '0.72rem', padding: '0.3em 0.7em' }}>
          {saving ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Saving...</> : <><Save size={11} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} /> Save</>}
        </button>
      </div>
    </div>
  )
}

// ── Reusable scenario row with expand ──
function ScenarioRow({ sc, expandedId, setExpandedId, borderColor, extra }) {
  const isExp = expandedId === sc.id
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden',
      borderLeft: borderColor ? `3px solid ${borderColor}` : undefined,
    }}>
      <div onClick={() => setExpandedId(isExp ? null : sc.id)} style={{
        padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', background: 'var(--bg-primary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
          {isExp ? <ChevronDown size={13} style={{ flexShrink: 0 }} /> : <ChevronRight size={13} style={{ flexShrink: 0 }} />}
          <span style={{ fontWeight: 600, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.name}</span>
          <span style={{ fontSize: '0.62rem', padding: '0.1em 0.35em', background: 'var(--bg-hover)', borderRadius: 3, color: 'var(--text-muted)', flexShrink: 0 }}>{sc.category}</span>
          {sc.source === 'custom' && (
            <span style={{ fontSize: '0.58rem', padding: '0.1em 0.3em', background: 'var(--accent)', color: '#fff', borderRadius: 3, flexShrink: 0 }}>community</span>
          )}
        </div>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '0.5rem' }}>
          {sc.steps?.length || 0} exchanges
        </span>
      </div>
      {isExp && (
        <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>{sc.description}</div>
          {sc.tags?.length > 0 && (
            <div style={{ display: 'flex', gap: '0.2rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              {sc.tags.map(t => (
                <span key={t} style={{ fontSize: '0.6rem', padding: '0.1em 0.35em', background: 'var(--bg-hover)', borderRadius: 3, color: 'var(--text-muted)' }}>{t}</span>
              ))}
            </div>
          )}
          <div style={{ marginBottom: '0.4rem' }}>
            {(sc.steps || []).map((step, i) => (
              <div key={i} style={{ color: 'var(--text-secondary)', padding: '0.2rem 0', display: 'flex', gap: '0.3rem', alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 16, fontSize: '0.68rem' }}>{i + 1}.</span>
                <span style={{ fontSize: '0.73rem' }}>
                  {step.message?.split(/(\[.*?\])/).map((part, j) =>
                    part.startsWith('[') && part.endsWith(']')
                      ? <span key={j} style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.66rem' }}>{part}</span>
                      : <span key={j}>{part}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {extra}
        </div>
      )}
    </div>
  )
}

// ── Fixed Scenarios Tab ──
function FixedScenariosTab({ isAdmin }) {
  const [allScenarios, setAllScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const data = await getScenarios()
      setAllScenarios(data.scenarios || [])
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const builtinScenarios = allScenarios.filter(s => s.source !== 'custom')
  const customScenarios = allScenarios.filter(s => s.source === 'custom')
  const categories = [...new Set(builtinScenarios.map(s => s.category))].sort()
  const filteredBuiltin = catFilter === 'all' ? builtinScenarios : builtinScenarios.filter(s => s.category === catFilter)

  // Clone a builtin scenario as a new custom scenario
  const [cloningId, setCloningId] = useState(null)

  const handleCreate = async (data) => {
    setSaving(true)
    try { await createCustomScenario(data); setShowCreate(false); setCloningId(null); load() } catch (e) { alert(e.message) } finally { setSaving(false) }
  }
  const handleUpdate = async (id, data) => {
    setSaving(true)
    try { await updateCustomScenario(id, data); setEditingId(null); load() } catch (e) { alert(e.message) } finally { setSaving(false) }
  }
  const handleDelete = async (sc) => {
    const label = sc.source === 'custom' ? 'Remove this custom scenario?' : 'Hide this builtin scenario? (can be restored later)'
    if (!confirm(label)) return
    try {
      if (sc.source === 'custom') {
        await deleteCustomScenario(sc.id)
      } else {
        await hideScenario(sc.id)
      }
      load()
    } catch (e) { alert(e.message) }
  }
  const handleClone = (sc) => {
    setCloningId(sc.id)
    setExpandedId(null)
    setEditingId(null)
    setShowCreate(false)
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /> Loading scenarios...</div>

  const displayScenarios = catFilter === 'custom' ? customScenarios : catFilter === 'all'
    ? [...builtinScenarios, ...customScenarios]
    : filteredBuiltin

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          <button className={catFilter === 'all' ? 'primary' : ''} onClick={() => setCatFilter('all')}
            style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
            All ({builtinScenarios.length + customScenarios.length})
          </button>
          {categories.map(cat => {
            const count = builtinScenarios.filter(s => s.category === cat).length
            return (
              <button key={cat} className={catFilter === cat ? 'primary' : ''} onClick={() => setCatFilter(cat)}
                style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
                {cat} ({count})
              </button>
            )
          })}
          {customScenarios.length > 0 && (
            <button className={catFilter === 'custom' ? 'primary' : ''} onClick={() => setCatFilter('custom')}
              style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
              community ({customScenarios.length})
            </button>
          )}
        </div>
        {isAdmin && (
          <button className="primary" onClick={() => { setShowCreate(!showCreate); setEditingId(null) }}
            style={{ fontSize: '0.72rem', padding: '0.3em 0.7em', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Plus size={12} /> New Scenario
          </button>
        )}
      </div>

      {showCreate && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ScenarioEditorForm onSave={handleCreate} onCancel={() => setShowCreate(false)} saving={saving} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {displayScenarios.map(sc => (
          editingId === sc.id ? (
            <ScenarioEditorForm key={sc.id} initial={sc} saving={saving}
              onSave={(data) => handleUpdate(sc.id, data)} onCancel={() => setEditingId(null)} />
          ) : cloningId === sc.id ? (
            <ScenarioEditorForm key={`clone-${sc.id}`} saving={saving}
              initial={{ ...sc, name: sc.source !== 'custom' ? sc.name : `${sc.name} (copy)` }}
              onSave={handleCreate} onCancel={() => setCloningId(null)} />
          ) : (
            <ScenarioRow key={sc.id} sc={sc} expandedId={expandedId} setExpandedId={setExpandedId}
              borderColor={sc.source === 'custom' ? 'var(--accent)' : undefined}
              extra={isAdmin && (
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button onClick={() => {
                    if (sc.source === 'custom') {
                      setEditingId(sc.id); setExpandedId(null); setShowCreate(false); setCloningId(null)
                    } else {
                      // Builtin: edit saves as new custom
                      setCloningId(sc.id); setExpandedId(null); setEditingId(null); setShowCreate(false)
                    }
                  }}
                    style={{ fontSize: '0.68rem', padding: '0.2em 0.5em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Edit3 size={11} /> Edit
                  </button>
                  <button onClick={() => handleClone(sc)}
                    style={{ fontSize: '0.68rem', padding: '0.2em 0.5em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Copy size={11} /> Clone
                  </button>
                  <button onClick={() => handleDelete(sc)} className="danger"
                    style={{ fontSize: '0.68rem', padding: '0.2em 0.5em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Trash2 size={11} /> {sc.source === 'custom' ? 'Remove' : 'Hide'}
                  </button>
                </div>
              )}
            />
          )
        ))}
      </div>

      {displayScenarios.length === 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
          No scenarios in "{catFilter}"
        </div>
      )}
    </>
  )
}

// ── Submission Pool Tab ──
function SubmissionPoolTab({ isAdmin }) {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [expandedId, setExpandedId] = useState(null)
  const [rejectId, setRejectId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = async () => {
    try {
      const data = await getSubmissions()
      setSubmissions(data.submissions || [])
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleApprove = async (id) => {
    try { await approveSubmission(id); load() } catch (e) { alert(e.message) }
  }
  const handleReject = async (id) => {
    try { await rejectSubmission(id, rejectReason); setRejectId(null); setRejectReason(''); load() } catch (e) { alert(e.message) }
  }

  const pendingCount = submissions.filter(s => s.status === 'pending').length
  const filteredSubs = filter === 'all' ? submissions : submissions.filter(s => s.status === filter)

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}><span className="spinner" /> Loading submissions...</div>

  return (
    <>
      <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.75rem' }}>
        {['pending', 'approved', 'rejected', 'all'].map(f => (
          <button key={f} className={filter === f ? 'primary' : ''} onClick={() => setFilter(f)}
            style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
          </button>
        ))}
      </div>

      {filteredSubs.length === 0 ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
          No {filter === 'all' ? '' : filter} submissions
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {filteredSubs.map(sub => (
            <ScenarioRow key={`sub-${sub.id}`}
              sc={{ ...sub, id: `sub-${sub.id}`, steps: sub.steps || [] }}
              expandedId={expandedId} setExpandedId={setExpandedId}
              borderColor={sub.status === 'pending' ? 'var(--orange)' : sub.status === 'approved' ? 'var(--green)' : 'var(--red)'}
              extra={
                <div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                    <span className={`badge ${sub.status === 'pending' ? 'pending' : sub.status === 'approved' ? 'completed' : 'error'}`}
                      style={{ fontSize: '0.58rem', marginRight: '0.3rem' }}>{sub.status}</span>
                    Submitted by: {sub.submitted_by || 'anonymous'}
                    {sub.reviewed_by && ` · Reviewed by: ${sub.reviewed_by}`}
                    {sub.reject_reason && <span style={{ color: 'var(--red)' }}> · Reason: {sub.reject_reason}</span>}
                    <span style={{ marginLeft: '0.3rem' }}>· {new Date(sub.created_at + 'Z').toLocaleDateString()}</span>
                  </div>
                  {isAdmin && sub.status === 'pending' && (
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button onClick={() => handleApprove(sub.id)} className="primary"
                        style={{ fontSize: '0.7rem', padding: '0.25em 0.6em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <CheckCircle size={11} /> Approve
                      </button>
                      {rejectId === sub.id ? (
                        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                          <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                            placeholder="Reason (optional)" style={{ fontSize: '0.7rem', width: 160 }} />
                          <button onClick={() => handleReject(sub.id)} className="danger"
                            style={{ fontSize: '0.7rem', padding: '0.25em 0.5em' }}>Reject</button>
                          <button onClick={() => { setRejectId(null); setRejectReason('') }}
                            style={{ fontSize: '0.7rem', padding: '0.25em 0.5em' }}>Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setRejectId(sub.id)}
                          style={{ fontSize: '0.7rem', padding: '0.25em 0.6em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <XCircle size={11} /> Decline
                        </button>
                      )}
                    </div>
                  )}
                </div>
              }
            />
          ))}
        </div>
      )}
    </>
  )
}


export default function EnvironmentSettings() {
  const { admin, setAdmin } = useAdmin()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') || 'sandbox'
  const [pageTab, setPageTab] = useState(initialTab) // sandbox | scenarios | pool
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newEnvKey, setNewEnvKey] = useState('')
  const [maxSessions, setMaxSessions] = useState(10)
  const [maxMatches, setMaxMatches] = useState(3)
  const [maxRoundsPerMatch, setMaxRoundsPerMatch] = useState(3)
  const [savingConcurrency, setSavingConcurrency] = useState(false)
  const [concurrencySaved, setConcurrencySaved] = useState(false)

  useEffect(() => {
    getEnvConfig().then(d => { setConfig(d); setLoading(false) }).catch(() => setLoading(false))
    getConfig().then(d => {
      setMaxSessions(d.max_concurrent || 10)
      setMaxMatches(d.max_concurrent_matches || 3)
      setMaxRoundsPerMatch(d.max_rounds_per_match || 3)
    }).catch(() => {})
  }, [])

  const isAdmin = !!admin

  const handleSwitch = async (envKey) => {
    setSaving(true)
    try {
      const updated = await updateEnvConfig({ active: envKey })
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Failed to switch: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEditEnv = (envKey, envOrUpdater) => {
    setConfig(c => {
      const currentEnv = c.environments[envKey] || {}
      const newEnv = typeof envOrUpdater === 'function' ? envOrUpdater(currentEnv) : envOrUpdater
      return { ...c, environments: { ...c.environments, [envKey]: newEnv } }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const updated = await updateEnvConfig(config)
      setConfig(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      if (e.message.includes('login required') || e.message.includes('expired')) setAdmin(null)
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!confirm('Reset all environment configs to defaults?')) return
    try {
      const defaults = await resetEnvConfig()
      setConfig(defaults)
    } catch (e) {
      alert('Failed to reset: ' + e.message)
    }
  }

  const handleAddEnv = () => {
    const key = newEnvKey.trim().toLowerCase().replace(/\s+/g, '-')
    if (!key || config.environments[key]) return
    setConfig(c => ({
      ...c,
      environments: {
        ...c.environments,
        [key]: {
          name: newEnvKey.trim(),
          base_url: '',
          login_url: 'https://to3-devtools.vercel.app/api/login',
          platform_url: '',
          project_id: '',
          project_name: '',
          org_id: '',
          account_id: '',
          account_name: '',
        },
      },
    }))
    setNewEnvKey('')
  }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading settings...</div>
  if (!config) return <div className="empty">Failed to load settings</div>

  const PAGE_TABS = [
    { key: 'sandbox', label: 'Sandbox Settings', icon: Settings },
    { key: 'scenarios', label: 'Fixed Scenarios', icon: FileCheck },
    { key: 'pool', label: 'Submission Pool', icon: Send },
    ...(isAdmin ? [{ key: 'datasources', label: 'Data Sources', icon: Database }] : []),
  ]

  return (
    <div>
      <div className="page-header">
        <h2><Settings size={20} /> Arena Settings</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {pageTab === 'sandbox' && isAdmin ? (
            <>
              <button onClick={handleReset} title="Reset to defaults">
                <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                Reset
              </button>
              <button className="primary" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving...</>
                  : saved
                    ? <><CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} /> Saved</>
                    : <><Save size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} /> Save Changes</>
                }
              </button>
            </>
          ) : pageTab === 'sandbox' && !isAdmin ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Lock size={12} /> Sign in to edit
            </span>
          ) : null}
        </div>
      </div>

      {/* Page-level tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '2px solid var(--border)' }}>
        {PAGE_TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setPageTab(t.key)} style={{
              fontSize: '0.8rem', padding: '0.6em 1.2em', border: 'none', cursor: 'pointer',
              background: pageTab === t.key ? 'var(--bg-card)' : 'transparent',
              color: pageTab === t.key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: pageTab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2, fontWeight: pageTab === t.key ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: '0.35rem',
            }}>
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Sandbox Settings Tab ── */}
      {pageTab === 'sandbox' && (<>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Configure which Kai environment to test against. Switch between production, staging, or custom environments.
        Credentials are shared from the server's .env file — only the target URL and project change.
      </div>

      <JoeBotCard />

      {/* Concurrency Settings */}
      <div className="card">
        <h3><Activity size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Concurrency</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Control how many rounds and matches can run simultaneously. Lower values are safer for single-account testing.
        </p>
        <div className="form-row">
          <div>
            <label>Max Concurrent Rounds (Global)</label>
            <input
              type="number" min={1} max={50}
              value={maxSessions}
              onChange={e => setMaxSessions(+e.target.value)}
              disabled={!isAdmin}
            />
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Total rounds running across all matches
            </div>
          </div>
          <div>
            <label>Max Concurrent Matches</label>
            <input
              type="number" min={1} max={10}
              value={maxMatches}
              onChange={e => setMaxMatches(+e.target.value)}
              disabled={!isAdmin}
            />
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              How many matches can run at the same time
            </div>
          </div>
          <div>
            <label>Max Rounds per Match</label>
            <input
              type="number" min={1} max={20}
              value={maxRoundsPerMatch}
              onChange={e => setMaxRoundsPerMatch(+e.target.value)}
              disabled={!isAdmin}
            />
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Parallel rounds within a single match (set 1 for sequential)
            </div>
          </div>
        </div>
        {isAdmin && (
          <div style={{ marginTop: '0.75rem' }}>
            <button
              className="primary"
              disabled={savingConcurrency}
              onClick={async () => {
                setSavingConcurrency(true)
                setConcurrencySaved(false)
                try {
                  await updateConfig({ max_concurrent: maxSessions, max_concurrent_matches: maxMatches, max_rounds_per_match: maxRoundsPerMatch })
                  setConcurrencySaved(true)
                  setTimeout(() => setConcurrencySaved(false), 2000)
                } catch (e) {
                  if (e.message.includes('login required') || e.message.includes('expired')) setAdmin(null)
                  alert('Failed: ' + e.message)
                } finally {
                  setSavingConcurrency(false)
                }
              }}
            >
              {savingConcurrency
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving...</>
                : concurrencySaved
                  ? <><CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} /> Applied</>
                  : <><Save size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} /> Apply</>
              }
            </button>
          </div>
        )}
      </div>

      <JiraConfigCard readOnly={!isAdmin} />

      <div className="card">
        <h3><Globe size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Test Environments</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {Object.entries(config.environments || {}).map(([key, env]) => (
            <EnvCard
              key={key}
              envKey={key}
              env={env}
              isActive={key === config.active}
              onSelect={handleSwitch}
              onEdit={handleEditEnv}
              onDelete={async (k) => {
                if (!confirm(`Delete environment "${env.name || k}"?`)) return
                try {
                  const updated = await deleteEnvProfile(k)
                  setConfig(updated)
                } catch (e) { alert(e.message) }
              }}
              readOnly={!isAdmin}
            />
          ))}
        </div>

        {isAdmin && (
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              value={newEnvKey}
              onChange={e => setNewEnvKey(e.target.value)}
              placeholder="New environment name..."
              style={{ fontSize: '0.78rem', flex: 1 }}
              onKeyDown={e => e.key === 'Enter' && handleAddEnv()}
            />
            <button onClick={handleAddEnv} disabled={!newEnvKey.trim()} style={{ fontSize: '0.72rem' }}>
              <Plus size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
              Add
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        <h3><Key size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />How Credentials Work</h3>
        <p style={{ marginBottom: '0.35rem' }}>
          Each environment can have its own TestOps credentials (email, password/API key, account).
          Credentials are stored in the database — no .env changes needed.
        </p>
        <p style={{ marginBottom: '0.35rem' }}>
          If an environment has no credentials configured, it falls back to the server's <code>.env</code> file.
        </p>
        <p>
          <strong>Note:</strong> Switching environments takes effect for new rounds only.
          Running rounds continue on the environment they started with.
        </p>
      </div>
      </>)}

      {/* ── Fixed Scenarios Tab ── */}
      {pageTab === 'scenarios' && (
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FileCheck size={15} /> Fixed Scenarios
          </h3>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Browse all available fixed scenarios (builtin + community). Admins can create, edit, and remove custom scenarios.
          </div>
          <FixedScenariosTab isAdmin={isAdmin} />
        </div>
      )}

      {/* ── Submission Pool Tab ── */}
      {pageTab === 'pool' && (
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Send size={15} /> Submission Pool
          </h3>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Review community-submitted scenarios. Approved scenarios become available in Fixed mode.
          </div>
          <SubmissionPoolTab isAdmin={isAdmin} />
        </div>
      )}

      {/* ── Data Sources Tab ── */}
      {pageTab === 'datasources' && (
        <DataSourcesTab isAdmin={isAdmin} envKey={config?.active || 'production'} />
      )}
    </div>
  )
}

// ── Data Sources Tab ────────────────────────────────────────────

const SOURCE_TYPES = [
  { value: 'jira', label: 'Jira', desc: 'Import issues from Jira project/epic', shared: true },
  { value: 'confluence', label: 'Confluence', desc: 'Import pages from Confluence space', shared: true },
  { value: 'mcp_tools', label: 'MCP Tools', desc: 'Auto-discover tools from MCP server URL (per-environment)', shared: false },
  { value: 'context', label: 'Free Text', desc: 'Add free-text requirements context (per-environment)', shared: false },
]

const SYNC_BADGES = {
  never: { color: 'var(--text-muted)', bg: 'var(--bg-primary)', label: 'Never synced' },
  syncing: { color: 'var(--blue)', bg: '#eff6ff', label: 'Syncing...' },
  synced: { color: 'var(--green)', bg: '#f0fdf4', label: 'Synced' },
  error: { color: 'var(--red)', bg: '#fef2f2', label: 'Error' },
}

function DataSourcesTab({ isAdmin, envKey }) {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editSource, setEditSource] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [items, setItems] = useState({})
  const [syncing, setSyncing] = useState({})
  const [syncingAll, setSyncingAll] = useState(false)

  const load = async () => {
    try {
      const data = await listDataSources(envKey)
      setSources(data.sources || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [envKey])

  const handleSync = async (id) => {
    setSyncing(p => ({ ...p, [id]: true }))
    try {
      await syncDataSource(id)
      await load()
    } catch { /* ignore */ }
    setSyncing(p => ({ ...p, [id]: false }))
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    try {
      await syncAllDataSources(envKey)
      await load()
    } catch { /* ignore */ }
    setSyncingAll(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this data source and all its items?')) return
    try {
      await deleteDataSource(id)
      await load()
    } catch { /* ignore */ }
  }

  const handleToggleEnabled = async (id, currentlyEnabled) => {
    try {
      await updateDataSource(id, { enabled: !currentlyEnabled })
      await load()
    } catch { /* ignore */ }
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!items[id]) {
      try {
        const data = await getDataSourceItems(id)
        setItems(p => ({ ...p, [id]: data.items || [] }))
      } catch { /* ignore */ }
    }
  }

  if (loading) return <div className="empty"><span className="spinner" /> Loading data sources...</div>

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
            <Database size={15} /> Data Sources
          </h3>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {sources.length > 0 && (
              <button onClick={handleSyncAll} disabled={syncingAll} style={{ fontSize: '0.73rem' }}>
                {syncingAll ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Syncing All...</> : <><RefreshCw size={12} /> Sync All</>}
              </button>
            )}
            {isAdmin && (
              <button className="primary" onClick={() => { setEditSource(null); setShowModal(true) }} style={{ fontSize: '0.73rem' }}>
                <Plus size={12} /> Add Source
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Configure data sources for test generation. Jira and Confluence sources are <strong>shared</strong> across all environments. MCP Tools and Context are <strong>per-environment</strong>.
        </div>

        {sources.length === 0 ? (
          <div className="empty" style={{ padding: '2rem' }}>
            No data sources configured. Add one to start importing requirements.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sources.map(src => {
              const badge = SYNC_BADGES[src.sync_status] || SYNC_BADGES.never
              const typeInfo = SOURCE_TYPES.find(t => t.value === src.source_type) || {}
              const expanded = expandedId === src.id
              const srcItems = items[src.id] || []
              return (
                <div key={src.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <div style={{
                    padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: expanded ? 'var(--bg-primary)' : 'var(--bg-card)', cursor: 'pointer',
                  }} onClick={() => toggleExpand(src.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <div style={{ opacity: src.enabled ? 1 : 0.5 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{src.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {typeInfo.label || src.source_type} — {src.item_count || 0} items
                          {src.shared && <span style={{ fontSize: '0.58rem', padding: '0.1em 0.35em', borderRadius: '8px', background: '#f0f0ff', color: 'var(--accent)', fontWeight: 500 }}>Shared</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={e => e.stopPropagation()}>
                      <span style={{
                        fontSize: '0.65rem', padding: '0.15em 0.5em', borderRadius: '10px',
                        background: badge.bg, color: badge.color, fontWeight: 500,
                      }}>{badge.label}</span>
                      {isAdmin && (
                        <button
                          onClick={() => handleToggleEnabled(src.id, src.enabled)}
                          title={src.enabled ? 'Disable' : 'Enable'}
                          style={{
                            fontSize: '0.62rem', padding: '0.15em 0.45em', borderRadius: '10px',
                            border: '1px solid var(--border)', cursor: 'pointer',
                            background: src.enabled ? '#ecfdf5' : '#f5f5f5',
                            color: src.enabled ? 'var(--green)' : 'var(--text-muted)',
                            fontWeight: 500,
                          }}
                        >
                          {src.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      )}
                      {!isAdmin && !src.enabled && (
                        <span style={{ fontSize: '0.65rem', padding: '0.15em 0.5em', borderRadius: '10px', background: '#f5f5f5', color: 'var(--text-muted)' }}>Disabled</span>
                      )}
                      <button onClick={() => handleSync(src.id)} disabled={syncing[src.id] || !src.enabled} style={{ fontSize: '0.7rem', padding: '0.2em 0.5em', opacity: src.enabled ? 1 : 0.4 }} title="Sync now">
                        {syncing[src.id] ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <RefreshCw size={11} />}
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => { setEditSource(src); setShowModal(true) }} style={{ fontSize: '0.7rem', padding: '0.2em 0.5em' }} title="Edit">
                            <Edit3 size={11} />
                          </button>
                          <button onClick={() => handleDelete(src.id)} style={{ fontSize: '0.7rem', padding: '0.2em 0.5em', color: 'var(--red)' }} title="Delete">
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0.85rem', maxHeight: 300, overflow: 'auto' }}>
                      {src.sync_error && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--red)', marginBottom: '0.4rem' }}>
                          <AlertCircle size={11} style={{ verticalAlign: 'middle' }} /> {src.sync_error}
                        </div>
                      )}
                      {src.last_synced_at && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                          Last synced: {new Date(src.last_synced_at + 'Z').toLocaleString()}
                        </div>
                      )}
                      {srcItems.length === 0 ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>
                          No items yet. Click sync to fetch.
                        </div>
                      ) : (
                        <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>Title</th>
                              <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600, width: 70 }}>Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {srcItems.slice(0, 50).map(item => (
                              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.3rem 0.4rem' }}>
                                  {item.external_url ? (
                                    <a href={item.external_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                                      {item.title} <ExternalLink size={9} style={{ verticalAlign: 'middle' }} />
                                    </a>
                                  ) : item.title}
                                </td>
                                <td style={{ padding: '0.3rem 0.4rem' }}>
                                  <span style={{ fontSize: '0.65rem', padding: '0.1em 0.4em', borderRadius: '8px', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                                    {item.item_type}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {srcItems.length > 50 && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', padding: '0.3rem 0' }}>
                          Showing 50 of {srcItems.length} items
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <DataSourceModal
          source={editSource}
          envKey={envKey}
          onClose={() => { setShowModal(false); setEditSource(null) }}
          onSaved={() => { setShowModal(false); setEditSource(null); load() }}
        />
      )}
    </div>
  )
}

function DataSourceModal({ source, envKey, onClose, onSaved }) {
  const [name, setName] = useState(source?.name || '')
  const [sourceType, setSourceType] = useState(source?.source_type || 'jira')
  const [config, setConfig] = useState(source?.config || {})
  const [enabled, setEnabled] = useState(source?.enabled !== false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      if (source) {
        await updateDataSource(source.id, { name, source_type: sourceType, config, enabled })
      } else {
        await createDataSource({ env_key: envKey, source_type: sourceType, name, config })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const updateCfg = (key, val) => setConfig(c => ({ ...c, [key]: val }))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 500, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 1rem' }}>{source ? 'Edit Data Source' : 'Add Data Source'}</h3>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sprint 1 Requirements" style={{ width: '100%' }} />
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Source Type</label>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {SOURCE_TYPES.map(t => (
              <button key={t.value} onClick={() => { setSourceType(t.value); setConfig({}) }}
                style={{
                  fontSize: '0.73rem', padding: '0.3em 0.7em', borderRadius: '6px',
                  border: sourceType === t.value ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: sourceType === t.value ? '#f0f0ff' : 'var(--bg-card)',
                  color: sourceType === t.value ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontWeight: sourceType === t.value ? 600 : 400,
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {SOURCE_TYPES.find(t => t.value === sourceType)?.desc}
          </div>
        </div>

        {/* Type-specific config */}
        {sourceType === 'jira' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Project Key</label>
              <input value={config.project_key || ''} onChange={e => updateCfg('project_key', e.target.value)} placeholder="QUAL" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Epic Keys (comma-separated)</label>
              <input value={(config.epic_keys || []).join(', ')} onChange={e => updateCfg('epic_keys', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="QUAL-179, QUAL-180" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>JQL Filter (overrides above)</label>
              <input value={config.jql_filter || ''} onChange={e => updateCfg('jql_filter', e.target.value)} placeholder="project = QUAL AND type = Story" style={{ width: '100%' }} />
            </div>
            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={config.include_subtasks !== false} onChange={e => updateCfg('include_subtasks', e.target.checked)} />
              Include sub-tasks
            </label>
            {/* Optional credentials override */}
            <div style={{ padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.72rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
                Credentials (optional — falls back to Bug Settings, then .env)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>Username / Email</label>
                  <input value={config.username || ''} onChange={e => updateCfg('username', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>API Token</label>
                  <input type="password" value={config.api_token || ''} onChange={e => updateCfg('api_token', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {sourceType === 'confluence' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Space Key</label>
              <input value={config.space_key || ''} onChange={e => updateCfg('space_key', e.target.value)} placeholder="TEAM" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Page IDs (comma-separated, optional)</label>
              <input value={(config.page_ids || []).join(', ')} onChange={e => updateCfg('page_ids', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="12345, 67890" style={{ width: '100%' }} />
            </div>
            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={config.include_children || false} onChange={e => updateCfg('include_children', e.target.checked)} />
              Include child pages
            </label>
            {/* Optional credentials override */}
            <div style={{ padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.72rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
                Credentials (optional — falls back to Bug Settings, then .env)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>Username / Email</label>
                  <input value={config.username || ''} onChange={e => updateCfg('username', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.68rem' }}>API Token</label>
                  <input type="password" value={config.api_token || ''} onChange={e => updateCfg('api_token', e.target.value)} placeholder="Leave blank for Bug Settings" style={{ width: '100%', fontSize: '0.72rem' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {sourceType === 'mcp_tools' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>MCP Server URL (auto-discover tools)</label>
              <input value={config.url || ''} onChange={e => updateCfg('url', e.target.value)} placeholder="https://your-mcp-server.com" style={{ width: '100%' }} />
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Tools are fetched via MCP JSON-RPC protocol using environment Bearer token (from env credentials). Leave empty to use manual JSON below.
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Manual Tools JSON (fallback if no URL)</label>
              <textarea
                value={JSON.stringify(config.tools || [], null, 2)}
                onChange={e => { try { updateCfg('tools', JSON.parse(e.target.value)) } catch {} }}
                placeholder={'[\n  {"name": "create_test", "description": "Creates a test case", "parameters": {}}\n]'}
                rows={5} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.72rem' }}
              />
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {config.url ? 'Ignored when URL is set — tools are auto-discovered on sync.' : 'Array of tool objects with name, description, and parameters fields.'}
              </div>
            </div>
          </div>
        )}

        {sourceType === 'context' && (
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 500 }}>Context Text</label>
            <textarea
              value={config.text || ''}
              onChange={e => updateCfg('text', e.target.value)}
              placeholder="Enter free-text requirements, context, or instructions for test generation..."
              rows={6} style={{ width: '100%', fontSize: '0.78rem' }}
            />
          </div>
        )}

        {source && (
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
              Enabled (included in sync-all)
            </label>
          </div>
        )}

        {error && <div style={{ fontSize: '0.73rem', color: 'var(--red)', marginTop: '0.5rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : source ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
