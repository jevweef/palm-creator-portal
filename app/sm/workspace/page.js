'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function SmWorkspace() {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/sm-workspace').then(r => r.json()).then(d => {
      setCreators(d.creators || [])
      setLoading(false)
    })
  }, [])

  return (
    <div style={{ maxWidth: '1200px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Workspace</h1>
        <p style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>
          All active creators + their managed IG accounts. This is a first-pass replacement for the SMM spreadsheet — tell Palm what columns you're missing and we'll add them.
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)' }}>Loading...</div>
      ) : creators.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--foreground-muted)' }}>No active creators.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--card-border)' }}>
                <th style={thStyle}>Creator</th>
                <th style={thStyle}>Live Accounts</th>
                <th style={thStyle}>Pending Setup</th>
                <th style={thStyle}>Weekly Quota</th>
                <th style={thStyle}>Posts (14d)</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {creators.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{c.aka || c.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{c.status}</div>
                  </td>
                  <td style={tdStyle}>
                    {c.accounts.length === 0 ? (
                      <span style={{ color: 'var(--foreground-muted)' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {c.accounts.map(a => (
                          <div key={a.id} style={{ fontSize: '12px' }}>
                            @{a.handle || '(no handle)'}
                            <span style={{ marginLeft: '6px', fontSize: '10px', color: a.setupStatus === 'Live' ? '#22c55e' : 'var(--foreground-muted)' }}>
                              {a.accountType}
                              {a.followers ? ` · ${a.followers.toLocaleString()} followers` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {c.pendingSlots.length === 0 ? (
                      <span style={{ color: 'var(--foreground-muted)' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {c.pendingSlots.map(s => (
                          <Link key={`${s.requestId}-${s.slot}`} href="/sm/setup-requests" style={{ fontSize: '12px', color: 'var(--palm-pink)', textDecoration: 'none' }}>
                            Palm IG {s.slot}{s.handle ? `: @${s.handle}` : ''}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {c.weeklyQuota || '—'}
                  </td>
                  <td style={tdStyle}>
                    {c.postsLast14d}
                  </td>
                  <td style={tdStyle}>
                    <Link
                      href={`/sm/grid-planner?creatorId=${c.id}`}
                      style={{ fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none' }}
                    >Grid →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: '32px', padding: '16px', background: 'rgba(232,160,160,0.04)', border: '1px solid rgba(232,160,160,0.2)', borderRadius: '10px', fontSize: '13px', color: 'var(--foreground-muted)' }}>
        <strong style={{ color: 'var(--palm-pink)' }}>Missing columns?</strong> Tell Palm what you're currently tracking in your spreadsheet (post cadence, content themes, bio changes, DM replies, etc.) and we'll add views + fields here so you can stop flipping between tools.
      </div>
    </div>
  )
}

const thStyle = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--foreground-muted)',
}

const tdStyle = {
  padding: '10px 12px',
  verticalAlign: 'top',
}
