import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { List, Plus, Trash2, Clock, Timer, Zap, Award, Activity, ExternalLink, Trophy, RotateCcw, Search, Filter, CheckSquare, Square, X } from 'lucide-react'
import { listSessions, deleteSession, startSession, bulkDeleteSessions, formatDt, formatMs, formatSec } from '../api'
import { useAdmin } from '../AdminContext'

function ScoreBadge({ value }) {
  if (value == null) return null
  const v = typeof value === 'number' ? value.toFixed(1) : value
  const n = parseFloat(v)
  const cls = n >= 4 ? 'high' : n >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{v}/5</span>
}

export default function SessionList() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [rerunning, setRerunning] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState('all')
  const [ringFilter, setRingFilter] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const navigate = useNavigate()
  const { admin } = useAdmin()

  const load = async () => {
    try {
      const data = await listSessions(200)
      setSessions(data.sessions || [])
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const filtered = useMemo(() => {
    let result = sessions
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(s =>
        s.id.toLowerCase().includes(q) ||
        (s.goal || '').toLowerCase().includes(q) ||
        (s.scenario_id || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') result = result.filter(s => s.status === statusFilter)
    if (modeFilter !== 'all') result = result.filter(s => s.actor_mode === modeFilter)
    if (ringFilter !== 'all') result = result.filter(s => (s.env_key || 'production') === ringFilter)
    return result
  }, [sessions, search, statusFilter, modeFilter, ringFilter])

  const statuses = [...new Set(sessions.map(s => s.status))]
  const modes = [...new Set(sessions.map(s => s.actor_mode))]
  const rings = [...new Set(sessions.map(s => s.env_key || 'production'))]

  const handleDelete = async (id) => {
    if (!confirm(`Delete round ${id}?`)) return
    try { await deleteSession(id); load() } catch (e) { alert(e.message) }
  }

  const handleRerun = async (s) => {
    setRerunning(s.id)
    try {
      const res = await startSession({
        actorMode: s.actor_mode,
        goal: s.goal || s.scenario_id,
        scenarioId: s.scenario_id || undefined,
        maxTurns: s.max_turns,
        maxTimeS: s.max_time_s || 600,
        evalModel: s.eval_model,
      })
      navigate(`/sessions/${res.session_id}`)
    } catch (e) { alert('Rematch failed: ' + e.message) }
    finally { setRerunning(null) }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const deletable = filtered.filter(s => s.status !== 'running').map(s => s.id)
    if (deletable.every(id => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(deletable))
    }
  }

  const handleBulkDelete = async () => {
    const ids = [...selected].filter(id => {
      const s = sessions.find(sess => sess.id === id)
      return s && s.status !== 'running'
    })
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} round(s)?`)) return
    setBulkDeleting(true)
    try {
      await bulkDeleteSessions(ids)
      setSelected(new Set())
      load()
    } catch (e) { alert(e.message) }
    finally { setBulkDeleting(false) }
  }

  const hasFilters = search || statusFilter !== 'all' || modeFilter !== 'all' || ringFilter !== 'all'
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setModeFilter('all'); setRingFilter('all') }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading rounds...</div>

  return (
    <div>
      <div className="page-header">
        <h2><List size={20} /> Rounds</h2>
        <Link to="/"><button className="primary"><Plus size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />New Round</button></Link>
      </div>

      {/* Search & Filters */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '3 1 0' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by ID, goal, scenario..."
              style={{ paddingLeft: '1.75rem', width: '100%', fontSize: '0.8rem' }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ fontSize: '0.75rem', padding: '0.35em 0.5em', flex: '1 1 0', minWidth: '90px' }}>
            <option value="all">All Status</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={modeFilter} onChange={e => setModeFilter(e.target.value)} style={{ fontSize: '0.75rem', padding: '0.35em 0.5em', flex: '1 1 0', minWidth: '90px' }}>
            <option value="all">All Modes</option>
            {modes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {rings.length > 1 && (
            <select value={ringFilter} onChange={e => setRingFilter(e.target.value)} style={{ fontSize: '0.75rem', padding: '0.35em 0.5em', flex: '1 1 0', minWidth: '90px' }}>
              <option value="all">All Rings</option>
              {rings.map(r => <option key={r} value={r}>{r.replace(/^\w/, c => c.toUpperCase())}</option>)}
            </select>
          )}
          {hasFilters && (
            <button onClick={clearFilters} style={{ fontSize: '0.7rem', padding: '0.3em 0.5em', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          {filtered.length} of {sessions.length} rounds
          {admin && selected.size > 0 && (
            <span style={{ marginLeft: '0.75rem' }}>
              <strong>{selected.size}</strong> selected
              <button onClick={handleBulkDelete} disabled={bulkDeleting} className="danger" style={{ fontSize: '0.65rem', padding: '0.15em 0.4em', marginLeft: '0.4rem' }}>
                {bulkDeleting ? <span className="spinner" /> : <Trash2 size={10} />} Delete Selected
              </button>
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <List size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <h3>{hasFilters ? 'No matching rounds' : 'No rounds yet'}</h3>
          <p>{hasFilters ? 'Try adjusting your filters.' : 'Start a new match or round to see results here.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Select all header (admin only) */}
          {admin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '0.25rem' }}>
              <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', color: 'var(--text-secondary)' }}>
                {filtered.filter(s => s.status !== 'running').every(s => selected.has(s.id)) && filtered.length > 0
                  ? <CheckSquare size={16} style={{ color: 'var(--accent)' }} />
                  : <Square size={16} />
                }
              </button>
              <span>Select all</span>
            </div>
          )}
          {filtered.map(s => (
            <div key={s.id} className="card" style={{ padding: '1rem 1.25rem', marginBottom: 0 }}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                  {admin && (
                    <button onClick={() => toggleSelect(s.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: '0.1rem', display: 'flex', color: 'var(--text-secondary)' }}>
                      {selected.has(s.id)
                        ? <CheckSquare size={16} style={{ color: 'var(--accent)' }} />
                        : <Square size={16} />
                      }
                    </button>
                  )}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <Link to={`/sessions/${s.id}`} style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        <ExternalLink size={12} style={{ marginRight: '0.2rem', verticalAlign: 'middle' }} />
                        {s.id}
                      </Link>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      <span className={`badge ${s.actor_mode}`}>{s.actor_mode}</span>
                      <span className={`badge ${s.env_key === 'staging' ? 'pending' : 'completed'}`} title="Ring">
                        {(s.env_key || 'production').replace(/^\w/, c => c.toUpperCase())}
                      </span>
                      {s.match_id && (
                        <Link to={`/matches/${s.match_id}`} style={{ fontSize: '0.65rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                          <Trophy size={10} /> {s.match_id}
                        </Link>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.goal || s.scenario_id || '-'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    <Clock size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />
                    {formatDt(s.created_at)}
                  </span>
                  {s.status !== 'running' && (
                    <>
                      <button onClick={() => handleRerun(s)} disabled={rerunning === s.id} title="Rematch — new game, same settings" style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
                        {rerunning === s.id ? <span className="spinner" /> : <RotateCcw size={10} />}
                      </button>
                      {admin && (
                        <button className="danger" onClick={() => handleDelete(s.id)} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
                          <Trash2 size={10} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Analytics row */}
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <Activity size={12} style={{ color: 'var(--accent)' }} />
                  <strong>{s.turns_completed || 0}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>/ {s.max_turns} exchanges</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <Timer size={12} style={{ color: 'var(--blue)' }} />
                  <span>TTFT: <strong>{formatMs(s.avg_ttfb_ms)}</strong></span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <Zap size={12} style={{ color: 'var(--orange)' }} />
                  <span>Total: <strong>{formatMs(s.avg_total_ms)}</strong></span>
                </div>

                {s.overall_score != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
                    <Award size={12} style={{ color: 'var(--green)' }} />
                    <ScoreBadge value={s.overall_score} />
                  </div>
                )}

                {s.started_at && s.ended_at && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    {formatSec((new Date(s.ended_at) - new Date(s.started_at)) / 1000)} duration
                  </div>
                )}

                {s.status === 'running' && (
                  <span className="loading-text" style={{ fontSize: '0.75rem' }}>
                    <span className="spinner" /> In the ring...
                  </span>
                )}
              </div>

              {/* Scorecard breakdown */}
              {(s.goal_achievement != null || s.context_retention != null) && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {s.goal_achievement != null && (
                    <span className="eval-pill">Goal: <ScoreBadge value={s.goal_achievement} /></span>
                  )}
                  {s.context_retention != null && (
                    <span className="eval-pill">Context: <ScoreBadge value={s.context_retention} /></span>
                  )}
                  {s.error_handling != null && (
                    <span className="eval-pill">Defense: <ScoreBadge value={s.error_handling} /></span>
                  )}
                  {s.response_quality != null && (
                    <span className="eval-pill">Quality: <ScoreBadge value={s.response_quality} /></span>
                  )}
                </div>
              )}

              {/* Judge's notes */}
              {s.eval_summary && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.5 }}>
                  {s.eval_summary.length > 200 ? s.eval_summary.slice(0, 200) + '...' : s.eval_summary}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
