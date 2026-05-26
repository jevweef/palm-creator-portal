'use client'
import { useEffect, useMemo, useState } from 'react'

// Carousel Reference Library — scraped IG carousel posts the editor uses
// as source material for AI carousel recreations. Read-only browse with
// the same Grid / Expanded view toggle as the admin's /admin/recreate-
// source Photos → Library tab.
//
// Filters APPLIED (not user-toggleable — the user wants ONLY scraped IG
// carousels here, nothing else):
//   - Source Type = 'Instagram'
//   - Part of a carousel (Carousel Total > 1)
//   - Excludes: AI Generated, Pinterest, Creator Upload, single-photo posts

export default function CarouselReferenceLibrary() {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('grid')  // grid | expanded
  const [search, setSearch] = useState('')
  const [openPostUrl, setOpenPostUrl] = useState(null)
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    fetch('/api/admin/photos/library')
      .then(r => r.json())
      .then(d => {
        const all = d.photos || []
        // Hard filter to scraped IG carousels. Anything else (AI gens of
        // unknown origin, Pinterest dumps, creator-uploaded photos) is
        // noise for this view.
        const scrapedCarousels = all.filter(p =>
          p.sourceType === 'Instagram' &&
          (p.carouselTotal || 1) > 1
        )
        setPhotos(scrapedCarousels)
      })
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false))
  }, [])

  // Group photos by Source Post URL — one entry per IG carousel post.
  const posts = useMemo(() => {
    const byUrl = new Map()
    for (const p of photos) {
      const key = p.postUrl || p.id
      if (!byUrl.has(key)) {
        byUrl.set(key, {
          postUrl: p.postUrl,
          handle: p.handle,
          postedAt: p.postedAt,
          slides: [],
        })
      }
      byUrl.get(key).slides.push(p)
    }
    for (const post of byUrl.values()) {
      post.slides.sort((a, b) => (a.carouselIndex || 0) - (b.carouselIndex || 0))
    }
    // Newest first by posted date.
    return [...byUrl.values()].sort((a, b) =>
      (b.postedAt || '').localeCompare(a.postedAt || '')
    )
  }, [photos])

  const visible = useMemo(() => {
    if (!search.trim()) return posts
    const q = search.toLowerCase()
    return posts.filter(p =>
      (p.handle || '').toLowerCase().includes(q) ||
      p.slides.some(s => (s.caption || '').toLowerCase().includes(q))
    )
  }, [posts, search])

  // For Expanded view we list every slide as its own card.
  const visibleSlides = useMemo(() => {
    if (viewMode !== 'expanded') return []
    return visible.flatMap(p => p.slides)
  }, [visible, viewMode])

  return (
    <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>📚 Reference Library</h2>
        <p style={{ fontSize: 12, color: 'var(--foreground-muted)', margin: 0 }}>
          Scraped IG carousel posts to use as source for AI carousel generations. Click a post to see every slide.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
          {['grid', 'expanded'].map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'capitalize',
                background: viewMode === m ? 'rgba(232,160,160,0.12)' : 'transparent',
                color: viewMode === m ? 'var(--palm-pink)' : '#aaa',
                border: 'none', cursor: 'pointer', minWidth: 80,
              }}
            >{m}</button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by handle or caption…"
          style={{
            flex: '1 1 240px', padding: '6px 10px', fontSize: 13,
            background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            minWidth: 200, maxWidth: 360,
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginLeft: 'auto' }}>
          {posts.length} carousel post{posts.length === 1 ? '' : 's'} · {photos.length} slide{photos.length === 1 ? '' : 's'}
        </div>
      </div>

      {loading && <div style={{ color: '#888', fontSize: 13, padding: 14 }}>Loading reference library…</div>}
      {!loading && !visible.length && (
        <div style={{ color: '#888', fontSize: 13, padding: 14 }}>
          No scraped IG carousels match. Try a different search term, or have an admin scrape more accounts under <em>/admin/recreate-source → Photos → Accounts</em>.
        </div>
      )}

      {/* GRID view — one card per carousel post, cover-only. Click to expand. */}
      {viewMode === 'grid' && visible.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 10,
        }}>
          {visible.map(post => {
            const cover = post.slides[0]
            const expanded = openPostUrl === post.postUrl
            return (
              <div key={post.postUrl || cover.id}>
                <button
                  onClick={() => setOpenPostUrl(expanded ? null : post.postUrl)}
                  title={cover.caption || post.handle}
                  style={{
                    width: '100%', aspectRatio: '1/1', overflow: 'hidden',
                    background: '#111', border: `2px solid ${expanded ? 'var(--palm-pink)' : 'transparent'}`,
                    borderRadius: 6, cursor: 'pointer', padding: 0, position: 'relative',
                  }}
                >
                  {cover.image && (
                    <img
                      src={cover.image}
                      onError={e => { if (cover.imageFallback && e.currentTarget.src !== cover.imageFallback) e.currentTarget.src = cover.imageFallback }}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )}
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                    background: 'rgba(0,0,0,0.7)', color: '#fff',
                  }}>📸 {post.slides.length}</div>
                  {post.handle && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '4px 6px', fontSize: 10, color: '#ddd',
                      background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>@{post.handle}</div>
                  )}
                </button>

                {/* Expanded slide strip below the cover when this post is open. */}
                {expanded && (
                  <div style={{
                    marginTop: 6, padding: 8,
                    background: 'rgba(232,160,160,0.04)', borderRadius: 6,
                    border: '1px solid rgba(232,160,160,0.18)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: 4,
                  }}>
                    {post.slides.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setLightbox(s)}
                        style={{
                          aspectRatio: '1/1', background: '#000',
                          border: 'none', borderRadius: 4, overflow: 'hidden',
                          padding: 0, cursor: 'pointer', position: 'relative',
                        }}
                        title={`Slide ${s.carouselIndex || '?'} — click to view full size`}
                      >
                        {s.image && (
                          <img
                            src={s.image}
                            onError={e => { if (s.imageFallback) e.currentTarget.src = s.imageFallback }}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        <div style={{
                          position: 'absolute', top: 2, left: 2,
                          padding: '0 4px', fontSize: 9, fontWeight: 700,
                          background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 2,
                        }}>{s.carouselIndex || '?'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* EXPANDED view — every slide is its own card, no grouping. */}
      {viewMode === 'expanded' && visibleSlides.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}>
          {visibleSlides.map(s => (
            <button
              key={s.id}
              onClick={() => setLightbox(s)}
              title={`@${s.handle || '?'} · slide ${s.carouselIndex}/${s.carouselTotal} — click to view`}
              style={{
                aspectRatio: '1/1', background: '#111',
                border: 'none', borderRadius: 6, overflow: 'hidden',
                padding: 0, cursor: 'pointer', position: 'relative',
              }}
            >
              {s.image && (
                <img
                  src={s.image}
                  onError={e => { if (s.imageFallback) e.currentTarget.src = s.imageFallback }}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              <div style={{
                position: 'absolute', top: 4, left: 4,
                padding: '1px 5px', fontSize: 9, fontWeight: 700,
                background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 3,
              }}>{s.carouselIndex}/{s.carouselTotal}</div>
              {s.handle && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '3px 6px', fontSize: 10, color: '#ddd',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>@{s.handle}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Full-size lightbox — same pattern as the upload picker. */}
      {lightbox && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', maxWidth: '90vw' }}>
            <img
              src={lightbox.image}
              onError={e => { if (lightbox.imageFallback) e.currentTarget.src = lightbox.imageFallback }}
              alt=""
              style={{ maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain', background: '#000', borderRadius: 8 }}
            />
            <div style={{ fontSize: 12, color: '#bbb', textAlign: 'center' }}>
              @{lightbox.handle || '?'} · slide {lightbox.carouselIndex}/{lightbox.carouselTotal}
              {lightbox.postUrl && (
                <> · <a href={lightbox.postUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--palm-pink)' }}>view on IG</a></>
              )}
            </div>
            <button
              onClick={() => setLightbox(null)}
              style={{
                padding: '8px 18px', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                background: 'transparent', color: '#aaa',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer',
              }}
            >Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
