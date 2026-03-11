import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Bell, X, Megaphone, CheckCircle, XCircle, Info, Plus, Trash2, Send, MessageSquare } from 'lucide-react'
import { getNotifications, createNotification, deleteNotification } from '../api'
import { useAdmin } from '../AdminContext'

const TYPE_CONFIG = {
  feature: { icon: Megaphone, color: 'var(--blue)', label: 'Feature' },
  scenario_approved: { icon: CheckCircle, color: 'var(--green)', label: 'Approved' },
  scenario_rejected: { icon: XCircle, color: 'var(--red)', label: 'Declined' },
  scenario_submitted: { icon: Send, color: 'var(--orange)', label: 'Submitted' },
  feedback: { icon: MessageSquare, color: 'var(--accent)', label: 'Feedback' },
  info: { icon: Info, color: 'var(--text-muted)', label: 'Info' },
}

export default function NotificationPanel() {
  const { admin } = useAdmin()
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [newType, setNewType] = useState('info')

  const load = async () => {
    try {
      const data = await getNotifications()
      setNotifications(data.notifications || [])
    } catch {}
  }

  useEffect(() => { load() }, [])
  // Refresh when panel opens
  useEffect(() => { if (open) load() }, [open])

  const handleCreate = async () => {
    if (!newTitle.trim() || !newMessage.trim()) return
    try {
      await createNotification({ type: newType, title: newTitle, message: newMessage })
      setNewTitle('')
      setNewMessage('')
      setShowCreate(false)
      load()
    } catch (e) { alert(e.message) }
  }

  const handleDelete = async (id) => {
    try {
      await deleteNotification(id)
      load()
    } catch (e) { alert(e.message) }
  }

  const unread = notifications.length

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
          padding: '0.35rem', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)',
        }}
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0, background: 'var(--red)', color: '#fff',
            fontSize: '0.6rem', fontWeight: 700, borderRadius: '50%', width: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 99,
          }} />

          {/* Panel */}
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem',
            width: 380, maxHeight: 480, overflowY: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            zIndex: 100,
          }}>
            {/* Header */}
            <div style={{
              padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Notifications</span>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                {admin && (
                  <button onClick={() => setShowCreate(!showCreate)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
                    color: 'var(--accent)', display: 'flex',
                  }} title="Create announcement">
                    <Plus size={16} />
                  </button>
                )}
                <button onClick={() => setOpen(false)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
                  color: 'var(--text-muted)', display: 'flex',
                }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Create form (admin) */}
            {showCreate && admin && (
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                <select value={newType} onChange={e => setNewType(e.target.value)}
                  style={{ fontSize: '0.72rem', padding: '0.25em 0.4em', marginBottom: '0.4rem', width: '100%' }}>
                  <option value="info">Info</option>
                  <option value="feature">Feature Release</option>
                </select>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                  placeholder="Title" style={{ fontSize: '0.75rem', marginBottom: '0.3rem', width: '100%' }} />
                <textarea value={newMessage} onChange={e => setNewMessage(e.target.value)}
                  placeholder="Message..." rows={2} style={{ fontSize: '0.72rem', width: '100%', marginBottom: '0.3rem' }} />
                <button onClick={handleCreate} className="primary" style={{ fontSize: '0.7rem', padding: '0.25em 0.6em' }}>
                  Post
                </button>
              </div>
            )}

            {/* List */}
            {notifications.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No notifications yet
              </div>
            ) : (
              notifications.map(n => {
                const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.info
                const Icon = cfg.icon
                return (
                  <div key={n.id} style={{
                    padding: '0.65rem 1rem', borderBottom: '1px solid var(--border)',
                    display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                  }}>
                    <Icon size={16} style={{ color: cfg.color, marginTop: '0.15rem', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.15rem' }}>{n.title}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{n.message}</div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        {new Date(n.created_at + 'Z').toLocaleString()}
                        {n.link && (
                          <Link to={n.link} onClick={() => setOpen(false)}
                            style={{ marginLeft: '0.5rem', color: 'var(--accent)', textDecoration: 'none' }}>
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                    {admin && (
                      <button onClick={() => handleDelete(n.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '0.15rem',
                        color: 'var(--text-muted)', display: 'flex', flexShrink: 0,
                      }} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
