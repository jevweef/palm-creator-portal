'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function SmHome() {
  const [counts, setCounts] = useState({ pendingSetups: null, gridUnscheduled: null })

  useEffect(() => {
    fetch('/api/admin/sm-requests').then(r => r.json()).then(d => {
      const pending = (d.requests || []).filter(r => r.status !== 'Complete').length
      setCounts(c => ({ ...c, pendingSetups: pending }))
    }).catch(() => {})
  }, [])

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
    </div>
  )
}
