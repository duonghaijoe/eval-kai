import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Timer, Zap, Activity, Award, MessageSquare, BarChart3, AlertTriangle, Terminal, User, Bot, Clock, RotateCcw, Bug, ExternalLink, Loader, ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSession, connectWebSocket, startSession, formatTime, formatMs, logJiraBug, logJiraSessionBug, getSessionTickets, getJiraFilterUrl } from '../api'
import { useAdmin } from '../AdminContext'

function safeLatency(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'object') return null  // legacy dict format — not renderable
  return Number(v) || null
}

function ScoreDisplay({ value, max = 5 }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  const cls = value >= 4 ? 'high' : value >= 3 ? 'mid' : 'low'
  return <span className={`score ${cls}`}>{value}/{max}</span>
}

export default function SessionDetail() {
  const { id } = useParams()
  const { admin } = useAdmin()
  const [session, setSession] = useState(null)
  const [turns, setTurns] = useState([])
  const [evaluation, setEvaluation] = useState(null)
  const [liveTurns, setLiveTurns] = useState([])
  const [fireLog, setFireLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(false)
  const [rematching, setRematchning] = useState(false)
  const [tickets, setTickets] = useState({})  // turn_number → ticket_key
  const [loggingBug, setLoggingBug] = useState(null)  // turn_number being logged
  const [loggingSession, setLoggingSession] = useState(false)
  const [sessionTicket, setSessionTicket] = useState(null)  // session-level ticket key
  const [jiraFilterUrl, setJiraFilterUrl] = useState(null)
  const [expandedTurns, setExpandedTurns] = useState(new Set())
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
      // Load linked Jira tickets
      try {
        const t = await getSessionTickets(id)
        const map = {}
        ;(t.tickets || []).forEach(tk => {
          if (tk.turn_number === 0) {
            setSessionTicket(tk.ticket_key)
          } else {
            map[tk.turn_number] = tk.ticket_key
          }
        })
        setTickets(map)
      } catch {}
    } catch {} finally { setLoading(false) }
  }

  const handleLogBug = async (turnNumber) => {
    setLoggingBug(turnNumber)
    try {
      const result = await logJiraBug(id, turnNumber)
      if (result.ok) {
        setTickets(prev => ({ ...prev, [turnNumber]: result.ticket_key }))
      } else {
        alert('Failed: ' + (result.error || 'Unknown error'))
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setLoggingBug(null)
    }
  }

  const toggleTurn = (turnNum) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      next.has(turnNum) ? next.delete(turnNum) : next.add(turnNum)
      return next
    })
  }

  const collapseAll = () => setExpandedTurns(new Set())

  useEffect(() => {
    load()
    getJiraFilterUrl().then(d => setJiraFilterUrl(d.url)).catch(() => {})
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
      } else if (data.type === 'turn_streaming') {
        // Partial response arrived — update the pending turn with partial text
        setLiveTurns(prev =>
          prev.map(t => t.turn_number === data.turn_number
            ? { ...t, partial_response: data.partial_response }
            : t
          )
        )
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
        // Parse fire events into clean log entries + live turns
        if (data.type === 'fire_tool_call') {
          const input = data.input_preview || ''
          const isStart = input.includes('start --env') || input.includes('start\' --env')
          const isEnd = input.includes('end --match')
          const isRound = input.includes('round --match') || input.includes('round\' --match')
          // Extract message: look for --message "..." or --message '...' or -m "..."
          // The input_preview is a Python dict repr, so the command is inside 'command': '...'
          let userMsg = ''
          const cmdMatch = input.match(/command['":\s]+.*?--message\s+["'](.*?)(?:["']\s*[,}]|["']\s*$)/) ||
                           input.match(/-m\s+["'](.*?)(?:["']\s*[,}]|["']\s*$)/) ||
                           input.match(/--message\s+["'](.+?)["']/)
          if (cmdMatch) userMsg = cmdMatch[1].replace(/\\'/g, "'").slice(0, 120)

          let label = ''
          if (isStart) label = 'Starting conversation session...'
          else if (isEnd) label = 'Ending session and generating report...'
          else if (isRound && userMsg) {
            const preview = userMsg.length > 80 ? userMsg.slice(0, 80) + '...' : userMsg
            label = `Sending: "${preview}"`
            setLiveTurns(prev => {
              const nextNum = prev.length + 1
              return [...prev, { turn_number: nextNum, user_message: userMsg, pending: true }]
            })
          } else if (isRound) {
            label = 'Sending message to Kai...'
            setLiveTurns(prev => {
              const nextNum = prev.length + 1
              return [...prev, { turn_number: nextNum, user_message: '...', pending: true }]
            })
          } else {
            return // skip non-kai commands silently
          }
          setFireLog(prev => [...prev.slice(-50), { type: 'fire_status', label, ts: Date.now() }])
        } else if (data.type === 'fire_tool_result') {
          const content = data.content_preview || ''
          // Skip raw log lines (timestamps, [INFO], etc.)
          if (/^\d{4}-\d{2}-\d{2}|^\[INFO\]|^\[WARNING\]|Using pre-resolved|Shell cwd/.test(content)) return
          // Try to find JSON in the content (may have log lines before it)
          const jsonMatch = content.match(/(\{[\s\S]*\})\s*$/)
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[1])
              const kaiResp = parsed.assistant_response || parsed.kai_response
              if (parsed.round_number && kaiResp) {
                setLiveTurns(prev => prev.map((t, i) =>
                  (i === parsed.round_number - 1 || t.turn_number === parsed.round_number)
                    ? { ...t, turn_number: parsed.round_number, user_message: parsed.user_message || t.user_message, assistant_response: kaiResp, status: parsed.status || 'input-required', ttfb_ms: parsed.ttfb_ms, total_ms: parsed.total_ms, pending: false }
                    : t
                ))
                const ttfb = parsed.ttfb_ms ? `TTFT: ${(parsed.ttfb_ms / 1000).toFixed(1)}s` : ''
                const total = parsed.total_ms ? `Total: ${(parsed.total_ms / 1000).toFixed(1)}s` : ''
                setFireLog(prev => [...prev.slice(-50), { type: 'fire_response', label: `Round ${parsed.round_number} — Kai responded ${ttfb ? `(${ttfb}, ${total})` : ''}`, ts: Date.now() }])
              } else if (parsed.match_id || parsed.status === 'ready') {
                setFireLog(prev => [...prev.slice(-50), { type: 'fire_response', label: `Session initialized: ${parsed.match_id}`, ts: Date.now() }])
              }
            } catch { /* not valid JSON, skip */ }
          }
        } else if (data.type === 'fire_text') {
          // Only show Claude's deliberate commentary, filter out noise
          const text = (data.content || '').trim()
          // Skip: log lines, JSON, code blocks, single-line noise, short fragments
          if (!text || text.length < 10) return
          if (/^\d{4}-\d{2}-\d{2}|^\[INFO|^\{|^```|^Round \d|^Shell cwd|^Using pre|^Sending|^cd /.test(text)) return
          // Only show substantial commentary (evaluation notes, strategy, etc.)
          if (text.includes('===FIRE_REPORT') || text.includes('session_id')) return
          setFireLog(prev => [...prev.slice(-50), { type: 'fire_text', content: text.slice(0, 200), ts: Date.now() }])
        } else if (data.type === 'fire_started') {
          setFireLog(prev => [{ type: 'fire_status', label: `Fire mode started — model: ${data.model}`, ts: Date.now() }])
        } else if (data.type === 'fire_result') {
          setFireLog(prev => [...prev.slice(-50), { type: 'fire_response', label: 'Session complete — loading results...', ts: Date.now() }])
          load()
        }
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
  // For fire mode, show live turns alongside DB turns (DB only populates at end)
  const isFire = session?.actor_mode === 'fire'
  const completedLiveTurns = liveTurns.filter(t => !t.pending)
  const allTurns = turns.length > 0 ? turns : completedLiveTurns
  const isWaitingForFirstTurn = session?.status === 'running' && allTurns.length === 0 && (isFire ? fireLog.length === 0 : liveTurns.length === 0)

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
          {isDone && admin && (
            sessionTicket ? (
              <a
                href={`https://katalon.atlassian.net/browse/${sessionTicket}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none', padding: '0.3em 0.6em', border: '1px solid var(--accent)', borderRadius: '6px' }}
              >
                <Bug size={14} /> {sessionTicket} <ExternalLink size={10} />
              </a>
            ) : (
              <button
                onClick={async () => {
                  setLoggingSession(true)
                  try {
                    const result = await logJiraSessionBug(id)
                    if (result.ok) {
                      setSessionTicket(result.ticket_key)
                    } else {
                      alert('Failed: ' + (result.error || 'Unknown error'))
                    }
                  } catch (e) {
                    alert('Error: ' + e.message)
                  } finally {
                    setLoggingSession(false)
                  }
                }}
                disabled={loggingSession}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                {loggingSession
                  ? <><Loader size={14} className="spinner" /> Logging...</>
                  : <><Bug size={14} /> Log Bug</>
                }
              </button>
            )
          )}
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
        <div className="card" style={{ maxHeight: '220px', overflowY: 'auto' }}>
          <h3><Terminal size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />AI Actor (live)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem' }}>
            {fireLog.map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', flexShrink: 0, marginTop: '0.15rem' }}>
                  {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                {e.type === 'fire_status' && (
                  <span style={{ color: 'var(--blue)' }}>{e.label}</span>
                )}
                {e.type === 'fire_response' && (
                  <span style={{ color: 'var(--green)' }}>{e.label}</span>
                )}
                {e.type === 'fire_error' && (
                  <span style={{ color: 'var(--red)' }}>{e.label}</span>
                )}
                {e.type === 'fire_text' && (
                  <span style={{ color: 'var(--text-secondary)' }}>{e.content.slice(0, 200)}</span>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
              <span className="spinner" style={{ width: 10, height: 10 }} /> Working...
            </div>
          </div>
        </div>
      )}

      {/* Conversation — Collapsible Exchange Cards */}
      <div className="card" ref={conversationContainerRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}><MessageSquare size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Conversation</h3>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button onClick={() => setExpandedTurns(new Set(allTurns.map(t => t.turn_number)))} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
              <Maximize2 size={10} /> Expand All
            </button>
            <button onClick={collapseAll} style={{ fontSize: '0.65rem', padding: '0.15em 0.4em', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
              <Minimize2 size={10} /> Collapse All
            </button>
          </div>
        </div>

        {isWaitingForFirstTurn && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <span className="spinner" /> {isFire ? 'Fire mode initializing — Claude is planning the attack...' : 'Joe is preparing the first exchange...'}
          </div>
        )}
        {isFire && isRunning && allTurns.length === 0 && completedLiveTurns.length === 0 && liveTurns.some(t => t.pending) && (
          <div style={{ padding: '0.6rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <span className="spinner" /> Waiting for Kai to respond...
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {allTurns.map((t, i) => {
            const isExpanded = expandedTurns.has(t.turn_number)
            const hasError = t.error || t.status === 'error'
            const scores = [t.eval_relevance, t.eval_accuracy, t.eval_helpfulness, t.eval_tool_usage].filter(v => v != null)
            const avgScore = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null
            const scoreColor = avgScore >= 4 ? 'var(--green)' : avgScore >= 3 ? 'var(--yellow)' : avgScore != null ? 'var(--red)' : 'var(--text-muted)'
            const statusOk = t.status === 'input-required'
            const responsePreview = (t.assistant_response || '').replace(/[#*_`\[\]]/g, '').slice(0, 120)

            return (
              <div
                key={i}
                style={{
                  border: `1px solid ${hasError ? 'var(--red)' : isExpanded ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  background: hasError ? 'rgba(220,38,38,0.02)' : 'var(--bg-card)',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* Collapsed header — always visible */}
                <div
                  onClick={() => toggleTurn(t.turn_number)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.6rem 0.75rem', cursor: 'pointer',
                    background: isExpanded ? 'rgba(99,102,241,0.03)' : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  {isExpanded
                    ? <ChevronDown size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    : <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  }

                  {/* Exchange number */}
                  <span style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-primary)', minWidth: '1.8rem' }}>
                    #{t.turn_number}
                  </span>

                  {/* Status badge */}
                  <span className={`badge ${statusOk ? 'completed' : 'error'}`} style={{ fontSize: '0.55rem', flexShrink: 0 }}>
                    {statusOk ? 'OK' : t.status || 'error'}
                  </span>

                  {/* Quality score pill */}
                  {avgScore != null && (
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700, padding: '0.1em 0.4em',
                      borderRadius: '4px', color: 'white', flexShrink: 0,
                      background: avgScore >= 4 ? 'var(--green)' : avgScore >= 3 ? 'var(--yellow)' : 'var(--red)',
                    }}>
                      {avgScore}/5
                    </span>
                  )}

                  {/* Latency */}
                  {safeLatency(t.eval_latency) != null && (
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      L:{safeLatency(t.eval_latency)}/5
                    </span>
                  )}

                  {/* Timing pills */}
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    <Timer size={9} style={{ verticalAlign: 'middle' }} /> {formatMs(t.ttfb_ms)}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    <Zap size={9} style={{ verticalAlign: 'middle' }} /> {formatMs(t.total_ms)}
                  </span>

                  {/* Preview text (only when collapsed) */}
                  {!isExpanded && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                      {responsePreview || (hasError ? t.error?.slice(0, 80) : 'Pending...')}
                    </span>
                  )}

                  {/* Error indicator */}
                  {hasError && (
                    <AlertTriangle size={13} style={{ color: 'var(--red)', flexShrink: 0 }} />
                  )}

                  {/* Jira ticket indicator */}
                  {tickets[t.turn_number] && (
                    <a
                      href={`https://katalon.atlassian.net/browse/${tickets[t.turn_number]}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: '0.6rem', color: 'var(--accent)', textDecoration: 'none', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '0.1rem' }}
                    >
                      <Bug size={9} /> {tickets[t.turn_number]}
                    </a>
                  )}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: '0 0.75rem 0.75rem', borderTop: '1px solid var(--border)' }}>
                    {/* User message */}
                    <div className="message user" style={{ marginTop: '0.5rem' }}>
                      <div className="message-header" style={{ display: 'flex', alignItems: 'center' }}>
                        <User size={10} /> Joe
                        {t.timestamp && (
                          <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'rgba(255,255,255,0.7)', fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                            <Clock size={8} /> {formatTime(t.timestamp)}
                          </span>
                        )}
                      </div>
                      {t.user_message}
                    </div>

                    {/* Kai response */}
                    {t.assistant_response ? (
                      <div className="message assistant">
                        <div className="message-header"><Bot size={10} /> Kai</div>
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.assistant_response}</ReactMarkdown>
                        </div>
                        <div className="meta">
                          <span><Timer size={10} style={{ verticalAlign: 'middle' }} /> TTFT: {formatMs(t.ttfb_ms)}</span>
                          <span><Zap size={10} style={{ verticalAlign: 'middle' }} /> Total: {formatMs(t.total_ms)}</span>
                          <span>Polls: {t.poll_count}</span>
                          {t.tool_calls?.length > 0 && <span>Tools: {(typeof t.tool_calls === 'string' ? JSON.parse(t.tool_calls) : t.tool_calls).map(tc => typeof tc === 'object' ? tc.name : tc).join(', ')}</span>}
                        </div>

                        {/* Tool calls */}
                        {t.tool_calls?.length > 0 && (() => {
                          const tcs = typeof t.tool_calls === 'string' ? JSON.parse(t.tool_calls) : t.tool_calls;
                          const hasDetails = tcs.some(tc => typeof tc === 'object' && tc.arguments);
                          return hasDetails ? (
                            <details style={{ fontSize: '0.72rem', marginTop: '0.4rem' }}>
                              <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 500 }}>
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

                        {/* Quality scores */}
                        {(t.eval_relevance || t.eval_accuracy || safeLatency(t.eval_latency)) && (
                          <div className="eval-pills">
                            <span className="eval-pill">Rel: <ScoreDisplay value={t.eval_relevance} /></span>
                            <span className="eval-pill">Acc: <ScoreDisplay value={t.eval_accuracy} /></span>
                            <span className="eval-pill">Help: <ScoreDisplay value={t.eval_helpfulness} /></span>
                            <span className="eval-pill">Tool: <ScoreDisplay value={t.eval_tool_usage} /></span>
                            {safeLatency(t.eval_latency) != null && <span className="eval-pill">Latency: <ScoreDisplay value={safeLatency(t.eval_latency)} /></span>}
                          </div>
                        )}

                        {/* Error */}
                        {t.error && (
                          <div style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <AlertTriangle size={12} /> {t.error}
                          </div>
                        )}

                        {/* Jira bug button */}
                        {admin && (
                          <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {tickets[t.turn_number] ? (
                              <a
                                href={`https://katalon.atlassian.net/browse/${tickets[t.turn_number]}`}
                                target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: '0.7rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', textDecoration: 'none' }}
                              >
                                <Bug size={11} /> {tickets[t.turn_number]} <ExternalLink size={9} />
                              </a>
                            ) : (
                              <button
                                onClick={() => handleLogBug(t.turn_number)}
                                disabled={loggingBug === t.turn_number}
                                style={{ fontSize: '0.65rem', padding: '0.15em 0.45em', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                              >
                                {loggingBug === t.turn_number
                                  ? <><Loader size={10} className="spinner" /> Logging...</>
                                  : <><Bug size={10} /> Log Bug</>
                                }
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      (isRunning || t.status === 'pending') && (
                        <div className="message assistant">
                          {t.partial_response ? (
                            <div>
                              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.partial_response}</div>
                              <div className="loading-text" style={{ marginTop: '0.4rem', fontSize: '0.7rem' }}>
                                <span className="spinner" style={{ width: 10, height: 10 }} /> Kai is still responding...
                              </div>
                            </div>
                          ) : (
                            <div className="loading-text"><span className="spinner" /> Kai is thinking...</div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Live pending turns */}
          {liveTurns.filter(t => t.pending && !allTurns.find(at => at.turn_number === t.turn_number)).map((t, i) => (
            <div key={`live-${i}`} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" style={{ width: 12, height: 12 }} />
                <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>#{t.turn_number}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{(t.user_message || '').slice(0, 80)}...</span>
              </div>
            </div>
          ))}
        </div>
        <div ref={conversationEndRef} />
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
                (() => {
                  const withLatency = allTurns.map(t => safeLatency(t.eval_latency)).filter(v => v != null && v > 0)
                  return withLatency.length > 0
                    ? +(withLatency.reduce((s, v) => s + v, 0) / withLatency.length).toFixed(1)
                    : null
                })()
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

      {/* Jira Tickets */}
      {Object.keys(tickets).length > 0 && (
        <div className="card">
          <h3><Bug size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Linked Jira Tickets</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {Object.entries(tickets).sort((a, b) => a[0] - b[0]).map(([turn, key]) => (
              <a
                key={turn}
                href={`https://katalon.atlassian.net/browse/${key}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.3rem 0.6rem', borderRadius: '6px',
                  border: '1px solid var(--border)', fontSize: '0.75rem',
                  color: 'var(--accent)', textDecoration: 'none',
                  background: 'rgba(99,102,241,0.04)',
                }}
              >
                <Bug size={12} />
                <span style={{ fontWeight: 600 }}>{key}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Exchange {turn}</span>
                <ExternalLink size={9} />
              </a>
            ))}
          </div>
          {jiraFilterUrl && (
            <div style={{ marginTop: '0.5rem' }}>
              <a href={jiraFilterUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.7rem', color: 'var(--accent)' }}>
                View all Kai tickets in Jira <ExternalLink size={9} style={{ verticalAlign: 'middle' }} />
              </a>
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
                <th>Jira</th>
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
                  <td><ScoreDisplay value={safeLatency(t.eval_latency)} /></td>
                  <td style={{ color: 'var(--red)', fontSize: '0.7rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.error || '-'}
                  </td>
                  <td>
                    {tickets[t.turn_number] ? (
                      <a href={`https://katalon.atlassian.net/browse/${tickets[t.turn_number]}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.68rem', color: 'var(--accent)' }}>
                        {tickets[t.turn_number]}
                      </a>
                    ) : (
                      <button onClick={() => handleLogBug(t.turn_number)} disabled={loggingBug === t.turn_number} style={{ fontSize: '0.6rem', padding: '0.1em 0.3em' }}>
                        {loggingBug === t.turn_number ? <span className="spinner" style={{ width: 8, height: 8 }} /> : <Bug size={9} />}
                      </button>
                    )}
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
