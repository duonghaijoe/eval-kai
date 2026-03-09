import { useState, useEffect, useRef } from 'react'
import { Users, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle, Clock, XCircle, UserMinus } from 'lucide-react'
import { listLoadTestUsers, syncLoadTestUsers, provisionLoadTestUsers, getProvisionStatus, teardownLoadTestUsers, deleteLoadTestUserRecord, getEnvConfig } from '../api'
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

  // Load env options
  useEffect(() => {
    getEnvConfig().then(cfg => {
      const envs = cfg.environments || {}
      setEnvOptions(Object.entries(envs).map(([k, v]) => ({ key: k, name: v.name })))
      setEnvKey(cfg.active || 'production')
    }).catch(() => {})
  }, [])

  // Load users when envKey changes — sync from platform to catch externally-provisioned users
  useEffect(() => {
    if (envKey) loadUsers(true)
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
          <button onClick={() => loadUsers(true)} className="secondary" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spinning' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

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
            {users.map(u => (
              <tr key={u.email} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem' }}>{u.email}</td>
                <td style={{ padding: '0.5rem 0.75rem' }}><StatusBadge status={u.status} fighting={u.fighting} /></td>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {u.user_id || '-'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {u.account_user_id || '-'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {u.license_allocation_id || '-'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {formatDt(u.created_at)}
                </td>
                {admin && (
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
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
                  </td>
                )}
              </tr>
            ))}
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
