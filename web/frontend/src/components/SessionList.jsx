import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { List, Plus, Trash2, Clock, Timer, Zap, Award, Activity, ExternalLink, Trophy } from 'lucide-react'
import { listSessions, deleteSession } from '../api'

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

export default function SessionList() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const data = await listSessions(100)
      setSessions(data.sessions || [])
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleDelete = async (id) => {
    if (!confirm(`Delete round ${id}?`)) return
    try { await deleteSession(id); load() } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading rounds...</div>

  return (
    <div>
      <div className="page-header">
        <h2><List size={20} /> Rounds</h2>
        <Link to="/"><button className="primary"><Plus size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />New Round</button></Link>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">
          <List size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <h3>No rounds yet</h3>
          <p>Start a new match or round to see results here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {sessions.map(s => (
            <div key={s.id} className="card" style={{ padding: '1rem 1.25rem', marginBottom: 0 }}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    <Clock size={10} style={{ verticalAlign: 'middle', marginRight: '0.15rem' }} />
                    {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                  </span>
                  {s.status !== 'running' && (
                    <button className="danger" onClick={() => handleDelete(s.id)} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em' }}>
                      <Trash2 size={10} />
                    </button>
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
                  <span>TTFB: <strong>{formatMs(s.avg_ttfb_ms)}</strong></span>
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
                    {((new Date(s.ended_at) - new Date(s.started_at)) / 1000).toFixed(0)}s duration
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
