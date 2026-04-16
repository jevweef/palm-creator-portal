'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = n => {
  if (n >= 10000) return '$' + (n / 1000).toFixed(1) + 'k'
  return fmt(n)
}
const pct = n => (n * 100).toFixed(0) + '%'
const deltaPct = n => {
  if (n === null || n === undefined) return null
  const sign = n >= 0 ? '+' : ''
  return sign + (n * 100).toFixed(0) + '%'
}

const CARD = {
  background: '#ffffff',
  borderRadius: '18px',
  padding: '20px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
}

const SECTION_TITLE = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#999',
  marginBottom: '12px',
}

const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#999',
}

/* ─── Stat Card with optional delta ─── */
function StatCard({ label, value, sub, color, delta }) {
  const deltaStr = deltaPct(delta)
  const deltaColor = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#999'
  return (
    <div style={{ ...CARD, flex: '1 1 160px', minWidth: '140px' }}>
      <div style={LABEL}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
        <span style={{ fontSize: '28px', fontWeight: 700, color: color || '#1a1a1a' }}>{value}</span>
        {deltaStr && (
          <span style={{ fontSize: '12px', fontWeight: 600, color: deltaColor }}>{deltaStr}</span>
        )}
      </div>
      {sub && <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

/* ─── Status Badge (only renders for non-Draft) ─── */
function StatusBadge({ status }) {
  if (!status || status === 'Draft') return null
  const colors = { Paid: '#22c55e', Sent: '#3b82f6', Overdue: '#ef4444' }
  const bg = { Paid: '#f0fdf4', Sent: '#eff6ff', Overdue: '#fef2f2' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
      fontSize: '11px', fontWeight: 600,
      color: colors[status] || '#999', background: bg[status] || '#f5f5f5',
    }}>
      {status}
    </span>
  )
}

/* ─── Mini Trend Bar (oldest→newest, left→right) ─── */
function TrendBar({ values, delta }) {
  if (!values || !values.length) return null
  const max = Math.max(...values, 1)
  const deltaColor = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#999'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '28px' }}>
        {values.map((v, i) => (
          <div key={i} style={{
            width: '10px',
            height: `${Math.max(2, (v / max) * 28)}px`,
            background: i === values.length - 1 ? '#E88FAC' : '#f3d1dc',
            borderRadius: '2px',
          }} />
        ))}
      </div>
      {delta !== null && delta !== undefined && (
        <span style={{ fontSize: '10px', fontWeight: 600, color: deltaColor, marginLeft: '4px' }}>
          {deltaPct(delta)}
        </span>
      )}
    </div>
  )
}

/* ─── Runway Bar ─── */
function RunwayBar({ days }) {
  const color = days < 1 ? '#ef4444' : days < 2 ? '#f59e0b' : '#22c55e'
  const bg = days < 1 ? '#fef2f2' : days < 2 ? '#fffbeb' : '#f0fdf4'
  const width = Math.min(100, (days / 7) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          width: `${width}%`, height: '100%', background: color, borderRadius: '3px',
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{
        fontSize: '13px', fontWeight: 700, color, background: bg,
        padding: '2px 6px', borderRadius: '4px', minWidth: '40px', textAlign: 'center',
      }}>
        {days}d
      </span>
    </div>
  )
}

/* ─── Alert Pill ─── */
function AlertPill({ alert }) {
  const config = {
    low_runway: { color: '#ef4444', bg: '#fef2f2', icon: '!', label: `${alert.creator}: ${alert.bufferDays}d runway` },
    overdue_invoice: { color: '#ef4444', bg: '#fef2f2', icon: '$', label: `${alert.creator}: overdue` },
    revision_stuck: { color: '#f59e0b', bg: '#fffbeb', icon: '!', label: `${alert.creator}: ${alert.count} revision${(alert.count || 0) > 1 ? 's' : ''}` },
    analysis_errors: { color: '#f59e0b', bg: '#fffbeb', icon: '!', label: `${alert.count} analysis error${(alert.count || 0) > 1 ? 's' : ''}` },
    empty_library: { color: '#f59e0b', bg: '#fffbeb', icon: '0', label: `${alert.creator}: no content` },
  }
  const c = config[alert.type] || { color: '#999', bg: '#f5f5f5', icon: '?', label: alert.type }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px',
      fontWeight: 600, color: c.color, background: c.bg,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.color, flexShrink: 0 }} />
      {c.label}
    </span>
  )
}

