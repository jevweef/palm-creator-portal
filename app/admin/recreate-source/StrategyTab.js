'use client'

// Content Strategy Engine — design locked 2026-05-29, awaiting Evan's pillar
// confirmation before the engine is built. Spec:
// docs/build-plans/smm-consolidation/HUB-REDESIGN-SPEC.md (Phase 7).
const PROPOSED_PILLARS = ['Lifestyle', 'Fitness', 'Flirty', 'BTS', 'Fashion', 'Trend-Reaction', 'Q&A']

export default function StrategyTab({ maxWidth = 760 } = {}) {
  const widthStyle = maxWidth === 'none' || maxWidth == null ? { width: '100%' } : { maxWidth }
  return (
    <div style={{ padding: 32, ...widthStyle }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Content Strategy</h2>
      <p style={{ marginTop: 12, color: 'var(--foreground-muted)', lineHeight: 1.5, maxWidth: 720 }}>
        &quot;What&apos;s next for [creator]?&quot; — picks the next reel or carousel to queue. It keeps a
        content-category (pillar) taxonomy AND lets each creator&apos;s DNA profile weigh in as a thumb
        on the scale, so suggestions fit the creator instead of a flat rotation. Validated on
        Amelia (Briel) first.
      </p>

      <div style={{ marginTop: 24, padding: 20, border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
          Needs your input before build
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--foreground-muted)', lineHeight: 1.6 }}>
          Confirm / edit the content-category list. Proposed:
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PROPOSED_PILLARS.map(p => (
            <span key={p} style={{ padding: '4px 11px', borderRadius: 9999, fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--foreground)' }}>{p}</span>
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--foreground-subtle)', lineHeight: 1.6 }}>
          DNA profile = the AI-generated creator profile in the Creators tab (Profile Summary, Brand
          Voice, Content Direction, Dos/Don&apos;ts, weighted tags). Once the list is confirmed: a
          one-time pillar backfill across Recreate Reels + Carousel Projects + Inspiration + Assets,
          then a daily pre-fill of tomorrow&apos;s posts per creator.
        </div>
      </div>
    </div>
  )
}
