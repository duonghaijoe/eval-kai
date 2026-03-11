import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircleQuestion, X, Send, Bot, User, Zap, PlayCircle } from 'lucide-react'
import { startSession, createMatch } from '../api'

const BASE = import.meta.env.VITE_API_URL || ''

// Lightweight markdown renderer for chat messages
function MarkdownText({ text }) {
  if (!text) return null
  // Split into paragraphs
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs.map((para, pi) => {
    // Check if paragraph is a list
    const lines = para.split('\n')
    const isList = lines.every(l => /^[-•*]\s/.test(l.trim()) || l.trim() === '')
    if (isList) {
      const items = lines.filter(l => /^[-•*]\s/.test(l.trim()))
      return (
        <ul key={pi} style={{ margin: '0.3rem 0', paddingLeft: '1.2rem' }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: '0.15rem' }}>
              <InlineMarkdown text={item.replace(/^[-•*]\s/, '')} />
            </li>
          ))}
        </ul>
      )
    }
    // Check if numbered list
    const isNumbered = lines.every(l => /^\d+[.)]\s/.test(l.trim()) || l.trim() === '')
    if (isNumbered) {
      const items = lines.filter(l => /^\d+[.)]\s/.test(l.trim()))
      return (
        <ol key={pi} style={{ margin: '0.3rem 0', paddingLeft: '1.2rem' }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: '0.15rem' }}>
              <InlineMarkdown text={item.replace(/^\d+[.)]\s/, '')} />
            </li>
          ))}
        </ol>
      )
    }
    return (
      <p key={pi} style={{ margin: pi > 0 ? '0.4rem 0 0' : 0 }}>
        {lines.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            <InlineMarkdown text={line} />
          </span>
        ))}
      </p>
    )
  })
}

function InlineMarkdown({ text }) {
  // Parse bold, italic, code, and emoji
  const parts = []
  let remaining = text
  let key = 0
  while (remaining.length > 0) {
    // Bold **text** or __text__
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/)
    const boldMatch2 = remaining.match(/^(.*?)__(.+?)__/)
    // Italic *text* or _text_
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/)
    // Code `text`
    const codeMatch = remaining.match(/^(.*?)`(.+?)`/)

    let earliest = null
    let type = null

    if (boldMatch && (!earliest || boldMatch.index + boldMatch[1].length < earliest.pos)) {
      earliest = { match: boldMatch, pos: boldMatch.index + boldMatch[1].length }; type = 'bold'
    }
    if (boldMatch2 && (!earliest || boldMatch2.index + boldMatch2[1].length < earliest.pos)) {
      earliest = { match: boldMatch2, pos: boldMatch2.index + boldMatch2[1].length }; type = 'bold'
    }
    if (codeMatch && (!earliest || codeMatch.index + codeMatch[1].length < earliest.pos)) {
      earliest = { match: codeMatch, pos: codeMatch.index + codeMatch[1].length }; type = 'code'
    }
    if (italicMatch && type !== 'bold' && (!earliest || italicMatch.index + italicMatch[1].length < earliest.pos)) {
      earliest = { match: italicMatch, pos: italicMatch.index + italicMatch[1].length }; type = 'italic'
    }

    if (!earliest) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }

    const m = earliest.match
    if (m[1]) parts.push(<span key={key++}>{m[1]}</span>)

    if (type === 'bold') {
      parts.push(<strong key={key++}>{m[2]}</strong>)
    } else if (type === 'italic') {
      parts.push(<em key={key++}>{m[2]}</em>)
    } else if (type === 'code') {
      parts.push(<code key={key++} style={{
        background: 'rgba(0,0,0,0.06)', padding: '0.1em 0.3em', borderRadius: 3,
        fontSize: '0.9em', fontFamily: 'monospace',
      }}>{m[2]}</code>)
    }

    remaining = remaining.slice(m[0].length)
  }
  return <>{parts}</>
}

const MODE_LABELS = { fire: 'Fire', explore: 'Explore', hybrid: 'Hybrid', fixed: 'Fixed' }
const MODE_COLORS = { fire: 'var(--red)', explore: 'var(--accent)', hybrid: 'var(--orange)', fixed: 'var(--green)' }

function parseAction(text) {
  const match = text.match(/```action\s*\n?([\s\S]*?)\n?```/)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch { return null }
}

function stripAction(text) {
  return text.replace(/```action\s*\n?[\s\S]*?\n?```/, '').trim()
}

