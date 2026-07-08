'use client'

import { useState, useEffect } from 'react'

function fmtDateTime(s) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return s }
}
function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function ContentRequestsAdminPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creatorFilter, setCreatorFilter] = useState('all')
  const [expanded, setExpanded] = useState({}) // `${requestId}:${section}` -> bool

  useEffect(() => {
    fetch('/api/admin/content-requests')
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error || 'Failed'))))
      .then(d => { setData(d.creators || []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ padding: '40px', color: 'var(--foreground-muted)' }}>Loading content requests…</div>
  if (error) return <div style={{ padding: '40px', color: '#E87878' }}>Error: {error}</div>

  const shown = creatorFilter === 'all' ? data : data.filter(c => c.creatorId === creatorFilter)
  const toggle = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }))

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Content Requests</h1>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>Upload tracking — counts, times, links, and errors. No content preview.</div>
        </div>
        <select value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}
          style={{ padding: '8px 12px', fontSize: 13, background: 'var(--background)', color: 'var(--foreground)', border: '1px solid transparent', borderRadius: 8, cursor: 'pointer' }}>
          <option value="all">All creators ({data.length})</option>
          {data.map(c => <option key={c.requestId} value={c.creatorId}>{c.creator}</option>)}
        </select>
      </div>

      {shown.length === 0 && <div style={{ color: 'var(--foreground-muted)', padding: '40px 0', textAlign: 'center' }}>No active content requests.</div>}

      {shown.map(c => {
        const pct = c.totalRequired > 0 ? Math.round((c.totalUploaded / c.totalRequired) * 100) : 0
        const met = c.totalRequired > 0 && c.totalUploaded >= c.totalRequired
        return (
          <div key={c.requestId} style={{ background: 'var(--card-bg-solid)', borderRadius: 14, padding: '20px 24px', marginBottom: 18, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            {/* Creator header */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>{c.creator}</span>
                <span style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>{c.title || c.month}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: met ? '#7DD3A4' : c.totalUploaded > 0 ? '#E8C878' : '#999' }}>
                {c.totalUploaded} / {c.totalRequired} uploaded
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--foreground-subtle)', marginBottom: 12 }}>
              <span>Due {c.dueDate || '—'}</span>
              <span>Last upload {fmtDateTime(c.lastUploadAt)}</span>
              {c.errors.length > 0 && <span style={{ color: '#E87878', fontWeight: 600 }}>{c.errors.length} error{c.errors.length > 1 ? 's' : ''}</span>}
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: met ? '#7DD3A4' : 'var(--palm-pink)' }} />
            </div>

            {/* Sections */}
            {c.sections.map(s => {
              const key = `${c.requestId}:${s.name}`
              const secMet = s.required > 0 && s.uploaded >= s.required
              return (
                <div key={s.name} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '8px 0' }}>
                  <div onClick={() => s.uploaded > 0 && toggle(key)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: s.uploaded > 0 ? 'pointer' : 'default' }}>
                    <span style={{ fontSize: 13, color: 'rgba(240,236,232,0.85)' }}>
                      {s.uploaded > 0 && <span style={{ color: 'var(--foreground-subtle)', marginRight: 6 }}>{expanded[key] ? '▾' : '▸'}</span>}
                      {s.name}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: secMet ? '#7DD3A4' : s.uploaded > 0 ? '#E8C878' : '#777' }}>
                      {s.uploaded} / {s.required}
                    </span>
                  </div>
                  {expanded[key] && s.items.length > 0 && (
                    <div style={{ marginTop: 8, marginLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {s.items.map((it, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--foreground-muted)' }}>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.fileName || 'file'}</span>
                          <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>{fmtSize(it.fileSize)}</span>
                          <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>{fmtDateTime(it.uploadedAt)}</span>
                          {it.dropboxLink && (
                            <a href={it.dropboxLink} target="_blank" rel="noopener noreferrer"
                              style={{ color: 'var(--palm-pink)', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>Dropbox ↗</a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Errors */}
            {c.errors.length > 0 && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(232,120,120,0.06)', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#E87878', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Upload errors ({c.errors.length})</div>
                {c.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--foreground-muted)', padding: '4px 0', borderBottom: i < c.errors.length - 1 ? '1px solid rgba(232,120,120,0.12)' : 'none' }}>
                    <span style={{ color: '#E87878', fontWeight: 600 }}>{e.error}</span>
                    {e.stage && <span style={{ color: 'var(--foreground-subtle)' }}> · at {e.stage}</span>}
                    <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginTop: 2 }}>
                      {e.section && `${e.section} · `}{e.fileName && `${e.fileName} · `}{fmtDateTime(e.reportedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
