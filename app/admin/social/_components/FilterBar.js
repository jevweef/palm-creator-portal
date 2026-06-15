'use client'

// FilterBar — consistent horizontal control row for filters/sort/toggles.
// Wraps on small screens; right-aligns trailing content via `right`.
export default function FilterBar({ children, right, style }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginBottom: 16, ...style,
      }}
    >
      {children}
      {right != null && <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
    </div>
  )
}

// Segmented — a small generic segmented control (used for type/sort/medium
// selectors so they all look identical to RealAiToggle's structure).
export function Segmented({ value, onChange, options = [], ariaLabel }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(o.value)}
            style={{
              padding: '6px 13px', borderRadius: 6, cursor: 'pointer',
              fontSize: 13, fontWeight: active ? 700 : 500,
              border: 'none',
              background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
              color: active ? 'var(--foreground)' : 'var(--foreground-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
