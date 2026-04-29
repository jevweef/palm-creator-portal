'use client'

// /admin/inbox — manage which Telegram chats are being watched by the
// heartbeat bot (@palmmanage_bot). v1: just opt-in / opt-out per chat,
// plus a setup status panel. v2 will add the message feed + AI task
// extraction.

import { useEffect, useState } from 'react'

const BOT_DEEP_LINK = 'https://t.me/palmmanage_bot?startgroup=true'

// ─── helpers ─────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

// ─── small UI bits ───────────────────────────────────────────────────

const card = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: '12px',
  padding: '20px',
  marginBottom: '20px',
}

function StatusPill({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '3px 10px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      background: ok ? 'rgba(120, 200, 120, 0.12)' : 'rgba(232, 120, 120, 0.12)',
      color: ok ? '#7AC97A' : '#E87878',
      border: `1px solid ${ok ? 'rgba(120, 200, 120, 0.3)' : 'rgba(232, 120, 120, 0.3)'}`,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
      {label}
    </span>
  )
}

function Btn({ children, onClick, variant = 'default', disabled }) {
  const variants = {
    default: { background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)' },
    primary: { background: 'var(--palm-pink)', color: '#060606', border: '1px solid var(--palm-pink)' },
    success: { background: 'rgba(120, 200, 120, 0.12)', color: '#7AC97A', border: '1px solid rgba(120, 200, 120, 0.3)' },
    warn:    { background: 'rgba(232, 200, 120, 0.12)', color: '#E8C878', border: '1px solid rgba(232, 200, 120, 0.3)' },
    danger:  { background: 'rgba(232, 120, 120, 0.12)', color: '#E87878', border: '1px solid rgba(232, 120, 120, 0.3)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...variants[variant],
        padding: '6px 14px', borderRadius: '8px',
        fontSize: '12px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: '0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

// ─── Chat row ────────────────────────────────────────────────────────

function ChatRow({ chat, onUpdate }) {
  const [busy, setBusy] = useState(false)

  async function setStatus(status) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/inbox/chats/${chat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Failed to update: ${j.error || res.statusText}`)
        return
      }
      onUpdate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '16px',
      padding: '12px 16px',
      borderRadius: '10px',
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      marginBottom: '8px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '2px' }}>
          {chat.title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', gap: '12px' }}>
          <span>{chat.type}</span>
          <span>·</span>
          <span>{chat.messageCount} msgs</span>
          <span>·</span>
          <span>last {timeAgo(chat.lastMessageAt)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {chat.status !== 'Watching' && (
          <Btn variant="success" onClick={() => setStatus('Watching')} disabled={busy}>Watch</Btn>
        )}
        {chat.status !== 'Ignored' && chat.status !== 'Ignored Forever' && (
          <Btn variant="warn" onClick={() => setStatus('Ignored')} disabled={busy}>Ignore</Btn>
        )}
        {chat.status !== 'Ignored Forever' && (
          <Btn variant="danger" onClick={() => setStatus('Ignored Forever')} disabled={busy}>Ignore Forever</Btn>
        )}
        {chat.status === 'Ignored' || chat.status === 'Ignored Forever' ? (
          <Btn onClick={() => setStatus('Pending Review')} disabled={busy}>Reset</Btn>
        ) : null}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────

export default function InboxAdminPage() {
  const [status, setStatus] = useState(null)
  const [chats, setChats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function refresh() {
    try {
      const [s, c] = await Promise.all([
        fetch('/api/admin/inbox/status').then(r => r.json()),
        fetch('/api/admin/inbox/chats').then(r => r.json()),
      ])
      setStatus(s)
      setChats(c.chats || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // Light polling so new chats appear without manual refresh
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [])

  async function registerWebhook() {
    if (!confirm('Register the webhook with Telegram? (Safe to run multiple times.)')) return
    const res = await fetch('/api/admin/inbox/register-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.origin }),
    })
    const j = await res.json()
    alert(res.ok ? `Webhook registered: ${j.webhookUrl}` : `Failed: ${j.error || res.statusText}`)
    refresh()
  }

  const pending = chats.filter(c => c.status === 'Pending Review')
  const watching = chats.filter(c => c.status === 'Watching')
  const ignored = chats.filter(c => c.status === 'Ignored' || c.status === 'Ignored Forever')

  if (loading) {
    return <div style={{ color: 'var(--foreground-muted)' }}>Loading inbox…</div>
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '6px', color: 'var(--foreground)' }}>
          Inbox
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
          The Palm Management bot is reading messages from chats it's added to.
          Pick which ones the heartbeat should track.
        </p>
      </div>

      {/* Setup status */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Setup</div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
              Bot: <code style={{ color: 'var(--foreground)' }}>@palmmanage_bot</code>
            </div>
          </div>
          <Btn variant="primary" onClick={registerWebhook}>Re-register Webhook</Btn>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <StatusPill ok={status?.env?.tokenSet} label={status?.env?.tokenSet ? 'Bot Token Set' : 'Bot Token Missing'} />
          <StatusPill ok={status?.env?.secretSet} label={status?.env?.secretSet ? 'Secret Set' : 'Secret Missing'} />
          <StatusPill ok={!!status?.telegram?.webhookInfo?.url} label={status?.telegram?.webhookInfo?.url ? 'Webhook Registered' : 'Webhook Not Registered'} />
        </div>
        {status?.telegram?.webhookInfo?.url && (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '12px', wordBreak: 'break-all' }}>
            Pointed at: <code>{status.telegram.webhookInfo.url}</code>
          </div>
        )}
        {status?.telegram?.webhookInfo?.last_error_message && (
          <div style={{ fontSize: '12px', color: '#E87878', marginTop: '8px' }}>
            ⚠️ Last Telegram error: {status.telegram.webhookInfo.last_error_message}
          </div>
        )}
      </div>

      {/* Add bot */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Add to a group</div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
              Tap on your phone — Telegram opens a "select group" picker.
            </div>
          </div>
          <a
            href={BOT_DEEP_LINK}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '8px 16px', borderRadius: '8px',
              background: 'var(--palm-pink)', color: '#060606',
              fontSize: '12px', fontWeight: 700,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            + Add Bot to Group
          </a>
        </div>
      </div>

      {/* Pending Review */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Pending Review ({pending.length})
        </div>
        {pending.length === 0 ? (
          <div style={{ ...card, color: 'var(--foreground-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
            No new chats waiting. Add the bot to a group to see it here.
          </div>
        ) : (
          pending.map(chat => <ChatRow key={chat.id} chat={chat} onUpdate={refresh} />)
        )}
      </div>

      {/* Watching */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Watching ({watching.length})
        </div>
        {watching.length === 0 ? (
          <div style={{ ...card, color: 'var(--foreground-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
            Nothing being tracked yet.
          </div>
        ) : (
          watching.map(chat => <ChatRow key={chat.id} chat={chat} onUpdate={refresh} />)
        )}
      </div>

      {/* Ignored (collapsible) */}
      {ignored.length > 0 && (
        <details style={{ marginBottom: '24px' }}>
          <summary style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Ignored ({ignored.length})
          </summary>
          <div style={{ marginTop: '10px' }}>
            {ignored.map(chat => <ChatRow key={chat.id} chat={chat} onUpdate={refresh} />)}
          </div>
        </details>
      )}

      {error && (
        <div style={{ ...card, borderColor: 'rgba(232, 120, 120, 0.3)', color: '#E87878' }}>
          Error: {error}
        </div>
      )}
    </div>
  )
}
