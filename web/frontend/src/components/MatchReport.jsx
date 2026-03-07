import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle, XCircle, Clock, Layers, BarChart3, AlertTriangle, ExternalLink, Award, Trophy, Target, Brain, Shield, Star, RotateCcw } from 'lucide-react'
import { getMatchReport, createMatch } from '../api'

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

export default function MatchReport() {
  const { matchId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rerunning, setRematchning] = useState(false)
  const navigate = useNavigate()

  const load = async () => {
    try {
      const d = await getMatchReport(matchId)
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
  }, [matchId])

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading match report...</div>
  if (error) return <div className="empty"><AlertTriangle size={30} style={{ marginBottom: '0.5rem' }} /><p>{error}</p></div>
  if (!data) return <div className="empty">Match not found</div>

  const { match, summary, latency, by_category, scenarios } = data
  const isRunning = data.status === 'running'
  const isDone = !isRunning && (match?.status === 'completed' || match?.status === 'error')
  const passedCount = scenarios.filter(s => s.passed).length

  const handleRematch = async () => {
    setRematchning(true)
    try {
      const res = await createMatch({
        category: match?.category || null,
        maxTimeS: match?.max_time_s || 600,
        evalModel: match?.eval_model,
      })
      navigate(`/matches/${res.match_id}`)
    } catch (e) { alert('Rematch failed: ' + e.message) }
    finally { setRematchning(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>
            <Trophy size={20} style={{ marginRight: '0.25rem' }} />
            Match: {match?.name || matchId}
            <span className={`badge ${isRunning ? 'running' : match?.status || 'completed'}`} style={{ marginLeft: '0.75rem', verticalAlign: 'middle' }}>
              {isRunning ? 'running' : match?.status || 'completed'}
            </span>
          </h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {summary.total} rounds — {summary.pass_rate || `${passedCount}/${summary.total}`} passed
            {match?.category && <> — category: <strong>{match.category}</strong></>}
            {isRunning && <span className="spinner" style={{ marginLeft: '0.5rem' }} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {isDone && (
            <button onClick={handleRematch} disabled={rerunning} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              {rerunning ? <span className="spinner" /> : <RotateCcw size={14} />}
              Rematch
            </button>
          )}
          <Link to="/matches"><button><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />Back</button></Link>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-4">
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Layers size={18} style={{ color: 'var(--accent)' }} />
            {summary.total}
          </div>
          <div className="stat-label">Total Rounds</div>
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
          <div className="stat-label">Avg TTFT</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <BarChart3 size={18} style={{ color: 'var(--orange)' }} />
            {formatMs(latency.avg_total)}
          </div>
          <div className="stat-label">Avg Response</div>
        </div>
      </div>

      {/* Match-level evaluation */}
      {match?.overall_score != null && (
        <div className="card">
          <h3><Award size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Match Verdict</h3>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Overall Score</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700 }}><ScoreDisplay value={match.overall_score} /></div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pass Rate</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--green)' }}>{match.pass_rate}</div>
            </div>
          </div>
          {match.summary && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {match.summary}
            </div>
          )}
          {match.issues && match.issues.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Issues Found</div>
              {match.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: '0.78rem', color: 'var(--red)', marginBottom: '0.15rem' }}>
                  • {issue}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        <h3>Round Results</h3>
        <table>
          <thead>
            <tr>
              <th>Result</th>
              <th>Scenario</th>
              <th>Status</th>
              <th>Exchanges</th>
              <th>Avg TTFT</th>
              <th>Avg Total</th>
              <th>Score</th>
              <th>Round</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map(s => (
              <tr key={s.session_id}>
                <td>
                  {s.status === 'running'
                    ? <span className="spinner" />
                    : s.passed
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

      {/* Per-session evaluation details */}
      {scenarios.some(s => s.evaluation) && (
        <div className="card">
          <h3>Per-Round Scorecards</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {scenarios.filter(s => s.evaluation).map(s => (
              <div key={s.session_id} style={{ padding: '0.6rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                    {s.scenario_id}
                    <Link to={`/sessions/${s.session_id}`} style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent)' }}>
                      {s.session_id}
                    </Link>
                  </div>
                  <ScoreDisplay value={s.evaluation.overall_score} />
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                  <span className="eval-pill"><Target size={10} /> Goal: <ScoreDisplay value={s.evaluation.goal_achievement} /></span>
                  <span className="eval-pill"><Brain size={10} /> Context: <ScoreDisplay value={s.evaluation.context_retention} /></span>
                  <span className="eval-pill"><Shield size={10} /> Defense: <ScoreDisplay value={s.evaluation.error_handling} /></span>
                  <span className="eval-pill"><Star size={10} /> Quality: <ScoreDisplay value={s.evaluation.response_quality} /></span>
                </div>
                {s.evaluation.summary && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {s.evaluation.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
