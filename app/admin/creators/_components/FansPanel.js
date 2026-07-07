'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { isRealPurchase, parseChatHtmlClient } from '../_lib/parsers'

// ── Fans CRM Panel ──────────────────────────────────────────────────────────

// Client-side mirror of getAccountKey() in /api/admin/creator-earnings/analyze-chat/route.js.
// Kept in sync manually since it's a tiny pure function — both sides must normalize the same way
// or the per-account transcript files on Dropbox will collide.
function getClientAccountKey(accountName) {
  if (!accountName) return null
  if (/free/i.test(accountName)) return 'free'
  if (/vip/i.test(accountName)) return 'vip'
  const slug = accountName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
  return slug || null
}

// House date style: "Jan 1, 25" (3-letter month, day, 2-digit year).
// Month-only values ("2026-04") render as "Apr'26" (chart style).
function fmtD(v) {
  if (!v) return '—'
  const str = String(v)
  if (/^\d{4}-\d{2}$/.test(str)) {
    const d = new Date(str + '-15T12:00:00')
    return isNaN(d) ? str : d.toLocaleDateString('en-US', { month: 'short' }) + "'" + str.slice(2, 4)
  }
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(str) ? str + 'T12:00:00' : str)
  if (isNaN(d)) return str
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export function FanRow({ f, i, isExpanded, onToggle, alertStatusColors, effectColors, fmtDate, fmtMoney, setFans, creatorName, creatorAka, creatorRecordId, allTxns, availableAccounts, inModal, readOnly = false }) {
  const [chatFile, setChatFile] = useState(null)
  // Chat pulled live from OF via onlyfansapi.com — same parsed shape as the
  // client-side HTML parse; feeds the identical analyze flow.
  const [ofPull, setOfPull] = useState(null)
  const [pullingOf, setPullingOf] = useState(false)
  const [pullProgress, setPullProgress] = useState(null) // { spent, total, oldest } while a chunked pull runs
  const [archiveMeta, setArchiveMeta] = useState(null) // when we last pulled from OF (durable, from Dropbox)
  const [bigPull, setBigPull] = useState(null) // {credits, messages} — cost gate awaiting a decision
  // uploadAccountName is set when a multi-account fan's user picks which account this upload is for.
  // null for single-account fans (whose uploads don't need an account tag).
  const [uploadAccountName, setUploadAccountName] = useState(null)
  // Multi-account fans: tracks per-account save state. { 'Sunny - Free OF': 'saving' | 'saved' | 'error', ... }
  // Each account uploads to Dropbox independently on pick; final Analyze loads combined transcripts.
  const [accountUploadState, setAccountUploadState] = useState({})
  // Inline edit for manual lifetime override (used in PDF/Telegram only).
  const [editingLifetime, setEditingLifetime] = useState(false)
  const [lifetimeDraft, setLifetimeDraft] = useState('')
  const [savingLifetime, setSavingLifetime] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [showBrief, setShowBrief] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [showSendModal, setShowSendModal] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedAnalysisIdx, setSelectedAnalysisIdx] = useState(0)
  const [chartMode, setChartMode] = useState('monthly') // 'daily' | 'monthly'
  const [showAllHistory, setShowAllHistory] = useState(true) // full history by default (per Evan)
  const [splitByAccount, setSplitByAccount] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [savingTranscript, setSavingTranscript] = useState(false)
  const [transcriptSaved, setTranscriptSaved] = useState(false)
  const [viewingAnalysisIdx, setViewingAnalysisIdx] = useState(null) // index into analysisRecords for full modal
  const chatFileRef = useRef(null)
  const saveFileRef = useRef(null)

  const heat = HEAT_CONFIG[f.heatStatus] || HEAT_CONFIG['Stable']
  // For "Alert Triggered", color-tint by urgency (critical/high/warning) so
  // critical pops in the list. Fallback to default red if no urgency attached.
  const urgency = f.goingCold?.urgency
  const ac = (f.alertStatus === 'Alert Triggered' && urgency && URGENCY_COLORS[urgency])
    ? URGENCY_COLORS[urgency]
    : (ALERT_STATUS_COLORS[f.alertStatus] || ALERT_STATUS_COLORS['None'])
  const ec = effectColors[f.effectiveness] || effectColors['Pending']

  // Analysis is now shown via cards (analysisRecords) — full text loads on demand via "View Full" modal or new analysis run

  // Build daily + monthly spend data for this fan from allTxns
  const { fanSpendData, monthlySpendData, perAccountMonthly, perAccountDaily, accountNames } = useMemo(() => {
    if (!allTxns || !Array.isArray(allTxns)) return { fanSpendData: null, monthlySpendData: null, perAccountMonthly: {}, perAccountDaily: {}, accountNames: [] }
    const dailySpend = {}
    const dailyByAccount = {} // { account: { date: spend } }
    for (const t of allTxns) {
      const match = (f.ofUsername && t.ofUsername === f.ofUsername) ||
        (!f.ofUsername && (t.displayName || '').toLowerCase() === (f.fanName || '').toLowerCase())
      if (!match || !isRealPurchase(t)) continue // skip subs + chargebacks
      const d = t.date
      if (!d) continue
      dailySpend[d] = (dailySpend[d] || 0) + (t.net || 0)
      const acct = t.account || 'Unknown'
      if (!dailyByAccount[acct]) dailyByAccount[acct] = {}
      dailyByAccount[acct][d] = (dailyByAccount[acct][d] || 0) + (t.net || 0)
    }
    const entries = Object.entries(dailySpend).sort(([a], [b]) => a.localeCompare(b))
    if (entries.length < 1) return { fanSpendData: null, monthlySpendData: null, perAccountMonthly: {}, perAccountDaily: {}, accountNames: [] }

    // Fill gaps with zero-spend days — extend to today so the gap is visible
    const filled = []
    const startDate = new Date(entries[0][0] + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const endDate = today > new Date(entries[entries.length - 1][0] + 'T00:00:00') ? today : new Date(entries[entries.length - 1][0] + 'T00:00:00')
    const spendMap = Object.fromEntries(entries)
    const lastSpendDate = entries[entries.length - 1][0]
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0]
      filled.push({ date: key, spend: spendMap[key] || 0, afterLastSpend: key > lastSpendDate })
    }

    // Build monthly totals — include all months from first to current
    const months = {}
    for (const d of filled) {
      const mo = d.date.slice(0, 7)
      months[mo] = (months[mo] || 0) + d.spend
    }
    // Fill in missing months between first and now
    const firstMo = filled[0].date.slice(0, 7)
    const now = new Date()
    const lastMo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const allMonths = []
    let cur = firstMo
    while (cur <= lastMo) {
      allMonths.push({ month: cur, spend: months[cur] || 0 })
      const [y, m] = cur.split('-').map(Number)
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
      cur = next
    }

    // Per-account breakdowns (only useful when fan is on 2+ accounts)
    const acctNames = Object.keys(dailyByAccount).sort()
    const perMonthly = {}
    const perDaily = {}
    for (const acct of acctNames) {
      const acctDaily = dailyByAccount[acct]
      perDaily[acct] = filled.map(d => ({ date: d.date, spend: acctDaily[d.date] || 0, afterLastSpend: d.afterLastSpend }))
      perMonthly[acct] = allMonths.map(m => {
        let sum = 0
        for (const [dt, v] of Object.entries(acctDaily)) {
          if (dt.startsWith(m.month)) sum += v
        }
        return { month: m.month, spend: sum }
      })
    }

    return { fanSpendData: filled, monthlySpendData: allMonths, perAccountMonthly: perMonthly, perAccountDaily: perDaily, accountNames: acctNames }
  }, [allTxns, f.ofUsername, f.fanName])

  // Durable "last pulled from OF" — read from the fan's Dropbox archive so it
  // survives sessions/devices (button state doesn't).
  useEffect(() => {
    if (!isExpanded || !creatorRecordId || (!f.ofUsername && !f.fanName)) return
    fetch(`/api/admin/creator-earnings/pull-chat?creatorRecordId=${encodeURIComponent(creatorRecordId)}&fanUsername=${encodeURIComponent(f.ofUsername || '')}&fanName=${encodeURIComponent(f.fanName || '')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setArchiveMeta(d?.archive || null)
        // PRE-LOAD: when a saved chat exists, load it into the modal
        // automatically (0 credits) so Analyze is one click away — no hunting
        // for a Load button (Evan, 2026-07-07).
        if (d?.archive?.totalStored > 0) handleLoadArchive()
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, f.id])

  async function handleLoadArchive() {
    setPullingOf(true); setAnalysisError(null)
    try {
      const res = await fetch('/api/admin/creator-earnings/pull-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorRecordId || '', fanUsername: f.ofUsername || '', fanName: f.fanName || '', fromArchive: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Load failed')
      setOfPull({ ...data.parsed, newMessages: 0, credits: 0 })
      setChatFile(null)
    } catch (e) { setAnalysisError(e.message) } finally { setPullingOf(false) }
  }

  // Milestone dates from alert history and analyses
  const milestones = useMemo(() => {
    const m = []
    if (f.alertHistory) {
      for (const h of f.alertHistory) {
        if (h.date) m.push({ date: h.date.split('T')[0], label: 'Sent to Manager', color: '#E87878' })
      }
    }
    if (f.analysisRecords) {
      for (const a of f.analysisRecords) {
        if (a.date) m.push({ date: a.date.split('T')[0], label: 'Analyzed', color: '#A78BFA' })
      }
    }
    return m
  }, [f.alertHistory, f.analysisRecords])

  async function buildFormData(fromTranscript = false, parsedOverride = null) {
    const formData = new FormData()
    const pulled = parsedOverride || ofPull
    if (fromTranscript) {
      formData.append('useTranscript', 'true')
    } else if (pulled && !chatFile) {
      // Chat pulled live from the OF API — already in parsed shape.
      formData.append('parsedConversation', pulled.conversation)
      formData.append('parsedMessages', JSON.stringify(pulled.messages))
      formData.append('parsedFirstDate', pulled.firstMessageDate)
      formData.append('parsedLastDate', pulled.lastMessageDate)
      formData.append('parsedFanMsgs', String(pulled.fanMessages))
      formData.append('parsedCreatorMsgs', String(pulled.creatorMessages))
    } else {
      // Parse chat HTML client-side — sends only the extracted transcript text
      // instead of the full HTML (which can be 20-100MB and blow past Vercel's
      // 4.5MB body limit). Parsed transcripts are typically 2-5% of HTML size.
      const isHtml = /\.html?$/i.test(chatFile.name) || (chatFile.type || '').includes('html')
      if (isHtml) {
        const html = await chatFile.text()
        const parsed = parseChatHtmlClient(html)
        if (parsed.messageCount === 0) {
          throw new Error('No messages found in the uploaded HTML.')
        }
        formData.append('parsedConversation', parsed.conversation)
        formData.append('parsedMessages', JSON.stringify(parsed.messages))
        formData.append('parsedFirstDate', parsed.firstMessageDate)
        formData.append('parsedLastDate', parsed.lastMessageDate)
        formData.append('parsedFanMsgs', String(parsed.fanMessages))
        formData.append('parsedCreatorMsgs', String(parsed.creatorMessages))
      } else {
        // Non-HTML file — send as-is (server will reject if not supported)
        formData.append('file', chatFile)
      }
    }
    formData.append('fanName', f.fanName)
    formData.append('fanUsername', f.ofUsername || '')
    formData.append('lifetime', f.lifetimeSpend || 0)
    if (f.liveSignals) formData.append('liveSignals', JSON.stringify(f.liveSignals))
    if (f.goingCold) {
      formData.append('medianGap', f.goingCold.medianGap || 0)
      formData.append('currentGap', f.goingCold.currentGap || 0)
      formData.append('rolling30', f.goingCold.rolling30 || 0)
      formData.append('monthlyAvg90', f.goingCold.monthlyAvg90 || 0)
      formData.append('lastPurchaseDate', f.goingCold.lastPurchaseDate || '')
    } else if (allTxns) {
      // Compute spending metrics from transaction data when no going-cold alert exists
      // Exclude subscription renewals + chargebacks — only real purchases count
      const fanTxns = allTxns.filter(t => (t.ofUsername || '') === f.ofUsername || (t.displayName || '') === f.fanName)
        .filter(t => t.date && isRealPurchase(t))
        .sort((a, b) => a.date.localeCompare(b.date))
      if (fanTxns.length > 0) {
        const now = new Date()
        const thirtyAgo = new Date(now - 30 * 86400000)
        const ninetyAgo = new Date(now - 90 * 86400000)
        const r30 = fanTxns.filter(t => new Date(t.date) >= thirtyAgo).reduce((s, t) => s + (t.net || 0), 0)
        const r90 = fanTxns.filter(t => new Date(t.date) >= ninetyAgo).reduce((s, t) => s + (t.net || 0), 0)
        const lastTxn = fanTxns[fanTxns.length - 1]
        const gap = Math.floor((now - new Date(lastTxn.date)) / 86400000)
        // Compute median purchase gap
        const gaps = []
        for (let i = 1; i < fanTxns.length; i++) {
          const d = Math.floor((new Date(fanTxns[i].date) - new Date(fanTxns[i-1].date)) / 86400000)
          if (d > 0) gaps.push(d)
        }
        gaps.sort((a, b) => a - b)
        const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0
        const lifetime = fanTxns.reduce((s, t) => s + (t.net || 0), 0)
        formData.set('lifetime', lifetime) // overwrite any earlier lifetime that included subs
        formData.append('medianGap', median)
        formData.append('currentGap', gap)
        formData.append('rolling30', r30)
        formData.append('monthlyAvg90', Math.round(r90 / 3))
        formData.append('lastPurchaseDate', lastTxn.date)
      }
    }
    formData.append('creatorName', creatorName || '')
    formData.append('creatorAka', creatorAka || creatorName || '')
    formData.append('creatorRecordId', creatorRecordId || '')
    // Tag the upload with which account it came from (multi-account fans only).
    // Server uses this to route to transcript-free.txt vs transcript-vip.txt on Dropbox.
    if (uploadAccountName) formData.append('accountName', uploadAccountName)
    // Compute daily spend timeline for analysis context — real purchases only
    if (allTxns) {
      const dailySpend = {}
      for (const t of allTxns) {
        if (!isRealPurchase(t)) continue
        if ((t.displayName || '') === f.fanName || (t.ofUsername || '') === f.ofUsername) {
          dailySpend[t.date] = (dailySpend[t.date] || 0) + (t.net || 0)
        }
      }
      const timeline = Object.entries(dailySpend)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, spend]) => `${date}: $${spend.toFixed(2)}`)
        .join('\n')
      if (timeline) formData.append('spendingTimeline', timeline)
    }
    return formData
  }

  // Pull this fan's chat straight from OF, in CHUNKS: each request does ~25
  // pages, reports progress, and the loop continues until the chat start or
  // his value-scaled credit cap. When the pull lands, analysis starts
  // automatically — no dead "no messages" ends, no timeouts.
  async function handlePullFromOf(opts = {}) {
    setPullingOf(true)
    setAnalysisError(null)
    setOfPull(null)
    setBigPull(null)
    try {
      let spent = 0, cap = null, newMsgs = 0, capped = false
      let cur = null, chunkFanId = f.fanId || '', total = 0, lastComplete = false
      // DORMANT fans: aim the pull at his SPENDING era (skip months of
      // unanswered mass blasts) via a targeted, mass-free export window.
      const isDormantFan = f.heatStatus === 'Dead' && (f.firstDate || f.heatDetail?.lastPurchase)
      const exportWindow = isDormantFan ? {
        start: new Date(new Date(f.firstDate || f.heatDetail?.lastPurchase).getTime() - 30 * 86400000).toISOString().slice(0, 10),
        end: new Date(new Date(f.heatDetail?.lastPurchase || f.lastDate || Date.now()).getTime() + 60 * 86400000).toISOString().slice(0, 10),
      } : null
      const baseBody = {
        creatorRecordId: creatorRecordId || '',
        fanUsername: f.ofUsername || '',
        fanName: f.fanName || '',
        lifetime: f.lifetimeSpend || 0,
        ...(exportWindow ? { exportWindow } : {}),
      }
      let retries = 0
      for (let i = 0; i < 60; i++) {
        const res = await fetch('/api/admin/creator-earnings/pull-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...baseBody, chunked: true, maxPages: 25,
            fanId: chunkFanId,
            ...(cur ? { cursor: cur } : {}),
            ...(opts.acceptPartial ? { acceptPartial: true } : {}),
          }),
        })
        // Timeouts/5xx are EXPECTED for big histories — every finished chunk is
        // already safe in its shard, so just retry and keep rolling.
        if (!res.ok && res.status >= 500 && retries < 4) { retries++; await new Promise((r) => setTimeout(r, 4000)); continue }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Pull failed')
        retries = 0
        spent += data.credits || 0
        newMsgs += data.fetchedCount || 0
        if (i === 0) total = (data.storedCount || 0) + (data.fetchedCount || 0)
        else total += data.fetchedCount || 0
        cap = data.capCredits ?? cap
        cur = data.cursor || cur
        chunkFanId = data.fan?.id || chunkFanId
        lastComplete = !!data.historyComplete
        setPullProgress({ spent, total, oldest: data.oldestAt, waiting: data.waiting ? (data.progress ?? 0) : null, rowsFound: data.rowsFound ?? null })
        if (!data.morePages) break
        if (data.waiting) { await new Promise((r) => setTimeout(r, 6000)); continue }
        if (cap && spent >= cap && !opts.confirmBig) { capped = true; break }
      }
      // Final: load the parsed archive (0 credits) and auto-run the analysis.
      const fin = await fetch('/api/admin/creator-earnings/pull-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorRecordId || '', fanUsername: f.ofUsername || '', fanName: f.fanName || '', fanId: chunkFanId || f.fanId || '', finalize: true, complete: capped ? false : lastComplete }),
      })
      const fdata = await fin.json()
      if (!fin.ok) throw new Error(fdata.error || 'Pull finished but the archive would not load')
      const pulledParsed = { ...fdata.parsed, newMessages: newMsgs, credits: spent, historyComplete: fdata.historyComplete, coverage: fdata.coverage, capped }
      setOfPull(pulledParsed)
      setChatFile(null) // OF pull replaces any picked file
      setArchiveMeta((m) => ({ ...(m || {}), historyComplete: !!fdata.historyComplete, totalStored: fdata.totalStored, firstMessageAt: fdata.coverage?.oldestMessageAt || null, lastMessageAt: fdata.coverage?.newestMessageAt || null, pulledAt: fdata.pulledAt || null }))
      setPullProgress(null)
      if (fdata.parsed?.messageCount > 0 && !opts.noAutoAnalyze) {
        await handleAnalyze(false, pulledParsed)
      }
    } catch (e) {
      setAnalysisError(e.message)
      setPullProgress(null)
    } finally {
      setPullingOf(false)
    }
  }

  async function handleAnalyze(fromTranscript, parsedOverride = null) {
    fromTranscript = fromTranscript === true // guard against React event objects
    if (!fromTranscript && !chatFile && !ofPull && !parsedOverride) return
    setAnalyzing(true)
    setAnalysisError(null)
    try {
      const fd = await (fromTranscript ? buildFormData(true) : buildFormData(false, parsedOverride))
      const res = await fetch('/api/admin/creator-earnings/analyze-chat', { method: 'POST', body: fd })
      const raw = await res.text()
      let data
      try { data = JSON.parse(raw) } catch {
        if (res.status === 413 || /too large|request en/i.test(raw)) {
          throw new Error('Chat HTML too large even after stripping. Try exporting a shorter date range from OF.')
        }
        throw new Error(`Analysis failed (${res.status}): ${raw.slice(0, 120)}`)
      }
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setAnalysis(data)
      // Refresh fans list to show new analysis
      const refreshRes = await fetch(`/api/admin/fan-tracker?creatorFull=${encodeURIComponent(creatorName || '')}`)
      const refreshData = await refreshRes.json()
      if (refreshData.fans) setFans(refreshData.fans)
    } catch (e) {
      setAnalysisError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // Multi-account flow: user picks a file for a specific account → save that account's
  // transcript to Dropbox immediately (parsed client-side first to stay under 4.5MB body limit).
  // Once all desired accounts are uploaded, a single Analyze Conversation button loads the
  // combined transcripts from Dropbox and runs the AI analysis.
  async function handleAccountUpload(accountName, file) {
    setAccountUploadState(s => ({ ...s, [accountName]: 'saving' }))
    setAnalysisError(null)
    try {
      const isHtml = /\.html?$/i.test(file.name) || (file.type || '').includes('html')
      const fd = new FormData()
      fd.append('saveTranscriptOnly', 'true')
      fd.append('fanName', f.fanName)
      fd.append('fanUsername', f.ofUsername || '')
      fd.append('creatorName', creatorName || '')
      fd.append('creatorRecordId', creatorRecordId || '')
      fd.append('accountName', accountName)
      if (isHtml) {
        // Parse client-side so we don't send the full 20-100MB HTML
        const html = await file.text()
        const parsed = parseChatHtmlClient(html)
        if (parsed.messageCount === 0) throw new Error('No messages found in HTML')
        fd.append('parsedConversation', parsed.conversation)
        fd.append('parsedMessages', JSON.stringify(parsed.messages))
        fd.append('parsedFirstDate', parsed.firstMessageDate)
        fd.append('parsedLastDate', parsed.lastMessageDate)
        fd.append('parsedFanMsgs', String(parsed.fanMessages))
        fd.append('parsedCreatorMsgs', String(parsed.creatorMessages))
      } else {
        fd.append('file', file)
      }
      const res = await fetch('/api/admin/creator-earnings/analyze-chat', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setAccountUploadState(s => ({ ...s, [accountName]: 'saved' }))
    } catch (e) {
      setAccountUploadState(s => ({ ...s, [accountName]: 'error' }))
      setAnalysisError(`${accountName} upload failed: ${e.message}`)
    }
  }

  async function handleSaveTranscript(file) {
    setSavingTranscript(true)
    setAnalysisError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('saveTranscriptOnly', 'true')
      fd.append('fanName', f.fanName)
      fd.append('fanUsername', f.ofUsername || '')
      fd.append('creatorName', creatorName || '')
      fd.append('creatorRecordId', creatorRecordId || '')
      if (uploadAccountName) fd.append('accountName', uploadAccountName)
      const res = await fetch('/api/admin/creator-earnings/analyze-chat', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setTranscriptSaved(true)
      setTimeout(() => setTranscriptSaved(false), 3000)
    } catch (e) {
      setAnalysisError(e.message)
    } finally {
      setSavingTranscript(false)
    }
  }

  function buildAlertPayload() {
    // If a manual override is set (real OF lifetime, not just what earnings data can see),
    // use it for the PDF + Telegram stats. Computed lifetime stays the default.
    const effectiveLifetime = (f.lifetimeOverride !== null && f.lifetimeOverride !== undefined && f.lifetimeOverride > 0)
      ? f.lifetimeOverride
      : f.lifetimeSpend
    const alertData = f.goingCold ? { ...f.goingCold, lifetime: effectiveLifetime } : {
      fan: f.fanName,
      username: f.ofUsername,
      lifetime: effectiveLifetime,
      rolling30: f.last30,
      urgency: 'warning',
      medianGap: 0,
      currentGap: 0,
      gapRatio: 0,
    }
    // Compute monthly spending history from transaction data for the PDF chart.
    // Track both total AND per-account so the chart can show stacked bars for
    // multi-account creators (e.g. Sunny's Free OF vs VIP OF).
    const monthlyMap = {}       // { 'YYYY-MM': totalSpend }
    const monthlyByAccount = {} // { 'YYYY-MM': { [accountName]: spend } }
    const accountsSeen = new Set()
    if (allTxns) {
      for (const t of allTxns) {
        const match = (f.ofUsername && t.ofUsername === f.ofUsername) ||
          (!f.ofUsername && (t.displayName || '').toLowerCase() === (f.fanName || '').toLowerCase())
        if (!match || !isRealPurchase(t)) continue
        if (t.net > 0) {
          const mo = (t.date || '').slice(0, 7)
          if (!mo) continue
          monthlyMap[mo] = (monthlyMap[mo] || 0) + t.net
          const acct = t.account || 'Unknown'
          accountsSeen.add(acct)
          if (!monthlyByAccount[mo]) monthlyByAccount[mo] = {}
          monthlyByAccount[mo][acct] = (monthlyByAccount[mo][acct] || 0) + t.net
        }
      }
    }
    const sortedMonths = Object.keys(monthlyMap).sort()
    const accountNames = [...accountsSeen].sort()
    // Fill gap months with zero so the cool-off is visible.
    // Window: from first-purchase-month → current month (so a dead fan shows
    // every empty month after their peak). Cap at last 12 months if history is longer.
    let monthlyHistory = []
    if (sortedMonths.length > 0) {
      const now = new Date()
      const curMo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const firstMo = sortedMonths[0]
      const filled = []
      let cur = firstMo
      while (cur <= curMo) {
        const spend = Math.round(monthlyMap[cur] || 0)
        const byAcct = {}
        if (monthlyByAccount[cur]) {
          for (const [acct, v] of Object.entries(monthlyByAccount[cur])) byAcct[acct] = Math.round(v)
        }
        filled.push({ month: cur, spend, byAccount: byAcct })
        const [y, m] = cur.split('-').map(Number)
        cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
      }
      // Cap at 12 most recent months so the chart stays readable
      monthlyHistory = filled.length > 12 ? filled.slice(-12) : filled
    }

    // Compute peak 90-day monthly avg (best 3-month rolling window) with date range
    let peakMonthlyAvg = 0
    let peakStartMonth = null, peakEndMonth = null
    if (monthlyHistory.length >= 3) {
      for (let i = 0; i <= monthlyHistory.length - 3; i++) {
        const windowAvg = (monthlyHistory[i].spend + monthlyHistory[i + 1].spend + monthlyHistory[i + 2].spend) / 3
        if (windowAvg > peakMonthlyAvg) {
          peakMonthlyAvg = windowAvg
          peakStartMonth = monthlyHistory[i].month
          peakEndMonth = monthlyHistory[i + 2].month
        }
      }
    } else if (monthlyHistory.length > 0) {
      peakMonthlyAvg = monthlyHistory.reduce((s, m) => s + m.spend, 0) / monthlyHistory.length
      peakStartMonth = monthlyHistory[0].month
      peakEndMonth = monthlyHistory[monthlyHistory.length - 1].month
    }
    peakMonthlyAvg = Math.round(peakMonthlyAvg)
    // Format peak range: "Nov '25 – Jan '26"
    const fmtPeakMonth = (mo) => {
      if (!mo) return ''
      const moNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const [y, m] = mo.split('-')
      return `${moNames[parseInt(m) - 1]} '${y.slice(2)}`
    }
    const peakRange = peakStartMonth ? `${fmtPeakMonth(peakStartMonth)} – ${fmtPeakMonth(peakEndMonth)}` : ''

    // Include chat window dates from the selected analysis record
    const selRec = f.analysisRecords?.[selectedAnalysisIdx]

    return {
      creatorName, // full legal name — used for Dropbox folder path consistency
      creatorAka,  // stage name — used for Telegram topic routing
      creatorRecordId,
      alert: {
        ...alertData, fan: f.fanName, username: f.ofUsername,
        monthlyHistory, accountNames, peakMonthlyAvg, peakRange,
        // Full list of creator's accounts — PDF uses this to decide whether
        // to render per-account labels. Single-account creators skip labels.
        creatorAccounts: availableAccounts || [],
      },
      analysis: analysis
        ? { analysis: analysis.analysis, managerBrief: analysis.managerBrief }
        : selRec
          ? { analysis: selRec.fullAnalysis || selRec.brief || '', managerBrief: selRec.brief || '' }
          : null,
      chatWindow: {
        firstMessageDate: analysis?.firstMessageDate || selRec?.firstMessageDate || null,
        lastMessageDate: analysis?.lastMessageDate || selRec?.lastMessageDate || null,
      },
    }
  }

  async function handlePreviewPdf() {
    setPreviewLoading(true)
    setPreviewImage(null)
    setSendResult(null)
    setShowSendModal(true)
    try {
      const payload = buildAlertPayload()
      const res = await fetch('/api/admin/whale-alert/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = 'Preview failed'
        try { msg = JSON.parse(text).error || msg } catch { msg = res.status === 504 ? 'PDF generation timed out — try again (cold start)' : msg }
        throw new Error(msg)
      }
      const data = await res.json()
      setPreviewImage(data.image)
    } catch (e) {
      setSendResult({ error: 'Preview failed: ' + e.message })
    } finally {
      setPreviewLoading(false)
    }
  }

  // Save the manual lifetime override via fan-tracker API. Upserts by fan identity if
  // no tracker record exists yet. Pass an empty string to clear the override.
  async function saveLifetimeOverride(valueStr) {
    setSavingLifetime(true)
    try {
      const override = valueStr.trim() === '' ? null : Number(valueStr.replace(/[^\d.-]/g, ''))
      const res = await fetch('/api/admin/fan-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_lifetime_override',
          recordId: f.crmId || null,
          fanName: f.fanName,
          fanUsername: f.ofUsername,
          creatorRecordId,
          override,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      // Refresh CRM data so the override shows up
      const refreshRes = await fetch(`/api/admin/fan-tracker?creatorFull=${encodeURIComponent(creatorName || '')}`, { cache: 'no-store' })
      const refreshData = await refreshRes.json()
      if (refreshData.fans) setFans(refreshData.fans)
      setEditingLifetime(false)
    } catch (e) {
      alert(`Lifetime override save failed: ${e.message}`)
    } finally {
      setSavingLifetime(false)
    }
  }

  async function handleSendToTelegram() {
    setSending(true)
    setSendResult(null)
    try {
      const payload = buildAlertPayload()
      const res = await fetch('/api/admin/whale-alert/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const raw = await res.text()
      let data
      try { data = JSON.parse(raw) } catch {
        // Plain-text platform error (e.g. gateway timeout) — the Telegram
        // message may still have gone out; check the group before resending.
        throw new Error(`Send hit a server timeout (${res.status}). Check the Telegram group — the card may have posted anyway — before resending.`)
      }
      if (!res.ok) throw new Error(data.error || 'Send failed')
      // Telegram went through. trackerError is non-null when the Fan Tracker Airtable write
      // failed — surface that explicitly so the user knows the alert column won't update.
      if (data.trackerError) {
        setSendResult({ success: true, trackerError: data.trackerError })
      } else {
        setSendResult({ success: true })
      }
      // Refresh fan data so "Not Sent" badge updates to "Sent to Manager".
      // cache: 'no-store' prevents any Next.js/browser caching from returning stale status.
      // Small delay lets Airtable indexes settle after the PATCH so the GET sees the new status.
      await new Promise(r => setTimeout(r, 600))
      try {
        const refreshRes = await fetch(`/api/admin/fan-tracker?creatorFull=${encodeURIComponent(creatorName || '')}`, { cache: 'no-store' })
        const refreshData = await refreshRes.json()
        if (refreshData.fans) setFans(refreshData.fans)
      } catch {}
      // Auto-close modal on clean success; keep it open if there's a tracker error to read
      if (!data.trackerError) {
        setTimeout(() => {
          setShowSendModal(false)
          setSendResult(null)
        }, 1500)
      }
    } catch (e) {
      setSendResult({ error: e.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div id={`fanrow-${f.id}`} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
      {!inModal && <div
        data-kbrow
        onClick={onToggle}
        style={{
          display: 'grid', gridTemplateColumns: '24px 1fr 32px 100px 90px 80px 80px 80px 90px',
          padding: '8px 16px', fontSize: '12px', cursor: 'pointer',
          background: isExpanded ? 'rgba(232, 200, 120, 0.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
        }}
      >
        <span style={{ color: 'var(--foreground-subtle)', fontSize: '10px', lineHeight: '20px' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
        <div>
          <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>{f.fanName}</span>
          {f.ofUsername
            ? <span style={{ color: 'var(--palm-pink)', fontSize: '11px', marginLeft: '6px' }}>@{f.ofUsername}</span>
            : <span style={{ fontSize: '9px', color: 'var(--foreground-muted)', marginLeft: '6px', background: 'rgba(255,255,255,0.04)', padding: '1px 4px', borderRadius: '3px' }} title="No username — account likely deleted/deactivated">deleted?</span>
          }
          {availableAccounts && availableAccounts.length > 1 && f.accounts && f.accounts.length > 0 && (
            f.accounts.map(acct => {
              const isFree = /free/i.test(acct)
              return (
                <span key={acct} style={{
                  fontSize: '8px', fontWeight: 600, marginLeft: '4px', padding: '1px 5px', borderRadius: '3px',
                  background: isFree ? 'rgba(59,130,246,0.12)' : 'rgba(167, 139, 250, 0.1)', color: isFree ? '#78B4E8' : '#A78BFA',
                }}>{acct}</span>
              )
            })
          )}
          {f.alertCount > 0 && <span style={{ fontSize: '9px', color: 'var(--foreground-muted)', marginLeft: '6px' }}>{f.alertCount} alert{f.alertCount !== 1 ? 's' : ''}</span>}
        </div>
        <span title={heat.label} style={{ fontSize: '14px', lineHeight: '20px', textAlign: 'center' }}>{heat.emoji}</span>
        <span>{(f.heatStatus === 'Going Cold' && urgency) ? (
          <span style={{ background: (URGENCY_COLORS[urgency] || {}).bg, color: (URGENCY_COLORS[urgency] || {}).text, padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
            {urgency}
          </span>
        ) : f.alertStatus !== 'None' && (
          <span style={{ background: ac.bg, color: ac.text, padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 600 }}>
            {f.alertStatus}
          </span>
        )}</span>
        <span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--foreground)' }}>{fmtMoney(f.lifetimeSpend)}</span>
        <span style={{ textAlign: 'right', color: 'rgba(240, 236, 232, 0.75)' }} title="Average spend per month over the last 6 months — the consistent-whale stat">{fmtMoney((f.last180 || 0) / 6)}</span>
        <span style={{ textAlign: 'right', color: f.last30 === 0 ? '#E87878' : 'rgba(240, 236, 232, 0.75)', fontWeight: f.last30 === 0 && f.lifetimeSpend > 100 ? 600 : 400 }}>{fmtMoney(f.last30)}</span>
        <span style={{ textAlign: 'right', color: 'rgba(240, 236, 232, 0.75)' }}>{f.txnCount || 0}</span>
        <span style={{ textAlign: 'right', color: 'var(--foreground-muted)', fontSize: '11px' }}>{f.lastDate || '—'}</span>
      </div>}

      {isExpanded && (
        <div style={{ padding: '14px 16px 18px 40px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>

          {/* ═══ SECTION 1: Fan Info Header ═══ */}
          <div style={{ marginBottom: '16px' }}>
            {/* Heat status banner — for cooling/cold/dead fans */}
            {f.heatDetail && (
              <div style={{
                marginBottom: '10px', padding: '8px 12px', borderRadius: '6px', fontSize: '11px',
                display: 'flex', gap: '6px', alignItems: 'flex-start', flexDirection: 'column',
                background: f.heatStatus === 'Dead' ? 'rgba(255,255,255,0.04)' : f.heatStatus === 'Going Cold' ? 'rgba(232, 120, 120, 0.08)' : 'rgba(232, 168, 120, 0.08)',
                border: `1px solid ${f.heatStatus === 'Dead' ? 'rgba(255,255,255,0.1)' : f.heatStatus === 'Going Cold' ? 'rgba(232, 120, 120, 0.2)' : 'rgba(232, 168, 120, 0.15)'}`,
                color: f.heatStatus === 'Dead' ? 'var(--foreground-muted)' : f.heatStatus === 'Going Cold' ? '#E87878' : '#E8A878',
              }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '15px' }}>{(HEAT_CONFIG[f.heatStatus] || {}).emoji}</span>
                  <strong style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{f.heatStatus}</strong>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>{f.heatDetail.reason}</span>
                </div>
                {f.heatDetail.peakMonth && (
                  <div style={{ fontSize: '10px', opacity: 0.85 }}>
                    Peak: ${f.heatDetail.peakSpend?.toLocaleString()}/mo in {f.heatDetail.peakMonth}
                    {f.heatDetail.dropMonth && <span> · Dropped around {f.heatDetail.dropMonth}</span>}
                    {!f.ofUsername && <span> · <strong>No username — account may be deleted</strong></span>}
                  </div>
                )}
                {f.heatDetail.dropMonth && f.ofUsername && !(f.analysisRecords?.length > 0) && (
                  <div style={{ fontSize: '10px', marginTop: '2px', fontStyle: 'italic' }}>
                    Analyze chats starting from {f.heatDetail.dropMonth} to see what changed.
                  </div>
                )}
              </div>
            )}

            {/* Stats grid — grouped rows: Money / Timeline / Alerts, one date style */}
            {(() => {
              const mo = (monthlySpendData || []).map((d) => d.spend || 0)
              const labels = (monthlySpendData || []).map((d) => d.month || d.date || '')
              let peakI = -1
              mo.forEach((v, idx) => { if (peakI < 0 || v > mo[peakI]) peakI = idx })
              const win = Math.min(6, mo.length)
              let best6 = 0
              for (let idx = 0; win > 0 && idx + win <= mo.length; idx++) {
                const avg = mo.slice(idx, idx + win).reduce((a, b) => a + b, 0) / win
                if (avg > best6) best6 = avg
              }
              const over500 = mo.filter((v) => v >= 500).length
              const hd = f.heatDetail
              const last30 = hd ? hd.rolling30 : f.last30
              const cellLabel = { fontSize: '9px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '1px', whiteSpace: 'nowrap' }
              const cellVal = { fontSize: '13px', color: 'var(--foreground)', whiteSpace: 'nowrap' }
              const groupTag = { fontSize: '9px', fontWeight: 700, color: '#A06FE8', textTransform: 'uppercase', letterSpacing: '0.08em', width: '62px', flexShrink: 0, paddingBottom: '3px' }
              const groupRow = { display: 'flex', gap: '8px 26px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '7px 0' }
              return (
                <div style={{ background: 'var(--background)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px 14px' }}>

                  {/* ── MONEY ── */}
                  <div style={groupRow}>
                    <div style={groupTag}>Money</div>
                    <div>
                      <div style={{ ...cellLabel, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Lifetime
                        {f.lifetimeOverride > 0 && (
                          <span title="Manual override in effect — used on the Telegram PDF" style={{ fontSize: '8px', background: 'rgba(232, 200, 120, 0.1)', color: '#E8A878', padding: '0 4px', borderRadius: '3px', fontWeight: 700 }}>OVERRIDE</span>
                        )}
                      </div>
                      {editingLifetime ? (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: 'var(--foreground)' }}>$</span>
                          <input
                            type="text" autoFocus value={lifetimeDraft}
                            onChange={e => setLifetimeDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveLifetimeOverride(lifetimeDraft)
                              if (e.key === 'Escape') setEditingLifetime(false)
                            }}
                            placeholder="blank to clear" disabled={savingLifetime}
                            style={{ width: '80px', fontSize: '12px', padding: '2px 4px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px' }} />
                          <button onClick={() => saveLifetimeOverride(lifetimeDraft)} disabled={savingLifetime}
                            style={{ fontSize: '10px', padding: '2px 6px', border: 'none', background: '#7DD3A4', color: 'var(--foreground)', borderRadius: '3px', cursor: 'pointer' }}>
                            {savingLifetime ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingLifetime(false)} disabled={savingLifetime}
                            style={{ fontSize: '10px', padding: '2px 6px', border: '1px solid rgba(255,255,255,0.08)', background: 'var(--card-bg-solid)', borderRadius: '3px', cursor: 'pointer', color: 'var(--foreground-muted)' }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => { if (readOnly) return; setLifetimeDraft(f.lifetimeOverride > 0 ? String(f.lifetimeOverride) : ''); setEditingLifetime(true) }}
                          title={readOnly ? undefined : 'Click to set a manual lifetime override (used on the Telegram PDF)'}
                          style={{ cursor: 'pointer', borderBottom: '1px dashed transparent', display: 'inline-flex', gap: '6px', alignItems: 'baseline' }}
                          onMouseEnter={e => e.currentTarget.style.borderBottomColor = '#94A3B8'}
                          onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}>
                          <strong style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--foreground)' }}>{fmtMoney(f.lifetimeOverride > 0 ? f.lifetimeOverride : f.lifetimeSpend)}</strong>
                          {f.lifetimeOverride > 0 && (
                            <span style={{ fontSize: '10px', color: '#94A3B8', textDecoration: 'line-through' }}>{fmtMoney(f.lifetimeSpend)}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={cellLabel}>Last 30d</div>
                      <div style={{ ...cellVal, fontSize: '16px', fontWeight: 700, color: hd && (hd.rolling30 || 0) < (hd.monthlyAvg90 || 0) * 0.5 ? '#E87878' : '#7DD3A4' }}>
                        {fmtMoney(last30)}{hd ? <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--foreground-muted)' }}> vs {fmtMoney(hd.monthlyAvg90)}/mo avg</span> : null}
                      </div>
                    </div>
                    {hd && (
                      <div>
                        <div style={cellLabel}>90d avg/mo</div>
                        <div style={cellVal}>{fmtMoney(hd.monthlyAvg90)}</div>
                      </div>
                    )}
                    {mo.length > 0 && (
                      <div>
                        <div style={cellLabel} title="avg $/mo across his hottest 6-month stretch">Best 6-mo avg</div>
                        <div style={{ ...cellVal, fontWeight: 600 }}>{fmtMoney(best6)}/mo</div>
                      </div>
                    )}
                    {peakI >= 0 && (
                      <div>
                        <div style={cellLabel}>Peak month</div>
                        <div style={{ ...cellVal, fontWeight: 600 }}>{fmtMoney(mo[peakI])} <span style={{ fontWeight: 400, color: 'var(--foreground-muted)' }}>{fmtD(labels[peakI])}</span></div>
                      </div>
                    )}
                    {mo.length > 0 && (
                      <div>
                        <div style={cellLabel} title="months where he spent $500+">$500+ months</div>
                        <div style={{ ...cellVal, fontWeight: 600, color: over500 >= 3 ? '#7DD3A4' : 'var(--foreground)' }}>{over500}</div>
                      </div>
                    )}
                  </div>

                  {/* ── TIMELINE ── */}
                  <div style={{ ...groupRow, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={groupTag}>Timeline</div>
                    {f.firstDate && (
                      <div>
                        <div style={cellLabel}>First buy</div>
                        <div style={cellVal}>{fmtD(f.firstDate)}</div>
                      </div>
                    )}
                    {hd && (
                      <div>
                        <div style={cellLabel}>Last buy</div>
                        <div style={cellVal}>{fmtD(hd.lastPurchase)}</div>
                      </div>
                    )}
                    {hd && (
                      <div>
                        <div style={cellLabel}>Silent</div>
                        <div style={{ ...cellVal, fontSize: '16px', fontWeight: 700, color: '#E87878' }}>{hd.currentGap}d <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--foreground-muted)' }}>vs ~{hd.medianGap}d rhythm</span></div>
                      </div>
                    )}
                    <div>
                      <div style={cellLabel}>Sessions</div>
                      <div style={cellVal}>{f.txnCount || 0}</div>
                    </div>
                  </div>

                  {/* ── ALERTS ── */}
                  {(f.firstFlagged || f.timesGoneCold > 0 || f.preAlertSpend30d > 0 || f.postAlertSpend30d > 0) && (
                    <div style={{ ...groupRow, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={groupTag}>Alerts</div>
                      {f.firstFlagged && (
                        <div>
                          <div style={cellLabel}>First flagged</div>
                          <div style={cellVal}>{fmtD(f.firstFlagged)}</div>
                        </div>
                      )}
                      {f.timesGoneCold > 0 && (
                        <div>
                          <div style={cellLabel}>Times gone cold</div>
                          <div style={cellVal}>{f.timesGoneCold}</div>
                        </div>
                      )}
                      {(f.preAlertSpend30d > 0 || f.postAlertSpend30d > 0) && (
                        <div>
                          <div style={cellLabel}>Post-alert 30d</div>
                          <div style={{ ...cellVal, fontWeight: 600, color: f.postAlertSpend30d > f.preAlertSpend30d ? '#7DD3A4' : '#E87878' }}>{fmtMoney(f.postAlertSpend30d)}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* ═══ SECTION 4: Upload New Chat ═══ */}
          {!readOnly && (
          <div style={{ marginTop: '4px', borderTop: '1px solid transparent', paddingTop: '14px' }}>
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>
              {inModal ? <>Analyze Chat — {f.fanName}</> : <>Upload Chat for {f.fanName}</>}
            </div>

            {/* Scroll-back hint — HTML-flow only, hidden in the modal */}
            {!inModal && (() => {
              const mostRecent = f.analysisRecords?.[0]
              const lastDate = mostRecent?.lastMessageDate
              if (lastDate) return (
                <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(232, 168, 120, 0.08)', border: '1px solid rgba(232, 168, 120, 0.15)', borderRadius: '6px', fontSize: '11px', color: '#E8A878' }}>
                  Last analysis covered messages through <strong>{lastDate}</strong>. Scroll back to at least this date in the OF chat before saving as HTML.
                </div>
              )
              if (f.analysisRecords?.length > 0) return (
                <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '6px', fontSize: '11px', color: '#78B4E8' }}>
                  Each upload is analyzed independently. Scroll back far enough in the OF chat to include all messages you want covered, then save as HTML.
                </div>
              )
              return null
            })()}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input ref={chatFileRef} type="file" accept=".html,.htm"
                onChange={e => {
                  const file = e.target.files[0]
                  if (!file) return
                  setAnalysisError(null)
                  if (accountNames.length > 1 && uploadAccountName) {
                    // Multi-account: auto-save this account's transcript to Dropbox immediately.
                    // User can then pick another account and repeat. Final Analyze uses combined transcripts.
                    handleAccountUpload(uploadAccountName, file)
                  } else {
                    // Single-account: existing flow — hold file in state, user clicks Analyze to run.
                    setChatFile(file)
                  }
                  e.target.value = '' // allow re-selecting the same filename
                }}
                style={{ display: 'none' }} />

              {!inModal && (accountNames.length > 1 ? (
                // Multi-account fan: one button per account, color-coded to match the badges.
                // Clicking opens picker; picking a file auto-saves to that account's Dropbox transcript.
                <>
                  {accountNames.map(acct => {
                    const isFree = /free/i.test(acct)
                    const isVip = /vip/i.test(acct)
                    const baseColor = isFree ? '#3B82F6' : isVip ? '#A78BFA' : 'var(--foreground-muted)'
                    const baseBg = isFree ? 'rgba(59,130,246,0.08)' : isVip ? 'rgba(167, 139, 250, 0.06)' : 'var(--card-bg-solid)'
                    const state = accountUploadState[acct] // 'saving' | 'saved' | 'error' | undefined
                    const label = acct.replace(/^.*?-\s*/, '').trim() // "Free OF", "VIP OF"
                    const displayText = state === 'saving' ? `Saving ${label}\u2026`
                      : state === 'saved' ? `\u2713 ${label} saved`
                      : state === 'error' ? `\u26A0 ${label} failed \u2014 retry`
                      : `Upload ${label} chat`
                    const isSuccess = state === 'saved'
                    return (
                      <button key={acct}
                        disabled={state === 'saving'}
                        onClick={() => { setUploadAccountName(acct); chatFileRef.current?.click() }}
                        style={{
                          background: isSuccess ? 'rgba(125, 211, 164, 0.06)' : baseBg,
                          border: `1px solid ${isSuccess ? 'rgba(125, 211, 164, 0.2)' : baseColor + '66'}`,
                          borderRadius: '6px', padding: '6px 12px', fontSize: '12px',
                          cursor: state === 'saving' ? 'wait' : 'pointer',
                          color: isSuccess ? '#7DD3A4' : baseColor, fontWeight: isSuccess ? 600 : 500,
                          opacity: state === 'saving' ? 0.7 : 1,
                        }}>
                        {displayText}
                      </button>
                    )
                  })}
                </>
              ) : (
                <button onClick={() => { setUploadAccountName(null); chatFileRef.current?.click() }}
                  style={{
                    background: chatFile ? 'rgba(125, 211, 164, 0.06)' : 'var(--card-bg-solid)', border: `1px solid ${chatFile ? 'rgba(125, 211, 164, 0.2)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                    color: chatFile ? '#7DD3A4' : 'var(--foreground-muted)',
                  }}>
                  {chatFile ? `\u2713 ${chatFile.name}` : 'Upload OF chat HTML'}
                </button>
              ))}
              {/* Multi-account: Analyze button appears once at least one account's transcript is saved.
                  Uses the "useTranscript" flow — server loads ALL saved account transcripts from Dropbox,
                  combines them with thread headers, and sends to Claude for one unified analysis. */}
              {accountNames.length > 1 && Object.values(accountUploadState).some(s => s === 'saved') && (
                <button onClick={() => handleAnalyze(true)} disabled={analyzing}
                  style={{
                    background: '#E88C5C', border: 'none', borderRadius: '6px',
                    padding: '6px 14px', fontSize: '12px', color: 'var(--foreground)', fontWeight: 600,
                    cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.6 : 1,
                  }}>
                  {analyzing ? 'Analyzing\u2026' : 'Analyze Conversation'}
                </button>
              )}

              {/* Pull the conversation straight from OF (read-only API) —
                  replaces the scroll → save HTML → upload dance. */}
              {bigPull && (
                <div style={{ width: '100%', padding: '10px 14px', background: 'rgba(232, 200, 120, 0.08)', border: '1px solid rgba(232, 200, 120, 0.3)', borderRadius: '8px', fontSize: '12px', color: '#E8C878', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Full history is <b>{bigPull.messages ? bigPull.messages.toLocaleString() : 'a lot of'} messages ≈ {bigPull.credits} credits.</b></span>
                  <button onClick={() => handlePullFromOf({ confirmBig: true })} disabled={pullingOf}
                    style={{ background: 'rgba(232, 200, 120, 0.15)', border: '1px solid rgba(232,200,120,0.4)', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', color: '#E8C878', fontWeight: 700, cursor: 'pointer' }}>
                    Pull it anyway ({bigPull.credits} credits)
                  </button>
                  <button onClick={() => handlePullFromOf({ acceptPartial: true })} disabled={pullingOf}
                    style={{ background: 'rgba(125, 211, 164, 0.1)', border: '1px solid rgba(125,211,164,0.35)', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', color: '#7DD3A4', fontWeight: 700, cursor: 'pointer' }}>
                    Keep recent only (cheap top-ups from now on)
                  </button>
                </div>
              )}
              {archiveMeta && !ofPull && (
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', width: '100%' }}>
                  Last pulled from OF: <b style={{ color: 'var(--foreground)' }}>{archiveMeta.pulledAt ? new Date(archiveMeta.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'unknown'}</b>
                  {' '}· {archiveMeta.totalStored.toLocaleString()} messages archived through {archiveMeta.lastMessageAt ? new Date(archiveMeta.lastMessageAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </span>
              )}
              {bigPull && (
                <div style={{ width: '100%', padding: '10px 14px', background: 'rgba(232, 200, 120, 0.08)', border: '1px solid rgba(232, 200, 120, 0.3)', borderRadius: '8px', fontSize: '12px', color: '#E8C878', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Full history is <b>{bigPull.messages ? bigPull.messages.toLocaleString() : 'a lot of'} messages ≈ {bigPull.credits} credits.</b></span>
                  <button onClick={() => handlePullFromOf({ confirmBig: true })} disabled={pullingOf}
                    style={{ background: 'rgba(232, 200, 120, 0.15)', border: '1px solid rgba(232,200,120,0.4)', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', color: '#E8C878', fontWeight: 700, cursor: 'pointer' }}>
                    Pull it anyway ({bigPull.credits} credits)
                  </button>
                  <button onClick={() => handlePullFromOf({ acceptPartial: true })} disabled={pullingOf}
                    style={{ background: 'rgba(125, 211, 164, 0.1)', border: '1px solid rgba(125,211,164,0.35)', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', color: '#7DD3A4', fontWeight: 700, cursor: 'pointer' }}>
                    Keep recent only (cheap top-ups from now on)
                  </button>
                </div>
              )}
              {archiveMeta && !ofPull && (
                <button onClick={handleLoadArchive} disabled={pullingOf || analyzing}
                  style={{
                    background: 'rgba(125, 211, 164, 0.08)', border: '1px solid rgba(125, 211, 164, 0.3)', borderRadius: '6px',
                    padding: '6px 14px', fontSize: '12px', color: '#7DD3A4', fontWeight: 600,
                    cursor: pullingOf ? 'not-allowed' : 'pointer', opacity: pullingOf ? 0.6 : 1,
                  }}>
                  {pullingOf ? 'Loading…' : 'Load archived chat (0 credits)'}
                </button>
              )}
              {(f.ofUsername || f.fanId || f.fanName) && <button onClick={handlePullFromOf} disabled={pullingOf || analyzing}
                style={{
                  background: 'rgba(196, 165, 247, 0.10)', border: '1px solid rgba(196, 165, 247, 0.4)', borderRadius: '6px',
                  padding: '6px 14px', fontSize: '12px', color: '#A06FE8', fontWeight: 600,
                  cursor: pullingOf ? 'not-allowed' : 'pointer', opacity: pullingOf ? 0.6 : 1,
                }}>
                {pullingOf ? (pullProgress?.waiting != null ? `Building his spending-era export… ${pullProgress.rowsFound != null ? pullProgress.rowsFound.toLocaleString() + ' real messages found' : pullProgress.waiting + '%'}` : pullProgress ? `Pulling… ${(pullProgress.total || 0).toLocaleString()} msgs · back to ${pullProgress.oldest ? new Date(pullProgress.oldest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '…'} · ${pullProgress.spent}cr` : 'Pulling from OF…') : ofPull ? '↻ Re-pull from OF' : 'Pull from OF'}
              </button>}
              {ofPull && !chatFile && !(ofPull.messageCount > 0) && (
                <span style={{ fontSize: '11px', color: '#E8C878' }}>
                  Nothing to analyze yet — his history export is still building at OF. Pull again in a few minutes (attaches to the same export, no double charge).
                </span>
              )}
              {ofPull && !chatFile && ofPull.messageCount > 0 && (
                <>
                  <span style={{ fontSize: '11px', color: '#A06FE8' }}>
                    ✓ {ofPull.messageCount} messages ({ofPull.firstMessageDate} → {ofPull.lastMessageDate})
                    {typeof ofPull.newMessages === 'number' && <span style={{ color: 'var(--foreground-muted)' }}> · {ofPull.newMessages} new since last pull · {ofPull.credits || 0} credit{(ofPull.credits || 0) === 1 ? '' : 's'}</span>}
                    {ofPull.historyComplete === false && <span style={{ color: '#E8C878' }}> · {ofPull.capped ? 'stopped at his credit cap' : 'older history remains'} — pull again to keep deepening</span>}
                  </span>
                  <button onClick={handleAnalyze} disabled={analyzing}
                    style={{
                      background: '#E88C5C', border: 'none', borderRadius: '6px',
                      padding: '6px 14px', fontSize: '12px', color: 'var(--foreground)', fontWeight: 600,
                      cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.6 : 1,
                    }}>
                    {analyzing ? 'Analyzing...' : 'Analyze Conversation'}
                  </button>
                </>
              )}

              {chatFile && (
                <button onClick={handleAnalyze} disabled={analyzing}
                  style={{
                    background: '#E88C5C', border: 'none', borderRadius: '6px',
                    padding: '6px 14px', fontSize: '12px', color: 'var(--foreground)', fontWeight: 600,
                    cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.6 : 1,
                  }}>
                  {analyzing ? 'Analyzing...' : 'Analyze Conversation'}
                </button>
              )}

              {/* Re-analyze from Dropbox transcript */}
              {!chatFile && !ofPull && f.analysisRecords?.length > 0 && (
                <>
                  <button onClick={() => handleAnalyze(true)} disabled={analyzing}
                    style={{ fontSize: '11px', color: '#E88C5C', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                    {analyzing ? 'Re-analyzing...' : 'Re-analyze from saved transcript'}
                  </button>
                  <span style={{ color: 'var(--foreground)' }}>|</span>
                  <input ref={saveFileRef} type="file" accept=".html,.htm"
                    onChange={e => { if (e.target.files[0]) handleSaveTranscript(e.target.files[0]) }}
                    style={{ display: 'none' }} />
                  <button onClick={() => saveFileRef.current?.click()} disabled={savingTranscript}
                    style={{ fontSize: '11px', color: '#0369A1', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                    {savingTranscript ? 'Saving...' : transcriptSaved ? '\u2713 Saved' : 'Save transcript to Dropbox'}
                  </button>
                </>
              )}
            </div>

            {analysisError && (
              <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(232, 120, 120, 0.08)', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#E87878' }}>
                {analysisError}
              </div>
            )}
          </div>
          )}

          {/* Notes */}
          {f.notes && (
            <div style={{ marginTop: '14px', borderTop: '1px solid transparent', paddingTop: '12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Notes</div>
              <div style={{ fontSize: '12px', color: 'var(--foreground)', whiteSpace: 'pre-wrap' }}>{f.notes}</div>
            </div>
          )}

          {/* Ban / Unban — low-visibility footer action (creator flagged as do-not-contact) */}
          {!readOnly && (
          <div style={{ marginTop: '16px', paddingTop: '10px', borderTop: '1px solid transparent', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={async () => {
                const isBanned = f.banned
                const confirmMsg = isBanned
                  ? `Unban ${f.fanName}? They'll become eligible for alerts again.`
                  : `Ban ${f.fanName}? They'll be hidden from the Fans list and excluded from all future alerts. The chat team won't see them.`
                if (!confirm(confirmMsg)) return
                try {
                  const res = await fetch('/api/admin/fan-tracker', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'update_status',
                      recordId: f.crmId || null,
                      fanName: f.fanName,
                      fanUsername: f.ofUsername,
                      creatorRecordId,
                      status: isBanned ? 'Monitoring' : 'Banned', // flip to Monitoring when unbanning — neutral state
                    }),
                  })
                  if (!res.ok) throw new Error('Ban update failed')
                  // Refresh CRM data
                  const refreshRes = await fetch(`/api/admin/fan-tracker?creatorFull=${encodeURIComponent(creatorName || '')}`)
                  const refreshData = await refreshRes.json()
                  if (refreshData.fans) setFans(refreshData.fans)
                } catch (e) {
                  alert(`Ban update failed: ${e.message}`)
                }
              }}
              style={{
                fontSize: '10px', color: f.banned ? '#1F2937' : '#9CA3AF',
                background: 'none', border: 'none', cursor: 'pointer',
                textDecoration: 'underline', fontWeight: f.banned ? 600 : 400,
              }}
            >
              {f.banned ? '↶ Unban this fan' : '🚫 Ban this fan (do not contact)'}
            </button>
          </div>
          )}          {/* ═══ SECTION 3: Analysis History ═══ */}
          <div style={{ marginTop: '16px', borderTop: '1px solid transparent', paddingTop: '14px' }}>
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '10px' }}>
              Analysis History {f.lifetimeSpend >= 1000 ? '— Deep Dive' : '— Quick Snapshot'}
            </div>

            {/* Analysis cards */}
            {f.analysisRecords && f.analysisRecords.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {f.analysisRecords.map((rec, idx) => {
                  // Check if this analysis was sent to manager (alert exists on or after analysis date)
                  const sentAlert = f.alertHistory?.find(h => h.date && rec.date && h.date >= rec.date)
                  const isSent = !!sentAlert

                  // Truncate brief for card summary (first 2 meaningful lines)
                  const briefSummary = (() => {
                    if (!rec.brief) return null
                    const lines = rec.brief.split('\n').map(l => l.trim()).filter(l => l && !/^\*\*[^*]+\*\*$/.test(l))
                    const cleaned = lines.slice(0, 3).map(l => l.replace(/\*\*([^*]+)\*\*/g, '$1')).join(' ')
                    return cleaned.length > 180 ? cleaned.slice(0, 180) + '...' : cleaned
                  })()

                  return (
                    <div key={rec.id || idx} style={{
                      background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '8px', padding: '12px 14px',
                      transition: 'box-shadow 0.15s', cursor: 'default',
                    }}>
                      {/* Card header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: briefSummary ? '8px' : 0, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>{fmtDate(rec.date)}</span>
                        {rec.type && <span style={{ fontSize: '9px', fontWeight: 600, color: '#A78BFA', background: 'rgba(167, 139, 250, 0.1)', padding: '1px 6px', borderRadius: '3px' }}>{rec.type}</span>}

                        {/* Send status */}
                        {isSent
                          ? <span style={{ fontSize: '9px', fontWeight: 600, color: '#7DD3A4', background: 'rgba(125, 211, 164, 0.08)', padding: '1px 6px', borderRadius: '3px' }}>
                              Sent to Manager {sentAlert.date ? `· ${fmtDate(sentAlert.date)}` : ''}
                            </span>
                          : <span style={{ fontSize: '9px', fontWeight: 600, color: '#E8A878', background: 'rgba(232, 200, 120, 0.1)', padding: '1px 6px', borderRadius: '3px' }}>Not Sent</span>
                        }

                        {/* Chat window dates */}
                        {(rec.firstMessageDate || rec.lastMessageDate) && (
                          <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>
                            {rec.firstMessageDate || '?'} → {rec.lastMessageDate || '?'}
                          </span>
                        )}

                        {/* Spacer + action buttons */}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setViewingAnalysisIdx(idx); setSelectedAnalysisIdx(idx); setShowBrief(false) }}
                            style={{ fontSize: '10px', color: '#A78BFA', background: 'rgba(167, 139, 250, 0.1)', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}>
                            View Full
                          </button>
                          {!isSent && !readOnly && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedAnalysisIdx(idx); handlePreviewPdf() }}
                              disabled={previewLoading}
                              style={{ fontSize: '10px', color: '#060606', background: 'var(--palm-pink)', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: previewLoading ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: previewLoading ? 0.6 : 1 }}>
                              {previewLoading && selectedAnalysisIdx === idx ? 'Generating...' : 'Send to Manager'}
                            </button>
                          )}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (!confirm('Delete this analysis?')) return
                              const res = await fetch(`/api/admin/fan-tracker?recordId=${rec.id}&table=analysis`, { method: 'DELETE' })
                              if (res.ok) {
                                // Update CRM data — match by finding which CRM record contains this analysis
                                setFans(prev => prev.map(crmFan => {
                                  if (!crmFan.analysisRecords?.some(ar => ar.id === rec.id)) return crmFan
                                  const updated = { ...crmFan, analysisRecords: crmFan.analysisRecords.filter(ar => ar.id !== rec.id) }
                                  if (updated.analysisRecords.length === 0 && updated.source === 'analysis') return null
                                  return updated
                                }).filter(Boolean))
                                setSelectedAnalysisIdx(0)
                                if (viewingAnalysisIdx === idx) setViewingAnalysisIdx(null)
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
                            onMouseEnter={e => e.target.style.color = '#E87878'}
                            onMouseLeave={e => e.target.style.color = 'var(--foreground-subtle)'}
                            title="Delete this analysis"
                          >&times;</button>
                        </div>
                      </div>

                      {/* Brief summary preview */}
                      {briefSummary && (
                        <div style={{ fontSize: '11px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.5' }}>
                          {briefSummary}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '16px', fontStyle: 'italic' }}>No analyses yet. Upload an OF chat to get started.</div>
            )}

            {/* Freshly generated analysis (inline, before it gets saved to records) */}
            {analysis && (
              <div style={{ marginBottom: '16px', padding: '12px 14px', background: 'rgba(232, 200, 120, 0.05)', border: '1px solid transparent', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11px', color: 'var(--foreground-muted)' }}>
                    <span style={{ fontWeight: 600, color: '#E88C5C' }}>New Analysis</span>
                    <span>{analysis.messageCount} msgs ({analysis.fanMessages} fan / {analysis.creatorMessages} creator)</span>
                    {(analysis.firstMessageDate || analysis.lastMessageDate) && (
                      <span>Chats: {analysis.firstMessageDate || '?'} → {analysis.lastMessageDate || '?'}</span>
                    )}
                    {analysis.saved && <span style={{ color: '#7DD3A4', fontSize: '10px' }}>\u2713 Saved</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {analysis.managerBrief && (
                      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
                        <button onClick={() => setShowBrief(false)} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: !showBrief ? '#E88C5C' : 'transparent', color: !showBrief ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)' }}>Full</button>
                        <button onClick={() => setShowBrief(true)} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: showBrief ? '#E88C5C' : 'transparent', color: showBrief ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)' }}>Manager Brief</button>
                      </div>
                    )}
                    {chatFile && (
                      <button onClick={() => { setAnalysis(null); setShowBrief(false); handleAnalyze() }} disabled={analyzing}
                        style={{ fontSize: '10px', color: '#E88C5C', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                        {analyzing ? 'Re-analyzing...' : 'Re-analyze'}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{
                  background: showBrief ? 'var(--card-bg-solid)' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${showBrief ? 'rgba(255,255,255,0.06)' : 'rgba(232, 168, 120, 0.15)'}`,
                  borderRadius: '6px', padding: '14px 16px', fontSize: '12px', color: 'var(--foreground)', lineHeight: '1.7',
                }}>
                  {(() => {
                    const text = showBrief ? (analysis.managerBrief || analysis.analysis) : analysis.analysis
                    const accentColor = showBrief ? 'var(--foreground-muted)' : '#E88C5C'
                    return text.split('\n').map((line, idx) => {
                      const trimmed = line.trim()
                      if (!trimmed) return <div key={idx} style={{ height: '8px' }} />
                      if (/^\*\*[^*]+\*\*/.test(trimmed)) {
                        const hm = trimmed.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
                        if (hm) {
                          const rest = hm[2]?.replace(/\*\*([^*]+)\*\*/g, '$1') || ''
                          return <div key={idx} style={{ marginTop: idx > 0 ? '12px' : 0, marginBottom: '3px' }}><div style={{ fontSize: '11px', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{hm[1]}</div>{rest && <div style={{ marginTop: '2px' }}>{rest}</div>}</div>
                        }
                      }
                      if (/^\d+\.\s/.test(trimmed)) {
                        const content = trimmed.replace(/^\d+\.\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                        const nm = trimmed.match(/^(\d+)\./)
                        return <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px', paddingLeft: '4px' }}><span style={{ color: accentColor, fontWeight: 700, fontSize: '11px', minWidth: '16px' }}>{nm[1]}.</span><span>{content}</span></div>
                      }
                      if (/^[-\u2022]\s/.test(trimmed)) {
                        const content = trimmed.replace(/^[-\u2022]\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                        return <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '3px', paddingLeft: '4px' }}><span style={{ color: accentColor, fontSize: '8px', marginTop: '5px' }}>●</span><span>{content}</span></div>
                      }
                      return <div key={idx}>{trimmed.replace(/\*\*([^*]+)\*\*/g, (_, t) => t)}</div>
                    })
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Spending chart — full width, monthly bars (default) / daily line toggle */}
          {(fanSpendData || monthlySpendData) && (() => {
            const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            const VW = 900, H = 150, padL = 50, padR = 30, padT = 16, padB = 24
            const chartW = VW - padL - padR, chartH = H - padT - padB
            const milestoneMonths = milestones.map(m => m.date.slice(0, 7))

            const allMonthly = monthlySpendData || []
            const defaultMonthly = allMonthly.length > 7 ? allMonthly.slice(-7) : allMonthly
            const visibleMonthly = showAllHistory ? allMonthly : defaultMonthly
            const canExpandMonthly = allMonthly.length > 7
            const startMonth = visibleMonthly.length > 0 ? visibleMonthly[0].month : null
            const allDaily = fanSpendData || []
            const visibleDaily = startMonth ? allDaily.filter(d => d.date >= startMonth) : allDaily

            // Shared y-axis scale across both charts with round tick numbers
            const monthlyMax = visibleMonthly.length > 0 ? Math.max(...visibleMonthly.map(d => d.spend)) : 0
            const dailyMax = visibleDaily.length > 0 ? Math.max(...visibleDaily.map(d => d.spend)) : 0
            const rawMax = Math.max(monthlyMax, dailyMax, 1)
            // Round up to a nice number
            const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)))
            const niceSteps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            const sharedMax = niceSteps.map(s => s * magnitude).find(s => s >= rawMax) || rawMax
            const sharedTicks = [0, Math.round(sharedMax / 2), Math.round(sharedMax)]

            const headerRow = (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Spending History</div>
                  {canExpandMonthly && (
                    <button onClick={() => setShowAllHistory(!showAllHistory)}
                      style={{ fontSize: '10px', color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 500 }}>
                      {showAllHistory ? `Last 7 months` : `Show all (${allMonthly.length} months)`}
                    </button>
                  )}
                  {archiveMeta?.totalStored > 0 && (
                    <span title="How far back we have his OF messages — pull again to deepen if it doesn't cover the whole chart"
                      style={{ fontSize: '10px', color: archiveMeta.historyComplete ? '#7DD3A4' : '#E8C878', whiteSpace: 'nowrap' }}>
                      💬 chat: {archiveMeta.firstMessageAt ? new Date(archiveMeta.firstMessageAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '?'}
                      {' → '}{archiveMeta.lastMessageAt ? new Date(archiveMeta.lastMessageAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '?'}
                      {archiveMeta.historyComplete ? ' · full history' : ' · partial — pull again for older'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
                  <button onClick={() => setChartMode('monthly')} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 700, border: 'none', cursor: 'pointer', background: chartMode === 'monthly' ? '#A78BFA' : 'transparent', color: chartMode === 'monthly' ? '#141414' : 'rgba(240, 236, 232, 0.75)' }}>Monthly</button>
                  <button onClick={() => setChartMode('daily')} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 700, border: 'none', cursor: 'pointer', background: chartMode === 'daily' ? '#A78BFA' : 'transparent', color: chartMode === 'daily' ? '#141414' : 'rgba(240, 236, 232, 0.75)' }}>Daily</button>
                </div>
                {accountNames.length > 1 && (
                  <button onClick={() => setSplitByAccount(!splitByAccount)}
                    style={{
                      padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer',
                      borderRadius: '4px', background: splitByAccount ? '#A78BFA' : 'rgba(255,255,255,0.04)', color: splitByAccount ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)',
                    }}>
                    Split by account
                  </button>
                )}
                {splitByAccount && accountNames.length > 1 && (
                  <div style={{ display: 'flex', gap: '8px', fontSize: '9px', color: 'rgba(240, 236, 232, 0.75)' }}>
                    {accountNames.map(acct => {
                      const isFree = /free/i.test(acct)
                      const color = isFree ? '#60A5FA' : '#A78BFA'
                      return (
                        <span key={acct} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: color }} />
                          {acct}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )

            if (chartMode === 'monthly' && visibleMonthly.length >= 1) {
              const data = visibleMonthly
              const barW = Math.min(chartW / data.length * 0.7, 40)
              const yScale = (v) => padT + chartH - (v / sharedMax) * chartH

              return (
                <div style={{ marginBottom: '12px' }}>
                  {headerRow}
                  <svg viewBox={`0 0 ${VW} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
                    {sharedTicks.map(v => (
                      <g key={v}>
                        <line x1={padL} x2={VW - padR} y1={yScale(v)} y2={yScale(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x={padL - 6} y={yScale(v) + 3} textAnchor="end" fontSize="9" fill="#999">${v > 0 ? v.toLocaleString() : '0'}</text>
                      </g>
                    ))}
                    {data.map((d, i) => {
                      const cx = padL + ((i + 0.5) / data.length) * chartW
                      const barH = Math.max((d.spend / sharedMax) * chartH, d.spend > 0 ? 2 : 0)
                      const moNum = parseInt(d.month.slice(5))
                      const yr = d.month.slice(2, 4)
                      const hasMilestone = milestoneMonths.includes(d.month)
                      const spendLabelY = padT + chartH - barH - 3
                      const defaultDotY = padT - 6
                      const dotY = hasMilestone && d.spend > 0 && spendLabelY < defaultDotY + 12 ? spendLabelY - 10 : defaultDotY
                      // Stacked segments when splitting by account
                      let segments = null
                      if (splitByAccount && accountNames.length > 1 && d.spend > 0) {
                        let yCursor = padT + chartH
                        segments = accountNames.map(acct => {
                          const acctSpend = perAccountMonthly[acct]?.[i]?.spend || 0
                          if (acctSpend <= 0) return null
                          const segH = (acctSpend / sharedMax) * chartH
                          const isFree = /free/i.test(acct)
                          const color = isFree ? '#60A5FA' : '#A78BFA'
                          const rect = <rect key={acct} x={cx - barW / 2} y={yCursor - segH} width={barW} height={segH} fill={color} />
                          yCursor -= segH
                          return rect
                        })
                      }
                      return (
                        <g key={d.month}>
                          {segments ? (
                            <>
                              <rect x={cx - barW / 2} y={padT + chartH - barH} width={barW} height={barH} fill="none" />
                              {segments}
                            </>
                          ) : (
                            <rect x={cx - barW / 2} y={padT + chartH - barH} width={barW} height={barH} fill={d.spend === 0 ? 'rgba(255,255,255,0.04)' : 'var(--palm-pink)'} rx="2" />
                          )}
                          {d.spend > 0 && <text x={cx} y={spendLabelY} textAnchor="middle" fontSize="8" fill="#666">{fmtMoney(d.spend)}</text>}
                          <text x={cx} y={H - 4} textAnchor="middle" fontSize="9" fill={hasMilestone ? '#A78BFA' : 'var(--foreground-muted)'} fontWeight={hasMilestone ? '700' : '400'}>{moNames[moNum]}{data.length > 12 ? `'${yr}` : ''}</text>
                          {hasMilestone && <circle cx={cx} cy={dotY} r="3.5" fill="#7C3AED" />}
                        </g>
                      )
                    })}
                  </svg>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '9px', color: 'var(--foreground-muted)', visibility: milestones.length > 0 ? 'visible' : 'hidden' }}>
                    <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#A78BFA', marginRight: '3px', verticalAlign: 'middle' }} />Analysis/Alert sent</span>
                  </div>
                </div>
              )
            }

            if (chartMode === 'daily' && visibleDaily.length >= 2) {
              const data = visibleDaily
              // Time-based x positioning so daily dates align with monthly bars
              const timestamps = data.map(d => new Date(d.date + 'T12:00:00').getTime())
              const tStart = timestamps[0]
              // Extend to end of the last month so partial months match the monthly bar width
              const lastDate = new Date(data[data.length - 1].date + 'T12:00:00')
              const monthEnd = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 0, 12, 0, 0)
              const tEnd = monthEnd.getTime()
              const tRange = tEnd - tStart || 1
              const xScale = (i) => padL + ((timestamps[i] - tStart) / tRange) * chartW
              const yScale = (v) => padT + chartH - (v / sharedMax) * chartH
              const points = data.map((d, i) => `${xScale(i)},${yScale(d.spend)}`)
              // Split into solid (active) and dashed (gap after last spend) segments
              const lastSpendIdx = (() => {
                for (let i = data.length - 1; i >= 0; i--) {
                  if (!data[i].afterLastSpend) return i
                }
                return data.length - 1
              })()
              const solidPoints = points.slice(0, lastSpendIdx + 1)
              const dashedPoints = lastSpendIdx < data.length - 1 ? points.slice(lastSpendIdx) : []
              const solidPath = solidPoints.length > 0 ? 'M' + solidPoints.join(' L') : ''
              const dashedPath = dashedPoints.length > 1 ? 'M' + dashedPoints.join(' L') : ''
              const linePath = 'M' + points.join(' L')
              const areaPath = solidPath + ` L${xScale(lastSpendIdx)},${yScale(0)} L${xScale(0)},${yScale(0)} Z`
              const moAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              const fmtDateLabel = (dateStr) => {
                const dt = new Date(dateStr + 'T12:00:00')
                return `${moAbbr[dt.getMonth()]} ${dt.getDate()}`
              }
              // Generate labels at month boundaries for better alignment with monthly chart
              const xLabels = []
              const seenMonths = new Set()
              data.forEach((d, i) => {
                const mo = d.date.slice(0, 7)
                if (!seenMonths.has(mo)) {
                  seenMonths.add(mo)
                  xLabels.push({ i, label: fmtDateLabel(d.date) })
                }
              })
              // Include last date only if far enough from the previous label
              const lastIdx = data.length - 1
              const lastLabelIdx = xLabels[xLabels.length - 1]?.i ?? -Infinity
              if (lastIdx !== lastLabelIdx) {
                const lastX = xScale(lastIdx)
                const prevX = xScale(lastLabelIdx)
                if (lastX - prevX > 40) {
                  xLabels.push({ i: lastIdx, label: fmtDateLabel(data[lastIdx].date) })
                }
              }
              const dateToIndex = {}
              data.forEach((d, i) => { dateToIndex[d.date] = i })

              return (
                <div style={{ marginBottom: '12px' }}>
                  {headerRow}
                  <svg viewBox={`0 0 ${VW} ${H}`} style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
                    onMouseMove={e => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const scale = VW / rect.width
                      const mx = (e.clientX - rect.left) * scale
                      let closest = 0, closestDist = Infinity
                      for (let i = 0; i < data.length; i++) {
                        const dist = Math.abs(xScale(i) - mx)
                        if (dist < closestDist) { closestDist = dist; closest = i }
                      }
                      setHoverIdx(closest)
                    }}
                    onMouseLeave={() => setHoverIdx(null)}
                  >
                    {sharedTicks.map(v => (
                      <g key={v}>
                        <line x1={padL} x2={VW - padR} y1={yScale(v)} y2={yScale(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x={padL - 6} y={yScale(v) + 3} textAnchor="end" fontSize="9" fill="#999">${v > 0 ? v.toLocaleString() : '0'}</text>
                      </g>
                    ))}
                    {splitByAccount && accountNames.length > 1 ? (
                      // Per-account lines, clipped to visible daily window
                      accountNames.map(acct => {
                        const isFree = /free/i.test(acct)
                        const color = isFree ? '#60A5FA' : '#A78BFA'
                        const acctAll = perAccountDaily[acct] || []
                        const visible = startMonth ? acctAll.filter(d => d.date >= startMonth) : acctAll
                        const pts = visible.map((_, i) => `${xScale(i)},${yScale(visible[i].spend)}`)
                        if (pts.length < 2) return null
                        return (
                          <g key={acct}>
                            <path d={'M' + pts.join(' L')} fill="none" stroke={color} strokeWidth="1.5" />
                            {visible.map((d, i) => d.spend > 0 ? (
                              <circle key={i} cx={xScale(i)} cy={yScale(d.spend)} r={2} fill={color} />
                            ) : null)}
                          </g>
                        )
                      })
                    ) : (
                      <>
                        <path d={areaPath} fill="rgba(124, 58, 237, 0.08)" />
                        {solidPath && <path d={solidPath} fill="none" stroke="#7C3AED" strokeWidth="1.5" />}
                        {dashedPath && <path d={dashedPath} fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.5" />}
                        {data.map((d, i) => d.spend > 0 ? (
                          <circle key={i} cx={xScale(i)} cy={yScale(d.spend)} r={hoverIdx === i ? 4 : 2} fill="#7C3AED" />
                        ) : null)}
                      </>
                    )}
                    {hoverIdx !== null && data[hoverIdx] && (() => {
                      const d = data[hoverIdx]
                      const hx = xScale(hoverIdx)
                      const hy = yScale(d.spend)
                      const moN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      const dt = new Date(d.date + 'T12:00:00')
                      const label = `${moN[dt.getMonth()]} ${dt.getDate()}`
                      const tooltipW = 90
                      const tx = Math.max(padL, Math.min(hx - tooltipW / 2, VW - padR - tooltipW))
                      return (
                        <g>
                          <line x1={hx} x2={hx} y1={padT} y2={padT + chartH} stroke="#7C3AED" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
                          <rect x={tx} y={hy - 28} width={tooltipW} height="22" rx="4" fill="#1a1a1a" />
                          <text x={tx + tooltipW / 2} y={hy - 14} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="600">{label}: {fmtMoney(d.spend)}</text>
                        </g>
                      )
                    })()}
                    {milestones.map((m, idx) => {
                      const mi = dateToIndex[m.date]
                      if (mi === undefined) return null
                      const x = xScale(mi)
                      return (
                        <g key={idx}>
                          <line x1={x} x2={x} y1={padT} y2={H - padB} stroke={m.color} strokeWidth="1.5" strokeDasharray="4,3" />
                          <text x={x} y={padT - 2} textAnchor="middle" fontSize="8" fill={m.color} fontWeight="600">{m.label}</text>
                        </g>
                      )
                    })}
                    {xLabels.map(({ i: xi, label }) => (
                      <text key={xi} x={xScale(xi)} y={H - 4} textAnchor="middle" fontSize="7.5" fill="#999">{label}</text>
                    ))}
                  </svg>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '9px', color: 'var(--foreground-muted)', visibility: milestones.length > 0 ? 'visible' : 'hidden' }}>
                    <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#A78BFA', marginRight: '3px', verticalAlign: 'middle' }} />Analysis/Alert sent</span>
                  </div>
                </div>
              )
            }
            return null
          })()}

          {/* ═══ SECTION 2: Spending Chart (unchanged) ═══ */}
          {/* (chart code above this block) */}

        </div>
      )}

      {/* ═══ Full Analysis Modal ═══ */}
      {viewingAnalysisIdx !== null && f.analysisRecords?.[viewingAnalysisIdx] && (() => {
        const rec = f.analysisRecords[viewingAnalysisIdx]
        // Try to use the loaded analysis if it matches, otherwise use the record's brief
        const fullText = analysis?.analysis || rec.fullAnalysis || null
        const briefText = analysis?.managerBrief || rec.brief || null
        const displayText = showBrief ? (briefText || fullText || 'No analysis text available.') : (fullText || briefText || 'No analysis text available.')
        const accentColor = showBrief ? 'var(--foreground-muted)' : '#E88C5C'
        const hasFullText = !!(fullText || briefText)
        const sentAlert = f.alertHistory?.find(h => h.date && rec.date && h.date >= rec.date)

        return (
          <div
            onClick={() => { setViewingAnalysisIdx(null); setShowBrief(false) }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--card-bg-solid)', borderRadius: '12px', padding: '24px',
                maxWidth: '750px', width: '90vw', maxHeight: '85vh', overflowY: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              }}
            >
              {/* Modal header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '4px' }}>
                    {f.fanName} — Analysis {fmtDate(rec.date)}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px', color: 'var(--foreground-muted)' }}>
                    {rec.type && <span style={{ fontSize: '9px', fontWeight: 600, color: '#A78BFA', background: 'rgba(167, 139, 250, 0.1)', padding: '1px 6px', borderRadius: '3px' }}>{rec.type}</span>}
                    {sentAlert
                      ? <span style={{ fontSize: '9px', fontWeight: 600, color: '#7DD3A4', background: 'rgba(125, 211, 164, 0.08)', padding: '1px 6px', borderRadius: '3px' }}>Sent to Manager {sentAlert.date ? `· ${fmtDate(sentAlert.date)}` : ''}</span>
                      : <span style={{ fontSize: '9px', fontWeight: 600, color: '#E8A878', background: 'rgba(232, 200, 120, 0.1)', padding: '1px 6px', borderRadius: '3px' }}>Not Sent</span>
                    }
                    {(rec.firstMessageDate || rec.lastMessageDate) && (
                      <span>Chat window: {rec.firstMessageDate || '?'} → {rec.lastMessageDate || '?'}</span>
                    )}
                    {analysis && <span>{analysis.messageCount} msgs ({analysis.fanMessages} fan / {analysis.creatorMessages} creator)</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {hasFullText && fullText && briefText && (
                    <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', overflow: 'hidden' }}>
                      <button onClick={() => setShowBrief(false)} style={{ padding: '4px 10px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: !showBrief ? '#E88C5C' : 'transparent', color: !showBrief ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)' }}>Full Analysis</button>
                      <button onClick={() => setShowBrief(true)} style={{ padding: '4px 10px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: showBrief ? '#E88C5C' : 'transparent', color: showBrief ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)' }}>Manager Brief</button>
                    </div>
                  )}
                  <button onClick={() => { setViewingAnalysisIdx(null); setShowBrief(false) }} style={{ background: 'none', border: 'none', fontSize: '22px', color: 'var(--foreground-muted)', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>&times;</button>
                </div>
              </div>

              {/* Analysis body */}
              {hasFullText ? (
                <div style={{
                  background: showBrief ? 'var(--card-bg-solid)' : 'rgba(232, 200, 120, 0.05)',
                  border: `1px solid ${showBrief ? 'rgba(255,255,255,0.06)' : 'rgba(232, 168, 120, 0.15)'}`,
                  borderRadius: '8px', padding: '18px 22px', fontSize: '13px', color: 'var(--foreground)', lineHeight: '1.7',
                }}>
                  {displayText.split('\n').map((line, idx) => {
                    const trimmed = line.trim()
                    if (!trimmed) return <div key={idx} style={{ height: '8px' }} />
                    if (/^\*\*[^*]+\*\*/.test(trimmed)) {
                      const hm = trimmed.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
                      if (hm) {
                        const rest = hm[2]?.replace(/\*\*([^*]+)\*\*/g, '$1') || ''
                        return <div key={idx} style={{ marginTop: idx > 0 ? '14px' : 0, marginBottom: '4px' }}><div style={{ fontSize: '12px', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{hm[1]}</div>{rest && <div style={{ marginTop: '2px' }}>{rest}</div>}</div>
                      }
                    }
                    if (/^\d+\.\s/.test(trimmed)) {
                      const content = trimmed.replace(/^\d+\.\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                      const nm = trimmed.match(/^(\d+)\./)
                      return <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px', paddingLeft: '4px' }}><span style={{ color: accentColor, fontWeight: 700, fontSize: '12px', minWidth: '16px' }}>{nm[1]}.</span><span>{content}</span></div>
                    }
                    if (/^[-\u2022]\s/.test(trimmed)) {
                      const content = trimmed.replace(/^[-\u2022]\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                      return <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '3px', paddingLeft: '4px' }}><span style={{ color: accentColor, fontSize: '8px', marginTop: '5px' }}>●</span><span>{content}</span></div>
                    }
                    return <div key={idx}>{trimmed.replace(/\*\*([^*]+)\*\*/g, (_, t) => t)}</div>
                  })}
                </div>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>
                  Full analysis text not available. <button onClick={() => { setViewingAnalysisIdx(null); handleAnalyze(true) }} disabled={analyzing} style={{ color: '#E88C5C', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600, fontSize: '13px' }}>
                    {analyzing ? 'Loading...' : 'Load from saved transcript'}
                  </button>
                </div>
              )}

              {/* Modal footer actions */}
              {!sentAlert && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', gap: '8px' }}>
                  <button
                    onClick={() => { setViewingAnalysisIdx(null); handlePreviewPdf() }}
                    disabled={previewLoading}
                    style={{
                      background: 'var(--palm-pink)', border: 'none', borderRadius: '6px',
                      padding: '8px 16px', fontSize: '12px', color: '#060606', fontWeight: 600,
                      cursor: previewLoading ? 'not-allowed' : 'pointer', opacity: previewLoading ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', gap: '5px',
                    }}>
                    <span style={{ fontSize: '14px' }}>&#9993;</span> Send to Chat Manager
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Send to Chat Manager preview modal */}
      {showSendModal && (
        <div
          onClick={() => !sending && setShowSendModal(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--card-bg-solid)', borderRadius: '12px', padding: '24px',
              maxWidth: '700px', width: '90vw', maxHeight: '85vh', overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>Send Whale Alert</div>
                <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', marginTop: '2px' }}>
                  PDF will be sent to the <strong>{creatorName}</strong> topic in Telegram
                </div>
              </div>
              <button onClick={() => setShowSendModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--foreground-muted)', cursor: 'pointer', padding: '4px' }}>&times;</button>
            </div>

            {/* PDF Preview */}
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '12px', marginBottom: '16px', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {previewLoading && (
                <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Generating PDF preview...</div>
              )}
              {previewImage && (
                <img src={previewImage} alt="Whale Alert PDF Preview" style={{ width: '100%', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
              )}
              {!previewLoading && !previewImage && sendResult?.error && (
                <div style={{ fontSize: '12px', color: '#E87878' }}>{sendResult.error}</div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSendModal(false)}
                disabled={sending}
                style={{
                  background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: '6px',
                  padding: '8px 16px', fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={handleSendToTelegram}
                disabled={sending || previewLoading || !previewImage || sendResult?.success}
                style={{
                  background: sendResult?.success ? '#7DD3A4' : 'rgba(255,255,255,0.08)',
                  border: 'none', borderRadius: '6px',
                  padding: '8px 16px', fontSize: '12px', color: 'var(--foreground)', fontWeight: 600,
                  cursor: (sending || previewLoading || !previewImage || sendResult?.success) ? 'not-allowed' : 'pointer',
                  opacity: (sending || previewLoading || !previewImage) && !sendResult?.success ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ fontSize: '14px' }}>{sendResult?.success ? '\u2713' : '\u2709'}</span>
                {sending ? 'Sending...' : sendResult?.success ? 'Sent' : 'Confirm & Send'}
              </button>
            </div>

            {sendResult?.success && !sendResult.trackerError && (
              <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(125, 211, 164, 0.06)', border: '1px solid transparent', borderRadius: '6px', fontSize: '12px', color: '#7DD3A4', textAlign: 'center' }}>
                &#10003; Sent to manager &amp; logged
              </div>
            )}
            {sendResult?.success && sendResult.trackerError && (
              <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(232, 200, 120, 0.06)', border: '1px solid rgba(232, 200, 120, 0.25)', borderRadius: '6px', fontSize: '12px', color: '#E8A878' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>&#10003; Sent to Telegram &mdash; but Fan Tracker log failed</div>
                <div style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>{sendResult.trackerError}</div>
                <div style={{ fontSize: '11px', marginTop: '6px' }}>The fan's Alert column won't update. Please share this error so we can fix it.</div>
              </div>
            )}
            {sendResult?.error && (
              <div style={{ marginTop: '12px', padding: '8px 12px', background: 'rgba(232, 120, 120, 0.08)', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#E87878' }}>
                {sendResult.error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Compute fan heat status from transaction data ──────────────────────────
// Returns { status, detail } where detail has context for cold/cooling fans
function computeHeatStatus(fanTxns) {
  const stable = { status: 'Stable', detail: null }
  if (!fanTxns || fanTxns.length < 3) return stable

  const now = new Date()
  const sorted = fanTxns.filter(t => t.date).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return stable

  const lastTxnDate = new Date(sorted[sorted.length - 1].date + 'T12:00:00')
  const currentGap = Math.floor((now - lastTxnDate) / 86400000)

  // Compute median purchase gap
  const gaps = []
  for (let i = 1; i < sorted.length; i++) {
    const g = Math.floor((new Date(sorted[i].date + 'T12:00:00') - new Date(sorted[i - 1].date + 'T12:00:00')) / 86400000)
    if (g > 0) gaps.push(g)
  }
  gaps.sort((a, b) => a - b)
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 14

  // Compute rolling spend windows
  const d30 = new Date(now - 30 * 86400000)
  const d60 = new Date(now - 60 * 86400000)
  const d90 = new Date(now - 90 * 86400000)
  const rolling30 = sorted.filter(t => new Date(t.date) >= d30).reduce((s, t) => s + (t.net || 0), 0)
  const rolling30Prev = sorted.filter(t => { const d = new Date(t.date); return d >= d60 && d < d30 }).reduce((s, t) => s + (t.net || 0), 0)
  const rolling90 = sorted.filter(t => new Date(t.date) >= d90).reduce((s, t) => s + (t.net || 0), 0)
  const monthlyAvg90 = rolling90 / 3
  const lifetime = sorted.reduce((s, t) => s + (t.net || 0), 0)

  // Find peak spending month and when drop started (for cold/cooling context)
  const moSpend = {}
  for (const t of sorted) {
    const mo = t.date.slice(0, 7)
    moSpend[mo] = (moSpend[mo] || 0) + (t.net || 0)
  }
  const months = Object.entries(moSpend).sort(([a], [b]) => a.localeCompare(b))
  let peakMonth = null, peakSpend = 0
  for (const [mo, spend] of months) {
    if (spend > peakSpend) { peakSpend = spend; peakMonth = mo }
  }

  // Lifetime monthly average — span from first purchase to today.
  // Better baseline than rolling90 for cooling detection: a fan who peaked
  // and then cooled has a depressed rolling90 that masks the decline.
  const firstTxn = sorted[0]
  const firstDate = new Date(firstTxn.date + 'T12:00:00')
  const monthsActive = Math.max(1, (now - firstDate) / (86400000 * 30))
  const lifetimeMonthlyAvg = lifetime / monthsActive
  // Find where spending started dropping (first month after peak that's < 50% of peak)
  let dropMonth = null
  if (peakMonth) {
    let pastPeak = false
    for (const [mo, spend] of months) {
      if (mo === peakMonth) { pastPeak = true; continue }
      if (pastPeak && spend < peakSpend * 0.5) { dropMonth = mo; break }
    }
  }
  const moNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const fmtMo = (mo) => { if (!mo) return ''; const [y, m] = mo.split('-'); return `${moNames[parseInt(m) - 1]} ${y}` }
  const lastPurchase = sorted[sorted.length - 1].date

  const buildDetail = (reason) => ({
    currentGap,
    medianGap,
    rolling30: Math.round(rolling30),
    monthlyAvg90: Math.round(monthlyAvg90),
    lastPurchase,
    peakMonth: fmtMo(peakMonth),
    peakSpend: Math.round(peakSpend),
    dropMonth: fmtMo(dropMonth),
    reason,
    // Suggest chat window to analyze: from 2 weeks before drop (or peak) to last purchase
    analyzeFrom: dropMonth ? dropMonth + '-01' : (peakMonth ? peakMonth + '-01' : null),
  })

  // Need minimum spend to classify
  if (lifetime < 50) return stable

  // Baseline = max of lifetime monthly avg and 90d avg.
  // Using lifetime avg catches fans who peaked and cooled — their rolling90
  // gets dragged down by recent dead months, making a small tick look "hot"
  // relative to the depressed window. Lifetime average anchors to their
  // actual historical norm.
  const baseline = Math.max(lifetimeMonthlyAvg, monthlyAvg90)

  // Dead: no activity in 90+ days
  if (currentGap > 90) return { status: 'Dead', detail: buildDetail(`No purchases in ${currentGap} days`) }

  // NOTE: "Going Cold" is intentionally NOT assigned here. That state is owned
  // by the server-side detectGoingCold() scoring system (goingColdAlerts from
  // the earnings API). The overlay in allFans() forces heatStatus = "Going Cold"
  // for any fan the server flagged. Keeping this function from independently
  // classifying Going Cold prevents the Fans CRM and the Earnings tab's
  // Going Cold panel from ever disagreeing — one source of truth.

  // Cooling: gap > 1.5x median (min 10d) OR 30d spend < 50% of historical baseline
  if ((currentGap > medianGap * 1.5 && currentGap >= 10) ||
      (baseline > 0 && rolling30 < baseline * 0.5)) {
    const reason = currentGap > medianGap * 1.5
      ? `${currentGap}d gap (${medianGap}d median)`
      : `Spending trending down — $${Math.round(rolling30)} last 30d vs $${Math.round(baseline)}/mo historical avg`
    return { status: 'Cooling', detail: buildDetail(reason) }
  }

  // Warming Up: spend rebounding after a depressed period, but still
  // below peak — "coming back but not there yet."
  if (rolling30Prev > 0 && rolling30 > rolling30Prev * 1.5 && rolling30Prev < baseline * 0.5 && rolling30 < peakSpend * 0.75) {
    return { status: 'Warming Up', detail: null }
  }
  if (currentGap < 7 && gaps.length > 3) {
    const recentGaps = gaps.slice(-3)
    const avgRecentGap = recentGaps.reduce((a, b) => a + b, 0) / recentGaps.length
    if (avgRecentGap > medianGap * 1.5 && currentGap < medianGap && rolling30 < peakSpend * 0.75) {
      return { status: 'Warming Up', detail: null }
    }
  }

  // Hot: spending at/near peak with tight gaps. Compares to PEAK monthly,
  // not rolling90 — so a fan who cooled and has one small upswing isn't
  // called Hot just because the recent baseline is also depressed.
  if (peakSpend > 0 && rolling30 >= peakSpend * 0.75 && currentGap < medianGap * 1.2) {
    return { status: 'Hot', detail: null }
  }
  // Absolute-spend Hot: big spender in the last week, regardless of history
  if (rolling30 > 500 && currentGap < 7) return { status: 'Hot', detail: null }

  return stable
}

const HEAT_CONFIG = {
  'Dead':       { emoji: '💀', color: '#6B7280', label: 'Dead — no activity 90+ days' },
  'Going Cold': { emoji: '🥶', color: '#3B82F6', label: 'Going Cold — purchase gap or spend drop' },
  'Cooling':    { emoji: '❄️', color: '#93C5FD', label: 'Cooling — spending trending down' },
  'Stable':     { emoji: '😐', color: '#84CC16', label: 'Stable — normal spending pattern' },
  'Warming Up': { emoji: '🔥', color: '#F59E0B', label: 'Warming Up — spending increasing' },
  'Hot':        { emoji: '🔥', color: '#EF4444', label: 'Hot — above average spending' },
}

// Sort order reflects whale-hunting urgency: actionable fans first, already-lost last.
// Going Cold = actively cooling NOW, needs intervention → top.
// Cooling = trending down but not critical yet.
// Dead = 90+ days silent, already lost — ranked below actionable states.
// Stable = baseline, no action needed.
// Hot / Warming Up = performing well, rank last (don't prioritize what's working).
const HEAT_SORT_ORDER = { 'Going Cold': 0, 'Cooling': 1, 'Dead': 2, 'Stable': 3, 'Warming Up': 4, 'Hot': 5 }

// Surfaced at module scope so both FanRow and FansPanel can reference.
export const ALERT_STATUS_COLORS = {
  'None': { bg: 'rgba(255,255,255,0.04)', text: '#9CA3AF' },
  'Alert Triggered': { bg: 'rgba(232, 120, 120, 0.12)', text: '#E87878' },
  'Fan Analyzed': { bg: 'rgba(167, 139, 250, 0.1)', text: '#A78BFA' },
  'Sent to Manager': { bg: 'rgba(232, 200, 120, 0.08)', text: '#E8A878' },
  'Manager Received': { bg: 'rgba(59,130,246,0.12)', text: '#78B4E8' },
  'Action Taken': { bg: 'rgba(125, 211, 164, 0.08)', text: '#7DD3A4' },
  'Banned': { bg: '#1F2937', text: 'var(--foreground)' },
}

// Urgency colors for Alert Triggered — so Critical visually pops in lists.
const URGENCY_COLORS = {
  critical: { bg: 'rgba(232, 120, 120, 0.18)', text: '#E87878' },
  high: { bg: 'rgba(232, 168, 120, 0.12)', text: '#E8A878' },
  warning: { bg: 'rgba(232, 200, 120, 0.12)', text: '#E8C878' },
}

function FansPanel({ creator, allTxns, goingColdAlerts, availableAccounts, focusFan, focusNonce, auditTiers }) {
  const [crmData, setCrmData] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [showAllFans, setShowAllFans] = useState(false)
  const searchParams = useSearchParams()
  const handledFanTarget = useRef('')
  const [modalFanId, setModalFanId] = useState(null)
  // Keep the open fan in the URL so a refresh restores exactly where you were
  // (?fan=<username or name>; the mount effect below reopens it).
  const openFanModal = (mf) => {
    setModalFanId(mf ? mf.id : null)
    try {
      const params = new URLSearchParams(window.location.search)
      if (mf) params.set('fan', mf.ofUsername || mf.fanName || '')
      else params.delete('fan')
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
    } catch { /* SSR/no window */ }
  }
  const [sortField, setSortField] = useState(null) // 'lifetime' | 'last30' | 'txns' | 'lastDate'
  const [sortDir, setSortDir] = useState('desc')
  const [showDeleted, setShowDeleted] = useState(false)
  const [showBanned, setShowBanned] = useState(false)
  const [accountFilter, setAccountFilter] = useState('all')
  const [showTop20, setShowTop20] = useState(false)

  const creatorName = creator?.name || creator?.aka || ''  // full legal name — for Airtable lookups, Dropbox paths
  const creatorAka = creator?.aka || creator?.name || ''   // stage name — shown in AI output to chatters
  const creatorRecordId = creator?.id || ''

  // Fetch CRM data (analyses + tracker records)
  useEffect(() => {
    setLoading(true)
    const aka = creator?.aka || ''
    const full = creator?.name || ''
    const params = new URLSearchParams()
    if (aka) params.set('creator', aka)
    if (full) params.set('creatorFull', full)
    fetch(`/api/admin/fan-tracker?${params}`)
      .then(r => r.json())
      .then(data => { setCrmData(data.fans || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [creator?.id])

  // Map CRM status → alert status display
  const crmToAlertStatus = (crmStatus) => {
    const map = {
      // NOTE: 'Going Cold' intentionally NOT in this map.
      // "Alert Triggered" is reserved for fans currently flagged by the scoring
      // system (via the goingColdAlerts overlay in allFans). Historical CRM
      // records with 'Going Cold' status should no longer surface as active
      // alerts — if the fan is past the 120-day window or the scoring no longer
      // flags them, their Alert column should be empty.
      'Analyzed': 'Fan Analyzed',
      'Alert Sent': 'Sent to Manager',
      'Recovering': 'Sent to Manager',
      'Monitoring': 'Sent to Manager',
      'Reactivated': 'Action Taken',
      'Lost': 'Action Taken',
      'Banned': 'Banned',
    }
    return map[crmStatus] || 'None'
  }

  // Build comprehensive fan list from allTxns + CRM data + going cold alerts
  const allFansBase = useMemo(() => {
    const fanMap = new Map() // keyed by ofUsername or displayName
    const fanTxnMap = new Map() // accumulate per-fan transactions for heat computation

    // 1. Build from transaction data — every fan who's spent money
    if (allTxns && Array.isArray(allTxns)) {
      const thirtyAgo = new Date()
      thirtyAgo.setDate(thirtyAgo.getDate() - 30)
      const thirtyAgoStr = thirtyAgo.toISOString().split('T')[0]
      const sixMoAgo = new Date(); sixMoAgo.setDate(sixMoAgo.getDate() - 180)
      const sixMoAgoStr = sixMoAgo.toISOString().split('T')[0]

      for (const t of allTxns) {
        // Accept ALL transaction types for account membership tracking,
        // but only count real purchases toward spend/heat metrics.
        const key = (t.ofUsername || t.displayName || 'Unknown').toLowerCase()
        if (key === 'unknown') continue
        const isReal = isRealPurchase(t)
        if (!isReal && !fanMap.has(key)) {
          // Fan has only subscription/chargeback txns so far — record account membership
          // but don't create a full fan entry yet (wait for a real purchase).
          // Actually we do want to show them on account filter even if no purchases —
          // so we create the entry but their spend numbers stay at 0.
        }
        if (!fanMap.has(key)) {
          fanMap.set(key, {
            id: `txn-${key}`,
            fanName: t.displayName || key,
            ofUsername: t.ofUsername || '',
            lifetimeSpend: 0,
            last30: 0,
            last180: 0,
            txnCount: 0,
            lastDate: '',
            firstDate: '',
            heatStatus: 'Stable',
            alertStatus: 'None',
            alertCount: 0,
            alertHistory: [],
            analysisRecords: [],
            effectiveness: '',
            preAlertSpend30d: 0,
            postAlertSpend30d: 0,
            firstFlagged: null,
            lastAlertSent: null,
            timesGoneCold: 0,
            lastChatUpload: null,
            notes: '',
            source: 'transactions',
            accounts: new Set(),
          })
          fanTxnMap.set(key, [])
        }
        const fan = fanMap.get(key)
        // Always record identity + account membership
        if (t.displayName) fan.fanName = t.displayName
        if (!fan.ofUsername && t.ofUsername) fan.ofUsername = t.ofUsername
        if (t.account) fan.accounts.add(t.account)
        // Paid subs are real money — count toward LIFETIME (matches the whale
        // audit, which is why the Save List said $1,301 while this said $275)
        // but never toward cadence/heat math (renewals are passive).
        if (!isReal) {
          if (!/chargeback/i.test(t.type || '') && (t.net || 0) > 0) fan.lifetimeSpend += t.net || 0
          continue
        }
        fan.lifetimeSpend += t.net || 0
        fan.txnCount += 1
        if (!fan.lastDate || t.date > fan.lastDate) fan.lastDate = t.date
        if (!fan.firstDate || t.date < fan.firstDate) fan.firstDate = t.date
        if (t.date >= thirtyAgoStr) fan.last30 += t.net || 0
        if (t.date >= sixMoAgoStr) fan.last180 += t.net || 0
        fanTxnMap.get(key).push(t)
      }
    }

    // 1b. Compute heat status for each fan from their transactions
    for (const [key, fan] of fanMap) {
      const heat = computeHeatStatus(fanTxnMap.get(key) || [])
      fan.heatStatus = heat.status
      fan.heatDetail = heat.detail
    }

    // 2. Overlay CRM data FIRST (so cooldown + ban info is available for step 3)
    for (const c of crmData) {
      const key = (c.ofUsername || c.fanName || '').toLowerCase()
      if (!key) continue
      if (fanMap.has(key)) {
        const f = fanMap.get(key)
        const mapped = crmToAlertStatus(c.status)
        if (mapped !== 'None') f.alertStatus = mapped
        if (c.alertCount > 0) { f.alertCount = c.alertCount }
        if (c.alertHistory) f.alertHistory = c.alertHistory
        if (c.analysisRecords && c.analysisRecords.length > 0) {
          f.analysisRecords = c.analysisRecords
          if (f.alertStatus === 'None') f.alertStatus = 'Fan Analyzed'
        }
        // The tracker's Lifetime Spend is fed by OF's own fanData total (via
        // webhook) and the audit — it sees money our sheet buckets miss when a
        // fan's rename-split rows lack a username. Take the higher figure.
        if ((c.lifetimeSpend || 0) > f.lifetimeSpend) f.lifetimeSpend = c.lifetimeSpend
        f.effectiveness = c.effectiveness || f.effectiveness
        f.preAlertSpend30d = c.preAlertSpend30d || f.preAlertSpend30d
        f.postAlertSpend30d = c.postAlertSpend30d || f.postAlertSpend30d
        f.firstFlagged = c.firstFlagged || f.firstFlagged
        f.lastAlertSent = c.lastAlertSent || f.lastAlertSent
        f.timesGoneCold = c.timesGoneCold || f.timesGoneCold
        f.lastChatUpload = c.lastChatUpload || f.lastChatUpload
        f.notes = c.notes || f.notes
        f.lifetimeOverride = c.lifetimeOverride || null // manual PDF/Telegram lifetime override
        // Only carry over REAL tracker record IDs (synthetic "analysis-XXX" IDs from the
        // fan-tracker GET endpoint aren't patchable — leave crmId null in that case so the
        // POST handler knows to upsert by fan identity instead.
        f.crmId = (c.id && !c.id.startsWith('analysis-')) ? c.id : null
        f.banned = c.status === 'Banned'
      } else {
        // CRM-only record (no transactions)
        const mapped = crmToAlertStatus(c.status)
        fanMap.set(key, {
          ...c, id: c.id, txnCount: 0, last30: 0, last180: 0, lastDate: '', firstDate: '',
          source: 'crm', heatStatus: 'Stable',
          alertStatus: mapped !== 'None' ? mapped : 'Fan Analyzed',
          banned: c.status === 'Banned',
          crmId: (c.id && !c.id.startsWith('analysis-')) ? c.id : null,
          lifetimeOverride: c.lifetimeOverride || null,
        })
      }
    }

    // 3. Overlay going cold alerts — AFTER CRM data so we can check cooldown + ban.
    // Suppresses alerts for fans who were recently sent to manager (14-day cooldown)
    // or banned (never alert, never visible by default).
    const now = new Date()
    const COOLDOWN_DAYS = 14
    if (goingColdAlerts) {
      for (const a of goingColdAlerts) {
        const key = (a.username || a.fan || '').toLowerCase()
        if (!key) continue
        if (!fanMap.has(key)) continue
        const f = fanMap.get(key)
        if (f.banned) continue // never flag banned fans
        // Cooldown: if "Sent to Manager" fired within last 14 days, suppress re-alert
        if (f.lastAlertSent) {
          const daysSince = (now - new Date(f.lastAlertSent)) / 86400000
          if (daysSince < COOLDOWN_DAYS) continue
        }
        f.heatStatus = 'Going Cold'
        f.goingCold = a // attach full alert data (includes urgency, score, reasons)
        // Only set alertStatus to "Alert Triggered" if nothing newer is set
        // (don't overwrite Fan Analyzed / Sent to Manager / Action Taken)
        if (f.alertStatus === 'None') f.alertStatus = 'Alert Triggered'
      }
    }

    // Sort: most urgent first.
    // Within Going Cold tier, sort by urgency (critical → high → warning) then by lifetime.
    // Rationale: whale hunting = find biggest at-risk fans first.
    const alertOrder = { 'Alert Triggered': 0, 'Sent to Manager': 1, 'Fan Analyzed': 2, 'Action Taken': 3, 'None': 4 }
    const urgencyOrder = { critical: 0, high: 1, warning: 2 }
    return Array.from(fanMap.values())
      .map(f => ({ ...f, accounts: f.accounts instanceof Set ? Array.from(f.accounts) : (f.accounts || []) }))
      .filter(f => f.lifetimeSpend > 0 || f.analysisRecords?.length > 0 || f.alertCount > 0)
      .sort((a, b) => {
        const ho = (HEAT_SORT_ORDER[a.heatStatus] ?? 4) - (HEAT_SORT_ORDER[b.heatStatus] ?? 4)
        if (ho !== 0) return ho
        // Within same heat tier: urgency first if going cold
        if (a.heatStatus === 'Going Cold') {
          const au = urgencyOrder[a.goingCold?.urgency] ?? 99
          const bu = urgencyOrder[b.goingCold?.urgency] ?? 99
          if (au !== bu) return au - bu
        }
        const ao = (alertOrder[a.alertStatus] ?? 99) - (alertOrder[b.alertStatus] ?? 99)
        if (ao !== 0) return ao
        return (b.lifetimeSpend || 0) - (a.lifetimeSpend || 0)
      })
  }, [allTxns, crmData, goingColdAlerts])

  // ── ONE BRAIN: when the whale audit has a verdict for a fan, it OVERRIDES
  // the CRM's own heat math — the Save List above and this list must never
  // disagree (Evan, 2026-07-04). Fans the audit didn't flag show as plain
  // history (no competing 'Going Cold'/'Dead' from the legacy detectors).
  const allFans = useMemo(() => {
    if (!auditTiers || !Object.keys(auditTiers).length) return allFansBase
    return allFansBase.map((fBase) => {
      const cad = auditTiers[(fBase.ofUsername || fBase.fanName || '').toLowerCase()]
      // Carry the OF fan id from the audit (sheet column J) — dormant/deleted
      // fans often have no username, and the id lets Pull from OF work anyway.
      const f = cad?.fanId && !fBase.fanId ? { ...fBase, fanId: cad.fanId } : fBase
      if (!cad?.tier) {
        return (f.heatStatus === 'Going Cold' || f.heatStatus === 'Dead')
          ? { ...f, heatStatus: 'Stable', heatDetail: null, goingCold: null }
          : f
      }
      const detail = {
        reason: cad.medianGap ? `buys every ~${cad.medianGap}d — silent ${cad.currentGap}d (${cad.gapRatio}×)` : `silent ${cad.currentGap ?? '—'}d`,
        currentGap: cad.currentGap, medianGap: cad.medianGap,
        rolling30: cad.rolling30, monthlyAvg90: cad.monthlyAvg90,
        lastPurchase: cad.lastPurchaseDate,
      }
      if (cad.tier === 'dead') return { ...f, heatStatus: 'Dead', goingCold: null, heatDetail: detail, liveSignals: cad.live || null }
      return {
        ...f,
        liveSignals: cad.live || null,
        heatStatus: 'Going Cold',
        goingCold: { ...(f.goingCold || {}), urgency: cad.tier, medianGap: cad.medianGap, currentGap: cad.currentGap, rolling30: cad.rolling30, monthlyAvg90: cad.monthlyAvg90, lastPurchaseDate: cad.lastPurchaseDate },
        heatDetail: detail,
      }
    })
  }, [allFansBase, auditTiers])

  const alertStatusColors = ALERT_STATUS_COLORS

  const effectColors = {
    'Worked': { bg: 'rgba(125, 211, 164, 0.08)', text: '#7DD3A4' },
    'Didn\'t Work': { bg: 'rgba(232, 120, 120, 0.12)', text: '#E87878' },
    'Too Early': { bg: 'rgba(232, 200, 120, 0.08)', text: '#E8C878' },
    'Pending': { bg: 'rgba(255,255,255,0.04)', text: '#6B7280' },
  }

  const deletedCount = useMemo(() => allFans.filter(f => !f.ofUsername).length, [allFans])

  // Focus a specific fan (from the whale watchlist button or a ?fan= deep
  // link): expand that fan's card and scroll it into view once the list is
  // ready. Re-fires whenever the target changes.
  useEffect(() => {
    if (!allFans.length) return
    const target = (focusFan || searchParams?.get('fan') || '').toLowerCase()
    if (!target) return
    // Stamp includes the click nonce — re-clicking the SAME fan must reopen
    // the modal (the old target-only guard blocked every repeat click).
    const stamp = `${target}#${focusNonce ?? 0}`
    if (stamp === handledFanTarget.current) return
    const match = allFans.find(f => (f.ofUsername || '').toLowerCase() === target)
      || allFans.find(f => (f.fanName || '').toLowerCase() === target)
    if (!match) return
    handledFanTarget.current = stamp
    setModalFanId(match.id) // modal, not scroll-and-hunt (per Evan)
  }, [allFans, searchParams, focusFan, focusNonce])

  // Top 20% spend threshold
  const top20Threshold = useMemo(() => {
    const spends = allFans.filter(f => f.lifetimeSpend > 0).map(f => f.lifetimeSpend).sort((a, b) => b - a)
    if (spends.length === 0) return 0
    const idx = Math.max(0, Math.ceil(spends.length * 0.2) - 1)
    return spends[idx] || 0
  }, [allFans])

  const filtered = useMemo(() => {
    let list = allFans.filter(f => {
      // Hide deleted accounts by default
      if (!showDeleted && !f.ofUsername) return false
      if (!showBanned && f.banned) return false
      // Account filter
      // Account filter: 'all' = everyone, 'both' = fans on 2+ accounts, specific = fans ONLY on that account
      if (accountFilter === 'both') {
        if (!f.accounts || f.accounts.length < 2) return false
      } else if (accountFilter !== 'all') {
        if (!f.accounts || !f.accounts.includes(accountFilter) || f.accounts.length > 1) return false
      }
      // Top 20% overrides heat/alert filters
      if (showTop20) return f.lifetimeSpend >= top20Threshold && top20Threshold > 0
      if (filter === 'active_alerts') return f.alertStatus !== 'None'
      if (filter === 'dead') return f.heatStatus === 'Dead'
      if (filter === 'going_cold') return f.heatStatus === 'Going Cold'
      if (filter === 'cooling') return f.heatStatus === 'Cooling'
      if (filter === 'stable') return f.heatStatus === 'Stable'
      if (filter === 'warming_up') return f.heatStatus === 'Warming Up'
      if (filter === 'hot') return f.heatStatus === 'Hot'
      return true
    })
    if (sortField) {
      list = [...list].sort((a, b) => {
        let av, bv
        if (sortField === 'lifetime') { av = a.lifetimeSpend || 0; bv = b.lifetimeSpend || 0 }
        else if (sortField === 'last30') { av = a.last30 || 0; bv = b.last30 || 0 }
        else if (sortField === 'moAvg6') { av = (a.last180 || 0) / 6; bv = (b.last180 || 0) / 6 }
        else if (sortField === 'txns') { av = a.txnCount || 0; bv = b.txnCount || 0 }
        else if (sortField === 'lastDate') { av = a.lastDate || ''; bv = b.lastDate || '' }
        else return 0
        if (sortField === 'lastDate') return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv)
        return sortDir === 'desc' ? bv - av : av - bv
      })
    }
    return list
  }, [allFans, filter, sortField, sortDir, showDeleted, showBanned, accountFilter, showTop20, top20Threshold])

  const bannedCount = useMemo(() => allFans.filter(f => f.banned).length, [allFans])

  // Compute counts per heat status
  const heatCounts = {}
  for (const f of allFans) {
    heatCounts[f.heatStatus] = (heatCounts[f.heatStatus] || 0) + 1
  }
  const activeAlertCount = allFans.filter(f => f.alertStatus !== 'None').length
  const displayFans = showAllFans ? filtered : filtered.slice(0, 25)

  function toggleSort(field) {
    if (sortField === field) {
      if (sortDir === 'desc') setSortDir('asc')
      else { setSortField(null); setSortDir('desc') } // third click resets
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  function fmtMoney(n) {
    if (!n && n !== 0) return '—'
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  if (loading && (!allTxns || allTxns.length === 0)) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ width: '24px', height: '24px', border: '1px solid transparent', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Loading fans...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Fan CRM</h3>
          <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '2px 0 0' }}>
            {allFans.length} fan{allFans.length !== 1 ? 's' : ''}
            {(heatCounts['Going Cold'] || 0) + (heatCounts['Dead'] || 0) > 0 && (
              <span style={{ color: '#E87878', fontWeight: 600 }}> &middot; {heatCounts['Going Cold'] || 0} need attention</span>
            )}
            {(heatCounts['Hot'] || 0) > 0 && <span style={{ color: '#EF4444', fontWeight: 600 }}> &middot; {heatCounts['Hot']} hot</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {[
            ['all', `All`, null],
            ['hot', `🔥 Hot`, heatCounts['Hot']],
            ['warming_up', `🔥 Warming`, heatCounts['Warming Up']],
            ['stable', `😐 Stable`, heatCounts['Stable']],
            ['cooling', `❄️ Cooling`, heatCounts['Cooling']],
            ['going_cold', `🥶 Cold`, heatCounts['Going Cold']],
            ['dead', `💀 Dead`, heatCounts['Dead']],
            ['active_alerts', `⚡ Alerts`, activeAlertCount],
          ].filter(([, , count]) => count === null || count > 0).map(([key, label, count]) => (
            <button key={key} onClick={() => { setFilter(filter === key ? 'all' : key); setShowTop20(false) }}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: filter === key ? 600 : 400,
                background: filter === key ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)', color: filter === key ? 'var(--foreground)' : 'rgba(240, 236, 232, 0.75)',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
              }}>
              {label}{count != null ? ` (${count})` : ''}
            </button>
          ))}
          <button onClick={() => { setShowTop20(!showTop20); if (!showTop20) setFilter('all') }}
            style={{
              padding: '3px 8px', fontSize: '10px', fontWeight: showTop20 ? 600 : 400,
              background: showTop20 ? '#F59E0B' : 'rgba(255,255,255,0.04)', color: showTop20 ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
            }}>
            💎 Top 20%
          </button>
          {deletedCount > 0 && (
            <button onClick={() => setShowDeleted(!showDeleted)}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: showDeleted ? 600 : 400,
                background: showDeleted ? '#6B7280' : 'transparent', color: showDeleted ? 'rgba(255,255,255,0.08)' : 'var(--foreground-muted)',
                border: '1px dashed #ccc', borderRadius: '4px', cursor: 'pointer', marginLeft: '4px',
              }}>
              {showDeleted ? `Hide deleted (${deletedCount})` : `Show deleted (${deletedCount})`}
            </button>
          )}
          {bannedCount > 0 && (
            <button onClick={() => setShowBanned(!showBanned)}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: showBanned ? 600 : 400,
                background: showBanned ? '#1F2937' : 'transparent', color: showBanned ? 'rgba(255,255,255,0.08)' : 'var(--foreground-muted)',
                border: '1px dashed #ccc', borderRadius: '4px', cursor: 'pointer', marginLeft: '4px',
              }}>
              {showBanned ? `Hide banned (${bannedCount})` : `Show banned (${bannedCount})`}
            </button>
          )}
          {availableAccounts && availableAccounts.length > 1 && (
            <>
              <span style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.08)', margin: '0 4px', alignSelf: 'center' }} />
              {['all', ...availableAccounts, 'both'].map(a => (
                <button key={a} onClick={() => setAccountFilter(accountFilter === a ? 'all' : a)}
                  style={{
                    padding: '3px 8px', fontSize: '10px', fontWeight: accountFilter === a ? 600 : 400,
                    background: accountFilter === a ? '#A78BFA' : 'rgba(255,255,255,0.04)', color: accountFilter === a ? 'rgba(255,255,255,0.08)' : 'rgba(240, 236, 232, 0.75)',
                    border: 'none', borderRadius: '4px', cursor: 'pointer',
                  }}>
                  {a === 'all' ? 'All Accts' : a === 'both' ? 'Both' : a}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px', background: 'var(--card-bg-solid)', borderRadius: '10px' }}>
          No fans match this filter.
        </div>
      ) : (
        <div style={{ background: 'var(--card-bg-solid)', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 32px 100px 90px 80px 80px 80px 90px', padding: '8px 16px', fontSize: '9px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', borderBottom: '1px solid transparent' }}>
            <span></span><span>Fan</span><span title="Heat Status">🌡️</span><span>Alert</span>
            {[['lifetime', 'Lifetime'], ['moAvg6', '$/mo (6m)'], ['last30', 'Last 30d'], ['txns', 'Txns'], ['lastDate', 'Last Active']].map(([key, label]) => (
              <span key={key} onClick={() => toggleSort(key)} style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}>
                {label}{sortField === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </span>
            ))}
          </div>
          {displayFans.map((f, i) => (
            <FanRow key={f.id} f={f} i={i} isExpanded={false}
              onToggle={() => openFanModal(f)}
              alertStatusColors={alertStatusColors} effectColors={effectColors}
              fmtDate={fmtDate} fmtMoney={fmtMoney} setFans={setCrmData}
              creatorName={creatorName} creatorAka={creatorAka} creatorRecordId={creatorRecordId}
              allTxns={allTxns} availableAccounts={availableAccounts} />
          ))}
          {filtered.length > 25 && !showAllFans && (
            <button onClick={() => setShowAllFans(true)}
              style={{ width: '100%', padding: '10px', background: 'var(--card-bg-solid)', border: 'none', borderTop: '1px solid transparent', cursor: 'pointer', fontSize: '12px', color: 'var(--palm-pink)', fontWeight: 600 }}>
              Show all {filtered.length} fans
            </button>
          )}
        </div>
      )}

      {/* ── Fan modal — opened from the whale watchlist ("view fan") or a
             ?fan= deep link. Renders the SAME FanRow, expanded, in an overlay
             instead of scrolling the page down and hunting for the row. ── */}
      {modalFanId && (() => {
        const mf = allFans.find(x => x.id === modalFanId)
        if (!mf) return null
        // Prev/next steps through the CURRENT filtered+sorted list
        const idx = filtered.findIndex(x => x.id === modalFanId)
        const prev = idx > 0 ? filtered[idx - 1] : null
        const next = idx >= 0 && idx < filtered.length - 1 ? filtered[idx + 1] : null
        const navBtn = (fan, label) => (
          <button disabled={!fan} onClick={() => fan && openFanModal(fan)}
            {...(label.includes('prev') ? { 'data-kb-prev': '' } : { 'data-kb-next': '' })}
            title={fan ? `${fan.fanName}` : ''}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '3px 10px', fontSize: '12px', fontWeight: 700, color: fan ? 'var(--foreground)' : 'rgba(255,255,255,0.15)', cursor: fan ? 'pointer' : 'default' }}>{label}</button>
        )
        return (
          <div data-fan-modal onClick={() => openFanModal(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 20px' }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: 'var(--card-bg-solid)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', width: 'min(1000px, 100%)', maxHeight: '94vh', overflowY: 'auto', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: 'var(--card-bg-solid)', zIndex: 1 }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mf.fanName}{mf.ofUsername ? <span style={{ color: 'var(--palm-pink)', fontWeight: 400 }}> @{mf.ofUsername}</span> : null}
                  {idx >= 0 && <span style={{ color: 'var(--foreground-muted)', fontWeight: 400, fontSize: '11px' }}>  ·  {idx + 1} of {filtered.length}</span>}
                </span>
                {navBtn(prev, '‹ prev')}
                {navBtn(next, 'next ›')}
                <button data-kb-close onClick={() => openFanModal(null)}
                  style={{ background: 'none', border: 'none', fontSize: '20px', color: 'var(--foreground-muted)', cursor: 'pointer', padding: '2px 6px' }}>&times;</button>
              </div>
              <FanRow f={mf} i={0} isExpanded inModal onToggle={() => {}}
                alertStatusColors={alertStatusColors} effectColors={effectColors}
                fmtDate={fmtDate} fmtMoney={fmtMoney} setFans={setCrmData}
                creatorName={creatorName} creatorAka={creatorAka} creatorRecordId={creatorRecordId}
                allTxns={allTxns} availableAccounts={availableAccounts} />
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export { FansPanel }
export default FansPanel
