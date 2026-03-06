import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Plus, Trash2, Clock, Timer, Zap, Award, Layers, CheckCircle, XCircle } from 'lucide-react'
import { listMatches, deleteMatch } from '../api'

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

  const load = async () => {
    try {
      const data = await listMatches(50)
      setMatches(data.matches || [])
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleDelete = async (id) => {
    if (!confirm(`Delete match ${id} and all its rounds?`)) return
    try { await deleteMatch(id); load() } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading matches...</div>

  return (
    <div>
      <div className="page-header">
        <h2><Trophy size={20} /> Matches</h2>
        <Link to="/"><button className="primary"><Plus size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />New Match</button></Link>
      </div>

      {matches.length === 0 ? (
        <div className="empty">
          <Trophy size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <h3>No matches yet</h3>
          <p>Run all fixed scenarios to create a match.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {matches.map(m => (
            <div key={m.id} className="card" style={{ padding: '1rem 1.25rem', marginBottom: 0 }}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    <Clock size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />
                    {m.created_at ? new Date(m.created_at).toLocaleString() : '-'}
                  </span>
                  {m.status !== 'running' && (
                    <button className="danger" onClick={() => handleDelete(m.id)} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
                      <Trash2 size={10} />
                    </button>
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
                    <span>TTFB: <strong>{formatMs(m.avg_ttfb_ms)}</strong></span>
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