/* ─── Mini Calendar (7 days) ─── */
function MiniCalendar({ calendar }) {
  const days = Object.entries(calendar)
  return (
    <div style={{ display: 'flex', gap: '3px' }}>
      {days.map(([date, count]) => {
        const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })
        const bg = count >= 2 ? '#22c55e' : count === 1 ? '#fbbf24' : '#f0f0f0'
        const color = count >= 2 ? '#fff' : count === 1 ? '#78350f' : '#ccc'
        return (
          <div key={date} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: '#999', marginBottom: '2px' }}>{dayLabel}</div>
            <div style={{
              width: '22px', height: '22px', borderRadius: '4px',
              background: bg, color, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '10px', fontWeight: 600,
            }}>
              {count || ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Format period label to be human-readable ─── */
function formatPeriodLabel(label) {
  if (!label) return ''
  return label.replace(/^\d{4}-\d{2}\s*/, '')
}

/* ─── Monotone cubic spline SVG path ─── */
function buildMonotonePath(pts) {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`
  const n = pts.length
  const slopes = []
  for (let i = 0; i < n; i++) {
    if (i === 0) slopes.push((pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0] || 1))
    else if (i === n - 1) slopes.push((pts[n-1][1] - pts[n-2][1]) / (pts[n-1][0] - pts[n-2][0] || 1))
    else {
      const d0 = (pts[i][1] - pts[i-1][1]) / (pts[i][0] - pts[i-1][0] || 1)
      const d1 = (pts[i+1][1] - pts[i][1]) / (pts[i+1][0] - pts[i][0] || 1)
      slopes.push(d0 * d1 <= 0 ? 0 : (d0 + d1) / 2)
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i+1][0] - pts[i][0]) / 5
    d += `C${(pts[i][0]+dx).toFixed(1)},${(pts[i][1]+slopes[i]*dx).toFixed(1)},${(pts[i+1][0]-dx).toFixed(1)},${(pts[i+1][1]-slopes[i+1]*dx).toFixed(1)},${pts[i+1][0].toFixed(1)},${pts[i+1][1].toFixed(1)}`
  }
  return d
}

function fmtChartMoney(v) {
  return '$' + Math.round(v).toLocaleString('en-US')
}

function fmtChartDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, day] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y.slice(2)}`
}

const CREATOR_COLORS = {
  Laurel: '#E88FAC',
  Taby: '#60a5fa',
  MG: '#fb923c',
  Sunny: '#a78bfa',
  Gracie: '#34d399',
  Amelia: '#f472b6',
  Raya: '#38bdf8',
  'Ocean Ray': '#fbbf24',
  Amara: '#818cf8',
  'Meadow Marie': '#4ade80',
}
const EARNINGS_CREATORS = ['Laurel', 'Amelia', 'Taby', 'Gracie', 'MG', 'Sunny', 'Raya', 'Ocean Ray', 'Amara', 'Meadow Marie']
const PERIODS = [
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'last90', label: 'Last 90 Days' },
  { key: 'mtd', label: 'Month to Date' },
  { key: 'ytd', label: 'Year to Date' },
  { key: 'all', label: 'All Time' },
]

/* ─── Agency Revenue Chart ─── */
function AgencyRevenueChart({ earningsData, earningsLoading }) {
  const [hover, setHover] = useState(null)
  const [period, setPeriod] = useState('last30')
  const [enabledCreators, setEnabledCreators] = useState(new Set(EARNINGS_CREATORS))
  const [showDropdown, setShowDropdown] = useState(false)
  const svgRef = useRef(null)
  const dropdownRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Combine all creator daily data into unified timeline
  const chartData = useMemo(() => {
    if (!earningsData) return []
    const dayMap = {} // date → { total, byCreator }

    for (const [creator, data] of Object.entries(earningsData)) {
      if (!enabledCreators.has(creator) || !data?.dailyData) continue
      for (const d of data.dailyData) {
        if (!dayMap[d.date]) dayMap[d.date] = { date: d.date, total: 0, byCreator: {} }
        dayMap[d.date].total += d.net
        dayMap[d.date].byCreator[creator] = (dayMap[d.date].byCreator[creator] || 0) + d.net
      }
    }

    let days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))

    // Apply period filter
    if (days.length > 0) {
      const now = new Date()
      const todayStr = now.toISOString().split('T')[0]
      let cutoff = null
      if (period === 'last30') {
        const d = new Date(now); d.setDate(d.getDate() - 30); cutoff = d.toISOString().split('T')[0]
      } else if (period === 'last90') {
        const d = new Date(now); d.setDate(d.getDate() - 90); cutoff = d.toISOString().split('T')[0]
      } else if (period === 'mtd') {
        cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
      } else if (period === 'ytd') {
        cutoff = `${now.getFullYear()}-01-01`
      }
      if (cutoff) days = days.filter(d => d.date >= cutoff)
    }

    return days
  }, [earningsData, enabledCreators, period])

  const totalForPeriod = chartData.reduce((s, d) => s + d.total, 0)
  const activeCount = [...enabledCreators].filter(c => earningsData?.[c]?.dailyData?.length > 0).length

  // Chart dimensions (shorter than individual, full width)
  const CW = 1100, CH = 200
  const pad = { t: 10, r: 55, b: 25, l: 10 }
  const cw = CW - pad.l - pad.r, ch = CH - pad.t - pad.b

  // Y-axis
  const rawMax = chartData.length > 0 ? Math.max(...chartData.map(d => d.total), 1) : 100
  const maxVal = useMemo(() => {
    const v = rawMax * 1.05
    if (v <= 0) return 100
    const mag = Math.pow(10, Math.floor(Math.log10(v)))
    const norm = v / mag
    if (norm <= 1.5) return 1.5 * mag
    if (norm <= 2) return 2 * mag
    if (norm <= 3) return 3 * mag
    if (norm <= 5) return 5 * mag
    if (norm <= 7.5) return 7.5 * mag
    return 10 * mag
  }, [rawMax])

  const px = (i) => pad.l + (i / Math.max(chartData.length - 1, 1)) * cw
  const py = (v) => pad.t + ch - (v / maxVal) * ch

  const onMove = useCallback((e) => {
    const svg = svgRef.current
    if (!svg || chartData.length === 0) return
    const rect = svg.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * CW
    const i = Math.round(((mx - pad.l) / cw) * (chartData.length - 1))
    if (i < 0 || i >= chartData.length) { setHover(null); return }
    const d = chartData[i]
    setHover({ i, cx: px(i), cy: py(d.total), total: d.total, date: d.date, byCreator: d.byCreator })
  }, [chartData, maxVal])

  // Early returns AFTER all hooks
  if (earningsLoading) {
    return (
      <div style={{ ...CARD, marginBottom: '16px' }}>
        <div style={SECTION_TITLE}>Agency Revenue</div>
        <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '13px', color: '#999' }}>Loading earnings data...</span>
        </div>
      </div>
    )
  }

  if (!earningsData || Object.keys(earningsData).length === 0) return null

  const GRID_COUNT = 3
  const eSteps = []
  for (let i = 1; i <= GRID_COUNT; i++) eSteps.push(Math.round(maxVal * (i / GRID_COUNT)))

  // Build path
  const points = chartData.map((d, i) => [px(i), py(d.total)])
  const linePath = buildMonotonePath(points)
  const areaPath = points.length > 1 ? linePath + `L${(pad.l + cw).toFixed(1)},${pad.t + ch}L${pad.l},${pad.t + ch}Z` : ''

  // X-axis labels
  const xCount = Math.min(6, chartData.length)
  const xLabels = []
  if (xCount >= 2) {
    for (let j = 0; j < xCount; j++) {
      const pos = j / (xCount - 1)
      const idx = Math.round(pos * (chartData.length - 1))
      xLabels.push({ pos, label: fmtChartDate(chartData[idx]?.date) })
    }
  }

  const toggleCreator = (name) => {
    const next = new Set(enabledCreators)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setEnabledCreators(next)
  }

  const toggleAll = () => {
    if (enabledCreators.size === EARNINGS_CREATORS.length) setEnabledCreators(new Set())
    else setEnabledCreators(new Set(EARNINGS_CREATORS))
  }

  return (
    <div style={{ ...CARD, marginBottom: '16px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ ...SECTION_TITLE, marginBottom: 0 }}>Agency Revenue</span>
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>
            {fmtK(totalForPeriod)}
          </span>
          <span style={{ fontSize: '11px', color: '#999' }}>
            {activeCount} account{activeCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Period selector */}
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{
              padding: '4px 8px', borderRadius: '6px', border: '1px solid #e5e5e5',
              fontSize: '11px', color: '#666', background: '#fff', cursor: 'pointer',
            }}
          >
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          {/* Creator toggle dropdown */}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e5e5',
                fontSize: '11px', color: '#666', background: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              Accounts
              <span style={{ fontSize: '9px' }}>{showDropdown ? '▲' : '▼'}</span>
            </button>
            {showDropdown && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                background: '#fff', borderRadius: '8px', border: '1px solid #e5e5e5',
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '8px 0', zIndex: 50,
                minWidth: '160px',
              }}>
                <div
                  onClick={toggleAll}
                  style={{
                    padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                    color: enabledCreators.size === EARNINGS_CREATORS.length ? '#E88FAC' : '#666',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  {enabledCreators.size === EARNINGS_CREATORS.length ? 'Deselect All' : 'Select All'}
                </div>
                {EARNINGS_CREATORS.map(name => {
                  const active = enabledCreators.has(name)
                  const hasData = earningsData?.[name]?.dailyData?.length > 0
                  if (!hasData) return null
                  return (
                    <div key={name}
                      onClick={() => toggleCreator(name)}
                      style={{
                        padding: '5px 12px', fontSize: '12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        color: active ? '#1a1a1a' : '#ccc',
                      }}
                    >
                      <div style={{
                        width: '10px', height: '10px', borderRadius: '2px',
                        background: active ? (CREATOR_COLORS[name] || '#E88FAC') : '#e5e5e5',
                      }} />
                      {name}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 1 ? (
        <div style={{ position: 'relative' }}>
          <svg ref={svgRef} viewBox={`0 0 ${CW} ${CH}`}
            style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair', display: 'block' }}
            onMouseMove={onMove} onMouseLeave={() => setHover(null)}
            onTouchMove={e => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX }) }}
            onTouchEnd={() => setHover(null)}>
            <defs>
              <linearGradient id="agencyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(232,143,172,0.18)" />
                <stop offset="100%" stopColor="rgba(232,143,172,0.01)" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {eSteps.map(v => <line key={v} x1={pad.l} x2={pad.l + cw} y1={py(v)} y2={py(v)} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />)}
            <line x1={pad.l} x2={pad.l + cw} y1={py(0)} y2={py(0)} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />

            {/* Area fill */}
            {areaPath && <path d={areaPath} fill="url(#agencyGrad)" />}

            {/* Line */}
            {linePath && <path d={linePath} fill="none" stroke="#E88FAC" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}

            {/* Y labels (right) */}
            {eSteps.map(v => <text key={`y${v}`} x={pad.l + cw + 6} y={py(v) + 4} fill="#999" fontSize={10} fontFamily="system-ui">{fmtChartMoney(v)}</text>)}

            {/* X labels */}
            {xLabels.map(({ pos, label }, i) => (
              <text key={i} x={pad.l + pos * cw} y={CH - 6} textAnchor="middle" fill="#aaa" fontSize={8} fontFamily="system-ui">{label}</text>
            ))}

            {/* Hover guide */}
            {hover && <line x1={hover.cx} x2={hover.cx} y1={pad.t} y2={pad.t + ch} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />}
          </svg>

          {/* Hover tooltip (HTML overlay) */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            opacity: hover ? 1 : 0, transition: 'opacity 0.15s ease',
          }}>
            {hover && (() => {
              const dotLeft = `${(hover.cx / CW) * 100}%`
              const dotTop = `${(hover.cy / CH) * 100}%`
              const ttAbove = hover.cy > CH * 0.35
              const fmtDate = (d) => {
                if (!d) return ''
                const [y,m,day] = d.split('-')
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y}`
              }
              const breakdown = Object.entries(hover.byCreator || {})
                .filter(([,v]) => v > 0)
                .sort((a,b) => b[1] - a[1])
              return (<>
                <div style={{
                  position: 'absolute', left: dotLeft, top: dotTop,
                  width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px',
                  borderRadius: '50%', background: '#E88FAC', border: '2px solid #fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  transition: 'left 0.08s ease, top 0.08s ease',
                }} />
                <div style={{
                  position: 'absolute',
                  left: `clamp(10px, calc(${dotLeft} - 85px), calc(100% - 190px))`,
                  top: ttAbove ? `calc(${dotTop} - ${36 + breakdown.length * 20}px)` : `calc(${dotTop} + 16px)`,
                  background: '#fff', borderRadius: '8px', padding: '8px 14px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.1)', border: '1px solid rgba(0,0,0,0.06)',
                  transition: 'left 0.08s ease, top 0.08s ease',
                  whiteSpace: 'nowrap', minWidth: '140px',
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>{fmtDate(hover.date)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: breakdown.length > 0 ? '4px' : 0 }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#E88FAC' }} />
                    <span style={{ fontSize: '11px', color: '#999' }}>Total</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', marginLeft: 'auto' }}>{fmt(hover.total)}</span>
                  </div>
                  {breakdown.slice(0, 5).map(([name, val]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: CREATOR_COLORS[name] || '#ccc' }} />
                      <span style={{ fontSize: '10px', color: '#999' }}>{name}</span>
                      <span style={{ fontSize: '11px', fontWeight: 500, color: '#666', marginLeft: 'auto' }}>{fmt(val)}</span>
                    </div>
                  ))}
                </div>
              </>)
            })()}
          </div>
        </div>
      ) : (
        <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '13px', color: '#999' }}>No daily data for this period</span>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────── */
/* MAIN DASHBOARD */
/* ─────────────────────────────────────────────── */
export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [alertsExpanded, setAlertsExpanded] = useState(false)
  const [earningsData, setEarningsData] = useState(null) // { creatorName: { dailyData, summary } }
  const [earningsLoading, setEarningsLoading] = useState(false)
  const earningsFetched = useRef(false)
  const [whaleAlerts, setWhaleAlerts] = useState(null) // { creatorName: { alerts, count } }
  const [whaleLoading, setWhaleLoading] = useState(false)
  const [whaleSending, setWhaleSending] = useState({}) // { 'creator-fan': true }
  const [whaleSent, setWhaleSent] = useState({}) // { 'creator-fan': { success: true } | { error: '...' } }
  const [whaleExpandedCreator, setWhaleExpandedCreator] = useState(null)
  const whaleAlertsFetched = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/dashboard')
      if (!res.ok) throw new Error('Failed to fetch dashboard data')
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Fetch all creator earnings for agency chart (lazy, after main dashboard loads)
  useEffect(() => {
    if (!data || earningsFetched.current) return
    earningsFetched.current = true
    setEarningsLoading(true)
    Promise.all(
      EARNINGS_CREATORS.map(name =>
        fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(name)}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const dataMap = {}
      results.forEach((r, i) => {
        if (r && r.dailyData?.length > 0) {
          dataMap[EARNINGS_CREATORS[i]] = r
        }
      })
      setEarningsData(dataMap)
      setEarningsLoading(false)
    })
  }, [data])

  // Fetch whale alerts for all creators (lazy, after main dashboard loads)
  const WHALE_CREATORS = ['Laurel', 'Taby', 'MG', 'Sunny']
  useEffect(() => {
    if (!data || whaleAlertsFetched.current) return
    whaleAlertsFetched.current = true
    setWhaleLoading(true)
    Promise.all(
      WHALE_CREATORS.map(name =>
        fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(name)}&goingColdOnly=true`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const alertMap = {}
      results.forEach((r, i) => {
        if (r && r.goingColdAlerts?.length > 0) {
          alertMap[WHALE_CREATORS[i]] = { alerts: r.goingColdAlerts, count: r.goingColdCount }
        }
      })
      setWhaleAlerts(alertMap)
      setWhaleLoading(false)
    })
  }, [data])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <div style={{ color: '#999', fontSize: '14px' }}>Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...CARD, color: '#ef4444', textAlign: 'center', padding: '40px' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Error loading dashboard</div>
        <div style={{ fontSize: '13px', color: '#999' }}>{error}</div>
        <button onClick={fetchData} style={{
          marginTop: '12px', padding: '8px 16px', background: '#E88FAC', color: '#fff',
          border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        }}>
          Retry
        </button>
      </div>
    )
  }

  const { revenue, editorRunway, creatorLibrary, pipeline, posting, alerts } = data

  // Sort alerts: red first (low_runway, overdue), then yellow
  const redAlerts = alerts.filter(a => a.type === 'low_runway' || a.type === 'overdue_invoice')
  const yellowAlerts = alerts.filter(a => a.type !== 'low_runway' && a.type !== 'overdue_invoice')
  const sortedAlerts = [...redAlerts, ...yellowAlerts]
  const MAX_COLLAPSED_ALERTS = 4
  const visibleAlerts = alertsExpanded ? sortedAlerts : sortedAlerts.slice(0, MAX_COLLAPSED_ALERTS)
  const hiddenCount = sortedAlerts.length - MAX_COLLAPSED_ALERTS

  // Build unified creator map for the combined table
  const creatorMap = {}
  // Revenue data (all creators)
  for (const c of revenue.byCreator) {
    creatorMap[c.name] = { ...creatorMap[c.name], name: c.name, revenue: c }
  }
  // Runway data (Social Media Editing creators only)
  for (const c of editorRunway) {
    if (!creatorMap[c.name]) creatorMap[c.name] = { name: c.name }
    creatorMap[c.name].runway = c
  }
  // Library data
  for (const c of creatorLibrary) {
    if (!creatorMap[c.name]) creatorMap[c.name] = { name: c.name }
    creatorMap[c.name].library = c
  }
  // Posting data
  for (const c of posting) {
    if (!creatorMap[c.name]) creatorMap[c.name] = { name: c.name }
    creatorMap[c.name].posting = c
  }
  // Sort by revenue descending, creators without revenue at bottom
  const unifiedCreators = Object.values(creatorMap).sort((a, b) =>
    (b.revenue?.currentTR || 0) - (a.revenue?.currentTR || 0)
  )

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: '12px', color: '#999' }}>{formatPeriodLabel(revenue.currentPeriodLabel)}</span>
      </div>

      {/* ─── ALERTS ─── */}
      {sortedAlerts.length > 0 && (
        <div style={{
          ...CARD, marginBottom: '12px', padding: '8px 14px',
          display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
          border: '1px solid #fde8e8',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#ef4444', marginRight: '4px' }}>
            {sortedAlerts.length}
          </span>
          {visibleAlerts.map((a, i) => <AlertPill key={i} alert={a} />)}
          {hiddenCount > 0 && !alertsExpanded && (
            <button onClick={() => setAlertsExpanded(true)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              color: '#999', background: '#f5f5f5', border: 'none', cursor: 'pointer',
            }}>+{hiddenCount} more</button>
          )}
          {alertsExpanded && sortedAlerts.length > MAX_COLLAPSED_ALERTS && (
            <button onClick={() => setAlertsExpanded(false)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              color: '#999', background: '#f5f5f5', border: 'none', cursor: 'pointer',
            }}>show less</button>
          )}
        </div>
      )}

      {/* ─── AGENCY REVENUE CHART — full width hero ─── */}
      <AgencyRevenueChart earningsData={earningsData} earningsLoading={earningsLoading} />

      {/* ─── TWO COLUMN: KPIs + Creator Table ─── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>

        {/* Left: KPI cards in a tight grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', width: '320px', flexShrink: 0 }}>
          <StatCard label="Period Revenue" value={fmtK(revenue.currentPeriodTR)} delta={revenue.trDelta} />
          <StatCard label="Palm's Cut" value={fmtK(revenue.netProfit)} color="#22c55e" delta={revenue.profitDelta} />
          <StatCard
            label="Projected Monthly"
            value={fmtK(revenue.projectedMonthlyRevenue)}
            sub={`${fmtK(revenue.projectedMonthlyNetProfit)} net`}
            color="#E88FAC"
          />
          <StatCard
            label="Outstanding"
            value={revenue.outstandingInvoices.count}
            sub={revenue.outstandingInvoices.count > 0 ? fmtK(revenue.outstandingInvoices.total) : 'all clear'}
            color={revenue.outstandingInvoices.count > 0 ? '#f59e0b' : '#22c55e'}
          />
          <StatCard label="Creators" value={revenue.activeCreators} />
        </div>

        {/* Right: Creator table (compact) */}
        <div style={{ ...CARD, flex: 1, minWidth: 0, padding: '14px 16px' }}>
          <div style={SECTION_TITLE}>Creators</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 72px 36px 68px 44px 90px 60px 1fr',
            gap: '4px', padding: '2px 0 6px', borderBottom: '1px solid #f0f0f0',
            alignItems: 'center',
          }}>
            <span style={{ ...LABEL, fontSize: '9px' }}>Creator</span>
            <span style={{ ...LABEL, fontSize: '9px' }}>Revenue</span>
            <span style={{ ...LABEL, fontSize: '9px' }}>Rate</span>
            <span style={{ ...LABEL, fontSize: '9px' }}>Cut</span>
            <span style={{ ...LABEL, fontSize: '9px' }}>Rwy</span>
            <span style={{ ...LABEL, fontSize: '9px' }}>Queue</span>
            <span style={{ ...LABEL, fontSize: '9px' }}>Library</span>
            <span style={{ ...LABEL, fontSize: '9px', textAlign: 'right' }}>Trend</span>
          </div>

          {unifiedCreators.map(c => {
            const rev = c.revenue
            const rwy = c.runway
            const lib = c.library
            const bufferDays = rwy?.bufferDays ?? null
            const runwayColor = bufferDays === null ? '#ddd' : bufferDays < 1 ? '#ef4444' : bufferDays < 2 ? '#f59e0b' : '#22c55e'
            const runwayBg = bufferDays === null ? '#fafafa' : bufferDays < 1 ? '#fef2f2' : bufferDays < 2 ? '#fffbeb' : '#f0fdf4'
            const editQueue = rwy ? (rwy.toEdit + rwy.inProgress + rwy.needsRevision + rwy.inReview) : null

            return (
              <div key={c.name} style={{
                display: 'grid',
                gridTemplateColumns: '80px 72px 36px 68px 44px 90px 60px 1fr',
                gap: '4px', padding: '5px 0',
                borderBottom: '1px solid #fafafa',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: rev ? '#1a1a1a' : '#ddd' }}>
                  {rev ? fmtK(rev.currentTR) : '—'}
                </span>
                <span style={{ fontSize: '10px', color: '#999' }}>{rev ? pct(rev.commissionPct) : ''}</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: rev ? '#22c55e' : '#ddd' }}>
                  {rev ? fmtK(rev.palmCut) : '—'}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 700, color: runwayColor, background: runwayBg,
                  padding: '1px 4px', borderRadius: '3px', textAlign: 'center',
                }}>
                  {bufferDays !== null ? `${bufferDays}d` : '—'}
                </span>
                <div style={{ fontSize: '10px', color: '#666', display: 'flex', gap: '4px' }}>
                  {rwy ? (
                    editQueue > 0 ? (
                      <>
                        {rwy.toEdit > 0 && <span>{rwy.toEdit}q</span>}
                        {rwy.inProgress > 0 && <span>{rwy.inProgress}a</span>}
                        {rwy.needsRevision > 0 && <span style={{ color: '#ef4444' }}>{rwy.needsRevision}r</span>}
                        {rwy.inReview > 0 && <span style={{ color: '#3b82f6' }}>{rwy.inReview}rv</span>}
                      </>
                    ) : <span style={{ color: '#ccc' }}>—</span>
                  ) : <span style={{ color: '#ddd' }}>—</span>}
                </div>
                <span style={{
                  fontSize: '11px', fontWeight: 600,
                  color: lib ? (lib.total === 0 ? '#ef4444' : '#666') : '#ddd',
                }}>
                  {lib ? lib.total : '—'}
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {rev ? <TrendBar values={rev.trend} delta={rev.delta} /> : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── WHALE ALERTS ─── */}
      <div style={{ ...CARD, marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: whaleAlerts && Object.keys(whaleAlerts).length > 0 ? '12px' : '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>&#x1F433;</span>
            <span style={SECTION_TITLE}>Whale Alerts</span>
          </div>
          {whaleLoading && <span style={{ fontSize: '11px', color: '#999' }}>Loading...</span>}
        </div>

        {whaleAlerts && Object.keys(whaleAlerts).length === 0 && !whaleLoading && (
          <div style={{ fontSize: '13px', color: '#999', padding: '8px 0' }}>No whale alerts right now.</div>
        )}

        {whaleAlerts && Object.entries(whaleAlerts).map(([creator, { alerts: cAlerts, count }]) => {
          const isExpanded = whaleExpandedCreator === creator
          const urgCount = { critical: 0, high: 0, warning: 0 }
          cAlerts.forEach(a => { urgCount[a.urgency] = (urgCount[a.urgency] || 0) + 1 })
          return (
            <div key={creator} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <div
                onClick={() => setWhaleExpandedCreator(isExpanded ? null : creator)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: '#ccc', fontSize: '10px' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: '#1a1a1a' }}>{creator}</span>
                  <span style={{ fontSize: '12px', color: '#EA580C', fontWeight: 600 }}>{count} fan{count !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {urgCount.critical > 0 && <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{urgCount.critical} CRITICAL</span>}
                  {urgCount.high > 0 && <span style={{ background: '#FFF3CD', color: '#D97706', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{urgCount.high} HIGH</span>}
                  {urgCount.warning > 0 && <span style={{ background: '#FEF9C3', color: '#A16207', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{urgCount.warning} WARNING</span>}
                </div>
              </div>

              {isExpanded && (
                <div style={{ paddingBottom: '12px' }}>
                  {/* Header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 60px 70px 70px 70px 70px 70px',
                    padding: '4px 8px', fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase',
                    borderBottom: '1px solid #f0f0f0',
                  }}>
                    <span>Fan</span>
                    <span style={{ textAlign: 'right' }}>Median</span>
                    <span style={{ textAlign: 'right' }}>Gap</span>
                    <span style={{ textAlign: 'right' }}>Last 30d</span>
                    <span style={{ textAlign: 'right' }}>90d Avg</span>
                    <span style={{ textAlign: 'right' }}>Lifetime</span>
                    <span style={{ textAlign: 'center' }}>Action</span>
                  </div>

                  {cAlerts.map((a, i) => {
                    const sendKey = `${creator}-${a.fan}`
                    const isSending = whaleSending[sendKey]
                    const result = whaleSent[sendKey]
                    const urgColors = { critical: { bg: '#FEE2E2', text: '#DC2626' }, high: { bg: '#FFF3CD', text: '#D97706' }, warning: { bg: '#FEF9C3', text: '#A16207' } }
                    const uc = urgColors[a.urgency] || urgColors.warning
                    return (
                      <div key={a.fan} style={{
                        display: 'grid', gridTemplateColumns: '1fr 60px 70px 70px 70px 70px 70px',
                        padding: '8px 8px', fontSize: '12px', alignItems: 'center',
                        background: i % 2 === 0 ? '#fff' : '#FAFAFA',
                      }}>
                        <div>
                          <span style={{ fontWeight: 500 }}>{a.fan}</span>
                          {a.username && <span style={{ color: '#E88FAC', fontSize: '11px', marginLeft: '4px' }}>@{a.username}</span>}
                          <span style={{ background: uc.bg, color: uc.text, padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, marginLeft: '6px', textTransform: 'uppercase' }}>{a.urgency}</span>
                        </div>
                        <span style={{ textAlign: 'right', color: '#666' }}>{a.medianGap}d</span>
                        <span style={{ textAlign: 'right', fontWeight: 600, color: a.currentGap > a.medianGap * 3 ? '#DC2626' : '#EA580C' }}>
                          {a.currentGap}d <span style={{ fontSize: '10px', color: '#999', fontWeight: 400 }}>({a.gapRatio}x)</span>
                        </span>
                        <span style={{ textAlign: 'right', color: a.rolling30 === 0 ? '#DC2626' : '#666', fontWeight: a.rolling30 === 0 ? 600 : 400 }}>{fmtK(a.rolling30)}</span>
                        <span style={{ textAlign: 'right', color: '#666' }}>{fmtK(a.monthlyAvg90)}</span>
                        <span style={{ textAlign: 'right', color: '#666' }}>{fmtK(a.lifetime)}</span>
                        <div style={{ textAlign: 'center' }}>
                          {result?.success ? (
                            <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 500 }}>&#10003; Sent</span>
                          ) : (
                            <button
                              disabled={isSending}
                              onClick={async () => {
                                setWhaleSending(prev => ({ ...prev, [sendKey]: true }))
                                try {
                                  const res = await fetch('/api/admin/whale-alert/send', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ creatorName: creator, alert: a, analysis: null }),
                                  })
                                  const data = await res.json()
                                  if (!res.ok) throw new Error(data.error || 'Send failed')
                                  setWhaleSent(prev => ({ ...prev, [sendKey]: { success: true } }))
                                } catch (e) {
                                  setWhaleSent(prev => ({ ...prev, [sendKey]: { error: e.message } }))
                                } finally {
                                  setWhaleSending(prev => ({ ...prev, [sendKey]: false }))
                                }
                              }}
                              style={{
                                background: isSending ? '#E5E7EB' : '#1a1a1a', border: 'none', borderRadius: '4px',
                                padding: '4px 8px', fontSize: '10px', color: isSending ? '#999' : '#fff', fontWeight: 600,
                                cursor: isSending ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                              }}
                            >
                              {isSending ? '...' : 'Send'}
                            </button>
                          )}
                          {result?.error && <div style={{ fontSize: '9px', color: '#DC2626', marginTop: '2px' }}>{result.error}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ─── TWO COLUMN: Pipeline + Posting ─── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>

        {/* Pipeline Health */}
        <div style={{ ...CARD, flex: '1 1 0', padding: '14px 16px' }}>
          <div style={SECTION_TITLE}>Pipeline</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Today</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{pipeline.scrapedToday}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>This Week</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{pipeline.scrapedThisWeek}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Promoted</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#E88FAC', marginTop: '2px' }}>{pipeline.promotedThisWeek}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Review</div>
              <div style={{
                fontSize: '18px', fontWeight: 700, marginTop: '2px',
                color: pipeline.reviewQueue > 20 ? '#f59e0b' : '#1a1a1a',
              }}>{pipeline.reviewQueue}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Analysis</div>
              <div style={{
                fontSize: '18px', fontWeight: 700, marginTop: '2px',
                color: pipeline.analysisQueue > 0 ? '#3b82f6' : '#1a1a1a',
              }}>{pipeline.analysisQueue}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Sources</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{pipeline.sourcesEnabled}</div>
            </div>
          </div>
          {pipeline.lastScrape && (
            <div style={{ fontSize: '10px', color: '#999', marginTop: '8px' }}>
              Last scrape: {new Date(pipeline.lastScrape).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* Posting Activity */}
        <div style={{ ...CARD, flex: '1 1 0', padding: '14px 16px' }}>
          <div style={SECTION_TITLE}>Posting (7 Days)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {posting.map(c => (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
                borderBottom: '1px solid #fafafa',
              }}>
                <div style={{ width: '60px', fontSize: '12px', fontWeight: 600, color: '#1a1a1a' }}>{c.name}</div>
                <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: '#666' }}>
                  <span><strong style={{ color: '#1a1a1a' }}>{c.postedToday}</strong> today</span>
                  <span><strong style={{ color: '#1a1a1a' }}>{c.postedThisWeek}</strong>/wk</span>
                  {c.telegramPending > 0 && (
                    <span style={{ color: '#f59e0b' }}><strong>{c.telegramPending}</strong> TG</span>
                  )}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <MiniCalendar calendar={c.calendar} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── TWO COLUMN: Period History + (space for future) ─── */}
      {revenue.periods.length > 1 && (
        <div style={{ ...CARD, marginBottom: '12px', padding: '14px 16px' }}>
          <div style={SECTION_TITLE}>Period History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 80px 60px',
              gap: '6px', padding: '2px 0', borderBottom: '1px solid #f0f0f0',
            }}>
              <span style={{ ...LABEL, fontSize: '9px' }}>Period</span>
              <span style={{ ...LABEL, fontSize: '9px', textAlign: 'right' }}>TR</span>
              <span style={{ ...LABEL, fontSize: '9px', textAlign: 'right' }}>Cut</span>
              <span style={{ ...LABEL, fontSize: '9px', textAlign: 'right' }}>Δ</span>
            </div>
            {revenue.periods.map((p, i) => {
              const prevPeriod = revenue.periods[i + 1]
              const periodDelta = prevPeriod && prevPeriod.totalTR > 0
                ? (p.totalTR - prevPeriod.totalTR) / prevPeriod.totalTR : null
              const deltaStr = deltaPct(periodDelta)
              const deltaColor = periodDelta > 0 ? '#22c55e' : periodDelta < 0 ? '#ef4444' : '#999'
              return (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 80px 60px',
                  gap: '6px', padding: '4px 0', borderBottom: '1px solid #fafafa',
                  opacity: i === 0 ? 1 : 0.7,
                }}>
                  <span style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: i === 0 ? 600 : 400 }}>
                    {formatPeriodLabel(p.label) || `${p.start} – ${p.end}`}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', textAlign: 'right' }}>{fmtK(p.totalTR)}</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', textAlign: 'right' }}>{fmtK(p.netProfit)}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: deltaColor, textAlign: 'right' }}>
                    {deltaStr || '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
