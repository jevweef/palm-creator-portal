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

import { useState, useEffect, useCallback, useRef } from 'react'
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

// House date style: "Jan 1, 25"
function fmtD(v) {
  if (!v) return '—'
  const str = String(v)
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + 'T12:00:00' : str)
  if (isNaN(d)) return str
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

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
  const [saveSort, setSaveSort] = useState(null) // {key, dir} | null = tier order
  const [fanSearch, setFanSearch] = useState('') // filters urgent + sent + dormant by name/@username
  const [dormSort, setDormSort] = useState(null) // {key, dir} for the dormant table
  const [focusFan, setFocusFan] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('fan') || ''))
  const [focusNonce, setFocusNonce] = useState(0) // bump per click so re-clicking the same fan reopens the modal
  const [error, setError] = useState(null)
  const [playbook, setPlaybook] = useState(null)
  const [batch, setBatch] = useState(null) // {i,total,current,log,done} — pull+analyze assembly line
  const [batchSel, setBatchSel] = useState(() => new Set()) // fan tracker row ids picked for a selective batch run
  const batchAbort = useRef(false)

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
  // A whale alert just went out (FansPanel dispatches after Confirm & Send):
  // refresh so the fan moves from the urgent list to 'Sent to chat managers'.
  useEffect(() => {
    const onSent = () => load()
    window.addEventListener('whale-alert-sent', onSent)
    return () => window.removeEventListener('whale-alert-sent', onSent)
  }, [load])

  // Re-load whenever the user comes back to this tab/window — last-run stamps
  // and the watchlist must reflect reality, not a cached page state.
  useEffect(() => {
    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  // Win-back playbook (synthesized from the OFM research corpus)
  useEffect(() => {
    fetch('/api/admin/whales/playbook').then(r => r.ok ? r.json() : null)
      .then(d => setPlaybook(d?.markdown || null)).catch(() => {})
  }, [])

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
  // Evan: nobody on the Save List under \$400 lifetime — smaller fans stay in
  // the CRM but don't take a whale slot.
  const overFloor = (w) => (w.lifetime || 0) >= 400
  const visibleWatchlist = (showAllWatchlist ? watchlist : watchlist.filter((w) => w.creatorId === creatorId)).filter(overFloor)

  // ── The Save List, one brain (the audit) ─────────────────────────────────
  // URGENT: active fans off their own rhythm — sorted by tier, then by what
  // they're worth per month (money at stake). DORMANT: $500+ whales gone
  // 120d+ — revival targets, parked below.
  const TIER_RANK = { critical: 0, high: 1, warning: 2 }
  const isDormant = (w) => w.cadence?.tier === 'dead' || w.status === 'Dormant'
  // Column sorting: click a money header to sort by it (desc → asc → back to
  // the default tier ordering).
  const SORT_METRICS = {
    worth: (w) => Math.max(w.cadence?.best6moAvg || 0, w.cadence?.monthlyAvg90 || 0),
    last30: (w) => w.cadence?.rolling30 || 0,
    peak: (w) => w.cadence?.peakMonthSpend || 0,
    best6: (w) => w.cadence?.best6moAvg || 0,
    lifetime: (w) => w.lifetime || 0,
    over500: (w) => w.cadence?.monthsOver500 || 0,
  }
  // Fans already SENT to the chat managers leave the urgent section — Evan
  // shouldn't have to squint at alert timestamps to know who's handled.
  const q = fanSearch.trim().toLowerCase()
  const matchesSearch = (w) => !q || (w.fanName || '').toLowerCase().includes(q) || (w.ofUsername || '').toLowerCase().includes(q)
  const isSent = (w) => w.status === 'Alert Sent' || !!w.lastAlert
  const sentList = visibleWatchlist.filter((w) => isSent(w) && matchesSearch(w)).sort((a, b) => (b.lastAlert || '').localeCompare(a.lastAlert || ''))
  const urgentList = visibleWatchlist.filter((w) => !isDormant(w) && !isSent(w) && matchesSearch(w))
    .sort((a, b) => {
      if (saveSort && SORT_METRICS[saveSort.key]) {
        const d = SORT_METRICS[saveSort.key](b) - SORT_METRICS[saveSort.key](a)
        return saveSort.dir === 'asc' ? -d : d
      }
      return ((TIER_RANK[a.cadence?.tier] ?? 3) - (TIER_RANK[b.cadence?.tier] ?? 3)) || ((b.cadence?.monthlyAvg90 || 0) - (a.cadence?.monthlyAvg90 || 0))
    })
  const clickSort = (key) => setSaveSort((s) => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null))
  const sortArrow = (key) => (saveSort?.key === key ? (saveSort.dir === 'desc' ? ' ▾' : ' ▴') : '')
  const DORM_METRICS = {
    lifetime: (w) => w.lifetime || 0,
    lastbuy: (w) => new Date(w.cadence?.lastPurchaseDate || 0).getTime(),
    silent: (w) => w.cadence?.currentGap || 0,
    alert: (w) => new Date(w.lastAlert || 0).getTime(),
  }
  const dormantList = visibleWatchlist.filter((w) => isDormant(w) && !isSent(w) && matchesSearch(w)).sort((a, b) => {
    if (dormSort && DORM_METRICS[dormSort.key]) {
      const d = DORM_METRICS[dormSort.key](b) - DORM_METRICS[dormSort.key](a)
      return dormSort.dir === 'asc' ? -d : d
    }
    return (b.lifetime || 0) - (a.lifetime || 0)
  })
  const dormSortClick = (key) => setDormSort((s0) => (s0?.key !== key ? { key, dir: 'desc' } : s0.dir === 'desc' ? { key, dir: 'asc' } : null))
  const dormArrow = (key) => (dormSort?.key === key ? (dormSort.dir === 'desc' ? ' ▾' : ' ▴') : '')
  // "Worth/mo" = his PROVEN level (best 6-month stretch), not the recent 90d
  // average — a going-cold fan's recent average is already depressed, which
  // made the at-risk number absurdly small (Evan: "$401/mo from 5,000 fans?").
  const worthMo = (w) => Math.max(w.cadence?.best6moAvg || 0, w.cadence?.monthlyAvg90 || 0)
  const atRiskMonthly = urgentList.reduce((sum, w) => sum + worthMo(w), 0)
  const dormantLifetime = dormantList.reduce((sum, w) => sum + (w.lifetime || 0), 0)
  const staleAlerts = urgentList.filter((w) => !w.lastAlert || (Date.now() - new Date(w.lastAlert)) / 86400000 > 30).length

  // Audit verdicts per fan → the CRM below shows the SAME tiers (one brain)
  const auditTiers = {}
  for (const w of watchlist) {
    if (w.creatorId !== creatorId) continue
    const k = (w.ofUsername || w.fanName || '').toLowerCase()
    if (k) auditTiers[k] = { ...(w.cadence || {}), fanId: w.fanId || null, tier: w.cadence?.tier || (w.status === 'Dormant' ? 'dead' : null) }
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

  // ── Pull + Analyze the whole Save List, one click ────────────────────────
  // Client-driven assembly line: each fan is its own pull request + analyze
  // request (no single call can time out); progress renders live. Cost gates
  // still apply per fan — pricey pulls get skipped and logged for a manual
  // decision instead of blocking the run.
  async function runBatch() {
    const pool = batchSel.size
      ? [...urgentList, ...dormantList].filter((w) => batchSel.has(w.id))
      : urgentList
    if (!selected || !pool.length) return
    batchAbort.current = false
    const log = []
    const push = (line, w = null) => { log.push({ text: line, fanKey: w ? (w.ofUsername || w.fanName || '') : null, creatorId: w?.creatorId || null }) }
    const startedAt = Date.now()
    const durations = []
    for (let i = 0; i < pool.length; i++) {
      if (batchAbort.current) { push('⏹ stopped by user'); break }
      const w = pool[i]
      const label = w.fanName || w.ofUsername || 'fan'
      const fanStart = Date.now()
      const eta = durations.length ? Math.ceil((durations.reduce((a, b) => a + b, 0) / durations.length) * (pool.length - i) / 60000) : null
      setBatch({ i: i + 1, total: pool.length, current: `${label} — pulling chat…`, log: [...log], eta, startedAt })
      try {
        // Chunked pull: ~25 pages per request, looping until the chat start or
        // his value-scaled credit cap. No timeouts, no stuck exports.
        const isDormant = w.cadence?.tier === 'dead' || w.status === 'Dormant'
        const exportWindow = (isDormant && (w.cadence?.firstPurchaseDate || w.cadence?.lastPurchaseDate)) ? {
          start: new Date(new Date(w.cadence.firstPurchaseDate || w.cadence.lastPurchaseDate).getTime() - 30 * 86400000).toISOString().slice(0, 10),
          end: new Date(new Date(w.cadence.lastPurchaseDate || Date.now()).getTime() + 60 * 86400000).toISOString().slice(0, 10),
        } : null
        const body = {
          creatorRecordId: w.creatorId || creatorId,
          fanUsername: w.ofUsername || '', fanName: w.fanName || '',
          fanId: w.fanId || w.cadence?.fanId || '',
          lifetime: w.lifetime || 0, light: true, maxPages: 25,
          ...(exportWindow ? { exportWindow } : {}),
        }
        let spent = 0, cap = null, newMsgs = 0, total = 0
        let chunkErr = null, retries = 0
        let cur = null, chunkFanId = body.fanId || '', chunkAccountId = '', lastComplete = false, capped = false
        for (let c = 0; c < 60; c++) {
          if (batchAbort.current) break
          const cres = await fetch('/api/admin/creator-earnings/pull-chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, chunked: true, fanId: chunkFanId, ...(chunkAccountId ? { accountId: chunkAccountId } : {}), ...(cur ? { cursor: cur } : {}) }),
          })
          // Timeouts/5xx are expected on big histories — finished chunks are
          // safe in shards; retry and continue.
          if (!cres.ok && cres.status >= 500 && retries < 4) { retries++; await new Promise((r) => setTimeout(r, 4000)); continue }
          const cdata = await cres.json().catch(() => ({}))
          if (!cres.ok) { chunkErr = cdata.error || cres.status; break }
          retries = 0
          spent += cdata.credits || 0
          newMsgs += cdata.fetchedCount || 0
          if (c === 0) total = (cdata.storedCount || 0) + (cdata.fetchedCount || 0)
          else total += cdata.fetchedCount || 0
          cap = cdata.capCredits ?? cap
          cur = cdata.cursor || cur
          chunkFanId = cdata.fan?.id || chunkFanId
          chunkAccountId = cdata.accountId || chunkAccountId
          lastComplete = !!cdata.historyComplete
          setBatch((b) => ({ ...b, i: i + 1, total: pool.length, current: cdata.waiting ? `${label} — building his spending-era export… ${cdata.progress ?? 0}%` : `${label} — pulling… ${total.toLocaleString()} msgs · ${spent}cr`, log: [...log] }))
          if (!cdata.morePages) break
          if (cdata.waiting) { await new Promise((r) => setTimeout(r, 6000)); continue }
          if (cap && spent >= cap) { capped = true; push(`${label}: stopped at his ${cap}cr cap — older history remains`); break }
        }
        if (chunkErr) { push(`${label}: pull failed — ${chunkErr}`); continue }
        const pres = await fetch('/api/admin/creator-earnings/pull-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorRecordId: w.creatorId || creatorId, fanUsername: w.ofUsername || '', fanName: w.fanName || '', fanId: chunkFanId || w.fanId || w.cadence?.fanId || '', finalize: true, complete: capped ? false : lastComplete }),
        })
        const pdata = await pres.json().catch(() => ({}))
        if (!pres.ok) { push(`${label}: pull failed — ${pdata.error || pres.status}`); continue }
        pdata.credits = spent
        pdata.newMessages = newMsgs
        if (!(pdata.parsed?.messageCount > 0)) { push(`${label}: no messages found in this chat — skipped`); continue }

        setBatch((b) => ({ ...b, i: i + 1, total: pool.length, current: `${label} — analyzing… (Opus takes 1-3 min on big fans)`, log: [...log] }))
        const fd = new FormData()
        // NOT useTranscript — that flag makes the analyzer hunt for an old
        // uploaded HTML transcript in Dropbox and ignore the fresh pull.
        fd.append('parsedConversation', pdata.parsed.conversation)
        fd.append('parsedMessages', JSON.stringify(pdata.parsed.messages))
        fd.append('parsedFirstDate', pdata.parsed.firstMessageDate)
        fd.append('parsedLastDate', pdata.parsed.lastMessageDate)
        fd.append('parsedFanMsgs', String(pdata.parsed.fanMessages))
        fd.append('parsedCreatorMsgs', String(pdata.parsed.creatorMessages))
        fd.append('fanName', w.fanName || w.ofUsername || '')
        fd.append('fanUsername', w.ofUsername || '')
        fd.append('lifetime', String(w.lifetime || 0))
        const cad = w.cadence || {}
        fd.append('medianGap', String(cad.medianGap || 0))
        fd.append('currentGap', String(cad.currentGap || 0))
        fd.append('rolling30', String(cad.rolling30 || 0))
        fd.append('monthlyAvg90', String(cad.monthlyAvg90 || 0))
        fd.append('lastPurchaseDate', cad.lastPurchaseDate || '')
        fd.append('creatorName', selected.name || '')
        fd.append('creatorAka', selected.aka || '')
        fd.append('creatorRecordId', creatorId)
        if (cad.live) fd.append('liveSignals', JSON.stringify(cad.live))
        const txns = earnings?.transactions
        if (Array.isArray(txns)) {
          const daily = {}
          for (const t of txns) {
            if ((w.ofUsername && t.ofUsername === w.ofUsername) || ((!t.ofUsername || !w.ofUsername) && (t.displayName || '') === (w.fanName || ''))) {
              if ((t.type || '') === 'Chargeback' || /subscription/i.test(t.type || '')) continue
              daily[t.date] = (daily[t.date] || 0) + (t.net || 0)
            }
          }
          const timeline = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => `${d}: $${v.toFixed(2)}`).join('\n')
          if (timeline) fd.append('spendingTimeline', timeline)
        }
        const ares = await fetch('/api/admin/creator-earnings/analyze-chat', { method: 'POST', body: fd })
        const adata = await ares.json().catch(() => ({}))
        if (!ares.ok) { push(`${label}: analysis failed — ${adata.error || ares.status}`); continue }
        push(`${label}: ✓ pulled (${pdata.credits || 0} cr, ${pdata.newMessages ?? 0} new) + analyzed`, w)
        durations.push(Date.now() - fanStart)
      } catch (e) {
        push(`${label}: error — ${e.message}`)
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    setBatch((b) => ({ i: b?.total || 0, total: b?.total || 0, current: '', log: [...log], done: true }))
    load()
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
        const raw = await res.text()
        let data
        try { data = JSON.parse(raw) } catch {
          throw new Error(`Backfill for ${accountName} hit a server timeout — the export keeps building at OF. Click Backfill again in a few minutes; it attaches to the same export (no double charge).`)
        }
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
        {/* Pull and Backfill write the SAME sheet tabs — running both at once
            makes each dedupe against the pre-write tab and double every row
            (Kiki got her whole history twice, 2026-07-17). Mutually exclusive. */}
        <button onClick={runPull} disabled={pulling || backfilling || !selected?.connected} style={btn('rgba(120, 180, 232, 0.12)', '#78B4E8', pulling || backfilling || !selected?.connected)}>
          {pulling ? 'Updating…' : 'Update Sales & Chargebacks'}
        </button>
        <button onClick={runBackfill} disabled={backfilling || pulling || !selected?.connected} style={btn('rgba(120, 180, 232, 0.08)', '#6B94B8', backfilling || pulling || !selected?.connected)}
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
        {(batch && !batch.done) ? (
          <button onClick={() => { batchAbort.current = true }} style={btn('rgba(232, 120, 120, 0.12)', '#E87878', false)}>
            Stop batch ({batch.i}/{batch.total})
          </button>
        ) : (
          <button onClick={runBatch} disabled={!selected?.connected || !urgentList.length}
            title="Pull each urgent fan's chat (cost-gated) and run the analysis, one by one"
            style={btn('rgba(232, 168, 120, 0.14)', '#E8A878', !selected?.connected || !urgentList.length)}>
            {batchSel.size ? `Pull + Analyze selected (${batchSel.size})` : `Pull + Analyze Save List (${urgentList.length})`}
          </button>
        )}
      </div>

      {/* Last-run stamps for the selected creator (stored on her record) */}
      {selected && (
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>Sales & chargebacks: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.sales)}</b></span>
          <span>Audit: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.audit)}</b></span>
          <span>Fan data: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.fanData)}</b></span>
          <span>Chatter QA: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.qa)}</b></span>
          <span>2y backfill: <b style={{ color: 'var(--foreground)' }}>{fmtRun(selected.runs?.backfill)}</b></span>
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

      {batch && (() => {
        const logText = (l) => typeof l === 'string' ? l : l.text
        const doneCount = batch.log.filter((l) => logText(l).includes('✓')).length
        const frac = batch.total ? Math.min(1, (batch.done ? batch.total : Math.max(0, batch.i - 1)) / batch.total) : 0
        return (
        <div style={{ ...card, padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#E8A878', marginBottom: '6px' }}>
            {batch.done ? `Batch complete — ${doneCount}/${batch.total} analyzed` : `Batch ${batch.i}/${batch.total}: ${batch.current}`}
            {!batch.done && batch.eta != null && <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> · ~{batch.eta} min left</span>}
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{ height: '100%', width: `${Math.round(frac * 100)}%`, background: batch.done ? '#7DD3A4' : '#E8A878', borderRadius: '3px', transition: 'width 0.6s ease' }} />
          </div>
          {batch.log.map((l, i) => {
            const t = logText(l)
            const ok = t.includes('✓')
            return (
              <div key={i} style={{ fontSize: '11px', color: ok ? '#7DD3A4' : t.includes('failed') || t.includes('error') ? '#E87878' : 'var(--foreground-muted)', padding: '1px 0' }}>
                {t}
                {ok && l.fanKey && (
                  <button onClick={() => { if (l.creatorId && l.creatorId !== creatorId) { setCreatorId(l.creatorId); writeCreatorToUrl(l.creatorId) } setFocusFan(l.fanKey); setFocusNonce((n) => n + 1) }}
                    style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#A06FE8', fontSize: '11px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    view analysis →
                  </button>
                )}
              </div>
            )
          })}
          {!batch.done && <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '6px' }}>Each fan finishes independently — click "view analysis →" on any ✓ line while the rest keep running. Keep this tab open.</div>}
        </div>
        )
      })()}
      {error && <div style={{ ...card, borderColor: 'rgba(232,120,120,0.35)', color: '#E87878', fontSize: '13px' }}>{error}</div>}

      {/* Audit confirmation — the audit's real output IS the Save List below */}
      {audit && (
        <div style={{ ...card, padding: '12px 18px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
          ✓ Audit done — {audit.creator} ({audit.window}): {audit.transactions} transactions scanned · {audit.triggered?.length || 0} fans flagged · +{audit.tracker?.created || 0} new on the Save List, {audit.tracker?.updated || 0} updated{audit.tracker?.cadenceRefreshed ? ` · ${audit.tracker.cadenceRefreshed} refreshed/cleaned` : ''}
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
          <input
            value={fanSearch}
            onChange={(e) => setFanSearch(e.target.value)}
            placeholder="Search fan or @username…"
            style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', width: '220px' }}
          />
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
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>
              <th style={{ padding: '4px 4px' }} title="pick fans for a selective Pull + Analyze run"><input type="checkbox" checked={urgentList.length > 0 && urgentList.every((w) => batchSel.has(w.id))} onChange={(e) => setBatchSel((s0) => { const n = new Set(s0); urgentList.forEach((w) => e.target.checked ? n.add(w.id) : n.delete(w.id)); return n })} /></th><th style={{ padding: '4px 8px' }}>Status</th><th>Fan</th>{showAllWatchlist && <th>Creator</th>}<th>Why</th><th onClick={() => clickSort('worth')} title="click to sort" style={{ textAlign: 'right', padding: '4px 10px', cursor: 'pointer', color: saveSort?.key === 'worth' ? '#C4A5F7' : undefined }}>Worth / mo{sortArrow('worth')}</th><th onClick={() => clickSort('last30')} title="click to sort" style={{ textAlign: 'right', padding: '4px 10px', cursor: 'pointer', color: saveSort?.key === 'last30' ? '#C4A5F7' : undefined }}>Last 30d{sortArrow('last30')}</th><th onClick={() => clickSort('peak')} title="click to sort" style={{ textAlign: 'right', padding: '4px 10px', cursor: 'pointer', color: saveSort?.key === 'peak' ? '#C4A5F7' : undefined }}>Peak mo{sortArrow('peak')}</th><th onClick={() => clickSort('best6')} title="click to sort" style={{ textAlign: 'right', padding: '4px 10px', cursor: 'pointer', color: saveSort?.key === 'best6' ? '#C4A5F7' : undefined }}>Best 6mo avg{sortArrow('best6')}</th><th onClick={() => clickSort('over500')} title="click to sort" style={{ textAlign: 'right', padding: '4px 10px', cursor: 'pointer', color: saveSort?.key === 'over500' ? '#C4A5F7' : undefined }}>$500+ mos{sortArrow('over500')}</th><th onClick={() => clickSort('lifetime')} title="click to sort" style={{ textAlign: 'right', padding: '4px 10px', cursor: 'pointer', color: saveSort?.key === 'lifetime' ? '#C4A5F7' : undefined }}>Lifetime{sortArrow('lifetime')}</th><th style={{ padding: '4px 10px' }}>Last buy</th><th style={{ padding: '4px 10px' }}>Analysis / alert</th><th>Signals</th><th></th>
            </tr></thead>
            <tbody>
              {urgentList.map((w) => {
                const cad = w.cadence
                const tc = (cad?.tier && TIER_COLORS[cad.tier]) || { bg: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)' }
                return (
                  <tr key={w.id} data-kbrow onClick={() => openFan(w)}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '7px 4px' }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={batchSel.has(w.id)} onChange={(e) => setBatchSel((s0) => { const n = new Set(s0); e.target.checked ? n.add(w.id) : n.delete(w.id); return n })} />
                    </td>
                    <td style={{ padding: '7px 8px' }}><span style={{ background: tc.bg, color: tc.color, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{cad?.tier || 'flagged'}</span></td>
                    <td title={`${w.fanName}${w.ofUsername ? ' @' + w.ofUsername : ''}`}
                      style={{ fontWeight: 600, maxWidth: '210px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '6px 8px 6px 0' }}>
                      {w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> @{w.ofUsername}</span> : <span title="no OF username on file — pulls fall back to name search; possibly a deleted account" style={{ color: '#E8C878', fontWeight: 400, fontSize: '10px' }}> · no @</span>}</td>
                    {showAllWatchlist && <td style={{ whiteSpace: 'nowrap' }}>{w.creator}</td>}
                    <td style={{ color: 'var(--foreground-muted)', whiteSpace: 'nowrap', padding: '6px 10px 6px 0' }}>{cad?.medianGap
                      ? <>buys every {cad.gapMin != null && cad.gapMax != null && cad.gapMax > cad.gapMin ? `${cad.gapMin}-${cad.gapMax}d (typical ~${cad.medianGap}d)` : `~${cad.medianGap}d`} — <span style={{ color: tc.color, fontWeight: 600 }}>silent {cad.currentGap}d</span></>
                      : 'flagged manually — run the audit for rhythm data'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, padding: '7px 10px', whiteSpace: 'nowrap' }} title="his proven level — avg $/mo across his best 6-month stretch">{worthMo(w) ? `$${Math.round(worthMo(w))}` : '—'}</td>
                    <td style={{ textAlign: 'right', color: (cad?.rolling30 || 0) === 0 ? '#E87878' : 'var(--foreground)', padding: '7px 10px', whiteSpace: 'nowrap' }}>{cad ? `$${Math.round(cad.rolling30)}` : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap' }} title={cad?.peakMonth ? `his biggest month: ${cad.peakMonth}` : ''}>{cad?.peakMonthSpend ? `$${Math.round(cad.peakMonthSpend)}` : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', whiteSpace: 'nowrap' }} title="avg $/mo across his hottest 6-month stretch — the consistency stat">{cad?.best6moAvg ? `$${Math.round(cad.best6moAvg)}` : '—'}</td>
                    <td style={{ textAlign: 'right', padding: '7px 10px', color: (cad?.monthsOver500 || 0) >= 3 ? '#7DD3A4' : 'var(--foreground-muted)' }} title="months where he spent $500+">{cad?.monthsOver500 ?? '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--foreground-muted)', padding: '7px 10px', whiteSpace: 'nowrap' }}>${Math.round(w.lifetime).toLocaleString()}</td>
                    <td style={{ color: 'var(--foreground-muted)', fontSize: '11px', padding: '7px 10px', whiteSpace: 'nowrap' }}>{fmtD(cad?.lastPurchaseDate)}</td>
                    <td style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{(() => {
                      const upl = w.lastChatUpload ? new Date(w.lastChatUpload) : null
                      const fresh = upl && (Date.now() - upl) < 48 * 3600000
                      const pulled = upl ? (
                        <span title={`chat scraped ${upl.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`}
                          style={fresh
                            ? { background: 'rgba(160,111,232,0.15)', color: '#A06FE8', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, marginRight: '5px' }
                            : { color: 'var(--foreground-muted)', fontSize: '10px', marginRight: '5px' }}>
                          PULLED {fmtD(w.lastChatUpload)}
                        </span>
                      ) : null
                      if (!w.lastAlert) {
                        return <>
                          {pulled}
                          {w.status === 'Analyzed'
                            ? <span title="analysis + PDF saved on his card — not sent to the team yet" style={{ background: 'rgba(232,140,92,0.15)', color: '#E88C5C', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>ANALYSIS READY</span>
                            : <span style={{ color: 'var(--foreground-muted)' }}>not analyzed</span>}
                        </>
                      }
                      const days = Math.round((Date.now() - new Date(w.lastAlert)) / 86400000)
                      const label = fmtD(w.lastAlert)
                      return <>{pulled}{days > 30
                        ? <span style={{ color: 'var(--foreground-muted)' }}>{label} <span style={{ fontSize: '9px', opacity: 0.7 }}>(stale)</span></span>
                        : <span style={{ color: '#7DD3A4' }}>{label}</span>}</>
                    })()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{(() => {
                      const lv = cad?.live
                      if (!lv) return <span style={{ color: 'var(--foreground-muted)', fontSize: '10px' }}>—</span>
                      const chip = (txt, color, bg, title) => <span key={txt} title={title} style={{ background: bg, color, padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, marginRight: '4px', whiteSpace: 'nowrap' }}>{txt}</span>
                      const out = []
                      if (lv.fanFor) out.push(chip(`FAN ${lv.fanFor.replace(/s$/, '').replace(' year', 'y').replace(' month', 'mo')}`, 'var(--foreground-muted)', 'rgba(255,255,255,0.06)', `Subscribed since ${lv.fanSince || '?'}`))
                      if (lv.rebillOff) out.push(chip(`REBILL OFF${lv.subExpires ? ` · exp ${lv.subExpires.slice(5)}` : ''}`, '#E87878', 'rgba(232,120,120,0.15)', 'Sub will not renew — save before it expires'))
                      if (lv.exposed) out.push(chip('EXPOSED TO BLASTS', '#E88C5C', 'rgba(232,140,92,0.12)', 'Not on any whale/DNM list — mass messages reach this fan'))
                      else out.push(chip('PROTECTED', '#7DD3A4', 'rgba(125,211,164,0.1)', `On: ${(lv.protectedLists || []).join(', ')}`))
                      if (lv.lastReplyAt) {
                        const rd = Math.round((Date.now() - new Date(lv.lastReplyAt)) / 86400000)
                        if (rd <= 7 && (cad.currentGap || 0) > 7) out.push(chip('TALKING, NOT BUYING', '#A06FE8', 'rgba(160,111,232,0.12)', `Last reply ${rd}d ago while ${cad.currentGap}d without a purchase — chatter should close`))
                      }
                      return out.length ? out : <span style={{ color: 'var(--foreground-muted)', fontSize: '10px' }}>ok</span>
                    })()}</td>
                    <td style={{ color: '#A06FE8', fontSize: '11px' }}>view →</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
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
              <th style={{ padding: '4px 4px' }}><input type="checkbox" checked={dormantList.length > 0 && dormantList.every((w) => batchSel.has(w.id))} onChange={(e) => setBatchSel((s0) => { const n = new Set(s0); dormantList.forEach((w) => e.target.checked ? n.add(w.id) : n.delete(w.id)); return n })} /></th><th style={{ padding: '4px 8px' }}>Fan</th>{showAllWatchlist && <th>Creator</th>}<th onClick={() => dormSortClick('lifetime')} title="click to sort" style={{ textAlign: 'right', padding: '4px 12px', cursor: 'pointer', color: dormSort?.key === 'lifetime' ? '#C4A5F7' : undefined }}>Lifetime{dormArrow('lifetime')}</th><th onClick={() => dormSortClick('lastbuy')} title="click to sort" style={{ padding: '4px 12px', cursor: 'pointer', color: dormSort?.key === 'lastbuy' ? '#C4A5F7' : undefined }}>Last buy{dormArrow('lastbuy')}</th><th onClick={() => dormSortClick('silent')} title="click to sort" style={{ padding: '4px 12px', cursor: 'pointer', color: dormSort?.key === 'silent' ? '#C4A5F7' : undefined }}>Silent{dormArrow('silent')}</th><th onClick={() => dormSortClick('alert')} title="click to sort" style={{ padding: '4px 12px', cursor: 'pointer', color: dormSort?.key === 'alert' ? '#C4A5F7' : undefined }}>Last alert{dormArrow('alert')}</th><th></th>
            </tr></thead>
            <tbody>
              {dormantList.map((w) => (
                <tr key={w.id} data-kbrow onClick={() => openFan(w)}
                  style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)', cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '7px 4px' }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={batchSel.has(w.id)} onChange={(e) => setBatchSel((s0) => { const n = new Set(s0); e.target.checked ? n.add(w.id) : n.delete(w.id); return n })} />
                  </td>
                  <td title={`${w.fanName}${w.ofUsername ? ' @' + w.ofUsername : ''}`}
                    style={{ padding: '7px 8px 7px 0', fontWeight: 600, maxWidth: '260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> @{w.ofUsername}</span> : null}
                    {w.status === 'Analyzed' && <span title="analysis saved, alert not sent yet" style={{ marginLeft: '6px', background: 'rgba(232,140,92,0.15)', color: '#E88C5C', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>ANALYSIS READY</span>}
                    {w.lastChatUpload && (Date.now() - new Date(w.lastChatUpload)) < 48 * 3600000 && <span title={`chat scraped ${new Date(w.lastChatUpload).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`} style={{ marginLeft: '6px', background: 'rgba(160,111,232,0.15)', color: '#A06FE8', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>PULLED {fmtD(w.lastChatUpload)}</span>}</td>
                  {showAllWatchlist && <td>{w.creator}</td>}
                  <td style={{ textAlign: 'right', fontWeight: 700, padding: '7px 12px', whiteSpace: 'nowrap' }}>${Math.round(w.lifetime).toLocaleString()}</td>
                  <td style={{ color: 'var(--foreground-muted)', fontSize: '11px', padding: '7px 12px', whiteSpace: 'nowrap' }}>{fmtD(w.cadence?.lastPurchaseDate)}</td>
                  <td style={{ color: 'var(--foreground-muted)', padding: '7px 12px' }}>{w.cadence?.currentGap ? `${w.cadence.currentGap}d` : '—'}</td>
                  <td style={{ color: 'var(--foreground-muted)', fontSize: '11px', padding: '7px 12px', whiteSpace: 'nowrap' }}>{w.lastAlert ? fmtD(w.lastAlert) : 'never'}</td>
                  <td style={{ color: '#A06FE8', fontSize: '11px' }}>view →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* ── SENT TO CHAT MANAGERS — save-list + dormant, alert delivered ── */}
      {sentList.length > 0 && (
        <details style={{ ...card, padding: '14px 18px' }}>
          <summary style={{ fontSize: '13px', fontWeight: 700, color: '#7DD3A4', textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer' }}>
            Sent to chat managers ({sentList.length}) — alert delivered, ball&apos;s in their court
          </summary>
          {[['From the Save List', sentList.filter((w) => !isDormant(w))], ['Dormant whales', sentList.filter(isDormant)]].map(([label, group]) => group.length > 0 && (
            <div key={label}>
              <div style={{ marginTop: '12px', fontSize: '11px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label} ({group.length})</div>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginTop: '6px' }}>
                <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>Fan</th>{showAllWatchlist && <th>Creator</th>}<th style={{ textAlign: 'right', padding: '4px 12px' }}>Lifetime</th><th style={{ padding: '4px 12px' }}>Tier</th><th style={{ padding: '4px 12px' }}>Sent</th><th></th>
                </tr></thead>
                <tbody>
                  {group.map((w) => (
                    <tr key={w.id} data-kbrow onClick={() => openFan(w)}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)', cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                      <td title={`${w.fanName}${w.ofUsername ? ' @' + w.ofUsername : ''}`}
                        style={{ padding: '7px 8px', fontWeight: 600, maxWidth: '260px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}> @{w.ofUsername}</span> : null}
                      </td>
                      {showAllWatchlist && <td>{w.creator}</td>}
                      <td style={{ textAlign: 'right', fontWeight: 700, padding: '7px 12px', whiteSpace: 'nowrap' }}>${Math.round(w.lifetime).toLocaleString()}</td>
                      <td style={{ color: 'var(--foreground-muted)', padding: '7px 12px', fontSize: '11px', textTransform: 'uppercase' }}>{w.cadence?.tier || '—'}</td>
                      <td style={{ color: '#7DD3A4', fontSize: '11px', padding: '7px 12px', whiteSpace: 'nowrap' }}>{w.lastAlert ? new Date(w.lastAlert).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                      <td style={{ color: '#A06FE8', fontSize: '11px' }}>view →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </details>
      )}


      {/* ── Win-Back Playbook — research-corpus tactics for the chatters ── */}
      {playbook && (
        <details style={{ ...card, padding: '14px 18px' }}>
          <summary style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer' }}>
            Win-Back Playbook — from the OFM research corpus
          </summary>
          <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.65, marginTop: '10px', maxWidth: '900px' }}>
            {playbook.split('\n').map((line, i) => {
              if (line.startsWith('# ')) return null // page already has a title
              if (line.startsWith('## ')) return <div key={i} style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#A06FE8', margin: '14px 0 4px' }}>{line.slice(3)}</div>
              if (line.startsWith('> ')) return <div key={i} style={{ borderLeft: '2px solid rgba(160,111,232,0.5)', paddingLeft: '10px', color: 'var(--foreground-muted)', fontStyle: 'italic', margin: '6px 0' }}>{line.slice(2).replace(/"/g, '')}</div>
              if (/^\d+\. /.test(line) || line.startsWith('- ')) return <div key={i} style={{ margin: '4px 0 4px 8px' }}>{line.replace(/\*\*/g, '')}</div>
              if (line.startsWith('_') || !line.trim()) return null
              return <div key={i} style={{ margin: '4px 0' }}>{line.replace(/\*\*/g, '')}</div>
            })}
          </div>
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
