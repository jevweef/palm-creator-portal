'use client'

// Live Audit tab — the daily check-in for fan spending health + chatter QA.
// Button-triggered everything (no crons yet, per Evan — we train the triggers
// first). Rendered as the first tab of /admin/whale-hunting.
//
// Sections:
//  1. Creator picker — Run Audit works for anyone with sheet data;
//     Chatter QA / Update Fan Data need the OF API connection
//  2. Run Audit — transactions → per-fan personalized cadence → tier flags
//  3. Run Chatter QA — recent chatter-sent messages judged against her voice
//  4. Watchlist — Fan Tracker rows still in play (deep-links to Fans panel)

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import FansPanel from '../creators/_components/FansPanel'

// Selected creator persists in the URL (?creator=recXXX) so a refresh or
// share keeps you on the same creator — same pattern as the tab param.
function creatorFromUrl() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('creator') || ''
}
function writeCreatorToUrl(id) {
  const params = new URLSearchParams(window.location.search)
  if (id) params.set('creator', id); else params.delete('creator')
  window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
}

const TIER_COLORS = {
  warning: { bg: 'rgba(232, 200, 120, 0.12)', color: '#E8C878' },
  high: { bg: 'rgba(232, 140, 92, 0.12)', color: '#E88C5C' },
  critical: { bg: 'rgba(232, 120, 120, 0.15)', color: '#E87878' },
  dead: { bg: 'rgba(150, 150, 150, 0.12)', color: '#999' },
}
const SEV_COLORS = { low: '#E8C878', medium: '#E88C5C', high: '#E87878' }

