'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Dropbox shared links return an HTML preview page when used as <img src>.
// Appending ?raw=1 (or replacing dl=0) makes Dropbox serve the raw file bytes.
// Same trick the editor uses (rawDropboxUrl in EditorDashboard.js).
function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

// Chat Wall — chat manager photo library.
// - Pick a creator (filtered by Chat Team A / B / All)
// - Browse all photos for that creator, paginated 40 per page, newest first
// - Toggle "Use" → marks Used By Chat Manager At, removes from Available view
// - "Used" tab to see toggled photos and restore if needed

const TEAMS = ['All', 'A', 'B']
const VIEWS = ['available', 'used']

export default function ChatWallPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [creators, setCreators] = useState([])
  const [creatorsLoading, setCreatorsLoading] = useState(true)
  const [viewer, setViewer] = useState({ role: null, chatTeam: null, isRealChatManager: false })
  const [team, setTeam] = useState(searchParams.get('team') || 'All')
  const [creatorId, setCreatorId] = useState(searchParams.get('creator') || '')
  const [view, setView] = useState(searchParams.get('view') || 'available')
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '0', 10))

  const [photos, setPhotos] = useState([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [pendingIds, setPendingIds] = useState(new Set())

  // Load creators once
  useEffect(() => {
    let cancelled = false
    setCreatorsLoading(true)
    fetch('/api/admin/chat-wall/creators')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setCreators(data.creators || [])
        if (data.viewer) setViewer(data.viewer)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCreatorsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Filter creators by selected team
  const visibleCreators = useMemo(() => {
    if (team === 'All') return creators
    return creators.filter(c => (c.chatTeam || '').toUpperCase().startsWith(team))
  }, [creators, team])

  // If selected creator no longer matches the team filter, clear it
  useEffect(() => {
    if (!creatorId) return
    if (!visibleCreators.find(c => c.id === creatorId)) {
      setCreatorId('')
    }
  }, [team, visibleCreators, creatorId])

  // Sync URL state — preserves selection on refresh
  useEffect(() => {
    const params = new URLSearchParams()
    if (team !== 'All') params.set('team', team)
    if (creatorId) params.set('creator', creatorId)
    if (view !== 'available') params.set('view', view)
    if (page > 0) params.set('page', String(page))
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [team, creatorId, view, page, pathname, router])

  // Load photos when creator/view/page changes
  const loadPhotos = useCallback(() => {
    if (!creatorId) {
      setPhotos([])
      setTotal(0)
      setTotalPages(0)
      return
    }
    setPhotosLoading(true)
    const params = new URLSearchParams({ creatorId, view, page: String(page) })
    fetch(`/api/admin/chat-wall/photos?${params}`)
      .then(r => r.json())
      .then(data => {
        setPhotos(data.photos || [])
        setTotal(data.total || 0)
        setTotalPages(data.totalPages || 0)
      })
      .catch(() => {
        setPhotos([])
        setTotal(0)
        setTotalPages(0)
      })
      .finally(() => setPhotosLoading(false))
  }, [creatorId, view, page])

  useEffect(() => { loadPhotos() }, [loadPhotos])

  const togglePhoto = async (asset, makeUsed) => {
    setPendingIds(prev => new Set(prev).add(asset.id))
    // Optimistic remove from current view
    setPhotos(prev => prev.filter(p => p.id !== asset.id))
    setTotal(t => Math.max(0, t - 1))
    try {
      const res = await fetch('/api/admin/chat-wall/photos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, used: makeUsed }),
      })
      if (!res.ok) throw new Error(await res.text())
      // Refresh totals/pagination after a beat
      loadPhotos()
    } catch (err) {
      console.error('Toggle failed:', err)
      // Reload to get truthful state
      loadPhotos()
      alert('Failed to update. Try again.')
    } finally {
      setPendingIds(prev => {
        const next = new Set(prev)
        next.delete(asset.id)
        return next
      })
    }
  }

  const selectedCreator = creators.find(c => c.id === creatorId)

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
          Chat Wall
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '4px 0 0', maxWidth: '640px' }}>
          Browse a creator&apos;s full photo library. Click <strong>Use</strong> when you post one to the wall —
          it&apos;ll disappear from Available so you don&apos;t reuse it. Switch to <strong>Used</strong> to see what
          you&apos;ve already used (and restore any if you need to).
        </p>
      </div>

      {/* Team filter — only for admins previewing. Real chat managers are
          server-scoped to their assigned team and don't see the toggle. */}
      {!viewer.isRealChatManager && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)' }}>Team</span>
          {TEAMS.map(t => (
            <button
              key={t}
              onClick={() => { setTeam(t); setPage(0) }}
              style={pillStyle(team === t)}
            >
              {t === 'All' ? 'All' : `Team ${t}`}
            </button>
          ))}
        </div>
      )}
      {viewer.isRealChatManager && viewer.chatTeam && (
        <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
          Showing your assigned creators · <span style={{ color: 'var(--palm-pink)' }}>Team {viewer.chatTeam}</span>
        </div>
      )}
      {viewer.isRealChatManager && !viewer.chatTeam && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255, 100, 100, 0.08)', border: '1px solid rgba(255, 100, 100, 0.2)', fontSize: '12px', color: '#ffb4b4' }}>
          Your account isn&apos;t tagged with a chat team yet. Ask an admin to set <code>chatTeam</code> in your Clerk metadata.
        </div>
      )}

      {/* Creator picker */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)', marginBottom: '6px' }}>
          Creator
        </label>
        <select
          value={creatorId}
          onChange={e => { setCreatorId(e.target.value); setPage(0) }}
          disabled={creatorsLoading}
          style={{
            background: '#0f0f0f',
            border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
            borderRadius: '8px',
            padding: '10px 14px',
            color: 'var(--foreground)',
            fontSize: '14px',
            minWidth: '300px',
            cursor: creatorsLoading ? 'wait' : 'pointer',
          }}
        >
          <option value="">{creatorsLoading ? 'Loading creators...' : 'Select a creator'}</option>
          {visibleCreators.map(c => (
            <option key={c.id} value={c.id}>
              {c.aka || c.name}{c.chatTeam ? ` · Team ${c.chatTeam}` : ''}
            </option>
          ))}
        </select>
        {visibleCreators.length === 0 && !creatorsLoading && (
          <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '6px' }}>
            No creators found{team !== 'All' ? ` for Team ${team}` : ''}.
          </p>
        )}
      </div>

      {/* View tabs (Available / Used) */}
      {creatorId && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid var(--card-border, rgba(255,255,255,0.06))' }}>
          {VIEWS.map(v => (
            <button
              key={v}
              onClick={() => { setView(v); setPage(0) }}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: view === v ? '2px solid var(--palm-pink)' : '2px solid transparent',
                color: view === v ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                fontSize: '13px',
                fontWeight: view === v ? 600 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {v} {view === v && total > 0 ? `(${total})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Header above grid */}
      {creatorId && !photosLoading && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            {selectedCreator?.aka || selectedCreator?.name} · {total} {view === 'used' ? 'used' : 'available'} {total === 1 ? 'photo' : 'photos'}
          </div>
          {totalPages > 1 && (
            <Pager page={page} totalPages={totalPages} onChange={setPage} />
          )}
        </div>
      )}

      {/* Grid */}
      {creatorId && photosLoading && (
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: '13px', color: 'var(--foreground-muted)' }}>
          Loading photos...
        </div>
      )}
      {creatorId && !photosLoading && photos.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: '13px', color: 'var(--foreground-muted)' }}>
          {view === 'used' ? 'No photos marked used yet.' : 'No photos available for this creator.'}
        </div>
      )}
      {creatorId && !photosLoading && photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {photos.map(p => (
            <PhotoCard
              key={p.id}
              photo={p}
              view={view}
              pending={pendingIds.has(p.id)}
              onToggle={() => togglePhoto(p, view === 'available')}
            />
          ))}
        </div>
      )}

      {/* Footer pager */}
      {creatorId && !photosLoading && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
          <Pager page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  )
}

function PhotoCard({ photo, view, pending, onToggle }) {
  const [hovered, setHovered] = useState(false)
  const [inView, setInView] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const cardRef = useRef(null)

  // Only mount the <img> when the card scrolls within ~600px of viewport.
  // More aggressive than native loading="lazy" — keeps the page light when
  // browsing 100+ photos at once.
  useEffect(() => {
    if (inView) return
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  // Source priority for the thumbnail:
  // 1. Cloudflare Images CDN (fastest — global edge, ~50ms) when backfilled
  // 2. Airtable auto-thumbnail (medium — Airtable CDN, ~500px)
  // 3. Raw Dropbox file (slowest, full-res — fallback only)
  const imgSrc = photo.cdnUrl || photo.thumbLarge || photo.thumbFull || rawDropboxUrl(photo.dropboxLink)

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        aspectRatio: '3/4',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#0a0a0a',
        border: '1px solid var(--card-border, rgba(255,255,255,0.06))',
        opacity: pending ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={photo.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
        />
      )}

      {/* Hover overlay with action */}
      {(hovered || pending) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '10px',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {photo.name}
          </div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
            {formatDate(photo.createdTime)}
          </div>
          <button
            onClick={onToggle}
            disabled={pending}
            style={{
              padding: '8px 10px',
              background: view === 'available' ? 'var(--palm-pink)' : 'rgba(255,255,255,0.1)',
              color: view === 'available' ? '#060606' : 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: pending ? 'wait' : 'pointer',
            }}
          >
            {pending ? '...' : view === 'available' ? 'Use' : 'Restore'}
          </button>
          <a
            href={photo.dropboxLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.08)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              fontSize: '11px',
              textAlign: 'center',
              textDecoration: 'none',
            }}
          >
            Open ↗
          </a>
        </div>
      )}
    </div>
  )
}

function Pager({ page, totalPages, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        style={pagerBtnStyle(page === 0)}
      >
        ← Prev
      </button>
      <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
        Page {page + 1} / {totalPages}
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        style={pagerBtnStyle(page >= totalPages - 1)}
      >
        Next →
      </button>
    </div>
  )
}

function pillStyle(active) {
  return {
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: 500,
    borderRadius: '999px',
    border: '1px solid ' + (active ? 'var(--palm-pink)' : 'var(--card-border, rgba(255,255,255,0.08))'),
    background: active ? 'rgba(232, 160, 160, 0.15)' : 'transparent',
    color: active ? 'var(--palm-pink)' : 'var(--foreground-muted)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  }
}

function pagerBtnStyle(disabled) {
  return {
    padding: '4px 10px',
    fontSize: '12px',
    background: 'transparent',
    border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
    borderRadius: '6px',
    color: disabled ? 'var(--foreground-subtle, #555)' : 'var(--foreground-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}
