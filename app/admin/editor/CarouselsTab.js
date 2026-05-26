'use client'
import { useEffect, useMemo, useState } from 'react'

// Carousels tab — assemble carousel posts from two postable sources:
//   1. AI Generated photos (Photos table, Source Type='AI Generated') —
//      content WE generated through TJP Studio / the AI editor workflow.
//      Eventually AI carousel recreations will land here too.
//   2. Creator Upload photos (Assets table, Asset Type=Photo with a
//      Dropbox Shared Link) — photos the creator uploaded to their own
//      Dropbox folder (synced into Assets via the existing chat-wall /
//      thumbnail-pool pipeline).
//
// Explicitly NOT postable from this picker: scraped Instagram photos
// (those are other creators' content — need AI recreation in TJP Studio
// first) and Pinterest uploads.
//
// Submit payload mixes both: photo records become photoIds (server
// mirrors them into Assets); asset records become assetIds (server uses
// them directly).

// Retry on Airtable 429 rate-limit. The server route surfaces it as a 500
// with "Airtable 429" / "RATE_LIMIT" in the body. Retry up to twice with
// growing waits before surfacing the error.
async function fetchWithRetry(url, init, { maxRetries = 2 } = {}) {
  let lastErr = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.status >= 500 || res.status === 429) {
        const text = await res.clone().text()
        if (text.includes('429') || text.includes('RATE_LIMIT')) {
          if (attempt < maxRetries) {
            const wait = (attempt + 1) * 5000
            await new Promise(r => setTimeout(r, wait))
            continue
          }
        }
      }
      return res
    } catch (e) {
      lastErr = e
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, (attempt + 1) * 2000))
    }
  }
  if (lastErr) throw lastErr
  return fetch(url, init)
}

const SOURCE_FILTERS = [
  { key: 'all', label: 'All', match: null },
  { key: 'ai', label: 'AI Generated', match: 'AI Generated' },
  { key: 'creator', label: 'Creator Upload', match: 'Creator Upload' },
]

