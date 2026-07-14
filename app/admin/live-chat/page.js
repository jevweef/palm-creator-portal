'use client'

// LIVE CHAT — OF-style two-pane view fed by the webhooks.
// Left: conversations (archived deep-pull fans + anyone with live activity).
// Right: the thread — archive history + live events, updating every 8s.

import { useState, useEffect, useRef, useMemo } from 'react'

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

export default function LiveChatPage() {
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
  useEffect(() => { setSuggestion(null); setGrabInfo(null) }, [account, fan])
  const [history, setHistory] = useState([])
  const [transcript, setTranscript] = useState(null)
  const [liveEvents, setLiveEvents] = useState([])
  const [lastPoll, setLastPoll] = useState(null)
  const [showMuted, setShowMuted] = useState(false)
  const [view, setView] = useState(() => fromUrl('tab') || 'inbox') // 'inbox' | 'in' | 'out' | 'sales'
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
    setConversations([]); setHistory([]); setLiveEvents([])
    writeUrl(account, fan)
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setConversations(overlayMutes(account, d.conversations || [])) })
      .catch(() => {})
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
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}&fan=${encodeURIComponent(fan)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setHistory(d.history || []); setTranscript(d.transcript || null); setLiveEvents(d.live || []); setLastPoll(new Date()) })
      .catch(() => {})
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
      const msgs = thread.map((m) => ({ dir: m.dir, text: m.text, price: m.price }))
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
    <div style={{ padding: '24px 32px', maxWidth: '1700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Live Chat</h1>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden' }}>
          {[['inbox', 'Inbox'], ['in', 'Incoming'], ['out', 'Outgoing'], ['sales', 'Sales']].map(([k, label]) => (
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
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '0', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', overflow: 'hidden', height: 'calc(100vh - 170px)' }}>

          {/* ── Conversation list ── */}
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              Conversations ({conversations.length})
            </div>
            {conversations.length === 0 && (
              <div style={{ padding: '20px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
                No archived or live conversations yet for this creator.
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
          </div>

          {/* ── Thread ── */}
          {!fan ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>
              Pick a conversation.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>
                @{fan}
              </div>
              <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {thread.length === 0 && !transcript && (
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
        </div>
      )}
    </div>
  )
}
