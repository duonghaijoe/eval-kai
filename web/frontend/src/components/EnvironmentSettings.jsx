import { useState, useEffect } from 'react'
import { Settings, Globe, CheckCircle, Save, RotateCcw, Lock, Plus, Trash2, ExternalLink, Key, Heart, HeartOff, Activity } from 'lucide-react'
import { getEnvConfig, updateEnvConfig, resetEnvConfig, deleteEnvProfile, checkEnvHealth } from '../api'
import { useAdmin } from '../App'

function HealthResult({ health }) {
  if (!health) return null
  const { kai, joe_bot } = health
  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem' }}>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
              (TTFB {Math.round(kai.ttfb_ms)}ms, Total {Math.round(kai.total_ms)}ms)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {joe_bot.ok
            ? <Heart size={11} style={{ color: 'var(--green)' }} />
            : <HeartOff size={11} style={{ color: 'var(--red)' }} />
          }
          <strong>Joe's AI Bot:</strong>
          <span style={{ color: joe_bot.ok ? 'var(--green)' : 'var(--red)' }}>
            {joe_bot.ok ? 'OK' : 'Failed'}
          </span>
          {joe_bot.latency_ms > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>({Math.round(joe_bot.latency_ms)}ms)</span>
          )}
        </div>
      </div>
      {kai.ok && kai.response && (
        <div style={{ marginTop: '0.3rem', color: 'var(--text-secondary)', fontStyle: 'italic', maxHeight: '3rem', overflow: 'hidden' }}>
          Kai: "{kai.response.slice(0, 150)}{kai.response.length > 150 ? '...' : ''}"
        </div>
      )}
      {joe_bot.ok && joe_bot.response && (
        <div style={{ marginTop: '0.2rem', color: 'var(--text-secondary)', fontStyle: 'italic', maxHeight: '3rem', overflow: 'hidden' }}>
          Joe's Bot: "{joe_bot.response.slice(0, 150)}{joe_bot.response.length > 150 ? '...' : ''}"
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
      {!joe_bot.ok && joe_bot.response && (
        <div style={{ marginTop: '0.2rem', color: 'var(--red)', fontSize: '0.68rem' }}>
          Joe's Bot: {joe_bot.response.slice(0, 200)}
        </div>
      )}
    </div>
  )
}

function EnvCard({ envKey, env, isActive, onSelect, onEdit, onDelete, readOnly }) {
  const [editing, setEditing] = useState(false)
  const [healthChecking, setHealthChecking] = useState(false)
  const [health, setHealth] = useState(null)
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
      setHealth({ kai: { ok: false, response: e.message }, claude_cli: { ok: false, response: e.message }, healthy: false })
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
            title="Test Kai & Joe's AI Bot connectivity"
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            <div>
              <label>Name</label>
              <input value={env.name || ''} onChange={e => onEdit(envKey, { ...env, name: e.target.value })} />
            </div>
            <div>
              <label>Base URL</label>
              <input value={env.base_url || ''} onChange={e => onEdit(envKey, { ...env, base_url: e.target.value })} placeholder="https://..." />
            </div>
            <div>
              <label>Login URL</label>
              <input value={env.login_url || ''} onChange={e => onEdit(envKey, { ...env, login_url: e.target.value })} />
            </div>
            <div>
              <label>Platform URL</label>
              <input value={env.platform_url || ''} onChange={e => onEdit(envKey, { ...env, platform_url: e.target.value })} />
            </div>
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
              <label>Account ID</label>
              <input value={env.account_id || ''} onChange={e => onEdit(envKey, { ...env, account_id: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Account Name</label>
              <input value={env.account_name || ''} onChange={e => onEdit(envKey, { ...env, account_name: e.target.value })} />
            </div>
          </div>

          {/* Credentials */}
          <div style={{ marginTop: '0.6rem', padding: '0.6rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
            <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Key size={12} /> TestOps Credentials
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
              <div>
                <label>Email</label>
                <input value={creds.email || ''} onChange={e => updateCred('email', e.target.value)} placeholder="user@katalon.com" />
              </div>
              <div>
                <label>Password / API Key {hasPassword && <span style={{ color: 'var(--green)', fontSize: '0.65rem' }}>(set)</span>}</label>
                <input type="password" defaultValue="" onChange={e => updateCred('password', e.target.value)} placeholder={hasPassword ? 'Leave blank to keep current' : 'Enter password'} />
              </div>
              <div>
                <label>Account</label>
                <input value={creds.account || ''} onChange={e => updateCred('account', e.target.value)} placeholder="account_id" />
              </div>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Leave blank to fall back to server .env credentials.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EnvironmentSettings() {
  const { admin, setAdmin } = useAdmin()
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newEnvKey, setNewEnvKey] = useState('')

  useEffect(() => {
    getEnvConfig().then(d => { setConfig(d); setLoading(false) }).catch(() => setLoading(false))
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

  const handleEditEnv = (envKey, env) => {
    setConfig(c => ({
      ...c,
      environments: { ...c.environments, [envKey]: env },
    }))
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

  return (
    <div>
      <div className="page-header">
        <h2><Settings size={20} /> Arena Settings</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {isAdmin ? (
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
          ) : (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Lock size={12} /> Sign in to edit
            </span>
          )}
        </div>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Configure which Kai environment to test against. Switch between production, staging, or custom environments.
        Credentials are shared from the server's .env file — only the target URL and project change.
      </div>

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
    </div>
  )
}
