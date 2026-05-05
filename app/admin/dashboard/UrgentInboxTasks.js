'use client'

// Compact dashboard widget — top urgent inbox tasks. Only renders for
// the inbox owner (currently evan@palm-mgmt.com); silent otherwise so
// non-owners don't see personal stuff or get a 403 popup.
//
// Inline actions per row: Done / Snooze ▾ / Dismiss ▾
// - Done: status=Done
// - Snooze ▾: 1h / 1d / 3d / 1w
// - Dismiss ▾: optional Feedback Type + free-text reason → trains the
//   extract-tasks loop (anti-examples injected daily into Sonnet system
//   prompt). Quick path: Dismiss with no feedback. Long path: pick a
//   reason so the AI learns.
// Clicking the row body still deep-links to /admin/inbox?tab=tasks.

import { useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const INBOX_OWNER_EMAILS = ['evan@palm-mgmt.com']

const URGENCY_COLOR = { Now: '#E87878', Soon: '#E8B878', Later: '#9aa0a6' }
const OWNER_COLOR = { Evan: '#C8A0E8', Josh: '#7AC9E8', Other: '#9aa0a6' }

const SNOOZE_OPTIONS = [
  { label: '1h', hours: 1 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '1w', hours: 168 },
]

const FEEDBACK_TYPES = [
  'Not a real task',
  'Wrong person',
  'Wrong urgency',
  'Already done',
  'Personal not business',
  'Misread conversation',
  'Other',
]

const CARD = {
  background: 'var(--card-bg-solid)',
  borderRadius: '18px',
  padding: '16px 20px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  marginBottom: '12px',
}

const ACTION_BTN = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
  padding: '4px 8px', borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
  color: 'var(--foreground-muted)',
  cursor: 'pointer',
  textTransform: 'uppercase',
  transition: '0.12s ease',
}

function timeAgo(iso) {
  if (!iso) return ''
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

// Compact button with hover + click handler that swallows the parent
// link's navigation. Used for all the inline actions.
function ActionButton({ children, onClick, color, title }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
        if (color) e.currentTarget.style.color = color
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
        e.currentTarget.style.color = 'var(--foreground-muted)'
      }}
      title={title}
      style={ACTION_BTN}
    >
      {children}
    </button>
  )
}

// Tiny popover wrapping one of the dropdown actions (Snooze, Dismiss).
// Click-outside closes. Positioned absolutely just below the trigger.
function Popover({ open, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      ref={ref}
      onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
      style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50,
        minWidth: '180px',
        background: 'var(--card-bg-solid, #1a1a1c)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px', padding: '6px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      {children}
    </div>
  )
}

