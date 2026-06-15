'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

// Today's-tasks view across all active warmup accounts.
// One card per account with a checklist of tasks due today. Per-account
// drill-in via "View all tasks" link → ?view=account&id=X.
//
// "Actionable" = due AND not blocked by prerequisite or owner approval.
// "Blocked" cards still render so the operator knows why something can't
// be completed yet (e.g. Day-21 sub-steps chained, Day-45 awaiting approval).

export default function TodayView({ onOpenAccount, onCreateAccount }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/smm/warmup/today')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setData(d); setLoading(false); setError('') })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const handleMarkDone = async (taskId, requiresApproval, approved) => {
    // Block Done locally if approval required + not granted yet — server
    // also enforces, but we save a round-trip.
    if (requiresApproval && !approved) {
      alert('This task requires owner approval first. Open the account view to approve.')
      return
    }
    const res = await fetch(`/api/admin/smm/warmup/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Done' }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.message || j.error || `HTTP ${res.status}`)
      return
    }
    load()
  }

  if (loading && !data) return <Loading />
  if (error) return <ErrorBlock error={error} />

  const accounts = data?.accounts || []
  const total = accounts.reduce((sum, a) => sum + a.actionableCount, 0)
  const blocked = accounts.reduce((sum, a) => sum + a.blockedCount, 0)

  return (
    <div style={{ padding: '24px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Today's Warm-Up Tasks</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--foreground-muted)', fontSize: 13 }}>
            {accounts.length === 0
              ? 'No accounts in warm-up. Add your first one to get started.'
              : `${total} actionable · ${blocked} blocked · ${accounts.length} active account${accounts.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={onCreateAccount}
          style={{
            padding: '10px 18px',
            background: 'var(--palm-pink)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          + New Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div style={{
          padding: 32,
          border: '1px dashed rgba(255,255,255,0.12)',
          borderRadius: 12,
          textAlign: 'center',
          color: 'var(--foreground-muted)',
          fontSize: 13,
        }}>
          No active warm-up accounts yet. Click <strong>+ New Account</strong> above to add
          Brielle, Lily, Katie Rosie, or any other AI persona.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
          {accounts.map(a => (
            <AccountCard
              key={a.id}
              account={a}
              onMarkDone={handleMarkDone}
              onOpenAccount={() => onOpenAccount(a.id)}
            />
          ))}
        </div>
      )}

      {data?.asOf && (
        <div style={{ marginTop: 24, fontSize: 10, color: 'var(--foreground-subtle)' }}>
          as of {new Date(data.asOf).toLocaleString()}
        </div>
      )}
    </div>
  )
}

function AccountCard({ account, onMarkDone, onOpenAccount }) {
  const { personaName, personaHandle, warmupStatus, currentDay, dueTasks } = account
  const dayLabel = currentDay == null
    ? warmupStatus === 'Setup' ? 'Setup phase' : '—'
    : `Day ${currentDay}`

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12,
      padding: '18px 18px 14px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)' }}>
            {personaName}
            {personaHandle && <span style={{ color: 'var(--foreground-subtle)', fontWeight: 400, fontSize: 13, marginLeft: 6 }}>@{personaHandle}</span>}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--foreground-muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusPill status={warmupStatus} />
            <span>·</span>
            <span>{dayLabel}</span>
          </div>
        </div>
        <button
          onClick={onOpenAccount}
          style={{
            fontSize: 11,
            color: 'var(--foreground-muted)',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Open
        </button>
      </div>

      {dueTasks.length === 0 ? (
        <div style={{
          padding: 16,
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--foreground-subtle)',
          background: 'rgba(106,198,138,0.06)',
          borderRadius: 8,
          border: '1px solid rgba(106,198,138,0.15)',
        }}>
          ✓ Nothing due today
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dueTasks.map(t => (
            <TaskRow key={t.id} task={t} onDone={() => onMarkDone(t.id, t.requiresOwnerApproval, t.ownerApproved)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({ task, onDone }) {
  const tint = task.blockedByPrereq || task.blockedByApproval ? 'rgba(232,195,106,0.06)' : 'transparent'
  const border = task.blockedByPrereq || task.blockedByApproval ? '1px solid rgba(232,195,106,0.20)' : '1px solid rgba(255,255,255,0.06)'

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      background: tint,
      border,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}>
      <button
        onClick={onDone}
        disabled={!task.actionable}
        title={task.actionable ? 'Mark Done' : 'Blocked'}
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: `1.5px solid ${task.actionable ? 'var(--palm-pink)' : 'rgba(255,255,255,0.15)'}`,
          background: 'transparent',
          cursor: task.actionable ? 'pointer' : 'not-allowed',
          flexShrink: 0,
          marginTop: 1,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)', lineHeight: 1.35 }}>
          {task.title}
        </div>
        <div style={{ marginTop: 3, fontSize: 10, color: 'var(--foreground-subtle)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Day {task.day}</span>
          <span>·</span>
          <span>{task.phase}</span>
          {task.requiresOwnerApproval && (
            <>
              <span>·</span>
              <span style={{ color: '#E8C36A' }}>⚠ owner approval</span>
            </>
          )}
          {task.blockedByPrereq && (
            <>
              <span>·</span>
              <span style={{ color: '#E8C36A' }}>blocked: prereq not done</span>
            </>
          )}
          {task.blockedByApproval && (
            <>
              <span>·</span>
              <span style={{ color: '#E8C36A' }}>awaiting approval</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const tint = {
    'Setup': 'rgba(160,160,160,0.16)',
    'Warming Up': 'rgba(232,195,106,0.20)',
    'Live': 'rgba(106,198,138,0.20)',
    'Paused': 'rgba(160,160,160,0.16)',
    'Retired': 'rgba(160,160,160,0.10)',
  }[status] || 'rgba(160,160,160,0.16)'
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 4,
      background: tint,
      color: 'var(--foreground)',
      fontSize: 10,
      fontWeight: 600,
    }}>
      {status}
    </span>
  )
}

function Loading() {
  return <div style={{ padding: 40, color: 'var(--foreground-muted)', fontSize: 13 }}>Loading…</div>
}

function ErrorBlock({ error }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{
        padding: 16,
        background: 'rgba(232,120,120,0.08)',
        border: '1px solid rgba(232,120,120,0.25)',
        borderRadius: 8,
        fontSize: 13,
        color: '#e87878',
      }}>
        Couldn't load warm-up tasks: {error}
      </div>
    </div>
  )
}
