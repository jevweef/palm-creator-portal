'use client'
import { useEffect, useRef, useState } from 'react'

// Carousel Upload — editor drops in N AI-generated images, optionally
// labels the submission, and submits. Each image uploads one-at-a-time
// to /api/ai-editor/carousel-upload (per-file route avoids Vercel's body
// limit on bulk multipart). All photos in a single submit share a client-
// generated batchId so admins see them as one carousel in For Review.

function genBatchId() {
  return `carb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function bytesLabel(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function CarouselUploadSection({ creatorId, creators, linkedProjectId: externalLinkedProjectId, onLinkedProjectIdChange }) {
  const [files, setFiles] = useState([])  // [{ file, previewUrl }]
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, lastError: '' })
  const [lastResult, setLastResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  // Variations section state — Sonnet+Wan pipeline that takes a single
  // TJP source image and produces N pose variations using the creator's
  // AI Ref Inputs. Separate state from the main upload tray so editors
  // can iterate on variations before adding any to the actual upload.
  const [varSource, setVarSource] = useState(null)  // { file, previewUrl }
  const [varN, setVarN] = useState(3)
  const [varGenerating, setVarGenerating] = useState(false)
  const [varElapsed, setVarElapsed] = useState(0)
  const [varResults, setVarResults] = useState(null)  // API response
  const [varError, setVarError] = useState('')
  const varInputRef = useRef(null)

  // In-progress projects for the current creator (Planning/Submitted).
  // Editor optionally links a submission to one so admin review sees
  // the source carousel side-by-side + the project archives on Approve.
  // linkedProjectId is controlled by the parent so Start Project in the
  // Reference Library can pre-select a project on this form. Falls back
  // to internal state if no parent controller is wired.
  const [activeProjects, setActiveProjects] = useState([])
  const [internalLinkedProjectId, setInternalLinkedProjectId] = useState('')
  const linkedProjectId = externalLinkedProjectId !== undefined ? externalLinkedProjectId : internalLinkedProjectId
  const setLinkedProjectId = onLinkedProjectIdChange || setInternalLinkedProjectId

  const reloadActiveProjects = (cid) => {
    if (!cid) { setActiveProjects([]); return }
    fetch(`/api/admin/carousel-projects?creatorId=${encodeURIComponent(cid)}&status=Planning,Submitted`)
      .then(r => r.json())
      .then(d => setActiveProjects(d.projects || []))
      .catch(() => setActiveProjects([]))
  }
  useEffect(() => {
    if (!creatorId) { setActiveProjects([]); setLinkedProjectId(''); return }
    reloadActiveProjects(creatorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId])
  // When the parent lifts a new linked-project ID into us (e.g., from
  // Start Project in the Reference Library), our active-projects list
  // might not have caught the new one yet. Re-fetch so the dropdown
  // labels are accurate.
  useEffect(() => {
    if (linkedProjectId && creatorId && !activeProjects.some(p => p.id === linkedProjectId)) {
      reloadActiveProjects(creatorId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedProjectId])

  // Persist variation results across refresh. The Wan-hosted source URL
  // and the variation output URLs both live in `varResults`, so saving
  // that one blob is enough to restore the section's full state. Keyed by
  // (creator, project) so switching between projects swaps the cache and
  // refreshing within a project restores it. No server round-trip — these
  // are not yet stored on the Carousel Projects record itself.
  const varStorageKey = creatorId
    ? `carouselVar:${creatorId}:${linkedProjectId || 'unlinked'}`
    : null
  useEffect(() => {
    if (!varStorageKey || typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(varStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.results)) setVarResults(parsed)
        else setVarResults(null)
      } else {
        setVarResults(null)
      }
    } catch { setVarResults(null) }
    // Source File can't be persisted; clear local picker so the user
    // sees the hosted source URL inside varResults instead.
    setVarSource(null)
    setVarError('')
  }, [varStorageKey])
  useEffect(() => {
    if (!varStorageKey || typeof window === 'undefined') return
    try {
      if (varResults) window.localStorage.setItem(varStorageKey, JSON.stringify(varResults))
    } catch {}
  }, [varStorageKey, varResults])
  const clearVariations = () => {
    setVarResults(null)
    setVarSource(null)
    setVarError('')
    if (varStorageKey && typeof window !== 'undefined') {
      try { window.localStorage.removeItem(varStorageKey) } catch {}
    }
  }

  const acceptFiles = (incoming) => {
    const list = Array.from(incoming || []).filter(f => f.type?.startsWith('image/'))
    const rejected = (incoming?.length || 0) - list.length
    const next = list.map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }))
    setFiles(prev => {
      const combined = [...prev, ...next]
      // Trim to 10 (IG carousel cap), drop the excess.
      return combined.slice(0, 10)
    })
    if (rejected > 0) {
      setProgress(p => ({ ...p, lastError: `Skipped ${rejected} non-image file${rejected === 1 ? '' : 's'}` }))
    }
  }

  const removeFile = (idx) => {
    setFiles(prev => {
      const copy = [...prev]
      const [removed] = copy.splice(idx, 1)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return copy
    })
  }

  const clearAll = () => {
    files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl))
    setFiles([])
    setTitle('')
    setLastResult(null)
    setProgress({ current: 0, total: 0, lastError: '' })
  }

  // Variations — pick a single TJP source.
  const pickVarSource = (file) => {
    if (varSource?.previewUrl) URL.revokeObjectURL(varSource.previewUrl)
    if (!file) { setVarSource(null); return }
    if (!file.type?.startsWith('image/')) { setVarError('Pick an image file'); return }
    setVarSource({ file, previewUrl: URL.createObjectURL(file) })
    setVarError('')
    setVarResults(null)
  }

  // Fire the Sonnet+Wan pipeline. ~60-90s — we tick an elapsed counter
  // so the editor sees progress vs a frozen spinner.
  const generateVariations = async () => {
    if (!creatorId) { setVarError('Pick a creator first'); return }
    if (!varSource?.file) { setVarError('Pick a source image first'); return }
    setVarGenerating(true)
    setVarError('')
    setVarResults(null)
    setVarElapsed(0)
    const start = Date.now()
    const tick = setInterval(() => setVarElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    try {
      const fd = new FormData()
      fd.append('file', varSource.file)
      fd.append('creatorId', creatorId)
      fd.append('n', String(varN))
      const res = await fetch('/api/admin/ai-gen/carousel-variations', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setVarResults(data)
    } catch (err) {
      setVarError(err.message)
    } finally {
      clearInterval(tick)
      setVarGenerating(false)
    }
  }

  // Pull a variation result URL down as bytes, wrap it as a File, and push
  // it into the upload tray so the existing submit-for-review flow handles
  // it like any other slide.
  const addVariationToTray = async (result, idx) => {
    if (files.length >= 10) { setProgress(p => ({ ...p, lastError: 'Tray is full (max 10)' })); return }
    try {
      const r = await fetch(result.outputUrl)
      if (!r.ok) throw new Error(`Could not fetch variation: ${r.status}`)
      const blob = await r.blob()
      const filename = `variation-${idx + 1}-${(result.label || 'slide').replace(/[^\w-]+/g, '_').slice(0, 30)}.jpg`
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
      setFiles(prev => [...prev, { file, previewUrl: URL.createObjectURL(file) }])
    } catch (err) {
      setProgress(p => ({ ...p, lastError: `Could not add variation: ${err.message}` }))
    }
  }

  const addAllVariationsToTray = async () => {
    const successful = (varResults?.results || []).filter(r => r.outputUrl)
    for (let i = 0; i < successful.length; i++) {
      if (files.length + i >= 10) break
      await addVariationToTray(successful[i], i)
    }
  }

  const submit = async () => {
    if (!creatorId) { setProgress(p => ({ ...p, lastError: 'Pick a creator first' })); return }
    if (!files.length) { setProgress(p => ({ ...p, lastError: 'Add at least one image' })); return }

    setSubmitting(true)
    setLastResult(null)
    const batchId = genBatchId()
    let okCount = 0
    let firstError = ''
    const uploadedPhotoIds = []
    setProgress({ current: 0, total: files.length, lastError: '' })

    for (let i = 0; i < files.length; i++) {
      try {
        const fd = new FormData()
        fd.append('file', files[i].file)
        fd.append('creatorId', creatorId)
        fd.append('batchId', batchId)
        fd.append('slideIndex', String(i + 1))
        if (title.trim()) fd.append('submissionTitle', title.trim())
        const res = await fetch('/api/ai-editor/carousel-upload', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `slide ${i + 1} failed: HTTP ${res.status}`)
        if (data.photoId) uploadedPhotoIds.push(data.photoId)
        okCount++
        setProgress({ current: i + 1, total: files.length, lastError: '' })
      } catch (err) {
        if (!firstError) firstError = err.message
        setProgress(p => ({ ...p, current: i + 1, lastError: err.message }))
        // Keep going — other slides might succeed; admin can re-review.
      }
    }

    // If linked to a project, stamp the project with the batch ID +
    // uploaded photo IDs + flip status to Submitted. Failures here are
    // non-fatal — photos still exist as a standalone submission the
    // admin can act on; the project link just won't show on review.
    if (linkedProjectId && uploadedPhotoIds.length) {
      try {
        await fetch('/api/admin/carousel-projects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: linkedProjectId,
            fields: {
              'Submission Batch ID': batchId,
              'Uploaded Photos': uploadedPhotoIds,
              'Status': 'Submitted',
              'Submitted At': new Date().toISOString(),
            },
          }),
        })
      } catch (err) {
        console.warn('[carousel-upload] Project link failed:', err)
      }
    }

    setSubmitting(false)
    setLastResult({
      ok: okCount === files.length,
      uploaded: okCount,
      total: files.length,
      batchId,
      linkedProjectId: linkedProjectId || null,
      error: firstError,
    })
    if (okCount > 0) {
      // Clear the tray so the editor sees a clean slate. Keep title for
      // quick repeat submissions. Project link also clears — admin's
      // dropdown re-fetches on next render and the just-linked project
      // moves out of the Planning list.
      files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl))
      setFiles([])
      setLinkedProjectId('')
      // Re-fetch project list since the one we linked just moved to
      // Submitted and should drop from the Planning dropdown.
      if (creatorId) {
        fetch(`/api/admin/carousel-projects?creatorId=${encodeURIComponent(creatorId)}&status=Planning,Submitted`)
          .then(r => r.json())
          .then(d => setActiveProjects(d.projects || []))
          .catch(() => {})
      }
    }
  }

  const creatorName = creators?.find(c => c.id === creatorId)?.name || ''

  const linkedProject = activeProjects.find(p => p.id === linkedProjectId)

  return (
    <div id="carousel-upload-anchor" style={{ maxWidth: 900, marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 80 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>📸 AI Carousel Upload</h2>
        <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: 0 }}>
          Upload AI-generated carousel slides. After submit, admins see the batch in their For Review tab. Approved batches become available in the Carousels picker under <em>AI Generated</em>.
        </p>
      </div>

      {/* Active Projects panel — surface in-progress projects so the
          editor sees them at a glance and can pick one for their next
          upload. Hidden when there's nothing in flight. */}
      {activeProjects.length > 0 && (
        <div style={{
          padding: 14, borderRadius: 10,
          background: 'rgba(232,184,120,0.04)',
          border: '1px solid rgba(232,184,120,0.18)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <strong style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#E8B878' }}>
              🔧 Active Projects for {creators?.find(c => c.id === creatorId)?.name || 'this creator'}
            </strong>
            <span style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
              {activeProjects.length} in progress
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeProjects.map(p => {
              const isLinked = p.id === linkedProjectId
              return (
                <div key={p.id} style={{
                  padding: '10px 12px', borderRadius: 6,
                  background: isLinked ? 'rgba(168,132,232,0.12)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isLinked ? 'rgba(168,132,232,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name || `@${p.sourceHandle}`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 2 }}>
                        Status: <span style={{ color: p.status === 'Submitted' ? '#7DD3A4' : '#E8B878' }}>{p.status}</span>
                        {p.sourcePhotoCount > 0 && ` · ${p.sourcePhotoCount} source slide${p.sourcePhotoCount === 1 ? '' : 's'}`}
                        {p.uploadedPhotoCount > 0 && ` · ${p.uploadedPhotoCount} uploaded`}
                        {p.sourcePostUrl && (
                          <> · <a href={p.sourcePostUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--palm-pink)', textDecoration: 'none' }}>source ↗</a></>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setLinkedProjectId(isLinked ? '' : p.id)}
                      style={{
                        padding: '6px 12px', fontSize: 11, fontWeight: 700,
                        background: isLinked ? 'rgba(168,132,232,0.25)' : 'rgba(168,132,232,0.08)',
                        color: '#c8b0e8',
                        border: '1px solid rgba(168,132,232,0.35)', borderRadius: 5,
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >{isLinked ? '✓ Linked' : 'Use for upload'}</button>
                  </div>
                  {/* Source slide thumbnails inline — editor sees what
                      they're recreating right next to where they're
                      uploading. Linked project gets the full strip;
                      others get a compact 4-thumb peek so the panel
                      stays manageable. */}
                  {p.sourcePhotos?.length > 0 && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(auto-fill, minmax(${isLinked ? '280px' : '180px'}, 1fr))`,
                      gap: 6,
                    }}>
                      {(isLinked ? p.sourcePhotos : p.sourcePhotos.slice(0, 6)).map(sp => (
                        <div key={sp.id} style={{
                          aspectRatio: '1/1', background: '#000', borderRadius: 4,
                          overflow: 'hidden', position: 'relative',
                        }}>
                          {sp.image && (
                            <img
                              src={sp.image}
                              onError={e => { if (sp.imageFallback && e.currentTarget.src !== sp.imageFallback) e.currentTarget.src = sp.imageFallback }}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          )}
                          <div style={{
                            position: 'absolute', top: 3, left: 3,
                            padding: '1px 5px', fontSize: 10, fontWeight: 700,
                            background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 3,
                          }}>{sp.carouselIndex || '?'}</div>
                        </div>
                      ))}
                      {!isLinked && p.sourcePhotos.length > 6 && (
                        <div style={{
                          aspectRatio: '1/1', borderRadius: 4,
                          background: 'rgba(255,255,255,0.03)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, color: '#888', fontWeight: 700,
                        }}>+{p.sourcePhotos.length - 6}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {linkedProject && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#c8b0e8' }}>
              ↓ Drop AI slides below. They&apos;ll attach to <strong>{linkedProject.name}</strong> on submit.
            </div>
          )}
        </div>
      )}

      {/* Variations generator — Sonnet plans, Wan 2.7 fans out. Section
          is collapsible-by-presence: empty until the editor picks a source. */}
      <div style={{
        padding: 16, borderRadius: 10,
        background: 'rgba(168,132,232,0.04)',
        border: '1px solid rgba(168,132,232,0.18)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 8 }}>
            ✨ Generate variations from one image
          </div>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>
            Drop a single TJP image. The system analyzes it, then generates 3 candid-style pose variations using the creator&apos;s Super Clone reference photos. ~60-90 sec.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Source picker. If the user has restored cached results from a
              previous session, the local File is gone but the hosted source
              URL lives on varResults.sourceCdnUrl — fall back to that so
              they still see what their last variations were generated from. */}
          {(() => {
            const cachedSourceUrl = !varSource && varResults
              ? (varResults.sourceCdnUrl || varResults.sourceUrl || '')
              : ''
            const hasAnySource = !!varSource || !!cachedSourceUrl
            return (
              <div
                onClick={() => varInputRef.current?.click()}
                style={{
                  width: 120, height: 160, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
                  cursor: 'pointer', position: 'relative',
                  border: `2px dashed ${hasAnySource ? 'transparent' : 'rgba(168,132,232,0.4)'}`,
                  background: hasAnySource ? '#000' : 'rgba(168,132,232,0.04)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <input
                  ref={varInputRef}
                  type="file"
                  accept="image/*"
                  onChange={e => { pickVarSource(e.target.files?.[0] || null); e.target.value = '' }}
                  style={{ display: 'none' }}
                />
                {hasAnySource ? (
                  <>
                    <img src={varSource?.previewUrl || cachedSourceUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{
                      position: 'absolute', bottom: 4, left: 4, right: 4,
                      padding: '2px 6px', fontSize: 9, fontWeight: 700,
                      background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 3,
                      textAlign: 'center',
                    }}>SOURCE{!varSource && cachedSourceUrl ? ' (cached)' : ''}</div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', color: 'rgba(168,132,232,0.7)', fontSize: 11, padding: 8 }}>
                    Click<br />or drop<br />source image
                  </div>
                )}
              </div>
            )
          })()}

          {/* Controls + status */}
          <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>Variations:</label>
              <div style={{ display: 'inline-flex', borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                {[3, 5].map(num => (
                  <button
                    key={num}
                    onClick={() => setVarN(num)}
                    disabled={varGenerating}
                    style={{
                      padding: '5px 14px', fontSize: 12, fontWeight: 700,
                      background: varN === num ? 'rgba(168,132,232,0.18)' : 'transparent',
                      color: varN === num ? '#c8b0e8' : '#888',
                      border: 'none', cursor: varGenerating ? 'default' : 'pointer',
                    }}
                  >{num}</button>
                ))}
              </div>
              <button
                onClick={generateVariations}
                disabled={varGenerating || !varSource || !creatorId}
                style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  background: varGenerating || !varSource || !creatorId ? 'rgba(255,255,255,0.04)' : 'rgba(168,132,232,0.16)',
                  color: varGenerating || !varSource || !creatorId ? '#666' : '#c8b0e8',
                  border: `1px solid ${varGenerating || !varSource || !creatorId ? 'rgba(255,255,255,0.06)' : 'rgba(168,132,232,0.4)'}`,
                  borderRadius: 6, cursor: varGenerating || !varSource || !creatorId ? 'not-allowed' : 'pointer',
                }}
              >
                {varGenerating ? `Generating… ${varElapsed}s` : 'Generate'}
              </button>
              {varSource && !varGenerating && (
                <button
                  onClick={() => pickVarSource(null)}
                  style={{ background: 'none', border: 'none', color: '#888', fontSize: 11, cursor: 'pointer' }}
                >Clear source</button>
              )}
            </div>
            {varGenerating && (
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
                Analyzing source and running {varN} parallel generations. Leave this tab open.
              </div>
            )}
            {varError && (
              <div style={{ fontSize: 12, color: '#E87878' }}>{varError}</div>
            )}
            {varResults && !varGenerating && (
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {varResults.sceneDescription && <em>{varResults.sceneDescription}</em>}
                <span>· {varResults.succeeded}/{varResults.requested} succeeded</span>
                <button
                  onClick={clearVariations}
                  title="Wipe the cached variations for this creator/project so the next Generate starts fresh"
                  style={{ background: 'none', border: 'none', color: 'rgba(232,120,120,0.85)', fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >Clear cached variations</button>
              </div>
            )}
          </div>
        </div>

        {/* Results grid */}
        {varResults?.results?.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Results
              </strong>
              {varResults.results.some(r => r.outputUrl) && (
                <button
                  onClick={addAllVariationsToTray}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600,
                    background: 'rgba(168,132,232,0.10)', color: '#c8b0e8',
                    border: '1px solid rgba(168,132,232,0.3)', borderRadius: 5, cursor: 'pointer',
                  }}
                >+ Add all to tray</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {varResults.results.map((r, idx) => (
                <div key={idx} style={{
                  background: 'rgba(0,0,0,0.25)', borderRadius: 6, overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ aspectRatio: '9/16', background: '#000', position: 'relative' }}>
                    {r.outputUrl ? (
                      <img src={r.outputUrl} alt={r.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#E87878', fontSize: 11, padding: 12, textAlign: 'center',
                      }}>
                        Failed: {r.error?.slice(0, 80) || 'unknown error'}
                      </div>
                    )}
                    <div style={{
                      position: 'absolute', top: 4, left: 4,
                      padding: '1px 6px', fontSize: 9, fontWeight: 700,
                      background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 3,
                    }}>{idx + 1}</div>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
                      {r.label}
                    </div>
                    {r.outputUrl && (
                      <button
                        onClick={() => addVariationToTray(r, idx)}
                        disabled={files.length >= 10}
                        style={{
                          padding: '5px 8px', fontSize: 11, fontWeight: 600,
                          background: files.length >= 10 ? 'rgba(255,255,255,0.04)' : 'rgba(168,132,232,0.12)',
                          color: files.length >= 10 ? '#555' : '#c8b0e8',
                          border: `1px solid ${files.length >= 10 ? 'rgba(255,255,255,0.06)' : 'rgba(168,132,232,0.3)'}`,
                          borderRadius: 4, cursor: files.length >= 10 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        + Add to tray
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{
          padding: '8px 12px', fontSize: 12, background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
        }}>
          For creator: <strong style={{ color: 'var(--foreground)' }}>{creatorName || '— pick one above —'}</strong>
        </div>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Optional title (e.g. 'Beach set — June')"
          style={{
            flex: '1 1 240px', padding: '8px 12px', fontSize: 13,
            background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
          }}
        />
        {/* Project link — optional. Pulls Planning/Submitted projects for
            the selected creator. When linked, admin's review modal shows
            the source carousel side-by-side and the project archives on
            Approve. Standalone uploads are still fine (linked = none). */}
        {creatorId && (
          <select
            value={linkedProjectId}
            onChange={e => setLinkedProjectId(e.target.value)}
            style={{
              flex: '1 1 240px', padding: '8px 12px', fontSize: 13,
              background: 'rgba(168,132,232,0.06)', color: 'var(--foreground)',
              border: '1px solid rgba(168,132,232,0.25)', borderRadius: 6,
            }}
          >
            <option value="">Link to project (optional)</option>
            {activeProjects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status})
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); acceptFiles(e.dataTransfer.files) }}
        style={{
          padding: 28, border: `2px dashed ${dragOver ? 'var(--palm-pink)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 10, textAlign: 'center', cursor: 'pointer',
          background: dragOver ? 'rgba(232,160,160,0.06)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.15s ease',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => { acceptFiles(e.target.files); e.target.value = '' }}
          style={{ display: 'none' }}
        />
        <div style={{ fontSize: 14, color: 'var(--foreground)', marginBottom: 4 }}>
          Drop images here, or click to browse
        </div>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
          Up to 10 slides per carousel · JPG / PNG / HEIC / WebP
        </div>
      </div>

      {files.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 12, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {files.length} slide{files.length === 1 ? '' : 's'} ready
            </strong>
            <button
              onClick={clearAll}
              disabled={submitting}
              style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 12, cursor: submitting ? 'default' : 'pointer' }}
            >
              Clear all
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {files.map((f, idx) => (
              <div key={f.previewUrl} style={{
                position: 'relative', aspectRatio: '1/1', overflow: 'hidden',
                background: '#111', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <img src={f.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{
                  position: 'absolute', top: 4, left: 4,
                  padding: '1px 6px', fontSize: 10, fontWeight: 700,
                  background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 3,
                }}>{idx + 1}</div>
                <button
                  onClick={() => removeFile(idx)}
                  disabled={submitting}
                  style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 22, height: 22, padding: 0, borderRadius: 3,
                    background: 'rgba(0,0,0,0.75)', border: 'none', color: '#E87878',
                    cursor: submitting ? 'default' : 'pointer', fontSize: 14, fontWeight: 700,
                  }}
                  title="Remove"
                >×</button>
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '3px 6px', fontSize: 10, color: '#bbb',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                }}>{bytesLabel(f.file.size)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={submit}
          disabled={submitting || !files.length || !creatorId}
          style={{
            padding: '12px 22px', fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            background: submitting || !files.length || !creatorId ? 'rgba(255,255,255,0.04)' : 'var(--palm-pink)',
            color: submitting || !files.length || !creatorId ? '#666' : '#1a0a0a',
            border: 'none', borderRadius: 6, cursor: submitting || !files.length || !creatorId ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting
            ? `Uploading ${progress.current}/${progress.total}…`
            : `Submit ${files.length || ''} slide${files.length === 1 ? '' : 's'} for review`}
        </button>
        {progress.lastError && !submitting && (
          <span style={{ fontSize: 12, color: '#E87878' }}>{progress.lastError}</span>
        )}
      </div>

      {lastResult && !submitting && (
        <div style={{
          padding: 12, borderRadius: 6,
          background: lastResult.ok ? 'rgba(125,211,164,0.08)' : 'rgba(232,160,120,0.08)',
          border: `1px solid ${lastResult.ok ? 'rgba(125,211,164,0.3)' : 'rgba(232,160,120,0.3)'}`,
          fontSize: 13, color: lastResult.ok ? '#7DD3A4' : '#E8A878',
        }}>
          {lastResult.ok
            ? `✓ ${lastResult.uploaded} slide${lastResult.uploaded === 1 ? '' : 's'} submitted for admin review.`
            : `Uploaded ${lastResult.uploaded} of ${lastResult.total}. First error: ${lastResult.error}`}
        </div>
      )}
    </div>
  )
}
