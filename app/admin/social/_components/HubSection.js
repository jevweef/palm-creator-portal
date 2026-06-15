'use client'

// HubSection — the single body container for every Social Media Hub section.
// The admin <main> already supplies outer padding (24px 32px), so this just
// owns WIDTH: full-width by default (every section body matches), with an
// optional max-width cap for surfaces that genuinely want one.
//
// Use it to wrap each section body so widths are defined in ONE place instead
// of each reused component setting its own maxWidth/centering (the cause of the
// "Setup is narrow, Overview isn't" inconsistency).
export default function HubSection({ children, maxWidth = 'none', style }) {
  const widthStyle =
    maxWidth === 'none' || maxWidth == null
      ? { width: '100%' }
      : { maxWidth, margin: '0 auto', width: '100%' }
  return <div style={{ ...widthStyle, ...style }}>{children}</div>
}
