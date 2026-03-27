'use client'

import { useState, useEffect, useCallback } from 'react'

function formatTime(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    const now = new Date()
    const diffH = Math.round((now - d) / 3600000)
    if (diffH < 1) return 'Just now'
    if (diffH < 24) return `${diffH}h ago`
    if (diffH < 48) return 'Yesterday'
    return `${Math.round(diffH / 24)}d ago`
  } catch { return ts }
}

function StatusPill({ status }) {
  const colors = {
    Processing: { bg: '#332b00', text: '#f59e0b', border: '#5c4b00' },
    Complete: { bg: '#0a2e0a', text: '#22c55e', border: '#1a5c1a' },
    Error: { bg: '#2d1515', text: '#ef4444', border: '#5c2020' },
  }
  const c = colors[status] || { bg: '#1a1a1a', text: '#71717a', border: '#333' }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 600,
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border}`,
    }}>
      {status || '—'}
    </span>
  )
}

function AddSourceModal({ onClose, onAdd }) {
  const [handle, setHandle] = useState('')
  const [lookbackDays, setLookbackDays] = useState(180)
  const [apifyLimit, setApifyLimit] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!handle.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim(),
          lookbackDays,
          apifyLimit: apifyLimit ? parseInt(apifyLimit) : null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onAdd()
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: '#111', border: '1px solid #333', borderRadius: '12px',
          padding: '24px', width: '400px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '16px' }}>Add Source</h3>
        <label style={labelStyle}>Instagram Handle</label>
        <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="username" style={inputStyle} autoFocus />
        <label style={labelStyle}>Lookback Days</label>
        <input type="number" value={lookbackDays} onChange={e => setLookbackDays(parseInt(e.target.value) || 180)} style={inputStyle} />
        <label style={labelStyle}>Apify Limit (optional)</label>
        <input type="number" value={apifyLimit} onChange={e => setApifyLimit(e.target.value)} placeholder="No limit" style={inputStyle} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, background: '#333' }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnStyle, background: '#a78bfa', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Adding...' : 'Add Source'}
          </button>
        </div>
      </form>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: '11px', color: '#71717a', fontWeight: 600, marginBottom: '4px', marginTop: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle = { width: '100%', padding: '8px 12px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '6px', color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }
const btnStyle = { padding: '8px 16px', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }

export default function AdminSources() {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [scraping, setScraping] = useState({}) // { sourceId: true }

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sources')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setSources(data.sources || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSources() }, [fetchSources])

  const toggleEnabled = async (source) => {
    // Optimistic update
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: !s.enabled } : s))
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id, fields: { Enabled: !source.enabled } }),
      })
      if (!res.ok) throw new Error('Toggle failed')
    } catch (err) {
      // Revert on failure
      setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: source.enabled } : s))
      console.error(err)
    }
  }

  const scrapeOne = async (source) => {
    setScraping(prev => ({ ...prev, [source.id]: true }))
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: [source.handle] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scrape failed')
      // Update status optimistically
      setSources(prev => prev.map(s => s.id === source.id ? { ...s, pipelineStatus: 'Processing' } : s))
    } catch (err) {
      alert(err.message)
    } finally {
      setScraping(prev => ({ ...prev, [source.id]: false }))
    }
  }

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px' }}>Loading sources...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>Inspo Sources</h1>
        <button onClick={() => setShowAdd(true)} style={{ ...btnStyle, background: '#a78bfa' }}>+ Add Source</button>
      </div>

      <div style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 110px 80px 100px 80px 80px 90px',
          padding: '10px 16px',
          borderBottom: '1px solid #222',
          fontSize: '11px',
          fontWeight: 600,
          color: '#71717a',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          gap: '8px',
        }}>
          <div></div>
          <div>Handle</div>
          <div style={{ textAlign: 'right' }}>Followers</div>
          <div>Status</div>
          <div>Last Scraped</div>
          <div style={{ textAlign: 'right' }}>Scraped</div>
          <div style={{ textAlign: 'right' }}>Added</div>
          <div></div>
        </div>

        {/* Table rows */}
        {sources.map(source => (
          <div
            key={source.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr 110px 80px 100px 80px 80px 90px',
              padding: '10px 16px',
              borderBottom: '1px solid #1a1a1a',
              alignItems: 'center',
              fontSize: '13px',
              gap: '8px',
              opacity: source.enabled ? 1 : 0.5,
            }}
          >
            {/* Toggle */}
            <div>
              <button
                onClick={() => toggleEnabled(source)}
                style={{
                  width: '32px', height: '18px', borderRadius: '9px',
                  background: source.enabled ? '#a78bfa' : '#333',
                  border: 'none', cursor: 'pointer', position: 'relative',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  background: '#fff', position: 'absolute', top: '2px',
                  left: source.enabled ? '16px' : '2px',
                  transition: 'left 0.2s',
                }} />
              </button>
            </div>

            {/* Handle */}
            <div style={{ color: '#fff', fontWeight: 500 }}>
              @{source.handle}
            </div>

            {/* Followers */}
            <div style={{ color: '#d4d4d8', textAlign: 'right' }}>
              {source.followerCount ? (
                source.followerCount >= 1000000
                  ? <>{(source.followerCount / 1000000).toFixed(1)}<span style={{ color: '#a78bfa', fontWeight: 600 }}>M</span></>
                  : <>{(source.followerCount / 1000).toFixed(0)}<span style={{ color: '#71717a', fontWeight: 600 }}>K</span></>
              ) : '—'}
            </div>

            {/* Status */}
            <div><StatusPill status={source.pipelineStatus} /></div>

            {/* Last Scraped */}
            <div style={{ color: '#71717a' }}>{formatTime(source.lastScrapedAt)}</div>

            {/* Scraped */}
            <div style={{ color: '#d4d4d8', textAlign: 'right' }}>{source.reelsScraped || '—'}</div>

            {/* Added */}
            <div style={{ color: '#d4d4d8', textAlign: 'right' }}>{source.sourceReelsAdded || '—'}</div>

            {/* Scrape button */}
            <div>
              <button
                onClick={() => scrapeOne(source)}
                disabled={scraping[source.id] || !source.enabled}
                style={{
                  padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                  background: scraping[source.id] ? '#333' : '#1a1a2e',
                  color: scraping[source.id] ? '#555' : '#a78bfa',
                  border: '1px solid #333', borderRadius: '4px',
                  cursor: scraping[source.id] || !source.enabled ? 'not-allowed' : 'pointer',
                }}
              >
                {scraping[source.id] ? '...' : 'Scrape'}
              </button>
            </div>
          </div>
        ))}

        {sources.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
            No sources configured. Add one to get started.
          </div>
        )}
      </div>

      {showAdd && <AddSourceModal onClose={() => setShowAdd(false)} onAdd={fetchSources} />}
    </div>
  )
}
