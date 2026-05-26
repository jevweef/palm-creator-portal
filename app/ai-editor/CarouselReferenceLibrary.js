'use client'
import { useEffect, useMemo, useState } from 'react'

// Trigger a file download by fetching the URL as a blob, wrapping in an
// object URL, and clicking a synthetic anchor. Beats <a download> for
// cross-origin URLs (Dropbox/CF) which the browser would otherwise open
// in a new tab.
async function downloadFromUrl(url, suggestedName) {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const blob = await r.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = suggestedName || 'image.jpg'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  } catch (err) {
    console.error('[ref-library] download failed:', err)
  }
}

// Download the whole carousel as a zip via the server route. Browser
// handles the streamed response directly (no in-memory zip build needed
// on the client).
function downloadCarouselZip(postUrl) {
  const a = document.createElement('a')
  a.href = `/api/ai-editor/carousel-references/zip?postUrl=${encodeURIComponent(postUrl)}`
  // Same-origin response carries the Content-Disposition filename, so we
  // skip a.download (would otherwise override the server's name).
  document.body.appendChild(a)
  a.click()
  a.remove()
}

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

export default function CarouselReferenceLibrary({ creatorId, creatorName, onProjectStarted }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('grid')  // grid | expanded
  const [search, setSearch] = useState('')
  const [openPostUrl, setOpenPostUrl] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  // Filter posts to a single IG handle (or 'all'). Lets the editor zero in
  // on one source account at a time instead of scrolling 187 random posts.
  const [selectedHandle, setSelectedHandle] = useState('all')
  // Pagination — grid view shows PAGE_SIZE posts per page (~4 rows at
  // typical desktop column count); expanded view paginates by slide.
  const PAGE_SIZE = 24
  const [page, setPage] = useState(0)
  // Projects for the currently-selected creator — drives the ✓ Done /
  // 🔧 In Progress badges on each post and prevents duplicate project
  // starts. Re-fetched whenever the parent's creatorId changes.
  const [projects, setProjects] = useState([])  // [{ id, sourcePostUrl, status, ... }]
  const [startingProject, setStartingProject] = useState(null)  // postUrl mid-flight
  const [startError, setStartError] = useState('')

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

  // Reload projects whenever the selected creator changes. Empty creator
  // = no badges, no start-project button (UI gates on creatorId).
  useEffect(() => {
    if (!creatorId) { setProjects([]); return }
    fetch(`/api/admin/carousel-projects?creatorId=${encodeURIComponent(creatorId)}`)
      .then(r => r.json())
      .then(d => setProjects(d.projects || []))
      .catch(() => setProjects([]))
  }, [creatorId])

  // O(1) lookup of project status per source post URL for the current
  // creator. Same source can have multiple projects over time (after a
  // Rejected one, a fresh project can be started) — pick the most
  // recent and use ITS status. Approved/Archived = "Done" (✓); Planning/
  // Submitted = "In Progress" (🔧); Rejected = no badge (can retry).
  const projectByPostUrl = useMemo(() => {
    const m = new Map()
    for (const p of projects) {
      if (!p.sourcePostUrl) continue
      const existing = m.get(p.sourcePostUrl)
      if (!existing || (p.createdAt || '') > (existing.createdAt || '')) {
        m.set(p.sourcePostUrl, p)
      }
    }
    return m
  }, [projects])

  // Kick off a new project from this carousel for the current creator.
  // Optimistic: insert a placeholder into projects[] so the badge flips
  // immediately, then reconcile on response. Errors revert.
  async function startProject(postUrl, sourceHandle) {
    console.log('[ref-library] Start project clicked', { postUrl, sourceHandle, creatorId })
    if (!creatorId) { setStartError('Pick a creator in the upload section first'); return }
    setStartingProject(postUrl)
    setStartError('')
    const placeholder = {
      id: `temp-${Date.now()}`,
      sourcePostUrl: postUrl,
      sourceHandle,
      status: 'Planning',
      createdAt: new Date().toISOString(),
    }
    setProjects(prev => [placeholder, ...prev])
    try {
      const res = await fetch('/api/admin/carousel-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePostUrl: postUrl, creatorId }),
      })
      // Read as text first so we can surface ANY response (HTML 401, plain
      // 500, JSON error) without choking on res.json() against non-JSON.
      const text = await res.text()
      let data = {}
      try { data = JSON.parse(text) } catch { data = { error: text.slice(0, 200) } }
      console.log('[ref-library] Project create response', { status: res.status, data })
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setProjects(prev => [
        { id: data.project.id, sourcePostUrl: postUrl, sourceHandle, status: 'Planning', createdAt: new Date().toISOString() },
        ...prev.filter(p => p.id !== placeholder.id),
      ])
      // Hand the new project ID to the parent so the Upload section can
      // auto-link it + scroll the editor down to "upload AI versions
      // here" mode. Without this, the editor sees the badge change and
      // has no idea what to do next.
      if (onProjectStarted) onProjectStarted(data.project.id)
    } catch (err) {
      console.error('[ref-library] Start project failed:', err)
      setStartError(`Couldn't start project: ${err.message}`)
      setProjects(prev => prev.filter(p => p.id !== placeholder.id))
    } finally {
      setStartingProject(null)
    }
  }

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

  // Unique handles with post counts — drives the filter pill row.
  // Sorted by post count desc so the most-scraped accounts surface first.
  const handles = useMemo(() => {
    const counts = new Map()
    for (const p of posts) {
      const h = p.handle || ''
      if (!h) continue
      counts.set(h, (counts.get(h) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([handle, count]) => ({ handle, count }))
      .sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle))
  }, [posts])

  const visible = useMemo(() => {
    let list = posts
    if (selectedHandle !== 'all') {
      list = list.filter(p => p.handle === selectedHandle)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        (p.handle || '').toLowerCase().includes(q) ||
        p.slides.some(s => (s.caption || '').toLowerCase().includes(q))
      )
    }
    return list
  }, [posts, search, selectedHandle])

  // Reset to page 0 whenever filter or search changes so we don't land on
  // a now-empty page after narrowing the result set.
  useEffect(() => { setPage(0) }, [selectedHandle, search, viewMode])

  // For Expanded view we list every slide as its own card.
  const visibleSlides = useMemo(() => {
    if (viewMode !== 'expanded') return []
    return visible.flatMap(p => p.slides)
  }, [visible, viewMode])

  // Page slices — grid paginates posts, expanded paginates slides.
  const pagedPosts = useMemo(() => visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [visible, page])
  const pagedSlides = useMemo(() => visibleSlides.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [visibleSlides, page])
  const totalPages = viewMode === 'grid'
    ? Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
    : Math.max(1, Math.ceil(visibleSlides.length / PAGE_SIZE))

  return (
    <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Hover-to-reveal style for download/action overlays on each tile.
          Inline styles can't express :hover, so we scope a small block to
          our action classnames. */}
      <style>{`
        .ref-cover:hover .ref-cover-actions { opacity: 1 !important; }
        .ref-slide:hover .ref-slide-actions { opacity: 1 !important; }
        .ref-lightbox-img-wrap:hover .ref-lightbox-actions { opacity: 1 !important; }
      `}</style>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>📚 Reference Library</h2>
        <p style={{ fontSize: 12, color: 'var(--foreground-muted)', margin: 0 }}>
          Scraped IG carousel posts to use as source for AI carousel generations. Click a post to see every slide.
          {creatorName ? <> Showing badges for <strong style={{ color: 'var(--palm-pink)' }}>{creatorName}</strong>.</> : <> Pick a creator below to start projects.</>}
        </p>
        {startError && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 6,
            background: 'rgba(232, 120, 120, 0.08)',
            border: '1px solid rgba(232, 120, 120, 0.3)',
            color: '#E87878', fontSize: 13, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>⚠</span>
            <span style={{ flex: 1 }}>{startError}</span>
            <button onClick={() => setStartError('')} style={{ background: 'none', border: 'none', color: '#E87878', fontSize: 16, cursor: 'pointer' }}>×</button>
          </div>
        )}
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

      {/* Handle filter — horizontally scrollable pill row. Lets the editor
          drill into one IG account at a time instead of staring at the full
          firehose. "All" pill resets to the unfiltered view. */}
      {handles.length > 1 && (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', flexWrap: 'nowrap',
          paddingBottom: 4, WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}>
          <button
            onClick={() => setSelectedHandle('all')}
            style={{
              flexShrink: 0, padding: '5px 12px', fontSize: 11, fontWeight: 600,
              background: selectedHandle === 'all' ? 'rgba(232,160,160,0.18)' : 'rgba(255,255,255,0.04)',
              color: selectedHandle === 'all' ? 'var(--palm-pink)' : 'var(--foreground-muted)',
              border: `1px solid ${selectedHandle === 'all' ? 'rgba(232,160,160,0.5)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >All <span style={{ opacity: 0.6, marginLeft: 4 }}>{posts.length}</span></button>
          {handles.map(({ handle, count }) => (
            <button
              key={handle}
              onClick={() => setSelectedHandle(handle)}
              style={{
                flexShrink: 0, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                background: selectedHandle === handle ? 'rgba(232,160,160,0.18)' : 'rgba(255,255,255,0.04)',
                color: selectedHandle === handle ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                border: `1px solid ${selectedHandle === handle ? 'rgba(232,160,160,0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >@{handle} <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span></button>
          ))}
        </div>
      )}

      {loading && <div style={{ color: '#888', fontSize: 13, padding: 14 }}>Loading reference library…</div>}
      {!loading && !visible.length && (
        <div style={{ color: '#888', fontSize: 13, padding: 14 }}>
          No scraped IG carousels match. Try a different search term, or have an admin scrape more accounts under <em>/admin/recreate-source → Photos → Accounts</em>.
        </div>
      )}

      {/* GRID view — one card per carousel post, cover-only. Click to expand.
          Paginated to PAGE_SIZE posts per page so the editor isn't staring
          at hundreds of cards at once. */}
      {viewMode === 'grid' && visible.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 10,
        }}>
          {pagedPosts.map(post => {
            const cover = post.slides[0]
            const expanded = openPostUrl === post.postUrl
            const project = post.postUrl ? projectByPostUrl.get(post.postUrl) : null
            // Map project status to a visible badge. Rejected projects
            // get NO badge — a fresh project can be started.
            const projectBadge = project && (
              project.status === 'Approved' || project.status === 'Archived'
                ? { label: '✓ Done', bg: 'rgba(125,211,164,0.18)', fg: '#7DD3A4' }
                : project.status === 'Planning' || project.status === 'Submitted'
                ? { label: '🔧 In progress', bg: 'rgba(232,184,120,0.18)', fg: '#E8B878' }
                : null
            )
            const starting = startingProject === post.postUrl
            return (
              <div key={post.postUrl || cover.id}>
                <div
                  className="ref-cover"
                  onClick={() => setOpenPostUrl(expanded ? null : post.postUrl)}
                  title={cover.caption || post.handle}
                  style={{
                    width: '100%', aspectRatio: '1/1', overflow: 'hidden',
                    background: '#111', border: `2px solid ${expanded ? 'var(--palm-pink)' : projectBadge ? projectBadge.fg : 'transparent'}`,
                    borderRadius: 6, cursor: 'pointer', position: 'relative',
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
                  {/* Project status badge — always visible when a project
                      exists for this creator. Approved/Archived = green
                      "Done"; Planning/Submitted = amber "In progress".
                      Rejected projects show NO badge so a fresh project
                      can be started. */}
                  {projectBadge && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      padding: '2px 7px', fontSize: 10, fontWeight: 700, borderRadius: 3,
                      background: projectBadge.bg, color: projectBadge.fg,
                      border: `1px solid ${projectBadge.fg}`,
                    }}>{projectBadge.label}</div>
                  )}
                  {/* Hover overlay — Start Project (only if no active project)
                      + Download ZIP. Reveals on hover via CSS opacity so it
                      doesn't clutter the grid until the editor wants to act. */}
                  <div className="ref-cover-actions" style={{
                    position: 'absolute', bottom: 26, right: 4,
                    opacity: 0, transition: 'opacity 150ms ease',
                    display: 'flex', gap: 4, pointerEvents: 'none', flexDirection: 'column', alignItems: 'flex-end',
                  }}>
                    {!projectBadge && creatorId && (
                      <button
                        onClick={e => { e.stopPropagation(); startProject(post.postUrl, post.handle) }}
                        disabled={starting}
                        title={`Start a project for ${creatorName || 'this creator'}`}
                        style={{
                          padding: '4px 9px', fontSize: 10, fontWeight: 700,
                          background: starting ? 'rgba(168,132,232,0.4)' : 'rgba(168,132,232,0.85)', color: '#fff',
                          border: '1px solid rgba(168,132,232,0.6)', borderRadius: 3,
                          cursor: starting ? 'default' : 'pointer', pointerEvents: 'auto',
                        }}
                      >{starting ? '…' : '+ Start project'}</button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); if (post.postUrl) downloadCarouselZip(post.postUrl) }}
                      title="Download all slides as ZIP"
                      style={{
                        padding: '3px 8px', fontSize: 10, fontWeight: 700,
                        background: 'rgba(0,0,0,0.85)', color: '#fff',
                        border: '1px solid rgba(255,255,255,0.25)', borderRadius: 3,
                        cursor: 'pointer', pointerEvents: 'auto',
                      }}
                    >⬇ ZIP</button>
                  </div>
                </div>

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
                      <div
                        key={s.id}
                        className="ref-slide"
                        onClick={() => setLightbox(s)}
                        style={{
                          aspectRatio: '1/1', background: '#000',
                          borderRadius: 4, overflow: 'hidden',
                          cursor: 'pointer', position: 'relative',
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
                        <div className="ref-slide-actions" style={{
                          position: 'absolute', top: 2, right: 2,
                          opacity: 0, transition: 'opacity 150ms ease',
                          pointerEvents: 'none',
                        }}>
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              const fn = `${post.handle || 'slide'}_${String(s.carouselIndex || '0').padStart(2, '0')}.jpg`
                              downloadFromUrl(s.image, fn)
                            }}
                            title="Download this slide"
                            style={{
                              padding: '2px 5px', fontSize: 9, fontWeight: 700,
                              background: 'rgba(0,0,0,0.85)', color: '#fff',
                              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 2,
                              cursor: 'pointer', pointerEvents: 'auto',
                            }}
                          >⬇</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* EXPANDED view — every slide is its own card, no grouping. Paginated
          identically to grid view so the page doesn't bloat to hundreds of
          slide thumbnails. */}
      {viewMode === 'expanded' && visibleSlides.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}>
          {pagedSlides.map(s => (
            <div
              key={s.id}
              className="ref-slide"
              onClick={() => setLightbox(s)}
              title={`@${s.handle || '?'} · slide ${s.carouselIndex}/${s.carouselTotal} — click to view`}
              style={{
                aspectRatio: '1/1', background: '#111',
                borderRadius: 6, overflow: 'hidden',
                cursor: 'pointer', position: 'relative',
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
              {/* Hover actions: download this slide + the whole carousel zip. */}
              <div className="ref-slide-actions" style={{
                position: 'absolute', top: 4, right: 4,
                display: 'flex', gap: 3, opacity: 0,
                transition: 'opacity 150ms ease', pointerEvents: 'none',
              }}>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const fn = `${s.handle || 'slide'}_${String(s.carouselIndex || '0').padStart(2, '0')}.jpg`
                    downloadFromUrl(s.image, fn)
                  }}
                  title="Download this slide"
                  style={{
                    padding: '2px 6px', fontSize: 10, fontWeight: 700,
                    background: 'rgba(0,0,0,0.85)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.25)', borderRadius: 3,
                    cursor: 'pointer', pointerEvents: 'auto',
                  }}
                >⬇</button>
                {s.postUrl && (
                  <button
                    onClick={e => { e.stopPropagation(); downloadCarouselZip(s.postUrl) }}
                    title="Download whole carousel as ZIP"
                    style={{
                      padding: '2px 6px', fontSize: 10, fontWeight: 700,
                      background: 'rgba(0,0,0,0.85)', color: '#fff',
                      border: '1px solid rgba(255,255,255,0.25)', borderRadius: 3,
                      cursor: 'pointer', pointerEvents: 'auto',
                    }}
                  >ZIP</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Paginator — visible whenever there's more than one page in the
          current view (grid or expanded). Prev / page indicator / Next. */}
      {!loading && visible.length > 0 && totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, marginTop: 4, padding: '4px 0',
        }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              background: page === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(232,160,160,0.12)',
              color: page === 0 ? '#555' : 'var(--palm-pink)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
              cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}
          >← Prev</button>
          <span style={{ fontSize: 12, color: 'var(--foreground-muted)', minWidth: 80, textAlign: 'center' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              background: page >= totalPages - 1 ? 'rgba(255,255,255,0.03)' : 'rgba(232,160,160,0.12)',
              color: page >= totalPages - 1 ? '#555' : 'var(--palm-pink)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
              cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
            }}
          >Next →</button>
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
            <div className="ref-lightbox-img-wrap" style={{ position: 'relative' }}>
              <img
                src={lightbox.image}
                onError={e => { if (lightbox.imageFallback) e.currentTarget.src = lightbox.imageFallback }}
                alt=""
                style={{ maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain', background: '#000', borderRadius: 8, display: 'block' }}
              />
              {/* Hover actions on the lightbox: download this slide, download
                  the whole carousel as a zip. Float top-right of the image. */}
              <div className="ref-lightbox-actions" style={{
                position: 'absolute', top: 10, right: 10,
                display: 'flex', gap: 6, opacity: 0,
                transition: 'opacity 150ms ease',
              }}>
                <button
                  onClick={() => {
                    const fn = `${lightbox.handle || 'slide'}_${String(lightbox.carouselIndex || '0').padStart(2, '0')}.jpg`
                    downloadFromUrl(lightbox.image, fn)
                  }}
                  title="Download this slide"
                  style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 700,
                    background: 'rgba(0,0,0,0.85)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.25)', borderRadius: 5,
                    cursor: 'pointer',
                  }}
                >⬇ Slide</button>
                {lightbox.postUrl && (
                  <button
                    onClick={() => downloadCarouselZip(lightbox.postUrl)}
                    title="Download whole carousel as ZIP"
                    style={{
                      padding: '6px 12px', fontSize: 12, fontWeight: 700,
                      background: 'rgba(0,0,0,0.85)', color: '#fff',
                      border: '1px solid rgba(255,255,255,0.25)', borderRadius: 5,
                      cursor: 'pointer',
                    }}
                  >⬇ Carousel ZIP</button>
                )}
              </div>
            </div>
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
