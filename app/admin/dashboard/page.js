'use client'

import { useState, useEffect, useCallback } from 'react'

const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = n => {
  if (n >= 10000) return '$' + (n / 1000).toFixed(1) + 'k'
  return fmt(n)
}
const pct = n => (n * 100).toFixed(0) + '%'

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

const VALUE = {
  fontSize: '28px',
  fontWeight: 700,
  color: '#1a1a1a',
}

/* ─── Stat Card ─── */
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ ...CARD, flex: '1 1 160px', minWidth: '140px' }}>
      <div style={LABEL}>{label}</div>
      <div style={{ ...VALUE, color: color || '#1a1a1a', marginTop: '4px' }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

/* ─── Status Badge ─── */
function StatusBadge({ status }) {
  const colors = {
    Paid: '#22c55e', Sent: '#3b82f6', Draft: '#999', Overdue: '#ef4444',
  }
  const bg = { Paid: '#f0fdf4', Sent: '#eff6ff', Draft: '#f5f5f5', Overdue: '#fef2f2' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 600,
      color: colors[status] || '#999',
      background: bg[status] || '#f5f5f5',
    }}>
      {status}
    </span>
  )
}

/* ─── Mini Trend Bar ─── */
function TrendBar({ values }) {
  if (!values || !values.length) return null
  const max = Math.max(...values, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '24px' }}>
      {values.map((v, i) => (
        <div key={i} style={{
          width: '12px',
          height: `${Math.max(2, (v / max) * 24)}px`,
          background: i === values.length - 1 ? '#E88FAC' : '#f3d1dc',
          borderRadius: '2px',
          transition: 'height 0.3s ease',
        }} />
      ))}
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
      <div style={{
        flex: 1, height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden',
      }}>
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
    low_runway: { color: '#ef4444', bg: '#fef2f2', label: `${alert.creator}: ${alert.bufferDays}d runway` },
    overdue_invoice: { color: '#ef4444', bg: '#fef2f2', label: `${alert.creator}: overdue invoice` },
    revision_stuck: { color: '#f59e0b', bg: '#fffbeb', label: `${alert.creator}: ${alert.count} revision${alert.count > 1 ? 's' : ''}` },
    analysis_errors: { color: '#f59e0b', bg: '#fffbeb', label: `${alert.count} analysis error${alert.count > 1 ? 's' : ''}` },
    empty_library: { color: '#f59e0b', bg: '#fffbeb', label: `${alert.creator}: empty library` },
  }
  const c = config[alert.type] || { color: '#999', bg: '#f5f5f5', label: alert.type }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 10px', borderRadius: '8px', fontSize: '12px',
      fontWeight: 600, color: c.color, background: c.bg,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.color }} />
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
              width: '24px', height: '24px', borderRadius: '4px',
              background: bg, color, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '11px', fontWeight: 600,
            }}>
              {count || ''}
            </div>
          </div>
        )
      })}
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

  return (
    <div style={{ maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: '12px', color: '#999' }}>{revenue.currentPeriodLabel}</span>
      </div>

      {/* ─── ALERTS ─── */}
      {alerts.length > 0 && (
        <div style={{
          ...CARD, marginBottom: '16px', padding: '12px 16px',
          display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
          border: '1px solid #fde8e8',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Action Items
          </span>
          {alerts.map((a, i) => <AlertPill key={i} alert={a} />)}
        </div>
      )}

      {/* ─── ROW 1: Revenue KPIs ─── */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <StatCard label="Active Creators" value={revenue.activeCreators} />
        <StatCard label="Current Period TR" value={fmtK(revenue.currentPeriodTR)} />
        <StatCard label="Palm Net Profit" value={fmtK(revenue.netProfit)} color="#22c55e" />
        <StatCard label="Projected Monthly" value={fmtK(revenue.projectedMonthlyNetProfit)} sub="net profit / 30d" color="#E88FAC" />
        <StatCard
          label="Outstanding"
          value={revenue.outstandingInvoices.count}
          sub={revenue.outstandingInvoices.count > 0 ? fmtK(revenue.outstandingInvoices.total) : 'all clear'}
          color={revenue.outstandingInvoices.count > 0 ? '#f59e0b' : '#22c55e'}
        />
      </div>

      {/* ─── ROW 2: Revenue by Creator + Editor Runway ─── */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>

        {/* Revenue by Creator */}
        <div style={{ ...CARD, flex: '3 1 400px', minWidth: '320px' }}>
          <div style={SECTION_TITLE}>Revenue by Creator</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {revenue.byCreator.map(c => (
              <div key={c.name} style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0',
                borderBottom: '1px solid #f5f5f5',
              }}>
                <div style={{ width: '80px', fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{c.name}</div>
                <div style={{ width: '80px', fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{fmtK(c.currentTR)}</div>
                <div style={{ width: '44px', fontSize: '11px', color: '#999' }}>{pct(c.commissionPct)}</div>
                <div style={{ width: '70px', fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>{fmtK(c.palmCut)}</div>
                <StatusBadge status={c.status || 'Draft'} />
                <div style={{ marginLeft: 'auto' }}>
                  <TrendBar values={c.trend} />
                </div>
              </div>
            ))}
            {revenue.byCreator.length === 0 && (
              <div style={{ fontSize: '13px', color: '#999', padding: '12px 0' }}>No invoice data yet</div>
            )}
          </div>
        </div>

        {/* Editor Runway */}
        <div style={{ ...CARD, flex: '2 1 280px', minWidth: '260px' }}>
          <div style={SECTION_TITLE}>Editor Runway</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {editorRunway.map(c => (
              <div key={c.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                  <span style={{ fontSize: '11px', color: '#999' }}>
                    {c.approvedPosts} posts | {c.quotaDone}/{c.quotaTarget} weekly
                  </span>
                </div>
                <RunwayBar days={c.bufferDays} />
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '11px', color: '#999' }}>
                  {c.toEdit > 0 && <span>{c.toEdit} to edit</span>}
                  {c.inProgress > 0 && <span>{c.inProgress} in progress</span>}
                  {c.inReview > 0 && <span style={{ color: '#3b82f6' }}>{c.inReview} in review</span>}
                  {c.needsRevision > 0 && <span style={{ color: '#ef4444' }}>{c.needsRevision} needs revision</span>}
                </div>
              </div>
            ))}
            {editorRunway.length === 0 && (
              <div style={{ fontSize: '13px', color: '#999' }}>No active creators</div>
            )}
          </div>
        </div>
      </div>

      {/* ─── ROW 3: Creator Library + Pipeline Health ─── */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>

        {/* Creator Library */}
        <div style={{ ...CARD, flex: '1 1 280px', minWidth: '260px' }}>
          <div style={SECTION_TITLE}>Creator Library</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px',
              gap: '4px', padding: '4px 0', borderBottom: '1px solid #f0f0f0',
            }}>
              <span style={{ ...LABEL, fontSize: '10px' }}>Creator</span>
              <span style={{ ...LABEL, fontSize: '10px', textAlign: 'right' }}>Photos</span>
              <span style={{ ...LABEL, fontSize: '10px', textAlign: 'right' }}>Videos</span>
              <span style={{ ...LABEL, fontSize: '10px', textAlign: 'right' }}>Total</span>
            </div>
            {creatorLibrary.map(c => (
              <div key={c.name} style={{
                display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px',
                gap: '4px', padding: '4px 0', borderBottom: '1px solid #fafafa',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{c.name}</span>
                <span style={{ fontSize: '13px', color: '#666', textAlign: 'right' }}>{c.photos}</span>
                <span style={{ fontSize: '13px', color: '#666', textAlign: 'right' }}>{c.videos}</span>
                <span style={{
                  fontSize: '13px', fontWeight: 700, textAlign: 'right',
                  color: c.total === 0 ? '#ef4444' : '#1a1a1a',
                }}>
                  {c.total}
                </span>
              </div>
            ))}
            {creatorLibrary.length === 0 && (
              <div style={{ fontSize: '13px', color: '#999', padding: '12px 0' }}>No creators</div>
            )}
          </div>
        </div>

        {/* Pipeline Health */}
        <div style={{ ...CARD, flex: '1 1 280px', minWidth: '260px' }}>
          <div style={SECTION_TITLE}>Pipeline Health</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={LABEL}>Scraped Today</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{pipeline.scrapedToday}</div>
            </div>
            <div>
              <div style={LABEL}>Scraped This Week</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{pipeline.scrapedThisWeek}</div>
            </div>
            <div>
              <div style={LABEL}>Review Queue</div>
              <div style={{
                fontSize: '22px', fontWeight: 700, marginTop: '2px',
                color: pipeline.reviewQueue > 20 ? '#f59e0b' : '#1a1a1a',
              }}>{pipeline.reviewQueue}</div>
            </div>
            <div>
              <div style={LABEL}>Analysis Queue</div>
              <div style={{
                fontSize: '22px', fontWeight: 700, marginTop: '2px',
                color: pipeline.analysisQueue > 0 ? '#3b82f6' : '#1a1a1a',
              }}>{pipeline.analysisQueue}</div>
            </div>
            <div>
              <div style={LABEL}>Promoted This Week</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#E88FAC', marginTop: '2px' }}>{pipeline.promotedThisWeek}</div>
            </div>
            <div>
              <div style={LABEL}>Sources Enabled</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>{pipeline.sourcesEnabled}</div>
            </div>
          </div>
          {pipeline.lastScrape && (
            <div style={{ fontSize: '11px', color: '#999', marginTop: '12px' }}>
              Last scrape: {new Date(pipeline.lastScrape).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
      </div>

      {/* ─── ROW 4: Posting Activity ─── */}
      <div style={{ ...CARD }}>
        <div style={SECTION_TITLE}>Posting Activity (Last 7 Days)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {posting.map(c => (
            <div key={c.name} style={{
              display: 'flex', alignItems: 'center', gap: '16px', padding: '8px 0',
              borderBottom: '1px solid #fafafa',
            }}>
              <div style={{ width: '80px', fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{c.name}</div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#666', minWidth: '180px' }}>
                <span><strong style={{ color: '#1a1a1a' }}>{c.postedToday}</strong> today</span>
                <span><strong style={{ color: '#1a1a1a' }}>{c.postedThisWeek}</strong> this week</span>
                {c.telegramPending > 0 && (
                  <span style={{ color: '#f59e0b' }}><strong>{c.telegramPending}</strong> TG pending</span>
                )}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <MiniCalendar calendar={c.calendar} />
              </div>
            </div>
          ))}
          {posting.length === 0 && (
            <div style={{ fontSize: '13px', color: '#999', padding: '12px 0' }}>No posting data</div>
          )}
        </div>
      </div>

      {/* ─── Period History ─── */}
      {revenue.periods.length > 1 && (
        <div style={{ ...CARD, marginTop: '16px' }}>
          <div style={SECTION_TITLE}>Period History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 100px 100px',
              gap: '8px', padding: '4px 0', borderBottom: '1px solid #f0f0f0',
            }}>
              <span style={{ ...LABEL, fontSize: '10px' }}>Period</span>
              <span style={{ ...LABEL, fontSize: '10px', textAlign: 'right' }}>Total TR</span>
              <span style={{ ...LABEL, fontSize: '10px', textAlign: 'right' }}>Net Profit</span>
            </div>
            {revenue.periods.map((p, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 100px',
                gap: '8px', padding: '6px 0', borderBottom: '1px solid #fafafa',
                opacity: i === 0 ? 1 : 0.7,
              }}>
                <span style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: i === 0 ? 600 : 400 }}>
                  {p.label || `${p.start} - ${p.end}`}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', textAlign: 'right' }}>{fmtK(p.totalTR)}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e', textAlign: 'right' }}>{fmtK(p.netProfit)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
