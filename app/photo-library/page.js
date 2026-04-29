'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

// Dropbox shared links return an HTML preview page when used as <img src>.
// Appending ?raw=1 (or replacing dl=0) makes Dropbox serve the raw file bytes.
// Same trick the editor uses (rawDropboxUrl in EditorDashboard.js).
function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

// Force a browser download of the original file via Dropbox's ?dl=1 URL.
// Dropbox returns Content-Disposition: attachment for ?dl=1, so the browser
// downloads instead of navigating. Using a synthetic anchor click (with
// target=_blank as a fallback) — iframes get blocked as cross-origin in
// modern browsers and silently fail.
function triggerDownload(asset) {
  if (!asset?.dropboxLink) return
  const clean = asset.dropboxLink
    .replace(/[?&]dl=0/, '')
    .replace(/[?&]raw=1/, '')
    .replace(/[?&]dl=1/, '')
  const dlUrl = clean + (clean.includes('?') ? '&dl=1' : '?dl=1')
  const a = document.createElement('a')
  a.href = dlUrl
  a.download = asset.name || ''
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => a.remove(), 500)
}

// Note: we used to have a "Don't show this again" preference (SKIP_CONFIRM_KEY)
// that bypassed the confirm modal. Removed when "Use" became a real choice
// between Wall Post / Mass Message — the modal isn't a yes/no anymore, it's
// the only way to pick which surface, so it always needs to show.

// Chat Wall — chat manager photo library.
// - Pick a creator (filtered by Chat Team A / B / All)
// - Browse all photos for that creator, paginated 40 per page, newest first
// - Toggle "Use" → marks Used By Chat Manager At, removes from Available view
// - "Used" tab to see toggled photos and restore if needed

