import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, TrendingUp, Clock, CheckCircle, Target, Brain, Shield, Star, Activity, ExternalLink, Timer, Zap, Filter } from 'lucide-react'
import { getReports } from '../api'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts'

function ScoreDisplay({ value, max = 5 }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  const v = typeof value === 'number' ? value.toFixed(1) : value
  const n = parseFloat(v)
  const cls = n >= 4 ? 'high' : n >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{v}/{max}</span>
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  return `${Math.round(ms)}ms`
}

export default function Reports() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ringFilter, setRingFilter] = useState('all')

  useEffect(() => {
    getReports().then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading reports...</div>
  if (!data) return <div className="empty">Failed to load reports</div>

  const allSessions = data.sessions || []
  const byRing = data.by_ring || []
  const rings = [...new Set(allSessions.map(s => s.env_key || 'production'))]

  const sessions = ringFilter === 'all' ? allSessions : allSessions.filter(s => (s.env_key || 'production') === ringFilter)
  const latency = data.latency || {}
  const byMode = data.by_mode || []
  const evals = data.evaluations || {}
  const trend = (data.latency_trend || []).reverse()

  const completedSessions = sessions.filter(s => s.status === 'completed')
  const errorSessions = sessions.filter(s => s.status === 'error')

  const modeChartData = byMode.map(m => ({
    mode: m.actor_mode,
    'Avg TTFB': Math.round(m.avg_ttfb_ms || 0),
    'Avg Total': Math.round(m.avg_total_ms || 0),
    sessions: m.session_count,
  }))

  const trendData = trend.map((t, i) => ({
    index: i,
    ttfb: Math.round(t.ttfb_ms || 0),
    total: Math.round(t.total_ms || 0),
    session: t.session_id,
    turn: t.turn_number,
  }))

  return (
    <div>
      <div className="page-header">
        <h2><BarChart3 size={20} /> Fight Record</h2>
      </div>

      {/* Ring filter tabs */}
      {rings.length > 1 && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button
            className={ringFilter === 'all' ? 'primary' : ''}
            onClick={() => setRingFilter('all')}
            style={{ fontSize: '0.75rem', padding: '0.3em 0.75em', borderRadius: '16px', border: ringFilter === 'all' ? 'none' : '1px solid var(--border)', background: ringFilter === 'all' ? 'var(--katalon-teal)' : 'var(--bg-card)', color: ringFilter === 'all' ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
          >
            All Rings
          </button>
          {rings.map(r => (
            <button
              key={r}
              className={ringFilter === r ? 'primary' : ''}
              onClick={() => setRingFilter(r)}
              style={{ fontSize: '0.75rem', padding: '0.3em 0.75em', borderRadius: '16px', border: ringFilter === r ? 'none' : '1px solid var(--border)', background: ringFilter === r ? 'var(--katalon-teal)' : 'var(--bg-card)', color: ringFilter === r ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
            >
              {r.replace(/^\w/, c => c.toUpperCase())} Ring
            </button>
          ))}
        </div>
      )}

      {/* Per-ring summary */}
      {ringFilter === 'all' && byRing.length > 1 && (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(byRing.length, 4)}, 1fr)`, marginBottom: '1rem' }}>
          {byRing.map(r => (
            <div key={r.env_key} className="card" style={{ borderLeft: `3px solid ${r.env_key === 'production' ? 'var(--green)' : 'var(--orange)'}` }}>
              <h3 style={{ textTransform: 'capitalize' }}>{r.env_key} Ring</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem' }}>
                <div><strong>{r.session_count}</strong> rounds — <span style={{ color: 'var(--green)' }}>{r.completed}</span> won, <span style={{ color: 'var(--red)' }}>{r.errors}</span> lost</div>
                {r.avg_ttfb_ms && <div style={{ color: 'var(--text-secondary)' }}>TTFB: {formatMs(r.avg_ttfb_ms)} — Total: {formatMs(r.avg_total_ms)}</div>}
                {r.avg_score != null && <div>Score: <ScoreDisplay value={r.avg_score} /></div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="empty">
          <BarChart3 size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <h3>No data yet</h3>
          <p>Run some rounds to see fight stats here.</p>
        </div>
      ) : (
        <>
          {/* Overview stats */}
          <div className="grid grid-4">
            <div className="card">
              <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Activity size={18} style={{ color: 'var(--accent)' }} />
                {sessions.length}
              </div>
              <div className="stat-label">Total Rounds</div>
            </div>
            <div className="card">
              <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--green)' }}>
                <CheckCircle size={18} />
                {completedSessions.length}
              </div>
              <div className="stat-label">Completed</div>
            </div>
            <div className="card">
              <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Timer size={18} style={{ color: 'var(--blue)' }} />
                {formatMs(latency.avg_ttfb)}
              </div>
              <div className="stat-label">Avg TTFB</div>
            </div>
            <div className="card">
              <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Zap size={18} style={{ color: 'var(--orange)' }} />
                {formatMs(latency.avg_total)}
              </div>
              <div className="stat-label">Avg Response Time</div>
            </div>
          </div>

          {/* Evaluation averages */}
          {(evals.avg_goal || evals.avg_overall) && (
            <div className="card">
              <h3><Star size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Average Quality Scores</h3>
              <div className="grid grid-4" style={{ textAlign: 'center' }}>
                <div>
                  <Target size={16} style={{ color: 'var(--accent)', marginBottom: '0.25rem' }} />
                  <div style={{ fontSize: '1.25rem' }}><ScoreDisplay value={evals.avg_goal} /></div>
                  <div className="stat-label">Goal Achievement</div>
                </div>
                <div>
                  <Brain size={16} style={{ color: 'var(--blue)', marginBottom: '0.25rem' }} />
                  <div style={{ fontSize: '1.25rem' }}><ScoreDisplay value={evals.avg_context} /></div>
                  <div className="stat-label">Context Retention</div>
                </div>
                <div>
                  <Shield size={16} style={{ color: 'var(--green)', marginBottom: '0.25rem' }} />
                  <div style={{ fontSize: '1.25rem' }}><ScoreDisplay value={evals.avg_quality} /></div>
                  <div className="stat-label">Response Quality</div>
                </div>
                <div>
                  <Star size={16} style={{ color: 'var(--yellow)', marginBottom: '0.25rem' }} />
                  <div style={{ fontSize: '1.25rem' }}><ScoreDisplay value={evals.avg_overall} /></div>
                  <div className="stat-label">Overall</div>
                </div>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-2">
            {modeChartData.length > 0 && (
              <div className="card">
                <h3><BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Latency by Mode</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={modeChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="mode" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} unit="ms" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.8rem' }}
                    />
                    <Legend />
                    <Bar dataKey="Avg TTFB" fill="var(--blue)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Avg Total" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {trendData.length > 0 && (
              <div className="card">
                <h3><TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Latency Trend (last 100 exchanges)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="index" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} unit="ms" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.8rem' }}
                      labelFormatter={(i) => {
                        const t = trendData[i]
                        return t ? `Round ${t.session} Exchange ${t.turn}` : ''
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="ttfb" stroke="var(--blue)" name="TTFB" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="total" stroke="var(--accent)" name="Total" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Latency breakdown */}
          <div className="card">
            <h3><Clock size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Latency Breakdown</h3>
            <div className="grid grid-3" style={{ textAlign: 'center' }}>
              <div>
                <div className="stat-label">TTFB Range</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {formatMs(latency.min_ttfb)} — {formatMs(latency.max_ttfb)}
                </div>
              </div>
              <div>
                <div className="stat-label">Response Range</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {formatMs(latency.min_total)} — {formatMs(latency.max_total)}
                </div>
              </div>
              <div>
                <div className="stat-label">Avg Polls/Exchange</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {latency.avg_polls ? latency.avg_polls.toFixed(1) : '-'}
                </div>
              </div>
            </div>
          </div>

          {/* Sessions table */}
          <div className="card table-wrap">
            <h3>All Rounds</h3>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Ring</th>
                  <th>Mode</th>
                  <th>Goal</th>
                  <th>Status</th>
                  <th>Exchanges</th>
                  <th>Duration</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/sessions/${s.id}`} className="clickable">
                        <ExternalLink size={11} style={{ marginRight: '0.2rem', verticalAlign: 'middle' }} />
                        {s.id}
                      </Link>
                    </td>
                    <td><span className={`badge ${s.env_key === 'staging' ? 'pending' : 'completed'}`} style={{ fontSize: '0.6rem' }}>{(s.env_key || 'production').replace(/^\w/, c => c.toUpperCase())}</span></td>
                    <td><span className={`badge ${s.actor_mode}`}>{s.actor_mode}</span></td>
                    <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.goal || s.scenario_id || '-'}
                    </td>
                    <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                    <td>{s.max_turns}</td>
                    <td style={{ fontSize: '0.75rem' }}>
                      {s.started_at && s.ended_at
                        ? `${((new Date(s.ended_at) - new Date(s.started_at)) / 1000).toFixed(0)}s`
                        : s.status === 'running' ? <span className="spinner" /> : '-'
                      }
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
