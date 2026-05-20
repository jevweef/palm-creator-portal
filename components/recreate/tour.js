'use client'

// Lightweight guided tour for the AI Recreate workflow.
//
// Why custom and not a library: we want zero new deps, full control
// over copy and step gating (skip steps whose target doesn't exist
// yet), and easy re-triggering from a "? Guide" button. The whole
// thing is ~250 LOC.
//
// Usage:
//   <GuidedTour steps={STEPS} storageKey="ai-editor-v1" />
//
// Each step:
//   {
//     target: '#tour-creator-picker'  // CSS selector — optional
//     title: 'Pick a creator',
//     body: 'Long explanation…',       // string or JSX
//     placement: 'bottom' | 'top' | 'right' | 'left' | 'center',
//     // If target is missing OR placement is 'center', the tooltip
//     // floats in the middle of the screen instead of next to a thing.
//   }
//
// localStorage gate: a key prefix lets the tour auto-show on first
// visit and stay dismissed thereafter. The "? Guide" button passes
// `force` to bypass the gate.

import { useEffect, useState, useCallback } from 'react'

const STORAGE_PREFIX = 'palm-tour-seen-'

// External API: imperatively re-launch the tour from a button somewhere
// else on the page. Components subscribe via `useTourTrigger(key)`.
const _triggerListeners = new Map() // key -> [fns]
export function startTour(storageKey) {
  const fns = _triggerListeners.get(storageKey) || []
  fns.forEach(fn => fn())
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)) }

function getTargetRect(selector) {
  if (!selector || typeof document === 'undefined') return null
  const el = document.querySelector(selector)
  if (!el) return null
  // Scroll element into view so the tour anchor is on screen.
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }) } catch {}
  return el.getBoundingClientRect()
}

