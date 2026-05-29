'use client'

// EmptyState — consistent "nothing here" panel. Used so an empty quadrant in
// the Content review split (or any filtered list) reads as intentional rather
// than looking broken.
export default function EmptyState({ icon = '✨', title = 'Nothing here yet', message, action }) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '56px 24px', gap: 8,
        border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 12,
        background: 'rgba(255,255,255,0.015)',
      }}
    >
      <div aria-hidden="true" style={{ fontSize: 30, opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>{title}</div>
      {message && <div style={{ fontSize: 13, color: 'var(--foreground-muted)', maxWidth: 420, lineHeight: 1.5 }}>{message}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}
