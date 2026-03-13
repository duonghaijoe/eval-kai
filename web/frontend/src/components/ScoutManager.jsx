import { useState, useEffect } from 'react'
import { Radar, Play, Plus, Edit3, Trash2, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, ChevronDown, ChevronRight, Zap } from 'lucide-react'
import { useAdmin } from '../AdminContext'
import { listScouts, createScout, updateScout, deleteScout, triggerScout, runScoutNow, listScoutRuns, listDataSources } from '../api'
import { formatDt } from '../api'

const INTERVAL_LABELS = { hourly: '1 hour', '6h': '6 hours', daily: '24 hours', weekly: '7 days' }
const STATUS_COLORS = { running: 'var(--blue)', completed: 'var(--green)', error: 'var(--red)', pending: 'var(--yellow)' }

function Badge({ color, children }) {
  return (
    <span style={{
      fontSize: '0.65rem', padding: '0.12em 0.5em', borderRadius: '10px',
      background: `${color}18`, color, fontWeight: 500,
    }}>{children}</span>
  )
}

export default function ScoutManager() {
  const { admin: isAdmin } = useAdmin()
  const [schedules, setSchedules] = useState([])
  const [runs, setRuns] = useState([])
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editSched, setEditSched] = useState(null)
  const [expandedRun, setExpandedRun] = useState(null)
  const [scouting, setScouting] = useState(false)
  const [triggering, setTriggering] = useState({})

  const load = async () => {
    try {
      const [schedData, runData, srcData] = await Promise.all([
        listScouts(), listScoutRuns(), listDataSources(),
      ])
      setSchedules(schedData.schedules || [])
      setRuns(runData.runs || [])
      setSources(srcData.sources || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleTrigger = async (id) => {
    setTriggering(p => ({ ...p, [id]: true }))
    try {
      await triggerScout(id)
      await load()
    } catch { /* ignore */ }
    setTriggering(p => ({ ...p, [id]: false }))
  }

  const handleScoutNow = async () => {
    setScouting(true)
    try {
      await runScoutNow({ auto_generate: true })
      await load()
    } catch { /* ignore */ }
    setScouting(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this scout schedule?')) return
    try {
      await deleteScout(id)
      await load()
    } catch { /* ignore */ }
  }

  const handleToggleEnabled = async (sched) => {
    try {
      await updateScout(sched.id, { enabled: !sched.enabled })
      await load()
    } catch { /* ignore */ }
  }

  if (loading) return <div className="empty"><span className="spinner" /> Loading scout manager...</div>

  return (
    <div>
      <div className="page-header">
        <h2><Radar size={20} /> Scout</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleScoutNow} disabled={scouting}>
            {scouting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Scouting...</> : <><Zap size={14} /> Scout Now</>}
          </button>
          {isAdmin && (
            <button className="primary" onClick={() => { setEditSched(null); setShowCreate(true) }}>
              <Plus size={14} /> New Schedule
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Automate requirement syncing, test generation, and match execution on a schedule.
      </div>

      {/* Schedules */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
          <Clock size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
          Schedules
        </h3>
        {schedules.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
            No schedules configured. Create one to automate test scouting.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {schedules.map(sched => {
              const srcNames = sched.source_ids.map(id => {
                const src = sources.find(s => s.id === id)
                return src ? src.name : id
              }).join(', ')

              return (
                <div key={sched.id} style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  padding: '0.6rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  opacity: sched.enabled ? 1 : 0.6,
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{sched.name}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      Every {INTERVAL_LABELS[sched.interval] || sched.interval}
                      {srcNames && ` — ${srcNames}`}
                      {sched.auto_generate && ' — auto-gen'}
                      {sched.auto_approve && ' — auto-approve'}
                      {sched.auto_run && ' — auto-run'}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      {sched.last_run_at ? `Last run: ${formatDt(sched.last_run_at)}` : 'Never run'}
                      {sched.next_run_at && ` — Next: ${formatDt(sched.next_run_at)}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    <Badge color={sched.enabled ? 'var(--green)' : 'var(--text-muted)'}>
                      {sched.enabled ? 'Active' : 'Paused'}
                    </Badge>
                    <button onClick={() => handleTrigger(sched.id)} disabled={triggering[sched.id]}
                      style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }} title="Trigger now">
                      {triggering[sched.id] ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <Play size={11} />}
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => handleToggleEnabled(sched)}
                          style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }} title={sched.enabled ? 'Pause' : 'Enable'}>
                          {sched.enabled ? '⏸' : '▶'}
                        </button>
                        <button onClick={() => { setEditSched(sched); setShowCreate(true) }}
                          style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }} title="Edit">
                          <Edit3 size={11} />
                        </button>
                        <button onClick={() => handleDelete(sched.id)}
                          style={{ fontSize: '0.68rem', padding: '0.2em 0.5em', color: 'var(--red)' }} title="Delete">
                          <Trash2 size={11} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Run History */}
      <div className="card">
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
          <RefreshCw size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
          Run History
        </h3>
        {runs.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
            No scout runs yet. Trigger a schedule or use "Scout Now".
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {runs.slice(0, 20).map(run => {
              const expanded = expandedRun === run.id
              const steps = run.steps_log || []
              return (
                <div key={run.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <div style={{
                    padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: 'pointer', background: expanded ? 'var(--bg-primary)' : 'var(--bg-card)',
                  }} onClick={() => setExpandedRun(expanded ? null : run.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 500 }}>
                          {run.trigger_type === 'scheduled' ? 'Scheduled' : 'Manual'} Run
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {formatDt(run.created_at)}</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          {run.cases_generated > 0 && `${run.cases_generated} cases generated`}
                          {run.plan_id && ` — Plan: ${run.plan_id}`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <Badge color={STATUS_COLORS[run.status] || 'var(--text-muted)'}>{run.status}</Badge>
                      {run.changes_detected > 0 && <Badge color="var(--accent)">Changes</Badge>}
                    </div>
                  </div>
                  {expanded && steps.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0.75rem' }}>
                      {run.error && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--red)', marginBottom: '0.3rem' }}>
                          <AlertCircle size={11} style={{ verticalAlign: 'middle' }} /> {run.error}
                        </div>
                      )}
                      {steps.map((step, idx) => (
                        <div key={idx} style={{ fontSize: '0.7rem', padding: '0.15rem 0', color: 'var(--text-secondary)', display: 'flex', gap: '0.4rem' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.63rem', minWidth: 55 }}>
                            {step.time ? new Date(step.time + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                          </span>
                          <span>{step.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showCreate && (
        <ScoutModal
          schedule={editSched}
          sources={sources}
          onClose={() => { setShowCreate(false); setEditSched(null) }}
          onSaved={() => { setShowCreate(false); setEditSched(null); load() }}
        />
      )}
    </div>
  )
}

function ScoutModal({ schedule, sources, onClose, onSaved }) {
  const [name, setName] = useState(schedule?.name || '')
  const [interval, setInterval] = useState(schedule?.interval || 'daily')
  const [sourceIds, setSourceIds] = useState(schedule?.source_ids || [])
  const [autoGenerate, setAutoGenerate] = useState(schedule?.auto_generate !== false)
  const [autoApprove, setAutoApprove] = useState(schedule?.auto_approve || false)
  const [autoRun, setAutoRun] = useState(schedule?.auto_run || false)
  const [model, setModel] = useState(schedule?.model || 'sonnet')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      if (schedule) {
        await updateScout(schedule.id, { name, interval, source_ids: sourceIds, auto_generate: autoGenerate, auto_approve: autoApprove, auto_run: autoRun, model })
      } else {
        await createScout({ name, interval, source_ids: sourceIds, auto_generate: autoGenerate, auto_approve: autoApprove, auto_run: autoRun, model })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 480, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 1rem' }}>{schedule ? 'Edit Schedule' : 'New Scout Schedule'}</h3>

        <div style={{ marginBottom: '0.6rem' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily Regression Scout" style={{ width: '100%' }} />
        </div>

        <div style={{ marginBottom: '0.6rem' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Interval</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {Object.entries(INTERVAL_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => setInterval(key)} style={{
                fontSize: '0.73rem', padding: '0.3em 0.7em', borderRadius: '6px',
                border: interval === key ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: interval === key ? '#f0f0ff' : 'var(--bg-card)',
                color: interval === key ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer', fontWeight: interval === key ? 600 : 400,
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '0.6rem' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Data Sources</label>
          {sources.filter(s => s.enabled).length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No sources available</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {sources.filter(s => s.enabled).map(src => (
                <label key={src.id} style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sourceIds.includes(src.id)}
                    onChange={e => {
                      if (e.target.checked) setSourceIds(p => [...p, src.id])
                      else setSourceIds(p => p.filter(id => id !== src.id))
                    }}
                  />
                  {src.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: '0.6rem' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Model</label>
          <select value={model} onChange={e => setModel(e.target.value)} style={{ fontSize: '0.78rem' }}>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoGenerate} onChange={e => setAutoGenerate(e.target.checked)} />
            Auto-generate test cases when changes detected
          </label>
          <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
            Auto-approve generated cases
          </label>
          <label style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
            Auto-run match with approved cases
          </label>
        </div>

        {error && <div style={{ fontSize: '0.73rem', color: 'var(--red)', marginBottom: '0.5rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : schedule ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
