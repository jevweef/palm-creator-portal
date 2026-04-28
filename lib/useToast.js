'use client'

import { useState, useCallback } from 'react'

/**
 * Lightweight toast hook.
 *
 * Usage:
 *   const { toast, ToastViewport } = useToast()
 *   toast('Saved')                       // info
 *   toast('Delete failed', 'error')
 *   toast('Folder ready', 'success')
 *   toast('Heads up — link unavailable', 'warning', { duration: 6000 })
 *
 *   <ToastViewport />                    // render at root of page
 */
export function useToast() {
  const [items, setItems] = useState([])

  const dismiss = useCallback((id) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message, kind = 'info', { duration = 4500 } = {}) => {
    const id = Math.random().toString(36).slice(2)
    setItems(prev => [...prev, { id, message, kind }])
    if (duration > 0) setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  const ToastViewport = useCallback(() => (
    <div style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 200,
      display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: 'calc(100vw - 48px)',
    }}>
      {items.map(t => {
        const c = TOAST_STYLES[t.kind] || TOAST_STYLES.info
        return (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              padding: '12px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: 500,
              background: c.bg, color: c.color, border: `1px solid ${c.border}`,
              boxShadow: '0 6px 20px rgba(0,0,0,0.18)', cursor: 'pointer',
              maxWidth: '420px', lineHeight: 1.4,
              animation: 'palmToastIn 0.2s ease-out',
            }}
          >
            {t.message}
          </div>
        )
      })}
      <style>{`
        @keyframes palmToastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  ), [items, dismiss])

  return { toast, ToastViewport, dismiss }
}

const TOAST_STYLES = {
  info:    { bg: 'rgba(120, 180, 232, 0.10)', color: '#A8CCEF', border: 'rgba(120, 180, 232, 0.25)' },
  success: { bg: 'rgba(125, 211, 164, 0.10)', color: '#7DD3A4', border: 'rgba(125, 211, 164, 0.25)' },
  warning: { bg: 'rgba(232, 200, 120, 0.10)', color: '#E8C878', border: 'rgba(232, 200, 120, 0.25)' },
  error:   { bg: 'rgba(232, 120, 120, 0.10)', color: '#E87878', border: 'rgba(232, 120, 120, 0.25)' },
}