export default function CarouselsTab({ showToast }) {
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState(null)
  const [items, setItems] = useState([])  // unified list of postable photo items
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [tray, setTray] = useState([])
  const [caption, setCaption] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lightbox, setLightbox] = useState(null)  // {photo} when open

  useEffect(() => {
    fetchWithRetry('/api/admin/creators/pipeline')
      .then(r => r.json())
      .then(d => {
        const list = (d.creators || []).filter(c => c.id)
        setCreators(list)
        if (!creatorId && list.length) setCreatorId(list[0].id)
      })
      .catch(e => showToast?.(`Couldn't load creators: ${e.message}`, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!creatorId) return
    setLoadingPhotos(true)
    setTray([])

    // Two independent sources fetched in parallel.
    //   - Photos library: AI-generated images we control (Photos table).
    //   - Asset photo library: creator-uploaded photos from their Dropbox
    //     folder (Assets table). view=all so we see every photo regardless
    //     of whether the chat team has already used it for a wall post or
    //     mass message — carousels are a different surface.
    //
    // The Assets endpoint paginates. We fetch page 0 first to learn how
    // many pages exist, then fetch the rest in parallel. 500-per-page so
    // most creators come back in one or two round trips.
    const PAGE_SIZE = 500
    const fetchAssetPage = (pg) =>
      fetchWithRetry(`/api/photo-library/photos?creatorId=${encodeURIComponent(creatorId)}&view=all&pageSize=${PAGE_SIZE}&page=${pg}`)
        .then(r => r.json())
        .catch(() => ({ photos: [], totalPages: 1 }))

    Promise.all([
      fetchWithRetry('/api/admin/photos/library').then(r => r.json()).catch(() => ({ photos: [] })),
      fetchAssetPage(0).then(async first => {
        const totalPages = first.totalPages || 1
        if (totalPages <= 1) return first
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) => fetchAssetPage(i + 1))
        )
        return { photos: [first.photos, ...rest.map(r => r.photos || [])].flat() }
      }),
    ])
      .then(([photosResp, assetsResp]) => {
        // AI Generated photos linked to this creator. We deliberately
        // ignore other Source Types here — scraped IG / Pinterest are
        // not postable as-is per the carousel feature contract. Also
        // hide anything already submitted into a carousel — those come
        // back available only if the carousel is discarded. AI carousel
        // submissions must be admin-approved (Review Status=Approved) to
        // surface here; legacy AI gens with no Review Status pass through.
        const aiPhotos = (photosResp.photos || [])
          .filter(p =>
            p.sourceType === 'AI Generated' &&
            (p.creatorIds || []).includes(creatorId) &&
            !p.usedInCarousel &&
            (p.reviewStatus === 'Approved' || !p.reviewStatus)
          )
          .map(p => ({
            _source: 'photo', // submit as photoId (server mirrors to Asset)
            id: p.id,
            image: p.image,
            imageFallback: p.imageFallback,
            sourceType: 'AI Generated',
            caption: p.caption || '',
            handle: p.handle || '',
            createdTime: p.createdTime,
          }))

        // Creator Upload photos from the Assets-table photo library.
        // Skip ones already in a carousel post.
        const creatorPhotos = (assetsResp.photos || [])
          .filter(a => !a.usedInCarousel)
          .map(a => ({
          _source: 'asset', // submit as assetId (already an Asset record)
          id: a.id,
          image: a.cdnUrl || a.thumbLarge || a.thumbSmall || a.dropboxLink || '',
          imageFallback: a.thumbFull || a.dropboxLink || '',
          sourceType: 'Creator Upload',
          caption: '',
          handle: a.name || '',
          createdTime: a.createdTime,
        }))

        // Newest first across both sources.
        const combined = [...aiPhotos, ...creatorPhotos]
          .sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
        setItems(combined)
      })
      .catch(e => showToast?.(`Couldn't load photos: ${e.message}`, true))
      .finally(() => setLoadingPhotos(false))
  }, [creatorId, showToast])

  const visible = useMemo(() => {
    let view = items
    const f = SOURCE_FILTERS.find(s => s.key === sourceFilter)
    if (f?.match) view = view.filter(p => p.sourceType === f.match)
    if (searchQ) {
      const q = searchQ.toLowerCase()
      view = view.filter(p =>
        (p.handle || '').toLowerCase().includes(q) ||
        (p.caption || '').toLowerCase().includes(q)
      )
    }
    return view
  }, [items, sourceFilter, searchQ])

  const trayIds = useMemo(() => new Set(tray.map(p => p.id)), [tray])

  function toggleTray(p) {
    if (trayIds.has(p.id)) {
      // Already selected — clicking again removes it.
      setTray(tray.filter(item => item.id !== p.id))
      return
    }
    if (tray.length >= 10) { showToast?.('Max 10 slides per carousel', true); return }
    setTray([...tray, p])
  }

  function removeFromTray(id) {
    setTray(tray.filter(p => p.id !== id))
  }

  function moveTray(idx, dir) {
    const target = idx + dir
    if (target < 0 || target >= tray.length) return
    const next = [...tray]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setTray(next)
  }

  async function submit() {
    if (!creatorId) { showToast?.('Pick a creator', true); return }
    if (!tray.length) { showToast?.('Add at least one photo', true); return }
    setSubmitting(true)
    try {
      // Split tray by source — server mirrors photoIds to new Assets but
      // can use assetIds directly. Order preserved within each list, and
      // server concatenates [...mirroredAssetIds, ...assetIds] in that
      // order, so we keep tray order coherent by routing all items
      // through the right bucket but maintaining insertion order across.
      // For mixed trays this means AI-photo slides come before Asset
      // slides regardless of click order — flag if that matters.
      const photoIds = tray.filter(p => p._source === 'photo').map(p => p.id)
      const assetIds = tray.filter(p => p._source === 'asset').map(p => p.id)

      const res = await fetch('/api/admin/posts/carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorIds: [creatorId],
          ...(photoIds.length ? { photoIds } : {}),
          ...(assetIds.length ? { assetIds } : {}),
          caption: caption.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const count = data.posts?.length || 1
      showToast?.(`Carousel queued (${count} post${count === 1 ? '' : 's'})`)
      setTray([])
      setCaption('')
    } catch (err) {
      showToast?.(`Submit failed: ${err.message}`, true)
    } finally {
      setSubmitting(false)
    }
  }

  const creatorOptions = useMemo(() =>
    creators
      .map(c => ({ id: c.id, name: c.name || c.aka || c.id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [creators]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#999' }}>Creator</label>
        <select
          value={creatorId || ''}
          onChange={e => setCreatorId(e.target.value || null)}
          style={{
            padding: '6px 10px', fontSize: 13, background: 'rgba(255,255,255,0.04)',
            color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            minWidth: 200,
          }}
        >
          {!creatorOptions.length && <option value="">Loading…</option>}
          {creatorOptions.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search caption or handle…"
          style={{
            padding: '6px 10px', fontSize: 13, background: 'rgba(255,255,255,0.04)',
            color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            minWidth: 240, flex: '0 1 280px',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SOURCE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setSourceFilter(f.key)}
            style={{
              padding: '5px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
              background: sourceFilter === f.key ? 'rgba(232, 160, 160, 0.1)' : 'rgba(255,255,255,0.03)',
              color: sourceFilter === f.key ? 'var(--palm-pink)' : '#aaa',
              border: `1px solid ${sourceFilter === f.key ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 999, cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'flex-start' }}>
        <div>
          {loadingPhotos && <div style={{ color: '#888', fontSize: 13, padding: 12 }}>Loading photos…</div>}
          {!loadingPhotos && !visible.length && (
            <div style={{ color: '#888', fontSize: 13, padding: 12, lineHeight: 1.5 }}>
              {sourceFilter === 'creator'
                ? `No photos in this creator's Dropbox folder yet. Creator uploads sync through the chat-wall pipeline.`
                : sourceFilter === 'ai'
                ? `No AI-generated photos linked to this creator yet. Generate some in TJP Studio or the AI editor workflow.`
                : `No postable photos for this creator yet. Either generate them via TJP Studio (AI Generated) or wait for creator uploads (Creator Upload). Scraped Instagram and Pinterest photos are intentionally not postable from this picker — they need AI recreation first.`}
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8,
          }}>
            {visible.map(p => {
              const selected = trayIds.has(p.id)
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleTray(p)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTray(p) } }}
                  title={selected ? 'Click to remove from carousel' : (p.caption || p.handle || 'Click to add')}
                  style={{
                    position: 'relative', aspectRatio: '1 / 1', overflow: 'hidden',
                    background: '#111', border: `2px solid ${selected ? 'var(--palm-pink)' : 'transparent'}`,
                    borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  {p.image && (
                    <img
                      src={p.image}
                      onError={e => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )}
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(0,0,0,0.65)', color: '#ddd',
                  }}>
                    {p.sourceType}
                  </div>
                  {/* Expand-to-lightbox button (top-right). Stops propagation so
                      clicking it doesn't also toggle the tray selection. */}
                  <button
                    onClick={e => { e.stopPropagation(); setLightbox({ photo: p }) }}
                    title="View full size"
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 24, height: 24, padding: 0, borderRadius: 4,
                      background: 'rgba(0,0,0,0.65)', border: 'none', color: '#ddd',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 3 21 3 21 9"/>
                      <polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/>
                      <line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                  </button>
                  {selected && (
                    <div style={{
                      position: 'absolute', inset: 0, background: 'rgba(232,160,160,0.25)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 24, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                      pointerEvents: 'none',
                    }}>✓</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{
          position: 'sticky', top: 12, alignSelf: 'flex-start',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Carousel</strong>
            <span style={{ fontSize: 12, color: '#888' }}>{tray.length}/10</span>
          </div>

          {!tray.length && (
            <div style={{ color: '#777', fontSize: 12, padding: '12px 4px' }}>
              Click photos on the left to add them. Max 10 slides.
            </div>
          )}

          {tray.map((p, idx) => (
            <div key={p.id} style={{
              display: 'flex', gap: 8, alignItems: 'center',
              padding: 6, background: 'rgba(255,255,255,0.02)', borderRadius: 4,
            }}>
              <div style={{ fontSize: 11, color: '#888', width: 16, textAlign: 'center' }}>{idx + 1}</div>
              {p.image && (
                <img
                  src={p.image}
                  onError={e => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.caption?.slice(0, 30) || p.handle || p.sourceType}
              </div>
              <button
                onClick={() => moveTray(idx, -1)}
                disabled={idx === 0}
                style={{ background: 'none', border: 'none', color: idx === 0 ? '#444' : '#aaa', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 14, padding: '0 4px' }}
                title="Move up"
              >↑</button>
              <button
                onClick={() => moveTray(idx, 1)}
                disabled={idx === tray.length - 1}
                style={{ background: 'none', border: 'none', color: idx === tray.length - 1 ? '#444' : '#aaa', cursor: idx === tray.length - 1 ? 'default' : 'pointer', fontSize: 14, padding: '0 4px' }}
                title="Move down"
              >↓</button>
              <button
                onClick={() => removeFromTray(p.id)}
                style={{ background: 'none', border: 'none', color: '#E87878', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                title="Remove"
              >×</button>
            </div>
          ))}

          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            rows={3}
            style={{
              padding: '8px 10px', fontSize: 12, background: 'rgba(255,255,255,0.04)',
              color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
              resize: 'vertical', minHeight: 60, fontFamily: 'inherit',
            }}
          />

          <button
            onClick={submit}
            disabled={submitting || !tray.length || !creatorId}
            style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              background: submitting || !tray.length ? 'rgba(255,255,255,0.04)' : 'var(--palm-pink)',
              color: submitting || !tray.length ? '#666' : '#1a1a1a',
              border: 'none', borderRadius: 6,
              cursor: submitting || !tray.length ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit to Queue'}
          </button>
        </div>
      </div>

      {/* Lightbox — full-size preview with add/remove action. Click backdrop
          or Escape to close. */}
      {lightbox && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}
          onKeyDown={e => { if (e.key === 'Escape') setLightbox(null) }}
          tabIndex={-1}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div style={{
            maxWidth: '90vw', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', gap: 12,
            alignItems: 'center',
          }}>
            <img
              src={lightbox.photo.image}
              onError={e => { if (lightbox.photo.imageFallback) e.currentTarget.src = lightbox.photo.imageFallback }}
              alt=""
              style={{
                maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain',
                background: '#000', borderRadius: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              {(() => {
                const inTray = trayIds.has(lightbox.photo.id)
                return (
                  <button
                    onClick={() => { toggleTray(lightbox.photo); setLightbox(null) }}
                    style={{
                      padding: '10px 18px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                      background: inTray ? 'rgba(255,255,255,0.06)' : 'var(--palm-pink)',
                      color: inTray ? 'var(--foreground)' : '#1a1a1a',
                      border: 'none', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    {inTray ? 'Remove from carousel' : 'Add to carousel'}
                  </button>
                )
              })()}
              <button
                onClick={() => setLightbox(null)}
                style={{
                  padding: '10px 18px', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: 'transparent', color: '#aaa',
                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
