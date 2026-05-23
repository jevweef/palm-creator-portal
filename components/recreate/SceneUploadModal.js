'use client'

// Inline upload modal for finishing a single Stage B scene from
// inside the workflow. Same Dropbox-direct + finalize pattern as the
// Workspace tab's ReelCard, but scoped to ONE scene so the editor
// doesn't have to navigate back to the pool view.
//
// Auto-fills the scene's slug into the upload payload so the server
// can match the new Asset to the right Stage B record. Auto-uses the
// scene's still as the thumbnail (no second file picker).

import { useEffect, useRef, useState } from 'react'

// Resize + JPEG-encode the source image (File or URL) entirely in the
// browser, return raw base64. Two reasons we have to compress:
//   1. The Wan AI scene stills are 20+MB PNGs — the finalize POST that
//      carries the base64 in its body would blow past Vercel's 4.5MB
//      serverless request limit, returning a "Request Entity Too Large"
//      HTML page that the client then tried to JSON.parse (the confusing
//      "Unexpected token 'R'" error).
//   2. We attach this directly to Airtable's Thumbnail field — a 500KB
//      JPEG renders just as well as a 25MB PNG for a card-size preview.
// Max 1080px on the long edge, JPEG quality 0.85 — keeps most outputs
// well under 500KB.
const compressImageToBase64 = async (source, maxDim = 1080, quality = 0.85) => {
  // Load into an Image element via Blob URL (works for both File and URL).
  const img = await new Promise((resolve, reject) => {
    const url = typeof source === 'string'
      ? source
      : URL.createObjectURL(source)
    const el = new Image()
    el.crossOrigin = 'anonymous'  // for URL sources from Airtable/Dropbox
    el.onload = () => resolve({ el, blobUrl: typeof source === 'string' ? null : url })
    el.onerror = () => reject(new Error(`image load failed: ${typeof source === 'string' ? source.slice(0, 80) : source.name}`))
    el.src = url
  })
  try {
    // Scale to maxDim on the long edge, preserving aspect.
    const { width: w0, height: h0 } = img.el
    const scale = Math.min(1, maxDim / Math.max(w0, h0))
    const w = Math.round(w0 * scale)
    const h = Math.round(h0 * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    // Black fill — JPEGs don't have alpha, so a transparent PNG would
    // otherwise composite onto unpredictable background.
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img.el, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return dataUrl.split(',')[1]
  } finally {
    if (img.blobUrl) URL.revokeObjectURL(img.blobUrl)
  }
}

// Best-effort JSON parse — if the response was actually HTML (e.g. a
// Vercel 413 / 504 page), surface a clean message instead of letting
// JSON.parse throw "Unexpected token". Returns { ok, data, error }.
const safeJson = async (res) => {
  const text = await res.text()
  if (!text) return { ok: res.ok, data: null, error: res.ok ? null : `HTTP ${res.status}` }
  try {
    return { ok: res.ok, data: JSON.parse(text), error: null }
  } catch {
    // Not JSON — pull the first meaningful line for the message.
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
    return { ok: false, data: null, error: `HTTP ${res.status}: ${snippet || res.statusText}` }
  }
}

export default function SceneUploadModal({ scene, creatorId, onClose, onSuccess }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  // Optional custom thumbnail. When null, falls back to the scene's still
  // (the existing behavior — most uploads just use the still). When set,
  // submitUpload encodes this image instead.
  const [thumbnailFile, setThumbnailFile] = useState(null)
  const [thumbnailPreview, setThumbnailPreview] = useState(null) // local data URL for preview
  const [dragOverThumbnail, setDragOverThumbnail] = useState(false)
  const videoFileRef = useRef(null)
  const thumbnailFileRef = useRef(null)
  const reelId = scene?.reel?.id
  const slug = scene?.slug || null

  const acceptFile = (file) => {
    if (!file) return
    if (!file.type?.startsWith('video/')) {
      setErr('Need a video file (mp4, mov, webm)')
      return
    }
    setErr('')
    setSelectedFile(file)
  }

  const acceptThumbnail = (file) => {
    if (!file) return
    if (!file.type?.startsWith('image/')) {
      setErr('Thumbnail must be an image (jpg, png, webp)')
      return
    }
    setErr('')
    setThumbnailFile(file)
    // Generate preview so the UI updates immediately to the picked image.
    const r = new FileReader()
    r.onload = () => setThumbnailPreview(String(r.result))
    r.onerror = () => setErr('Could not read thumbnail file')
    r.readAsDataURL(file)
  }

  const resetThumbnail = () => {
    setThumbnailFile(null)
    setThumbnailPreview(null)
    if (thumbnailFileRef.current) thumbnailFileRef.current.value = ''
  }

  const submitUpload = async () => {
    const vf = selectedFile || videoFileRef.current?.files?.[0]
    if (!vf) { setErr('Drop the finished video here or click to pick one'); return }
    if (!reelId) { setErr('Scene is missing its source reel — cannot finalize'); return }
    setUploading(true); setErr(''); setProgress('Preparing upload…')
    try {
      // 1. Dropbox upload token scoped to this reel + slug.
      setProgress('Getting upload token…')
      const tokRes = await fetch('/api/ai-editor/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelRecordId: reelId, slug }),
      })
      const tokParsed = await safeJson(tokRes)
      if (!tokParsed.ok) throw new Error(tokParsed.error || tokParsed.data?.error || 'Could not get upload token')
      const tok = tokParsed.data

      // 2. Direct-to-Dropbox upload for the video (skips Vercel body limit).
      setProgress(`Uploading ${(vf.size / 1024 / 1024).toFixed(1)} MB to Dropbox…`)
      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: tok.path, mode: 'overwrite', mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: await vf.arrayBuffer(),
      })
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed (${dbxRes.status})`)

      // 3. Resolve the thumbnail. Two paths so we never blow Vercel's
      //    body limit, and both end up in Cloudflare Images (so the For
      //    Review card + Post Prep load the CDN-optimized version):
      //    a. Custom upload: compress to ~500KB JPEG client-side, send
      //       base64 → server uploads bytes to CF Images.
      //    b. Scene still (default): send just the URL — the server
      //       passes it straight to CF's "upload by URL" endpoint, so
      //       no image bytes ever transit Vercel.
      setProgress(thumbnailFile ? 'Compressing thumbnail…' : 'Preparing thumbnail…')
      let thumbnailBase64 = null
      let thumbnailSourceUrl = null
      try {
        if (thumbnailFile) {
          thumbnailBase64 = await compressImageToBase64(thumbnailFile)
        } else if (scene.image) {
          thumbnailSourceUrl = scene.image
        }
      } catch (e) {
        // Non-fatal — the Asset still gets created without a thumbnail.
        console.warn('[scene-upload] thumbnail prep failed:', e.message)
      }

      // 4. Finalize — creates Asset + Task, uploads thumbnail to CF
      //    Images (server-side), marks pool reel Produced.
      setProgress('Finalizing…')
      const finRes = await fetch('/api/ai-editor/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reelRecordId: reelId,
          creatorId,
          dropboxPath: tok.path,
          thumbnailBase64,        // null when using URL
          thumbnailSourceUrl,     // null when using base64
          slug,
        }),
      })
      const fin = await safeJson(finRes)
      if (!fin.ok) throw new Error(fin.error || fin.data?.error || 'Finalize failed')

      setProgress('✓ Done — landed in admin For Review.')
      setTimeout(() => onSuccess?.(fin.data), 600)
    } catch (e) {
      setErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  // Blob URL for the picked video — used to show the first frame in the
  // video drop box. Revoke on file change / unmount so we don't leak.
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null)
  useEffect(() => {
    if (!selectedFile) { setVideoPreviewUrl(null); return }
    const url = URL.createObjectURL(selectedFile)
    setVideoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedFile])

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(720px, 95vw)', maxHeight: '92vh', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>↑ Upload finished video</div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>{slug || 'this scene'}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          {/* Side-by-side drop zones — both pieces of media are 9:16 vertical
              so identical portrait boxes make the relationship obvious and
              the previews look natural. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            {/* ─── THUMBNAIL BOX ─────────────────────────────────────────
                Defaults to scene still (filled preview), or shows custom
                upload if user picked one. Drop / click anywhere to swap. */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Thumbnail <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>(optional)</span>
              </label>
              <div
                onClick={() => !uploading && thumbnailFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOverThumbnail(true) }}
                onDragLeave={() => setDragOverThumbnail(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOverThumbnail(false)
                  if (uploading) return
                  const file = e.dataTransfer?.files?.[0]
                  if (file) acceptThumbnail(file)
                }}
                style={{
                  position: 'relative',
                  aspectRatio: '9/16',
                  borderRadius: 10,
                  border: `2px dashed ${dragOverThumbnail ? '#6AC68A' : thumbnailFile ? 'rgba(106,198,138,0.55)' : 'rgba(255,255,255,0.18)'}`,
                  background: dragOverThumbnail ? 'rgba(106,198,138,0.10)' : '#000',
                  cursor: uploading ? 'wait' : 'pointer',
                  transition: 'all 0.15s',
                  overflow: 'hidden',
                }}>
                {/* Preview fills the whole drop zone so the editor sees
                    exactly what will be used as the For Review / Post
                    thumbnail. */}
                {(thumbnailPreview || scene?.image) && (
                  <img src={thumbnailPreview || scene.image} alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: dragOverThumbnail ? 0.45 : 1, transition: 'opacity 0.15s' }} />
                )}
                {/* Bottom overlay with state-aware drop hint */}
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0,
                  padding: '10px 12px 12px',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85) 30%, rgba(0,0,0,0))',
                  color: '#fff',
                  pointerEvents: 'none',
                }}>
                  {thumbnailFile ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#6AC68A', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        🖼 {thumbnailFile.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)' }}>
                        Custom · click to swap
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        Drop a custom thumbnail
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', marginTop: 2 }}>
                        or click to pick · skip to use scene still
                      </div>
                    </>
                  )}
                </div>
                {/* Reset link (only when custom). stopPropagation so the
                    click doesn't re-open the file picker. */}
                {thumbnailFile && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); resetThumbnail() }}
                    disabled={uploading}
                    title="Use scene still instead"
                    style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 5, padding: '4px 8px', cursor: uploading ? 'wait' : 'pointer' }}>
                    ↺ Reset
                  </button>
                )}
              </div>
              <input
                ref={thumbnailFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                onChange={(e) => acceptThumbnail(e.target.files?.[0])}
                style={{ display: 'none' }}
              />
            </div>

            {/* ─── FINISHED VIDEO BOX ────────────────────────────────────
                Same 9:16 portrait shape. Once a file is picked, shows the
                video's first frame inline so the editor can confirm it's
                the right cut before submitting. */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Finished video
              </label>
              <div
                onClick={() => !uploading && videoFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false)
                  if (uploading) return
                  const file = e.dataTransfer?.files?.[0]
                  if (file) acceptFile(file)
                }}
                style={{
                  position: 'relative',
                  aspectRatio: '9/16',
                  borderRadius: 10,
                  border: `2px dashed ${dragOver ? '#6AC68A' : selectedFile ? 'rgba(106,198,138,0.55)' : 'rgba(255,255,255,0.18)'}`,
                  background: dragOver ? 'rgba(106,198,138,0.10)' : '#000',
                  cursor: uploading ? 'wait' : 'pointer',
                  transition: 'all 0.15s',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                {/* First-frame preview when a file is picked. preload=metadata
                    keeps it light — we only need the first frame, not the
                    full file decoded. muted+playsInline needed for Safari
                    to actually render the poster frame. */}
                {videoPreviewUrl ? (
                  <video
                    src={videoPreviewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', opacity: dragOver ? 0.45 : 1, transition: 'opacity 0.15s' }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '0 16px', color: 'rgba(255,255,255,0.85)' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      Drop the finished video
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                      or click to pick from Finder
                    </div>
                  </div>
                )}
                {/* Bottom overlay with filename / size once picked. */}
                {selectedFile && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0,
                    padding: '10px 12px 12px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.85) 30%, rgba(0,0,0,0))',
                    color: '#fff',
                    pointerEvents: 'none',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#6AC68A', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🎬 {selectedFile.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)' }}>
                      {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · click to swap
                    </div>
                  </div>
                )}
              </div>
              <input ref={videoFileRef} type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*"
                onChange={(e) => acceptFile(e.target.files?.[0])}
                style={{ display: 'none' }} />
            </div>
          </div>

          {/* Helper text + status messages live below the grid so they
              don't compete for space inside either box. */}
          {slug && (
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
              Files named <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>{slug}.mp4</code> auto-match.
            </div>
          )}

          {err && (
            <div style={{ padding: '8px 10px', background: 'rgba(232,120,120,0.12)', color: '#E87878', borderRadius: 5, fontSize: 12 }}>{err}</div>
          )}
          {progress && !err && (
            <div style={{ padding: '8px 10px', background: 'rgba(120,180,232,0.10)', color: '#8FB4F0', borderRadius: 5, fontSize: 12 }}>{progress}</div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={uploading}
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submitUpload} disabled={uploading}
            style={{ background: uploading ? 'rgba(106,198,138,0.18)' : 'rgba(106,198,138,0.28)', color: '#6AC68A', border: '1px solid rgba(106,198,138,0.45)', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: uploading ? 'default' : 'pointer' }}>
            {uploading ? '⏳ Uploading…' : '↑ Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
