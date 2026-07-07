'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUser } from '@clerk/nextjs'

// Chat-team whale view — the legible replacement for PDF alerts in Telegram.
// Chat managers (Juan & co) log in, see every analysis (manager brief up
// front, full analysis expandable), and can request new ones. Telegram alerts
// deep-link here via ?fan=<username>.

const fmtD = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })
}

export default function ChatTeamPage() {
  const { user, isLoaded } = useUser()
  const [analyses, setAnalyses] = useState(null)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [search, setSearch] = useState('')
  const [req, setReq] = useState({ creator: '', fanName: '', note: '' })
  const [reqState, setReqState] = useState(null) // 'sending' | 'sent' | error string

  const role = user?.publicMetadata?.role
  const allowed = ['admin', 'super_admin', 'chat_manager'].includes(role)

  useEffect(() => {
    if (!isLoaded || !allowed) return
    fetch('/api/chat-team/analyses', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setAnalyses(d.analyses || [])
        // deep link: ?fan=<username or name> opens that fan's newest analysis
        try {
          const target = (new URLSearchParams(window.location.search).get('fan') || '').toLowerCase()
          if (target) {
            const hit = (d.analyses || []).find((a) => a.fanName.toLowerCase().includes(target))
            if (hit) setOpenId(hit.id)
          }
        } catch { /* no window */ }
      })
      .catch((e) => setError(e.message))
  }, [isLoaded, allowed])

  const filtered = useMemo(() => {
    if (!analyses) return []
    const q = search.trim().toLowerCase()
    if (!q) return analyses
    return analyses.filter((a) => a.fanName.toLowerCase().includes(q) || a.creator.toLowerCase().includes(q))
  }, [analyses, search])

  async function submitRequest(e) {
    e.preventDefault()
    if (!req.fanName.trim()) return
    setReqState('sending')
    try {
      const res = await fetch('/api/chat-team/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Request failed')
      setReqState('sent')
      setReq({ creator: '', fanName: '', note: '' })
      setTimeout(() => setReqState(null), 4000)
    } catch (err) { setReqState(err.message) }
  }

  if (!isLoaded) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Loading…</div>
  if (!user) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Sign in to view this page.</div>
  if (!allowed) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>This page is for the chat team. Ask Evan for access.</div>

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background, #141414)', color: 'var(--foreground, #F0ECE8)' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 20px 80px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 4px' }}>Whale Analyses</h1>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted, #8B8680)', marginBottom: '20px' }}>
          Newest first. The short brief is the play — open a card for the full breakdown.
        </div>

        {/* Request an analysis */}
        <form onSubmit={submitRequest} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px 14px', marginBottom: '22px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground-muted, #8B8680)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Request an analysis</span>
          <input value={req.fanName} onChange={(e) => setReq({ ...req, fanName: e.target.value })} placeholder="Fan name / @username" required
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: 'inherit', minWidth: '180px' }} />
          <input value={req.creator} onChange={(e) => setReq({ ...req, creator: e.target.value })} placeholder="Creator"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: 'inherit', minWidth: '120px' }} />
          <input value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} placeholder="Why? (optional)"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: 'inherit', flex: 1, minWidth: '160px' }} />
          <button type="submit" disabled={reqState === 'sending'}
            style={{ background: 'rgba(160,111,232,0.2)', border: '1px solid rgba(160,111,232,0.45)', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, color: '#C4A5F7', cursor: 'pointer' }}>
            {reqState === 'sending' ? 'Sending…' : 'Send request'}
          </button>
          {reqState === 'sent' && <span style={{ fontSize: '12px', color: '#7DD3A4' }}>Request sent — it goes straight to Evan.</span>}
          {reqState && reqState !== 'sending' && reqState !== 'sent' && <span style={{ fontSize: '12px', color: '#E87878' }}>{reqState}</span>}
        </form>

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fan or creator…"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: 'inherit', width: '100%', marginBottom: '16px' }} />

        {error && <div style={{ color: '#E87878', fontSize: '13px', marginBottom: '14px' }}>{error}</div>}
        {!analyses && !error && <div style={{ color: 'var(--foreground-muted, #8B8680)', fontSize: '13px' }}>Loading analyses…</div>}
        {analyses && filtered.length === 0 && <div style={{ color: 'var(--foreground-muted, #8B8680)', fontSize: '13px' }}>No analyses match.</div>}

        {filtered.map((a) => {
          const open = openId === a.id
          return (
            <div key={a.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', marginBottom: '10px', overflow: 'hidden' }}>
              <button onClick={() => setOpenId(open ? null : a.id)}
                style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: '10px', background: 'none', border: 'none', color: 'inherit', textAlign: 'left', padding: '12px 16px', cursor: 'pointer' }}>
                <span style={{ fontWeight: 700, fontSize: '14px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fanName}</span>
                <span style={{ fontSize: '12px', color: '#C4A5F7', whiteSpace: 'nowrap' }}>{a.creator}</span>
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted, #8B8680)', whiteSpace: 'nowrap' }}>{fmtD(a.analyzedAt)}</span>
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted, #8B8680)' }}>{open ? '▲' : '▼'}</span>
              </button>
              {a.managerBrief && (
                <div style={{ padding: '0 16px 12px', fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#E8D5A8', borderBottom: open ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  {a.managerBrief.replace(/\*\*/g, '')}
                </div>
              )}
              {open && a.fullAnalysis && (
                <div style={{ padding: '14px 16px', fontSize: '13px', lineHeight: 1.65, whiteSpace: 'pre-wrap', color: 'var(--foreground, #F0ECE8)', maxHeight: '70vh', overflowY: 'auto' }}>
                  {a.fullAnalysis.replace(/\*\*/g, '')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
