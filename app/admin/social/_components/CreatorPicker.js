'use client'

// CreatorPicker — the single creator <select>, standardizing the ad-hoc
// dropdowns duplicated in UnreviewedLibrary and ForReview. Pass a list of
// { id, name } (optionally with counts) and the controlled value.

export default function CreatorPicker({
  value = 'all',
  onChange,
  creators = [],
  includeAll = true,
  allLabel,
  ariaLabel = 'Filter by creator',
}) {
  const total = creators.reduce((n, c) => n + (c.count || 0), 0)
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      style={{
        padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
        background: 'var(--background)', color: 'var(--foreground)',
        border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', minWidth: 160,
      }}
    >
      {includeAll && (
        <option value="all">{allLabel || `All Creators${total ? ` (${total})` : ''}`}</option>
      )}
      {creators.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}{typeof c.count === 'number' ? ` (${c.count})` : ''}
        </option>
      ))}
    </select>
  )
}
