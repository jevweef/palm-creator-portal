'use client'

// /admin/team — invite chat managers by email + team, see pending invites,
// revoke, and see who's already enrolled. Invitation-only access: signing up
// without an invite grants NO role, so this page is the only door.

import { useEffect, useState } from 'react'

const card = { background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '18px 20px', marginBottom: '16px' }

export default function TeamAccessPage() {
  const [email, setEmail] = useState('')
  const [team, setTeam] = useState('A')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }
  const [invites, setInvites] = useState([])
  const [managers, setManagers] = useState([])

  const load = () => {
    fetch('/api/admin/invites', { cache: 'no-store' }).then((r) => r.json()).then((d) => setInvites(d.invites || [])).catch(() => {})
    fetch('/api/photo-library/list-chat-managers', { cache: 'no-store' }).then((r) => r.json()).then((d) => setManagers(d.users || [])).catch(() => {})
  }
  useEffect(load, [])

  const sendInvite = async (asLink = false) => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, chatTeam: team, asLink }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'invite failed')
      if (asLink && d.url) {
        try { await navigator.clipboard.writeText(d.url) } catch {}
        setMsg({ ok: true, text: `Invite link created for ${d.email} (Team ${team}) and copied to your clipboard — send it to her however you like. It only works for that email.`, url: d.url })
      } else {
        setMsg({ ok: true, text: `Invitation emailed to ${d.email} — Team ${team} chat manager. She clicks the link, sets a password, and lands with access already scoped.` })
      }
      setEmail('')
      load()
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally { setBusy(false) }
  }

  const revoke = async (id) => {
    await fetch('/api/admin/invites', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {})
    load()
  }

  return (
    <div style={{ maxWidth: '760px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>Team Access</h1>
      <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '18px' }}>
        Invite a chat manager by email. Access is invitation-only — anyone who signs up without an invite gets no role and sees nothing.
      </p>

      <div style={card}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '12px' }}>Invite a chat manager</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="her@email.com" type="email"
            style={{ flex: '1 1 240px', background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '9px 12px', fontSize: '13px' }} />
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden' }}>
            {['A', 'B'].map((t) => (
              <button key={t} onClick={() => setTeam(t)}
                style={{ padding: '9px 16px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: team === t ? 'var(--palm-pink)' : 'transparent', color: team === t ? '#060606' : 'var(--foreground-muted)' }}>
                Team {t}
              </button>
            ))}
          </div>
          <button onClick={() => sendInvite(false)} disabled={busy || !email}
            style={{ background: 'var(--palm-pink)', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, color: '#060606', cursor: busy || !email ? 'not-allowed' : 'pointer', opacity: busy || !email ? 0.6 : 1 }}>
            {busy ? 'Working…' : 'Email invite'}
          </button>
          <button onClick={() => sendInvite(true)} disabled={busy || !email}
            style={{ background: 'transparent', border: '1px solid var(--palm-pink)', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, color: 'var(--palm-pink)', cursor: busy || !email ? 'not-allowed' : 'pointer', opacity: busy || !email ? 0.6 : 1 }}>
            Copy invite link
          </button>
        </div>
        {msg && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: msg.ok ? '#7DD3A4' : '#E87878', background: msg.ok ? 'rgba(125,211,164,0.08)' : 'rgba(232,120,120,0.08)', border: `1px solid ${msg.ok ? 'rgba(125,211,164,0.25)' : 'rgba(232,120,120,0.25)'}`, borderRadius: '8px', padding: '10px 12px' }}>
            {msg.text}
            {msg.url && <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', userSelect: 'all' }}>{msg.url}</div>}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '10px' }}>Pending invitations</div>
        {invites.length === 0 && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>None waiting.</div>}
        {invites.map((i) => (
          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '13px' }}>
            <span>{i.email} <span style={{ color: 'var(--foreground-muted)', fontSize: '11px' }}>· {i.role || 'no role'}{i.chatTeam ? ` · Team ${i.chatTeam}` : ''}</span></span>
            <span style={{ display: 'flex', gap: '6px' }}>
              {i.url && (
                <button onClick={async () => { try { await navigator.clipboard.writeText(i.url); setMsg({ ok: true, text: `Invite link for ${i.email} copied — send it however you like.` }) } catch { setMsg({ ok: false, text: 'Copy failed — long-press the Revoke row URL instead.' }) } }}
                  style={{ background: 'none', border: '1px solid var(--palm-pink)', color: 'var(--palm-pink)', borderRadius: '6px', padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}>Copy link</button>
              )}
              <button onClick={() => revoke(i.id)} style={{ background: 'none', border: '1px solid rgba(232,120,120,0.4)', color: '#E87878', borderRadius: '6px', padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}>Revoke</button>
            </span>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '10px' }}>Enrolled chat managers</div>
        {managers.length === 0 && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>None yet.</div>}
        {managers.map((m) => (
          <div key={m.id} style={{ padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '13px' }}>
            {m.fullName || m.email} <span style={{ color: 'var(--foreground-muted)', fontSize: '11px' }}>· {m.email}{m.chatTeam ? ` · Team ${m.chatTeam}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