// "2h ago" / "Jun 30" style last-run label (ET)
function fmtRun(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 36 * 60) return `${Math.round(mins / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

export default function AuditTab() {
  const [creators, setCreators] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [showAllWatchlist, setShowAllWatchlist] = useState(false)
  const [creatorId, setCreatorId] = useState(creatorFromUrl)
  const [loading, setLoading] = useState(true)
  const [audit, setAudit] = useState(null)
  const [auditing, setAuditing] = useState(false)
  const [qa, setQa] = useState(null)
  const [qaRunning, setQaRunning] = useState(false)
  const [sync, setSync] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [ofAccounts, setOfAccounts] = useState({}) // creatorRecordId -> [accountName]
  const [pulling, setPulling] = useState(false)
  const [pullResult, setPullResult] = useState(null)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)
  const [earnings, setEarnings] = useState(null)       // transactions etc. for the Fan CRM below
  const [earningsLoading, setEarningsLoading] = useState(false)
  const [focusFan, setFocusFan] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('fan') || ''))
  const [focusNonce, setFocusNonce] = useState(0) // bump per click so re-clicking the same fan reopens the modal
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whales/overview', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) {
        setCreators(data.creators || [])
        setWatchlist(data.watchlist || [])
        // Functional update — avoids the stale-closure reset that snapped the
        // picker back to the first creator after every audit. Keep a valid
        // URL-restored selection; only default when there's none.
        const list = data.creators || []
        const first = list.find((c) => c.connected)
        setCreatorId((prev) => (prev && list.some((c) => c.id === prev)) ? prev : (first?.id || prev))
      }
    } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  // Re-load whenever the user comes back to this tab/window — last-run stamps
  // and the watchlist must reflect reality, not a cached page state.
  useEffect(() => {
    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  // Revenue accounts per connected creator (for the transactions pull)
  useEffect(() => {
    fetch('/api/admin/invoicing/pull-transactions')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.connected) setOfAccounts(Object.fromEntries(d.connected.map(c => [c.creatorRecordId, c.accounts])))
      })
      .catch(() => {})
  }, [])

  const selected = creators.find((c) => c.id === creatorId)
  const visibleWatchlist = showAllWatchlist ? watchlist : watchlist.filter((w) => w.creatorId === creatorId)

  // ── The Save List, one brain (the audit) ─────────────────────────────────
  // URGENT: active fans off their own rhythm — sorted by tier, then by what
  // they're worth per month (money at stake). DORMANT: $500+ whales gone
  // 120d+ — revival targets, parked below.
  const TIER_RANK = { critical: 0, high: 1, warning: 2 }
  const isDormant = (w) => w.cadence?.tier === 'dead' || w.status === 'Dormant'
  const urgentList = visibleWatchlist.filter((w) => !isDormant(w))
    .sort((a, b) => ((TIER_RANK[a.cadence?.tier] ?? 3) - (TIER_RANK[b.cadence?.tier] ?? 3)) || ((b.cadence?.monthlyAvg90 || 0) - (a.cadence?.monthlyAvg90 || 0)))
  const dormantList = visibleWatchlist.filter(isDormant).sort((a, b) => (b.lifetime || 0) - (a.lifetime || 0))
  const atRiskMonthly = urgentList.reduce((sum, w) => sum + (w.cadence?.monthlyAvg90 || 0), 0)
  const dormantLifetime = dormantList.reduce((sum, w) => sum + (w.lifetime || 0), 0)
  const staleAlerts = urgentList.filter((w) => !w.lastAlert || (Date.now() - new Date(w.lastAlert)) / 86400000 > 30).length

  // Audit verdicts per fan → the CRM below shows the SAME tiers (one brain)
  const auditTiers = {}
  for (const w of watchlist) {
    if (w.creatorId !== creatorId) continue
    const k = (w.ofUsername || w.fanName || '').toLowerCase()
    if (k) auditTiers[k] = { ...(w.cadence || {}), tier: w.cadence?.tier || (w.status === 'Dormant' ? 'dead' : null) }
  }

  // Fan CRM data for the selected creator — same endpoint the Creators page
  // used before the Fans tab moved here.
  useEffect(() => {
    if (!selected) return
    let dead = false
    setEarnings(null); setEarningsLoading(true)
    fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(selected.aka || selected.name)}`)
      .then((r) => r.json())
      .then((d) => { if (!dead) setEarnings(d?.error ? null : d) })
      .catch(() => {})
      .finally(() => { if (!dead) setEarningsLoading(false) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId, creators.length])

  // Jump to a fan in the CRM below (switching creator first if needed)
  function openFan(w) {
    if (w.creatorId && w.creatorId !== creatorId) { setCreatorId(w.creatorId); writeCreatorToUrl(w.creatorId) }
    setFocusFan(w.ofUsername || w.fanName || '')
    setFocusNonce((n) => n + 1)
  }

  // Update Sales & Chargebacks — pulls new transactions from the OF API into
  // the SAME invoice sheet tabs (same as the Invoicing page button). This is
  // the "make the data current" step; the audit then reads that sheet.
  async function runPull() {
    setPulling(true); setError(null); setPullResult(null)
    try {
      const accounts = ofAccounts[creatorId] || []
      if (!accounts.length) throw new Error('No revenue accounts found for this creator')
      const parts = []
      for (const accountName of accounts) {
        const res = await fetch('/api/admin/invoicing/pull-transactions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorRecordId: creatorId, accountName }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Pull failed for ${accountName}`)
        parts.push(`${accountName}: +${data.Sales?.uploaded ?? 0} sales, +${data.Chargebacks?.uploaded ?? 0} chargebacks`)
      }
      setPullResult(parts.join(' · '))
      load()
    } catch (e) { setError(e.message) } finally { setPulling(false) }
  }

  // Backfill 2y history — one-time per creator. Only exports the window the
  // sheet is MISSING (exports bill per row), so a covered tab costs 0 credits.
  async function runBackfill() {
    setBackfilling(true); setError(null); setBackfillResult(null)
    try {
      const accounts = ofAccounts[creatorId] || []
      if (!accounts.length) throw new Error('No revenue accounts found for this creator')
      const parts = []
      for (const accountName of accounts) {
        const res = await fetch('/api/admin/invoicing/backfill-transactions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorRecordId: creatorId, accountName }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Backfill failed for ${accountName}`)
        const s = data.Sales || {}, c = data.Chargebacks || {}
        const bits = []
        for (const [label, r] of [['sales', s], ['chargebacks', c]]) {
          if (r.pending) bits.push(`${label} still exporting at OF (${r.progress ?? 0}%${r.totalRows ? ` of ${r.totalRows.toLocaleString()} rows` : ''}) — click Backfill again in a few minutes`)
          else if (r.note) bits.push(`${label} ${r.note}`)
          else bits.push(`+${r.uploaded ?? 0} ${label}${r.earliest ? ` back to ${r.earliest}` : ''}${r.credits ? ` (${r.credits} credits)` : ''}`)
        }
        parts.push(`${accountName}: ${bits.join(' · ')}`)
      }
      setBackfillResult(parts.join(' · '))
      load()
    } catch (e) { setError(e.message) } finally { setBackfilling(false) }
  }

  async function runAudit() {
    setAuditing(true); setError(null); setAudit(null)
    try {
      const res = await fetch('/api/admin/whales/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Audit failed')
      setAudit(data)
      load() // refresh watchlist with any new flags
    } catch (e) { setError(e.message) } finally { setAuditing(false) }
  }

  async function runQa() {
    setQaRunning(true); setError(null); setQa(null)
    try {
      const res = await fetch('/api/admin/whales/chatter-qa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'QA failed')
      setQa(data)
      load()
    } catch (e) { setError(e.message) } finally { setQaRunning(false) }
  }

  // Archive sync — STRICTLY ADDITIVE: appends full-fidelity transactions
  // (fan_id-keyed) + fan snapshots to /Palm Ops/OF Archive/. Never touches
  // the invoice spreadsheet or invoicing flow. Returns rebill-off alerts.
  async function runSync() {
    setSyncing(true); setError(null); setSync(null)
    try {
      const res = await fetch('/api/admin/whales/archive-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSync(data)
      load()
    } catch (e) { setError(e.message) } finally { setSyncing(false) }
  }

  const card = { background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px' }
  const h2 = { fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }
  const btn = (bg, color, disabled) => ({
    background: bg, color, border: 'none', borderRadius: '8px', padding: '9px 18px',
    fontSize: '13px', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  })

  if (loading) return <div style={{ padding: '40px', color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading whale dashboard…</div>

  return (
    <div style={{ padding: '18px 0', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <select value={creatorId} onChange={(e) => { setCreatorId(e.target.value); writeCreatorToUrl(e.target.value); setAudit(null); setQa(null); setSync(null); setPullResult(null); setBackfillResult(null); setError(null) }}
          style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>{c.aka}{c.connected ? ' ✓' : ' (not connected)'}</option>
          ))}
        </select>
        {selected && !selected.connected && (
          <span style={{ fontSize: '12px', color: '#E8C878' }}>
            Not connected — add her OF account at app.onlyfansapi.com, then set “OF API Account ID” on her creator record.
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={runPull} disabled={pulling || !selected?.connected} style={btn('rgba(120, 180, 232, 0.12)', '#78B4E8', pulling || !selected?.connected)}>
          {pulling ? 'Updating…' : 'Update Sales & Chargebacks'}
        </button>
        <button onClick={runBackfill} disabled={backfilling || !selected?.connected} style={btn('rgba(120, 180, 232, 0.08)', '#6B94B8', backfilling || !selected?.connected)}
          title="One-time: pulls the older history the sheet is missing, back to 2 years. Costs credits only for missing rows.">
          {backfilling ? 'Backfilling…' : 'Backfill 2y History'}
        </button>
        <button onClick={runAudit} disabled={auditing} style={btn('rgba(125, 211, 164, 0.12)', '#7DD3A4', auditing)}>
          {auditing ? 'Auditing…' : 'Run Audit'}
        </button>
        <button onClick={runQa} disabled={qaRunning || !selected?.connected} style={btn('rgba(196, 165, 247, 0.12)', '#A06FE8', qaRunning || !selected?.connected)}>
          {qaRunning ? 'Reviewing chats…' : 'Run Chatter QA'}
        </button>
        <button onClick={runSync} disabled={syncing || !selected?.connected} style={btn('rgba(120, 180, 232, 0.12)', '#78B4E8', syncing || !selected?.connected)}>
          {syncing ? 'Updating fan data…' : 'Update Fan Data'}
        </button>
      </div>

      {/* Last-run stamps for the selected creator (stored on her record) */}
      {selected && (
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>Sales & chargebacks: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.sales)}</b></span>
          <span>Audit: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.audit)}</b></span>
          <span>Fan data: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.fanData)}</b></span>
          <span>Chatter QA: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.qa)}</b></span>
        </div>
      )}

      {/* ── Summary strip — the 10-second read ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {[
          { label: 'At risk / month', value: `$${Math.round(atRiskMonthly).toLocaleString()}`, sub: 'what the urgent fans normally spend', color: '#E87878' },
          { label: 'Urgent fans', value: urgentList.length, sub: 'off their own buying rhythm now', color: '#E8C878' },
          { label: 'Dormant whales', value: dormantList.length, sub: `$${Math.round(dormantLifetime).toLocaleString()} lifetime parked`, color: '#A06FE8' },
          { label: 'Need a fresh alert', value: staleAlerts, sub: 'no alert sent in 30+ days', color: staleAlerts ? '#E88C5C' : '#7DD3A4' },
          { label: 'Data freshness', value: fmtRun(selected?.runs?.sales), sub: 'last sales & chargebacks pull', color: '#78B4E8' },
        ].map((c) => (
          <div key={c.label} style={{ ...card, padding: '14px 16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>{c.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '3px' }}>{c.sub}</div>
          </div>
        ))}
      </div>


      {pullResult && <div style={{ fontSize: '12px', color: '#78B4E8' }}>✓ Sheet updated — {pullResult}. Now run the audit.</div>}
      {backfillResult && <div style={{ fontSize: '12px', color: '#6B94B8' }}>✓ Backfill — {backfillResult}</div>}
      {error && <div style={{ ...card, borderColor: 'rgba(232,120,120,0.35)', color: '#E87878', fontSize: '13px' }}>{error}</div>}

      {/* Audit results */}
      {audit && (
        <div style={card}>
          <h2 style={h2}>Audit — {audit.creator} ({audit.window})</h2>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
            {audit.transactions} transactions · {audit.fansWithSpend} paying fans · {audit.fansOverMinimum} over minimum ·
            flagged {audit.triggered.length} · tracker: +{audit.tracker.created} new, {audit.tracker.updated} updated ·
            {audit.source ? ` source: ${audit.source}` : ''}
          </div>
          {audit.triggered.length > 0 && (
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginBottom: '14px' }}>
              <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Fan</th><th>Tier</th><th>Lifetime</th><th>Rhythm</th><th>Silent</th><th>30d</th><th>Last buy</th>
              </tr></thead>
              <tbody>
                {audit.triggered.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{t.fanName}{t.ofUsername ? <span style={{ color: 'var(--foreground-muted)' }}> @{t.ofUsername}</span> : null}</td>
                    <td><span style={{ ...TIER_COLORS[t.tier] ? { background: TIER_COLORS[t.tier].bg, color: TIER_COLORS[t.tier].color } : {}, padding: '2px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>{t.tier}</span></td>
                    <td>${Math.round(t.lifetime)}</td>
                    <td>every ~{t.medianGap}d</td>
                    <td>{t.currentGap}d ({t.gapRatio}×)</td>
                    <td>${Math.round(t.rolling30)}</td>
                    <td>{t.lastPurchaseDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary style={{ fontSize: '12px', color: 'var(--foreground-muted)', cursor: 'pointer' }}>Top spenders ({audit.topSpenders.length})</summary>
            <div style={{ fontSize: '12px', color: 'var(--foreground)', marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '6px' }}>
              {audit.topSpenders.map((t, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--background)', borderRadius: '6px' }}>
                  <b>${Math.round(t.lifetime)}</b> — {t.fanName}
                  <span style={{ color: 'var(--foreground-muted)' }}> · {t.purchases} buys{t.tier ? ` · ${t.tier}` : ''}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Chatter QA results */}
      {qa && (
        <div style={card}>
          <h2 style={h2}>Chatter QA — {qa.creator} (last {qa.days}d)</h2>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
            {qa.chatsScanned} chats · {qa.messagesReviewed} chatter messages reviewed ·
            {qa.hasVoiceProfile ? ' judged against her voice profile' : ' no voice profile on file (generic judgment)'} ·
            {qa.findings.length === 0 ? ' no problems found ✓' : ` ${qa.findings.length} flagged`}
          </div>
          {qa.findings.map((fd, i) => (
            <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 4px', fontSize: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                <b style={{ color: SEV_COLORS[fd.severity] || 'var(--foreground)' }}>{(fd.severity || '').toUpperCase()}</b>
                {(fd.issues || []).map((iss) => (
                  <span key={iss} style={{ background: 'rgba(232,120,120,0.1)', color: '#E87878', padding: '1px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{iss}</span>
                ))}
                <span style={{ color: 'var(--foreground-muted)' }}>to {fd.fan} · {fd.at ? new Date(fd.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''} ET</span>
              </div>
              <div style={{ color: 'var(--foreground)', marginBottom: '3px' }}>“{fd.message}”</div>
              <div style={{ color: 'var(--foreground-muted)' }}>{fd.why}</div>
              {fd.better && <div style={{ color: '#7DD3A4', marginTop: '3px' }}>↳ better: “{fd.better}”</div>}
            </div>
          ))}
        </div>
      )}

      {/* Archive sync + rebill-off alerts */}
      {sync && (
        <div style={card}>
          <h2 style={h2}>Fan Data — {sync.creator}</h2>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
            {sync.fanCount} active fans snapshotted (spend, sub price, auto-renew, last seen) · saved to Dropbox {sync.archivePath}
          </div>
          <h2 style={{ ...h2, marginTop: '6px' }}>Rebill OFF — save these subs ({sync.rebillOff?.length ?? 0})</h2>
          {(sync.rebillOff || []).length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>No high-value fans set to expire. ✓</div>
          ) : (
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Fan</th><th>Lifetime</th><th>Tips</th><th>PPV</th><th>Expires</th><th>Last seen</th><th></th>
              </tr></thead>
              <tbody>
                {sync.rebillOff.map((f) => (
                  <tr key={f.fanId} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                      {f.name}{f.username ? <span style={{ color: 'var(--foreground-muted)' }}> @{f.username}</span> : null}
                      {f.newThisSync && <span style={{ marginLeft: '6px', background: 'rgba(232,120,120,0.15)', color: '#E87878', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>NEW</span>}
                    </td>
                    <td>${Math.round(f.total)}</td>
                    <td>${Math.round(f.tips)}</td>
                    <td>${Math.round(f.messages)}</td>
                    <td>{f.expireDate ? new Date(f.expireDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td style={{ color: 'var(--foreground-muted)' }}>{f.lastSeen ? new Date(f.lastSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td>
                      <button onClick={() => openFan({ creatorId, ofUsername: f.username, fanName: f.name })} style={{ background: 'none', border: 'none', color: '#A06FE8', fontSize: '11px', cursor: 'pointer', padding: 0 }}>view fan ↓</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── SAVE LIST — urgent: go get these fans back NOW ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={h2}>Save List — {showAllWatchlist ? 'all creators' : (selected?.aka || '')} ({urgentList.length} urgent)</h2>
          <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', marginBottom: '12px' }}>
            <input type="checkbox" checked={showAllWatchlist} onChange={(e) => setShowAllWatchlist(e.target.checked)} />
            show all creators
          </label>
        </div>
        {urgentList.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            No one is falling off their rhythm right now. Run an audit after pulling fresh sales to re-check.
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px' }}>Status</th><th>Fan</th>{showAllWatchlist && <th>Creator</th>}<th>Why</th><th style={{ textAlign: 'right' }}>Worth / mo</th><th style={{ textAlign: 'right' }}>Last 30d</th><th style={{ textAlign: 'right' }}>Lifetime</th><th>Last buy</th><th>Last alert</th><th></th>
            </tr></thead>
            <tbody>
              {urgentList.map((w) => {
                const cad = w.cadence
                const tc = (cad?.tier && TIER_COLORS[cad.tier]) || { bg: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)' }
                return (
                  <tr key={w.id} onClick={() => openFan(w)}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '7px 8px' }}><span style={{ background: tc.bg, color: tc.color, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{cad?.tier || 'flagged'}</span></td>
                    <td style={{ fontWeight: 600 }}>{w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> @{w.ofUsername}</span> : null}</td>
                    {showAllWatchlist && <td>{w.creator}</td>}
                    <td style={{ color: 'var(--foreground-muted)' }}>{cad?.medianGap
                      ? <>buys every ~{cad.medianGap}d — <span style={{ color: tc.color, fontWeight: 600 }}>silent {cad.currentGap}d ({cad.gapRatio}×)</span></>
                      : 'flagged manually — run the audit for rhythm data'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{cad?.monthlyAvg90 ? `$${Math.round(cad.monthlyAvg90)}` : '—'}</td>
                    <td style={{ textAlign: 'right', color: (cad?.rolling30 || 0) === 0 ? '#E87878' : 'var(--foreground)' }}>{cad ? `$${Math.round(cad.rolling30)}` : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--foreground-muted)' }}>${Math.round(w.lifetime).toLocaleString()}</td>
                    <td style={{ color: 'var(--foreground-muted)', fontSize: '11px' }}>{cad?.lastPurchaseDate || '—'}</td>
                    <td style={{ fontSize: '11px' }}>{(() => {
                      if (!w.lastAlert) return <span style={{ color: '#E88C5C' }}>never</span>
                      const days = Math.round((Date.now() - new Date(w.lastAlert)) / 86400000)
                      const label = new Date(w.lastAlert).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      return days > 30
                        ? <span style={{ color: 'var(--foreground-muted)' }}>{label} <span style={{ fontSize: '9px', opacity: 0.7 }}>(stale)</span></span>
                        : <span style={{ color: '#7DD3A4' }}>{label}</span>
                    })()}</td>
                    <td style={{ color: '#A06FE8', fontSize: '11px' }}>view →</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── DORMANT WHALES — big lifetime, long gone; revival targets ── */}
      {dormantList.length > 0 && (
        <details style={{ ...card, padding: '14px 18px' }}>
          <summary style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer' }}>
            Dormant Whales ({dormantList.length}) — ${Math.round(dormantLifetime).toLocaleString()} lifetime, gone 120d+
          </summary>
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px' }}>Fan</th>{showAllWatchlist && <th>Creator</th>}<th style={{ textAlign: 'right' }}>Lifetime</th><th>Last buy</th><th>Silent</th><th>Last alert</th><th></th>
            </tr></thead>
            <tbody>
              {dormantList.map((w) => (
                <tr key={w.id} onClick={() => openFan(w)}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)', cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '7px 8px', fontWeight: 600 }}>{w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> @{w.ofUsername}</span> : null}</td>
                  {showAllWatchlist && <td>{w.creator}</td>}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>${Math.round(w.lifetime).toLocaleString()}</td>
                  <td style={{ color: 'var(--foreground-muted)', fontSize: '11px' }}>{w.cadence?.lastPurchaseDate || '—'}</td>
                  <td style={{ color: 'var(--foreground-muted)' }}>{w.cadence?.currentGap ? `${w.cadence.currentGap}d` : '—'}</td>
                  <td style={{ color: 'var(--foreground-muted)', fontSize: '11px' }}>{w.lastAlert ? new Date(w.lastAlert).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'}</td>
                  <td style={{ color: '#A06FE8', fontSize: '11px' }}>view →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* ── Fan CRM — the per-fan workbench (moved from Creators → Fans) ── */}
      {selected && (
        <div style={card}>
          <h2 style={h2}>Fan CRM — {selected.aka}</h2>
          {earningsLoading && !earnings ? (
            <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', padding: '20px 0' }}>Loading {selected.aka}&apos;s fans…</div>
          ) : (
            <FansPanel key={selected.id} creator={selected} allTxns={earnings?.transactions} goingColdAlerts={earnings?.goingColdAlerts || []} availableAccounts={earnings?.accounts || []} focusFan={focusFan} focusNonce={focusNonce} auditTiers={auditTiers} />
          )}
        </div>
      )}
    </div>
  )
}