function ActionCard({ action, onExecute, executing }) {
  if (action?.action !== 'start_match') return null
  return (
    <div style={{
      margin: '0.3rem 0', padding: '0.6rem', borderRadius: 8,
      border: `2px solid ${MODE_COLORS[action.mode] || 'var(--accent)'}`,
      background: 'var(--bg-card)', fontSize: '0.75rem',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <Zap size={13} style={{ color: MODE_COLORS[action.mode] }} />
        Start Match — {MODE_LABELS[action.mode] || action.mode} Mode
      </div>
      {action.goal && (
        <div style={{ color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
          <strong>Goal:</strong> {action.goal}
        </div>
      )}
      <div style={{ color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
        {action.mode !== 'fixed' && <span><strong>Rounds:</strong> {action.rounds}</span>}
        {action.scenarioId && <span>{action.mode !== 'fixed' ? ' · ' : ''}<strong>Scenario:</strong> {action.scenarioId}</span>}
        {action.category && !action.scenarioId && <span><strong>Category:</strong> {action.category}</span>}
        {action.mode === 'fixed' && !action.scenarioId && !action.category && <span>All scenarios</span>}
      </div>
      <button onClick={onExecute} disabled={executing} className="primary"
        style={{ fontSize: '0.72rem', padding: '0.3em 0.8em', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        {executing
          ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Launching...</>
          : <><PlayCircle size={13} /> Launch Match</>
        }
      </button>
    </div>
  )
}

export default function AskJoePanel() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hey! I'm Joe. Ask me anything about how to use this tool — or tell me to run a match!" },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const userMsg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)
    try {
      const res = await fetch(`${BASE}/api/ask-joe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: [...messages, userMsg].slice(-10) }),
      })
      const data = await res.json()
      const answer = data.answer || 'Sorry, something went wrong.'
      const action = parseAction(answer)
      const displayText = stripAction(answer)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: displayText || (action ? 'Here\'s the match configuration:' : answer),
        action,
      }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting. Please try again." }])
    } finally {
      setLoading(false)
    }
  }

  const handleExecuteAction = async (action) => {
    setExecuting(true)
    try {
      if (action.mode === 'fixed' && !action.scenarioId) {
        // Fixed mode without specific scenario → run all scenarios (or category)
        const match = await createMatch({ category: action.category || null })
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Match launched! Redirecting you to the match report...`,
        }])
        setTimeout(() => { navigate(`/matches/${match.match_id}`); setOpen(false) }, 1000)
      } else {
        // fire, explore, hybrid, or fixed with a specific scenario
        const session = await startSession({
          actorMode: action.mode,
          goal: action.goal,
          scenarioId: action.mode === 'fixed' ? action.scenarioId : undefined,
          maxTurns: action.rounds || 3,
          maxTimeS: 300,
        })
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Round started in **${MODE_LABELS[action.mode]}** mode! Redirecting...`,
        }])
        setTimeout(() => { navigate(`/sessions/${session.session_id}`); setOpen(false) }, 1000)
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Failed to launch: ${e.message}. Please try from the New Match page.`,
      }])
    } finally {
      setExecuting(false)
    }
  }

  const renderMessageContent = (msg) => {
    return (
      <>
        {msg.content && (
          <div style={{ wordBreak: 'break-word' }}>
            {msg.role === 'user' ? msg.content : <MarkdownText text={msg.content} />}
          </div>
        )}
        {msg.action && (
          <ActionCard action={msg.action} onExecute={() => handleExecuteAction(msg.action)} executing={executing} />
        )}
      </>
    )
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.target.style.transform = 'scale(1.08)'; e.target.style.boxShadow = '0 6px 24px rgba(99,102,241,0.45)' }}
          onMouseLeave={e => { e.target.style.transform = 'scale(1)'; e.target.style.boxShadow = '0 4px 16px rgba(99,102,241,0.35)' }}
          title="Ask Joe"
        >
          <MessageCircleQuestion size={24} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 380, height: 520, display: 'flex', flexDirection: 'column',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '0.7rem 1rem', background: 'var(--accent)', color: '#fff',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.85rem' }}>
              <span style={{ fontSize: '1.1rem' }}>&#x1F94A;</span> Ask Joe
            </div>
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
              padding: '0.15rem', display: 'flex',
            }}>
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '0.75rem',
            display: 'flex', flexDirection: 'column', gap: '0.5rem',
          }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex', gap: '0.4rem',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: msg.role === 'user' ? 'var(--bg-hover)' : 'var(--accent)',
                  color: msg.role === 'user' ? 'var(--text-secondary)' : '#fff',
                }}>
                  {msg.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                </div>
                <div style={{
                  maxWidth: '78%', padding: '0.5rem 0.7rem', borderRadius: 10,
                  fontSize: '0.78rem', lineHeight: 1.55,
                  background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-primary)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                  borderTopRightRadius: msg.role === 'user' ? 3 : 10,
                  borderTopLeftRadius: msg.role === 'user' ? 10 : 3,
                }}>
                  {renderMessageContent(msg)}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--accent)', color: '#fff',
                }}>
                  <Bot size={13} />
                </div>
                <div style={{
                  padding: '0.5rem 0.7rem', borderRadius: 10, borderTopLeftRadius: 3,
                  background: 'var(--bg-primary)', fontSize: '0.78rem',
                }}>
                  <span className="spinner" style={{ width: 12, height: 12 }} /> Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '0.5rem 0.75rem', borderTop: '1px solid var(--border)',
            display: 'flex', gap: '0.4rem', background: 'var(--bg-card)',
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ask about the tool..."
              disabled={loading}
              style={{
                flex: 1, fontSize: '0.8rem', border: '1px solid var(--border)',
                borderRadius: 8, padding: '0.45rem 0.65rem', outline: 'none',
                background: 'var(--bg-primary)',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '0.4rem 0.6rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', opacity: !input.trim() || loading ? 0.5 : 1,
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
