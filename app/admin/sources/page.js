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

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return String(n)
}

function shortcode(url) {
  const m = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : url
}

const GRADE_COLORS = {
  'A+': '#a78bfa', A: '#a78bfa', 'A-': '#a78bfa',
  'B+': '#22c55e', B: '#22c55e', 'B-': '#22c55e',
  'C+': '#f59e0b', C: '#f59e0b', 'C-': '#f59e0b',
  D: '#ef4444', F: '#ef4444',
}

function ReelsModal({ source, onClose }) {
  const [reels, setReels] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/sources/reels?handle=${encodeURIComponent(source.handle)}`)
      .then(r => r.json())
      .then(d => setReels(d.reels || []))
      .catch(() => setReels([]))
      .finally(() => setLoading(false))
  }, [source.handle])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '60px', overflowY: 'auto' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#111', border: '1px solid #333', borderRadius: '12px', width: '860px', maxWidth: '95vw', padding: '24px', marginBottom: '60px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>@{source.handle}</div>
            <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>
              {loading ? 'Loading...' : `${reels?.length || 0} reels scraped`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a
              href={`https://instagram.com/${source.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: '#1a1a2e', color: '#a78bfa', border: '1px solid #333', borderRadius: '6px', textDecoration: 'none' }}
            >
              Open Profile ↗
            </a>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px' }}>Loading reels...</div>
        ) : reels?.length === 0 ? (
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px' }}>No reels scraped yet for this account.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {reels.map(reel => (
              <a
                key={reel.id}
                href={reel.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', display: 'block', background: '#0a0a0a', border: '1px solid #222', borderRadius: '8px', padding: '12px', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#a78bfa'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}
              >
                {/* Top row: shortcode + grade */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>{shortcode(reel.url)}</span>
                  {reel.grade && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: GRADE_COLORS[reel.grade] || '#fff' }}>{reel.grade}</span>
                  )}
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  {[
                    { label: 'Views', value: formatNum(reel.views) },
                    { label: 'Likes', value: formatNum(reel.likes) },
                    { label: 'Comments', value: formatNum(reel.comments) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#d4d4d8' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Footer: date + audio type */}
                {(reel.postedAt || reel.audioType) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #1a1a1a' }}>
                    <span style={{ fontSize: '11px', color: '#555' }}>
                      {reel.postedAt ? new Date(reel.postedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : ''}
                    </span>
                    {reel.audioType && (
                      <span style={{ fontSize: '10px', color: '#555', background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px' }}>{reel.audioType}</span>
                    )}
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EnableModal({ source, onClose, onConfirm }) {
  const [lookback, setLookback] = useState(source.lookbackDays || 180)
  const [limit, setLimit] = useState(source.apifyLimit || 15)
  const [saving, setSaving] = useState(false)

  const confirm = async () => {
    setSaving(true)
    try {
      // Save settings first
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          fields: { Enabled: true, 'Lookback Days': lookback, 'Apify Limit': limit },
        }),
      })
      onConfirm({ lookbackDays: lookback, apifyLimit: limit })
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
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111', border: '1px solid #333', borderRadius: '12px',
          padding: '24px', width: '400px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>Enable @{source.handle}?</h3>
        <p style={{ fontSize: '12px', color: '#71717a', marginBottom: '16px', lineHeight: 1.4 }}>
          This will enable scraping for this account. You can adjust the settings below before confirming.
        </p>

        <label style={labelStyle}>Lookback Days</label>
        <input type="number" value={lookback} onChange={e => setLookback(parseInt(e.target.value) || 180)} style={inputStyle} />
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>How far back to scrape reels (from today)</div>

        <label style={labelStyle}>Max Reels to Scrape</label>
        <input type="number" value={limit} onChange={e => setLimit(parseInt(e.target.value) || 15)} style={inputStyle} />
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>Limits the number of reels Apify will return</div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, background: '#333' }}>Cancel</button>
          <button
            onClick={confirm}
            disabled={saving}
            style={{ ...btnStyle, background: '#a78bfa', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Enable & Save'}
          </button>
        </div>
      </div>
    </div>
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
  const [reelsSource, setReelsSource] = useState(null) // source for reels modal
  const [enableSource, setEnableSource] = useState(null) // source for enable confirmation modal

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
    if (!source.enabled) {
      // Enabling — show confirmation modal
      setEnableSource(source)
      return
    }
    // Disabling — no confirmation needed
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: false } : s))
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id, fields: { Enabled: false } }),
      })
      if (!res.ok) throw new Error('Toggle failed')
    } catch (err) {
      setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: true } : s))
      console.error(err)
    }
  }

  const handleEnableConfirm = ({ lookbackDays, apifyLimit }) => {
    setSources(prev => prev.map(s => s.id === enableSource.id ? { ...s, enabled: true, lookbackDays, apifyLimit } : s))
    setEnableSource(null)
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
          gridTemplateColumns: '40px 1fr 110px 70px 60px 80px 100px 80px 80px 90px',
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
          <div style={{ textAlign: 'right', paddingRight: '16px' }}>Followers</div>
          <div style={{ textAlign: 'right' }}>Days</div>
          <div style={{ textAlign: 'right' }}>Limit</div>
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
              gridTemplateColumns: '40px 1fr 110px 70px 60px 80px 100px 80px 80px 90px',
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
            <div
              style={{ color: '#fff', fontWeight: 500, cursor: 'pointer' }}
              onClick={() => setReelsSource(source)}
              onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
              onMouseLeave={e => e.currentTarget.style.color = '#fff'}
            >
              @{source.handle}
            </div>

            {/* Followers */}
            <div style={{ color: '#d4d4d8', textAlign: 'right', paddingRight: '16px' }}>
              {source.followerCount ? (
                source.followerCount >= 1000000
                  ? <>{(source.followerCount / 1000000).toFixed(1)}<span style={{ color: '#a78bfa', fontWeight: 600 }}>M</span></>
                  : <>{(source.followerCount / 1000).toFixed(0)}<span style={{ color: '#71717a', fontWeight: 600 }}>K</span></>
              ) : '—'}
            </div>

            {/* Lookback Days — inline editable */}
            <div style={{ textAlign: 'right' }}>
              <input
                type="number"
                value={source.lookbackDays || 180}
                onChange={e => {
                  const val = parseInt(e.target.value) || 180
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, lookbackDays: val } : s))
                }}
                onBlur={e => {
                  const val = parseInt(e.target.value) || 180
                  fetch('/api/admin/sources', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: source.id, fields: { 'Lookback Days': val } }),
                  })
                }}
                style={{ width: '50px', padding: '2px 4px', background: 'transparent', border: '1px solid transparent', borderRadius: '4px', color: '#71717a', fontSize: '12px', textAlign: 'right', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = '#333'}
                onBlurCapture={e => e.target.style.borderColor = 'transparent'}
              />
            </div>

            {/* Apify Limit — inline editable */}
            <div style={{ textAlign: 'right' }}>
              <input
                type="number"
                value={source.apifyLimit || 15}
                onChange={e => {
                  const val = parseInt(e.target.value) || 15
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, apifyLimit: val } : s))
                }}
                onBlur={e => {
                  const val = parseInt(e.target.value) || 15
                  fetch('/api/admin/sources', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: source.id, fields: { 'Apify Limit': val } }),
                  })
                }}
                style={{ width: '40px', padding: '2px 4px', background: 'transparent', border: '1px solid transparent', borderRadius: '4px', color: '#71717a', fontSize: '12px', textAlign: 'right', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = '#333'}
                onBlurCapture={e => e.target.style.borderColor = 'transparent'}
              />
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
      {reelsSource && <ReelsModal source={reelsSource} onClose={() => setReelsSource(null)} />}
      {enableSource && <EnableModal source={enableSource} onClose={() => setEnableSource(null)} onConfirm={handleEnableConfirm} />}
    </div>
  )
}
