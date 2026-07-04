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
function writeUrl(account, fan) {
  const params = new URLSearchParams(window.location.search)
  if (account) params.set('account', account); else params.delete('account')
  if (fan) params.set('fan', fan); else params.delete('fan')
  window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? '?' + params : ''}`)
}

export default function LiveChatPage() {
  const [accounts, setAccounts] = useState([])
  const [account, setAccount] = useState(() => fromUrl('account'))
  const [conversations, setConversations] = useState([])
  const [fan, setFan] = useState(() => fromUrl('fan'))
  const [history, setHistory] = useState([])
  const [transcript, setTranscript] = useState(null)
  const [liveEvents, setLiveEvents] = useState([])
  const [lastPoll, setLastPoll] = useState(null)
  const [showMuted, setShowMuted] = useState(false)
  const scroller = useRef(null)
  const timer = useRef(null)

  useEffect(() => {
    fetch('/api/admin/live-chat', { cache: 'no-store' }).then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {})
  }, [])

  // Load conversations when account changes (URL-restored fan survives the
  // first load; manual switches clear it via the select's onChange)
  useEffect(() => {
    if (!account) return
    setConversations([]); setHistory([]); setLiveEvents([])
    writeUrl(account, fan)
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setConversations(d.conversations || []) })
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
        .then((d) => { if (d.conversations) setConversations(d.conversations) })
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

  async function toggleMute(fanKey, mute) {
    setConversations((cs) => cs.map((c) => (c.fan === fanKey ? { ...c, muted: mute } : c)))
    try {
      await fetch('/api/admin/live-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, fan: fanKey, mute }),
      })
    } catch { /* next poll restores truth */ }
  }

  const fmtListTime = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d)) return ''
    const today = new Date().toDateString() === d.toDateString()
    return today
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'America/New_York' })
  }

  const fmtT = (iso) => {
    const d = new Date(iso)
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Live Chat</h1>
        <select value={account} onChange={(e) => { setAccount(e.target.value); setFan(''); writeUrl(e.target.value, '') }}
          style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
          <option value="">Pick a creator…</option>
          {accounts.map((a) => <option key={a.account} value={a.account}>{a.aka}</option>)}
        </select>
        <span style={{ fontSize: '11px', color: '#7DD3A4' }}>● LIVE — auto-updating{lastPoll ? ` · last check ${lastPoll.toLocaleTimeString('en-US')}` : ''}</span>
      </div>

      {!account ? (
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