const TEAMS = ['All', 'A', 'B']
const VIEWS = ['available', 'used']
const PAGE_SIZES = [25, 40, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 40
const PAGE_SIZE_KEY = 'chatWall.pageSize'

export default function ChatWallPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user } = useUser()
  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const [creators, setCreators] = useState([])
  const [creatorsLoading, setCreatorsLoading] = useState(true)
  const [viewer, setViewer] = useState({ role: null, chatTeam: null, isRealChatManager: false, impersonatingUserId: null })
  // When an admin uses "View As [chat manager]" in the SuperAdminBar, the
  // selection lives in localStorage. Read it on mount and pass to the API
  // as viewAsUserId so the page renders exactly as that user would see it.
  const [viewAsUserId, setViewAsUserId] = useState(null)
  const [viewAsName, setViewAsName] = useState(null)
  const [team, setTeam] = useState(searchParams.get('team') || 'All')
  const [creatorId, setCreatorId] = useState(searchParams.get('creator') || '')
  const [view, setView] = useState(searchParams.get('view') || 'available')
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '0', 10))
  // Page size is sticky across sessions via localStorage. URL param wins on
  // initial load if explicitly set (lets you share a link with N=100, etc).
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const [photos, setPhotos] = useState([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [availableCount, setAvailableCount] = useState(0)
  const [usedCount, setUsedCount] = useState(0)
  const [pendingIds, setPendingIds] = useState(new Set())
  const [modalPhotoId, setModalPhotoId] = useState(null)
  // Asset waiting on the Use & Download confirmation. Only set when going
  // available → used (Restore skips confirmation since it's reversible).
  const [confirmAsset, setConfirmAsset] = useState(null)

  // Hydrate "View As [chat manager]" selection from localStorage. Polled
  // here (not just on mount) so changes from SuperAdminBar take effect
  // without a hard refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function read() {
      try {
        const raw = window.localStorage.getItem('superadmin_chatManager')
        if (!raw) {
          setViewAsUserId(null)
          setViewAsName(null)
          return
        }
        const parsed = JSON.parse(raw)
        setViewAsUserId(parsed?.id || null)
        setViewAsName(parsed?.firstName || parsed?.fullName || parsed?.email || null)
      } catch {
        setViewAsUserId(null)
        setViewAsName(null)
      }
    }
    read()
    // Listen for cross-tab changes too
    const onStorage = (e) => { if (e.key === 'superadmin_chatManager') read() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Hydrate sticky page size from localStorage / URL on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const fromUrl = parseInt(searchParams.get('pageSize') || '', 10)
    if (PAGE_SIZES.includes(fromUrl)) {
      setPageSize(fromUrl)
      return
    }
    const stored = parseInt(window.localStorage.getItem(PAGE_SIZE_KEY) || '', 10)
    if (PAGE_SIZES.includes(stored)) setPageSize(stored)
    // Only run on first mount — subsequent changes flow through the dropdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load creators. Re-runs when viewAsUserId changes so admin can swap
  // between impersonations without refreshing.
  useEffect(() => {
    let cancelled = false
    setCreatorsLoading(true)
    const url = viewAsUserId
      ? `/api/photo-library/creators?viewAsUserId=${encodeURIComponent(viewAsUserId)}`
      : '/api/photo-library/creators'
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setCreators(data.creators || [])
        if (data.viewer) setViewer(data.viewer)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCreatorsLoading(false) })
    return () => { cancelled = true }
  }, [viewAsUserId])

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
      setAvailableCount(0)
      setUsedCount(0)
      return
    }
    setPhotosLoading(true)
    const params = new URLSearchParams({ creatorId, view, page: String(page), pageSize: String(pageSize) })
    fetch(`/api/photo-library/photos?${params}`)
      .then(r => r.json())
      .then(data => {
        setPhotos(data.photos || [])
        setTotal(data.total || 0)
        setTotalPages(data.totalPages || 0)
        if (typeof data.availableCount === 'number') setAvailableCount(data.availableCount)
        if (typeof data.usedCount === 'number') setUsedCount(data.usedCount)
      })
      .catch(() => {
        setPhotos([])
        setTotal(0)
        setTotalPages(0)
      })
      .finally(() => setPhotosLoading(false))
  }, [creatorId, view, page, pageSize])

  useEffect(() => { loadPhotos() }, [loadPhotos])

  // Public entry point. Marking Used always routes through the confirmation
  // modal — the modal is where the chat manager picks Wall Post vs Mass
  // Message, so it's required, not skippable. Restore goes straight through.
  const togglePhoto = (asset, makeUsed, opts = {}) => {
    if (makeUsed) {
      setConfirmAsset({ asset, advance: !!opts.advance })
      return
    }
    return commitToggle(asset, false, opts)
  }

  // Actual server call + optimistic UI + auto-download. usedFor must be
  // 'wall' or 'mm' when makeUsed=true.
  const commitToggle = async (asset, makeUsed, { advance = false, usedFor = null } = {}) => {
    setPendingIds(prev => new Set(prev).add(asset.id))

    if (makeUsed) triggerDownload(asset)

    // If the modal is open on this photo and we're auto-advancing, jump to
    // the next photo BEFORE removing the current one — feels snappier and
    // prevents a flash of "no modal" between toggle and next.
    if (advance && modalPhotoId === asset.id) {
      const idx = photos.findIndex(p => p.id === asset.id)
      const next = idx >= 0 && idx < photos.length - 1 ? photos[idx + 1] : null
      setModalPhotoId(next ? next.id : null)
    }

    // Optimistic: remove from current view, update both tab counts.
    setPhotos(prev => prev.filter(p => p.id !== asset.id))
    setTotal(t => Math.max(0, t - 1))
    if (makeUsed) {
      setAvailableCount(c => Math.max(0, c - 1))
      setUsedCount(c => c + 1)
    } else {
      setUsedCount(c => Math.max(0, c - 1))
      setAvailableCount(c => c + 1)
    }

    try {
      const body = makeUsed
        ? { assetId: asset.id, used: true, usedFor }
        : { assetId: asset.id, used: false }
      const res = await fetch('/api/photo-library/photos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      loadPhotos()
    } catch (err) {
      console.error('Toggle failed:', err)
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

  // Close the modal if its photo got removed (e.g. server reload returned a
  // shorter list) and never re-appeared.
  useEffect(() => {
    if (modalPhotoId && !photos.find(p => p.id === modalPhotoId)) {
      setModalPhotoId(null)
    }
  }, [photos, modalPhotoId])

  const selectedCreator = creators.find(c => c.id === creatorId)

  return (
    <div>
      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>{greeting}, </span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>{firstName}</span>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
          Social Media Photo Library
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '4px 0 0', maxWidth: '680px' }}>
          Browse a creator&apos;s full photo library. Click any photo, pick <strong>Wall Post</strong> or <strong>Mass Message</strong>,
          and we&apos;ll mark it with that label, remove it from Available, and download the original. Switch to <strong>Used</strong> to
          see what&apos;s been used (badged <span style={{ background: 'var(--palm-pink)', color: '#060606', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>WP</span> or <span style={{ background: '#7aa9ff', color: '#060606', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>MM</span>) and restore if needed.
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
      {viewer.isRealChatManager && viewer.chatTeam && !viewer.impersonatingUserId && (
        <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
          Showing your assigned creators · <span style={{ color: 'var(--palm-pink)' }}>Team {viewer.chatTeam}</span>
        </div>
      )}
      {/* Impersonation banner — shown to admins who selected a specific
          chat manager from the View As bar. Lets them confirm whose view
          they're seeing and clear it inline. */}
      {viewer.impersonatingUserId && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(232, 160, 160, 0.08)',
          border: '1px solid rgba(232, 160, 160, 0.25)',
          fontSize: '12px',
          color: 'var(--foreground-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <span>
            Viewing as <span style={{ color: 'var(--palm-pink)', fontWeight: 600 }}>{viewAsName || 'chat manager'}</span>
            {viewer.chatTeam ? <> · Team {viewer.chatTeam}</> : null}
          </span>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.localStorage.removeItem('superadmin_chatManager')
              }
              setViewAsUserId(null)
              setViewAsName(null)
            }}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              color: 'var(--foreground-muted)',
              cursor: 'pointer',
            }}
          >
            Stop impersonating
          </button>
        </div>
      )}
      {viewer.isRealChatManager && !viewer.chatTeam && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255, 100, 100, 0.08)', border: '1px solid rgba(255, 100, 100, 0.2)', fontSize: '12px', color: '#ffb4b4' }}>
          Your account isn&apos;t tagged with a chat team yet. Ask an admin to set <code>chatTeam</code> in your Clerk metadata.
        </div>
      )}

      {/* Creator picker — button grid. Each button shows the creator's
          name + photo count. Clicking selects them. Active button is
          highlighted in pink. Creators with 0 photos are filtered out by
          the API so we never render empty buttons. */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)', marginBottom: '8px' }}>
          Creator
        </label>
        {creatorsLoading ? (
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Loading creators...</div>
        ) : visibleCreators.length === 0 ? (
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            No creators with photos{team !== 'All' ? ` on Team ${team}` : ''}.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '10px',
          }}>
            {visibleCreators.map(c => {
              const active = creatorId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => { setCreatorId(c.id); setPage(0) }}
                  style={{
                    padding: '14px 16px',
                    background: active ? 'rgba(232, 160, 160, 0.12)' : '#0f0f0f',
                    border: `1px solid ${active ? 'var(--palm-pink)' : 'var(--card-border, rgba(255,255,255,0.08))'}`,
                    borderRadius: '10px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.borderColor = 'rgba(232, 160, 160, 0.4)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.borderColor = 'var(--card-border, rgba(255,255,255,0.08))'
                  }}
                >
                  <span style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: active ? 'var(--palm-pink)' : 'var(--foreground)',
                  }}>
                    {c.aka || c.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {c.photoCount} {c.photoCount === 1 ? 'photo' : 'photos'}
                    {c.chatTeam && (
                      <span style={{
                        padding: '1px 6px',
                        fontSize: '9px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        borderRadius: '999px',
                        background: 'rgba(255,255,255,0.06)',
                        color: 'var(--foreground-muted)',
                      }}>
                        Team {(c.chatTeam || '').replace(/\s*Team$/i, '').trim()}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* View tabs (Available / Used) — counts shown on BOTH tabs so
          switching never glitches. Updated optimistically on toggle. */}
      {creatorId && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid var(--card-border, rgba(255,255,255,0.06))' }}>
          {VIEWS.map(v => {
            const count = v === 'available' ? availableCount : usedCount
            return (
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
                {v} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Header above grid */}
      {creatorId && !photosLoading && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            {selectedCreator?.aka || selectedCreator?.name} · {total} {view === 'used' ? 'used' : 'available'} {total === 1 ? 'photo' : 'photos'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            {/* Page size — sticky per browser via localStorage. Resets to
                page 0 on change so the user doesn't end up past the new
                last page. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '10px' }}>Per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10)
                  setPageSize(next)
                  setPage(0)
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem(PAGE_SIZE_KEY, String(next))
                  }
                }}
                style={{
                  background: '#0f0f0f',
                  border: '1px solid var(--card-border, rgba(255,255,255,0.08))',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  color: 'var(--foreground)',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {PAGE_SIZES.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {totalPages > 1 && (
              <Pager page={page} totalPages={totalPages} onChange={setPage} />
            )}
          </div>
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
              onClick={() => setModalPhotoId(p.id)}
            />
          ))}
        </div>
      )}

      {/* Fullscreen modal — split layout, prev/next overlay nav */}
      {modalPhotoId && (
        <PhotoModal
          photos={photos}
          photoId={modalPhotoId}
          view={view}
          pending={pendingIds.has(modalPhotoId)}
          onClose={() => setModalPhotoId(null)}
          onNavigate={(id) => setModalPhotoId(id)}
          onToggle={(asset) => togglePhoto(asset, view === 'available', { advance: true })}
        />
      )}

      {/* Use & Download confirmation. Two CTAs — "Wall Post" or "Mass
          Message" — so the chat manager labels what the photo is being
          used for. Both download the file. */}
      {confirmAsset && (
        <UseConfirmModal
          asset={confirmAsset.asset}
          onCancel={() => setConfirmAsset(null)}
          onConfirm={(usedFor) => {
            const { asset, advance } = confirmAsset
            setConfirmAsset(null)
            commitToggle(asset, true, { advance, usedFor })
          }}
        />
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

function PhotoCard({ photo, view, pending, onToggle, onClick }) {
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
      onClick={() => { if (!pending) onClick?.() }}
      style={{
        position: 'relative',
        aspectRatio: '3/4',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#0a0a0a',
        border: '1px solid var(--card-border, rgba(255,255,255,0.06))',
        opacity: pending ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
        cursor: pending ? 'wait' : 'pointer',
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

      {/* Usage badge — only shown in Used view. WP = pink, MM = blue. */}
      {view === 'used' && photo.usedFor && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          padding: '3px 8px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: '#060606',
          background: photo.usedFor === 'Mass Message' ? '#7aa9ff' : 'var(--palm-pink)',
          borderRadius: '999px',
          textTransform: 'uppercase',
        }}>
          {photo.usedFor === 'Mass Message' ? 'MM' : 'WP'}
        </div>
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
            onClick={(e) => { e.stopPropagation(); onToggle?.() }}
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
            onClick={(e) => e.stopPropagation()}
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

function PhotoModal({ photos, photoId, view, pending, onClose, onNavigate, onToggle }) {
  const idx = photos.findIndex(p => p.id === photoId)
  const photo = idx >= 0 ? photos[idx] : null
  const prevPhoto = idx > 0 ? photos[idx - 1] : null
  const nextPhoto = idx >= 0 && idx < photos.length - 1 ? photos[idx + 1] : null

  // Image source priority same as the card. CDN > Airtable thumb > raw Dropbox.
  // For the modal we prefer thumbFull (largest Airtable variant) when no CDN
  // URL exists, since the modal renders bigger than the card.
  const imgSrc = photo?.cdnUrl || photo?.thumbFull || photo?.thumbLarge || rawDropboxUrl(photo?.dropboxLink)

  // Keyboard nav: Esc closes, ←/→ flip photos.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft' && prevPhoto) {
        e.preventDefault()
        onNavigate(prevPhoto.id)
      } else if (e.key === 'ArrowRight' && nextPhoto) {
        e.preventDefault()
        onNavigate(nextPhoto.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNavigate, prevPhoto, nextPhoto])

  if (!photo) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          maxWidth: '100vw',
        }}
      >
        {/* Left: photo + overlay nav */}
        <div style={{ flex: '1 1 auto', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={photo.id}
            src={imgSrc}
            alt={photo.name}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />

          {/* Prev nav — overlay on left edge */}
          {prevPhoto && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate(prevPhoto.id) }}
              aria-label="Previous photo"
              style={navOverlayStyle('left')}
            >
              ‹
            </button>
          )}

          {/* Next nav — overlay on right edge */}
          {nextPhoto && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate(nextPhoto.id) }}
              aria-label="Next photo"
              style={navOverlayStyle('right')}
            >
              ›
            </button>
          )}

          {/* Close button — top-right of image area, also visible if right pane scrolls */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 20,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>

          {/* Position indicator */}
          <div style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 14px',
            background: 'rgba(0,0,0,0.6)',
            color: 'rgba(255,255,255,0.85)',
            borderRadius: '999px',
            fontSize: 12,
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            {idx + 1} / {photos.length}
          </div>
        </div>

        {/* Right: action panel */}
        <div style={{
          width: '340px',
          flexShrink: 0,
          background: '#0a0a0a',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          padding: '24px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          overflowY: 'auto',
        }}>
          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)', marginBottom: 6 }}>
              Photo
            </div>
            <div style={{ fontSize: '13px', color: 'var(--foreground)', wordBreak: 'break-all', lineHeight: 1.4 }}>
              {photo.name}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)', marginBottom: 6 }}>
              Uploaded
            </div>
            <div style={{ fontSize: '13px', color: 'var(--foreground)' }}>
              {formatDate(photo.createdTime)}
            </div>
          </div>

          {photo.usedAt && (
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)', marginBottom: 6 }}>
                Used For
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {photo.usedFor && (
                  <span style={{
                    padding: '3px 10px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: '#060606',
                    background: photo.usedFor === 'Mass Message' ? '#7aa9ff' : 'var(--palm-pink)',
                    borderRadius: '999px',
                    textTransform: 'uppercase',
                  }}>
                    {photo.usedFor === 'Mass Message' ? 'MM' : 'WP'}
                  </span>
                )}
                <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
                  {formatDate(photo.usedAt)}
                </span>
              </div>
            </div>
          )}

          {photo.pipelineStatus && (
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--foreground-muted)', marginBottom: 6 }}>
                Status
              </div>
              <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
                {photo.pipelineStatus}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Big primary action — Use / Restore. Auto-advances to next photo
              after success, so the chat manager can chain through the queue
              without leaving the modal. */}
          <button
            onClick={() => onToggle(photo)}
            disabled={pending}
            style={{
              padding: '14px 16px',
              background: view === 'available' ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)',
              color: view === 'available' ? '#060606' : 'white',
              border: view === 'available' ? 'none' : '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: pending ? 'wait' : 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            {pending ? 'Saving...' : view === 'available' ? 'Use this photo' : 'Restore to Available'}
          </button>

          <a
            href={photo.dropboxLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.04)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 500,
              textAlign: 'center',
              textDecoration: 'none',
            }}
          >
            Open original in Dropbox ↗
          </a>

          <div style={{ fontSize: '10px', color: 'var(--foreground-subtle, #555)', textAlign: 'center', marginTop: 4, lineHeight: 1.5 }}>
            ← / → to navigate · Esc to close
          </div>
        </div>
      </div>
    </div>
  )
}

function UseConfirmModal({ asset, onCancel, onConfirm }) {
  // Keyboard shortcuts: Esc cancels, W picks Wall Post, M picks Mass Message.
  // Letting power users fly through their queue without the mouse.
  useEffect(() => {
    function onKey(e) {
      // Skip if user is typing in an input
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        onConfirm('wall')
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        onConfirm('mm')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  const imgSrc = asset.cdnUrl || asset.thumbLarge || asset.thumbFull || rawDropboxUrl(asset.dropboxLink)

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0f0f0f',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 24,
          maxWidth: 460,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>
            What is this for?
          </div>
          <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 6, lineHeight: 1.5 }}>
            Pick where you&apos;re posting it. We&apos;ll mark the photo with that label, remove it from Available, and download the original to your computer.
          </div>
        </div>

        <div style={{
          display: 'flex',
          gap: 12,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          padding: 12,
          alignItems: 'center',
        }}>
          {imgSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={asset.name}
              style={{
                width: 60,
                height: 80,
                objectFit: 'cover',
                borderRadius: 6,
                flexShrink: 0,
                background: '#0a0a0a',
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--foreground)', wordBreak: 'break-all', lineHeight: 1.4 }}>
              {asset.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
              {formatDate(asset.createdTime)}
            </div>
          </div>
        </div>

        {/* Two primary CTAs — pink palm color for Wall Post, blue for MM,
            matching the singleSelect colors in Airtable. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            onClick={() => onConfirm('wall')}
            autoFocus
            style={{
              padding: '14px 16px',
              background: 'var(--palm-pink)',
              border: 'none',
              borderRadius: 10,
              color: '#060606',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span>Wall Post</span>
            <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>press W</span>
          </button>
          <button
            onClick={() => onConfirm('mm')}
            style={{
              padding: '14px 16px',
              background: '#7aa9ff',
              border: 'none',
              borderRadius: 10,
              color: '#060606',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span>Mass Message</span>
            <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>press M</span>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              color: 'var(--foreground-muted)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}

function navOverlayStyle(side) {
  return {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    [side]: 16,
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.18)',
    fontSize: 32,
    fontWeight: 300,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    backdropFilter: 'blur(6px)',
    transition: 'all 0.15s ease',
  }
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
