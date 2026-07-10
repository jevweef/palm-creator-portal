'use client'

import { useEffect, useMemo, useState } from 'react'
import { FanRow, ALERT_STATUS_COLORS } from '@/app/admin/creators/_components/FansPanel'

// Chat-manager Whale Hunting — the admin Save List grid, VERBATIM, filtered
// to fans whose analysis was sent to the team. Row click opens the exact
// admin fan modal (FanRow, read-only). URL carries ?creator=<id>&fan=<key>.

const TIER_COLORS = {
  warning: { bg: 'rgba(232, 200, 120, 0.12)', color: '#E8C878' },
  high: { bg: 'rgba(232, 140, 92, 0.12)', color: '#E88C5C' },
  critical: { bg: 'rgba(232, 120, 120, 0.15)', color: '#E87878' },
  dead: { bg: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)' },
}

const fmtD = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso)
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function ChatManagerWhaleHunting() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [creatorId, setCreatorId] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('creator') || ''))
  const [openFan, setOpenFan] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('fan') || ''))
  const [deepLinked] = useState(() => (typeof window === 'undefined' ? false : !!new URLSearchParams(window.location.search).get('fan')))
  const [fanFull, setFanFull] = useState({}) // fanKey -> {fan, txns} | 'loading' | null

  useEffect(() => {
    // Admin "View As <chat manager>" uses the same localStorage contract as
    // the photo library — pass it through so team scoping matches.
    let viewAs = ''
    try {
      const raw = window.localStorage.getItem('superadmin_chatManager')
      viewAs = raw ? (JSON.parse(raw)?.id || '') : ''
    } catch { /* none */ }
    fetch(`/api/chat-team/watchlist${viewAs ? `?viewAsUserId=${encodeURIComponent(viewAs)}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setData(d) })
      .catch((e) => setError(e.message))
  }, [])

  // default creator: URL value, else the first creator that has sent fans
  useEffect(() => {
    if (!data || creatorId) return
    const withFans = data.creators.find((c) => data.watchlist.some((w) => w.creatorId === c.id))
    if (withFans) setCreatorId(withFans.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const writeUrl = (cid, fan) => {
    try {
      const p = new URLSearchParams(window.location.search)
      if (cid) p.set('creator', cid); else p.delete('creator')
      if (fan) p.set('fan', fan); else p.delete('fan')
      window.history.replaceState(null, '', `${window.location.pathname}${p.toString() ? '?' + p : ''}`)
    } catch { /* SSR */ }
  }

  const rows = useMemo(() => {
    if (!data) return []
    const TIER_RANK = { critical: 0, high: 1, warning: 2, dead: 3 }
    return data.watchlist
      .filter((w) => w.creatorId === creatorId)
      .sort((a, b) => ((TIER_RANK[a.cadence?.tier] ?? 4) - (TIER_RANK[b.cadence?.tier] ?? 4)) || (b.lifetime - a.lifetime))
  }, [data, creatorId])

  function openModal(w) {
    const key = w.ofUsername || w.fanName || ''
    setOpenFan(key)
    writeUrl(creatorId, key)
    if (fanFull[key] === undefined) {
      setFanFull((m) => ({ ...m, [key]: 'loading' }))
      fetch(`/api/chat-team/fan-full?creator=${encodeURIComponent(w.creator)}&fanName=${encodeURIComponent(w.fanName)}&fanUsername=${encodeURIComponent(w.ofUsername || '')}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => setFanFull((m) => ({ ...m, [key]: d.error ? null : d })))
        .catch(() => setFanFull((m) => ({ ...m, [key]: null })))
    }
  }

  // reopen from URL once rows are in
  useEffect(() => {
    if (!openFan || !rows.length) return
    const w = rows.find((x) => (x.ofUsername || x.fanName || '') === openFan || (x.fanName || '') === openFan)
    if (w && fanFull[openFan] === undefined) openModal(w)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length])

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const fmtMoney = (n) => (!n && n !== 0) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  const worthMo = (w) => Math.max(w.cadence?.best6moAvg || 0, w.cadence?.monthlyAvg90 || 0)

  if (error) return <div style={{ color: '#E87878', fontSize: '13px' }}>{error}</div>
  if (!data) return <div style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading…</div>

  const modalRow = rows.find((x) => (x.ofUsername || x.fanName || '') === openFan)
  const modalIdx = modalRow ? rows.indexOf(modalRow) : -1
  const modalData = openFan ? fanFull[openFan] : undefined

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Whale Hunting</h1>
        <select value={creatorId} onChange={(e) => { setCreatorId(e.target.value); setOpenFan(''); writeUrl(e.target.value, '') }}
          style={{ background: 'var(--card-bg-solid, #1a1a1a)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
          {data.creators.map((c) => {
            const n = data.watchlist.filter((w) => w.creatorId === c.id).length
            return <option key={c.id} value={c.id}>{c.aka}{n ? ` (${n})` : ''}</option>
          })}
        </select>
        <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Fans your team was sent an analysis for — click one for the full picture.</span>
      </div>

      <div style={{ background: 'var(--card-bg-solid, #1a1a1a)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '6px 14px 10px', overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '30px', fontSize: '13px', color: 'var(--foreground-muted)' }}>No analyses have been sent for this creator yet.</div>
        ) : (
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>
              <th style={{ padding: '8px 8px 4px' }}>Status</th><th>Fan</th><th>Why</th>
              <th style={{ textAlign: 'right', padding: '4px 10px' }}>Worth / mo</th>
              <th style={{ textAlign: 'right', padding: '4px 10px' }}>Last 30d</th>
              <th style={{ textAlign: 'right', padding: '4px 10px' }}>Peak mo</th>
              <th style={{ textAlign: 'right', padding: '4px 10px' }}>Best 6mo avg</th>
              <th style={{ textAlign: 'right', padding: '4px 10px' }}>Lifetime</th>
              <th style={{ padding: '4px 10px' }}>Last buy</th>
              <th style={{ padding: '4px 10px' }}>Alert sent</th>
            </tr></thead>
            <tbody>
              {rows.map((w) => {
                const cad = w.cadence
                const tc = (cad?.tier && TIER_COLORS[cad.tier]) || { bg: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)' }
                return (
                  <tr key={w.id} onClick={() => openModal(w)}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '7px 8px' }}><span style={{ background: tc.bg, color: tc.color, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{cad?.tier || w.status}</span></td>
                    <td title={`${w.fanName}${w.ofUsername ? ' @' + w.ofUsername : ''}`}
                      style={{ fontWeight: 600, maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '6px 8px 6px 0' }}>
                      {w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> @{w.ofUsername}</span> : null}</td>
                    <td style={{ padding: '6px 8px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground-muted)' }}>
                      {cad?.medianGap ? <>buys every {cad.gapMin != null && cad.gapMax != null && cad.gapMax > cad.gapMin ? `${cad.gapMin}-${cad.gapMax}d (typical ~${cad.medianGap}d)` : `~${cad.medianGap}d`} — <span style={{ color: '#E87878' }}>silent {cad.currentGap}d</span></> : cad?.currentGap ? `silent ${cad.currentGap}d` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, padding: '7px 10px', whiteSpace: 'nowrap' }}>{worthMo(w) ? `$${Math.round(worthMo(w))}` : '—'}</td>
                    <td style={{ textAlign: 'right', color: (cad?.rolling30 || 0) === 0 ? '#E87878' : 'var(--foreground)', padding: '7px 10px', whiteSpace: 'nowrap' }}>{cad ? `$${Math.round(cad.rolling30 || 0)}` : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap' }}>{cad?.peakMonthSpend ? `$${Math.round(cad.peakMonthSpend)}` : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap' }}>{cad?.best6moAvg ? `$${Math.round(cad.best6moAvg)}` : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, padding: '7px 10px', whiteSpace: 'nowrap' }}>${Math.round(w.lifetime).toLocaleString()}</td>
                    <td style={{ color: 'var(--foreground-muted)', fontSize: '11px', padding: '7px 10px', whiteSpace: 'nowrap' }}>{fmtD(w.cadence?.lastPurchaseDate)}</td>
                    <td style={{ color: 'var(--foreground-muted)', fontSize: '11px', padding: '7px 10px', whiteSpace: 'nowrap' }}>{fmtD(w.lastAlert)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Fan modal — the REAL admin FanRow, read-only, same chrome */}
      {openFan && modalRow && (
        <div onClick={() => { setOpenFan(''); writeUrl(creatorId, '') }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 20px' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--card-bg-solid, #1a1a1a)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', width: 'min(1000px, 100%)', maxHeight: '94vh', overflowY: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: 'var(--card-bg-solid, #1a1a1a)', zIndex: 1 }}>
              <span style={{ fontSize: '13px', fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {modalRow.fanName}{modalRow.ofUsername ? <span style={{ color: 'var(--palm-pink, #E8A0A0)', fontWeight: 400 }}> @{modalRow.ofUsername}</span> : null}
                {modalIdx >= 0 && <span style={{ color: 'var(--foreground-muted)', fontWeight: 400, fontSize: '11px' }}>  ·  {modalIdx + 1} of {rows.length}</span>}
              </span>
              {[['‹ prev', rows[modalIdx - 1]], ['next ›', rows[modalIdx + 1]]].map(([label, target]) => (
                <button key={label} disabled={!target} onClick={() => target && openModal(target)}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', fontWeight: 700, color: target ? 'var(--foreground)' : 'rgba(255,255,255,0.15)', cursor: target ? 'pointer' : 'default' }}>{label}</button>
              ))}
              <button onClick={() => { setOpenFan(''); writeUrl(creatorId, '') }}
                style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--foreground-muted)', cursor: 'pointer', padding: '2px 6px' }}>&times;</button>
            </div>
            {modalData === 'loading' && <div style={{ padding: '40px', textAlign: 'center', fontSize: '13px', color: 'var(--foreground-muted)' }}>Loading…</div>}
            {modalData && modalData !== 'loading' && (
              <FanRow
                f={modalData.fan} i={0} isExpanded inModal readOnly
                autoViewAnalysis={deepLinked}
                onToggle={() => {}}
                alertStatusColors={ALERT_STATUS_COLORS}
                effectColors={{}}
                fmtDate={fmtDate} fmtMoney={fmtMoney}
                setFans={() => {}}
                creatorName={modalRow.creator} creatorAka={modalRow.creator} creatorRecordId={''}
                allTxns={modalData.txns || []}
                availableAccounts={[]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
