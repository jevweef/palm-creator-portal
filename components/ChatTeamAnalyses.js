'use client'

import { useEffect, useMemo, useState } from 'react'

// Whale analyses list — shared by the chat-manager view (/photo-library
// Analyses tab) and admins. Legible replacement for PDF alerts in Telegram.
// Chat managers (Juan & co) log in, see every analysis (manager brief up
// front, full analysis expandable), and can request new ones. Telegram alerts
// deep-link here via ?fan=<username>.

const fmtD = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })
}

export default function ChatTeamAnalyses() {
  const [analyses, setAnalyses] = useState(null)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [search, setSearch] = useState('')
  const [req, setReq] = useState({ creator: '', fanName: '', note: '' })
  const [reqState, setReqState] = useState(null) // 'sending' | 'sent' | error string
  const [fanStats, setFanStats] = useState({}) // analysisId -> stats | 'loading' | null

  useEffect(() => {
    fetch('/api/chat-team/analyses', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setAnalyses(d.analyses || [])
        // deep link: ?fan=<username or name> opens that fan's newest analysis
        try {
          const target = (new URLSearchParams(window.location.search).get('fan') || '').toLowerCase()
          if (target) {
            const hit = (d.analyses || []).find((a) => a.fanName.toLowerCase().includes(target))
            if (hit) setOpenId(hit.id)
          }
        } catch { /* no window */ }
      })
      .catch((e) => setError(e.message))
  }, [])

  const filtered = useMemo(() => {
    if (!analyses) return []
    const q = search.trim().toLowerCase()
    if (!q) return analyses
    return analyses.filter((a) => a.fanName.toLowerCase().includes(q) || a.creator.toLowerCase().includes(q))
  }, [analyses, search])

  // Same money picture the admin fan modal shows — fetched lazily per card.
  function loadFanStats(a) {
    if (fanStats[a.id] !== undefined) return
    setFanStats((m) => ({ ...m, [a.id]: 'loading' }))
    fetch(`/api/chat-team/fan?creator=${encodeURIComponent(a.creator)}&fanName=${encodeURIComponent(a.fanName)}&fanUsername=${encodeURIComponent(a.ofUsername || '')}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setFanStats((m) => ({ ...m, [a.id]: d.error ? null : d })))
      .catch(() => setFanStats((m) => ({ ...m, [a.id]: null })))
  }

  async function submitRequest(e) {
    e.preventDefault()
    if (!req.fanName.trim()) return
    setReqState('sending')
    try {
      const res = await fetch('/api/chat-team/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Request failed')
      setReqState('sent')
      setReq({ creator: '', fanName: '', note: '' })
      setTimeout(() => setReqState(null), 4000)
    } catch (err) { setReqState(err.message) }
  }

  return (
    <div style={{ color: 'var(--foreground, #F0ECE8)' }}>
      <div style={{ maxWidth: '900px', padding: '4px 0 60px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 4px' }}>Whale Analyses</h1>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted, #8B8680)', marginBottom: '20px' }}>
          Newest first. The short brief is the play — open a card for the full breakdown.
        </div>

        {/* Request an analysis */}
        <form onSubmit={submitRequest} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px', marginBottom: '22px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground-muted, #8B8680)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Request an analysis</span>
          <input value={req.fanName} onChange={(e) => setReq({ ...req, fanName: e.target.value })} placeholder="Fan name / @username" required
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: 'inherit', minWidth: '180px' }} />
          <input value={req.creator} onChange={(e) => setReq({ ...req, creator: e.target.value })} placeholder="Creator"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: 'inherit', minWidth: '120px' }} />
          <input value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} placeholder="Why? (optional)"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: 'inherit', flex: 1, minWidth: '160px' }} />
          <button type="submit" disabled={reqState === 'sending'}
            style={{ background: 'rgba(160,111,232,0.2)', border: '1px solid rgba(160,111,232,0.45)', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, color: '#C4A5F7', cursor: 'pointer' }}>
            {reqState === 'sending' ? 'Sending…' : 'Send request'}
          </button>
          {reqState === 'sent' && <span style={{ fontSize: '12px', color: '#7DD3A4' }}>Request sent — it goes straight to Evan.</span>}
          {reqState && reqState !== 'sending' && reqState !== 'sent' && <span style={{ fontSize: '12px', color: '#E87878' }}>{reqState}</span>}
        </form>

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fan or creator…"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: 'inherit', width: '100%', marginBottom: '16px' }} />

        {error && <div style={{ color: '#E87878', fontSize: '13px', marginBottom: '14px' }}>{error}</div>}
        {!analyses && !error && <div style={{ color: 'var(--foreground-muted, #8B8680)', fontSize: '13px' }}>Loading analyses…</div>}
        {analyses && filtered.length === 0 && <div style={{ color: 'var(--foreground-muted, #8B8680)', fontSize: '13px' }}>No analyses match.</div>}

        {filtered.map((a) => {
          const open = openId === a.id
          return (
            <div key={a.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', marginBottom: '10px', overflow: 'hidden' }}>
              <button onClick={() => { setOpenId(open ? null : a.id); if (!open) loadFanStats(a) }}
                style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: '10px', background: 'none', border: 'none', color: 'inherit', textAlign: 'left', padding: '12px 16px', cursor: 'pointer' }}>
                <span style={{ fontWeight: 700, fontSize: '14px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fanName}</span>
                <span style={{ fontSize: '12px', color: '#C4A5F7', whiteSpace: 'nowrap' }}>{a.creator}</span>
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted, #8B8680)', whiteSpace: 'nowrap' }}>{fmtD(a.analyzedAt)}</span>
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted, #8B8680)' }}>{open ? '▲' : '▼'}</span>
              </button>
              {a.managerBrief && (
                <div style={{ padding: '0 16px 12px', fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#E8D5A8', borderBottom: open ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  {a.managerBrief.replace(/\*\*/g, '')}
                </div>
              )}
              {open && (() => {
                const st = fanStats[a.id]
                if (st === 'loading') return <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--foreground-muted, #8B8680)' }}>Loading his numbers…</div>
                if (!st) return null
                const fmtMoney = (v) => '$' + Math.round(v || 0).toLocaleString()
                const fmtD = (iso) => iso ? new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'
                const heatStatus = st.tier === 'dead' ? 'Dead' : st.tier ? 'Going Cold' : null
                // Verbatim styling from the admin fan modal (FansPanel stats grid)
                const cellLabel = { fontSize: '9px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '1px', whiteSpace: 'nowrap' }
                const cellVal = { fontSize: '13px', color: 'var(--foreground)', whiteSpace: 'nowrap' }
                const groupTag = { fontSize: '9px', fontWeight: 700, color: '#A06FE8', textTransform: 'uppercase', letterSpacing: '0.08em', width: '62px', flexShrink: 0, paddingBottom: '3px' }
                const groupRow = { display: 'flex', gap: '8px 26px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '7px 0' }
                const maxNet = Math.max(1, ...(st.series || []).map((x) => x.net))
                return (
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {heatStatus && (
                      <div style={{
                        marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', fontSize: '11px',
                        display: 'flex', gap: '8px', alignItems: 'center',
                        background: heatStatus === 'Dead' ? 'rgba(255,255,255,0.04)' : 'rgba(232, 120, 120, 0.08)',
                        border: `1px solid ${heatStatus === 'Dead' ? 'rgba(255,255,255,0.1)' : 'rgba(232, 120, 120, 0.2)'}`,
                        color: heatStatus === 'Dead' ? 'var(--foreground-muted)' : '#E87878',
                      }}>
                        <strong style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{heatStatus}</strong>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          {st.medianGap ? `buys every ~${st.medianGap}d — silent ${st.currentGap}d (${st.gapRatio}×)` : `silent ${st.currentGap ?? '—'}d`}
                        </span>
                      </div>
                    )}
                    <div style={{ background: 'var(--background)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px 14px' }}>
                      {/* ── MONEY ── */}
                      <div style={groupRow}>
                        <div style={groupTag}>Money</div>
                        <div>
                          <div style={cellLabel}>Lifetime</div>
                          <strong style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--foreground)' }}>{fmtMoney(st.lifetime)}</strong>
                        </div>
                        <div>
                          <div style={cellLabel}>Last 30d</div>
                          <div style={{ ...cellVal, fontSize: '16px', fontWeight: 700, color: (st.rolling30 || 0) < (st.monthlyAvg90 || 0) * 0.5 ? '#E87878' : '#7DD3A4' }}>
                            {fmtMoney(st.rolling30)}<span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--foreground-muted)' }}> vs {fmtMoney(st.monthlyAvg90)}/mo avg</span>
                          </div>
                        </div>
                        <div>
                          <div style={cellLabel}>90d avg/mo</div>
                          <div style={cellVal}>{fmtMoney(st.monthlyAvg90)}</div>
                        </div>
                        <div>
                          <div style={cellLabel} title="avg $/mo across his hottest 6-month stretch">Best 6-mo avg</div>
                          <div style={{ ...cellVal, fontWeight: 600 }}>{fmtMoney(st.best6moAvg)}/mo</div>
                        </div>
                        {st.peakMonth && (
                          <div>
                            <div style={cellLabel}>Peak month</div>
                            <div style={{ ...cellVal, fontWeight: 600 }}>{fmtMoney(st.peakMonthSpend)} <span style={{ fontWeight: 400, color: 'var(--foreground-muted)' }}>{fmtD(st.peakMonth + '-15')}</span></div>
                          </div>
                        )}
                        <div>
                          <div style={cellLabel} title="months where he spent $500+">$500+ months</div>
                          <div style={{ ...cellVal, fontWeight: 600, color: st.monthsOver500 >= 3 ? '#7DD3A4' : 'var(--foreground)' }}>{st.monthsOver500 || 0}</div>
                        </div>
                      </div>
                      {/* ── TIMELINE ── */}
                      <div style={{ ...groupRow, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={groupTag}>Timeline</div>
                        <div>
                          <div style={cellLabel}>First buy</div>
                          <div style={cellVal}>{fmtD(st.firstBuy)}</div>
                        </div>
                        <div>
                          <div style={cellLabel}>Last buy</div>
                          <div style={cellVal}>{fmtD(st.lastBuy)}</div>
                        </div>
                        <div>
                          <div style={cellLabel}>Silent</div>
                          <div style={{ ...cellVal, fontSize: '16px', fontWeight: 700, color: '#E87878' }}>{st.silentDays != null ? st.silentDays + 'd' : '—'} {st.medianGap ? <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--foreground-muted)' }}>vs ~{st.medianGap}d rhythm</span> : null}</div>
                        </div>
                        <div>
                          <div style={cellLabel}>Sessions</div>
                          <div style={cellVal}>{st.purchases || 0}</div>
                        </div>
                      </div>
                      {/* ── ALERTS ── */}
                      {a.firstFlagged && (
                        <div style={{ ...groupRow, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={groupTag}>Alerts</div>
                          <div>
                            <div style={cellLabel}>First flagged</div>
                            <div style={cellVal}>{fmtD(a.firstFlagged)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                    {st.series?.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Spending History</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '90px' }}>
                          {st.series.map((pt) => (
                            <div key={pt.month} title={`${pt.month}: $${pt.net.toLocaleString()}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: '3px', minWidth: 0 }}>
                              <div style={{ width: '100%', maxWidth: '26px', height: `${Math.max(2, Math.round((pt.net / maxNet) * 70))}px`, background: 'rgba(232,160,160,0.55)', borderRadius: '3px 3px 0 0' }} />
                              <div style={{ fontSize: '8px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>{pt.month.slice(2).replace('-', "'")}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
              {open && a.fullAnalysis && (
                <div style={{ padding: '14px 16px', fontSize: '13px', lineHeight: 1.65, whiteSpace: 'pre-wrap', color: 'var(--foreground, #F0ECE8)', maxHeight: '70vh', overflowY: 'auto' }}>
                  {a.fullAnalysis.replace(/\*\*/g, '')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
