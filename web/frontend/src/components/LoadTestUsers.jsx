import { useState, useEffect, useRef } from 'react'
import { Users, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle, Clock, XCircle, UserMinus, Settings, ExternalLink, ChevronDown, ChevronRight, Copy, Eye, EyeOff } from 'lucide-react'
import { listLoadTestUsers, syncLoadTestUsers, provisionLoadTestUsers, getProvisionStatus, teardownLoadTestUsers, deleteLoadTestUserRecord, getEnvConfig, discoverLicenseSources } from '../api'
import { useAdmin } from '../AdminContext'
import { formatDt } from '../api'

function StatusBadge({ status, fighting }) {
  if (fighting) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--blue)', fontSize: '0.73rem', fontWeight: 500 }}>
        <RefreshCw size={11} className="spinning" /> fighting
      </span>
    )
  }
  const map = {
    active: { color: 'var(--green)', icon: <CheckCircle size={11} /> },
    pending: { color: 'var(--yellow)', icon: <Clock size={11} /> },
    error: { color: 'var(--red)', icon: <XCircle size={11} /> },
  }
  const s = map[status] || map.pending
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: s.color, fontSize: '0.73rem', fontWeight: 500 }}>
      {s.icon} {status}
    </span>
  )
}

function DetailField({ label, value, copyable, secret, error, showPasswords, setShowPasswords, fieldKey }) {
  const displayValue = value == null || value === '' ? '-' : String(value)
  const isHidden = secret && !showPasswords?.[fieldKey]
  const maskedValue = isHidden ? '••••••••' : displayValue

  const handleCopy = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(displayValue)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', minWidth: 0 }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: '0.68rem' }}>{label}:</span>
      <span style={{
        fontFamily: copyable || secret ? 'monospace' : 'inherit',
        color: error ? 'var(--red)' : 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: secret ? '200px' : '300px',
      }}>
        {maskedValue}
      </span>
      {secret && displayValue !== '-' && (
        <button onClick={(e) => { e.stopPropagation(); setShowPasswords(p => ({ ...p, [fieldKey]: !p[fieldKey] })) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.15rem', color: 'var(--text-muted)', display: 'inline-flex' }}
          title={isHidden ? 'Show' : 'Hide'}>
          {isHidden ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      )}
      {(copyable || secret) && displayValue !== '-' && (
        <button onClick={handleCopy}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.15rem', color: 'var(--text-muted)', display: 'inline-flex' }}
          title="Copy">
          <Copy size={11} />
        </button>
      )}
    </div>
  )
}

export default function LoadTestUsers() {
  const { admin } = useAdmin()
  const [users, setUsers] = useState([])
  const [summary, setSummary] = useState({})
  const [envKey, setEnvKey] = useState('')
  const [envOptions, setEnvOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Provision form
  const [count, setCount] = useState(5)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionTask, setProvisionTask] = useState(null)

  // Teardown
  const [tearingDown, setTearingDown] = useState(false)
  const [teardownTask, setTeardownTask] = useState(null)

  const pollRef = useRef(null)

  const [expandedUser, setExpandedUser] = useState(null)
  const [showPasswords, setShowPasswords] = useState({})
  const [envConfigs, setEnvConfigs] = useState({})
  const [licenseQuota, setLicenseQuota] = useState(null)
  const [loadingLicense, setLoadingLicense] = useState(false)
  const [envConfigVersion, setEnvConfigVersion] = useState(0)

  const refreshEnvConfig = () => {
    return getEnvConfig().then(cfg => {
      const envs = cfg.environments || {}
      setEnvOptions(Object.entries(envs).map(([k, v]) => ({ key: k, name: v.name })))
      setEnvConfigs(envs)
      if (!envKey) setEnvKey(cfg.active || 'production')
      setEnvConfigVersion(v => v + 1)
    }).catch(() => {})
  }

  // Load env options on mount
  useEffect(() => { refreshEnvConfig() }, [])

  // Re-fetch env config + license quota when envKey changes
  useEffect(() => {
    if (!envKey) return
    refreshEnvConfig()
  }, [envKey])

  // Fetch license quota when env config updates
  useEffect(() => {
    if (!envKey || !envConfigVersion) return
    const ec = envConfigs[envKey]
    if (!ec?.license_source_id) { setLicenseQuota(null); return }
    setLoadingLicense(true)
    discoverLicenseSources({ env_key: envKey })
      .then(result => {
        const sources = result.sources || []
        const match = sources.find(s => String(s.id) === String(ec.license_source_id))
        setLicenseQuota(match || null)
      })
      .catch(() => setLicenseQuota(null))
      .finally(() => setLoadingLicense(false))
  }, [envConfigVersion])

  // Load users when envKey changes — no sync on auto-load (sync only on explicit Refresh)
  useEffect(() => {
    if (envKey) loadUsers(false)
  }, [envKey])

  const loadUsers = async (sync = false) => {
    setLoading(true)
    setError(null)
    try {
      // Sync from platform first to pick up externally-provisioned users
      if (sync) {
        await syncLoadTestUsers(envKey).catch(e =>
          console.warn('Sync from platform:', e.message)
        )
      }
      const data = await listLoadTestUsers(envKey)
      setUsers(data.users || [])
      setSummary(data.summary || {})
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Poll task status
  const pollTask = (taskId, type) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const task = await getProvisionStatus(taskId)
        if (type === 'provision') setProvisionTask(task)
        else setTeardownTask(task)

        if (task.status !== 'running') {
          clearInterval(pollRef.current)
          pollRef.current = null
          if (type === 'provision') setProvisioning(false)
          else setTearingDown(false)
          loadUsers()
        }
      } catch {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }, 2000)
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleProvision = async () => {
    if (!admin) { setError('Admin login required'); return }
    setProvisioning(true)
    setProvisionTask(null)
    setError(null)
    try {
      const data = await provisionLoadTestUsers({ count, envKey })
      setProvisionTask({ ...data, status: 'running', completed: 0, errors: 0 })
      pollTask(data.task_id, 'provision')
    } catch (e) {
      setError(e.message)
      setProvisioning(false)
    }
  }

  const handleTeardownAll = async () => {
    if (!admin) { setError('Admin login required'); return }
    if (!confirm('Teardown ALL active load test users? This will revoke licenses and deactivate accounts.')) return
    setTearingDown(true)
    setTeardownTask(null)
    setError(null)
    try {
      const data = await teardownLoadTestUsers({ envKey })
      setTeardownTask({ ...data, status: 'running', completed: 0, errors: 0 })
      pollTask(data.task_id, 'teardown')
    } catch (e) {
      setError(e.message)
      setTearingDown(false)
    }
  }

  const handleTeardownOne = async (email) => {
    if (!admin) { setError('Admin login required'); return }
    if (!confirm(`Teardown ${email}?`)) return
    setError(null)
    try {
      const data = await teardownLoadTestUsers({ email, envKey })
      pollTask(data.task_id, 'teardown')
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDeleteRecord = async (email) => {
    if (!admin) { setError('Admin login required'); return }
    if (!confirm(`Delete DB record for ${email}? (Does NOT teardown from platform)`)) return
    try {
      await deleteLoadTestUserRecord(email, envKey)
      loadUsers()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2><Users size={20} /> Talent Scouting</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select value={envKey} onChange={e => setEnvKey(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', fontSize: '0.78rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            {envOptions.map(e => <option key={e.key} value={e.key}>{e.name}</option>)}
          </select>
          <button onClick={() => { refreshEnvConfig(); loadUsers(true) }} className="secondary" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spinning' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Env config summary */}
      {envKey && envConfigs[envKey] && (() => {
        const ec = envConfigs[envKey]
        const creds = ec.credentials || {}
        const hasLicense = !!ec.license_source_id
        const hasProject = !!ec.project_id
        const hasAccount = !!creds.account
        const allGood = hasLicense && hasProject && hasAccount
        return (
          <div className="card" style={{ padding: '0.6rem 0.85rem', marginBottom: '1rem', fontSize: '0.72rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, fontSize: '0.74rem' }}>
                <Settings size={12} style={{ color: 'var(--text-muted)' }} />
                Environment Config
                {allGood
                  ? <CheckCircle size={11} style={{ color: 'var(--green)' }} />
                  : <AlertCircle size={11} style={{ color: 'var(--yellow)' }} />
                }
              </div>
              <a href={`/settings?env=${envKey}`} style={{ fontSize: '0.65rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.2rem', textDecoration: 'none' }}>
                <ExternalLink size={10} /> Edit
              </a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.3rem 1rem', color: 'var(--text-secondary)' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Account: </span>
                {ec.account_name || '-'}
                <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>
                  ({hasAccount ? `#${creds.account.split('_')[0]}` : <span style={{ color: 'var(--red)' }}>not set</span>})
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Domain: </span>
                {ec.base_url || ec.platform_url || <span style={{ color: 'var(--red)' }}>not set</span>}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Project: </span>
                {ec.project_name || '-'}
                <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>
                  ({hasProject ? `#${ec.project_id}` : <span style={{ color: 'var(--red)' }}>not set</span>})
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Org: </span>
                {ec.org_id || <span style={{ color: 'var(--red)' }}>not set</span>}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>License Source: </span>
                {hasLicense
                  ? <>
                      <span style={{ fontFamily: 'monospace' }}>#{ec.license_source_id}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>({ec.license_feature || 'N/A'})</span>
                      {loadingLicense && <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>checking...</span>}
                      {!loadingLicense && licenseQuota && (
                        <span style={{ marginLeft: '0.4rem' }}>
                          — <span style={{
                            fontWeight: 700,
                            color: licenseQuota.available <= 0 ? 'var(--red)' : licenseQuota.available < 5 ? 'var(--yellow)' : 'var(--green)'
                          }}>
                            {licenseQuota.available}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>/{licenseQuota.purchased} available</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>(pool: {licenseQuota.pool}, assigned: {licenseQuota.assigned})</span>
                        </span>
                      )}
                      {!loadingLicense && !licenseQuota && hasLicense && (
                        <span style={{ color: 'var(--red)', marginLeft: '0.4rem' }}>— source #{ec.license_source_id} not found for this account. Check Account ID &amp; License Source in Settings.</span>
                      )}
                    </>
                  : <span style={{ color: 'var(--red)' }}>not set — Discover in Settings</span>
                }
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Admin: </span>
                {creds.email || <span style={{ color: 'var(--red)' }}>not set</span>}
              </div>
            </div>
            {!allGood && (
              <div style={{ marginTop: '0.35rem', fontSize: '0.66rem', color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <AlertCircle size={10} />
                Missing config — scouting may fail. <a href={`/settings?env=${envKey}`} style={{ color: 'var(--accent)' }}>Configure environment</a>
              </div>
            )}
          </div>
        )
      })()}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Total', value: summary.total || 0, color: 'var(--text-primary)' },
          { label: 'Active', value: summary.active || 0, color: 'var(--green)' },
          { label: 'Fighting', value: summary.fighting || 0, color: 'var(--blue)' },
          { label: 'Pending', value: summary.pending || 0, color: 'var(--yellow)' },
          { label: 'Error', value: summary.error || 0, color: 'var(--red)' },
        ].map(c => (
          <div key={c.label} className="card" style={{ padding: '0.75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Provision & Teardown controls */}
      {admin && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>Count</label>
              <input type="number" min={1} max={50} value={count} onChange={e => setCount(parseInt(e.target.value) || 1)}
                style={{ width: '70px', padding: '0.35rem 0.5rem', fontSize: '0.8rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
            </div>
            <button onClick={handleProvision} className="primary" disabled={provisioning}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {provisioning
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Scouting...</>
                : <><Plus size={14} /> Scout {count} Fighters</>}
            </button>
            <button onClick={handleTeardownAll} className="danger" disabled={tearingDown || (summary.active || 0) === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {tearingDown
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Tearing down...</>
                : <><Trash2 size={14} /> Release All</>}
            </button>
          </div>

          {/* Task progress */}
          {provisionTask && provisionTask.status === 'running' && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem' }}>
              <RefreshCw size={11} className="spinning" style={{ marginRight: '0.3rem' }} />
              Scouting... {provisionTask.completed || 0}/{count} recruited, {provisionTask.errors || 0} rejected
            </div>
          )}
          {provisionTask && provisionTask.status === 'completed' && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem', color: 'var(--green)' }}>
              <CheckCircle size={11} style={{ marginRight: '0.3rem' }} />
              Scouting complete: {provisionTask.completed} recruited, {provisionTask.errors} rejected
            </div>
          )}
          {provisionTask && provisionTask.status === 'error' && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem', color: 'var(--red)' }}>
              <XCircle size={11} style={{ marginRight: '0.3rem' }} />
              Scouting failed: {provisionTask.error}
            </div>
          )}
          {teardownTask && teardownTask.status === 'running' && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem' }}>
              <RefreshCw size={11} className="spinning" style={{ marginRight: '0.3rem' }} />
              Tearing down users...
            </div>
          )}
          {teardownTask && teardownTask.status === 'completed' && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.73rem', color: 'var(--green)' }}>
              <CheckCircle size={11} style={{ marginRight: '0.3rem' }} />
              Teardown complete: {teardownTask.completed} removed, {teardownTask.errors} errors
            </div>
          )}
        </div>
      )}

      {/* Users table */}
      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Email</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Status</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>User ID</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Account User</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>License</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Created</th>
              {admin && <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading && (
              <tr><td colSpan={admin ? 7 : 6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No fighters scouted yet
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={admin ? 7 : 6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <span className="spinner" style={{ width: 14, height: 14 }} /> Loading...
              </td></tr>
            )}
            {users.map(u => {
              const isExpanded = expandedUser === u.email
              return (
                <tr key={u.email} style={{ borderBottom: isExpanded ? 'none' : '1px solid var(--border)' }}>
                  <td colSpan={admin ? 7 : 6} style={{ padding: 0 }}>
                    {/* Main row */}
                    <div
                      onClick={() => setExpandedUser(isExpanded ? null : u.email)}
                      style={{ display: 'grid', gridTemplateColumns: admin ? '2fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr 0.6fr' : '2fr 0.8fr 0.8fr 0.8fr 0.8fr 1fr', alignItems: 'center', cursor: 'pointer', padding: '0.5rem 0.75rem', transition: 'background 0.15s', background: isExpanded ? 'var(--bg-primary)' : 'transparent' }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                    >
                      <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        {isExpanded ? <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                        {u.email}
                      </div>
                      <div><StatusBadge status={u.status} fighting={u.fighting} /></div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{u.user_id || '-'}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{u.account_user_id || '-'}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{u.license_allocation_id || '-'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{formatDt(u.created_at)}</div>
                      {admin && (
                        <div style={{ display: 'flex', gap: '0.3rem' }} onClick={e => e.stopPropagation()}>
                          {u.status === 'active' && (
                            <button onClick={() => handleTeardownOne(u.email)}
                              title="Teardown" className="icon-btn"
                              style={{ padding: '0.2rem', color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              <UserMinus size={13} />
                            </button>
                          )}
                          {u.status === 'error' && (
                            <button onClick={() => handleDeleteRecord(u.email)}
                              title="Delete record" className="icon-btn"
                              style={{ padding: '0.2rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div style={{ padding: '0.5rem 0.75rem 0.75rem 2rem', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', fontSize: '0.72rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.4rem 1.5rem' }}>
                          {/* Credentials */}
                          <DetailField label="Email" value={u.email} copyable />
                          <DetailField label="Password" value={u.password} secret showPasswords={showPasswords} setShowPasswords={setShowPasswords} fieldKey={u.email} />

                          {/* IDs */}
                          <DetailField label="Keycloak User ID" value={u.user_id} copyable />
                          <DetailField label="TestOps User ID" value={u.testops_user_id} copyable />
                          <DetailField label="Account User ID" value={u.account_user_id} copyable />
                          <DetailField label="Project User ID" value={u.project_user_id} copyable />
                          <DetailField label="License Allocation ID" value={u.license_allocation_id} copyable />

                          {/* Token */}
                          {u.bearer_token && (
                            <DetailField label="Bearer Token" value={u.bearer_token} secret showPasswords={showPasswords} setShowPasswords={setShowPasswords} fieldKey={`${u.email}_token`} />
                          )}
                          {u.token_expires_at && (
                            <DetailField label="Token Expires" value={formatDt(u.token_expires_at)} />
                          )}

                          {/* Meta */}
                          <DetailField label="Created" value={formatDt(u.created_at)} />
                          <DetailField label="Updated" value={formatDt(u.updated_at)} />
                          {u.error && (
                            <div style={{ gridColumn: '1 / -1' }}>
                              <DetailField label="Error" value={u.error} error />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Error details */}
      {users.some(u => u.error) && (
        <div className="card" style={{ marginTop: '1rem', padding: '0.75rem' }}>
          <h4 style={{ fontSize: '0.78rem', marginBottom: '0.5rem', color: 'var(--red)' }}>
            <AlertCircle size={13} /> Errors
          </h4>
          {users.filter(u => u.error).map(u => (
            <div key={u.email} style={{ fontSize: '0.72rem', marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
              <strong>{u.email}:</strong> {u.error}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
