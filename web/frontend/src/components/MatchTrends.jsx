import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, Target, Brain, Shield, Star, Timer, Zap, Trophy, CheckCircle, ExternalLink, MessageSquare, AlertTriangle, ThumbsUp, ThumbsDown, Loader } from 'lucide-react'
import { getMatchTrends, analyzeMatchTrends, formatDt, formatDate } from '../api'
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
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  // Initial load to get available rings, then load for selected ring
  useEffect(() => {
    setLoading(true)
    setAnalysis(null)
    getMatchTrends(ring).then(d => {
      setData(d)
      if (!ring && d.rings?.length > 0) setRing(d.rings[0])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [ring])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalysis(null)
    try {
      const res = await analyzeMatchTrends(ring)
      setAnalysis(res.analysis)
    } catch (e) {
      setAnalysis({ executive_summary: 'Analysis failed: ' + e.message, overall_quality: 'ERROR' })
    } finally {
      setAnalyzing(false)
    }
  }

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
                    {formatDt(latest.created_at)}
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

          {/* Ask Joe Analysis */}
          <div className="card" style={{
            background: analysis ? 'var(--bg-card)' : 'linear-gradient(135deg, #1a2b3c, #2a3b4c)',
            color: analysis ? 'inherit' : 'white',
            padding: '1.25rem 1.5rem',
          }}>
            {!analysis && !analyzing && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <MessageSquare size={18} />
                    <h3 style={{ margin: 0, color: 'inherit' }}>Ask Joe</h3>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', opacity: 0.85 }}>
                    Get AI-powered quality analysis, trend insights, and release recommendation based on all {ring?.replace(/^\w/, c => c.toUpperCase())} match data.
                  </p>
                </div>
                <button
                  onClick={handleAnalyze}
                  style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.4)', color: 'white', whiteSpace: 'nowrap', padding: '0.6rem 1.25rem', fontSize: '0.9rem', fontWeight: 600 }}
                >
                  <MessageSquare size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Analyze
                </button>
              </div>
            )}
            {analyzing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                <span className="spinner" style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: '0.85rem' }}>Joe is analyzing {trends.length} matches across {categories.length} categories...</span>
              </div>
            )}
            {analysis && !analyzing && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <MessageSquare size={16} style={{ color: 'var(--accent)' }} />
                    <h3 style={{ margin: 0 }}>Joe's Quality Assessment</h3>
                    <span className={`badge ${analysis.overall_quality === 'PASS' ? 'completed' : analysis.overall_quality === 'CAUTION' ? 'pending' : 'error'}`} style={{ fontSize: '0.7rem' }}>
                      {analysis.overall_quality || 'UNKNOWN'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {analysis.release_recommendation && (
                      <span style={{
                        padding: '0.25rem 0.65rem', borderRadius: '16px', fontSize: '0.72rem', fontWeight: 700,
                        background: analysis.release_recommendation === 'GO' ? 'var(--green)' : analysis.release_recommendation === 'NO-GO' ? 'var(--red)' : 'var(--yellow)',
                        color: 'white',
                      }}>
                        {analysis.release_recommendation}
                      </span>
                    )}
                    <button onClick={handleAnalyze} style={{ fontSize: '0.72rem', padding: '0.25em 0.5em' }}>Re-analyze</button>
                  </div>
                </div>

                {/* Executive Summary */}
                <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '1rem', lineHeight: 1.5 }}>
                  {analysis.executive_summary}
                </div>

                <div className="grid grid-2" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
                  {/* Strengths */}
                  {analysis.strengths?.length > 0 && (
                    <div style={{ padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: '3px solid var(--green)' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--green)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <ThumbsUp size={12} /> Strengths
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {/* Weaknesses */}
                  {analysis.weaknesses?.length > 0 && (
                    <div style={{ padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: '3px solid var(--red)' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--red)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <ThumbsDown size={12} /> Weaknesses
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {analysis.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Trend + Latency */}
                {(analysis.trend_analysis || analysis.latency_assessment) && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {analysis.trend_analysis && (
                      <div style={{ flex: '1 1 250px', padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.25rem' }}>
                          <TrendingUp size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />Trend
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{analysis.trend_analysis}</div>
                      </div>
                    )}
                    {analysis.latency_assessment && (
                      <div style={{ flex: '1 1 250px', padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--blue)', marginBottom: '0.25rem' }}>
                          <Timer size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />Latency
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{analysis.latency_assessment}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Category Breakdown */}
                {analysis.category_breakdown && Object.keys(analysis.category_breakdown).length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>Category Breakdown</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {Object.entries(analysis.category_breakdown).map(([cat, text]) => (
                        <div key={cat} style={{ flex: '1 1 200px', padding: '0.5rem 0.65rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: `3px solid ${catColor(cat)}`, fontSize: '0.75rem' }}>
                          <strong style={{ textTransform: 'capitalize' }}>{cat}:</strong> <span style={{ color: 'var(--text-secondary)' }}>{text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations + Risks */}
                <div className="grid grid-2" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
                  {analysis.recommendations?.length > 0 && (
                    <div style={{ padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.35rem' }}>Recommendations</div>
                      <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {analysis.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                      </ol>
                    </div>
                  )}
                  {analysis.risk_factors?.length > 0 && (
                    <div style={{ padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: '3px solid var(--yellow)' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--yellow)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertTriangle size={12} /> Risk Factors
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {analysis.risk_factors.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Release Notes */}
                {analysis.release_notes && (
                  <div style={{ padding: '0.65rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    <strong style={{ fontStyle: 'normal', color: 'var(--text-primary)' }}>Release Note:</strong> {analysis.release_notes}
                  </div>
                )}
              </div>
            )}
          </div>

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
                      {formatDate(t.created_at)}
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
