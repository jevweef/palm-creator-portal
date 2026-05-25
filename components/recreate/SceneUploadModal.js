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
  // AI-generated alt-pose thumbnail. Generated on demand via Wan 2.7
  // (locks room+outfit+identity, changes pose). When set, takes priority
  // over the scene still but yields to a manually-uploaded thumbnailFile.
  // The URL points at a Cloudflare Images delivery URL, so we hand it to
  // the upload finalize as `thumbnailSourceUrl` (no bytes needed client-side).
  const [altPoseCdnUrl, setAltPoseCdnUrl] = useState(null)
  // Output aspect ratio for the alt-pose render. Default 4:5 (IG feed
  // post format — what these thumbnails are usually destined for via
  // Post Prep). Editor can switch to 1:1 / 3:4 / 9:16 per generation.
  const [altPoseAspect, setAltPoseAspect] = useState('4:5')
  const [altPosePanelOpen, setAltPosePanelOpen] = useState(false)
  const [altPosePrompt, setAltPosePrompt] = useState('')
  const [altPoseLoading, setAltPoseLoading] = useState(false)
  const [altPoseError, setAltPoseError] = useState('')
  // Outfit picker state. Fetched lazily when the panel opens (avoids one
  // extra fetch for editors who never use alt-pose). The selected outfit
  // feeds into the Wan call as Figure 3.
  const [reelOutfits, setReelOutfits] = useState([])
  const [outfitsLoading, setOutfitsLoading] = useState(false)
  const [selectedOutfitId, setSelectedOutfitId] = useState(null)
  // Pose reference picker. Pulls Pinterest-source photos from the global
  // library; clicking one fires Claude vision to extract a pose
  // description and drops it straight into the pose textarea. Editor
  // can still edit the description before generating.
  const [posePickerOpen, setPosePickerOpen] = useState(false)
  const [posePhotos, setPosePhotos] = useState([])
  const [posePhotosLoading, setPosePhotosLoading] = useState(false)
  const [poseAnalyzing, setPoseAnalyzing] = useState(false)
  const [selectedPoseRefId, setSelectedPoseRefId] = useState(null) // for the highlight in the grid
  // The 3 image URLs that would be (or were) sent to Wan. Lives whether
  // we've actually generated or not — refreshed via a dryRun fetch each
  // time the outfit selection changes, so the preview panel is always
  // showing exactly what Wan would receive on the next Generate click.
  const [currentInputs, setCurrentInputs] = useState(null)
  const [inputsLoading, setInputsLoading] = useState(false)
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

  // Lazy-fetch this reel's Selected Outfits when the alt-pose panel
  // opens. Idempotent — only runs the first time. Hits the existing
  // reel-outfits endpoint which hydrates Photo records with flatlay URLs.
  const ensureOutfitsLoaded = async () => {
    if (reelOutfits.length || outfitsLoading || !reelId) return
    setOutfitsLoading(true)
    try {
      const res = await fetch(`/api/admin/recreate-rooms/stage-b/reel-outfits?reelId=${reelId}`)
      const parsed = await safeJson(res)
      if (parsed.ok && Array.isArray(parsed.data?.outfits)) {
        setReelOutfits(parsed.data.outfits)
        // Auto-pick the first outfit if exactly one is attached — saves a
        // click. Otherwise leave nothing selected so the editor sees the
        // grid and intentionally chooses.
        if (parsed.data.outfits.length === 1) setSelectedOutfitId(parsed.data.outfits[0].id)
      }
    } catch (e) {
      // Non-fatal — picker just shows empty + an error hint.
      console.warn('[scene-upload] reel outfits fetch failed:', e.message)
    } finally {
      setOutfitsLoading(false)
    }
  }

  const openAltPosePanel = () => {
    setAltPosePanelOpen(true)
    setAltPoseError('')
    ensureOutfitsLoaded()
  }

  // Lazy-load Pinterest photos for the pose picker. Fetched once per
  // modal mount on first open, cached in state. Filtered client-side
  // to sourceType=Pinterest since that's where pose-reference photos
  // live for carousel-recreation work.
  const ensurePosePhotosLoaded = async () => {
    if (posePhotos.length || posePhotosLoading) return
    setPosePhotosLoading(true)
    try {
      const res = await fetch('/api/admin/photos/library')
      const parsed = await safeJson(res)
      if (parsed.ok && Array.isArray(parsed.data?.photos)) {
        const pinterest = parsed.data.photos.filter(p => p.sourceType === 'Pinterest' && p.image)
        setPosePhotos(pinterest)
      }
    } catch (e) {
      console.warn('[scene-upload] pose library fetch failed:', e.message)
    } finally {
      setPosePhotosLoading(false)
    }
  }

  const openPosePicker = () => {
    setPosePickerOpen(true)
    ensurePosePhotosLoaded()
  }

  // Pick a photo → server calls Claude vision → result fills the pose
  // textarea. Editor sees what Claude wrote and can edit before firing
  // Generate. We do NOT auto-fire generation because:
  //   - Wan gen takes another 30-60s — chain would be 40-70s of waiting
  //   - The Claude description may need a tweak before it's right
  //   - "Pick + edit + generate" is one clear sequence with editor agency
  const pickPoseRef = async (photo) => {
    setSelectedPoseRefId(photo.id)
    setPoseAnalyzing(true)
    setAltPoseError('')
    try {
      const res = await fetch('/api/admin/recreate-rooms/stage-b/pose-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: photo.id }),
      })
      const parsed = await safeJson(res)
      if (!parsed.ok) throw new Error(parsed.error || parsed.data?.error || 'Pose analysis failed')
      const desc = parsed.data?.poseDescription || ''
      if (!desc) throw new Error('No pose description returned')
      setAltPosePrompt(desc)
      setPosePickerOpen(false)  // collapse picker, editor sees the filled textarea
    } catch (e) {
      setAltPoseError(e.message)
      setSelectedPoseRefId(null)
    } finally {
      setPoseAnalyzing(false)
    }
  }

  // Fire Wan 2.7 alt-pose generation. Sends sceneId + outfitPhotoId +
  // pose direction. Server fetches the 3 reference images (subject,
  // room, outfit) and passes them to Wan as Figure 1/2/3. Server returns
  // a CDN URL + the inputs it used (so we can show the preview panel of
  // what was sent). Generation takes ~30-60s; UI shows progress overlay.
  const generateAltPose = async () => {
    if (!scene?.id) { setAltPoseError('Scene id missing — cannot generate'); return }
    if (!selectedOutfitId) { setAltPoseError('Pick an outfit first — Wan needs an outfit reference'); return }
    setAltPoseLoading(true)
    setAltPoseError('')
    try {
      const res = await fetch('/api/admin/recreate-rooms/stage-b/pose-alt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneId: scene.id,
          outfitPhotoId: selectedOutfitId,
          poseDirection: altPosePrompt,
          aspect: altPoseAspect,
        }),
      })
      const parsed = await safeJson(res)
      if (!parsed.ok) throw new Error(parsed.error || parsed.data?.error || 'Generation failed')
      const url = parsed.data?.cdnUrl || parsed.data?.imageUrl
      if (!url) throw new Error('No image URL returned')
      setAltPoseCdnUrl(url)
      if (parsed.data?.inputs) setCurrentInputs(parsed.data.inputs)
      // Keep the panel open so the editor sees the "inputs Wan used" debug
      // preview without having to re-open. They can click Cancel/Reset to
      // collapse it.
    } catch (e) {
      setAltPoseError(e.message)
    } finally {
      setAltPoseLoading(false)
    }
  }

  const clearAltPose = () => {
    setAltPoseCdnUrl(null)
    setCurrentInputs(null)
  }

  // Dry-run the pose-alt endpoint to fetch the exact URLs Wan would
  // receive for the current scene + outfit combo. Triggered whenever
  // the outfit selection changes; the response populates currentInputs
  // which drives the "Images sent to Wan" preview panel.
  // Same code path the real Generate uses, just with dryRun:true so it
  // returns the URLs without firing a Wan job — guarantees the preview
  // is what'll actually be sent.
  useEffect(() => {
    if (!altPosePanelOpen || !scene?.id || !selectedOutfitId) return
    let cancelled = false
    setInputsLoading(true)
    fetch('/api/admin/recreate-rooms/stage-b/pose-alt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: scene.id, outfitPhotoId: selectedOutfitId, aspect: altPoseAspect, dryRun: true }),
    })
      .then(safeJson)
      .then(parsed => {
        if (cancelled) return
        if (parsed.ok && parsed.data?.inputs) {
          setCurrentInputs(parsed.data.inputs)
        }
      })
      .catch(e => console.warn('[scene-upload] inputs dry-run failed:', e.message))
      .finally(() => { if (!cancelled) setInputsLoading(false) })
    return () => { cancelled = true }
  }, [altPosePanelOpen, scene?.id, selectedOutfitId, altPoseAspect])

  // Resolve which image to show as the thumbnail preview.
  // Priority: manual upload > AI-generated alt-pose > scene still.
  // (Lower-priority sources should still be visible when higher-priority
  // ones are cleared, hence the explicit chain rather than e.g. nullish-only.)
  const activeThumbnailPreview =
      thumbnailPreview
   || altPoseCdnUrl
   || scene?.image
   || null

  // Whether the displayed thumbnail is something the user explicitly
  // chose (custom upload or AI gen) — drives the green border + reset
  // button visibility in the box.
  const hasOverrideThumbnail = !!(thumbnailFile || altPoseCdnUrl)

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
      // Thumbnail resolution priority (matches the modal preview):
      //   1. Manual upload (custom file) → compress to base64, server uploads to CF
      //   2. AI alt-pose generation → already a CF URL, server uses by-URL upload
      //   3. Scene still → already an Airtable URL, server uses by-URL upload
      setProgress(thumbnailFile ? 'Compressing thumbnail…' : 'Preparing thumbnail…')
      let thumbnailBase64 = null
      let thumbnailSourceUrl = null
      try {
        if (thumbnailFile) {
          thumbnailBase64 = await compressImageToBase64(thumbnailFile)
        } else if (altPoseCdnUrl) {
          thumbnailSourceUrl = altPoseCdnUrl
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
                onClick={() => !uploading && !altPoseLoading && thumbnailFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); if (!uploading && !altPoseLoading) setDragOverThumbnail(true) }}
                onDragLeave={() => setDragOverThumbnail(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOverThumbnail(false)
                  if (uploading || altPoseLoading) return
                  const file = e.dataTransfer?.files?.[0]
                  if (file) acceptThumbnail(file)
                }}
                style={{
                  position: 'relative',
                  aspectRatio: '9/16',
                  borderRadius: 10,
                  border: `2px dashed ${dragOverThumbnail ? '#6AC68A' : hasOverrideThumbnail ? 'rgba(106,198,138,0.55)' : 'rgba(255,255,255,0.18)'}`,
                  background: dragOverThumbnail ? 'rgba(106,198,138,0.10)' : '#000',
                  cursor: (uploading || altPoseLoading) ? 'wait' : 'pointer',
                  transition: 'all 0.15s',
                  overflow: 'hidden',
                }}>
                {/* Preview fills the whole drop zone so the editor sees
                    exactly what will be used as the For Review / Post
                    thumbnail. Source priority: manual upload > AI alt-pose
                    > scene still. */}
                {activeThumbnailPreview && (
                  <img src={activeThumbnailPreview} alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: dragOverThumbnail || altPoseLoading ? 0.35 : 1, transition: 'opacity 0.15s' }} />
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
                        Custom upload · click to swap
                      </div>
                    </>
                  ) : altPoseCdnUrl ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#C8A8FF', marginBottom: 2 }}>
                        ✨ AI alt pose
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)' }}>
                        Generated · click to upload custom instead
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
                {/* Reset corner — context-aware label depending on what's
                    overriding the scene still. Click swaps back to default.
                    stopPropagation so we don't re-open the file picker. */}
                {hasOverrideThumbnail && !altPoseLoading && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (thumbnailFile) resetThumbnail()
                      else if (altPoseCdnUrl) clearAltPose()
                    }}
                    disabled={uploading}
                    title="Revert to scene still"
                    style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 5, padding: '4px 8px', cursor: uploading ? 'wait' : 'pointer' }}>
                    ↺ Reset
                  </button>
                )}
                {/* Full-cover generating overlay. The thumbnail box is the
                    natural place to show progress since the result lands
                    inside it. */}
                {altPoseLoading && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.55)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    color: '#fff', gap: 8,
                    pointerEvents: 'none',
                  }}>
                    <div style={{ fontSize: 22 }}>✨</div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Generating alt pose…</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', textAlign: 'center', padding: '0 14px' }}>
                      Wan 2.7 · usually 30-60s
                    </div>
                  </div>
                )}
              </div>
              <input
                ref={thumbnailFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                onChange={(e) => acceptThumbnail(e.target.files?.[0])}
                style={{ display: 'none' }}
              />

              {/* Alt-pose generator. Folded down by default; click to
                  expand. Inside: outfit picker (this reel's Selected
                  Outfits), pose direction textarea, optional preview of
                  the inputs Wan saw last gen, Generate button. */}
              {!altPosePanelOpen ? (
                <button
                  type="button"
                  onClick={() => !uploading && !altPoseLoading && openAltPosePanel()}
                  disabled={uploading || altPoseLoading}
                  style={{
                    display: 'block', width: '100%', marginTop: 8,
                    padding: '8px 10px', fontSize: 11, fontWeight: 700,
                    color: '#C8A8FF',
                    background: 'rgba(200,168,255,0.08)',
                    border: '1px solid rgba(200,168,255,0.25)',
                    borderRadius: 6, cursor: (uploading || altPoseLoading) ? 'wait' : 'pointer',
                    textAlign: 'center',
                  }}>
                  ✨ Generate alt pose with Wan 2.7
                </button>
              ) : (
                <div style={{ marginTop: 8, padding: 10, background: 'rgba(200,168,255,0.05)', border: '1px solid rgba(200,168,255,0.20)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* ─── OUTFIT PICKER ─────────────────────────────── */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#C8A8FF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      Pick the outfit for this scene
                    </div>
                    {outfitsLoading ? (
                      <div style={{ fontSize: 11, color: 'var(--foreground-muted)', padding: '8px 0' }}>Loading reel outfits…</div>
                    ) : reelOutfits.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#E87878', padding: '8px 10px', background: 'rgba(232,120,120,0.08)', borderRadius: 4 }}>
                        No outfits attached to this reel yet. Attach outfits in the workflow first, then come back.
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 6 }}>
                        {reelOutfits.map(o => {
                          const isSelected = o.id === selectedOutfitId
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => setSelectedOutfitId(o.id)}
                              disabled={altPoseLoading}
                              title={o.hasFlatlay ? 'Will use flatlay reference' : 'Will use original (no flatlay generated)'}
                              style={{
                                position: 'relative',
                                aspectRatio: '1/1',
                                borderRadius: 5,
                                border: `2px solid ${isSelected ? '#C8A8FF' : 'rgba(255,255,255,0.10)'}`,
                                background: '#000',
                                cursor: altPoseLoading ? 'wait' : 'pointer',
                                overflow: 'hidden',
                                padding: 0,
                              }}>
                              {o.image && (
                                <img src={o.image} alt="" loading="lazy"
                                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              )}
                              {/* Flatlay-ready badge so the editor sees
                                  which outfits have the clean reference */}
                              {!o.hasFlatlay && (
                                <div style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(232,160,160,0.85)', color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 3px', borderRadius: 2 }}>!</div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* ─── ASPECT RATIO ───────────────────────────────────
                      4:5 (default) for IG feed posts, 9:16 for reel /
                      story thumbnails, 3:4 for vertical feed crop,
                      1:1 square. Auto-fires a fresh dryRun on change
                      so the inputs preview reflects what'll be sent. */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#C8A8FF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                      Output aspect
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['1:1', '3:4', '4:5', '9:16'].map(a => (
                        <button key={a}
                          type="button"
                          onClick={() => setAltPoseAspect(a)}
                          disabled={altPoseLoading}
                          style={{
                            flex: 1,
                            padding: '5px 6px',
                            fontSize: 11,
                            fontWeight: 700,
                            background: altPoseAspect === a ? 'rgba(200,168,255,0.25)' : 'rgba(255,255,255,0.04)',
                            color: altPoseAspect === a ? '#C8A8FF' : 'var(--foreground-muted)',
                            border: `1px solid ${altPoseAspect === a ? 'rgba(200,168,255,0.45)' : 'rgba(255,255,255,0.10)'}`,
                            borderRadius: 4,
                            cursor: altPoseLoading ? 'wait' : 'pointer',
                          }}>{a}</button>
                      ))}
                    </div>
                  </div>

                  {/* ─── POSE DIRECTION ─────────────────────────────── */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#C8A8FF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Pose direction <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>(optional)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => posePickerOpen ? setPosePickerOpen(false) : openPosePicker()}
                        disabled={altPoseLoading || poseAnalyzing}
                        title="Pick a pose from the photo library — Claude analyzes it and writes the prompt"
                        style={{ fontSize: 10, fontWeight: 700, color: '#C8A8FF', background: posePickerOpen ? 'rgba(200,168,255,0.20)' : 'rgba(200,168,255,0.08)', border: '1px solid rgba(200,168,255,0.30)', borderRadius: 4, padding: '3px 8px', cursor: (altPoseLoading || poseAnalyzing) ? 'wait' : 'pointer' }}>
                        📸 {posePickerOpen ? 'Hide library' : 'Pick from library'}
                      </button>
                    </div>
                    <textarea
                      value={altPosePrompt}
                      onChange={(e) => setAltPosePrompt(e.target.value)}
                      placeholder={poseAnalyzing
                        ? 'Claude is analyzing the picked pose…'
                        : 'e.g. weight on one hip, hand at waist, body angled, full body framed so legs are visible — leave blank for the default, or pick a reference photo above.'
                      }
                      rows={4}
                      disabled={altPoseLoading || poseAnalyzing}
                      style={{
                        width: '100%', resize: 'vertical', minHeight: 60,
                        padding: '6px 8px', fontSize: 11, lineHeight: 1.4,
                        color: 'var(--foreground)',
                        background: 'rgba(0,0,0,0.35)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 4,
                        fontFamily: 'inherit',
                        opacity: poseAnalyzing ? 0.6 : 1,
                      }}
                    />
                    {/* Pose reference picker — Pinterest library grid.
                        Click a photo → Claude vision describes the pose
                        → textarea fills with the description. Editor can
                        edit before firing the Wan gen. */}
                    {posePickerOpen && (
                      <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5 }}>
                        {posePhotosLoading ? (
                          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textAlign: 'center', padding: '12px 0' }}>
                            Loading Pinterest library…
                          </div>
                        ) : posePhotos.length === 0 ? (
                          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textAlign: 'center', padding: '12px 0' }}>
                            No Pinterest photos in the library yet. Upload some on the Pinterest tab in Photos.
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize: 9, color: 'var(--foreground-muted)', marginBottom: 6, lineHeight: 1.4 }}>
                              {posePhotos.length} Pinterest photo{posePhotos.length === 1 ? '' : 's'} · click to analyze pose
                            </div>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))',
                                gap: 4,
                                maxHeight: 220,
                                overflowY: 'auto',
                                paddingRight: 4,
                              }}>
                              {posePhotos.map(p => {
                                const isSelected = p.id === selectedPoseRefId
                                const isAnalyzingThis = poseAnalyzing && isSelected
                                return (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => !poseAnalyzing && pickPoseRef(p)}
                                    disabled={poseAnalyzing}
                                    title={p.handle || ''}
                                    style={{
                                      position: 'relative',
                                      aspectRatio: '3/4',
                                      borderRadius: 4,
                                      border: `2px solid ${isSelected ? '#C8A8FF' : 'rgba(255,255,255,0.08)'}`,
                                      background: '#000',
                                      cursor: poseAnalyzing ? 'wait' : 'pointer',
                                      overflow: 'hidden',
                                      padding: 0,
                                    }}>
                                    {p.image && (
                                      <img src={p.image} alt="" loading="lazy"
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: isAnalyzingThis ? 0.4 : 1 }} />
                                    )}
                                    {isAnalyzingThis && (
                                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>
                                        ⏳
                                      </div>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ─── INPUTS PREVIEW ─────────────────────────────────
                      Live — refreshes via dryRun whenever scene+outfit
                      changes, so the editor sees EXACTLY what Wan will
                      receive before clicking Generate. Each thumb opens
                      the full-res source in a new tab. */}
                  {(currentInputs || inputsLoading) && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#C8A8FF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                        Images Wan will receive {inputsLoading && <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>· loading…</span>}
                      </div>
                      {currentInputs ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                          {[
                            { url: currentInputs.subjectUrl, label: 'Fig 1 · subject' },
                            {
                              url: currentInputs.roomUrl,
                              // Surface both the room name AND which source
                              // we used (variation matched by TOD vs. parent
                              // base) so drift cases are debuggable in-place.
                              label: `Fig 2 · ${currentInputs.roomName || 'room'}${currentInputs.roomSourceLabel ? ` · ${currentInputs.roomSourceLabel}` : ''}`,
                            },
                            { url: currentInputs.outfitUrl, label: `Fig 3 · outfit (${currentInputs.outfitVariant || '?'})` },
                          ].map((it, i) => (
                            <a key={i} href={it.url} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'block', position: 'relative', aspectRatio: '1/1', borderRadius: 4, overflow: 'hidden', background: '#000', textDecoration: 'none' }}>
                              <img src={it.url} alt="" loading="lazy"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 4px', fontSize: 8, fontWeight: 700, color: '#fff', background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {it.label}
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', lineHeight: 1.4 }}>
                    All 3 refs are full-res Dropbox URLs (canonical source). Output is 4:5 (1080×1350) for IG feed.
                  </div>

                  {altPoseError && (
                    <div style={{ fontSize: 11, color: '#E87878', padding: '4px 6px', background: 'rgba(232,120,120,0.10)', borderRadius: 4 }}>
                      {altPoseError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => { setAltPosePanelOpen(false); setAltPoseError('') }}
                      disabled={altPoseLoading}
                      style={{ flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, cursor: altPoseLoading ? 'wait' : 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={generateAltPose}
                      disabled={altPoseLoading || uploading || !selectedOutfitId}
                      title={!selectedOutfitId ? 'Pick an outfit first' : ''}
                      style={{ flex: 2, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#C8A8FF', background: altPoseLoading ? 'rgba(200,168,255,0.10)' : 'rgba(200,168,255,0.18)', border: '1px solid rgba(200,168,255,0.40)', borderRadius: 5, cursor: (altPoseLoading || !selectedOutfitId) ? 'not-allowed' : 'pointer', opacity: !selectedOutfitId ? 0.55 : 1 }}>
                      {altPoseLoading ? '✨ Generating…' : altPoseCdnUrl ? '✨ Regenerate' : '✨ Generate'}
                    </button>
                  </div>
                </div>
              )}
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
