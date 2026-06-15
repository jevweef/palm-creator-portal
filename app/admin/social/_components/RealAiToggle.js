'use client'

// RealAiToggle — the unmistakable Real vs AI segmented control.
// Real and AI must NEVER look alike (the load-bearing rule). Real uses the
// palm-pink family already in the app; AI uses the purple (#a78bfa) family
// already used by CaptionSuggestions — so the color language is consistent
// with existing surfaces while being impossible to confuse.
//
// Active side is FILLED (not just bordered), large hit target. Pair with the
// textual state line in the consuming surface ("Reviewing: AI Reels — Amelia").

const SIDES = {
  real: { label: 'Real', color: 'var(--palm-pink)', fill: 'rgba(232,160,160,0.16)' },
  ai: { label: 'AI', color: '#a78bfa', fill: 'rgba(167,139,250,0.18)' },
}

export default function RealAiToggle({ value = 'real', onChange, size = 'md' }) {
  const pad = size === 'sm' ? '6px 14px' : '9px 20px'
  const font = size === 'sm' ? 13 : 14
  return (
    <div
      role="tablist"
      aria-label="Real or AI content"
      style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 9999, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {['real', 'ai'].map((k) => {
        const s = SIDES[k]
        const active = value === k
        return (
          <button
            key={k}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(k)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: pad, borderRadius: 9999, cursor: 'pointer',
              fontSize: font, fontWeight: active ? 800 : 600, letterSpacing: '-0.01em',
              border: `1.5px solid ${active ? s.color : 'transparent'}`,
              background: active ? s.fill : 'transparent',
              color: active ? s.color : 'var(--foreground-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

export { SIDES as REAL_AI_SIDES }
