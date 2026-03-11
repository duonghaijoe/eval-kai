import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trophy, Plus, Trash2, Clock, Timer, Zap, Award, Layers, CheckCircle, XCircle, RotateCcw, Search, X, CheckSquare, Square, BookOpen } from 'lucide-react'
import { listMatches, deleteMatch, createMatch, bulkDeleteMatches, deleteMatchesByDate, formatDt, formatMs, formatSec } from '../api'
import { useAdmin } from '../AdminContext'
import ConfirmModal from './ConfirmModal'

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
  const [modal, setModal] = useState({ open: false, type: null, data: null })
  const [resultMsg, setResultMsg] = useState(null)
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

  const handleDelete = (id) => {
    setModal({ open: true, type: 'delete', data: { id } })
  }
  const confirmDelete = async () => {
    const { id } = modal.data
    setModal({ open: false })
    try { await deleteMatch(id); load() } catch (e) { setResultMsg({ type: 'error', text: e.message }) }
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
    } catch (e) { setResultMsg({ type: 'error', text: 'Rematch failed: ' + e.message }) }
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

  const handleBulkDelete = () => {
    const ids = [...selected].filter(id => {
      const m = matches.find(match => match.id === id)
      return m && m.status !== 'running'
    })
    if (!ids.length) return
    setModal({ open: true, type: 'bulk', data: { ids } })
  }
  const confirmBulkDelete = async () => {
    const { ids } = modal.data
    setModal({ open: false })
    setBulkDeleting(true)
    try {
      await bulkDeleteMatches(ids)
      setSelected(new Set())
      load()
    } catch (e) { setResultMsg({ type: 'error', text: e.message }) }
    finally { setBulkDeleting(false) }
  }

  // Date-range delete
  const [showDateDelete, setShowDateDelete] = useState(false)
  const [dateDeleteMode, setDateDeleteMode] = useState('older') // older | range
  const [olderDays, setOlderDays] = useState(30)
  const [customDays, setCustomDays] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dateDeleting, setDateDeleting] = useState(false)

  const effectiveDays = olderDays === 'custom' ? (parseInt(customDays) || 0) : olderDays

  const handleDateDelete = () => {
    let desc = ''
    if (dateDeleteMode === 'older') {
      if (!effectiveDays || effectiveDays <= 0) return setResultMsg({ type: 'error', text: 'Enter a valid number of days' })
      desc = `older than ${effectiveDays} days`
    } else {
      if (!dateFrom && !dateTo) return setResultMsg({ type: 'error', text: 'Set at least one date' })
      desc = `${dateFrom || 'any'} to ${dateTo || 'any'}`
    }
    setModal({ open: true, type: 'dateDelete', data: { desc } })
  }
  const confirmDateDelete = async () => {
    setModal({ open: false })
    let params = {}
    if (dateDeleteMode === 'older') {
      params = { older_than_days: effectiveDays }
    } else {
      params = { after: dateFrom || undefined, before: dateTo ? dateTo + 'T23:59:59' : undefined }
    }
    setDateDeleting(true)
    try {
      const result = await deleteMatchesByDate(params)
      setShowDateDelete(false)
      load()
      setResultMsg({ type: 'success', text: `Deleted ${result.count} match(es).` })
    } catch (e) { setResultMsg({ type: 'error', text: e.message }) }
    finally { setDateDeleting(false) }
  }

  const hasFilters = search || statusFilter !== 'all' || ringFilter !== 'all'
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setRingFilter('all') }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading matches...</div>

  return (
    <div>
      {/* Result message banner */}
      {resultMsg && (
        <div style={{
          padding: '0.5rem 1rem', marginBottom: '0.75rem', borderRadius: 'var(--radius)',
          fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: resultMsg.type === 'error' ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.08)',
          border: `1px solid ${resultMsg.type === 'error' ? 'rgba(220,38,38,0.2)' : 'rgba(22,163,74,0.2)'}`,
          color: resultMsg.type === 'error' ? 'var(--red)' : 'var(--green)',
        }}>
          <span>{resultMsg.text}</span>
          <button onClick={() => setResultMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* Confirm modals */}
      <ConfirmModal
        open={modal.open && modal.type === 'delete'}
        title="Delete Match"
        message={`Delete match ${modal.data?.id} and all its rounds? This cannot be undone.`}
        danger
        confirmText="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setModal({ open: false })}
      />
      <ConfirmModal
        open={modal.open && modal.type === 'bulk'}
        title="Delete Matches"
        message={`Delete ${modal.data?.ids?.length} match(es) and all their rounds?`}
        warning="This action cannot be undone."
        danger
        confirmText="Delete All"
        onConfirm={confirmBulkDelete}
        onCancel={() => setModal({ open: false })}
      />
      <ConfirmModal
        open={modal.open && modal.type === 'dateDelete'}
        title="Cleanup Match History"
        message={`Delete all non-running matches ${modal.data?.desc}?`}
        warning="Running matches are always protected. This action cannot be undone."
        danger
        confirmText="Delete Matches"
        onConfirm={confirmDateDelete}
        onCancel={() => setModal({ open: false })}
      />

      <div className="page-header">
        <h2><Trophy size={20} /> Matches</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Link to="/guideline#fight-modes" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'none' }}>
            <BookOpen size={13} /> Fight Manual
          </Link>
          <Link to="/"><button className="primary"><Plus size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />New Match</button></Link>
        </div>
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
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
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
          {admin && (
            <button onClick={() => setShowDateDelete(!showDateDelete)}
              style={{ fontSize: '0.65rem', padding: '0.2em 0.5em', display: 'flex', alignItems: 'center', gap: '0.2rem', color: 'var(--red)' }}>
              <Clock size={10} /> Cleanup by Date
            </button>
          )}
        </div>

        {/* Date-range delete panel */}
        {showDateDelete && admin && (
          <div style={{
            marginTop: '0.6rem', padding: '0.6rem', background: 'rgba(220,38,38,0.04)',
            border: '1px solid rgba(220,38,38,0.15)', borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Trash2 size={12} /> Cleanup Match History
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <button className={dateDeleteMode === 'older' ? 'primary' : ''} onClick={() => setDateDeleteMode('older')}
                style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>Older than</button>
              <button className={dateDeleteMode === 'range' ? 'primary' : ''} onClick={() => setDateDeleteMode('range')}
                style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>Date Range</button>
            </div>
            {dateDeleteMode === 'older' ? (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem' }}>Delete matches older than</span>
                <select value={olderDays} onChange={e => setOlderDays(e.target.value === 'custom' ? 'custom' : +e.target.value)}
                  style={{ fontSize: '0.75rem', padding: '0.2em 0.4em', width: 90 }}>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value="custom">Custom...</option>
                </select>
                {olderDays === 'custom' && (
                  <input type="number" min="1" value={customDays} onChange={e => setCustomDays(e.target.value)}
                    placeholder="days" style={{ fontSize: '0.75rem', padding: '0.2em 0.4em', width: 60 }} />
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem' }}>From</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={{ fontSize: '0.72rem', padding: '0.2em 0.4em' }} />
                <span style={{ fontSize: '0.75rem' }}>to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={{ fontSize: '0.72rem', padding: '0.2em 0.4em' }} />
              </div>
            )}
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem' }}>
              <button onClick={handleDateDelete} disabled={dateDeleting} className="danger"
                style={{ fontSize: '0.7rem', padding: '0.25em 0.6em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                {dateDeleting ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Deleting...</> : <><Trash2 size={11} /> Delete Matches</>}
              </button>
              <button onClick={() => setShowDateDelete(false)}
                style={{ fontSize: '0.7rem', padding: '0.25em 0.6em' }}>Cancel</button>
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Running matches are always protected. This action cannot be undone.
            </div>
          </div>
        )}
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
                    {formatDt(m.created_at)}
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
                    {formatSec((new Date(m.ended_at) - new Date(m.started_at)) / 1000)} duration
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