function TaskRow({ task, onAction }) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [dismissOpen, setDismissOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState('')
  const [feedbackReason, setFeedbackReason] = useState('')

  async function patch(updates) {
    onAction({ id: task.id, optimistic: true })
    try {
      const res = await fetch(`/api/admin/inbox/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error(await res.text())
      onAction({ id: task.id, removed: true })
    } catch (err) {
      console.warn('task action failed', err)
      onAction({ id: task.id, restore: true })
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 10px', borderRadius: '8px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderLeft: `2px solid ${URGENCY_COLOR[task.urgency] || URGENCY_COLOR.Soon}`,
      }}
    >
      <Link
        href="/admin/inbox?tab=tasks"
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          textDecoration: 'none', color: 'inherit',
          flex: 1, minWidth: 0,
        }}
      >
        <span style={{
          fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          padding: '2px 6px', borderRadius: '3px',
          color: OWNER_COLOR[task.owner] || OWNER_COLOR.Other,
          background: 'rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}>
          {task.owner}
        </span>
        {task.creatorAka && (
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em',
            padding: '2px 6px', borderRadius: '3px',
            color: 'var(--palm-pink)', background: 'rgba(232, 160, 160, 0.08)',
            flexShrink: 0,
          }}>
            {task.creatorAka}
          </span>
        )}
        <span style={{
          fontSize: '13px', fontWeight: 500, color: 'var(--foreground)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
        }}>
          {task.task}
        </span>
        <span style={{
          fontSize: '10px', color: 'var(--foreground-muted)', flexShrink: 0,
        }}>
          {timeAgo(task.detectedAt)}
        </span>
      </Link>

      <div style={{ display: 'flex', gap: '4px', flexShrink: 0, position: 'relative' }}>
        <ActionButton
          onClick={() => patch({ status: 'Done' })}
          color="#7AE89C"
          title="Mark as done"
        >
          Done
        </ActionButton>

        <div style={{ position: 'relative' }}>
          <ActionButton
            onClick={() => { setSnoozeOpen(s => !s); setDismissOpen(false) }}
            color="#7AC9E8"
            title="Snooze"
          >
            Snooze ▾
          </ActionButton>
          <Popover open={snoozeOpen} onClose={() => setSnoozeOpen(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {SNOOZE_OPTIONS.map(opt => (
                <button
                  key={opt.hours}
                  onClick={() => { setSnoozeOpen(false); patch({ snoozeHours: opt.hours }) }}
                  style={{
                    textAlign: 'left', padding: '6px 10px', fontSize: '12px',
                    background: 'transparent', border: 'none',
                    color: 'var(--foreground)', cursor: 'pointer', borderRadius: '4px',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Snooze {opt.label}
                </button>
              ))}
            </div>
          </Popover>
        </div>

        <div style={{ position: 'relative' }}>
          <ActionButton
            onClick={() => { setDismissOpen(d => !d); setSnoozeOpen(false) }}
            color="#E87878"
            title="Dismiss (with optional feedback to train the AI)"
          >
            Dismiss ▾
          </ActionButton>
          <Popover open={dismissOpen} onClose={() => setDismissOpen(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px' }}>
              <div style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em',
                textTransform: 'uppercase', color: 'var(--foreground-muted)',
                padding: '2px 4px',
              }}>
                Why? (trains the AI)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {FEEDBACK_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => setFeedbackType(t === feedbackType ? '' : t)}
                    style={{
                      fontSize: '10px', padding: '3px 7px', borderRadius: '3px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: feedbackType === t ? 'rgba(232, 160, 160, 0.18)' : 'transparent',
                      color: feedbackType === t ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <textarea
                value={feedbackReason}
                onChange={(e) => setFeedbackReason(e.target.value)}
                placeholder="Optional: tell the system more..."
                rows={2}
                style={{
                  fontSize: '11px', padding: '6px 8px', borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--foreground)', resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setDismissOpen(false); patch({ status: 'Dismissed' }) }}
                  style={{
                    fontSize: '11px', padding: '4px 10px', borderRadius: '4px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer',
                  }}
                >
                  Just dismiss
                </button>
                <button
                  onClick={() => {
                    setDismissOpen(false)
                    patch({
                      status: 'Dismissed',
                      feedbackType: feedbackType || undefined,
                      feedbackReason: feedbackReason || undefined,
                    })
                  }}
                  disabled={!feedbackType && !feedbackReason}
                  style={{
                    fontSize: '11px', padding: '4px 10px', borderRadius: '4px',
                    border: '1px solid var(--palm-pink)',
                    background: 'var(--palm-pink)', color: '#000', cursor: 'pointer',
                    opacity: (!feedbackType && !feedbackReason) ? 0.4 : 1,
                  }}
                >
                  Dismiss + train
                </button>
              </div>
            </div>
          </Popover>
        </div>
      </div>
    </div>
  )
}

export default function UrgentInboxTasks() {
  const { user, isLoaded } = useUser()
  const [tasks, setTasks] = useState(null)
  const [removed, setRemoved] = useState(new Set())

  const userEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase()
  const isOwner = isLoaded && INBOX_OWNER_EMAILS.includes(userEmail)

  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    async function load() {
      try {
        const [nowRes, soonRes] = await Promise.all([
          fetch('/api/admin/inbox/tasks?status=Open&urgency=Now&limit=10').then(r => r.json()),
          fetch('/api/admin/inbox/tasks?status=Open&urgency=Soon&limit=10').then(r => r.json()),
        ])
        if (cancelled) return
        const all = [...(nowRes.tasks || []), ...(soonRes.tasks || [])]
        all.sort((a, b) => {
          if (a.urgency !== b.urgency) return a.urgency === 'Now' ? -1 : 1
          return (new Date(b.detectedAt || 0) - new Date(a.detectedAt || 0))
        })
        setTasks(all.slice(0, 6))
      } catch {
        if (!cancelled) setTasks([])
      }
    }
    load()
    const id = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isOwner])

  // Optimistic removal: when user clicks Done/Snooze/Dismiss, hide the
  // row immediately. If the API call fails, restore it.
  function handleAction({ id, removed: didRemove, restore }) {
    setRemoved(prev => {
      const next = new Set(prev)
      if (didRemove) next.add(id)
      else if (restore) next.delete(id)
      return next
    })
  }

  if (!isLoaded || !isOwner) return null
  if (tasks === null) return null
  const visible = (tasks || []).filter(t => !removed.has(t.id))
  if (visible.length === 0) return null

  return (
    <div style={{ ...CARD, border: 'none' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '10px',
      }}>
        <div style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--foreground-muted)',
        }}>
          📥 Urgent Inbox · {visible.length}
        </div>
        <Link href="/admin/inbox?tab=tasks" style={{
          fontSize: '11px', color: 'var(--palm-pink)',
          textDecoration: 'none', fontWeight: 600,
        }}>
          See all →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {visible.map(t => (
          <TaskRow key={t.id} task={t} onAction={handleAction} />
        ))}
      </div>
    </div>
  )
}
