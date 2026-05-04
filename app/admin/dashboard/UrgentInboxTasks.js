'use client'

// Compact dashboard widget — top urgent inbox tasks. Only renders for
// the inbox owner (currently evan@palm-mgmt.com); silent otherwise so
// non-owners don't see personal stuff or get a 403 popup.

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

const INBOX_OWNER_EMAILS = ['evan@palm-mgmt.com']

const URGENCY_COLOR = { Now: '#E87878', Soon: '#E8B878', Later: '#9aa0a6' }
const OWNER_COLOR = { Evan: '#C8A0E8', Josh: '#7AC9E8', Other: '#9aa0a6' }

const CARD = {
  background: 'var(--card-bg-solid)',
  borderRadius: '18px',
  padding: '16px 20px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  marginBottom: '12px',
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

export default function UrgentInboxTasks() {
  const { user, isLoaded } = useUser()
  const [tasks, setTasks] = useState(null)

  const userEmail = (user?.primaryEmailAddress?.emailAddress || '').toLowerCase()
  const isOwner = isLoaded && INBOX_OWNER_EMAILS.includes(userEmail)

  useEffect(() => {
    if (!isOwner) return
    let cancelled = false
    async function load() {
      try {
        // Fetch Now + Soon, take top 6 by detected date
        const [nowRes, soonRes] = await Promise.all([
          fetch('/api/admin/inbox/tasks?status=Open&urgency=Now&limit=10').then(r => r.json()),
          fetch('/api/admin/inbox/tasks?status=Open&urgency=Soon&limit=10').then(r => r.json()),
        ])
        if (cancelled) return
        const all = [...(nowRes.tasks || []), ...(soonRes.tasks || [])]
        all.sort((a, b) => {
          // Now before Soon, then newest first
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

  if (!isLoaded || !isOwner) return null
  if (tasks === null) return null  // initial load — render nothing
  if (tasks.length === 0) return null  // no urgent tasks — quiet

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
          📥 Urgent Inbox · {tasks.length}
        </div>
        <Link href="/admin/inbox?tab=tasks" style={{
          fontSize: '11px', color: 'var(--palm-pink)',
          textDecoration: 'none', fontWeight: 600,
        }}>
          See all →
        </Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {tasks.map(t => (
          <Link
            key={t.id}
            href="/admin/inbox?tab=tasks"
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)',
              borderLeft: `2px solid ${URGENCY_COLOR[t.urgency] || URGENCY_COLOR.Soon}`,
              textDecoration: 'none', color: 'inherit',
              transition: '0.12s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
          >
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              padding: '2px 6px', borderRadius: '3px',
              color: OWNER_COLOR[t.owner] || OWNER_COLOR.Other,
              background: 'rgba(255,255,255,0.04)',
              flexShrink: 0,
            }}>
              {t.owner}
            </span>
            {t.creatorAka && (
              <span style={{
                fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em',
                padding: '2px 6px', borderRadius: '3px',
                color: 'var(--palm-pink)', background: 'rgba(232, 160, 160, 0.08)',
                flexShrink: 0,
              }}>
                {t.creatorAka}
              </span>
            )}
            <span style={{
              fontSize: '13px', fontWeight: 500, color: 'var(--foreground)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1, minWidth: 0,
            }}>
              {t.task}
            </span>
            <span style={{
              fontSize: '10px', color: 'var(--foreground-muted)', flexShrink: 0,
            }}>
              {timeAgo(t.detectedAt)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
