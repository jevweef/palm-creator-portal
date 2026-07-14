'use client'

// LIVE CHAT — OF-style two-pane view fed by the webhooks.
// Left: conversations (archived deep-pull fans + anyone with live activity).
// Right: the thread — archive history + live events, updating every 8s.

import { useState, useEffect, useRef, useMemo } from 'react'
import { useUser } from '@clerk/nextjs'

// Selection persists in the URL (?account=…&fan=…) — refresh/share keeps
// you on the same creator and conversation (same pattern as whale-hunting).
function fromUrl(key) {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get(key) || ''
}
function writeUrl(account, fan, view) {
  const params = new URLSearchParams(window.location.search)
  if (account) params.set('account', account); else params.delete('account')
  if (fan) params.set('fan', fan); else params.delete('fan')
  if (view !== undefined) { if (view && view !== 'inbox') params.set('tab', view); else params.delete('tab') }
  window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? '?' + params : ''}`)
}

// Everything money-facing shows NET (after OnlyFans' 20% cut) — Evan: "I
// don't really ever care about gross."
const net = (v) => (+v || 0) * 0.8

const ET = 'America/New_York'
const BUCKET_SIZES = [5, 15, 30, 60, 120, 240] // minutes
const GRAPH_PERIODS = [
  { key: 'day', label: 'Day', minutes: 1440 },
  { key: '2day', label: '2D', minutes: 2880 },
  { key: 'week', label: 'Week', minutes: 10080 },
  { key: 'month', label: 'Month', minutes: 43200 },
  { key: 'custom', label: 'Custom', minutes: null },
]
// Keep enough bars that the graph stays readable/squished — no 4h buckets on a
// single day (that'd be 6 bars), and no absurd counts on a month.
const MIN_BARS = 12
const MAX_BARS = 800
const readParam = (k) => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get(k) || '')
const bucketLabel = (m) => (m >= 60 ? `${m / 60}h` : `${m}m`)
const validBucketSizes = (minutes) => BUCKET_SIZES.filter((b) => { const n = minutes / b; return n >= MIN_BARS && n <= MAX_BARS })
function defaultBucketSize(minutes) {
  const v = validBucketSizes(minutes)
  const under = v.filter((b) => minutes / b <= 200) // most squished under ~200 bars
  return under[0] ?? v[v.length - 1] ?? 15
}

// Shared bar graph: day/week/month/custom periods × 5–240min buckets
// (constrained so you never get too few bars). Self-fetches the data window
// its period needs. Used by both the Sales tab (net $) and Outgoing tab
// (message counts). Right edge = now; bars scale to the SVG width, so more
// buckets = thinner, tightly-packed bars.
function BucketGraph({ urlKey, endpoint, dataKey, mapValue, color, label, fmtTotal, fmtBar, fmtAxis, creatorFilter = false }) {
  const [period, setPeriod] = useState(() => readParam(`${urlKey}Period`) || 'day')
  const [bucketPref, setBucketPref] = useState(() => Number(readParam(`${urlKey}Bucket`)) || 0)
  const [creator, setCreator] = useState(() => (creatorFilter ? readParam(`${urlKey}Creator`) : ''))
  const [customFrom, setCustomFrom] = useState(() => readParam(`${urlKey}From`))
  const [customTo, setCustomTo] = useState(() => readParam(`${urlKey}To`))
  const [events, setEvents] = useState([])

  const isCustom = period === 'custom' && customFrom && customTo
  const periodMinutes = isCustom
    ? Math.max(60, Math.round((new Date(`${customTo}T23:59:59`) - new Date(`${customFrom}T00:00:00`)) / 60000))
    : (GRAPH_PERIODS.find((p) => p.key === period)?.minutes || 1440)
  const valid = validBucketSizes(periodMinutes)
  const bucketMin = valid.includes(bucketPref) ? bucketPref : defaultBucketSize(periodMinutes)
  const BUCKET = bucketMin * 60000
  const N = Math.min(MAX_BARS, Math.max(1, Math.round(periodMinutes / bucketMin)))
  const end = isCustom ? Math.ceil(new Date(`${customTo}T23:59:59`).getTime() / BUCKET) * BUCKET : Math.ceil(Date.now() / BUCKET) * BUCKET
  const start = end - N * BUCKET

  // Fetch the window the period needs (day→2d … month→31d), poll every 60s.
  useEffect(() => {
    const days = Math.min(31, Math.ceil(periodMinutes / 1440) + 1)
    const load = () => fetch(`${endpoint}&days=${days}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => setEvents(j[dataKey] || [])).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [endpoint, dataKey, periodMinutes])

  // Persist controls in the URL (prefixed so the two graphs don't collide).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const set = (k, v) => { if (v) p.set(k, v); else p.delete(k) }
    set(`${urlKey}Period`, period === 'day' ? '' : period)
    set(`${urlKey}Bucket`, validBucketSizes(periodMinutes).includes(bucketPref) ? String(bucketPref) : '')
    set(`${urlKey}Creator`, creatorFilter ? creator : '')
    set(`${urlKey}From`, period === 'custom' ? customFrom : '')
    set(`${urlKey}To`, period === 'custom' ? customTo : '')
    window.history.replaceState(null, '', `${window.location.pathname}${p.toString() ? '?' + p : ''}`)
  }, [urlKey, period, bucketPref, creator, customFrom, customTo, creatorFilter, periodMinutes])

  const creatorOptions = creatorFilter ? [...new Set(events.map((e) => e.aka).filter(Boolean))].sort() : []
  const shown = creatorFilter && creator ? events.filter((e) => e.aka === creator) : events
  const buckets = Array(N).fill(0)
  for (const e of shown) {
    const t = new Date(e.at).getTime()
    if (isNaN(t) || t < start || t > end) continue
    buckets[Math.min(N - 1, Math.floor((t - start) / BUCKET))] += mapValue(e)
  }
  const max = Math.max(...buckets, 1)
  const total = buckets.reduce((a, b) => a + b, 0)
  const H = 220
  const shortSpan = periodMinutes <= 2 * 1440
  const step = Math.max(1, Math.round(N / 8))
  const ticks = []
  for (let i = 0; i <= N; i += step) {
    const d = new Date(start + i * BUCKET)
    ticks.push({ x: i, label: d.toLocaleString('en-US', shortSpan ? { timeZone: ET, weekday: 'short', hour: 'numeric' } : { timeZone: ET, month: 'short', day: 'numeric' }) })
  }
  const fmtBucketTime = (i) => new Date(start + i * BUCKET).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const ctrl = { background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '3px 8px', fontSize: '11px' }
  const changePeriod = (k) => { setPeriod(k); setBucketPref(0) }

  return (
    <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '14px 16px 6px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label} · {bucketLabel(bucketMin)} buckets</span>
          <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '2px' }}>
            {GRAPH_PERIODS.map((p) => (
              <button key={p.key} onClick={() => changePeriod(p.key)}
                style={{ padding: '3px 9px', fontSize: '11px', fontWeight: 700, borderRadius: '4px', border: 'none', cursor: 'pointer', background: period === p.key ? color : 'transparent', color: period === p.key ? '#0a0a0a' : 'var(--foreground-muted)' }}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={bucketMin} onChange={(e) => setBucketPref(Number(e.target.value))} style={ctrl}>
            {valid.map((b) => <option key={b} value={b}>{bucketLabel(b)}</option>)}
          </select>
          {period === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={ctrl} />
              <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={ctrl} />
            </>
          )}
          {creatorFilter && (
            <select value={creator} onChange={(e) => setCreator(e.target.value)} style={ctrl}>
              <option value="">All creators</option>
              {creatorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <span style={{ fontSize: '12px', fontWeight: 700, color }}>{fmtTotal(total)}</span>
      </div>
      {period === 'custom' && !isCustom ? (
        <div style={{ padding: '30px', textAlign: 'center', fontSize: '12px', color: 'var(--foreground-muted)' }}>Pick a start and end date.</div>
      ) : (
        <>
          <div style={{ position: 'relative' }}>
            <svg viewBox={`0 0 ${N} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: `${H}px`, display: 'block' }}>
              {buckets.map((v, i) => v > 0 && (
                <rect key={i} x={i + 0.12} y={H - (v / max) * (H - 14)} width={0.76} height={(v / max) * (H - 14)} fill={color} opacity="0.9">
                  <title>{`${fmtBucketTime(i)} ET — ${fmtBar(v)}`}</title>
                </rect>
              ))}
              {ticks.map((t, i) => <line key={i} x1={t.x} x2={t.x} y1={0} y2={H} stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" />)}
            </svg>
            <span style={{ position: 'absolute', top: 0, left: 4, fontSize: '10px', color: 'var(--foreground-muted)' }}>{fmtAxis(max)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--foreground-muted)', paddingTop: '3px' }}>
            {ticks.filter((_, i) => i % 2 === 0).map((t, i) => <span key={i}>{t.label}</span>)}
            <span style={{ color, fontWeight: 700 }}>now</span>
          </div>
        </>
      )}
    </div>
  )
}

// Split a full whale analysis into titled sections for the modal's card layout.
const WHALE_SECTION_TITLES = ['LAST TOUCH', 'QUICK READ', 'WHAT HAPPENED', 'PEAK FORMULA', 'CHATTER PERFORMANCE', 'WHO HE IS', 'WHAT HE BUYS', 'SLEEPING THREADS', 'NEXT MOVE', 'CHATTER CARD']
function parseWhaleAnalysis(full) {
  if (!full) return { fanLine: '', sections: [] }
  const lines = String(full).split('\n')
  const sections = []
  let cur = null, fanLine = ''
  for (const raw of lines) {
    const t = raw.trim()
    const hit = WHALE_SECTION_TITLES.find((s) => t.toUpperCase().startsWith(s) && t.length < 70)
    if (hit) { cur = { title: t, body: [] }; sections.push(cur) }
    else if (/^FAN:/i.test(t) && !cur) fanLine = t
    else if (cur) cur.body.push(raw)
  }
  return { fanLine, sections: sections.map((s) => ({ title: s.title, body: s.body.join('\n').replace(/^\n+|\n+$/g, '') })) }
}
// Color for each CHATTER CARD label (LABEL: value rows).
const CARD_LABEL_COLORS = { TYPE: '#C4A5F7', STANCE: '#E8C878', LANDMINE: '#E8A0A0', NEVER: '#E8A0A0', WANTS: '#7DD3A4', PRICE: '#7DD3A4', FORMULA: '#8FD3F0', THREADS: '#E8C878', OPENER: '#7DD3A4', CARD: 'var(--foreground-muted)', VOICE: '#C4A5F7', FAN: 'var(--foreground-muted)' }
// One "LABEL: value" line → colored label + value (OPENER renders as a quote).
function CardLine({ line }) {
  const m = String(line).match(/^([A-Z][A-Z /]{1,18}):\s*(.*)$/)
  if (!m) return <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, margin: '2px 0' }}>{line}</div>
  const label = m[1].trim(), val = m[2]
  const color = CARD_LABEL_COLORS[label.split(' ')[0]] || 'var(--foreground-muted)'
  if (label === 'OPENER') {
    return (
      <div style={{ margin: '8px 0 2px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Opener</div>
        <div style={{ background: 'rgba(125,211,164,0.08)', borderLeft: '3px solid #7DD3A4', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', fontStyle: 'italic', color: 'var(--foreground)', lineHeight: 1.5 }}>{val.replace(/^"|"$/g, '')}</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: '8px', margin: '5px 0', fontSize: '13px', lineHeight: 1.5 }}>
      <span style={{ flexShrink: 0, minWidth: '74px', fontWeight: 700, color, textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.03em', paddingTop: '1px' }}>{label}</span>
      <span style={{ color: 'var(--foreground)' }}>{val}</span>
    </div>
  )
}

export default function LiveChatPage({ chatManagerView = false }) {
  const { user } = useUser()
  // The Inbox-only restriction applies to the chat-manager SURFACE (so an admin
  // previewing it sees exactly what she sees) AND to any real chat_manager,
  // wherever they land. Admins on their own /admin/live-chat keep all tabs.
  const isChatManager = chatManagerView || user?.publicMetadata?.role === 'chat_manager'
  const [accounts, setAccounts] = useState([])
  const [account, setAccount] = useState(() => fromUrl('account'))
  const [conversations, setConversations] = useState([])
  const [fan, setFan] = useState(() => fromUrl('fan'))
  // Suggest-mode (draft-only): an AI-drafted next message for the open fan,
  // grounded in her voice + his dossier. Never sends — copy/paste only.
  const [suggestion, setSuggestion] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  // Grab-from-OF is a SEPARATE action from Suggest — it pulls this fan's real
  // convo from OnlyFans (costs credits); Suggest only reads what's loaded.
  const [grabbing, setGrabbing] = useState(false)
  const [grabInfo, setGrabInfo] = useState(null)
  useEffect(() => { setSuggestion(null); setGrabInfo(null); setArchiveInfo(null); setBrief(null); setAskThread([]); setAskQ(''); setShowFull(false); setWhaleModal(false) }, [account, fan])
  // Voice Card is per-CREATOR (account), not per-fan — load once when the account changes.
  useEffect(() => {
    if (!account) { setVoiceCard(null); return }
    let cancelled = false
    setVoiceCard(null); setVoiceCardOpen(false)
    fetch(`/api/admin/live-chat/voice-card?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((d) => { if (!cancelled) setVoiceCard(d?.hasCard ? d : null) }).catch(() => {})
    return () => { cancelled = true }
  }, [account])
  // Load the creator's scraped-whale list for the Whales tab.
  useEffect(() => {
    if (!account) { setWhales([]); return }
    setWhalesLoading(true)
    fetch(`/api/admin/live-chat/whales?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((d) => setWhales(d.whales || [])).catch(() => setWhales([])).finally(() => setWhalesLoading(false))
  }, [account])
  // Load the fan's whale-hunting brief for the sidebar when a fan opens.
  useEffect(() => {
    if (!account || !fan) { setBrief(null); return }
    setBriefLoading(true)
    fetch('/api/admin/live-chat/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, fan }) })
      .then((r) => r.json()).then((d) => setBrief(d || null)).catch(() => setBrief(null)).finally(() => setBriefLoading(false))
  }, [account, fan])
  const [history, setHistory] = useState([])
  const [transcript, setTranscript] = useState(null)
  // Whether we've already done the deep OnlyFans pull for this fan. When true,
  // the credit-costing "Grab 25/50/100" buttons hide — we already have his full
  // history (webhooks keep it current), so paying to re-pull is wasted.
  const [archiveInfo, setArchiveInfo] = useState(null)
  // Whale-hunting sidebar for the open fan: his analysis brief + an ask-Opus box.
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [asking, setAsking] = useState(false)
  const [askThread, setAskThread] = useState([]) // [{ q, a }]
  // Left column can show live Conversations or the creator's scraped Whales.
  const [leftMode, setLeftMode] = useState('convos') // 'convos' | 'whales'
  const [whales, setWhales] = useState([])
  const [whalesLoading, setWhalesLoading] = useState(false)
  const [convosLoading, setConvosLoading] = useState(false) // list build is slow (chunky archives)
  const [threadLoading, setThreadLoading] = useState(false) // thread fetch in flight for the open fan
  const [showFull, setShowFull] = useState(false) // sidebar: expand full analysis
  const [whaleModal, setWhaleModal] = useState(false) // full whale analysis pop-up
  const [fanTxns, setFanTxns] = useState(null) // monthly spend (full history) for the modal chart
  const [voiceCard, setVoiceCard] = useState(null) // creator's onboarding-survey Voice Card (per creator, shared across VIP/Free)
  const [voiceCardOpen, setVoiceCardOpen] = useState(false)
  const [fanByType, setFanByType] = useState(null) // this fan's lifetime spend split by type (PPV/tips/subs) for the modal
  // Full transaction history for the modal spend chart — fetched lazily when the
  // modal opens (the browser is authed, so it can hit the earnings endpoint).
  useEffect(() => {
    if (!whaleModal || !account || !fan) return
    // Earnings endpoint keys on the creator AKA (e.g. "Taby"), which is what the
    // analysis was saved under (brief.creator). Strip any "(Free)/(VIP)" suffix.
    const cr = brief?.creator || accounts.find((a) => a.account === account)?.aka?.replace(/\s*\((Free|VIP)\)\s*$/i, '')
    if (!cr) return
    setFanTxns(null); setFanByType(null)
    // OF transaction types → chatter-facing buckets. "Payment for message" = PPV,
    // "Tip" = tips, "Subscription"/"Recurring subscription" = subs.
    const bucketOf = (type) => {
      const t = String(type || '').toLowerCase()
      if (t.includes('message')) return 'ppv'
      if (t.includes('tip')) return 'tips'
      if (t.includes('subscription')) return 'subs'
      if (t.includes('stream')) return 'streams'
      if (t.includes('post')) return 'posts'
      return 'other'
    }
    fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(cr)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const txns = d.transactions || []
        const fanNameL = String(brief?.fanName || '').toLowerCase()
        const mo = {}
        const bt = {}
        for (const t of txns) {
          const net = Number(t.net) || 0
          if (net <= 0 || !t.date) continue
          const matches = (fan && t.ofUsername === fan) || ((!t.ofUsername || !fan) && String(t.displayName || '').toLowerCase() === fanNameL)
          if (!matches) continue
          const m = String(t.date).slice(0, 7)
          mo[m] = (mo[m] || 0) + net
          bt[bucketOf(t.type)] = (bt[bucketOf(t.type)] || 0) + net
        }
        setFanTxns(Object.entries(mo).sort(([a], [b]) => a.localeCompare(b)).map(([m, net]) => ({ m, net: Math.round(net) })))
        setFanByType(bt)
      })
      .catch(() => { setFanTxns([]); setFanByType(null) })
  }, [whaleModal, account, fan]) // eslint-disable-line react-hooks/exhaustive-deps
  const [liveEvents, setLiveEvents] = useState([])
  const [lastPoll, setLastPoll] = useState(null)
  const [showMuted, setShowMuted] = useState(false)
  const [view, setView] = useState(() => fromUrl('tab') || 'inbox') // 'inbox' | 'in' | 'out' | 'sales'
  // A chat manager can only ever be on Inbox — snap back if a stale ?tab= URL
  // (or a shared admin link) lands her on a firehose tab she can't see.
  useEffect(() => { if (isChatManager && view !== 'inbox') setView('inbox') }, [isChatManager, view])
  const [stream, setStream] = useState([])
  const scroller = useRef(null)
  const timer = useRef(null)
  // Fans muted THIS session ("account|fanKey") — the append-only stream union
  // would otherwise re-add their rows from an in-flight or server-cached poll
  // and they'd never leave. The server persists the mute for future loads.
  const mutedKeys = useRef(new Set())

  useEffect(() => {
    fetch('/api/admin/live-chat', { cache: 'no-store' }).then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {})
  }, [])

  // Stream views: ALL creators' events merged, thin rows, auto-updating
  useEffect(() => {
    if (view === 'inbox') return
    const load = () => fetch('/api/admin/live-chat?stream=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        // UNION with what's already on screen — a row, once shown, never
        // disappears (transient fetch gaps looked like deletions).
        setStream((prev) => {
          const seen = new Map(prev.map((e) => [`${e.aka}-${e.id}`, e]))
          for (const e of d.stream || []) seen.set(`${e.aka}-${e.id}`, e)
          const all = [...seen.values()]
            .filter((e) => !mutedKeys.current.has(`${e.account}|${e.fan?.username || e.fan?.name || ''}`))
            .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
          // Sales survive the cap separately — high message volume would
          // otherwise push every sale out and empty the Sales tab.
          return [
            ...all.filter((e) => e.dir !== 'sale').slice(0, 250),
            ...all.filter((e) => e.dir === 'sale').slice(0, 100),
          ].sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        })
        setLastPoll(new Date())
      })
      .catch(() => {})
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [view])

  // Load conversations when account changes (URL-restored fan survives the
  // first load; manual switches clear it via the select's onChange)
  useEffect(() => {
    if (!account) return
    setConversations([]); setHistory([]); setLiveEvents([]); setConvosLoading(true)
    writeUrl(account, fan)
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setConversations(overlayMutes(account, d.conversations || [])) })
      .catch(() => {})
      .finally(() => setConvosLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  // The conversation LIST is live too — new fans appear as they message
  // (webhook → buffer → this 20s poll), not just the open thread.
  useEffect(() => {
    if (!account) return
    const t = setInterval(() => {
      fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => { if (d.conversations) setConversations(overlayMutes(account, d.conversations)) })
        .catch(() => {})
    }, 12000)
    return () => clearInterval(t)
  }, [account])

  // Load thread when fan changes; then poll live buffer
  useEffect(() => {
    if (!account || !fan) return
    // Clear the previous fan's messages immediately so the switch is instant and
    // the loading shows INSIDE the newly-opened conversation, not the old one.
    setHistory([]); setTranscript(null); setArchiveInfo(null); setLiveEvents([]); setThreadLoading(true)
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}&fan=${encodeURIComponent(fan)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setHistory(d.history || []); setTranscript(d.transcript || null); setArchiveInfo(d.archiveInfo || null); setLiveEvents(d.live || []); setLastPoll(new Date()) })
      .catch(() => {})
      .finally(() => setThreadLoading(false))
    timer.current = setInterval(() => {
      fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}&liveOnly=1`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          const mine = (d.live || []).filter((e) => (e.fan?.username || e.fan?.name || '') === fan)
          setLiveEvents(mine)
          setLastPoll(new Date())
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(timer.current)
  }, [account, fan])

  // Merge archive history + live events (dedup by id), ascending
  const thread = useMemo(() => {
    const seen = new Set(history.map((m) => String(m.id)))
    const extra = liveEvents.filter((e) => !seen.has(String(e.id))).map((e) => ({
      id: e.id, dir: e.dir, at: e.at, text: e.text, price: e.price || 0,
      bought: e.dir === 'unlock', mass: false, media: e.media || 0, liveEvent: true,
    }))
    return [...history, ...extra].sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  }, [history, liveEvents])

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [thread.length, fan])

  function openFromStream(e) {
    const fanKey = e.fan?.username || e.fan?.name || ''
    if (!e.account || !fanKey) return
    setView('inbox')
    setAccount(e.account)
    setFan(fanKey)
    writeUrl(e.account, fanKey)
  }

  // Poll responses can't un-mute what was muted this session — a list fetch
  // that raced the mute save would otherwise flash the conversation back.
  function overlayMutes(acct, convs) {
    return convs.map((c) => (mutedKeys.current.has(`${acct}|${c.fan}`) ? { ...c, muted: true } : c))
  }

  // Muting a FAN (from either the stream ✕ or the inbox ✕) hides ALL their
  // messages: every row of theirs leaves the stream, and their conversation
  // leaves that account's inbox. Server persists it; mutedKeys keeps the
  // append-only stream union from resurrecting their rows this session.
  async function muteFan(acct, fanKey, mute) {
    if (!fanKey || !acct) return
    const key = `${acct}|${fanKey}`
    if (mute) mutedKeys.current.add(key)
    else mutedKeys.current.delete(key)
    setStream((prev) => (mute
      ? prev.filter((x) => (x.fan?.username || x.fan?.name || '') !== fanKey || x.account !== acct)
      : prev))
    setConversations((cs) => cs.map((c) => (c.fan === fanKey ? { ...c, muted: mute } : c)))
    try {
      await fetch('/api/admin/live-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: acct, fan: fanKey, mute }),
      })
    } catch { /* server filter catches next poll */ }
  }

  const muteFromStream = (e) => muteFan(e.account, e.fan?.username || e.fan?.name || '', true)
  const toggleMute = (fanKey, mute) => muteFan(account, fanKey, mute)

  // Draft the next message for the open fan (SUGGEST-ONLY — never sends).
  async function suggestReply() {
    if (!account || !fan || suggesting) return
    setSuggesting(true); setSuggestion(null)
    try {
      const selConv = conversations.find((c) => c.fan === fan)
      const msgs = thread.map((m) => ({ dir: m.dir, text: m.text, price: m.price, at: m.at, mass: m.mass }))
      const r = await fetch('/api/admin/live-chat/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, fan, fanName: selConv?.name || '', messages: msgs }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'suggest failed')
      setSuggestion(d)
    } catch (e) {
      setSuggestion({ error: e.message || 'suggest failed' })
    } finally { setSuggesting(false) }
  }

  // Pull this fan's real convo from OnlyFans (costs credits) into the thread.
  async function grabFromOf(n) {
    if (!account || !fan || grabbing) return
    setGrabbing(true); setGrabInfo(null)
    try {
      const selConv = conversations.find((c) => c.fan === fan)
      const r = await fetch('/api/admin/live-chat/grab', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, fan, fanName: selConv?.name || '', count: n }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'grab failed')
      if (Array.isArray(d.messages)) setHistory(d.messages)
      setGrabInfo({ added: d.added ?? 0, total: d.total ?? (d.messages || []).length, credits: d.credits || 0 })
    } catch (e) {
      setGrabInfo({ error: e.message || 'grab failed' })
    } finally { setGrabbing(false) }
  }

  // Ask Opus a question about the open fan (grounded in his analysis + thread).
  async function askAbout() {
    const q = askQ.trim()
    if (!account || !fan || !q || asking) return
    setAsking(true)
    setAskThread((t) => [...t, { q, a: null }])
    setAskQ('')
    try {
      const r = await fetch('/api/admin/live-chat/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, fan, fanName: brief?.fanName || '', question: q, messages: [...history, ...liveEvents] }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'ask failed')
      setAskThread((t) => t.map((e, i) => (i === t.length - 1 ? { ...e, a: d.answer } : e)))
    } catch (e) {
      setAskThread((t) => t.map((e, i) => (i === t.length - 1 ? { ...e, a: 'error: ' + (e.message || 'failed') } : e)))
    } finally { setAsking(false) }
  }

  // Older sale events stored `at` as "YYYY-MM-DD HH:MM:SS" (UTC, no zone) —
  // parsing that as local shifted times 4h. Treat zoneless as UTC.
  const parseAt = (iso) => new Date(iso.includes('T') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z')

  const fmtListTime = (iso) => {
    if (!iso) return ''
    const d = parseAt(iso)
    if (isNaN(d)) return ''
    const today = new Date().toDateString() === d.toDateString()
    return today
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
      : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  }

  const fmtT = (iso) => {
    const d = parseAt(String(iso || ''))
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  }

  return (
    <div style={{ padding: '20px clamp(10px, 1.5vw, 24px)', maxWidth: '1760px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Live Chat</h1>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden' }}>
          {(isChatManager ? [['inbox', 'Inbox']] : [['inbox', 'Inbox'], ['in', 'Incoming'], ['out', 'Outgoing'], ['sales', 'Sales']]).map(([k, label]) => (
            <button key={k} onClick={() => { setView(k); writeUrl(account, fan, k) }}
              style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: view === k ? 'rgba(160,111,232,0.25)' : 'transparent', color: view === k ? '#C4A5F7' : 'var(--foreground-muted)' }}>
              {label}
            </button>
          ))}
        </div>
        {view === 'inbox' && (
          <select value={account} onChange={(e) => { setAccount(e.target.value); setFan(''); writeUrl(e.target.value, '') }}
            style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
            <option value="">Pick a creator…</option>
            {accounts.map((a) => <option key={a.account} value={a.account}>{a.aka}</option>)}
          </select>
        )}
        <span style={{ fontSize: '11px', color: '#7DD3A4' }}>● LIVE — auto-updating{lastPoll ? ` · last check ${lastPoll.toLocaleTimeString('en-US')}` : ''}</span>
      </div>

      {view !== 'inbox' ? (() => {
        const inView = (e) => view === 'in' ? (e.dir === 'in' || e.dir === 'unlock') : view === 'out' ? e.dir === 'out' : e.dir === 'sale'
        const rows = stream.filter(inView)
        // A locked send counts as BOUGHT when a sale from the same fan on the
        // same account for the exact PPV price lands at/after the send.
        const isBought = (e) => e.price > 0 && stream.some((s) =>
          s.dir === 'sale' && s.account === e.account && s.fan?.id && s.fan.id === e.fan?.id
          && Math.abs((+s.price || 0) - (+e.price || 0)) < 0.005 && (s.at || '') >= (e.at || ''))
        const lockedLabel = (e) => {
          if (!(e.price > 0)) return ''
          const parts = []
          if (e.photos) parts.push(`${e.photos}p`)
          if (e.videos) parts.push(`${e.videos}v`)
          if (!parts.length && e.media) parts.push(`${e.media}m`)
          return `${parts.join(' ')}${parts.length ? ' · ' : ''}$${e.price}`
        }
        const grid = view === 'out' ? '110px 110px 150px 150px 1fr 26px' : '110px 110px 150px 64px 1fr 26px'
        const empty = view === 'in' ? 'Waiting — every fan message and PPV unlock across ALL creators lands here as it happens.'
          : view === 'out' ? 'Waiting — every 1:1 message your chatters send (mass blasts excluded) lands here as it happens.'
          : 'Waiting — every sale (PPVs, tips, subs) across ALL creators lands here as it happens.'
        return (
        <>
        {view === 'sales' && (
          <BucketGraph
            urlKey="sales" endpoint="/api/admin/live-chat?sales48=1" dataKey="sales"
            mapValue={(e) => net(e.price)} color="#A06FE8" label="Net sales"
            fmtTotal={(t) => `$${Math.round(t).toLocaleString()} net`} fmtBar={(v) => `$${v.toFixed(2)} net`} fmtAxis={(v) => `$${Math.round(v)}`}
          />
        )}
        {view === 'out' && (
          <BucketGraph
            urlKey="sent" endpoint="/api/admin/live-chat?sent48=1" dataKey="sent"
            mapValue={() => 1} color="#7aa9ff" label="Messages sent"
            fmtTotal={(t) => `${t.toLocaleString()} sent`} fmtBar={(v) => `${v} sent`} fmtAxis={(v) => `${v}`}
            creatorFilter
          />
        )}
        <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: '10px', padding: '9px 16px', fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span>Time</span><span>Creator</span><span>Fan</span><span>{view === 'out' ? 'Locked' : view === 'sales' ? 'Net' : ''}</span><span>{view === 'sales' ? 'What' : 'Message'}</span><span></span>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 230px)', overflowY: 'auto' }}>
            {rows.length === 0 && (
              <div style={{ padding: '30px', textAlign: 'center', fontSize: '12px', color: 'var(--foreground-muted)' }}>{empty}</div>
            )}
            {rows.map((e) => (
              <div key={`${e.aka}-${e.id}`}
                onClick={() => openFromStream(e)}
                onMouseEnter={(ev) => ev.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
                style={{ display: 'grid', gridTemplateColumns: grid, gap: '10px', padding: '6px 16px', fontSize: '12px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'baseline', cursor: 'pointer' }}>
                <span style={{ color: 'var(--foreground-muted)', fontSize: '11px', whiteSpace: 'nowrap' }}>{fmtListTime(e.at)}</span>
                <span style={{ color: '#C4A5F7', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.aka}</span>
                <span style={{ color: 'var(--foreground)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.fan?.name || e.fan?.username || '—'}</span>
                {view === 'out' ? (
                  <span style={{ fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', color: isBought(e) ? '#7DD3A4' : e.price > 0 ? '#E8C878' : 'var(--foreground-muted)' }}>
                    {lockedLabel(e)}{isBought(e) ? ' ✓ BOUGHT' : ''}
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: e.dir === 'in' ? '#7DD3A4' : '#E8C878' }}>
                    {e.dir === 'in' ? 'FAN' : `$${net(e.price).toFixed(2)}`}
                  </span>
                )}
                <span style={{ color: e.dir === 'in' || e.dir === 'sale' ? 'var(--foreground)' : 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.dir === 'unlock' ? `💸 unlocked PPV — $${net(e.price).toFixed(2)} net`
                    : e.dir === 'sale' ? `${e.kind ? e.kind.toUpperCase() + ' — ' : ''}${e.text || ''}`
                    : (e.text || '(media)')}
                </span>
                <button title="Mute this fan — hides ALL their messages here and in the inbox"
                  onClick={(ev) => { ev.stopPropagation(); muteFromStream(e) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--foreground-muted)', padding: 0, opacity: 0.6 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
        </>
        )
      })() : !account ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px', background: 'var(--card-bg-solid)', borderRadius: '12px' }}>
          Pick a creator to open her inbox.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: fan ? '300px 1fr 420px' : '320px 1fr', gap: '0', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', overflow: 'hidden', height: 'calc(100vh - 170px)' }}>

          {/* ── Conversation list ── */}
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'var(--card-bg-solid)', zIndex: 1 }}>
              {[['convos', `Conversations (${conversations.length})`], ['whales', `Whales (${whales.length})`]].map(([k, label]) => (
                <button key={k} onClick={() => setLeftMode(k)}
                  style={{ flex: 1, padding: '11px 8px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', border: 'none', cursor: 'pointer', background: leftMode === k ? 'rgba(160,111,232,0.15)' : 'transparent', color: leftMode === k ? '#C4A5F7' : 'var(--foreground-muted)', borderBottom: leftMode === k ? '2px solid #C4A5F7' : '2px solid transparent' }}>
                  {label}
                </button>
              ))}
            </div>
            {leftMode === 'whales' && (
              <>
                {whalesLoading && <div style={{ padding: '20px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>loading whales…</div>}
                {!whalesLoading && whales.length === 0 && <div style={{ padding: '20px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>No analyzed whales for this creator yet. Scrape + analyze fans on Whale Hunting.</div>}
                {whales.map((w) => {
                  const active = fan === w.username
                  return (
                    <div key={w.username || w.fanName} onClick={() => { if (w.username) { setFan(w.username); writeUrl(account, w.username) } }}
                      style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 14px', cursor: w.username ? 'pointer' : 'default', background: active ? 'rgba(160,111,232,0.10)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'rgba(160,111,232,0.10)' : 'transparent' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(125,211,164,0.15)', color: '#7DD3A4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>🐋</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.fanName || w.username}</div>
                        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
                          {w.lifetime != null ? `$${Math.round(w.lifetime).toLocaleString()}` : ''}{w.currentGap != null ? ` · ${w.currentGap}d gap` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
            {leftMode === 'convos' && (<>
            {conversations.length === 0 && (
              <div style={{ padding: '20px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
                {convosLoading ? 'loading conversations…' : 'No archived or live conversations yet for this creator.'}
              </div>
            )}
            {conversations.filter((c) => showMuted || !c.muted).map((c) => {
              const active = fan === c.fan
              const isLive = c.lastAt && (Date.now() - new Date(c.lastAt)) < 30 * 60000
              return (
                <div key={c.fan} onClick={() => { setFan(c.fan); writeUrl(account, c.fan) }}
                  style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '11px 14px', cursor: 'pointer', background: active ? 'rgba(160,111,232,0.10)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'rgba(160,111,232,0.10)' : 'transparent' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(160,111,232,0.18)', color: '#C4A5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                    {(c.name || c.fan).slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: c.muted ? 'var(--foreground-muted)' : 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.name || c.fan} {isLive && <span style={{ color: '#7DD3A4', fontSize: '10px' }}>●</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexShrink: 0 }}>
                        <div style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>{fmtListTime(c.lastAt)}</div>
                        <button title={c.muted ? 'Unmute — show this conversation again' : 'Mute — hide this conversation (e.g. another creator\'s promos)'}
                          onClick={(ev) => { ev.stopPropagation(); toggleMute(c.fan, !c.muted) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: c.muted ? '#E8C878' : 'var(--foreground-muted)', padding: 0, opacity: 0.8 }}>
                          {c.muted ? '↺' : '✕'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.lastText || (c.archived ? 'archived history' : '')}
                    </div>
                  </div>
                </div>
              )
            })}
            {conversations.some((c) => c.muted) && (
              <button onClick={() => setShowMuted((v) => !v)}
                style={{ margin: '8px 14px', padding: '5px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer', textAlign: 'left' }}>
                {showMuted ? 'Hide muted' : `Show muted (${conversations.filter((c) => c.muted).length})`}
              </button>
            )}
            </>)}
          </div>

          {/* ── Thread ── */}
          {!fan ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>
              Pick a conversation.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>
                {brief?.fanName || archiveInfo?.fanName || conversations.find((c) => c.fan === fan)?.name || fan}
                <span style={{ color: 'var(--foreground-muted)', fontWeight: 500, marginLeft: '8px', fontSize: '12px' }}>@{fan}</span>
              </div>
              <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {threadLoading && thread.length === 0 && (
                  <div style={{ color: 'var(--foreground-muted)', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>loading conversation…</div>
                )}
                {!threadLoading && thread.length === 0 && !transcript && (
                  <div style={{ color: 'var(--foreground-muted)', fontSize: '12px', textAlign: 'center', marginTop: '40px', lineHeight: 1.7 }}>
                    No message archive for @{fan} yet — this folder only has old analysis files.<br />
                    Open his fan card on Whale Hunting and hit <b>Pull from OF</b> to load his history.<br />
                    Live messages will still appear here the moment he chats.
                  </div>
                )}
                {thread.length === 0 && transcript && (
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#E8C878', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                      Old transcript (manual-era) — Pull from OF on his fan card for the full structured history
                    </div>
                    <pre style={{ fontSize: '12px', color: 'var(--foreground)', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.55, margin: 0 }}>{transcript}</pre>
                  </div>
                )}
                {thread.map((m) => {
                  const isFan = m.dir === 'in'
                  const isUnlock = m.dir === 'unlock'
                  return (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isFan ? 'flex-start' : 'flex-end' }}>
                      <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', margin: '0 6px 2px' }}>
                        {fmtT(m.at)} ET{m.mass ? ' · mass' : ''}{m.liveEvent ? ' · live' : ''}
                      </div>
                      <div style={{
                        maxWidth: '62%', padding: '9px 14px', borderRadius: isFan ? '15px 15px 15px 4px' : '15px 15px 4px 15px',
                        fontSize: '13px', lineHeight: 1.45, whiteSpace: 'pre-wrap',
                        background: isUnlock ? 'rgba(125, 211, 164, 0.12)' : isFan ? 'rgba(255,255,255,0.07)' : 'rgba(0, 145, 234, 0.18)',
                        border: isUnlock ? '1px solid rgba(125,211,164,0.35)' : '1px solid rgba(255,255,255,0.04)',
                        color: 'var(--foreground)', opacity: m.mass ? 0.55 : 1,
                      }}>
                        {isUnlock ? (
                          <b style={{ color: '#7DD3A4' }}>💸 PPV unlocked{m.price ? ` — $${m.price}` : ''}</b>
                        ) : (
                          <>
                            {m.text || <i style={{ color: 'var(--foreground-muted)' }}>(media message)</i>}
                            {(m.price > 0 || m.media > 0) && (
                              <div style={{ marginTop: '5px', display: 'flex', gap: '6px', justifyContent: isFan ? 'flex-start' : 'flex-end' }}>
                                {m.price > 0 && (
                                  <span style={{ fontSize: '10px', fontWeight: 700, background: m.bought ? 'rgba(125,211,164,0.15)' : 'rgba(232,200,120,0.15)', color: m.bought ? '#7DD3A4' : '#E8C878', padding: '1px 7px', borderRadius: '4px' }}>
                                    PPV ${m.price}{m.bought ? ' · bought' : ' · not bought'}
                                  </span>
                                )}
                                {m.media > 0 && <span style={{ fontSize: '10px', fontWeight: 700, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground-muted)', padding: '1px 7px', borderRadius: '4px' }}>📷 {m.media}</span>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* ── Suggest reply (draft-only, never sends) ── */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Grab from OF — pulls this fan's real convo (costs credits). Separate from Suggest. */}
                {/* Grab buttons only for fans we've NEVER deep-pulled. Once his
                    full history is on file (webhooks keep it current), re-pulling
                    just burns OnlyFans credits, so we hide them and say so. */}
                {(() => {
                  const pulled = !!archiveInfo && (archiveInfo.historyComplete || (archiveInfo.count || 0) >= 300)
                  if (pulled) {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#7DD3A4', fontWeight: 600 }}>✓ Full history on file{archiveInfo.count ? ` (${archiveInfo.count.toLocaleString()} msgs)` : ''} — kept current by webhooks</span>
                      </div>
                    )
                  }
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grab from OF</span>
                      {[25, 50, 100].map((n) => (
                        <button key={n} onClick={() => grabFromOf(n)} disabled={grabbing} title={`Pull this fan's last ${n} messages from OnlyFans (about 1 credit)`}
                          style={{ padding: '5px 12px', fontSize: '11px', fontWeight: 700, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', cursor: grabbing ? 'default' : 'pointer', background: 'transparent', color: 'var(--foreground)' }}>
                          {n}
                        </button>
                      ))}
                      {grabbing && <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>pulling…</span>}
                      {grabInfo && !grabInfo.error && <span style={{ fontSize: '11px', color: '#7DD3A4' }}>+{grabInfo.added} new · {grabInfo.total} in history · {grabInfo.credits} credit{grabInfo.credits === 1 ? '' : 's'} · saved</span>}
                      {grabInfo?.error && <span style={{ fontSize: '11px', color: '#E8A0A0' }}>{grabInfo.error}</span>}
                    </div>
                  )
                })()}
                {/* Voice Card — per creator, from her onboarding survey. Shared across her VIP + Free pages. */}
                {voiceCard && (
                  <div style={{ border: '1px solid rgba(196,165,247,0.25)', borderRadius: '8px', background: 'rgba(160,111,232,0.06)', overflow: 'hidden' }}>
                    <button onClick={() => setVoiceCardOpen((o) => !o)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#C4A5F7', fontSize: '12px', fontWeight: 700 }}>
                      <span>Voice Card — how {voiceCard.creator || 'she'} talks · {voiceCard.answerCount} answers</span>
                      <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{voiceCardOpen ? 'hide' : 'show'}</span>
                    </button>
                    {voiceCardOpen && (
                      <div style={{ padding: '2px 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto' }}>
                        {voiceCard.groups.map((g) => (
                          <div key={g.label}>
                            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: g.label.startsWith('NEVER') ? '#E8A0A0' : '#C4A5F7', marginBottom: '4px' }}>{g.label}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              {g.items.map((it) => (
                                <div key={it.key} style={{ fontSize: '12px', lineHeight: 1.45, color: 'var(--foreground)' }}>
                                  <span style={{ color: 'var(--foreground-muted)' }}>{it.label}: </span>{it.value}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Suggest — draft-only, uses whatever's loaded (never pulls) */}
                <button onClick={suggestReply} disabled={suggesting}
                  style={{ alignSelf: 'flex-start', padding: '8px 16px', fontSize: '12px', fontWeight: 700, border: 'none', borderRadius: '8px', cursor: suggesting ? 'default' : 'pointer', background: 'rgba(160,111,232,0.25)', color: '#C4A5F7' }}>
                  {suggesting ? 'Thinking…' : '✨ Suggest reply'}
                </button>
                {suggestion?.error && <div style={{ fontSize: '12px', color: '#E8A0A0' }}>{suggestion.error}</div>}
                {suggestion && !suggestion.error && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
                      {suggestion.note}
                      {' · '}
                      <span style={{ color: suggestion.usedProfile ? '#7DD3A4' : 'var(--foreground-muted)' }}>
                        {suggestion.usedProfile ? 'using fan profile' : 'no profile on file'}
                      </span>
                      {suggestion.usedVoiceCard ? <span style={{ color: '#C4A5F7' }}>{` · voice card (${suggestion.voiceCardAnswers})`}</span> : null}
                      {suggestion.usedCount ? ` · read ${suggestion.usedCount} msgs` : ''}
                    </div>
                    {(suggestion.suggestions || []).map((s, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', background: 'rgba(0,145,234,0.12)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '10px 12px' }}>
                        <div style={{ flex: 1, fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.45 }}>{s}</div>
                        <button onClick={() => navigator.clipboard?.writeText(s)}
                          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '11px', padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}>copy</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* ── Whale-hunting sidebar: the fan's brief + ask-Opus box ── */}
          {fan && (
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: 'rgba(160,111,232,0.03)' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px' }}>🐋</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)' }}>Whale Brief</span>
                {brief?.hasAnalysis && brief.analyzedDate && <span style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginLeft: 'auto' }}>{new Date(brief.analyzedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', minHeight: 0 }}>
                {briefLoading && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>loading brief…</div>}
                {!briefLoading && brief && !brief.hasAnalysis && (
                  <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
                    No whale analysis on this fan yet. Open him on <b style={{ color: '#C4A5F7' }}>Whale Hunting</b> and run the analysis to populate this.
                  </div>
                )}
                {!briefLoading && brief?.hasAnalysis && (
                  <>
                    {brief.fullAnalysis && (
                      <button onClick={() => setWhaleModal(true)}
                        style={{ marginBottom: '12px', padding: '9px 12px', fontSize: '12px', fontWeight: 700, border: 'none', borderRadius: '8px', background: 'rgba(160,111,232,0.25)', color: '#C4A5F7', cursor: 'pointer', width: '100%' }}>
                        See full analysis →
                      </button>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                      {brief.stats?.lifetime != null && <span style={{ fontSize: '10px', fontWeight: 700, background: 'rgba(125,211,164,0.14)', color: '#7DD3A4', padding: '3px 8px', borderRadius: '6px' }}>${Math.round(brief.stats.lifetime).toLocaleString()} lifetime</span>}
                      {brief.stats?.currentGap != null && <span style={{ fontSize: '10px', fontWeight: 700, background: 'rgba(160,111,232,0.15)', color: '#C4A5F7', padding: '3px 8px', borderRadius: '6px' }}>{brief.stats.currentGap}d gap</span>}
                      {brief.stats?.medianGap != null && <span style={{ fontSize: '10px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', padding: '3px 8px', borderRadius: '6px' }}>~{brief.stats.medianGap}d rhythm</span>}
                    </div>
                    <div>{(brief.brief || brief.fullAnalysis || '').split('\n').filter((l) => l.trim()).map((l, i) => <CardLine key={i} line={l.trim()} />)}</div>
                  </>
                )}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ask Opus about him</div>
                {askThread.length > 0 && (
                  <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px' }}>
                    {askThread.map((e, i) => (
                      <div key={i} style={{ fontSize: '12px' }}>
                        <div style={{ color: '#C4A5F7', fontWeight: 600 }}>{e.q}</div>
                        <div style={{ color: 'var(--foreground)', lineHeight: 1.45, marginTop: '3px' }}>{e.a == null ? <span style={{ color: 'var(--foreground-muted)' }}>thinking…</span> : e.a}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input value={askQ} onChange={(e) => setAskQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') askAbout() }} placeholder="e.g. what should I not bring up?"
                    style={{ flex: 1, background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '7px 10px', fontSize: '12px' }} />
                  <button onClick={askAbout} disabled={asking || !askQ.trim()}
                    style={{ padding: '7px 12px', fontSize: '12px', fontWeight: 700, border: 'none', borderRadius: '8px', cursor: (asking || !askQ.trim()) ? 'default' : 'pointer', background: 'rgba(160,111,232,0.25)', color: '#C4A5F7' }}>
                    {asking ? '…' : 'Ask'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Full whale analysis modal — wide, formatted, most-important-first ── */}
      {whaleModal && brief?.hasAnalysis && (() => {
        const parsed = parseWhaleAnalysis(brief.fullAnalysis || '')
        const cardText = brief.brief || (parsed.sections.find((s) => /^CHATTER CARD/i.test(s.title))?.body) || ''
        const detail = parsed.sections.filter((s) => !/^CHATTER CARD/i.test(s.title))
        const secColor = (t) => {
          const u = t.toUpperCase()
          if (u.startsWith('LAST TOUCH') || u.startsWith('WHO HE IS')) return '#8FD3F0'
          if (u.startsWith('QUICK READ') || u.startsWith('NEXT MOVE')) return '#C4A5F7'
          if (u.startsWith('WHAT HAPPENED') || u.startsWith('SLEEPING')) return '#E8C878'
          if (u.startsWith('PEAK FORMULA') || u.startsWith('WHAT HE BUYS')) return '#7DD3A4'
          if (u.startsWith('CHATTER PERFORMANCE')) return '#E8A0A0'
          return 'var(--foreground-muted)'
        }
        return (
          <div onClick={() => setWhaleModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 24px', overflowY: 'auto' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '1400px', background: 'var(--card-bg-solid, #0f0f0f)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 26px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(90deg, rgba(160,111,232,0.12), transparent)' }}>
                <span style={{ fontSize: '20px' }}>🐋</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--foreground)' }}>{brief.fanName || fan}</div>
                  <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{brief.creator}{brief.analyzedDate ? ` · analyzed ${new Date(brief.analyzedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
                </div>
                {brief.stats?.lifetime != null && <span style={{ fontSize: '11px', fontWeight: 700, background: 'rgba(125,211,164,0.14)', color: '#7DD3A4', padding: '4px 10px', borderRadius: '7px' }}>${Math.round(brief.stats.lifetime).toLocaleString()} lifetime</span>}
                {brief.stats?.currentGap != null && <span style={{ fontSize: '11px', fontWeight: 700, background: 'rgba(160,111,232,0.15)', color: '#C4A5F7', padding: '4px 10px', borderRadius: '7px' }}>{brief.stats.currentGap}d gap</span>}
                <button onClick={() => setWhaleModal(false)} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '24px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ padding: '22px 26px', maxHeight: 'calc(90vh - 84px)', overflowY: 'auto' }}>
                {cardText && (
                  <div style={{ background: 'linear-gradient(135deg, rgba(232,143,172,0.09), rgba(124,58,237,0.05))', border: '1px solid rgba(232,143,172,0.25)', borderRadius: '12px', padding: '18px 22px', marginBottom: '20px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#E88FAC', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>The Card — what a chatter needs first</div>
                    {cardText.split('\n').filter((l) => l.trim()).map((l, i) => <CardLine key={i} line={l.trim()} />)}
                  </div>
                )}
                {(fanTxns?.length > 0 || archiveInfo?.monthly?.length > 0) && (() => {
                  const spendMap = Object.fromEntries((fanTxns || []).map((x) => [x.m, x.net]))
                  const chatMap = Object.fromEntries((archiveInfo?.monthly || []).map((x) => [x.m, x.c]))
                  const allM = [...new Set([...Object.keys(spendMap), ...Object.keys(chatMap)])].sort()
                  if (!allM.length) return null
                  const months = []
                  let [y, mo] = allM[0].split('-').map(Number)
                  // Always run the axis to TODAY, not the last month with data —
                  // an empty recent stretch is the story (he went cold), and it
                  // stops the last data bar from looking like "this month".
                  const _now = new Date()
                  const ey = _now.getFullYear(), em = _now.getMonth() + 1
                  let guard = 0
                  while ((y < ey || (y === ey && mo <= em)) && guard++ < 240) { months.push(`${y}-${String(mo).padStart(2, '0')}`); mo++; if (mo > 12) { mo = 1; y++ } }
                  const maxSpend = Math.max(...months.map((m) => spendMap[m] || 0), 1)
                  const lifetime = Object.values(spendMap).reduce((s, v) => s + v, 0)
                  return (
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 800, color: '#7DD3A4', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Spending &amp; conversation — full history</div>
                        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{fanTxns == null ? 'loading spend…' : `${months.length} months${lifetime ? ` · $${lifetime.toLocaleString()} matched` : ''}`}</div>
                      </div>
                      {fanByType && (() => {
                        const buckets = [
                          { key: 'ppv', label: 'PPV', color: '#7DD3A4' },
                          { key: 'tips', label: 'Tips', color: '#E8C878' },
                          { key: 'subs', label: 'Subs', color: '#C4A5F7' },
                          { key: 'streams', label: 'Streams', color: '#8FD3F0' },
                          { key: 'posts', label: 'Posts', color: '#E8A0A0' },
                          { key: 'other', label: 'Other', color: 'var(--foreground-muted)' },
                        ].map((b) => ({ ...b, val: Math.round(fanByType[b.key] || 0) })).filter((b) => b.val > 0)
                        const tot = buckets.reduce((s, b) => s + b.val, 0)
                        if (!tot) return null
                        return (
                          <div style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                              {buckets.map((b) => <div key={b.key} title={`${b.label}: $${b.val.toLocaleString()}`} style={{ width: `${(b.val / tot) * 100}%`, background: b.color }} />)}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                              {buckets.map((b) => (
                                <span key={b.key} style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground)' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: b.color, marginRight: '5px' }} />
                                  {b.label} ${b.val.toLocaleString()} <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}>{Math.round((b.val / tot) * 100)}%</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '72px' }}>
                        {months.map((m, i) => { const v = spendMap[m] || 0; return (
                          <div key={i} title={`${m}: $${v.toLocaleString()}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', minWidth: 0 }}>
                            <div style={{ width: '100%', maxWidth: '20px', height: `${Math.max(Math.round((v / maxSpend) * 64), v > 0 ? 3 : 0)}px`, background: '#E88FAC', borderRadius: '2px 2px 0 0' }} />
                          </div>
                        ) })}
                      </div>
                      <div style={{ display: 'flex', gap: '2px', height: '9px', marginTop: '3px' }}>
                        {months.map((m, i) => (
                          <div key={i} style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
                            <div title={chatMap[m] ? `${chatMap[m]} msgs` : 'no chat pulled'} style={{ width: '100%', maxWidth: '20px', height: '100%', background: chatMap[m] ? '#8FD3F0' : 'rgba(255,255,255,0.05)', borderRadius: '2px' }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '2px', marginTop: '3px' }}>
                        {months.map((m, i) => (<div key={i} style={{ flex: 1, fontSize: '8px', color: 'var(--foreground-muted)', textAlign: 'center', minWidth: 0 }}>{(m.slice(5) === '01' || i === 0) ? `'${m.slice(2, 4)}` : ''}</div>))}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '8px' }}>
                        <span style={{ color: '#E88FAC' }}>▮</span> monthly spend &nbsp;·&nbsp; <span style={{ color: '#8FD3F0' }}>▮</span> months we have chat ({(archiveInfo?.count || 0).toLocaleString()} msgs{archiveInfo?.first ? `, ${archiveInfo.first} → ${archiveInfo.last}` : ''})
                      </div>
                    </div>
                  )
                })()}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {detail.map((s, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px 18px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 800, color: secColor(s.title), textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>{s.title}</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: 1.55, color: 'var(--foreground)' }}>{s.body}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
