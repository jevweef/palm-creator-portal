'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function SmHome() {
  const [counts, setCounts] = useState({ pendingSetups: null, gridUnscheduled: null })
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState(null)

  useEffect(() => {
    fetch('/api/admin/sm-requests').then(r => r.json()).then(d => {
      const pending = (d.requests || []).filter(r => r.status !== 'Complete').length
      setCounts(c => ({ ...c, pendingSetups: pending }))
    }).catch(() => {})
  }, [])

  async function runBackfill() {
    if (!confirm('Backfill Telegram topics for all currently-managed IG accounts? This is idempotent — re-running skips rows that already have topics.')) return
    setBackfilling(true)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/admin/sm-requests/backfill-topics', { method: 'POST' })
      const data = await res.json()
      setBackfillResult(data)
    } catch (err) {
      setBackfillResult({ error: err.message })
    } finally {
      setBackfilling(false)
    }
  }

  const cardStyle = {
    display: 'block',
    padding: '24px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid var(--card-border)',
    borderRadius: '12px',
    textDecoration: 'none',
    color: 'var(--foreground)',
    transition: '0.15s ease',
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Social Media</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: '14px', marginBottom: '32px' }}>
        Welcome. Pick a workspace to get started.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <Link href="/sm/setup-requests" style={cardStyle}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🆕</div>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Setup Requests</div>
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            New creators need Palm IG accounts.
            {counts.pendingSetups !== null && (
              <> <span style={{ color: 'var(--palm-pink)', fontWeight: 600 }}>{counts.pendingSetups} pending</span></>
            )}
          </div>
        </Link>

        <Link href="/sm/grid-planner" style={cardStyle}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🗓️</div>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Grid Planner</div>
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            Download assets, grab captions, mark posts scheduled.
          </div>
        </Link>

        <Link href="/sm/workspace" style={cardStyle}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>📋</div>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Workspace</div>
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            All active creators, accounts, cadence.
          </div>
        </Link>
      </div>

      <div style={{ marginTop: '40px', padding: '20px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)', borderRadius: '12px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>One-time setup</div>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
          Backfill Telegram topics for all currently-managed IG accounts. Idempotent — safe to run more than once.
        </div>
        <button
          onClick={runBackfill}
          disabled={backfilling}
          style={{
            padding: '8px 14px',
            fontSize: '13px',
            fontWeight: 600,
            background: 'var(--palm-pink)',
            color: '#060606',
            border: 'none',
            borderRadius: '6px',
            cursor: backfilling ? 'wait' : 'pointer',
            opacity: backfilling ? 0.6 : 1,
          }}
        >{backfilling ? 'Backfilling…' : 'Backfill Telegram Topics'}</button>
        {backfillResult && (
          <pre style={{ marginTop: '12px', padding: '12px', background: '#0a0a0a', border: '1px solid var(--card-border)', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', overflow: 'auto', maxHeight: '400px' }}>
{JSON.stringify(backfillResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
