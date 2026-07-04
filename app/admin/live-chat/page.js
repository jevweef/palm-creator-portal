'use client'

// LIVE CHAT — real-time message feed straight off the OF webhooks.
// Pick a creator; every fan reply, 1:1 chatter message, and PPV unlock
// appears within seconds (webhook → Dropbox buffer → 8s poll). OF-style
// bubbles: fan left, creator right, unlocks as green money events.

import { useState, useEffect, useRef, useMemo } from 'react'

export default function LiveChatPage() {
  const [accounts, setAccounts] = useState([])
  const [account, setAccount] = useState('')
  const [events, setEvents] = useState([])
  const [fanFilter, setFanFilter] = useState('')
  const [lastPoll, setLastPoll] = useState(null)
  const timer = useRef(null)

  async function poll(acct) {
    try {
      const res = await fetch(`/api/admin/live-chat?account=${encodeURIComponent(acct || '')}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.accounts) setAccounts(data.accounts)
      if (acct) setEvents(data.events || [])
      setLastPoll(new Date())
    } catch { /* next poll */ }
  }

  useEffect(() => { poll('') }, [])
  useEffect(() => {
    if (!account) return
    poll(account)
    timer.current = setInterval(() => poll(account), 8000)
    return () => clearInterval(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  const fans = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      const key = e.fan?.username || e.fan?.name || ''
      if (key && !m.has(key)) m.set(key, e.fan)
    }
    return [...m.entries()]
  }, [events])

  const shown = useMemo(() => {
    const list = fanFilter
      ? events.filter((e) => (e.fan?.username || e.fan?.name || '') === fanFilter)
      : events
    return [...list].reverse() // oldest → newest, like a chat
  }, [events, fanFilter])

  const fmtT = (iso) => {
    const d = new Date(iso)
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Live Chat</h1>
      <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '6px 0 18px' }}>
        Real-time feed off the OF webhooks — fan replies, 1:1 chatter messages, and PPV unlocks appear within seconds.
        {lastPoll && <span> · updated {lastPoll.toLocaleTimeString('en-US')}</span>}
      </p>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select value={account} onChange={(e) => { setAccount(e.target.value); setFanFilter(''); setEvents([]) }}
          style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
          <option value="">Pick a creator…</option>
          {accounts.map((a) => <option key={a.account} value={a.account}>{a.aka}</option>)}
        </select>
        {fans.length > 0 && (
          <select value={fanFilter} onChange={(e) => setFanFilter(e.target.value)}
            style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
            <option value="">All fans ({fans.length})</option>
            {fans.map(([key, f]) => <option key={key} value={key}>{f.name || f.username}{f.username ? ` @${f.username}` : ''}</option>)}
          </select>
        )}
        <span style={{ alignSelf: 'center', fontSize: '11px', color: '#7DD3A4' }}>● LIVE — polling every 8s</span>
      </div>

      {!account ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px', background: 'var(--card-bg-solid)', borderRadius: '12px' }}>
          Pick a creator to watch her conversations live.
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px', background: 'var(--card-bg-solid)', borderRadius: '12px' }}>
          Nothing in the buffer yet — the feed fills as messages happen from this point on. Leave it open.
        </div>
      ) : (
        <div style={{ background: 'var(--card-bg-solid)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {shown.map((e) => {
            const isFan = e.dir === 'in'
            const isUnlock = e.dir === 'unlock'
            return (
              <div key={e.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isFan ? 'flex-start' : 'flex-end' }}>
                <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', margin: '0 6px 2px' }}>
                  {isFan ? `${e.fan?.name || e.fan?.username || 'fan'}` : isUnlock ? `${e.fan?.name || e.fan?.username || 'fan'} unlocked` : 'creator'} · {fmtT(e.at)} ET
                </div>
                <div style={{
                  maxWidth: '70%', padding: '9px 13px', borderRadius: isFan ? '14px 14px 14px 4px' : '14px 14px 4px 14px',
                  fontSize: '13px', lineHeight: 1.45, whiteSpace: 'pre-wrap',
                  background: isUnlock ? 'rgba(125, 211, 164, 0.12)' : isFan ? 'rgba(255,255,255,0.06)' : 'rgba(0, 145, 234, 0.16)',
                  border: isUnlock ? '1px solid rgba(125,211,164,0.35)' : '1px solid rgba(255,255,255,0.05)',
                  color: 'var(--foreground)',
                }}>
                  {isUnlock ? (
                    <b style={{ color: '#7DD3A4' }}>💸 PPV unlocked{e.price ? ` — $${e.price}` : ''}</b>
                  ) : (
                    <>
                      {e.text || <i style={{ color: 'var(--foreground-muted)' }}>(no text)</i>}
                      {(e.price > 0 || e.media > 0) && (
                        <div style={{ marginTop: '5px', display: 'flex', gap: '6px' }}>
                          {e.price > 0 && <span style={{ fontSize: '10px', fontWeight: 700, background: 'rgba(232,200,120,0.15)', color: '#E8C878', padding: '1px 7px', borderRadius: '4px' }}>PPV ${e.price}</span>}
                          {e.media > 0 && <span style={{ fontSize: '10px', fontWeight: 700, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground-muted)', padding: '1px 7px', borderRadius: '4px' }}>📷 {e.media} media</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
