'use client'
import { useCallback, useEffect, useState } from 'react'

// AI Carousel Submissions — pending batches uploaded via /ai-editor.
// Lives alongside the existing reel For Review queue. Approve flips each
// photo in the batch to Review Status=Approved (surfaces in Carousels
// picker under AI Generated); Reject flips to Rejected (Photo stays in
// Airtable for audit but the picker filter hides it).
export default function CarouselSubmissionsReview({ showToast }) {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [lightbox, setLightbox] = useState(null)  // { photo }

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/photos/carousel-submissions')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setSubmissions(data.submissions || [])
    } catch (err) {
      showToast?.(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [showToast])

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

  if (loading) return null
  if (!submissions.length) return null  // Hide the whole section when empty.

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{
        fontSize: 13, fontWeight: 600, color: 'var(--foreground-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        📸 AI Carousel Submissions
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
              <div style={{ display: 'flex', gap: 8 }}>
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
                <button
                  key={p.id}
                  onClick={() => setLightbox({ photo: p })}
                  title="Click to view full size"
                  style={{
                    position: 'relative', aspectRatio: '1/1', overflow: 'hidden',
                    background: '#111', border: 'none', borderRadius: 6,
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
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    padding: '1px 6px', fontSize: 10, fontWeight: 700,
                    background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 3,
                  }}>{p.carouselIndex || '?'}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

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
