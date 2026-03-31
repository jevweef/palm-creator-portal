'use client'

import { useState, useEffect, useCallback } from 'react'
import InspoCard from '@/components/InspoCard'

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

function ReelsModal({ source, sources, onClose, onNavigate }) {
  const [reels, setReels] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState({})

  const currentIdx = sources.findIndex(s => s.id === source.id)

  useEffect(() => {
    setReels(null)
    setLoading(true)
    fetch(`/api/admin/sources/reels?handle=${encodeURIComponent(source.handle)}`)
      .then(r => r.json())
      .then(d => setReels(d.reels || []))
      .catch(() => setReels([]))
      .finally(() => setLoading(false))
  }, [source.handle])

  const toggleHidden = async (reel) => {
    const newHidden = !reel.hidden
    setToggling(t => ({ ...t, [reel.id]: true }))
    setReels(prev => prev.map(r => r.id === reel.id ? { ...r, hidden: newHidden } : r))
    try {
      await fetch('/api/admin/sources/reels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: reel.id, hidden: newHidden }),
      })
    } catch {
      // revert on error
      setReels(prev => prev.map(r => r.id === reel.id ? { ...r, hidden: !newHidden } : r))
    } finally {
      setToggling(t => ({ ...t, [reel.id]: false }))
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '60px', overflowY: 'auto', paddingBottom: '60px' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#111', border: '1px solid #333', borderRadius: '12px', width: '1100px', maxWidth: '95vw', padding: '24px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Prev / Next */}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => currentIdx > 0 && onNavigate(sources[currentIdx - 1])}
                disabled={currentIdx <= 0}
                style={{ background: 'none', border: '1px solid #333', borderRadius: '6px', color: currentIdx <= 0 ? '#333' : '#71717a', fontSize: '16px', cursor: currentIdx <= 0 ? 'default' : 'pointer', padding: '2px 10px', lineHeight: 1.5 }}
              >‹</button>
              <button
                onClick={() => currentIdx < sources.length - 1 && onNavigate(sources[currentIdx + 1])}
                disabled={currentIdx >= sources.length - 1}
                style={{ background: 'none', border: '1px solid #333', borderRadius: '6px', color: currentIdx >= sources.length - 1 ? '#333' : '#71717a', fontSize: '16px', cursor: currentIdx >= sources.length - 1 ? 'default' : 'pointer', padding: '2px 10px', lineHeight: 1.5 }}
              >›</button>
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff' }}>@{source.handle}</div>
              <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>
                {loading ? 'Loading...' : `${reels?.length || 0} reels on inspo board`}
                {sources.length > 1 && <span style={{ color: '#3f3f46', marginLeft: '8px' }}>{currentIdx + 1} / {sources.length}</span>}
              </div>
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
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px' }}>Loading...</div>
        ) : reels?.length === 0 ? (
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px' }}>No inspo board reels for this account yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            {reels.map(reel => (
              <div key={reel.id} style={{ opacity: reel.hidden ? 0.5 : 1, transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', borderRadius: '12px', overflow: 'hidden' }}>
                <InspoCard
                  record={reel}
                  grade={reel.grade}
                  onClick={() => window.open(reel.dbShareLink || reel.contentLink, '_blank')}
                />
                <button
                  onClick={() => toggleHidden(reel)}
                  disabled={toggling[reel.id]}
                  style={{
                    width: '100%', padding: '10px',
                    fontSize: '12px', fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    background: reel.hidden ? '#14532d' : '#450a0a',
                    color: reel.hidden ? '#4ade80' : '#fca5a5',
                    opacity: toggling[reel.id] ? 0.5 : 1,
                    letterSpacing: '0.02em',
                  }}
                >
                  {reel.hidden ? '↩ Add back' : '✕ Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const COST_PER_REEL = 0.0084

function RescrapeModal({ source, newLimit, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false)
  const oldLimit = source.apifyLimit || 15
  const estCost = (newLimit * COST_PER_REEL).toFixed(2)

  const confirm = async () => {
    setSaving(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id, fields: { 'Apify Limit': newLimit } }),
      })
      await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: [source.handle], force: true }),
      })
      onConfirm(newLimit)
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
      <div onClick={e => e.stopPropagation()} style={{
        background: '#111', border: '1px solid #333', borderRadius: '12px',
        padding: '24px', width: '380px',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
          Update & Re-scrape @{source.handle}?
        </h3>
        <p style={{ fontSize: '13px', color: '#a3a3a3', marginBottom: '16px', lineHeight: 1.5 }}>
          Limit: <span style={{ color: '#71717a' }}>{oldLimit}</span> → <span style={{ color: '#a78bfa', fontWeight: 600 }}>{newLimit}</span> reels
        </p>

        <div style={{ background: '#1a1000', border: '1px solid #5c4b00', borderRadius: '10px', padding: '20px', marginBottom: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#f59e0b', marginBottom: '4px' }}>~${estCost}</div>
          <div style={{ fontSize: '12px', color: '#a3a3a3' }}>Estimated Apify cost for {newLimit} reels</div>
          <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '8px' }}>Duplicates auto-skipped (free)</div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...btnStyle, background: '#333' }}>Cancel</button>
          <button onClick={confirm} disabled={saving} style={{ ...btnStyle, background: '#a78bfa', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Scraping...' : 'Update & Scrape'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EnableModal({ source, onClose, onConfirm, onAddToBatch, batchCount }) {
  const [lookback, setLookback] = useState(source.lookbackDays || 180)
  const [limit, setLimit] = useState(source.apifyLimit || 15)
  const [saving, setSaving] = useState(false)

  const estCost = (limit * COST_PER_REEL).toFixed(2)

  const doEnable = async (scrapeNow) => {
    setSaving(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          fields: { Enabled: true, 'Lookback Days': lookback, 'Apify Limit': limit },
        }),
      })

      if (scrapeNow) {
        await fetch('/api/admin/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handles: [source.handle], force: true }),
        })
      }

      onConfirm({ lookbackDays: lookback, apifyLimit: limit, scraping: scrapeNow })
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addToBatch = async () => {
    setSaving(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          fields: { Enabled: true, 'Lookback Days': lookback, 'Apify Limit': limit },
        }),
      })
      onAddToBatch({ ...source, lookbackDays: lookback, apifyLimit: limit })
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
          Adjust scrape settings, then scrape now or add to batch.
        </p>

        <label style={labelStyle}>Lookback Days</label>
        <input type="text" inputMode="numeric" value={lookback} onChange={e => setLookback(parseInt(e.target.value.replace(/\D/g, '')) || '')} onBlur={e => { if (!e.target.value) setLookback(180) }} style={inputStyle} />
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>How far back to scrape reels (from today)</div>

        <label style={labelStyle}>Max Reels to Scrape</label>
        <input type="text" inputMode="numeric" value={limit} onChange={e => setLimit(parseInt(e.target.value.replace(/\D/g, '')) || '')} onBlur={e => { if (!e.target.value) setLimit(15) }} style={inputStyle} />
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>Limits the number of reels Apify will return</div>

        <div style={{ background: '#1a1000', border: '1px solid #5c4b00', borderRadius: '8px', padding: '12px', marginTop: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#f59e0b' }}>~${estCost}</div>
          <div style={{ fontSize: '11px', color: '#a3a3a3', marginTop: '2px' }}>Est. Apify cost for {limit} reels</div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, background: '#333' }}>Cancel</button>
          <button
            onClick={addToBatch}
            disabled={saving}
            style={{ ...btnStyle, background: '#1a1a2e', border: '1px solid #a78bfa', color: '#a78bfa', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? '...' : `Add to Batch${batchCount > 0 ? ` (${batchCount})` : ''}`}
          </button>
          <button
            onClick={() => doEnable(true)}
            disabled={saving}
            style={{ ...btnStyle, background: '#a78bfa', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Enable & Scrape'}
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
  const [rescrapeSource, setRescrapeSource] = useState(null) // { source, newLimit }
  const [batch, setBatch] = useState([]) // queued sources for batch scrape
  const [batchScraping, setBatchScraping] = useState(false)


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

  const handleEnableConfirm = ({ lookbackDays, apifyLimit, scraping: startedScrape }) => {
    setSources(prev => prev.map(s => s.id === enableSource.id ? {
      ...s, enabled: true, lookbackDays, apifyLimit,
      ...(startedScrape ? { pipelineStatus: 'Processing' } : {}),
    } : s))
    setEnableSource(null)
  }

  const handleAddToBatch = (source) => {
    setBatch(prev => {
      if (prev.find(s => s.id === source.id)) return prev
      return [...prev, source]
    })
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: true, lookbackDays: source.lookbackDays, apifyLimit: source.apifyLimit } : s))
    setEnableSource(null)
  }

  const scrapeBatch = async () => {
    if (batch.length === 0) return
    setBatchScraping(true)
    const handles = batch.map(s => s.handle)
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles, force: true }),
      })
      if (!res.ok) throw new Error('Batch scrape failed')
      setSources(prev => prev.map(s => handles.includes(s.handle) ? { ...s, pipelineStatus: 'Processing' } : s))
      setBatch([])
    } catch (err) {
      alert(err.message)
    } finally {
      setBatchScraping(false)
    }
  }

  const scrapeOne = async (source) => {
    setScraping(prev => ({ ...prev, [source.id]: true }))
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: [source.handle], force: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scrape failed')
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
          gridTemplateColumns: '40px 1fr 120px 80px 70px 90px 120px 90px 70px 90px',
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
              gridTemplateColumns: '40px 1fr 120px 80px 70px 90px 120px 90px 70px 90px',
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
              {source.ageRestricted && (
                <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: 700, color: '#ef4444', background: '#2d1515', border: '1px solid #5c2020', borderRadius: '3px', padding: '1px 4px', verticalAlign: 'middle' }}>18+</span>
              )}
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
                type="text"
                inputMode="numeric"
                value={source.lookbackDays || 180}
                onChange={e => {
                  const val = parseInt(e.target.value.replace(/\D/g, '')) || ''
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, lookbackDays: val } : s))
                }}
                onBlur={e => {
                  const val = parseInt(e.target.value) || 180
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, lookbackDays: val } : s))
                  fetch('/api/admin/sources', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: source.id, fields: { 'Lookback Days': val } }),
                  })
                }}
                style={{ width: '100%', padding: '2px 4px', background: 'transparent', border: '1px solid transparent', borderRadius: '4px', color: '#71717a', fontSize: '12px', textAlign: 'right', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = '#333'}
                onBlurCapture={e => e.target.style.borderColor = 'transparent'}
              />
            </div>

            {/* Apify Limit — inline editable, triggers rescrape modal on change */}
            <div style={{ textAlign: 'right' }}>
              <input
                type="text"
                inputMode="numeric"
                value={source._editingLimit != null ? source._editingLimit : (source.apifyLimit || 15)}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '')
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, _editingLimit: val } : s))
                }}
                onBlur={e => {
                  const newVal = parseInt(e.target.value) || 15
                  const oldVal = source.apifyLimit || 15
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, _editingLimit: undefined } : s))
                  if (newVal !== oldVal) {
                    setRescrapeSource({ source, newLimit: newVal })
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur()
                }}
                style={{ width: '100%', padding: '2px 4px', background: 'transparent', border: '1px solid transparent', borderRadius: '4px', color: '#71717a', fontSize: '12px', textAlign: 'right', outline: 'none', transition: 'border-color 0.15s' }}
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
                {scraping[source.id] ? '...' : 'Scrape New'}
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
      {reelsSource && <ReelsModal source={reelsSource} sources={sources} onClose={() => setReelsSource(null)} onNavigate={setReelsSource} />}
      {enableSource && <EnableModal source={enableSource} onClose={() => setEnableSource(null)} onConfirm={handleEnableConfirm} onAddToBatch={handleAddToBatch} batchCount={batch.length} />}
      {rescrapeSource && (
        <RescrapeModal
          source={rescrapeSource.source}
          newLimit={rescrapeSource.newLimit}
          onClose={() => {
            setRescrapeSource(null)
          }}
          onConfirm={(newLimit) => {
            setSources(prev => prev.map(s => s.id === rescrapeSource.source.id ? { ...s, apifyLimit: newLimit, pipelineStatus: 'Processing' } : s))
            setRescrapeSource(null)
          }}
        />
      )}

      {/* Floating batch bar */}
      {batch.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          background: 'linear-gradient(to top, #111 80%, transparent)',
          padding: '16px 24px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
        }}>
          <div style={{
            background: '#1a1a2e', border: '1px solid #a78bfa', borderRadius: '12px',
            padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '16px',
            boxShadow: '0 -4px 20px rgba(167, 139, 250, 0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#a78bfa' }}>{batch.length}</span>
              <span style={{ fontSize: '13px', color: '#d4d4d8' }}>
                {batch.length === 1 ? 'creator' : 'creators'} queued
              </span>
              <span style={{ fontSize: '12px', color: '#71717a' }}>
                ({batch.map(s => `@${s.handle}`).join(', ')})
              </span>
            </div>
            <div style={{ width: '1px', height: '20px', background: '#333' }} />
            <div style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 600 }}>
              ~${batch.reduce((sum, s) => sum + (s.apifyLimit || 15) * COST_PER_REEL, 0).toFixed(2)}
            </div>
            <button
              onClick={() => setBatch([])}
              style={{ ...btnStyle, background: '#333', fontSize: '12px', padding: '6px 12px' }}
            >
              Clear
            </button>
            <button
              onClick={scrapeBatch}
              disabled={batchScraping}
              style={{ ...btnStyle, background: '#a78bfa', fontSize: '13px', padding: '8px 20px', opacity: batchScraping ? 0.6 : 1 }}
            >
              {batchScraping ? 'Scraping...' : `Scrape All (${batch.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
