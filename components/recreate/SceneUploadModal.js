'use client'

// Inline upload modal for finishing a single Stage B scene from
// inside the workflow. Same Dropbox-direct + finalize pattern as the
// Workspace tab's ReelCard, but scoped to ONE scene so the editor
// doesn't have to navigate back to the pool view.
//
// Auto-fills the scene's slug into the upload payload so the server
// can match the new Asset to the right Stage B record. Auto-uses the
// scene's still as the thumbnail (no second file picker).

import { useRef, useState } from 'react'

const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1])
  r.onerror = rej
  r.readAsDataURL(file)
})

// Fetch the scene's still URL, convert to base64. The thumbnail field
// on the Asset is what shows up in the editor's For Review list — the
// scene's still IS the perfect thumbnail for this video.
const urlToBase64 = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`thumbnail fetch ${r.status}`)
  const blob = await r.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
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
      const tok = await tokRes.json()
      if (!tokRes.ok) throw new Error(tok.error || 'Could not get upload token')

      // 2. Direct-to-Dropbox upload (skips Vercel body limit).
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

      // 3. Encode the thumbnail. Order of preference:
      //    a. Custom thumbnail the user picked in the modal (overrides)
      //    b. Scene's still image fetched + encoded (the default)
      //    c. 1x1 transparent PNG (keeps Asset creation happy if both fail)
      setProgress('Encoding thumbnail…')
      let thumbnailBase64 = ''
      try {
        if (thumbnailFile) {
          thumbnailBase64 = await fileToBase64(thumbnailFile)
        } else if (scene.image) {
          thumbnailBase64 = await urlToBase64(scene.image)
        }
      } catch (e) {
        console.warn('[scene-upload] thumbnail encode failed:', e.message)
      }
      if (!thumbnailBase64) {
        // 1x1 transparent PNG — keeps the Asset creation happy.
        thumbnailBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      }

      // 4. Finalize — creates Asset + Task, marks pool reel Produced.
      setProgress('Finalizing…')
      const finRes = await fetch('/api/ai-editor/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reelRecordId: reelId,
          creatorId,
          dropboxPath: tok.path,
          thumbnailBase64,
          slug,
        }),
      })
      const data = await finRes.json()
      if (!finRes.ok) throw new Error(data.error || 'Finalize failed')

      setProgress('✓ Done — landed in admin For Review.')
      setTimeout(() => onSuccess?.(data), 600)
    } catch (e) {
      setErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(640px, 95vw)', maxHeight: '92vh', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>↑ Upload finished video</div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>{slug || 'this scene'}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ─── THUMBNAIL BOX ─────────────────────────────────────────
              Same shape + drag-drop affordance as the video box below.
              Defaults to the scene's still (shows it as a small preview
              chip in the drop zone) so the editor never has to upload
              one unless they want to override. */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Thumbnail <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>(optional — defaults to scene still)</span>
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
                padding: '14px 16px',
                borderRadius: 10,
                border: `2px dashed ${dragOverThumbnail ? '#6AC68A' : thumbnailFile ? 'rgba(106,198,138,0.55)' : 'rgba(255,255,255,0.18)'}`,
                background: dragOverThumbnail ? 'rgba(106,198,138,0.10)' : thumbnailFile ? 'rgba(106,198,138,0.06)' : 'rgba(255,255,255,0.02)',
                cursor: uploading ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}>
              {/* Tiny preview of the current thumbnail (scene still by
                  default, custom file when picked). Anchors the box
                  visually so it never looks empty. */}
              <div style={{ flexShrink: 0, width: 56, aspectRatio: '9/16', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                {(thumbnailPreview || scene?.image) && (
                  <img src={thumbnailPreview || scene.image} alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {thumbnailFile ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#6AC68A', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🖼 {thumbnailFile.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                      Custom thumbnail · drop another or click to swap
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                      Drop a custom thumbnail here
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 2 }}>
                      or click to pick · skip to use the scene&apos;s still ←
                    </div>
                  </>
                )}
              </div>
              {thumbnailFile && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); resetThumbnail() }}
                  disabled={uploading}
                  title="Use scene still instead"
                  style={{ flexShrink: 0, fontSize: 11, color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, padding: '5px 9px', cursor: uploading ? 'wait' : 'pointer' }}>
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
              Required. Same shape as the thumbnail box above for visual
              parity — both look obviously droppable. */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--foreground-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Finished video</label>
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
                padding: selectedFile ? '14px 16px' : '24px 16px',
                borderRadius: 10,
                border: `2px dashed ${dragOver ? '#6AC68A' : selectedFile ? 'rgba(106,198,138,0.55)' : 'rgba(255,255,255,0.18)'}`,
                background: dragOver ? 'rgba(106,198,138,0.10)' : selectedFile ? 'rgba(106,198,138,0.06)' : 'rgba(255,255,255,0.02)',
                cursor: uploading ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                textAlign: 'center',
              }}>
              {selectedFile ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6AC68A', marginBottom: 4 }}>
                    🎬 {selectedFile.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · click to pick a different file
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>🎬</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                    Drop the finished video here
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
                    or click to pick from Finder
                  </div>
                </div>
              )}
            </div>
            <input ref={videoFileRef} type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              onChange={(e) => acceptFile(e.target.files?.[0])}
              style={{ display: 'none' }} />

            {slug && (
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', lineHeight: 1.5, marginTop: 8 }}>
                Files named <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3 }}>{slug}.mp4</code> auto-match.
              </div>
            )}

            {err && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(232,120,120,0.12)', color: '#E87878', borderRadius: 5, fontSize: 12 }}>{err}</div>
            )}
            {progress && !err && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(120,180,232,0.10)', color: '#8FB4F0', borderRadius: 5, fontSize: 12 }}>{progress}</div>
            )}
          </div>
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
