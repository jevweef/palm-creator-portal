'use client'

// /admin/inbox — Tasks tab (extracted commitments) + Chats tab (manage which
// Telegram chats the heartbeat bot is watching).
//
// Tab convention: ?tab=tasks (default) or ?tab=chats. Sidebar reads same.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useToast } from '@/lib/useToast'

// Allowlist mirrors the server-side INBOX_OWNER_EMAILS in lib/adminAuth.js.
// Server is the source of truth; client check just hides the UI as a courtesy.
const INBOX_OWNER_EMAILS = ['evan@palm-mgmt.com']

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

function Btn({ children, onClick, variant = 'default', disabled, size = 'md' }) {
  const variants = {
    default: { background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)' },
    primary: { background: 'var(--palm-pink)', color: '#060606', border: '1px solid var(--palm-pink)' },
    success: { background: 'rgba(120, 200, 120, 0.12)', color: '#7AC97A', border: '1px solid rgba(120, 200, 120, 0.3)' },
    warn:    { background: 'rgba(232, 200, 120, 0.12)', color: '#E8C878', border: '1px solid rgba(232, 200, 120, 0.3)' },
    danger:  { background: 'rgba(232, 120, 120, 0.12)', color: '#E87878', border: '1px solid rgba(232, 120, 120, 0.3)' },
  }
  const sizes = {
    sm: { padding: '4px 10px', fontSize: '11px' },
    md: { padding: '6px 14px', fontSize: '12px' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...variants[variant],
        ...sizes[size],
        borderRadius: '8px', fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: '0.15s ease',
      }}
    >
      {children}
    </button>
  )
}

// ─── Tasks tab ───────────────────────────────────────────────────────

const URGENCY_COLOR = {
  Now: '#E87878',
  Soon: '#E8B878',
  Later: '#9aa0a6',
}

const OWNER_COLOR = {
  Evan: '#C8A0E8',
  Josh: '#7AC9E8',
  Other: '#9aa0a6',
}

