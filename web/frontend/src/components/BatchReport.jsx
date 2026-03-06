import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle, XCircle, Clock, Layers, BarChart3, AlertTriangle, ExternalLink } from 'lucide-react'
import { getBatchReport } from '../api'

function ScoreDisplay({ value, max = 5 }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  const v = typeof value === 'number' ? value.toFixed(1) : value
  const n = parseFloat(v)
  const cls = n >= 4 ? 'high' : n >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{v}/{max}</span>
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function BatchReport() {
  const { batchId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      const d = await getBatchReport(batchId)
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [batchId])

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading batch report...</div>
  if (error) return <div className="empty"><AlertTriangle size={30} style={{ marginBottom: '0.5rem' }} /><p>{error}</p></div>
  if (!data) return <div className="empty">Batch not found</div>

  const { summary, latency, by_category, scenarios } = data
  const isRunning = data.status === 'running'
  const passedCount = scenarios.filter(s => s.passed).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>
            <Layers size={20} style={{ marginRight: '0.25rem' }} />
            Batch Run {batchId}
            <span className={`badge ${isRunning ? 'running' : 'completed'}`} style={{ marginLeft: '0.75rem', verticalAlign: 'middle' }}>
              {isRunning ? 'running' : 'completed'}
            </span>
          </h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {summary.total} scenarios — {summary.pass_rate} passed
            {isRunning && <span className="spinner" style={{ marginLeft: '0.5rem' }} />}
          </div>
        </div>
        <Link to="/"><button><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />Back</button></Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-4">
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Layers size={18} style={{ color: 'var(--accent)' }} />
            {summary.total}
          </div>
          <div className="stat-label">Total Scenarios</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--green)' }}>
            <CheckCircle size={18} />
            {passedCount}
          </div>
          <div className="stat-label">Passed</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Clock size={18} style={{ color: 'var(--blue)' }} />
            {formatMs(latency.avg_ttfb)}
          </div>
          <div className="stat-label">Avg TTFB</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <BarChart3 size={18} style={{ color: 'var(--orange)' }} />
            {formatMs(latency.avg_total)}
          </div>
          <div className="stat-label">Avg Response</div>
        </div>
      </div>

      {/* Category breakdown */}
      {Object.keys(by_category).length > 0 && (
        <div className="card">
          <h3>Results by Category</h3>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(Object.keys(by_category).length, 4)}, 1fr)` }}>
            {Object.entries(by_category).map(([cat, stats]) => (
              <div key={cat} style={{ textAlign: 'center', padding: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{cat}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: stats.failed > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {stats.passed}/{stats.total}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>passed</div>
                {stats.failed > 0 && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--red)', marginTop: '0.15rem' }}>
                    {stats.failed} failed
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scenario results table */}
      <div className="card table-wrap">
        <h3>Scenario Results</h3>
        <table>
          <thead>
            <tr>
              <th>Result</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Turns</th>
              <th>Avg TTFB</th>
              <th>Avg Total</th>
              <th>Score</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map(s => (
              <tr key={s.session_id}>
                <td>
                  {s.passed
                    ? <CheckCircle size={16} style={{ color: 'var(--green)' }} />
                    : <XCircle size={16} style={{ color: 'var(--red)' }} />
                  }
                </td>
                <td style={{ fontWeight: 500 }}>{s.scenario_id}</td>
                <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                <td>{s.turns}</td>
                <td>{formatMs(s.avg_ttfb)}</td>
                <td>{formatMs(s.avg_total)}</td>
                <td>
                  {s.evaluation
                    ? <ScoreDisplay value={s.evaluation.overall_score} />
                    : (s.status === 'running' ? <span className="spinner" /> : '-')
                  }
                </td>
                <td>
                  <Link to={`/sessions/${s.session_id}`} className="clickable">
                    <ExternalLink size={11} style={{ marginRight: '0.15rem', verticalAlign: 'middle' }} />
                    {s.session_id}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
