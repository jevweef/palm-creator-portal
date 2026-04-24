'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'

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
  background: 'var(--card-bg-solid)',
  borderRadius: '18px',
  padding: '20px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
}

const SECTION_TITLE = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--foreground-muted)',
  marginBottom: '12px',
}

const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--foreground-muted)',
}

/* ─── Stat Card with optional delta ─── */
function StatCard({ label, value, sub, color, delta }) {
  const deltaStr = deltaPct(delta)
  const deltaColor = delta > 0 ? '#7DD3A4' : delta < 0 ? '#E87878' : '#999'
  return (
    <div style={{ ...CARD, flex: '1 1 160px', minWidth: '140px' }}>
      <div style={LABEL}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
        <span style={{ fontSize: '28px', fontWeight: 700, color: color || 'var(--foreground)' }}>{value}</span>
        {deltaStr && (
          <span style={{ fontSize: '12px', fontWeight: 600, color: deltaColor }}>{deltaStr}</span>
        )}
      </div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

/* ─── Status Badge (only renders for non-Draft) ─── */
function StatusBadge({ status }) {
  if (!status || status === 'Draft') return null
  const colors = { Paid: '#7DD3A4', Sent: '#78B4E8', Overdue: '#E87878' }
  const bg = { Paid: 'rgba(125, 211, 164, 0.06)', Sent: 'rgba(120, 180, 232, 0.06)', Overdue: 'rgba(232, 120, 120, 0.06)' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
      fontSize: '11px', fontWeight: 600,
      color: colors[status] || '#999', background: bg[status] || 'rgba(255,255,255,0.03)',
    }}>
      {status}
    </span>
  )
}

