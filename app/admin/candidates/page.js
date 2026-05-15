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

  if (loading) {
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px' }}>Loading candidates...</div>
  }
  if (error) {
    return <div style={{ color: '#E87878', fontSize: '13px', padding: '40px' }}>{error}</div>
  }

  const all = data?.candidates || []
  const q = search.trim().toLowerCase()
  const filtered = all.filter(c => {
    const isDismissed = dismissed.has(c.handle.toLowerCase())
    if (!showDismissed && isDismissed) return false
    if (showDismissed && !isDismissed) return false
    if (q && !c.handle.toLowerCase().includes(q)) return false
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
            onClick={refresh}
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'rgba(255,255,255,0.08)', color: '#999', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
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

                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', gap: '10px' }}>
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
