'use client'
import { useCallback, useEffect, useState } from 'react'
import EmptyState from '@/app/admin/social/_components/EmptyState'

// AI Carousel Submissions — pending batches uploaded via /ai-editor.
// Lives alongside the existing reel For Review queue. Approve flips each
// photo in the batch to Review Status=Approved (surfaces in Carousels
// picker under AI Generated); Reject flips to Rejected (Photo stays in
// Airtable for audit but the picker filter hides it).
export default function CarouselSubmissionsReview({ showToast, sourceFilter = 'ai', embedded = false }) {
  const sourceLabel = sourceFilter === 'real' ? 'Real' : 'AI'
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [lightbox, setLightbox] = useState(null)  // { photo }
  // Source-carousel modal — opens on demand so the review queue stays
  // visually tight (AI slides only by default). Populated from the
  // submission's linked Carousel Project.
  const [sourceModal, setSourceModal] = useState(null)  // { submission }
  // Per-slide rejection panel (SMM Batch 5). When set, renders an inline
  // panel under the carousel card with reason textarea + two buttons:
  // "Remove only this slide" / "Bounce whole carousel."
  const [rejectingSlide, setRejectingSlide] = useState(null) // { batchId, photo, reason }

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/photos/carousel-submissions?source=${sourceFilter}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setSubmissions(data.submissions || [])
    } catch (err) {
      showToast?.(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [showToast, sourceFilter])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])

  const decide = async (batchId, action) => {
    setUpdating(batchId)
    try {
      const res = await fetch('/api/admin/photos/carousel-submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      // Optimistic remove from list.
      setSubmissions(prev => prev.filter(s => s.batchId !== batchId))
      showToast?.(`${action === 'approve' ? 'Approved' : 'Rejected'} · ${data.updated} slide${data.updated === 1 ? '' : 's'}`)
    } catch (err) {
      showToast?.(err.message, true)
    } finally {
      setUpdating(null)
    }
  }

  // Per-slide reject — SMM Batch 5. Two modes: remove (just this slide) or
  // bounce (whole carousel back for revision). Server handles either case.
  const rejectSlide = async (batchId, photoId, mode, reason) => {
    setUpdating(batchId)
    try {
      const res = await fetch('/api/admin/photos/carousel-submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, action: 'reject-slide', photoId, mode, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      if (mode === 'bounce') {
        setSubmissions(prev => prev.filter(s => s.batchId !== batchId))
        showToast?.(`Bounced · ${data.updated} slide${data.updated === 1 ? '' : 's'} rejected`)
      } else {
        // Remove just the slide locally from the matching submission.
        setSubmissions(prev => prev.map(s =>
          s.batchId !== batchId ? s : { ...s, photos: s.photos.filter(p => p.id !== photoId) }
        ))
        showToast?.('Slide removed from carousel')
      }
      setRejectingSlide(null)
    } catch (err) {
      showToast?.(err.message, true)
    } finally {
      setUpdating(null)
    }
  }

  if (loading) return null
  // Standalone: hide when empty. Embedded in the Content review split: show a
  // clear empty state so the quadrant doesn't look broken.
  if (!submissions.length) {
    if (!embedded) return null
    const msg = sourceFilter === 'real'
      ? "Real carousels are assembled under Carousels and don't route through this review queue yet — only AI carousels are reviewed here for now."
      : 'When AI carousel submissions are pending, they\'ll appear here.'
    return <EmptyState title={`No ${sourceLabel.toLowerCase()} carousels to review`} message={msg} />
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{
        fontSize: 13, fontWeight: 600, color: 'var(--foreground-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {sourceLabel} Carousel Submissions
        <span style={{
          padding: '2px 8px', fontSize: 10, fontWeight: 700, borderRadius: 10,
          background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)',
        }}>{submissions.length}</span>
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {submissions.map(sub => (
          <div key={sub.batchId} style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10, padding: 14,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>
                  {sub.title || `Carousel for ${sub.creatorName}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>
                  @{sub.creatorName} · {sub.photos.length} slide{sub.photos.length === 1 ? '' : 's'}
                  {sub.uploadedBy ? ` · by ${sub.uploadedBy.slice(0, 20)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {sub.project && (
                  <button
                    onClick={() => setSourceModal({ submission: sub })}
                    title={`View source carousel: @${sub.project.sourceHandle || '?'}`}
                    style={{
                      padding: '8px 12px', fontSize: 12, fontWeight: 600,
                      background: 'rgba(168,132,232,0.10)', color: '#c8b0e8',
                      border: '1px solid rgba(168,132,232,0.3)', borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >▸ Show source</button>
                )}
                <button
                  onClick={() => decide(sub.batchId, 'reject')}
                  disabled={updating === sub.batchId}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 600,
                    background: 'rgba(232,120,120,0.06)', color: '#E87878',
                    border: '1px solid rgba(232,120,120,0.25)', borderRadius: 6,
                    cursor: updating === sub.batchId ? 'default' : 'pointer',
                  }}
                >Reject</button>
                <button
                  onClick={() => decide(sub.batchId, 'approve')}
                  disabled={updating === sub.batchId}
                  style={{
                    padding: '8px 16px', fontSize: 12, fontWeight: 700,
                    background: updating === sub.batchId ? 'rgba(125,211,164,0.08)' : 'rgba(125,211,164,0.12)',
                    color: '#7DD3A4',
                    border: '1px solid rgba(125,211,164,0.3)', borderRadius: 6,
                    cursor: updating === sub.batchId ? 'default' : 'pointer',
                  }}
                >{updating === sub.batchId ? 'Working…' : 'Approve'}</button>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 6,
            }}>
              {sub.photos.map(p => (
                <div
                  key={p.id}
                  className="palm-slide-thumb"
                  style={{
                    position: 'relative', aspectRatio: '1/1', overflow: 'hidden',
                    background: '#111', borderRadius: 6,
                  }}
                >
                  <button
                    onClick={() => setLightbox({ photo: p })}
                    title="Click to view full size"
                    style={{
                      position: 'absolute', inset: 0,
                      background: 'transparent', border: 'none',
                      cursor: 'pointer', padding: 0,
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
                  </button>
                  <div style={{
                    position: 'absolute', top: 4, left: 4, pointerEvents: 'none',
                    padding: '1px 6px', fontSize: 10, fontWeight: 700,
                    background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 3,
                  }}>{p.carouselIndex || '?'}</div>
                  {/* Per-slide reject ✕ (SMM Batch 5). Hover-visible only via
                      CSS opacity transition. Opens an inline reject panel below
                      the carousel card so the operator can pick: remove this
                      slide only, or bounce the whole carousel. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setRejectingSlide({ batchId: sub.batchId, photo: p, reason: '' })
                    }}
                    title="Reject this slide"
                    className="palm-slide-reject"
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 22, height: 22, padding: 0,
                      borderRadius: 11,
                      background: 'rgba(232,120,120,0.85)',
                      color: '#fff', border: 'none',
                      fontSize: 13, fontWeight: 700, lineHeight: 1,
                      cursor: 'pointer',
                      opacity: 0, transition: 'opacity 0.15s',
                    }}
                  >×</button>
                </div>
              ))}
            </div>
            {/* Inline per-slide reject panel — appears under the carousel
                grid only for the currently-selected slide in this batch. */}
            {rejectingSlide?.batchId === sub.batchId && (
              <div style={{
                marginTop: 8, padding: 12,
                background: 'rgba(232,120,120,0.06)',
                border: '1px solid rgba(232,120,120,0.30)',
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <img
                    src={rejectingSlide.photo.image}
                    alt=""
                    style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                    Rejecting slide {rejectingSlide.photo.carouselIndex || '?'}
                  </div>
                  <button
                    onClick={() => setRejectingSlide(null)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 14, cursor: 'pointer', padding: '0 6px' }}
                  >×</button>
                </div>
                <textarea
                  value={rejectingSlide.reason}
                  onChange={e => setRejectingSlide(r => ({ ...r, reason: e.target.value }))}
                  placeholder="Optional reason — only used when bouncing the whole carousel back to the AI editor"
                  rows={2}
                  style={{
                    width: '100%', padding: 8,
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 6, color: 'var(--foreground)',
                    fontSize: 12, fontFamily: 'inherit', resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => rejectSlide(rejectingSlide.batchId, rejectingSlide.photo.id, 'remove', rejectingSlide.reason)}
                    disabled={updating === rejectingSlide.batchId}
                    style={{
                      padding: '7px 14px', fontSize: 12, fontWeight: 600,
                      background: 'rgba(232,195,106,0.12)', color: '#E8C36A',
                      border: '1px solid rgba(232,195,106,0.35)', borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >Remove only this slide</button>
                  <button
                    onClick={() => rejectSlide(rejectingSlide.batchId, rejectingSlide.photo.id, 'bounce', rejectingSlide.reason)}
                    disabled={updating === rejectingSlide.batchId}
                    style={{
                      padding: '7px 14px', fontSize: 12, fontWeight: 700,
                      background: 'rgba(232,120,120,0.10)', color: '#E87878',
                      border: '1px solid rgba(232,120,120,0.40)', borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >Bounce whole carousel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        .palm-slide-thumb:hover .palm-slide-reject { opacity: 1 !important; }
      `}</style>

      {/* Side-by-side source vs AI modal. Opens via the "Show source"
          button per submission. Reviewer compares the original scraped
          carousel slides (left) with the AI versions (right). */}
      {sourceModal && (() => {
        const sub = sourceModal.submission
        const proj = sub.project
        return (
          <div
            onClick={e => { if (e.target === e.currentTarget) setSourceModal(null) }}
            style={{
              position: 'fixed', inset: 0, zIndex: 600,
              background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              padding: 32, overflowY: 'auto',
            }}
          >
            <div style={{
              background: 'var(--card-bg-solid)', borderRadius: 12,
              width: '100%', maxWidth: 1280, padding: 20,
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {sub.title || `Carousel for ${sub.creatorName}`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 4 }}>
                    Source: <strong>@{proj.sourceHandle || '?'}</strong>
                    {proj.sourcePostUrl && (
                      <> · <a href={proj.sourcePostUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--palm-pink)' }}>view on IG</a></>
                    )} · @{sub.creatorName}
                  </div>
                </div>
                <button
                  onClick={() => setSourceModal(null)}
                  style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 22, cursor: 'pointer', padding: '0 8px' }}
                >×</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Source column */}
                <div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--foreground-muted)',
                    marginBottom: 8,
                  }}>Source · {proj.sourcePhotos?.length || 0}</div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 6,
                  }}>
                    {(proj.sourcePhotos || []).map(p => (
                      <div key={p.id} style={{
                        position: 'relative', aspectRatio: '1/1', overflow: 'hidden',
                        background: '#111', borderRadius: 6,
                      }}>
                        {p.image && (
                          <img
                            src={p.image}
                            onError={e => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        <div style={{
                          position: 'absolute', top: 2, left: 2,
                          padding: '0 5px', fontSize: 9, fontWeight: 700,
                          background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 2,
                        }}>{p.carouselIndex || '?'}</div>
                      </div>
                    ))}
                  </div>
                  {!proj.sourcePhotos?.length && (
                    <div style={{ color: '#777', fontSize: 12, padding: 12 }}>
                      No source slides attached to this project.
                    </div>
                  )}
                </div>

                {/* AI column */}
                <div>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--palm-pink)',
                    marginBottom: 8,
                  }}>{sourceLabel} Submission · {sub.photos.length}</div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 6,
                  }}>
                    {sub.photos.map(p => (
                      <div key={p.id} style={{
                        position: 'relative', aspectRatio: '1/1', overflow: 'hidden',
                        background: '#111', borderRadius: 6,
                      }}>
                        {p.image && (
                          <img
                            src={p.image}
                            onError={e => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        <div style={{
                          position: 'absolute', top: 2, left: 2,
                          padding: '0 5px', fontSize: 9, fontWeight: 700,
                          background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 2,
                        }}>{p.carouselIndex || '?'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { decide(sub.batchId, 'reject'); setSourceModal(null) }}
                  disabled={updating === sub.batchId}
                  style={{
                    padding: '10px 18px', fontSize: 13, fontWeight: 600,
                    background: 'rgba(232,120,120,0.06)', color: '#E87878',
                    border: '1px solid rgba(232,120,120,0.25)', borderRadius: 6,
                    cursor: updating === sub.batchId ? 'default' : 'pointer',
                  }}
                >Reject</button>
                <button
                  onClick={() => { decide(sub.batchId, 'approve'); setSourceModal(null) }}
                  disabled={updating === sub.batchId}
                  style={{
                    padding: '10px 22px', fontSize: 13, fontWeight: 700,
                    background: 'rgba(125,211,164,0.14)', color: '#7DD3A4',
                    border: '1px solid rgba(125,211,164,0.35)', borderRadius: 6,
                    cursor: updating === sub.batchId ? 'default' : 'pointer',
                  }}
                >{updating === sub.batchId ? 'Working…' : 'Approve'}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {lightbox && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLightbox(null) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <img
            src={lightbox.photo.image}
            onError={e => { if (lightbox.photo.imageFallback) e.currentTarget.src = lightbox.photo.imageFallback }}
            alt=""
            style={{
              maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain',
              background: '#000', borderRadius: 8,
            }}
          />
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute', top: 24, right: 24,
              width: 36, height: 36, padding: 0, borderRadius: 18,
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer', fontSize: 18, fontWeight: 700,
            }}
          >×</button>
        </div>
      )}
    </div>
  )
}