/* ─── Mini Trend Bar (oldest→newest, left→right) ─── */
function TrendBar({ values, delta }) {
  if (!values || !values.length) return null
  const max = Math.max(...values, 1)
  const deltaColor = delta > 0 ? '#7DD3A4' : delta < 0 ? '#E87878' : '#999'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '28px' }}>
        {values.map((v, i) => (
          <div key={i} style={{
            width: '10px',
            height: `${Math.max(2, (v / max) * 28)}px`,
            background: i === values.length - 1 ? 'var(--palm-pink)' : '#f3d1dc',
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
  const color = days < 1 ? '#E87878' : days < 2 ? '#E8C878' : '#7DD3A4'
  const bg = days < 1 ? 'rgba(232, 120, 120, 0.06)' : days < 2 ? 'rgba(232, 200, 120, 0.06)' : 'rgba(125, 211, 164, 0.06)'
  const width = Math.min(100, (days / 7) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.04)', borderRadius: '3px', overflow: 'hidden' }}>
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

/* ─── Pipeline Access Panel ─── */
// Inline toggle for each creator's Social Media Editing flag — the single
// switch that gates Editor Dashboard, Grid Planner, and Post Prep visibility.
// Readiness badges show what's set up (DNA profile, Music DNA, IG accounts,
// Telegram) so you know what else needs to land before a creator can actually
// use the pipeline.
function ReadinessBadge({ ok, label, title }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
        background: ok ? 'rgba(125, 211, 164, 0.08)' : 'rgba(232, 200, 120, 0.06)',
        color: ok ? '#7DD3A4' : '#E8C878',
        border: `1px solid ${ok ? 'rgba(125, 211, 164, 0.2)' : 'rgba(232, 200, 120, 0.2)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {ok ? '✓' : '⚠'} {label}
    </span>
  )
}

function ToggleSwitch({ on, onChange, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : () => onChange(!on)}
      disabled={disabled}
      aria-pressed={on}
      style={{
        position: 'relative', width: '36px', height: '20px', borderRadius: '20px',
        background: on ? '#7DD3A4' : 'rgba(255,255,255,0.1)',
        border: 'none', cursor: disabled ? 'wait' : 'pointer',
        transition: 'background 0.2s ease',
        padding: 0, flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: '2px', left: on ? '18px' : '2px',
        width: '16px', height: '16px', borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

function PipelineAccessPanel() {
  const [creators, setCreators] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState({})

  const fetchCreators = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/creators/pipeline')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setCreators(data.creators || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCreators() }, [fetchCreators])

  const handleToggle = async (creator, nextValue) => {
    setSaving(prev => ({ ...prev, [creator.id]: true }))
    // Optimistic update — flip immediately, revert on error
    setCreators(prev => prev.map(c =>
      c.id === creator.id ? { ...c, socialMediaEditing: nextValue } : c
    ))
    try {
      const res = await fetch('/api/admin/creators/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, socialMediaEditing: nextValue }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      // Revert
      setCreators(prev => prev.map(c =>
        c.id === creator.id ? { ...c, socialMediaEditing: !nextValue } : c
      ))
      alert(`Failed to toggle: ${err.message}`)
    } finally {
      setSaving(prev => {
        const next = { ...prev }
        delete next[creator.id]
        return next
      })
    }
  }

  if (loading) {
    return (
      <div style={{ ...CARD, padding: '14px 16px', marginBottom: '12px' }}>
        <div style={SECTION_TITLE}>Editor Pipeline Access</div>
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Loading creators…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ ...CARD, padding: '14px 16px', marginBottom: '12px' }}>
        <div style={SECTION_TITLE}>Editor Pipeline Access</div>
        <div style={{ fontSize: '12px', color: '#E87878' }}>Error: {error}</div>
      </div>
    )
  }

  const activeCount = creators.filter(c => c.socialMediaEditing).length

  return (
    <div style={{ ...CARD, padding: '14px 16px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={SECTION_TITLE}>Editor Pipeline Access</div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
          {activeCount} of {creators.length} active
        </div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginBottom: '10px' }}>
        Toggle ON to add a creator to the Editor Dashboard, Grid Planner, and Post Prep. Readiness badges show what's set up; missing ones are nice-to-have, not required.
      </div>
      <div style={{ display: 'grid', gap: '4px' }}>
        {creators.map(c => {
          const isSaving = !!saving[c.id]
          return (
            <div key={c.id} style={{
              display: 'grid',
              gridTemplateColumns: '48px 150px 1fr auto',
              gap: '12px', padding: '6px 8px', alignItems: 'center',
              background: c.socialMediaEditing ? 'rgba(125, 211, 164, 0.03)' : 'transparent',
              borderRadius: '6px',
              opacity: c.socialMediaEditing ? 1 : 0.72,
              transition: 'opacity 0.2s ease, background 0.2s ease',
            }}>
              <ToggleSwitch on={c.socialMediaEditing} onChange={v => handleToggle(c, v)} disabled={isSaving} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                {c.name}
              </span>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                <ReadinessBadge
                  ok={c.hasProfile}
                  label="DNA Profile"
                  title={c.hasProfile ? 'AI profile generated from onboarding docs' : 'No Profile Summary yet — run the profile builder on this creator'}
                />
                <ReadinessBadge
                  ok={c.hasMusicDna}
                  label="Music DNA"
                  title={c.hasMusicDna ? 'Spotify playlist processed' : 'No Music DNA yet — paste their Spotify playlist URL on their creator profile'}
                />
                <ReadinessBadge
                  ok={c.igAccountCount > 0}
                  label={`${c.igAccountCount} IG${c.igAccountCount === 1 ? '' : 's'}`}
                  title={c.igAccountCount > 0
                    ? `${c.igAccountCount} active IG account${c.igAccountCount === 1 ? '' : 's'} in Creator Platform Directory`
                    : 'No IG accounts linked — required for Grid Planner (not for Editor)'}
                />
                <ReadinessBadge
                  ok={!!c.telegramThreadId}
                  label="Telegram"
                  title={c.telegramThreadId ? 'Telegram thread wired for sending' : 'No Telegram Thread ID — can\'t send posts to Telegram from Grid Planner'}
                />
              </div>
              {isSaving && <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>saving…</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Alert Pill ─── */
function AlertPill({ alert }) {
  const config = {
    low_runway: { color: '#E87878', bg: 'rgba(232, 120, 120, 0.06)', icon: '!', label: `${alert.creator}: ${alert.bufferDays}d runway` },
    overdue_invoice: { color: '#E87878', bg: 'rgba(232, 120, 120, 0.06)', icon: '$', label: `${alert.creator}: overdue` },
    revision_stuck: { color: '#E8C878', bg: 'rgba(232, 200, 120, 0.06)', icon: '!', label: `${alert.creator}: ${alert.count} revision${(alert.count || 0) > 1 ? 's' : ''}` },
    analysis_errors: { color: '#E8C878', bg: 'rgba(232, 200, 120, 0.06)', icon: '!', label: `${alert.count} analysis error${(alert.count || 0) > 1 ? 's' : ''}` },
    empty_library: { color: '#E8C878', bg: 'rgba(232, 200, 120, 0.06)', icon: '0', label: `${alert.creator}: no content` },
    new_oftv_project: {
      color: '#78B4E8',
      bg: 'rgba(120, 180, 232, 0.06)',
      icon: '+',
      label: `${alert.creator ? alert.creator + ': ' : ''}OFTV project${alert.fileCount > 0 ? ` (${alert.fileCount} file${alert.fileCount === 1 ? '' : 's'})` : ''}`,
    },
  }
  const c = config[alert.type] || { color: 'var(--foreground-muted)', bg: 'rgba(255,255,255,0.03)', icon: '?', label: alert.type }
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
        const bg = count >= 2 ? '#7DD3A4' : count === 1 ? '#fbbf24' : 'rgba(255,255,255,0.04)'
        const color = count >= 2 ? 'var(--foreground)' : count === 1 ? '#78350f' : '#ccc'
        return (
          <div key={date} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--foreground-muted)', marginBottom: '2px' }}>{dayLabel}</div>
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
  Laurel: 'var(--palm-pink)',
  Taby: '#78B4E8',
  MG: '#E8A878',
  Sunny: '#A78BFA',
  Gracie: '#34d399',
  Amelia: '#f472b6',
  Raya: '#38bdf8',
  'Ocean Ray': '#fbbf24',
  Amara: '#818cf8',
  'Meadow Marie': '#4ade80',
}
// Fallback palette for creators not explicitly colored above
const FALLBACK_COLORS = ['#E87878', '#06b6d4', '#eab308', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16']
function colorForCreator(name, index) {
  return CREATOR_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}
const PERIODS = [
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'last90', label: 'Last 90 Days' },
  { key: 'mtd', label: 'Month to Date' },
  { key: 'ytd', label: 'Year to Date' },
  { key: 'all', label: 'All Time' },
]

/* ─── Agency Revenue Chart ─── */
function AgencyRevenueChart({ earningsData, earningsLoading, creatorList = [] }) {
  const [hover, setHover] = useState(null)
  const [period, setPeriod] = useState('last30')
  const [enabledCreators, setEnabledCreators] = useState(() => new Set(creatorList))
  const [showDropdown, setShowDropdown] = useState(false)

  // Sync enabled set when creator list changes (e.g. earnings finish loading)
  useEffect(() => {
    setEnabledCreators(prev => {
      // Only reset if the set of known creators changed
      const next = new Set(prev)
      creatorList.forEach(n => next.add(n))
      return next
    })
  }, [creatorList.join('|')])
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
          <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Loading earnings data...</span>
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
    if (enabledCreators.size === creatorList.length) setEnabledCreators(new Set())
    else setEnabledCreators(new Set(creatorList))
  }

  return (
    <div style={{ ...CARD, marginBottom: '16px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ ...SECTION_TITLE, marginBottom: 0 }}>Agency Revenue</span>
          <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)' }}>
            {fmtK(totalForPeriod)}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
            {activeCount} account{activeCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Period selector */}
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{
              padding: '4px 8px', borderRadius: '6px', border: '1px solid transparent',
              fontSize: '11px', color: 'rgba(240, 236, 232, 0.75)', background: 'var(--card-bg-solid)', cursor: 'pointer',
            }}
          >
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          {/* Creator toggle dropdown */}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: '1px solid transparent',
                fontSize: '11px', color: 'rgba(240, 236, 232, 0.75)', background: 'var(--card-bg-solid)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              Accounts
              <span style={{ fontSize: '9px' }}>{showDropdown ? '▲' : '▼'}</span>
            </button>
            {showDropdown && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                background: 'var(--card-bg-solid)', borderRadius: '8px', border: '1px solid transparent',
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '8px 0', zIndex: 50,
                minWidth: '160px',
              }}>
                <div
                  onClick={toggleAll}
                  style={{
                    padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                    color: enabledCreators.size === creatorList.length ? 'var(--palm-pink)' : 'rgba(240, 236, 232, 0.75)',
                    borderBottom: '1px solid transparent',
                  }}
                >
                  {enabledCreators.size === creatorList.length ? 'Deselect All' : 'Select All'}
                </div>
                {creatorList.map(name => {
                  const active = enabledCreators.has(name)
                  const hasData = earningsData?.[name]?.dailyData?.length > 0
                  if (!hasData) return null
                  return (
                    <div key={name}
                      onClick={() => toggleCreator(name)}
                      style={{
                        padding: '5px 12px', fontSize: '12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        color: active ? 'var(--foreground)' : '#ccc',
                      }}
                    >
                      <div style={{
                        width: '10px', height: '10px', borderRadius: '2px',
                        background: active ? (CREATOR_COLORS[name] || 'var(--palm-pink)') : '#e5e5e5',
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
                  borderRadius: '50%', background: 'var(--palm-pink)', border: '2px solid #fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  transition: 'left 0.08s ease, top 0.08s ease',
                }} />
                <div style={{
                  position: 'absolute',
                  left: `clamp(10px, calc(${dotLeft} - 85px), calc(100% - 190px))`,
                  top: ttAbove ? `calc(${dotTop} - ${36 + breakdown.length * 20}px)` : `calc(${dotTop} + 16px)`,
                  background: 'var(--card-bg-solid)', borderRadius: '8px', padding: '8px 14px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.1)', border: '1px solid transparent',
                  transition: 'left 0.08s ease, top 0.08s ease',
                  whiteSpace: 'nowrap', minWidth: '140px',
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '4px' }}>{fmtDate(hover.date)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: breakdown.length > 0 ? '4px' : 0 }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--palm-pink)' }} />
                    <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Total</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', marginLeft: 'auto' }}>{fmt(hover.total)}</span>
                  </div>
                  {breakdown.slice(0, 5).map(([name, val]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: CREATOR_COLORS[name] || '#ccc' }} />
                      <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>{name}</span>
                      <span style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(240, 236, 232, 0.75)', marginLeft: 'auto' }}>{fmt(val)}</span>
                    </div>
                  ))}
                </div>
              </>)
            })()}
          </div>
        </div>
      ) : (
        <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>No daily data for this period</span>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────── */
/* MAIN DASHBOARD */
/* ─────────────────────────────────────────────── */
export default function AdminDashboard() {
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [alertsExpanded, setAlertsExpanded] = useState(false)
  const [earningsData, setEarningsData] = useState(null) // { creatorName: { dailyData, summary } }
  const [earningsLoading, setEarningsLoading] = useState(false)
  const earningsFetched = useRef(false)
  const creatorsCardRef = useRef(null)
  const [creatorsHeight, setCreatorsHeight] = useState(null)
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

  // Observe Creators card height so Whale Alerts can match it (prevents layout gap)
  useEffect(() => {
    if (!creatorsCardRef.current) return
    const el = creatorsCardRef.current
    const update = () => setCreatorsHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])

  // Derive creator list dynamically from revenue data (all AKAs with invoices)
  const creatorList = useMemo(() => {
    if (!data?.revenue?.byCreator) return []
    const names = Array.from(new Set(data.revenue.byCreator.map(c => c.name).filter(Boolean)))
    return names.sort()
  }, [data])

  // name → creator id (from editorRunway — used for deep-links to /admin/creators?creator=<id>)
  const creatorIdByName = useMemo(() => {
    const m = {}
    for (const c of (data?.editorRunway?.byCreator || [])) {
      if (c.id && c.name) m[c.name] = c.id
    }
    return m
  }, [data])

  // Fetch all creator earnings for agency chart (lazy, after main dashboard loads)
  useEffect(() => {
    if (!data || earningsFetched.current || creatorList.length === 0) return
    earningsFetched.current = true
    setEarningsLoading(true)
    Promise.all(
      creatorList.map(name =>
        fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(name)}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const dataMap = {}
      results.forEach((r, i) => {
        if (r && r.dailyData?.length > 0) {
          dataMap[creatorList[i]] = r
        }
      })
      setEarningsData(dataMap)
      setEarningsLoading(false)
    })
  }, [data, creatorList])

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
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...CARD, color: '#E87878', textAlign: 'center', padding: '40px' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Error loading dashboard</div>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>{error}</div>
        <button onClick={fetchData} style={{
          marginTop: '12px', padding: '8px 16px', background: 'var(--palm-pink)', color: '#060606',
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
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{formatPeriodLabel(revenue.currentPeriodLabel)}</span>
      </div>

      {/* ─── ALERTS ─── */}
      {sortedAlerts.length > 0 && (
        <div style={{
          ...CARD, marginBottom: '12px', padding: '8px 14px',
          display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
          border: 'none',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#E87878', marginRight: '4px' }}>
            {sortedAlerts.length}
          </span>
          {visibleAlerts.map((a, i) => <AlertPill key={i} alert={a} />)}
          {hiddenCount > 0 && !alertsExpanded && (
            <button onClick={() => setAlertsExpanded(true)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer',
            }}>+{hiddenCount} more</button>
          )}
          {alertsExpanded && sortedAlerts.length > MAX_COLLAPSED_ALERTS && (
            <button onClick={() => setAlertsExpanded(false)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer',
            }}>show less</button>
          )}
        </div>
      )}

      {/* ─── AGENCY REVENUE CHART — full width hero ─── */}
      <AgencyRevenueChart earningsData={earningsData} earningsLoading={earningsLoading} creatorList={creatorList} />

      {/* ─── KPI STRIP ─── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <StatCard label="Creators" value={revenue.activeCreators} sub="active" />
        <StatCard
          label={`Period Revenue · ${formatPeriodLabel(revenue.currentPeriodLabel)}`}
          value={fmtK(revenue.currentPeriodTR)}
          delta={revenue.trDelta}
          sub={revenue.periods[1] ? `vs ${formatPeriodLabel(revenue.periods[1].label)}` : null}
        />
        <StatCard
          label={`Palm's Cut · ${formatPeriodLabel(revenue.currentPeriodLabel)}`}
          value={fmtK(revenue.netProfit)}
          color="#22c55e"
          delta={revenue.profitDelta}
          sub={revenue.periods[1] ? `vs ${formatPeriodLabel(revenue.periods[1].label)}` : null}
        />
        <StatCard
          label="Projected Monthly"
          value={fmtK(revenue.projectedMonthlyRevenue)}
          sub={`${fmtK(revenue.projectedMonthlyNetProfit)} net · 30d extrap.`}
          color="#E88FAC"
        />
        <StatCard
          label="Outstanding"
          value={revenue.outstandingInvoices.count}
          sub={revenue.outstandingInvoices.count > 0 ? `${fmtK(revenue.outstandingInvoices.total)} unpaid` : 'all clear'}
          color={revenue.outstandingInvoices.count > 0 ? '#E8C878' : '#7DD3A4'}
        />
      </div>

      {/* ─── ROW 1: Creators + Whale Alerts ─── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-start' }}>
      {/* ─── CREATORS TABLE ─── */}
      <div ref={creatorsCardRef} style={{ ...CARD, flex: '3 1 0', padding: '14px 16px', minWidth: 0 }}>
          <div style={SECTION_TITLE}>Creators</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 72px 36px 68px 44px 90px 60px 1fr',
            gap: '4px', padding: '2px 0 6px', borderBottom: '1px solid transparent',
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
            const runwayColor = bufferDays === null ? 'rgba(255,255,255,0.08)' : bufferDays < 1 ? '#E87878' : bufferDays < 2 ? '#E8C878' : '#7DD3A4'
            const runwayBg = bufferDays === null ? 'var(--card-bg-solid)' : bufferDays < 1 ? 'rgba(232, 120, 120, 0.06)' : bufferDays < 2 ? 'rgba(232, 200, 120, 0.06)' : 'rgba(125, 211, 164, 0.06)'
            const editQueue = rwy ? (rwy.toEdit + rwy.inProgress + rwy.needsRevision + rwy.inReview) : null

            return (
              <div key={c.name} style={{
                display: 'grid',
                gridTemplateColumns: '80px 72px 36px 68px 44px 90px 60px 1fr',
                gap: '4px', padding: '5px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>{c.name}</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: rev ? 'var(--foreground)' : 'rgba(255,255,255,0.08)' }}>
                  {rev ? fmtK(rev.currentTR) : '—'}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>{rev ? pct(rev.commissionPct) : ''}</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: rev ? '#7DD3A4' : 'rgba(255,255,255,0.08)' }}>
                  {rev ? fmtK(rev.palmCut) : '—'}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 700, color: runwayColor, background: runwayBg,
                  padding: '1px 4px', borderRadius: '3px', textAlign: 'center',
                }}>
                  {bufferDays !== null ? `${bufferDays}d` : '—'}
                </span>
                <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.75)', display: 'flex', gap: '4px' }}>
                  {rwy ? (
                    editQueue > 0 ? (
                      <>
                        {rwy.toEdit > 0 && <span>{rwy.toEdit}q</span>}
                        {rwy.inProgress > 0 && <span>{rwy.inProgress}a</span>}
                        {rwy.needsRevision > 0 && <span style={{ color: '#E87878' }}>{rwy.needsRevision}r</span>}
                        {rwy.inReview > 0 && <span style={{ color: '#78B4E8' }}>{rwy.inReview}rv</span>}
                      </>
                    ) : <span style={{ color: 'var(--foreground-subtle)' }}>—</span>
                  ) : <span style={{ color: 'var(--foreground)' }}>—</span>}
                </div>
                <span style={{
                  fontSize: '11px', fontWeight: 600,
                  color: lib ? (lib.total === 0 ? '#E87878' : 'rgba(240, 236, 232, 0.75)') : 'rgba(255,255,255,0.08)',
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

      {/* ─── WHALE ALERTS ─── */}
      <div style={{ ...CARD, flex: '2 1 0', padding: '14px 16px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: whaleAlerts && Object.keys(whaleAlerts).length > 0 ? '12px' : '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>&#x1F433;</span>
            <span style={SECTION_TITLE}>Whale Alerts</span>
          </div>
          {whaleLoading && <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Loading...</span>}
        </div>

        {whaleAlerts && Object.keys(whaleAlerts).length === 0 && !whaleLoading && (
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', padding: '8px 0' }}>No whale alerts right now.</div>
        )}

        <div style={{
          maxHeight: creatorsHeight ? `${Math.max(200, creatorsHeight - 60)}px` : 'none',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
        {whaleAlerts && Object.entries(whaleAlerts).map(([creator, { alerts: cAlerts, count }]) => {
          const isExpanded = whaleExpandedCreator === creator
          const urgCount = { critical: 0, high: 0, warning: 0 }
          cAlerts.forEach(a => { urgCount[a.urgency] = (urgCount[a.urgency] || 0) + 1 })
          return (
            <div key={creator} style={{ borderBottom: '1px solid transparent' }}>
              <div
                onClick={() => setWhaleExpandedCreator(isExpanded ? null : creator)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: 'var(--foreground-subtle)', fontSize: '10px' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--foreground)' }}>{creator}</span>
                  <span style={{ fontSize: '12px', color: '#E88C5C', fontWeight: 600 }}>{count} fan{count !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {urgCount.critical > 0 && <span style={{ background: 'rgba(232, 120, 120, 0.1)', color: '#E87878', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{urgCount.critical} CRITICAL</span>}
                  {urgCount.high > 0 && <span style={{ background: 'rgba(232, 200, 120, 0.08)', color: '#E8A878', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{urgCount.high} HIGH</span>}
                  {urgCount.warning > 0 && <span style={{ background: 'rgba(232, 200, 120, 0.08)', color: '#E8C878', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{urgCount.warning} WARNING</span>}
                </div>
              </div>

              {isExpanded && (
                <div style={{ paddingBottom: '12px' }}>
                  {/* Header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 44px 44px 54px 54px 58px 52px',
                    padding: '4px 8px', fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase',
                    borderBottom: '1px solid transparent',
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
                    const urgColors = { critical: { bg: 'rgba(232, 120, 120, 0.1)', text: '#E87878' }, high: { bg: 'rgba(232, 200, 120, 0.08)', text: '#E8A878' }, warning: { bg: 'rgba(232, 200, 120, 0.08)', text: '#E8C878' } }
                    const uc = urgColors[a.urgency] || urgColors.warning
                    const creatorId = creatorIdByName[creator]
                    return (
                      <div
                        key={a.fan}
                        onClick={() => {
                          if (creatorId) router.push(`/admin/creators?tab=fans&creator=${creatorId}&fan=${encodeURIComponent(a.fan)}`)
                        }}
                        title={creatorId ? `Open ${creator}'s fan tab` : ''}
                        style={{
                          display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 44px 44px 54px 54px 58px 52px',
                          padding: '8px 8px', fontSize: '12px', alignItems: 'center',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                          cursor: creatorId ? 'pointer' : 'default',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (creatorId) e.currentTarget.style.background = 'rgba(232, 143, 172, 0.06)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}
                      >
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{a.fan}</span>
                            <span style={{ background: uc.bg, color: uc.text, padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>{a.urgency}</span>
                          </div>
                          {a.username && (
                            <div style={{ color: 'var(--palm-pink)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              @{a.username}
                            </div>
                          )}
                        </div>
                        <span style={{ textAlign: 'right', color: 'rgba(240, 236, 232, 0.75)' }}>{a.medianGap}d</span>
                        <span style={{ textAlign: 'right', fontWeight: 600, color: a.currentGap > a.medianGap * 3 ? '#E87878' : '#E88C5C' }}>
                          {a.currentGap}d <span style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 400 }}>({a.gapRatio}x)</span>
                        </span>
                        <span style={{ textAlign: 'right', color: a.rolling30 === 0 ? '#E87878' : 'rgba(240, 236, 232, 0.75)', fontWeight: a.rolling30 === 0 ? 600 : 400 }}>{fmtK(a.rolling30)}</span>
                        <span style={{ textAlign: 'right', color: 'rgba(240, 236, 232, 0.75)' }}>{fmtK(a.monthlyAvg90)}</span>
                        <span style={{ textAlign: 'right', color: 'rgba(240, 236, 232, 0.75)' }}>{fmtK(a.lifetime)}</span>
                        <div style={{ textAlign: 'center' }}>
                          {result?.success ? (
                            <span style={{ fontSize: '11px', color: '#7DD3A4', fontWeight: 500 }}>&#10003; Sent</span>
                          ) : (
                            <button
                              disabled={isSending}
                              onClick={async (e) => {
                                e.stopPropagation()
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
                                background: isSending ? 'rgba(255,255,255,0.08)' : 'var(--palm-pink)', border: 'none', borderRadius: '4px',
                                padding: '4px 10px', fontSize: '10px', color: isSending ? 'var(--foreground-muted)' : '#060606', fontWeight: 700,
                                cursor: isSending ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                              }}
                            >
                              {isSending ? '...' : 'Send'}
                            </button>
                          )}
                          {result?.error && <div style={{ fontSize: '9px', color: '#E87878', marginTop: '2px' }}>{result.error}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        </div>{/* close whale scroll container */}
      </div>
      </div>{/* close Row 1 */}

      {/* ─── PIPELINE ACCESS ─── */}
      <PipelineAccessPanel />

      {/* ─── ROW 2: Pipeline + Posting + Period History ─── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-start' }}>

        {/* Pipeline Health */}
        <div style={{ ...CARD, flex: '1 1 0', padding: '14px 16px', minWidth: 0 }}>
          <div style={SECTION_TITLE}>Pipeline</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Today</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)', marginTop: '2px' }}>{pipeline.scrapedToday}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>This Week</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)', marginTop: '2px' }}>{pipeline.scrapedThisWeek}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Promoted</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--palm-pink)', marginTop: '2px' }}>{pipeline.promotedThisWeek}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Review</div>
              <div style={{
                fontSize: '18px', fontWeight: 700, marginTop: '2px',
                color: pipeline.reviewQueue > 20 ? '#E8C878' : 'var(--foreground)',
              }}>{pipeline.reviewQueue}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Analysis</div>
              <div style={{
                fontSize: '18px', fontWeight: 700, marginTop: '2px',
                color: pipeline.analysisQueue > 0 ? '#78B4E8' : 'var(--foreground)',
              }}>{pipeline.analysisQueue}</div>
            </div>
            <div>
              <div style={{ ...LABEL, fontSize: '9px' }}>Sources</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)', marginTop: '2px' }}>{pipeline.sourcesEnabled}</div>
            </div>
          </div>
          {pipeline.lastScrape && (
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '8px' }}>
              Last scrape: {new Date(pipeline.lastScrape).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* Posting Activity */}
        <div style={{ ...CARD, flex: '1 1 0', padding: '14px 16px', minWidth: 0 }}>
          <div style={SECTION_TITLE}>Posting (7 Days)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {posting.map(c => (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div style={{ width: '60px', fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>{c.name}</div>
                <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: 'rgba(240, 236, 232, 0.75)' }}>
                  <span><strong style={{ color: 'var(--foreground)' }}>{c.postedToday}</strong> today</span>
                  <span><strong style={{ color: 'var(--foreground)' }}>{c.postedThisWeek}</strong>/wk</span>
                  {c.telegramPending > 0 && (
                    <span style={{ color: '#E8C878' }}><strong>{c.telegramPending}</strong> TG</span>
                  )}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <MiniCalendar calendar={c.calendar} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Period History (inline in Row 2) */}
        {revenue.periods.length > 1 && (
          <div style={{ ...CARD, flex: '1 1 0', padding: '14px 16px', minWidth: 0 }}>
            <div style={SECTION_TITLE}>Period History</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 64px 64px 48px',
                gap: '6px', padding: '2px 0', borderBottom: '1px solid transparent',
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
                const deltaColor = periodDelta > 0 ? '#7DD3A4' : periodDelta < 0 ? '#E87878' : '#999'
                return (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '1fr 64px 64px 48px',
                    gap: '6px', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    opacity: i === 0 ? 1 : 0.7,
                  }}>
                    <span style={{ fontSize: '11px', color: 'var(--foreground)', fontWeight: i === 0 ? 600 : 400 }}>
                      {formatPeriodLabel(p.label) || `${p.start} – ${p.end}`}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground)', textAlign: 'right' }}>{fmtK(p.totalTR)}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#7DD3A4', textAlign: 'right' }}>{fmtK(p.netProfit)}</span>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: deltaColor, textAlign: 'right' }}>
                      {deltaStr || '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>{/* close Row 2 */}
    </div>
  )
}
