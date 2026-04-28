'use client'

import { useState, useCallback, useRef } from 'react'
import { useBackdropDismiss } from '@/lib/useBackdropDismiss'

/**
 * Styled confirm dialog — replaces window.confirm().
 *
 * Usage:
 *   const { confirm, ConfirmDialog } = useConfirm()
 *
 *   const ok = await confirm({
 *     title: 'Delete project?',
 *     message: 'The Dropbox folder and its files will stay in Dropbox, but the project record and upload link will be removed.',
 *     confirmLabel: 'Delete',
 *     cancelLabel: 'Cancel',
 *     destructive: true,                         // styles confirm button red
 *     requireDoubleConfirm: true,                // for "no undo" actions — second screen with retyped action label
 *   })
 *   if (ok) doTheThing()
 *
 *   <ConfirmDialog />                            // render at root of page
 */
export function useConfirm() {
  const [state, setState] = useState(null)
  const resolveRef = useRef(null)

  const confirm = useCallback((opts) => {
    return new Promise(resolve => {
      resolveRef.current = resolve
      setState({ stage: 1, ...opts })
    })
  }, [])

  const close = useCallback((result) => {
    resolveRef.current?.(result)
    resolveRef.current = null
    setState(null)
  }, [])

  const advance = () => setState(s => ({ ...s, stage: 2 }))

  const ConfirmDialog = useCallback(() => {
    if (!state) return null
    return (
      <ConfirmDialogInner
        state={state}
        onCancel={() => close(false)}
        onAdvance={advance}
        onConfirm={() => close(true)}
      />
    )
  }, [state, close])

  return { confirm, ConfirmDialog }
}

function ConfirmDialogInner({ state, onCancel, onAdvance, onConfirm }) {
  const dismiss = useBackdropDismiss(onCancel)
  const isFirstStage = state.stage === 1
  const needsDouble = state.requireDoubleConfirm && isFirstStage

  const onPrimary = needsDouble ? onAdvance : onConfirm

  const primaryColor = state.destructive ? '#E87878' : '#1a1a1a'
  const primaryBg = state.destructive ? 'rgba(232, 120, 120, 0.15)' : 'var(--palm-pink)'
  const primaryBorder = state.destructive ? '1px solid rgba(232, 120, 120, 0.45)' : 'none'

  const headline = isFirstStage
    ? (state.title || 'Are you sure?')
    : (state.doubleConfirmTitle || `Really ${(state.confirmLabel || 'continue').toLowerCase()}?`)
  const body = isFirstStage
    ? state.message
    : (state.doubleConfirmMessage || 'There is no undo for this action.')

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      {...dismiss}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '460px',
        margin: '24px', padding: '24px 26px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        animation: 'palmConfirmIn 0.18s ease-out',
      }}>
        <h3 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--foreground)', margin: 0, marginBottom: '10px' }}>
          {headline}
        </h3>
        {body && (
          <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: 0, marginBottom: '20px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {body}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 18px', fontSize: '12px', fontWeight: 600,
              background: 'transparent', color: 'var(--foreground-muted)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: '9999px', cursor: 'pointer',
            }}
          >{state.cancelLabel || 'Cancel'}</button>
          <button
            onClick={onPrimary}
            autoFocus
            style={{
              padding: '9px 22px', fontSize: '12px', fontWeight: 600,
              background: primaryBg, color: primaryColor, border: primaryBorder,
              borderRadius: '9999px', cursor: 'pointer',
            }}
          >{needsDouble ? (state.confirmLabel || 'Continue') : (state.confirmLabel || 'Confirm')}</button>
        </div>
        <style>{`
          @keyframes palmConfirmIn {
            from { opacity: 0; transform: translateY(8px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </div>
  )
}
