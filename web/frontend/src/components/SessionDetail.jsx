import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Timer, Zap, Activity, Award, MessageSquare, BarChart3, AlertTriangle, Terminal, User, Bot, Clock, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSession, connectWebSocket, startSession, formatTime, formatMs } from '../api'

function ScoreDisplay({ value, max = 5 }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  const cls = value >= 4 ? 'high' : value >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{value}/{max}</span>
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
  const [rematching, setRematchning] = useState(false)
  const conversationEndRef = useRef(null)
  const conversationContainerRef = useRef(null)
  const wsRef = useRef(null)
  const navigate = useNavigate()

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
      } else if (data.type === 'turn_scored') {
        // Evaluation scores arrived — update the turn and reload from DB
        setLiveTurns(prev =>
          prev.map(t => t.turn_number === data.turn_number ? { ...t, eval: data.eval, eval_latency: data.eval_latency } : t)
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
  const isDone = session.status === 'completed' || session.status === 'error'

  const handleRematch = async () => {
    setRematchning(true)
    try {
      const res = await startSession({
        actorMode: session.actor_mode,
        goal: session.goal || session.scenario_id,
        scenarioId: session.scenario_id || undefined,
        maxTurns: session.max_turns,
        maxTimeS: session.max_time_s || 600,
        evalModel: session.eval_model,
      })
      navigate(`/sessions/${res.session_id}`)
    } catch (err) {
      alert('Rematch failed: ' + err.message)
    } finally {
      setRematchning(false)
    }
  }
  // Merge DB turns with live turns (live turns may have newer data before DB poll catches up)
  const allTurns = turns.length > 0 ? turns : liveTurns.filter(t => !t.pending)
  const isWaitingForFirstTurn = session?.status === 'running' && allTurns.length === 0 && liveTurns.length === 0

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
          {isDone && (
            <button onClick={handleRematch} disabled={rematching} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              {rematching ? <span className="spinner" /> : <RotateCcw size={14} />}
              Rematch
            </button>
          )}
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
          <div className="stat-label">Avg TTFT</div>
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

      {/* Fighter Cards */}
      {(() => {
        const env = session.env_info || {}
        return (
          <div className="grid grid-2">
            <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                <User size={14} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Joe</span>
                <span className={`badge ${session.actor_mode}`} style={{ fontSize: '0.55rem' }}>{session.actor_mode}</span>
              </div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span><strong>Engine:</strong> Claude {(env.joe_model || 'sonnet').replace(/^./, c => c.toUpperCase())}</span>
                <span><strong>Style:</strong> {session.actor_mode === 'fire' ? 'Autonomous (full session)' : session.actor_mode === 'explore' ? 'Adaptive (AI-driven)' : session.actor_mode === 'hybrid' ? 'Mixed (plan + adapt)' : 'Scripted (fixed steps)'}</span>
                <span><strong>Max Rounds:</strong> {session.max_turns}</span>
              </div>
            </div>
            <div className="card" style={{ borderLeft: '3px solid var(--green)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                <Bot size={14} style={{ color: 'var(--green)' }} />
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Kai</span>
                <span className={`badge ${session.env_key === 'staging' ? 'pending' : 'completed'}`} style={{ fontSize: '0.55rem' }}>
                  {(session.env_key || 'production').replace(/^\w/, c => c.toUpperCase())}
                </span>
              </div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span><strong>API:</strong> {env.base_url || 'N/A'}</span>
                <span><strong>Project:</strong> {env.project_name || 'N/A'} {env.project_id ? `(${env.project_id})` : ''}</span>
                <span><strong>Account:</strong> {env.account_name || 'N/A'}</span>
              </div>
            </div>
          </div>
        )
      })()}

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
          {isWaitingForFirstTurn && (
            <div className="message" style={{ alignSelf: 'flex-start', background: 'var(--katalon-teal)', color: 'white', borderBottomLeftRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
                <span className="spinner" style={{ borderTopColor: 'white' }} /> Joe is preparing the first exchange...
              </div>
            </div>
          )}
          {allTurns.map((t, i) => (
            <div key={i}>
              <div className="message user">
                <div className="message-header" style={{ display: 'flex', alignItems: 'center' }}>
                  <User size={10} /> Exchange {t.turn_number} — Joe
                  {t.timestamp && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'rgba(255,255,255,0.7)', fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                      <Clock size={8} /> {formatTime(t.timestamp)}
                    </span>
                  )}
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
                    <span><Timer size={10} style={{ verticalAlign: 'middle' }} /> TTFT: {formatMs(t.ttfb_ms)}</span>
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
                (isRunning || t.status === 'pending') && (
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
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
            <div>
              <div className="stat-label">Latency</div>
              <ScoreDisplay value={
                allTurns.length > 0
                  ? +(allTurns.filter(t => t.eval_latency).reduce((s, t) => s + t.eval_latency, 0) / allTurns.filter(t => t.eval_latency).length).toFixed(1)
                  : null
              } />
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
                <th>TTFT</th>
                <th>Total</th>
                <th>Polls</th>
                <th>Rel {evaluation?.rubric_weights?.relevance != null && <span style={{ fontWeight: 400, fontSize: '0.6rem', color: 'var(--text-muted)' }}>×{evaluation.rubric_weights.relevance}</span>}</th>
                <th>Acc {evaluation?.rubric_weights?.accuracy != null && <span style={{ fontWeight: 400, fontSize: '0.6rem', color: 'var(--text-muted)' }}>×{evaluation.rubric_weights.accuracy}</span>}</th>
                <th>Help {evaluation?.rubric_weights?.helpfulness != null && <span style={{ fontWeight: 400, fontSize: '0.6rem', color: 'var(--text-muted)' }}>×{evaluation.rubric_weights.helpfulness}</span>}</th>
                <th>Tool {evaluation?.rubric_weights?.tool_usage != null && <span style={{ fontWeight: 400, fontSize: '0.6rem', color: 'var(--text-muted)' }}>×{evaluation.rubric_weights.tool_usage}</span>}</th>
                <th>Latency {evaluation?.rubric_weights?.latency != null && <span style={{ fontWeight: 400, fontSize: '0.6rem', color: 'var(--text-muted)' }}>×{evaluation.rubric_weights.latency}</span>}</th>
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
