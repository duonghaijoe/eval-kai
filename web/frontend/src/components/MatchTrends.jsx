import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, Target, Brain, Shield, Star, Timer, Zap, Trophy, CheckCircle, ExternalLink } from 'lucide-react'
import { getMatchTrends } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts'

const CAT_COLORS = {
  happy: '#16a34a',
  functional: '#2563eb',
  edge: '#ea580c',
  guardrails: '#dc2626',
  'multi-turn': '#8b5cf6',
  stress: '#ca8a04',
  other: '#6b7280',
}

function catColor(cat) {
  return CAT_COLORS[cat] || CAT_COLORS.other
}

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

export default function MatchTrends() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ring, setRing] = useState(null)

  // Initial load to get available rings, then load for selected ring
  useEffect(() => {
    setLoading(true)
    getMatchTrends(ring).then(d => {
      setData(d)
      if (!ring && d.rings?.length > 0) setRing(d.rings[0])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [ring])

  const trends = useMemo(() => data?.trends || [], [data])
  const categories = useMemo(() => data?.categories || [], [data])
  const rings = useMemo(() => data?.rings || [], [data])

  // Score trend: x=match, y=avg_score per category
  const scoreTrendData = useMemo(() => {
    return trends.map((t, i) => {
      const row = { index: i, label: t.match_name, match_id: t.match_id, date: t.created_at }
      categories.forEach(cat => {
        const c = t.categories[cat]
        row[cat] = c?.avg_score ?? null
      })
      return row
    })
  }, [trends, categories])

  // Pass rate trend
  const passRateTrendData = useMemo(() => {
    return trends.map((t, i) => {
      const row = { index: i, label: t.match_name, match_id: t.match_id }
      categories.forEach(cat => {
        const c = t.categories[cat]
        row[cat] = c ? Math.round(c.pass_rate * 100) : null
      })
      return row
    })
  }, [trends, categories])

  // TTFT trend
  const ttftTrendData = useMemo(() => {
    return trends.map((t, i) => {
      const row = { index: i, label: t.match_name, match_id: t.match_id }
      categories.forEach(cat => {
        const c = t.categories[cat]
        row[cat] = c?.avg_ttfb_ms || null
      })
      return row
    })
  }, [trends, categories])

  // Response time trend
  const totalTrendData = useMemo(() => {
    return trends.map((t, i) => {
      const row = { index: i, label: t.match_name, match_id: t.match_id }
      categories.forEach(cat => {
        const c = t.categories[cat]
        row[cat] = c?.avg_total_ms || null
      })
      return row
    })
  }, [trends, categories])

  // Latest match radar data (per-dimension scores by category)
  const radarData = useMemo(() => {
    if (!trends.length) return []
    const latest = trends[trends.length - 1]
    return categories.map(cat => {
      const c = latest.categories[cat]
      return {
        category: cat,
        Goal: c?.avg_goal ?? 0,
        Context: c?.avg_context ?? 0,
        Quality: c?.avg_quality ?? 0,
        Overall: c?.avg_score ?? 0,
      }
    })
  }, [trends, categories])

  // Dimension trends (Goal, Context, Quality per category over time)
  const dimensionTrendData = useMemo(() => {
    return trends.map((t, i) => {
      const row = { index: i, label: t.match_name }
      categories.forEach(cat => {
        const c = t.categories[cat]
        row[`${cat}_goal`] = c?.avg_goal ?? null
        row[`${cat}_context`] = c?.avg_context ?? null
        row[`${cat}_quality`] = c?.avg_quality ?? null
      })
      return row
    })
  }, [trends, categories])

  const tooltipStyle = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.78rem' }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading match trends...</div>

  return (
    <div>
      <div className="page-header">
        <h2><TrendingUp size={20} /> Match Analysis</h2>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Track Kai's quality regression across fixed-scenario matches over time. Each data point is one match run.
      </div>

      {/* Ring selector */}
      {rings.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {rings.map(r => (
            <button
              key={r}
              onClick={() => setRing(r)}
              style={{ fontSize: '0.75rem', padding: '0.3em 0.75em', borderRadius: '16px', border: ring === r ? 'none' : '1px solid var(--border)', background: ring === r ? (r === 'production' ? 'var(--green)' : 'var(--orange)') : 'var(--bg-card)', color: ring === r ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
            >
              {r.replace(/^\w/, c => c.toUpperCase())} Ring
            </button>
          ))}
        </div>
      )}

      {trends.length === 0 ? (
        <div className="empty">
          <TrendingUp size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <h3>No match data yet</h3>
          <p>Run fixed-scenario matches to see regression trends here.</p>
        </div>
      ) : (
        <>
          {/* Summary: latest match stats */}
          {(() => {
            const latest = trends[trends.length - 1]
            return (
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Trophy size={14} />
                  Latest: {latest.match_name}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {latest.created_at ? new Date(latest.created_at).toLocaleString() : ''}
                  </span>
                </h3>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {categories.map(cat => {
                    const c = latest.categories[cat]
                    if (!c) return null
                    return (
                      <div key={cat} style={{ flex: '1 1 120px', padding: '0.5rem 0.65rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: `3px solid ${catColor(cat)}` }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', textTransform: 'capitalize', marginBottom: '0.25rem' }}>{cat}</div>
                        <div style={{ display: 'flex', gap: '0.6rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          <span><Star size={10} style={{ verticalAlign: 'middle' }} /> <ScoreDisplay value={c.avg_score} /></span>
                          <span style={{ color: c.pass_rate >= 1 ? 'var(--green)' : 'var(--red)' }}><CheckCircle size={10} style={{ verticalAlign: 'middle' }} /> {Math.round(c.pass_rate * 100)}%</span>
                          <span><Timer size={10} style={{ verticalAlign: 'middle' }} /> {formatMs(c.avg_ttfb_ms)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Row 1: Score + Pass Rate */}
          <div className="grid grid-2">
            <div className="card">
              <h3><Star size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Overall Score Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={scoreTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 5]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={cat} stroke={catColor(cat)} name={cat} strokeWidth={2} dot={{ r: 4 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3><CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Pass Rate Trend (%)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={passRateTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={cat} stroke={catColor(cat)} name={cat} strokeWidth={2} dot={{ r: 4 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 2: TTFT + Response Time */}
          <div className="grid grid-2">
            <div className="card">
              <h3><Timer size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />TTFT Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={ttftTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} unit="ms" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Math.round(v)}ms`} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={cat} stroke={catColor(cat)} name={cat} strokeWidth={2} dot={{ r: 4 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3><Zap size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Response Time Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={totalTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} unit="ms" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Math.round(v)}ms`} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={cat} stroke={catColor(cat)} name={cat} strokeWidth={2} dot={{ r: 4 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 3: Per-dimension breakdown */}
          <div className="grid grid-2">
            {/* Goal Achievement trend per category */}
            <div className="card">
              <h3><Target size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Goal Achievement by Category</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dimensionTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 5]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={`${cat}_goal`} stroke={catColor(cat)} name={`${cat} goal`} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Context + Quality stacked comparison */}
            <div className="card">
              <h3><Brain size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Context Retention by Category</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dimensionTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 5]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={`${cat}_context`} stroke={catColor(cat)} name={`${cat} context`} strokeWidth={2} dot={{ r: 3 }} connectNulls strokeDasharray="5 3" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 4: Latest radar + quality trend */}
          <div className="grid grid-2">
            {radarData.length > 0 && (
              <div className="card">
                <h3><Shield size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Latest Match — Quality Profile</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                    <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 10 }} />
                    <Radar name="Goal" dataKey="Goal" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} />
                    <Radar name="Context" dataKey="Context" stroke="var(--blue)" fill="var(--blue)" fillOpacity={0.1} />
                    <Radar name="Quality" dataKey="Quality" stroke="var(--green)" fill="var(--green)" fillOpacity={0.1} />
                    <Radar name="Overall" dataKey="Overall" stroke="var(--yellow)" fill="var(--yellow)" fillOpacity={0.1} />
                    <Legend />
                    <Tooltip contentStyle={tooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="card">
              <h3><Shield size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Response Quality by Category</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dimensionTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 5]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  {categories.map(cat => (
                    <Line key={cat} type="monotone" dataKey={`${cat}_quality`} stroke={catColor(cat)} name={`${cat} quality`} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Match history table */}
          <div className="card table-wrap">
            <h3>Match History</h3>
            <table>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Pass Rate</th>
                  {categories.map(cat => (
                    <th key={cat} style={{ textTransform: 'capitalize' }}>{cat}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...trends].reverse().map(t => (
                  <tr key={t.match_id}>
                    <td>
                      <Link to={`/matches/${t.match_id}`} className="clickable">
                        <ExternalLink size={10} style={{ marginRight: '0.15rem', verticalAlign: 'middle' }} />
                        {t.match_name}
                      </Link>
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}
                    </td>
                    <td><ScoreDisplay value={t.overall_score} /></td>
                    <td style={{ fontWeight: 600, color: 'var(--green)' }}>{t.pass_rate || '-'}</td>
                    {categories.map(cat => {
                      const c = t.categories[cat]
                      return (
                        <td key={cat}>
                          {c ? (
                            <div style={{ fontSize: '0.7rem' }}>
                              <ScoreDisplay value={c.avg_score} />
                              <span style={{ color: c.pass_rate >= 1 ? 'var(--green)' : 'var(--red)', marginLeft: '0.3rem' }}>
                                {Math.round(c.pass_rate * 100)}%
                              </span>
                            </div>
                          ) : '-'}
                        </td>
                      )
                    })}
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
