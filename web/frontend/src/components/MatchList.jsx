import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trophy, Plus, Trash2, Clock, Timer, Zap, Award, Layers, CheckCircle, XCircle, RotateCcw, Search, X, CheckSquare, Square } from 'lucide-react'
import { listMatches, deleteMatch, createMatch, bulkDeleteMatches } from '../api'
import { useAdmin } from '../App'

function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function ScoreBadge({ value }) {
  if (value == null) return null
  const v = typeof value === 'number' ? value.toFixed(1) : value
  const n = parseFloat(v)
  const cls = n >= 4 ? 'high' : n >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{v}/5</span>
}

export default function MatchList() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [rerunning, setRerunning] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ringFilter, setRingFilter] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const navigate = useNavigate()
  const { admin } = useAdmin()

  const load = async () => {
    try {
      const data = await listMatches(100)
      setMatches(data.matches || [])
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const filtered = useMemo(() => {
    let result = matches
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        (m.id || '').toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') result = result.filter(m => m.status === statusFilter)
    if (ringFilter !== 'all') result = result.filter(m => (m.env_key || 'production') === ringFilter)
    return result
  }, [matches, search, statusFilter, ringFilter])

  const statuses = [...new Set(matches.map(m => m.status))]
  const rings = [...new Set(matches.map(m => m.env_key || 'production'))]

  const handleDelete = async (id) => {
    if (!confirm(`Delete match ${id} and all its rounds?`)) return
    try { await deleteMatch(id); load() } catch (e) { alert(e.message) }
  }

  const handleRerun = async (m) => {
    setRerunning(m.id)
    try {
      const res = await createMatch({
        category: m.category || null,
        maxTimeS: m.max_time_s || 600,
        evalModel: m.eval_model,
      })
      navigate(`/matches/${res.match_id}`)
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
    const deletable = filtered.filter(m => m.status !== 'running').map(m => m.id)
    if (deletable.every(id => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(deletable))
    }
  }

  const handleBulkDelete = async () => {
    const ids = [...selected].filter(id => {
      const m = matches.find(match => match.id === id)
      return m && m.status !== 'running'
    })
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} match(es) and all their rounds?`)) return
    setBulkDeleting(true)
    try {
      await bulkDeleteMatches(ids)
      setSelected(new Set())
      load()
    } catch (e) { alert(e.message) }
    finally { setBulkDeleting(false) }
  }

  const hasFilters = search || statusFilter !== 'all' || ringFilter !== 'all'
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setRingFilter('all') }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading matches...</div>

  return (
    <div>
      <div className="page-header">
        <h2><Trophy size={20} /> Matches</h2>
        <Link to="/"><button className="primary"><Plus size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />New Match</button></Link>
      </div>

      {/* Search & Filters */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '3 1 0' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by ID, name, category..."
              style={{ paddingLeft: '1.75rem', width: '100%', fontSize: '0.8rem' }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ fontSize: '0.75rem', padding: '0.35em 0.5em', flex: '1 1 0', minWidth: '90px' }}>
            <option value="all">All Status</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
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
          {filtered.length} of {matches.length} matches
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
          <Trophy size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <h3>{hasFilters ? 'No matching matches' : 'No matches yet'}</h3>
          <p>{hasFilters ? 'Try adjusting your filters.' : 'Run all fixed scenarios to create a match.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Select all header (admin only) */}
          {admin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '0.25rem' }}>
              <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', color: 'var(--text-secondary)' }}>
                {filtered.filter(m => m.status !== 'running').every(m => selected.has(m.id)) && filtered.length > 0
                  ? <CheckSquare size={16} style={{ color: 'var(--accent)' }} />
                  : <Square size={16} />
                }
              </button>
              <span>Select all</span>
            </div>
          )}
          {filtered.map(m => (
            <div key={m.id} className="card" style={{ padding: '1rem 1.25rem', marginBottom: 0 }}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                  {admin && (
                    <button onClick={() => toggleSelect(m.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: '0.1rem', display: 'flex', color: 'var(--text-secondary)' }}>
                      {selected.has(m.id)
                        ? <CheckSquare size={16} style={{ color: 'var(--accent)' }} />
                        : <Square size={16} />
                      }
                    </button>
                  )}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <Link to={`/matches/${m.id}`} style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        <Trophy size={12} style={{ marginRight: '0.2rem', verticalAlign: 'middle' }} />
                        {m.name || m.id}
                      </Link>
                      <span className={`badge ${m.status}`}>{m.status}</span>
                      {m.category && <span className="badge fixed">{m.category}</span>}
                      <span className={`badge ${m.env_key === 'staging' ? 'pending' : 'completed'}`} title="Ring">
                        {(m.env_key || 'production').replace(/^\w/, c => c.toUpperCase())}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {m.scenario_count} rounds
                      {m.pass_rate && <> — <strong style={{ color: 'var(--green)' }}>{m.pass_rate}</strong> passed</>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    <Clock size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />
                    {m.created_at ? new Date(m.created_at).toLocaleString() : '-'}
                  </span>
                  {m.status !== 'running' && (
                    <>
                      <button onClick={() => handleRerun(m)} disabled={rerunning === m.id} title="Rematch — new game, same settings" style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
                        {rerunning === m.id ? <span className="spinner" /> : <RotateCcw size={10} />}
                      </button>
                      {admin && (
                        <button className="danger" onClick={() => handleDelete(m.id)} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
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
                  <Layers size={12} style={{ color: 'var(--accent)' }} />
                  <strong>{m.sessions_completed || 0}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>/ {m.scenario_count} rounds</span>
                </div>

                {m.avg_ttfb_ms != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Timer size={12} style={{ color: 'var(--blue)' }} />
                    <span>TTFT: <strong>{formatMs(m.avg_ttfb_ms)}</strong></span>
                  </div>
                )}

                {m.avg_total_ms != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Zap size={12} style={{ color: 'var(--orange)' }} />
                    <span>Total: <strong>{formatMs(m.avg_total_ms)}</strong></span>
                  </div>
                )}

                {m.overall_score != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}>
                    <Award size={12} style={{ color: 'var(--green)' }} />
                    <ScoreBadge value={m.overall_score} />
                  </div>
                )}

                {m.started_at && m.ended_at && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    {((new Date(m.ended_at) - new Date(m.started_at)) / 1000).toFixed(0)}s duration
                  </div>
                )}

                {m.status === 'running' && (
                  <span className="loading-text" style={{ fontSize: '0.75rem' }}>
                    <span className="spinner" /> In the ring...
                  </span>
                )}
              </div>

              {/* Match evaluation summary */}
              {m.summary && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.5 }}>
                  {m.summary.length > 200 ? m.summary.slice(0, 200) + '...' : m.summary}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
