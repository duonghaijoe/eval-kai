import { AlertTriangle, X } from 'lucide-react'

export default function ConfirmModal({ open, title, message, warning, confirmText, cancelText, danger, onConfirm, onCancel, children }) {
  if (!open) return null
  return (
    <>
      {/* Backdrop */}
      <div onClick={onCancel} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        zIndex: 9998, backdropFilter: 'blur(2px)',
      }} />
      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 9999, width: 420, maxWidth: '90vw',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
            {danger && <AlertTriangle size={16} style={{ color: 'var(--red)' }} />}
            {title || 'Confirm'}
          </div>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.15rem',
            color: 'var(--text-muted)', display: 'flex',
          }}>
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div style={{ padding: '1rem' }}>
          {message && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', lineHeight: 1.5 }}>{message}</div>}
          {warning && (
            <div style={{
              fontSize: '0.75rem', color: 'var(--red)', background: 'rgba(220,38,38,0.06)',
              padding: '0.5rem 0.7rem', borderRadius: 6, marginBottom: '0.5rem',
              border: '1px solid rgba(220,38,38,0.12)',
            }}>
              {warning}
            </div>
          )}
          {children}
        </div>
        {/* Footer */}
        <div style={{
          padding: '0.6rem 1rem', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', background: 'var(--bg-primary)',
        }}>
          <button onClick={onCancel} style={{ fontSize: '0.78rem', padding: '0.35em 0.8em' }}>
            {cancelText || 'Cancel'}
          </button>
          <button onClick={onConfirm} className={danger ? 'danger' : 'primary'}
            style={{ fontSize: '0.78rem', padding: '0.35em 0.8em' }}>
            {confirmText || 'Confirm'}
          </button>
        </div>
      </div>
    </>
  )
}
