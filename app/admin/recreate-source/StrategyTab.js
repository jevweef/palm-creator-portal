'use client'

import { useState, useEffect } from 'react'

// Content Strategy — the pillar taxonomy is now editable here (persisted
// locally) so Evan can shape the "what to post next" buckets without a code
// change. The ranking/auto-queue engine reads this list once the one-time
// pillar backfill + daily cron are built (deferred — see HUB-REDESIGN-SPEC.md).
const DEFAULT_PILLARS = ['Lifestyle', 'Fitness', 'Flirty', 'BTS', 'Fashion', 'Trend-Reaction', 'Q&A']
const STORE_KEY = 'smm-strategy-pillars'

export default function StrategyTab({ maxWidth = 760 } = {}) {
  const widthStyle = maxWidth === 'none' || maxWidth == null ? { width: '100%' } : { maxWidth }
  const [pillars, setPillars] = useState(DEFAULT_PILLARS)
  const [draft, setDraft] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (Array.isArray(saved) && saved.length) setPillars(saved)
    } catch { /* ignore */ }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(STORE_KEY, JSON.stringify(pillars)) } catch { /* ignore */ }
  }, [pillars, loaded])

  const addPillar = () => {
    const v = draft.trim()
    if (v && !pillars.some(p => p.toLowerCase() === v.toLowerCase())) setPillars([...pillars, v])
    setDraft('')
  }
  const removePillar = (p) => setPillars(pillars.filter(x => x !== p))
  const isDefault = pillars.length === DEFAULT_PILLARS.length && pillars.every((p, i) => p === DEFAULT_PILLARS[i])

  return (
    <div style={{ padding: 32, ...widthStyle }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Content Strategy</h2>
      <p style={{ marginTop: 12, color: 'var(--foreground-muted)', lineHeight: 1.5, maxWidth: 720 }}>
        &quot;What&apos;s next for [creator]?&quot; — the engine picks the next reel or carousel to queue. It
        keeps the content-category (pillar) taxonomy below AND lets each creator&apos;s DNA profile weigh
        in as a thumb on the scale, so suggestions fit the creator instead of a flat rotation.
      </p>

      {/* Editable pillar taxonomy */}
      <div style={{ marginTop: 24, padding: 20, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>Content pillars</div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--foreground-muted)', lineHeight: 1.6 }}>
          The &quot;what to post next&quot; buckets. Edit them to match how you think about content — this list drives the engine.
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {pillars.map(p => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 8px 5px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600, background: 'rgba(232,160,160,0.10)', border: '1px solid rgba(232,160,160,0.25)', color: 'var(--foreground)' }}>
              {p}
              <button onClick={() => removePillar(p)} aria-label={`Remove ${p}`}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 9999, border: 'none', background: 'rgba(255,255,255,0.08)', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPillar() } }}
            placeholder="Add a pillar…"
            aria-label="Add a content pillar"
            style={{ padding: '7px 12px', fontSize: 13, borderRadius: 8, background: 'var(--background)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none', minWidth: 180 }}
          />
          <button onClick={addPillar}
            style={{ padding: '7px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: '1px solid var(--palm-pink)', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', cursor: 'pointer' }}>Add</button>
          {!isDefault && (
            <button onClick={() => setPillars(DEFAULT_PILLARS)}
              style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer' }}>Reset to defaults</button>
          )}
        </div>
      </div>

      {/* Engine status — honest about what's still to build */}
      <div style={{ marginTop: 16, padding: 16, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12, color: 'var(--foreground-subtle)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--foreground-muted)' }}>Engine status.</strong> Your pillar list is saved.
        Per-creator ranking + auto-queue go live once the one-time pillar backfill runs (across Recreate Reels +
        Carousel Projects + Inspiration + Assets) and the daily pre-fill cron is enabled. DNA profile = the creator&apos;s
        AI profile in the Creators tab (brand voice, content direction, weighted tags).
      </div>
    </div>
  )
}
