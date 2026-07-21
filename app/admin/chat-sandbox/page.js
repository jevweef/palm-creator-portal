'use client'

import { useEffect, useRef, useState } from 'react'

// Live-chat sandbox: you're the fan, the AI is the model (her voice card +
// persona). Same brain as the live-chat Suggest, as a natural back-and-forth
// with realistic typing delays, so you can feel out how she chats.
export default function ChatSandboxPage() {
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [messages, setMessages] = useState([]) // {role:'fan'|'model', text, error?}
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)   // the "typing…" bubble (only after the read lag)
  const [realistic, setRealistic] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    fetch('/api/admin/chat-sandbox')
      .then((r) => r.json())
      .then((d) => {
        const list = d.creators || []
        setCreators(list)
        const caitie = list.find((c) => /caitie|katie/i.test(c.name))
        setCreatorId(caitie?.id || list[0]?.id || '')
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, typing])

  const messagesRef = useRef([])
  const turnRef = useRef(0)          // supersede token — a new fan message invalidates the in-flight reply
  const abortRef = useRef(null)
  const herLastReplyRef = useRef(0)  // when she last texted back (0 = never)
  const batchStartRef = useRef(0)    // when the current run of unanswered fan texts began (0 = none pending)
  const readUntilRef = useRef(0)     // absolute time she'll come online + start typing (anchored, not reset by double-texts)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const creatorName = creators.find((c) => c.id === creatorId)?.name || 'the model'
  const reset = () => { turnRef.current += 1; abortRef.current?.abort(); messagesRef.current = []; herLastReplyRef.current = 0; batchStartRef.current = 0; setMessages([]); setInput(''); setTyping(false) }

  // Generate (or re-generate) her reply against the LATEST conversation. Every
  // fan message calls this. A double-text aborts the in-flight reply and restarts
  // against the fuller convo (the newest text can change her answer), but the
  // read lag is ANCHORED (readUntilRef) so double-texting doesn't reset it.
  const generate = async () => {
    const myTurn = ++turnRef.current
    const stale = () => myTurn !== turnRef.current
    abortRef.current?.abort()
    const ctrl = new AbortController(); abortRef.current = ctrl
    setTyping(false)
    const apiP = fetch('/api/admin/chat-sandbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creatorId, messages: messagesRef.current }), signal: ctrl.signal,
    }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'failed'); return d })
    try {
      await sleep(Math.max(0, readUntilRef.current - Date.now())); if (stale()) return
      setTyping(true)                                   // she's online + reading/typing now
      const d = await apiP;                             if (stale()) return
      const msgs = (d.messages && d.messages.length) ? d.messages : ['(no reply)']
      const typing = d.typing || []
      for (let i = 0; i < msgs.length; i++) {
        const tms = realistic ? Math.max(500, typing[i] || 1500) : 100
        await sleep(tms);                               if (stale()) return
        setTyping(false)
        setMessages((m) => { const next = [...m, { role: 'model', text: msgs[i] }]; messagesRef.current = next; return next })
        if (i < msgs.length - 1) { await sleep(realistic ? (700 + Math.random() * 1000) : 90); if (stale()) return; setTyping(true) }
      }
      herLastReplyRef.current = Date.now()
      batchStartRef.current = 0                          // batch answered
    } catch (e) {
      if (e.name === 'AbortError' || stale()) return
      setMessages((m) => [...m, { role: 'model', text: `(error: ${e.message})`, error: true }])
      setTyping(false); batchStartRef.current = 0
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || !creatorId) return
    // If no fan texts are currently waiting on her, THIS starts a new batch — pick
    // her response speed by warmth: cold (never replied, or it's been quiet a
    // while → she's off doing something and has to notice the notification) is
    // slow; an active convo is quick. Double-texts keep the same anchored lag.
    if (!batchStartRef.current) {
      const cold = herLastReplyRef.current === 0 || (Date.now() - herLastReplyRef.current) > 90000
      const lag = realistic ? (cold ? (30000 + Math.random() * 30000) : (2500 + Math.random() * 9000)) : 250
      batchStartRef.current = Date.now()
      readUntilRef.current = Date.now() + lag
    }
    const next = [...messagesRef.current, { role: 'fan', text }]
    messagesRef.current = next
    setMessages(next)
    setInput('')
    generate()
  }

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Chat Sandbox</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={creatorId} onChange={(e) => { setCreatorId(e.target.value); reset() }}
            style={{ padding: '7px 10px', fontSize: 13, background: 'var(--card-bg-solid, #1a1a1a)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}>
            {creators.map((c) => <option key={c.id} value={c.id}>{c.name}{c.rich ? '' : ' (thin persona)'}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--foreground-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={realistic} onChange={(e) => setRealistic(e.target.checked)} /> Realistic timing
          </label>
          <button onClick={reset} style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--foreground)', cursor: 'pointer' }}>Reset</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 14 }}>
        You&apos;re the fan. <strong style={{ color: 'var(--foreground)' }}>{creatorName}</strong> replies as herself, in her voice. Nothing here touches real fans or gets sent anywhere.
      </div>

      <div ref={scrollRef} style={{ height: '58vh', minHeight: 340, overflowY: 'auto', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && !typing && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--foreground-subtle)', fontSize: 13, maxWidth: 320 }}>
            Say something as the fan to start. Try different openers — a whale dropping a big compliment, a cheap fan haggling, someone going quiet, a weird request — and see how she handles it.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'fan' ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
            <div style={{ fontSize: 10, color: 'var(--foreground-subtle)', margin: m.role === 'fan' ? '0 4px 3px 0' : '0 0 3px 4px', textAlign: m.role === 'fan' ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {m.role === 'fan' ? 'You (fan)' : creatorName}
            </div>
            <div style={{
              padding: '9px 13px', borderRadius: 14, fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap',
              background: m.role === 'fan' ? 'var(--palm-pink, #E88FAC)' : (m.error ? 'rgba(232,120,120,0.12)' : 'rgba(255,255,255,0.06)'),
              color: m.role === 'fan' ? '#1a0e12' : (m.error ? '#e88' : 'var(--foreground)'),
              borderTopRightRadius: m.role === 'fan' ? 4 : 14, borderTopLeftRadius: m.role === 'fan' ? 14 : 4,
            }}>{m.text}</div>
          </div>
        ))}
        {typing && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '78%' }}>
            <div style={{ fontSize: 10, color: 'var(--foreground-subtle)', margin: '0 0 3px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{creatorName}</div>
            <div style={{ padding: '11px 14px', borderRadius: 14, borderTopLeftRadius: 4, background: 'rgba(255,255,255,0.06)', display: 'inline-flex', gap: 4 }}>
              <Dot /><Dot d={0.2} /><Dot d={0.4} />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1}
          placeholder={loaded ? 'Message as the fan…  (Enter to send, Shift+Enter for newline)' : 'Loading…'}
          disabled={!loaded || !creatorId}
          style={{ flex: 1, resize: 'none', padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)', fontSize: 14, fontFamily: 'inherit' }} />
        <button onClick={send} disabled={!input.trim() || !creatorId}
          style={{ padding: '0 20px', borderRadius: 12, border: 'none', background: 'var(--palm-pink, #E88FAC)', color: '#1a0e12', fontSize: 14, fontWeight: 700, cursor: input.trim() ? 'pointer' : 'default', opacity: input.trim() ? 1 : 0.5 }}>Send</button>
      </div>
      <style>{`@keyframes sbdot { 0%,60%,100%{opacity:0.25;transform:translateY(0)} 30%{opacity:1;transform:translateY(-3px)} }`}</style>
    </div>
  )
}

function Dot({ d = 0 }) {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--foreground-muted)', display: 'inline-block', animation: `sbdot 1.2s ${d}s infinite ease-in-out` }} />
}
