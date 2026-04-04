'use client'

export default function QuotaBar({ used, target }) {
  const pct = target > 0 ? Math.min((used / target) * 100, 100) : 0
  const isComplete = used >= target

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
      <div style={{
        flex: 1,
        height: '8px',
        background: '#F0E0E4',
        borderRadius: '9999px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: isComplete ? '#4ade80' : pct >= 80 ? '#facc15' : '#E88FAC',
          borderRadius: '9999px',
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{
        fontSize: '13px',
        color: isComplete ? '#16a34a' : '#888',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {used} of {target} reels this week
      </span>
    </div>
  )
}
