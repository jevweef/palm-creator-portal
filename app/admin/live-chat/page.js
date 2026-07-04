'use client'

// LIVE CHAT — OF-style two-pane view fed by the webhooks.
// Left: conversations (archived deep-pull fans + anyone with live activity).
// Right: the thread — archive history + live events, updating every 8s.

import { useState, useEffect, useRef, useMemo } from 'react'

export default function LiveChatPage() {
  const [accounts, setAccounts] = useState([])
  const [account, setAccount] = useState('')
  const [conversations, setConversations] = useState([])
  const [fan, setFan] = useState('')
  const [history, setHistory] = useState([])
  const [liveEvents, setLiveEvents] = useState([])
  const [lastPoll, setLastPoll] = useState(null)
  const scroller = useRef(null)
  const timer = useRef(null)

  useEffect(() => {
    fetch('/api/admin/live-chat', { cache: 'no-store' }).then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {})
  }, [])

  // Load conversations when account changes
  useEffect(() => {
    if (!account) return
    setConversations([]); setFan(''); setHistory([]); setLiveEvents([])
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setConversations(d.conversations || []) })
      .catch(() => {})
  }, [account])

  // Load thread when fan changes; then poll live buffer
  useEffect(() => {
    if (!account || !fan) return
    fetch(`/api/admin/live-chat?account=${encodeURIComponent(account)}&fan=${encodeURIComponent(fan)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setHistory(d.history || []); setLiveEvents(d.live || []); setLastPoll(new Date()) })
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
    }, 8000)
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

  const fmtT = (iso) => {
    const d = new Date(iso)
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Live Chat</h1>
        <select value={account} onChange={(e) => setAccount(e.target.value)}
          style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
          <option value="">Pick a creator…</option>
          {accounts.map((a) => <option key={a.account} value={a.account}>{a.aka}</option>)}
        </select>
        <span style={{ fontSize: '11px', color: '#7DD3A4' }}>● LIVE — updates every 8s{lastPoll ? ` · last check ${lastPoll.toLocaleTimeString('en-US')}` : ''}</span>
      </div>

      {!account ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px', background: 'var(--card-bg-solid)', borderRadius: '12px' }}>
          Pick a creator to open her inbox.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '0', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', overflow: 'hidden', height: 'calc(100vh - 170px)' }}>

          {/* ── Conversation list ── */}
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto', minHeight: 0 }}>
            <div style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              Conversations ({conversations.length})
            </div>
            {conversations.length === 0 && (
              <div style={{ padding: '20px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
                No archived or live conversations yet for this creator.
              </div>
            )}
            {conversations.map((c) => {
              const active = fan === c.fan
              const isLive = c.lastAt && (Date.now() - new Date(c.lastAt)) < 30 * 60000
              return (
                <div key={c.fan} onClick={() => setFan(c.fan)}
                  style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '11px 14px', cursor: 'pointer', background: active ? 'rgba(160,111,232,0.10)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'rgba(160,111,232,0.10)' : 'transparent' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(160,111,232,0.18)', color: '#C4A5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                    {(c.name || c.fan).slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name || c.fan} {isLive && <span style={{ color: '#7DD3A4', fontSize: '10px' }}>● live</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.lastText || (c.archived ? 'archived history' : '')}
                    </div>
                  </div>
                </div>
              )
            })}
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
                {thread.length === 0 && <div style={{ color: 'var(--foreground-muted)', fontSize: '12px', textAlign: 'center', marginTop: '40px' }}>No messages loaded — history appears after a chat pull; live messages appear as they happen.</div>}
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
