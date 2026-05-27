'use client'

// Placeholder until Batch 2 ships the per-account day-counter UI for the 3
// in-flight AI personas (Brielle / Lily / Katie Rosie).
// Plan: docs/build-plans/smm-consolidation/batch-2-warmup-flow.md
export default function WarmupTab() {
  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Account Warm-Up</h2>
      <p style={{ marginTop: 12, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
        Per-account 90-day daily task lists for AI personas. The operator opens this page once a
        day and sees today's checklist for every warming-up account — credentials, bio steps,
        engagement quotas, link-in-bio timing, and today's manual posts.
      </p>

      <div style={{
        marginTop: 24,
        padding: 20,
        border: '1px dashed rgba(255,255,255,0.15)',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
          Shipping in Batch 2
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--foreground-muted)' }}>
          Three accounts queued for the first warm-up cohort: <strong>Brielle</strong> (Amelia),{' '}
          <strong>Lily</strong> (Gracie), <strong>Katie Rosie</strong> (standalone). Hardware
          prereqs (Pixel 8a + GrapheneOS + Mint SIM + clean agency FB) are user-side blockers — not
          code blockers.
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--foreground-subtle)' }}>
          Detailed plan: <code>docs/build-plans/smm-consolidation/batch-2-warmup-flow.md</code>
        </div>
      </div>
    </div>
  )
}
