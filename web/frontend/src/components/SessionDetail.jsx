import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Timer, Zap, Activity, Award, MessageSquare, BarChart3, AlertTriangle, Terminal, User, Bot } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSession, connectWebSocket } from '../api'

function ScoreDisplay({ value, max = 5 }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  const cls = value >= 4 ? 'high' : value >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{value}/{max}</span>
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function SessionDetail() {
  const { id } = useParams()
  const [session, setSession] = useState(null)
  const [turns, setTurns] = useState([])
  const [evaluation, setEvaluation] = useState(null)
  const [liveTurns, setLiveTurns] = useState([])
  const [fireLog, setFireLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(false)
  const conversationEndRef = useRef(null)
  const conversationContainerRef = useRef(null)
  const wsRef = useRef(null)

  const load = async () => {
    try {
      const data = await getSession(id)
      setSession(data.session)
      setTurns(data.turns || [])
      setEvaluation(data.evaluation)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    const ws = connectWebSocket(id)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'turn_start') {
        setLiveTurns(prev => [...prev, { ...data, pending: true }])
      } else if (data.type === 'turn_complete') {
        setLiveTurns(prev =>
          prev.map(t => t.turn_number === data.turn_number ? { ...data, pending: false } : t)
        )
        load()
      } else if (data.type === 'session_complete') {
        load()
        setLiveTurns([])
        setFireLog([])
      } else if (data.type?.startsWith('fire_')) {
        setFireLog(prev => [...prev.slice(-100), { ...data, ts: Date.now() }])
        if (data.type === 'fire_result') load()
      }
    }

    return () => { ws.close() }
  }, [id])

  useEffect(() => {
    if (autoScroll && conversationContainerRef.current) {
      const el = conversationContainerRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [turns, liveTurns, autoScroll])

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading...</div>
  if (!session) return <div className="empty">Round not found</div>

  const isRunning = session.status === 'running'
  const allTurns = turns.length > 0 ? turns : liveTurns.filter(t => !t.pending)

  const ttfbs = allTurns.filter(t => t.ttfb_ms > 0).map(t => t.ttfb_ms)
  const totals = allTurns.filter(t => t.total_ms > 0).map(t => t.total_ms)
  const avgTtfb = ttfbs.length ? ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length : 0
  const avgTotal = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>
            <MessageSquare size={20} style={{ marginRight: '0.25rem' }} />
            Round {id}
            <span className={`badge ${session.status}`} style={{ marginLeft: '0.75rem', verticalAlign: 'middle' }}>
              {session.status}
            </span>
            <span className={`badge ${session.actor_mode}`} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }}>
              {session.actor_mode}
            </span>
            <span className={`badge ${session.env_key === 'staging' ? 'pending' : 'completed'}`} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }}>
              {(session.env_key || 'production').replace(/^\w/, c => c.toUpperCase())} Ring
            </span>
          </h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {session.goal || session.scenario_id}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label className="scroll-toggle">
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
            Auto-scroll
          </label>
          <Link to="/sessions"><button><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />Back to Rounds</button></Link>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-4">
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Activity size={18} style={{ color: 'var(--accent)' }} />
            {allTurns.length}
          </div>
          <div className="stat-label">Exchanges {isRunning && <span className="spinner" style={{ marginLeft: '0.25rem' }} />}</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Timer size={18} style={{ color: 'var(--blue)' }} />
            {formatMs(avgTtfb)}
          </div>
          <div className="stat-label">Avg TTFB</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Zap size={18} style={{ color: 'var(--orange)' }} />
            {formatMs(avgTotal)}
          </div>
          <div className="stat-label">Avg Response Time</div>
        </div>
        <div className="card">
          <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Award size={18} style={{ color: 'var(--green)' }} />
            {evaluation ? <ScoreDisplay value={evaluation.overall_score} /> : (isRunning ? <span className="spinner" /> : '-')}
          </div>
          <div className="stat-label">Overall Score</div>
        </div>
      </div>

      {/* Fire mode live log */}
      {fireLog.length > 0 && session.actor_mode === 'fire' && isRunning && (
        <div className="card" style={{ maxHeight: '300px', overflowY: 'auto' }}>
          <h3><Terminal size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />AI Actor (live)</h3>
          <div className="fire-log">
            {fireLog.map((e, i) => (
              <div key={i} className="fire-log-entry">
                {e.type === 'fire_text' && (
                  <span style={{ color: 'var(--text-primary)' }}>{e.content}</span>
                )}
                {e.type === 'fire_tool_call' && (
                  <span style={{ color: 'var(--blue)' }}>$ {e.input_preview?.slice(0, 200)}</span>
                )}
                {e.type === 'fire_tool_result' && (
                  <span style={{ color: 'var(--green)' }}>{e.content_preview?.slice(0, 300)}</span>
                )}
                {e.type === 'fire_started' && (
                  <span style={{ color: 'var(--orange)' }}>Round started — model: {e.model}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversation */}
      <div className="card" ref={conversationContainerRef} style={{ maxHeight: '600px', overflowY: 'auto' }}>
        <h3><MessageSquare size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Conversation</h3>
        <div className="conversation">
          {allTurns.map((t, i) => (
            <div key={i}>
              <div className="message user">
                <div className="message-header">
                  <User size={10} /> Exchange {t.turn_number} — Joe
                </div>
                {t.user_message}
              </div>
              {t.assistant_response ? (
                <div className="message assistant">
                  <div className="message-header">
                    <Bot size={10} /> Kai
                  </div>
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.assistant_response}</ReactMarkdown>
                  </div>
                  <div className="meta">
                    <span><Timer size={10} style={{ verticalAlign: 'middle' }} /> TTFB: {formatMs(t.ttfb_ms)}</span>
                    <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> Total: {formatMs(t.total_ms)}</span>
                    <span>Polls: {t.poll_count}</span>
                    {t.tool_calls?.length > 0 && <span>Tools: {(typeof t.tool_calls === 'string' ? JSON.parse(t.tool_calls) : t.tool_calls).map(tc => typeof tc === 'object' ? tc.name : tc).join(', ')}</span>}
                  </div>
                  {t.tool_calls?.length > 0 && (() => {
                    const tcs = typeof t.tool_calls === 'string' ? JSON.parse(t.tool_calls) : t.tool_calls;
                    const hasDetails = tcs.some(tc => typeof tc === 'object' && tc.arguments);
                    return hasDetails ? (
                      <details style={{ fontSize: '0.72rem', marginTop: '0.4rem' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--katalon-teal)', fontWeight: 500 }}>
                          Tool Calls ({tcs.length})
                        </summary>
                        <div style={{ marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {tcs.map((tc, idx) => (
                            <div key={idx} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem 0.65rem' }}>
                              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{tc.name || tc}</div>
                              {tc.arguments && (
                                <pre style={{ margin: 0, fontSize: '0.68rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                                  {JSON.stringify(tc.arguments, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null;
                  })()}
                  {(t.eval_relevance || t.eval_accuracy || t.eval_latency) && (
                    <div className="eval-pills">
                      <span className="eval-pill">Rel: <ScoreDisplay value={t.eval_relevance} /></span>
                      <span className="eval-pill">Acc: <ScoreDisplay value={t.eval_accuracy} /></span>
                      <span className="eval-pill">Help: <ScoreDisplay value={t.eval_helpfulness} /></span>
                      <span className="eval-pill">Tool: <ScoreDisplay value={t.eval_tool_usage} /></span>
                      {t.eval_latency != null && <span className="eval-pill">Latency: <ScoreDisplay value={t.eval_latency} /></span>}
                    </div>
                  )}
                  {t.error && <div style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><AlertTriangle size={12} /> {t.error}</div>}
                </div>
              ) : (
                isRunning && i === allTurns.length - 1 && (
                  <div className="message assistant">
                    <div className="loading-text"><span className="spinner" /> Kai is thinking...</div>
                  </div>
                )
              )}
            </div>
          ))}
          {liveTurns.filter(t => t.pending && !allTurns.find(at => at.turn_number === t.turn_number)).map((t, i) => (
            <div key={`live-${i}`}>
              <div className="message user">
                <div className="message-header">
                  <User size={10} /> Exchange {t.turn_number} — Joe
                </div>
                {t.user_message}
              </div>
              <div className="message assistant">
                <div className="loading-text"><span className="spinner" /> Kai is thinking...</div>
              </div>
            </div>
          ))}
          <div ref={conversationEndRef} />
        </div>
      </div>

      {/* Evaluation */}
      {evaluation && (
        <div className="card">
          <h3><Award size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Scorecard</h3>
          <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
            <div>
              <div className="stat-label">Goal Achievement</div>
              <ScoreDisplay value={evaluation.goal_achievement} />
            </div>
            <div>
              <div className="stat-label">Context Retention</div>
              <ScoreDisplay value={evaluation.context_retention} />
            </div>
            <div>
              <div className="stat-label">Defense</div>
              <ScoreDisplay value={evaluation.error_handling} />
            </div>
            <div>
              <div className="stat-label">Response Quality</div>
              <ScoreDisplay value={evaluation.response_quality} />
            </div>
          </div>
          {evaluation.summary && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              {evaluation.summary}
            </div>
          )}
          {evaluation.issues?.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--red)', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <AlertTriangle size={12} /> Issues Found:
              </div>
              <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.25rem' }}>
                {(typeof evaluation.issues === 'string' ? JSON.parse(evaluation.issues) : evaluation.issues).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Turn details table */}
      {allTurns.length > 0 && (
        <div className="card table-wrap">
          <h3><BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Exchange Metrics</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>TTFB</th>
                <th>Total</th>
                <th>Polls</th>
                <th>Rel</th>
                <th>Acc</th>
                <th>Help</th>
                <th>Tool</th>
                <th>Latency</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {allTurns.map(t => (
                <tr key={t.turn_number}>
                  <td>{t.turn_number}</td>
                  <td><span className={`badge ${t.status === 'input-required' ? 'completed' : 'error'}`}>{t.status}</span></td>
                  <td>{formatMs(t.ttfb_ms)}</td>
                  <td>{formatMs(t.total_ms)}</td>
                  <td>{t.poll_count}</td>
                  <td><ScoreDisplay value={t.eval_relevance} /></td>
                  <td><ScoreDisplay value={t.eval_accuracy} /></td>
                  <td><ScoreDisplay value={t.eval_helpfulness} /></td>
                  <td><ScoreDisplay value={t.eval_tool_usage} /></td>
                  <td><ScoreDisplay value={t.eval_latency} /></td>
                  <td style={{ color: 'var(--red)', fontSize: '0.7rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.error || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
