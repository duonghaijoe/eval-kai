import { useState } from 'react'
import { MessageSquare, X, Send, ThumbsUp, Bug, Lightbulb, MessageCircle } from 'lucide-react'
import { submitFeedback } from '../api'

const FEEDBACK_TYPES = [
  { value: 'general', label: 'General', icon: MessageCircle },
  { value: 'bug', label: 'Bug Report', icon: Bug },
  { value: 'feature', label: 'Feature Idea', icon: Lightbulb },
  { value: 'praise', label: 'Kudos', icon: ThumbsUp },
]

export default function FeedbackPanel() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [type, setType] = useState('general')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true)
    setError(null)
    try {
      await submitFeedback({ name: name.trim() || 'anonymous', message: message.trim(), type })
      setSent(true)
      setMessage('')
      setName('')
      setType('general')
      setTimeout(() => { setSent(false); setOpen(false) }, 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(!open); setSent(false); setError(null) }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
          padding: '0.35rem', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)',
        }}
        title="Send feedback"
      >
        <MessageSquare size={18} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 99,
          }} />

          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem',
            width: 340, background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            zIndex: 100,
          }}>
            <div style={{
              padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Send Feedback</span>
              <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
                color: 'var(--text-muted)', display: 'flex',
              }}>
                <X size={16} />
              </button>
            </div>

            {sent ? (
              <div style={{
                padding: '2rem 1rem', textAlign: 'center', color: 'var(--green)', fontSize: '0.85rem',
              }}>
                <ThumbsUp size={24} style={{ marginBottom: '0.5rem' }} /><br />
                Thanks for your feedback!
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ padding: '0.75rem 1rem' }}>
                {/* Type pills */}
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                  {FEEDBACK_TYPES.map(ft => {
                    const Icon = ft.icon
                    const active = type === ft.value
                    return (
                      <button key={ft.value} type="button" onClick={() => setType(ft.value)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.2rem 0.5rem', fontSize: '0.68rem', borderRadius: '12px',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          background: active ? 'var(--accent)' : 'transparent',
                          color: active ? '#fff' : 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}>
                        <Icon size={11} /> {ft.label}
                      </button>
                    )
                  })}
                </div>

                <input
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name (optional)"
                  style={{ fontSize: '0.75rem', marginBottom: '0.4rem', width: '100%' }}
                />
                <textarea
                  value={message} onChange={e => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={3}
                  required
                  style={{ fontSize: '0.75rem', width: '100%', marginBottom: '0.4rem', resize: 'vertical' }}
                />
                {error && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--red)', marginBottom: '0.3rem' }}>{error}</div>
                )}
                <button type="submit" className="primary" disabled={sending || !message.trim()}
                  style={{ fontSize: '0.72rem', padding: '0.3em 0.8em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Send size={12} /> {sending ? 'Sending...' : 'Send Feedback'}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}
