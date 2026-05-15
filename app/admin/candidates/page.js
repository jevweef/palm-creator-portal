'use client'

import { useEffect, useState } from 'react'

function timeAgo(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function formatFollowers(n) {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

// Bucket definitions — match the labels the user asked for.
// min is inclusive, max is exclusive. null max = no upper bound.
const FOLLOWER_BUCKETS = [
  { key: 'unknown', label: 'Unknown', match: (n) => !n },
  { key: '0-10k',   label: '0–10K',   match: (n) => n > 0 && n < 10_000 },
  { key: '10-50k',  label: '10–50K',  match: (n) => n >= 10_000 && n < 50_000 },
  { key: '50-100k', label: '50–100K', match: (n) => n >= 50_000 && n < 100_000 },
  { key: '100-500k',label: '100–500K',match: (n) => n >= 100_000 && n < 500_000 },
  { key: '500k-1m', label: '500K–1M', match: (n) => n >= 500_000 && n < 1_000_000 },
  { key: '1m+',     label: '1M+',          match: (n) => n >= 1_000_000 },
]

function bucketOf(n) {
  for (const b of FOLLOWER_BUCKETS) if (b.match(n)) return b.key
  return 'unknown'
}

const DISMISSED_KEY = 'inspo:candidates:dismissed'

export default function AdminCandidates() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState({}) // handle -> boolean
  const [added, setAdded] = useState(new Set()) // handles added this session
  const [dismissed, setDismissed] = useState(new Set())
  const [showDismissed, setShowDismissed] = useState(false)
  const [search, setSearch] = useState('')
  const [bucket, setBucket] = useState('all') // 'all' or a FOLLOWER_BUCKETS key
  const [enriching, setEnriching] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState({ processed: 0, total: 0 })

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')
      setDismissed(new Set(stored))
    } catch {}
    refresh()
  }, [])

  function persistDismissed(next) {
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next))) } catch {}
  }

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/source-candidates')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setData(d)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function addToSources(handle) {
    setAdding(s => ({ ...s, [handle]: true }))
    try {
      const res = await fetch('/api/admin/review/add-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      setAdded(prev => new Set([...prev, handle.toLowerCase()]))
    } catch (err) {
      alert(err.message)
    } finally {
      setAdding(s => ({ ...s, [handle]: false }))
    }
  }

  function dismiss(handle) {
    const next = new Set(dismissed)
    next.add(handle.toLowerCase())
    persistDismissed(next)
  }

  function undismiss(handle) {
    const next = new Set(dismissed)
    next.delete(handle.toLowerCase())
    persistDismissed(next)
  }

  async function enrichFollowers() {
    if (enriching) return

    // Snapshot the unknown queue at click time, using the candidates already
    // loaded. attempted=true means a prior enrichment pass already wrote a
    // value (0 for misses) — skip them so we don't re-spend RapidAPI credits.
    const queue = (data?.candidates || []).filter(
      c => !c.attempted && c.recordId && !dismissed.has(c.handle.toLowerCase())
    )

    if (queue.length === 0) {
      alert('Nothing to enrich.')
      return
    }

    setEnriching(true)
    setEnrichProgress({ processed: 0, total: queue.length })

    const BATCH = 12

    try {
      for (let i = 0; i < queue.length; i += BATCH) {
        const slice = queue.slice(i, i + BATCH).map(c => ({
          handle: c.handle,
          recordId: c.recordId,
        }))

        const res = await fetch('/api/admin/enrich-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handles: slice }),
        })

        // Vercel returns HTML on timeout — guard against that.
        const ct = res.headers.get('content-type') || ''
        if (!res.ok || !ct.includes('application/json')) {
          const text = await res.text()
          throw new Error(`Enrich batch failed (${res.status}): ${text.slice(0, 120)}`)
        }
        const d = await res.json()

        // Merge results into the loaded candidates so the UI reflects new
        // follower counts without a full refresh.
        setData(prev => {
          if (!prev?.candidates) return prev
          const byHandle = new Map(d.results.map(r => [r.handle.toLowerCase(), r.followerCount]))
          return {
            ...prev,
            candidates: prev.candidates.map(c => {
              const fc = byHandle.get(c.handle.toLowerCase())
              if (fc === undefined) return c
              return { ...c, followerCount: fc || null, attempted: true }
            }),
          }
        })

        setEnrichProgress({ processed: Math.min(i + slice.length, queue.length), total: queue.length })
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setEnriching(false)
    }
  }

  if (loading) {
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px' }}>Loading candidates...</div>
  }
  if (error) {
    return <div style={{ color: '#E87878', fontSize: '13px', padding: '40px' }}>{error}</div>
  }

  const all = data?.candidates || []
  const q = search.trim().toLowerCase()

  // Bucket counts are over the dismissed-aware pool (so they shift when you
  // toggle "Showing Dismissed").
  const poolForBuckets = all.filter(c => {
    const isDismissed = dismissed.has(c.handle.toLowerCase())
    return showDismissed ? isDismissed : !isDismissed
  })
  const bucketCounts = { all: poolForBuckets.length }
  for (const b of FOLLOWER_BUCKETS) bucketCounts[b.key] = 0
  for (const c of poolForBuckets) bucketCounts[bucketOf(c.followerCount)]++

  const filtered = all.filter(c => {
    const isDismissed = dismissed.has(c.handle.toLowerCase())
    if (!showDismissed && isDismissed) return false
    if (showDismissed && !isDismissed) return false
    if (q && !c.handle.toLowerCase().includes(q)) return false
    if (bucket !== 'all' && bucketOf(c.followerCount) !== bucket) return false
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '12px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Candidate Creators</h1>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
            Unique handles posting reels in your review queue. {data?.alreadyOnSources || 0} already on Sources.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter handles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground)', fontSize: '12px', outline: 'none' }}
          />
          <button
            onClick={() => setShowDismissed(s => !s)}
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: showDismissed ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.08)', color: showDismissed ? 'var(--palm-pink)' : '#999', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            {showDismissed ? `Showing Dismissed (${dismissed.size})` : `Dismissed (${dismissed.size})`}
          </button>
          <button
            onClick={enrichFollowers}
            disabled={enriching}
            title="Look up follower counts via RapidAPI for candidates currently in the Unknown bucket"
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: enriching ? 'rgba(255,255,255,0.08)' : 'rgba(232, 160, 160, 0.06)', color: enriching ? '#999' : 'var(--palm-pink)', border: 'none', borderRadius: '6px', cursor: enriching ? 'default' : 'pointer' }}
          >
            {enriching
              ? `Enriching ${enrichProgress.processed}/${enrichProgress.total || '...'}`
              : `+ Enrich Followers${bucketCounts.unknown ? ` (${bucketCounts.unknown})` : ''}`}
          </button>
          <button
            onClick={refresh}
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'rgba(255,255,255,0.08)', color: '#999', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Follower-size filter pills */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {[{ key: 'all', label: 'All' }, ...FOLLOWER_BUCKETS].map(b => {
          const active = bucket === b.key
          const count = bucketCounts[b.key]
          if (b.key !== 'all' && count === 0) return null
          return (
            <button
              key={b.key}
              onClick={() => setBucket(active ? 'all' : b.key)}
              style={{
                padding: '5px 14px', fontSize: '12px', fontWeight: 600,
                borderRadius: '20px', cursor: 'pointer', border: 'none',
                background: active ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.08)',
                color: active ? 'var(--palm-pink)' : '#999',
                outline: active ? '1.5px solid #E88FAC' : '1px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {b.label}
              <span style={{ marginLeft: '4px', fontSize: '11px', opacity: 0.7 }}>({count})</span>
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '16px' }}>
        {filtered.length} {showDismissed ? 'dismissed' : 'pending'} {filtered.length === 1 ? 'creator' : 'creators'}
        {!showDismissed && all.length > filtered.length && ` (${all.length - filtered.length} hidden)`}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px' }}>
          {showDismissed ? 'No dismissed candidates.' : 'No candidates. Import reels or scrape sources to discover new creators.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filtered.map(c => {
            const key = c.handle.toLowerCase()
            const isAdded = added.has(key)
            const isDismissed = dismissed.has(key)
            return (
              <div
                key={key}
                style={{
                  background: 'var(--card-bg-solid)',
                  borderRadius: '14px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  opacity: isAdded || isDismissed ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                  <a
                    href={`https://instagram.com/${c.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)', textDecoration: 'none' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--palm-pink)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--foreground)'}
                  >
                    @{c.handle}
                  </a>
                  <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
                    {c.count} {c.count === 1 ? 'reel' : 'reels'}
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {c.followerCount ? (
                    <span style={{ color: 'rgba(240, 236, 232, 0.85)', fontWeight: 600 }}>{formatFollowers(c.followerCount)} followers</span>
                  ) : (
                    <span style={{ opacity: 0.6 }}>followers unknown</span>
                  )}
                  {c.latestSavedAt && <span>saved {timeAgo(c.latestSavedAt)}</span>}
                  {c.dataSources?.length > 0 && (
                    <span style={{ opacity: 0.7 }}>{c.dataSources.join(', ')}</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
                  <a
                    href={`https://instagram.com/${c.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.08)', color: '#999', border: 'none', borderRadius: '6px', textDecoration: 'none' }}
                  >
                    Profile ↗
                  </a>
                  {isDismissed ? (
                    <button
                      onClick={() => undismiss(c.handle)}
                      style={{ flex: 1, padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.08)', color: '#999', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Restore
                    </button>
                  ) : isAdded ? (
                    <button
                      disabled
                      style={{ flex: 2, padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.1)', color: '#7DD3A4', border: 'none', borderRadius: '6px', cursor: 'default' }}
                    >
                      ✓ Added
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => addToSources(c.handle)}
                        disabled={adding[c.handle]}
                        style={{ flex: 1, padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: adding[c.handle] ? 'default' : 'pointer', opacity: adding[c.handle] ? 0.6 : 1 }}
                      >
                        {adding[c.handle] ? '...' : '+ Add'}
                      </button>
                      <button
                        onClick={() => dismiss(c.handle)}
                        title="Hide this candidate"
                        style={{ padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: '#999', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
