'use client'

import { useRef } from 'react'

/**
 * Backdrop click-to-dismiss handler that doesn't fire on drag-select.
 *
 * The naive `onClick={e => e.target === e.currentTarget && close()}` pattern
 * triggers when a user drags to highlight text inside the modal and releases
 * outside (or anywhere) — because the click event records `target` based on
 * mouseup. This loses unsaved input data.
 *
 * Fix: only dismiss when BOTH mousedown AND mouseup landed on the backdrop.
 *
 * Usage:
 *   const dismiss = useBackdropDismiss(onClose, () => !submitting)
 *   <div {...dismiss}>...</div>
 */
export function useBackdropDismiss(onClose, condition = () => true) {
  const downOnBackdropRef = useRef(false)

  return {
    onMouseDown: (e) => {
      downOnBackdropRef.current = e.target === e.currentTarget
    },
    onMouseUp: (e) => {
      if (
        downOnBackdropRef.current &&
        e.target === e.currentTarget &&
        condition()
      ) {
        onClose()
      }
      downOnBackdropRef.current = false
    },
  }
}
