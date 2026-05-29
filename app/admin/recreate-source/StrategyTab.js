'use client'

// Placeholder until Batch 3 ships the "what's next for [creator]" engine.
// Plan: docs/build-plans/smm-consolidation/batch-3-content-strategy.md
export default function StrategyTab() {
  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Content Strategy</h2>
      <p style={{ marginTop: 12, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
        "What's next for [creator]?" — the engine that picks the next carousel or reel to feed
        TJP, rotates pillars, manages variations, and pre-fills tomorrow's posts. Eliminates the
        "wait, what should I queue for Amelia next?" decision.
      </p>

      <div style={{
        marginTop: 24,
        padding: 20,
        border: '1px dashed rgba(255,255,255,0.15)',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
          Shipping in Batch 3
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--foreground-muted)' }}>
          One-time pillar backfill across Recreate Reels + Carousel Projects + Inspiration +
          Assets using Claude Haiku 4.5 (≈$4 total). Then a daily cron pre-fills tomorrow's posts
          per creator content plan.
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--foreground-subtle)' }}>
          Detailed plan: <code>docs/build-plans/smm-consolidation/batch-3-content-strategy.md</code>
        </div>
      </div>
    </div>
  )
}
