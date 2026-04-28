'use client'

// Styled replacement for window.confirm. Reusable across the app.
// Usage:
//   const [dialog, setDialog] = useState(null)
//   setDialog({ title, message, onConfirm, confirmLabel?, cancelLabel?, danger? })
//   <ConfirmModal dialog={dialog} onClose={() => setDialog(null)} />

export default function ConfirmModal({ dialog, onClose }) {
  if (!dialog) return null
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, danger = false } = dialog
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '14px',
        width: '100%', maxWidth: '380px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}>
        {title && <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)' }}>{title}</div>}
        <div style={{ fontSize: '13px', lineHeight: 1.55, color: 'var(--foreground-muted)' }}>{message}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', fontSize: '12px', fontWeight: 600,
              background: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', cursor: 'pointer',
            }}
          >{cancelLabel}</button>
          <button
            onClick={() => { onConfirm?.(); onClose() }}
            style={{
              padding: '8px 16px', fontSize: '12px', fontWeight: 700,
              background: danger ? 'rgba(239, 68, 68, 0.12)' : 'rgba(232, 160, 160, 0.15)',
              color: danger ? '#ef4444' : 'var(--palm-pink)',
              border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'rgba(232,160,160,0.3)'}`,
              borderRadius: '8px', cursor: 'pointer',
            }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