export function GuidedTour({ steps, storageKey }) {
  const [active, setActive] = useState(false)
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState(null)
  const [vp, setVp] = useState({ w: 0, h: 0 })

  // Auto-launch on first visit; subscribe to imperative re-launches.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setVp({ w: window.innerWidth, h: window.innerHeight })
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)

    let firstVisit = false
    try {
      if (!localStorage.getItem(STORAGE_PREFIX + storageKey)) firstVisit = true
    } catch {}
    if (firstVisit) {
      // Defer a tick so the page paints first.
      setTimeout(() => { setActive(true); setIdx(0) }, 400)
    }

    const trigger = () => { setActive(true); setIdx(0) }
    const arr = _triggerListeners.get(storageKey) || []
    arr.push(trigger)
    _triggerListeners.set(storageKey, arr)

    return () => {
      window.removeEventListener('resize', onResize)
      const cur = _triggerListeners.get(storageKey) || []
      _triggerListeners.set(storageKey, cur.filter(fn => fn !== trigger))
    }
  }, [storageKey])

  // Recompute target rect when the active step changes (or on resize).
  // The DOM may not have the target yet on early mount — poll briefly.
  useEffect(() => {
    if (!active || !steps?.[idx]) return
    const sel = steps[idx].target
    if (!sel) { setRect(null); return }
    let cancelled = false
    let tries = 0
    const tick = () => {
      if (cancelled) return
      const r = getTargetRect(sel)
      if (r) { setRect(r); return }
      tries++
      if (tries < 10) setTimeout(tick, 200)
      else setRect(null) // give up — render center
    }
    tick()
    return () => { cancelled = true }
  }, [active, idx, steps, vp])

  const finish = useCallback(() => {
    try { localStorage.setItem(STORAGE_PREFIX + storageKey, '1') } catch {}
    setActive(false); setIdx(0); setRect(null)
  }, [storageKey])

  const next = () => {
    if (idx >= steps.length - 1) finish()
    else setIdx(i => i + 1)
  }
  const prev = () => { if (idx > 0) setIdx(i => i - 1) }

  if (!active || !steps?.length) return null
  const step = steps[idx]
  const placement = step.placement || (rect ? 'bottom' : 'center')
  const isCenter = placement === 'center' || !rect

  // Tooltip positioning math. Center is straightforward. Around-a-target
  // placements clamp to the viewport so the tooltip never spills.
  const tipW = Math.min(380, vp.w - 24)
  const tipPos = (() => {
    if (isCenter) return { left: (vp.w - tipW) / 2, top: vp.h * 0.25 }
    const margin = 14
    const tipHGuess = 220
    if (placement === 'bottom') {
      let top = rect.bottom + margin
      let left = rect.left + (rect.width / 2) - (tipW / 2)
      // flip up if no room below
      if (top + tipHGuess > vp.h - 12) top = Math.max(12, rect.top - margin - tipHGuess)
      return { top, left: clamp(left, 12, vp.w - tipW - 12) }
    }
    if (placement === 'top') {
      let top = Math.max(12, rect.top - margin - tipHGuess)
      let left = rect.left + (rect.width / 2) - (tipW / 2)
      return { top, left: clamp(left, 12, vp.w - tipW - 12) }
    }
    if (placement === 'right') {
      let left = rect.right + margin
      let top = rect.top + (rect.height / 2) - (tipHGuess / 2)
      if (left + tipW > vp.w - 12) left = Math.max(12, rect.left - margin - tipW)
      return { top: clamp(top, 12, vp.h - tipHGuess - 12), left }
    }
    if (placement === 'left') {
      let left = Math.max(12, rect.left - margin - tipW)
      let top = rect.top + (rect.height / 2) - (tipHGuess / 2)
      return { top: clamp(top, 12, vp.h - tipHGuess - 12), left }
    }
    return { top: 80, left: 24 }
  })()

  return (
    <>
      {/* Backdrop — dims everything. Clicking it does NOT dismiss (the
          editor must hit Skip or finish the tour); avoids accidental
          dismissals when they click to interact with the highlighted
          element. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

      {/* Spotlight ring around the target — pure CSS box-shadow trick
          gives a soft glow without SVG masking. */}
      {!isCenter && rect && (
        <div style={{
          position: 'fixed',
          zIndex: 3501,
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
          borderRadius: 10,
          border: '2px solid var(--palm-pink, #e8a0a0)',
          boxShadow: '0 0 0 4px rgba(232,160,160,0.25), 0 0 28px 6px rgba(232,160,160,0.35)',
          pointerEvents: 'none',
          animation: 'tour-pulse 1.4s ease-in-out infinite',
        }} />
      )}
      <style jsx global>{`
        @keyframes tour-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(232,160,160,0.25), 0 0 28px 6px rgba(232,160,160,0.35); }
          50%      { box-shadow: 0 0 0 6px rgba(232,160,160,0.35), 0 0 36px 10px rgba(232,160,160,0.5); }
        }
      `}</style>

      {/* Tooltip card */}
      <div style={{
        position: 'fixed',
        zIndex: 3502,
        top: tipPos.top,
        left: tipPos.left,
        width: tipW,
        background: '#16161c',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Step {idx + 1} of {steps.length}
          </div>
          <button onClick={finish}
            style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}
            title="Skip the tour">✕</button>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground, #eee)', marginBottom: 8 }}>{step.title}</div>
        <div style={{ fontSize: 13, color: 'var(--foreground, #ddd)', lineHeight: 1.55, marginBottom: 16, whiteSpace: 'pre-wrap' }}>{step.body}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button onClick={finish}
            style={{ padding: '6px 0', fontSize: 12, color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Skip the tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {idx > 0 && (
              <button onClick={prev}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, cursor: 'pointer' }}>
                Back
              </button>
            )}
            <button onClick={next}
              style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink, #e8a0a0)', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
              {idx >= steps.length - 1 ? 'Got it' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Convenience: a "? Guide" button that re-launches a tour by its
// storage key. Drop it in the page header.
export function TourTriggerButton({ storageKey, label = '? Guide' }) {
  return (
    <button onClick={() => startTour(storageKey)}
      title="Re-launch the guided tour"
      style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink, #e8a0a0)', border: '1px solid rgba(232,160,160,0.3)', borderRadius: 6, cursor: 'pointer' }}>
      {label}
    </button>
  )
}
