'use client'

// /admin/inbox — Tasks tab (extracted commitments) + Chats tab (manage which
// Telegram chats the heartbeat bot is watching).
//
// Tab convention: ?tab=tasks (default) or ?tab=chats. Sidebar reads same.

import { useEffect, useRef, useState } from 'react'
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

// ─── Chats tab — iMessage-style two-pane view ────────────────────────

const STATUS_LABELS = {
  'Pending Review': 'Pending',
  'Watching': 'Watching',
  'Ignored': 'Ignored',
  'Ignored Forever': 'Blocked',
}

const STATUS_COLOR = {
  'Pending Review': '#E8C878',
  'Watching': '#7AC97A',
  'Ignored': '#9aa0a6',
  'Ignored Forever': '#E87878',
}

function ChatListItem({ chat, selected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px 14px',
        borderRadius: '10px',
        background: selected ? 'rgba(232, 160, 160, 0.10)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(232, 160, 160, 0.25)' : 'transparent'}`,
        cursor: 'pointer',
        marginBottom: '2px',
        transition: '0.12s ease',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Avatar circle */}
      <div style={{
        width: '36px', height: '36px', borderRadius: '50%',
        background: chat.source === 'imessage' ? 'rgba(120, 200, 120, 0.15)' : 'rgba(120, 180, 232, 0.15)',
        color: chat.source === 'imessage' ? '#7AC97A' : '#7AC9E8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px', fontWeight: 700, flexShrink: 0,
      }}>
        {(chat.title || '?').slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '13px', fontWeight: selected ? 700 : 600,
          color: selected ? 'var(--palm-pink)' : 'var(--foreground)',
          marginBottom: '2px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {chat.title}
        </div>
        <div style={{
          fontSize: '10px', color: 'var(--foreground-muted)',
          display: 'flex', gap: '6px', alignItems: 'center',
        }}>
          {chat.creatorAka && (
            <span style={{
              padding: '0 4px', borderRadius: '3px',
              color: 'var(--palm-pink)', background: 'rgba(232, 160, 160, 0.10)',
              fontWeight: 600,
            }}>
              {chat.creatorAka}
            </span>
          )}
          <span>{chat.messageCount}</span>
          <span>·</span>
          <span>{timeAgo(chat.lastMessageAt)}</span>
        </div>
      </div>
      <div style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: STATUS_COLOR[chat.status] || 'transparent',
        flexShrink: 0,
      }} />
    </div>
  )
}

function MessageBubble({ msg, prevMsg, isGroup }) {
  const isFromMe = msg.isFromMe
  // Show sender name above the first message in a chain from this sender,
  // only in groups (in 1-on-1 it's always obvious who it is).
  const showSender = isGroup && !isFromMe && (!prevMsg || prevMsg.senderUsername !== msg.senderUsername || prevMsg.isFromMe)
  // Show timestamp if first message OR more than 30 min gap from previous
  const showTime = !prevMsg || (
    msg.sentAt && prevMsg.sentAt &&
    new Date(msg.sentAt).getTime() - new Date(prevMsg.sentAt).getTime() > 30 * 60 * 1000
  )

  return (
    <>
      {showTime && msg.sentAt && (
        <div style={{
          textAlign: 'center', fontSize: '10px', color: 'var(--foreground-muted)',
          padding: '8px 0',
        }}>
          {new Date(msg.sentAt).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })}
        </div>
      )}
      {showSender && (
        <div style={{
          fontSize: '10px', color: 'var(--foreground-muted)',
          marginLeft: '12px', marginTop: '4px', marginBottom: '2px',
          fontWeight: 600,
        }}>
          {msg.senderName || msg.senderUsername || 'Unknown'}
        </div>
      )}
      <div style={{
        display: 'flex',
        justifyContent: isFromMe ? 'flex-end' : 'flex-start',
        marginBottom: '3px',
        padding: '0 8px',
      }}>
        <div style={{
          maxWidth: '70%',
          padding: '8px 13px',
          borderRadius: '18px',
          background: isFromMe ? '#0B84FE' : 'rgba(255,255,255,0.08)',
          color: isFromMe ? '#fff' : 'var(--foreground)',
          fontSize: '14px', lineHeight: 1.35,
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}>
          {msg.text || (msg.hasMedia ? `[${msg.mediaType || 'media'}]` : '[empty]')}
        </div>
      </div>
    </>
  )
}

function ChatThread({ chat, onUpdate, toast, creators }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!chat) return
    setLoading(true)
    setMessages([])
    fetch(`/api/admin/inbox/chats/${chat.id}/messages?limit=200`)
      .then(r => r.json())
      .then(j => setMessages(j.messages || []))
      .finally(() => setLoading(false))
  }, [chat?.id])

  // Auto-scroll to bottom when messages load
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function patch(updates, successMsg) {
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
      if (successMsg) toast(successMsg, 'success')
      onUpdate()
    } finally { setBusy(false) }
  }

  function setStatus(status) {
    patch({ status }, `${chat.title}: ${status.toLowerCase()}`)
  }

  function onCreatorChange(e) {
    const value = e.target.value
    if (value === '') return patch({ creatorAka: '', creatorHqId: '' }, 'Creator cleared')
    const [hqId, aka] = value.split('|')
    patch({ creatorAka: aka, creatorHqId: hqId }, `Mapped to ${aka}`)
  }

  if (!chat) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--foreground-muted)', fontSize: '13px',
      }}>
        Select a conversation
      </div>
    )
  }

  const isGroup = chat.type === 'group' || chat.type === 'supergroup'
  const dropdownValue = chat.creatorHqId && chat.creatorAka ? `${chat.creatorHqId}|${chat.creatorAka}` : ''

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '15px', fontWeight: 700, color: 'var(--foreground)',
            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
          }}>
            {chat.title}
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: '3px',
              color: chat.source === 'imessage' ? '#7AC97A' : '#7AC9E8',
              background: chat.source === 'imessage' ? 'rgba(120, 200, 120, 0.10)' : 'rgba(120, 180, 232, 0.10)',
            }}>
              {chat.source === 'imessage' ? 'iMessage' : 'Telegram'}
            </span>
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '1px 6px', borderRadius: '3px',
              color: STATUS_COLOR[chat.status],
              background: 'rgba(255,255,255,0.04)',
            }}>
              {STATUS_LABELS[chat.status]}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
            {chat.type} · {chat.messageCount} msgs · last {timeAgo(chat.lastMessageAt)}
          </div>
        </div>
        <select
          value={dropdownValue}
          onChange={onCreatorChange}
          disabled={busy}
          style={{
            padding: '5px 10px', borderRadius: '6px', fontSize: '11px',
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

      {/* Action bar */}
      <div style={{
        padding: '8px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', gap: '6px',
        background: 'rgba(255,255,255,0.01)',
      }}>
        {chat.status !== 'Watching' && <Btn variant="success" size="sm" onClick={() => setStatus('Watching')} disabled={busy}>Watch</Btn>}
        {chat.status !== 'Ignored' && chat.status !== 'Ignored Forever' && <Btn variant="warn" size="sm" onClick={() => setStatus('Ignored')} disabled={busy}>Ignore</Btn>}
        {chat.status !== 'Ignored Forever' && <Btn variant="danger" size="sm" onClick={() => setStatus('Ignored Forever')} disabled={busy}>Ignore Forever</Btn>}
        {(chat.status === 'Ignored' || chat.status === 'Ignored Forever') && <Btn size="sm" onClick={() => setStatus('Pending Review')} disabled={busy}>Reset</Btn>}
      </div>

      {/* Message thread */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '12px 0',
      }}>
        {loading ? (
          <div style={{ color: 'var(--foreground-muted)', fontSize: '12px', textAlign: 'center', padding: '40px 0' }}>
            Loading messages…
          </div>
        ) : (() => {
          // Filter out genuinely-empty messages (no text, no media). These are
          // typically system events or stripped messages — noise in the thread.
          const visible = messages.filter(m => m.text || m.hasMedia)
          if (visible.length === 0) {
            return (
              <div style={{ color: 'var(--foreground-muted)', fontSize: '12px', textAlign: 'center', padding: '40px 20px' }}>
                No readable messages stored for this chat yet.
                {chat.status === 'Watching'
                  ? ' Newly arriving messages will appear here.'
                  : ' Hit Watch above to start storing them as they arrive.'}
              </div>
            )
          }
          return visible.map((m, i) => (
            <MessageBubble key={m.id} msg={m} prevMsg={visible[i - 1]} isGroup={isGroup} />
          ))
        })()}
      </div>
    </div>
  )
}

function ChatList({ chats, selectedId, onSelect, filter, setFilter }) {
  const filtered = chats.filter(c => {
    if (filter === 'all') return true
    if (filter === 'pending') return c.status === 'Pending Review'
    if (filter === 'watching') return c.status === 'Watching'
    if (filter === 'ignored') return c.status === 'Ignored' || c.status === 'Ignored Forever'
    return true
  })

  const filterPill = (key, label, count) => (
    <button
      onClick={() => setFilter(key)}
      style={{
        padding: '4px 10px', borderRadius: '6px',
        fontSize: '11px', fontWeight: 600,
        background: filter === key ? 'rgba(232, 160, 160, 0.12)' : 'rgba(255,255,255,0.03)',
        color: filter === key ? 'var(--palm-pink)' : 'var(--foreground-muted)',
        border: `1px solid ${filter === key ? 'rgba(232, 160, 160, 0.3)' : 'rgba(255,255,255,0.06)'}`,
        cursor: 'pointer',
      }}
    >{label} {count > 0 && `· ${count}`}</button>
  )

  const counts = {
    all: chats.length,
    pending: chats.filter(c => c.status === 'Pending Review').length,
    watching: chats.filter(c => c.status === 'Watching').length,
    ignored: chats.filter(c => c.status === 'Ignored' || c.status === 'Ignored Forever').length,
  }

  return (
    <div style={{
      width: '320px', flexShrink: 0,
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '12px 12px 8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {filterPill('pending', 'Pending', counts.pending)}
        {filterPill('watching', 'Watching', counts.watching)}
        {filterPill('all', 'All', counts.all)}
        {filterPill('ignored', 'Ignored', counts.ignored)}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>
        {filtered.length === 0 ? (
          <div style={{ color: 'var(--foreground-muted)', fontSize: '12px', textAlign: 'center', padding: '40px 12px' }}>
            No chats here.
          </div>
        ) : (
          filtered.map(chat => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              selected={chat.id === selectedId}
              onClick={() => onSelect(chat)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ChatsTab({ toast }) {
  const [status, setStatus] = useState(null)
  const [chats, setChats] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [showSetup, setShowSetup] = useState(false)

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
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [])

  async function registerWebhook() {
    const res = await fetch('/api/admin/inbox/register-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.origin }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) toast('Webhook re-registered', 'success')
    else toast(`Failed: ${j.error || res.statusText}`, 'error')
    refresh()
  }

  if (loading) return <div style={{ color: 'var(--foreground-muted)' }}>Loading chats…</div>

  const selectedChat = chats.find(c => c.id === selectedId) || null

  return (
    <div>
      {/* Collapsible setup section */}
      <div style={{ marginBottom: '12px' }}>
        <button
          onClick={() => setShowSetup(s => !s)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--foreground-muted)',
            fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', cursor: 'pointer', padding: '4px 0',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          <span style={{ display: 'inline-block', transition: '0.15s', transform: showSetup ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Setup &amp; Add Bot
          <span style={{ display: 'inline-flex', gap: '4px', marginLeft: '8px' }}>
            <StatusDot ok={status?.env?.tokenSet} />
            <StatusDot ok={status?.env?.secretSet} />
            <StatusDot ok={!!status?.telegram?.webhookInfo?.url} />
          </span>
        </button>
        {showSetup && (
          <div style={{ marginTop: '8px' }}>
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Setup</div>
                  <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                    Bot: <code style={{ color: 'var(--foreground)' }}>@palmmanage_bot</code>
                  </div>
                </div>
                <Btn variant="primary" size="sm" onClick={registerWebhook}>Re-register Webhook</Btn>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <StatusPill ok={status?.env?.tokenSet} label={status?.env?.tokenSet ? 'Bot Token Set' : 'Bot Token Missing'} />
                <StatusPill ok={status?.env?.secretSet} label={status?.env?.secretSet ? 'Secret Set' : 'Secret Missing'} />
                <StatusPill ok={!!status?.telegram?.webhookInfo?.url} label={status?.telegram?.webhookInfo?.url ? 'Webhook Registered' : 'Webhook Not Registered'} />
              </div>
            </div>
            <div style={card}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Add bot to a Telegram group</div>
                <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                  Scan QR with phone, OR add manually (works anywhere).
                </div>
              </div>
              <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&bgcolor=ffffff&color=060606&data=${encodeURIComponent(BOT_DEEP_LINK)}`}
                    alt="Add bot"
                    width={160}
                    height={160}
                    style={{ borderRadius: '8px', background: '#fff' }}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Scan with phone</div>
                </div>
                <div style={{ flex: 1, minWidth: '220px', fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: '6px' }}>Manual:</div>
                  <ol style={{ paddingLeft: '18px', margin: 0 }}>
                    <li>Open group → tap name → <b>Add Members</b></li>
                    <li>Search <code style={{ color: 'var(--foreground)' }}>palmmanage</code></li>
                    <li>Toggle <b>Admin Rights OFF</b> → Add</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* iMessage-style two-pane view */}
      <div style={{
        display: 'flex',
        height: '70vh',
        minHeight: '500px',
        background: 'rgba(255, 255, 255, 0.015)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        <ChatList
          chats={chats}
          selectedId={selectedId}
          onSelect={(c) => setSelectedId(c.id)}
          filter={filter}
          setFilter={setFilter}
        />
        <ChatThread
          chat={selectedChat}
          onUpdate={refresh}
          toast={toast}
          creators={creators}
        />
      </div>
    </div>
  )
}

function StatusDot({ ok }) {
  return (
    <span style={{
      width: '6px', height: '6px', borderRadius: '50%',
      background: ok ? '#7AC97A' : '#E87878',
      display: 'inline-block',
    }} />
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

  // Wider on Chats tab for the two-pane view; narrower on Tasks for readable cards.
  const maxWidth = tab === 'chats' ? '1200px' : '900px'

  return (
    <div style={{ maxWidth }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '6px', color: 'var(--foreground)' }}>
          Inbox
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
          {tab === 'tasks'
            ? 'Action items extracted from your conversations. Things you said you’d do.'
            : 'Browse and triage your chats. Click any chat to read messages.'}
        </p>
      </div>

      {tab === 'chats' ? <ChatsTab toast={toast} /> : <TasksTab toast={toast} />}
      <ToastViewport />
    </div>
  )
}