function TaskCard({ task, onUpdate, toast }) {
  const [busy, setBusy] = useState(false)

  async function setStatus(status) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/inbox/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast(`Failed: ${j.error || res.statusText}`, 'error')
        return
      }
      toast(`Marked ${status.toLowerCase()}`, 'success')
      onUpdate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      ...card,
      marginBottom: '12px', padding: '16px 20px',
      borderLeft: `3px solid ${OWNER_COLOR[task.owner] || OWNER_COLOR.Other}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: '4px',
              color: OWNER_COLOR[task.owner], background: 'rgba(255,255,255,0.04)',
            }}>
              {task.owner}
            </span>
            {task.creatorAka && (
              <span style={{
                fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em',
                padding: '2px 8px', borderRadius: '4px',
                color: 'var(--palm-pink)', background: 'rgba(232, 160, 160, 0.08)',
              }}>
                {task.creatorAka}
              </span>
            )}
            <span style={{
              fontSize: '10px', fontWeight: 600,
              padding: '2px 8px', borderRadius: '4px',
              color: URGENCY_COLOR[task.urgency] || URGENCY_COLOR.Soon,
              background: 'rgba(255,255,255,0.03)',
            }}>
              {task.urgency}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>
              {timeAgo(task.detectedAt)}
            </span>
          </div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
            {task.task}
          </div>
          {task.sourceQuote && (
            <div style={{
              fontSize: '12px', color: 'var(--foreground-muted)',
              fontStyle: 'italic', borderLeft: '2px solid rgba(255,255,255,0.08)',
              paddingLeft: '10px', marginTop: '8px',
            }}>
              "{task.sourceQuote}"
              {task.ownerUsername && (
                <span style={{ marginLeft: '8px', fontStyle: 'normal', opacity: 0.6 }}>
                  — @{task.ownerUsername}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
          <Btn variant="success" size="sm" onClick={() => setStatus('Done')} disabled={busy}>Done</Btn>
          <Btn size="sm" onClick={() => setStatus('Snoozed')} disabled={busy}>Snooze</Btn>
          <Btn variant="danger" size="sm" onClick={() => setStatus('Dismissed')} disabled={busy}>Dismiss</Btn>
        </div>
      </div>
    </div>
  )
}

function TasksTab({ toast }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('Open')
  const [extractBusy, setExtractBusy] = useState(false)

  async function refresh() {
    try {
      const params = new URLSearchParams()
      params.set('status', statusFilter)
      if (ownerFilter !== 'all') params.set('owner', ownerFilter)
      const res = await fetch(`/api/admin/inbox/tasks?${params}`).then(r => r.json())
      setTasks(res.tasks || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [ownerFilter, statusFilter])

  async function runExtractionNow() {
    setExtractBusy(true)
    try {
      const res = await fetch('/api/admin/inbox/extract-now', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(`Extract failed: ${j.error || res.statusText}`, 'error')
      } else {
        const created = j.stats?.tasksCreated || 0
        const chats = j.stats?.chatsProcessed || 0
        const scanned = j.stats?.messagesScanned || 0
        toast(
          created > 0
            ? `Extracted ${created} task${created === 1 ? '' : 's'} from ${chats} chat${chats === 1 ? '' : 's'}`
            : scanned === 0
              ? 'No new messages to scan'
              : `Scanned ${scanned} message${scanned === 1 ? '' : 's'} across ${chats} chat${chats === 1 ? '' : 's'} — nothing actionable`,
          created > 0 ? 'success' : 'info'
        )
        refresh()
      }
    } finally {
      setExtractBusy(false)
    }
  }

  const filterBtn = (label, value, current, set) => (
    <button
      onClick={() => set(value)}
      style={{
        padding: '4px 10px', borderRadius: '6px',
        fontSize: '11px', fontWeight: 600,
        background: current === value ? 'rgba(232, 160, 160, 0.12)' : 'rgba(255,255,255,0.03)',
        color: current === value ? 'var(--palm-pink)' : 'var(--foreground-muted)',
        border: `1px solid ${current === value ? 'rgba(232, 160, 160, 0.3)' : 'rgba(255,255,255,0.06)'}`,
        cursor: 'pointer', transition: '0.15s ease',
      }}
    >{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', alignSelf: 'center', marginRight: '4px' }}>Owner:</span>
          {filterBtn('All', 'all', ownerFilter, setOwnerFilter)}
          {filterBtn('Evan', 'Evan', ownerFilter, setOwnerFilter)}
          {filterBtn('Josh', 'Josh', ownerFilter, setOwnerFilter)}
          <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', alignSelf: 'center', marginLeft: '12px', marginRight: '4px' }}>Status:</span>
          {filterBtn('Open', 'Open', statusFilter, setStatusFilter)}
          {filterBtn('Done', 'Done', statusFilter, setStatusFilter)}
          {filterBtn('Snoozed', 'Snoozed', statusFilter, setStatusFilter)}
          {filterBtn('Dismissed', 'Dismissed', statusFilter, setStatusFilter)}
        </div>
        <Btn variant="primary" size="sm" onClick={runExtractionNow} disabled={extractBusy}>
          {extractBusy ? 'Extracting…' : 'Extract Now'}
        </Btn>
      </div>

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading tasks…</div>
      ) : tasks.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: '14px', color: 'var(--foreground-muted)', marginBottom: '8px' }}>
            No {statusFilter.toLowerCase()} tasks{ownerFilter !== 'all' ? ` for ${ownerFilter}` : ''}.
          </div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
            Tasks are extracted from your watched Telegram chats every 5 min. Hit "Extract Now" to run it immediately.
          </div>
        </div>
      ) : (
        tasks.map(t => <TaskCard key={t.id} task={t} onUpdate={refresh} toast={toast} />)
      )}
    </div>
  )
}

// ─── Chats tab (existing UI) ─────────────────────────────────────────

function ChatRow({ chat, onUpdate, toast, creators }) {
  const [busy, setBusy] = useState(false)

  async function patch(updates) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/inbox/chats/${chat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast(`Failed: ${j.error || res.statusText}`, 'error')
        return
      }
      onUpdate()
    } finally { setBusy(false) }
  }

  function setStatus(status) {
    patch({ status }).then(() => toast(`${chat.title}: ${status.toLowerCase()}`, 'success'))
  }

  function setCreator(aka, hqId) {
    patch({ creatorAka: aka, creatorHqId: hqId }).then(() =>
      toast(aka ? `Mapped to ${aka}` : 'Creator cleared', 'success')
    )
  }

  function onCreatorChange(e) {
    const value = e.target.value
    if (value === '') return setCreator('', '')
    const [hqId, aka] = value.split('|')
    setCreator(aka, hqId)
  }

  // Compute the dropdown value: hqId|aka, or empty
  const dropdownValue = chat.creatorHqId && chat.creatorAka
    ? `${chat.creatorHqId}|${chat.creatorAka}`
    : ''

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '16px',
      padding: '12px 16px', borderRadius: '10px',
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      marginBottom: '8px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {chat.title}
          {chat.source && (
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: '3px',
              color: chat.source === 'imessage' ? '#7AC97A' : '#7AC9E8',
              background: chat.source === 'imessage' ? 'rgba(120, 200, 120, 0.10)' : 'rgba(120, 180, 232, 0.10)',
            }}>
              {chat.source === 'imessage' ? 'iMessage' : 'Telegram'}
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{chat.type}</span><span>·</span>
          <span>{chat.messageCount} msgs</span><span>·</span>
          <span>last {timeAgo(chat.lastMessageAt)}</span>
          <select
            value={dropdownValue}
            onChange={onCreatorChange}
            disabled={busy}
            style={{
              marginLeft: '8px', padding: '3px 8px', borderRadius: '6px',
              fontSize: '11px',
              background: chat.creatorAka ? 'rgba(232, 160, 160, 0.08)' : 'rgba(255,255,255,0.03)',
              color: chat.creatorAka ? 'var(--palm-pink)' : 'var(--foreground-muted)',
              border: `1px solid ${chat.creatorAka ? 'rgba(232, 160, 160, 0.25)' : 'rgba(255,255,255,0.08)'}`,
              cursor: busy ? 'not-allowed' : 'pointer', outline: 'none',
            }}
          >
            <option value="">— no creator —</option>
            {(creators || []).map(c => (
              <option key={c.id} value={`${c.id}|${c.aka}`}>
                {c.aka || c.creator}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {chat.status !== 'Watching' && <Btn variant="success" onClick={() => setStatus('Watching')} disabled={busy}>Watch</Btn>}
        {chat.status !== 'Ignored' && chat.status !== 'Ignored Forever' && <Btn variant="warn" onClick={() => setStatus('Ignored')} disabled={busy}>Ignore</Btn>}
        {chat.status !== 'Ignored Forever' && <Btn variant="danger" onClick={() => setStatus('Ignored Forever')} disabled={busy}>Ignore Forever</Btn>}
        {(chat.status === 'Ignored' || chat.status === 'Ignored Forever') && <Btn onClick={() => setStatus('Watching')} disabled={busy}>Reset</Btn>}
      </div>
    </div>
  )
}

function ChatsTab({ toast }) {
  const [status, setStatus] = useState(null)
  const [chats, setChats] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const [s, c, cr] = await Promise.all([
        fetch('/api/admin/inbox/status').then(r => r.json()),
        fetch('/api/admin/inbox/chats').then(r => r.json()),
        fetch('/api/admin/inbox/creators').then(r => r.json()),
      ])
      setStatus(s)
      setChats(c.chats || [])
      setCreators(cr.creators || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [])

  async function registerWebhook() {
    const res = await fetch('/api/admin/inbox/register-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.origin }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      toast('Webhook re-registered', 'success')
    } else {
      toast(`Failed: ${j.error || res.statusText}`, 'error')
    }
    refresh()
  }

  if (loading) return <div style={{ color: 'var(--foreground-muted)' }}>Loading chats…</div>

  const watching = chats.filter(c => c.status === 'Watching')
  const ignored = chats.filter(c => c.status === 'Ignored' || c.status === 'Ignored Forever')
  const pending = chats.filter(c => c.status === 'Pending Review')

  return (
    <div>
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

      <div style={card}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Add to a group</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            Telegram's deep link only opens the "select group" picker on mobile.
            On desktop it just opens the bot chat — known Telegram quirk.
            Use the QR or the manual steps below.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&bgcolor=ffffff&color=060606&data=${encodeURIComponent(BOT_DEEP_LINK)}`}
              alt="Add Palm Management bot to a group"
              width={180}
              height={180}
              style={{ borderRadius: '8px', background: '#fff' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', textAlign: 'center' }}>
              Scan with your phone's camera
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '220px', fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: '6px' }}>
              Or add manually (works anywhere):
            </div>
            <ol style={{ paddingLeft: '18px', margin: 0 }}>
              <li>Open the group in Telegram</li>
              <li>Tap the group name at top → <b>Add Members</b></li>
              <li>Search <code style={{ color: 'var(--foreground)' }}>palmmanage</code></li>
              <li>Tap <b>Palm Management</b> → toggle <b>Admin Rights OFF</b> → Add</li>
            </ol>
            <a href={BOT_DEEP_LINK} target="_blank" rel="noreferrer" style={{
              display: 'inline-block', marginTop: '12px',
              padding: '6px 12px', borderRadius: '6px',
              background: 'rgba(232, 160, 160, 0.10)', color: 'var(--palm-pink)',
              fontSize: '11px', fontWeight: 600, textDecoration: 'none',
              border: '1px solid rgba(232, 160, 160, 0.25)',
            }}>Try deep link anyway →</a>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pending Review ({pending.length})
          </div>
          {pending.map(chat => <ChatRow key={chat.id} chat={chat} onUpdate={refresh} toast={toast} creators={creators} />)}
        </div>
      )}

      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Watching ({watching.length})
        </div>
        {watching.length === 0 ? (
          <div style={{ ...card, color: 'var(--foreground-muted)', fontSize: '13px', textAlign: 'center', padding: '24px' }}>
            Nothing being tracked yet. Add the bot to a group above.
          </div>
        ) : (
          watching.map(chat => <ChatRow key={chat.id} chat={chat} onUpdate={refresh} toast={toast} creators={creators} />)
        )}
      </div>

      {ignored.length > 0 && (
        <details style={{ marginBottom: '24px' }}>
          <summary style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Ignored ({ignored.length})
          </summary>
          <div style={{ marginTop: '10px' }}>
            {ignored.map(chat => <ChatRow key={chat.id} chat={chat} onUpdate={refresh} toast={toast} creators={creators} />)}
          </div>
        </details>
      )}
    </div>
  )
}

// ─── Page shell ──────────────────────────────────────────────────────

export default function InboxAdminPage() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'tasks'
  const { user, isLoaded } = useUser()
  const { toast, ToastViewport } = useToast()

  if (!isLoaded) {
    return <div style={{ color: 'var(--foreground-muted)' }}>Loading…</div>
  }

  const userEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase()
  const isOwner = INBOX_OWNER_EMAILS.includes(userEmail)

  if (!isOwner) {
    return (
      <div style={{ maxWidth: '500px', marginTop: '60px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
          Inbox is restricted
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
          The Inbox surfaces personal messaging content and is currently limited
          to a single user. If you need access, ask Evan.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '6px', color: 'var(--foreground)' }}>
          Inbox
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
          {tab === 'tasks'
            ? 'Action items extracted from your conversations. Things you said you’d do.'
            : 'Manage which chats are being tracked. Map each chat to a creator.'}
        </p>
      </div>

      {tab === 'chats' ? <ChatsTab toast={toast} /> : <TasksTab toast={toast} />}
      <ToastViewport />
    </div>
  )
}
