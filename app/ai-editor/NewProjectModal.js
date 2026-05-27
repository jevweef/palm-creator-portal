'use client'

import { useState, useRef } from 'react'
import { buildStreamPosterUrl } from '@/lib/cfStreamUrl'

// Most reels live in Cloudflare Stream — their visible thumbnail is the
// Stream poster derived from streamUid. `r.thumbnail` is only populated
// for a small subset (legacy uploads, manually-set thumbs). Match the
// outside ReelCard fallback chain: streamUid → r.thumbnail → null.
function reelPosterUrl(r, { width = 240 } = {}) {
  if (!r) return null
  if (r.streamUid) return buildStreamPosterUrl(r.streamUid, { width, fit: 'crop' })
  return r.thumbnail || null
}

// New Project Modal — unified entry for both AI editor workflows.
//
// Stages:
//   pick-source-method  — empty source slot with two CTAs ("Pick from
//                         Library" / "Upload from Computer") + drag-drop
//                         drop zone. Initial when no preselected reel.
//   pick-source-uploading — local-reel upload in flight; same panel,
//                         drop zone replaced by progress lines.
//   pick-reel           — library grid + source-type chips + handle
//                         chips. Reached from pick-source-method's
//                         "Pick from Library" button.
//   choose-workflow     — Bedroom Content vs Direct Upload. Reached
//                         when a reel is attached (preselected, picked
//                         from library, or just uploaded).
//   direct-upload-config / direct-upload-progress — multi-file Direct
//                         Upload path (one review item per video, all
//                         tied to the source reel).
//
// Direct Upload thumbnails are auto-extracted from the first video
// frame via canvas — manual thumbnail picking ×N would be tedious,
// and Stream's mirror replaces them with proper posters anyway.

export default function NewProjectModal({ creatorId, preselectedReel, availableReels = [], projectReelIds = new Set(), onClose, onChooseBedroom, onDirectUploadDone }) {
  const [reel, setReel] = useState(preselectedReel || null)
  const [stage, setStage] = useState(preselectedReel ? 'choose-workflow' : 'pick-source-method')

  // Picker filters — source-type chips intersect with handle chips.
  const [sourceFilter, setSourceFilter] = useState('all')
  const [handleFilter, setHandleFilter] = useState('all')

  // Source-reel upload (the "Upload from Computer" path in
  // pick-source-method). Independent of the Direct Upload progress.
  const [sourceUpload, setSourceUpload] = useState(null) // { status, fileName, message }
  const [dragOver, setDragOver] = useState(false)
  const sourceUploadRef = useRef(null)

  // Direct Upload state (per-file finished AI videos for an existing reel).
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState({}) // file.name → { status, message }
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  // ── HELPERS ────────────────────────────────────────────────────────────

  // Extract a base64 JPEG from the first decodable frame of a video file.
  // Used both for Direct Upload thumbnails AND as the placeholder thumb
  // for a freshly-uploaded source reel (Stream mirror replaces it ~30s later).
  async function extractFirstFrameBase64(file) {
    try {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.src = url
      await new Promise((res, rej) => {
        video.onloadeddata = res
        video.onerror = rej
      })
      // Seek a hair into the file — some encoders have a blank first frame.
      video.currentTime = Math.min(0.1, video.duration || 0.1)
      await new Promise((res) => { video.onseeked = res })
      const canvas = document.createElement('canvas')
      const maxDim = 720
      const scale = Math.min(maxDim / video.videoWidth, maxDim / video.videoHeight, 1)
      canvas.width = Math.floor(video.videoWidth * scale)
      canvas.height = Math.floor(video.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      URL.revokeObjectURL(url)
      return dataUrl.split(',')[1] || ''
    } catch (e) {
      console.warn('[NewProjectModal] thumb extract failed:', e.message)
      return ''
    }
  }

  // Local reel upload — same 3-step direct-to-Dropbox flow as the
  // outside "↑ Upload inspo" button. On success, the new reel becomes
  // this project's source and we advance to workflow choice.
  async function runLocalReelUpload(file) {
    if (!file?.type?.startsWith('video/')) {
      setStage('pick-source-uploading')
      setSourceUpload({ status: 'error', fileName: file?.name || '', message: 'Need a video file (mp4, mov, webm)' })
      return
    }
    setStage('pick-source-uploading')
    setSourceUpload({ status: 'extracting-thumb', fileName: file.name, message: 'Extracting thumbnail…' })
    const thumbBase64 = await extractFirstFrameBase64(file)

    try {
      setSourceUpload(s => ({ ...s, status: 'token', message: 'Requesting Dropbox token…' }))
      const tokRes = await fetch('/api/ai-editor/upload-local-reel/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      })
      const tok = await tokRes.json()
      if (!tokRes.ok) throw new Error(tok.error || 'Could not get upload token')

      setSourceUpload(s => ({ ...s, status: 'dropbox', message: `Uploading ${(file.size / (1024*1024)).toFixed(1)} MB to Dropbox…` }))
      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: tok.path, mode: 'overwrite', mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: await file.arrayBuffer(),
      })
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed (${dbxRes.status})`)

      setSourceUpload(s => ({ ...s, status: 'finalize', message: 'Creating reel record…' }))
      const finRes = await fetch('/api/ai-editor/upload-local-reel/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxPath: tok.path, shortid: tok.shortid, caption: '' }),
      })
      const fin = await finRes.json()
      if (!finRes.ok) throw new Error(fin.error || 'Finalize failed')

      // Construct a reel object good enough for the in-modal preview +
      // downstream Bedroom/Direct Upload handoff. Stream UID lands
      // ~30s later via mirror cron — irrelevant once modal closes.
      setReel({
        id: fin.reelRecordId,
        handle: fin.handle || 'editor',
        thumbnail: thumbBase64 ? `data:image/jpeg;base64,${thumbBase64}` : null,
        caption: '',
        addedVia: 'Editor Upload',
        streamUid: null,
      })
      setSourceUpload(null)
      setStage('choose-workflow')
    } catch (e) {
      setSourceUpload(s => ({ ...(s || {}), status: 'error', message: e.message }))
    }
  }

  // Drag-drop handlers shared between pick-source-method + pick-reel —
  // dropping a video anywhere on either stage runs the local upload.
  function onPanelDragOver(e) {
    if (stage === 'pick-source-uploading') return
    e.preventDefault()
    setDragOver(true)
  }
  function onPanelDragLeave() {
    setDragOver(false)
  }
  function onPanelDrop(e) {
    if (stage === 'pick-source-uploading') return
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) runLocalReelUpload(f)
  }

  // ── STAGE: pick-source-method / pick-source-uploading ────────────────

  if (stage === 'pick-source-method' || stage === 'pick-source-uploading') {
    const uploading = stage === 'pick-source-uploading'
    const closable = !uploading || sourceUpload?.status === 'error'
    return (
      <Backdrop onClose={closable ? onClose : null}>
        <Panel onDragOver={onPanelDragOver} onDragLeave={onPanelDragLeave} onDrop={onPanelDrop}>
          <Header onClose={closable ? onClose : null}>New Project</Header>
          <div style={{ padding: 18 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>Source reel</div>
            <div style={{
              border: `2px dashed ${dragOver ? '#6AC68A' : 'rgba(255,255,255,0.18)'}`,
              background: dragOver ? 'rgba(106,198,138,0.10)' : 'rgba(255,255,255,0.03)',
              borderRadius: 10,
              padding: '28px 18px',
              textAlign: 'center',
              transition: '0.15s ease',
            }}>
              {uploading ? (
                <SourceUploadProgress
                  state={sourceUpload}
                  onRetry={() => { setSourceUpload(null); setStage('pick-source-method') }}
                />
              ) : (
                <>
                  <div style={{ fontSize: 34, marginBottom: 6 }}>{dragOver ? '⬇️' : '📥'}</div>
                  <div style={{ fontSize: 13, color: 'var(--foreground)', marginBottom: 4 }}>
                    {dragOver ? 'Drop to upload as the source reel' : 'Drag a video here, or choose a source'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 14 }}>
                    The picked or uploaded reel becomes the source for this project
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setStage('pick-reel')}
                      style={{
                        padding: '9px 16px', fontSize: 12, fontWeight: 700,
                        background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)',
                        border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'pointer',
                      }}>📚 Pick from Library</button>
                    <button
                      onClick={() => sourceUploadRef.current?.click()}
                      style={{
                        padding: '9px 16px', fontSize: 12, fontWeight: 700,
                        background: 'rgba(200,168,255,0.10)', color: '#C8A8FF',
                        border: '1px solid rgba(200,168,255,0.35)', borderRadius: 6, cursor: 'pointer',
                      }}>⬆️ Upload from Computer</button>
                    <input
                      ref={sourceUploadRef}
                      type="file"
                      accept="video/*"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) runLocalReelUpload(f) }}
                      style={{ display: 'none' }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </Panel>
      </Backdrop>
    )
  }

  // ── STAGE: pick-reel (library picker) ────────────────────────────────

  if (stage === 'pick-reel') {
    // Skip reels already used by a project. Same rule the inspo grid uses.
    const pickable = availableReels.filter(r => !projectReelIds.has(r.id))
    const adminCount = pickable.filter(r => r.addedVia !== 'Editor Upload').length
    const editorCount = pickable.filter(r => r.addedVia === 'Editor Upload').length

    // Source filter narrows by added-via; handle filter intersects.
    const afterSource = sourceFilter === 'all'
      ? pickable
      : sourceFilter === 'editor'
        ? pickable.filter(r => r.addedVia === 'Editor Upload')
        : pickable.filter(r => r.addedVia !== 'Editor Upload')
    const handleCounts = afterSource.reduce((m, r) => {
      const h = (r.handle || '—').trim() || '—'
      m[h] = (m[h] || 0) + 1
      return m
    }, {})
    const handles = Object.entries(handleCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    // If the active handle was filtered out by a source-type change,
    // silently fall back to "all" so we don't show an empty grid.
    const effectiveHandleFilter = handleFilter !== 'all' && !handleCounts[handleFilter] ? 'all' : handleFilter
    const filtered = effectiveHandleFilter === 'all'
      ? afterSource
      : afterSource.filter(r => (r.handle || '—').trim() === effectiveHandleFilter || (effectiveHandleFilter === '—' && !r.handle))

    const SOURCE_CHIPS = [
      { key: 'all',    label: 'All',            count: pickable.length },
      { key: 'admin',  label: 'Admin added',    count: adminCount },
      { key: 'editor', label: 'Editor uploads', count: editorCount },
    ]

    return (
      <Backdrop onClose={onClose}>
        <Panel wide onDragOver={onPanelDragOver} onDragLeave={onPanelDragLeave} onDrop={onPanelDrop}>
          <Header onClose={onClose}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setStage('pick-source-method')}
                style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                ← Back
              </button>
              <span>New Project — pick a reel</span>
            </div>
          </Header>
          {pickable.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-muted)', fontSize: 13 }}>
              No available reels for this creator. Drop a video on this modal, or use
              {' '}<button onClick={() => setStage('pick-source-method')}
                style={{ background: 'none', border: 'none', color: 'var(--palm-pink)', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>
                Upload from Computer
              </button> to add one.
            </div>
          ) : (
            <>
              {/* Source-type chips */}
              <div style={{ display: 'flex', gap: 6, padding: '12px 18px 6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Source</span>
                {SOURCE_CHIPS.map(c => {
                  const disabled = c.count === 0 && c.key !== 'all'
                  return (
                    <Chip
                      key={c.key}
                      label={c.label}
                      count={c.count}
                      active={sourceFilter === c.key}
                      disabled={disabled}
                      onClick={() => setSourceFilter(c.key)}
                    />
                  )
                })}
                <button
                  onClick={() => sourceUploadRef.current?.click()}
                  style={{
                    marginLeft: 'auto', padding: '5px 11px', fontSize: 11, fontWeight: 700,
                    background: 'rgba(200,168,255,0.10)', color: '#C8A8FF',
                    border: '1px solid rgba(200,168,255,0.35)', borderRadius: 999, cursor: 'pointer',
                  }}>
                  ⬆️ Upload from Computer
                </button>
                <input
                  ref={sourceUploadRef}
                  type="file"
                  accept="video/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) runLocalReelUpload(f) }}
                  style={{ display: 'none' }}
                />
              </div>
              {/* Handle chips — only show when there are 2+ handles to pick between */}
              {handles.length >= 2 && (
                <div style={{ display: 'flex', gap: 6, padding: '0 18px 10px', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Handle</span>
                  <Chip
                    label="All handles"
                    count={afterSource.length}
                    active={effectiveHandleFilter === 'all'}
                    onClick={() => setHandleFilter('all')}
                  />
                  {handles.map(([h, count]) => (
                    <Chip
                      key={h}
                      label={`@${h}`}
                      count={count}
                      active={effectiveHandleFilter === h}
                      onClick={() => setHandleFilter(h)}
                    />
                  ))}
                </div>
              )}
              {filtered.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-muted)', fontSize: 12 }}>
                  No reels match these filters.
                  {' '}<button onClick={() => { setSourceFilter('all'); setHandleFilter('all') }}
                    style={{ background: 'none', border: 'none', color: 'var(--palm-pink)', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 12 }}>
                    Clear filters
                  </button>.
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                  padding: 14,
                }}>
                  {filtered.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { setReel(r); setStage('choose-workflow') }}
                      style={{
                        position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: '#111',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 0, cursor: 'pointer',
                      }}
                      title={r.handle ? `@${r.handle}` : 'Pick this reel'}
                    >
                      {(() => {
                        const poster = reelPosterUrl(r, { width: 240 })
                        return poster ? (
                          <img src={poster} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : null
                      })()}
                      <div style={{
                        position: 'absolute', bottom: 4, left: 4, right: 4,
                        padding: '3px 6px', fontSize: 10, fontWeight: 600,
                        background: 'rgba(0,0,0,0.65)', color: '#fff', borderRadius: 3,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        @{r.handle || '—'}
                      </div>
                      {r.addedVia === 'Editor Upload' && (
                        <div style={{
                          position: 'absolute', top: 4, left: 4,
                          padding: '1px 6px', fontSize: 9, fontWeight: 700,
                          background: 'rgba(200,168,255,0.85)', color: '#1a0a0a', borderRadius: 3,
                        }}>EDITOR</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div style={{
                padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.06)',
                fontSize: 11, color: 'var(--foreground-subtle)',
              }}>
                Tip: drag a video file anywhere on this modal to upload a brand-new reel as the source.
              </div>
            </>
          )}
        </Panel>
      </Backdrop>
    )
  }

  // ── DIRECT UPLOAD HELPERS ───────────────────────────────────────────────

  // Run the full 3-step upload for ONE video file: get Dropbox token →
  // upload bytes to Dropbox → call finalize to create Asset+Task.
  // Returns { ok, error } per file. Each upload is independent.
  async function uploadOneFile(file) {
    setProgress(p => ({ ...p, [file.name]: { status: 'extracting-thumb', message: 'Extracting thumbnail…' } }))
    const thumbnailBase64 = await extractFirstFrameBase64(file)

    setProgress(p => ({ ...p, [file.name]: { status: 'token', message: 'Requesting Dropbox token…' } }))
    const tokRes = await fetch('/api/ai-editor/upload-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reelRecordId: reel.id, slug: null }),
    })
    const tok = await tokRes.json()
    if (!tokRes.ok) return { ok: false, error: tok.error || 'Could not get upload token' }

    setProgress(p => ({ ...p, [file.name]: { status: 'dropbox', message: 'Uploading to Dropbox…' } }))
    const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: tok.path,
          mode: 'overwrite',
          mute: true,
        }),
        'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
        'Content-Type': 'application/octet-stream',
      },
      body: await file.arrayBuffer(),
    })
    if (!dbxRes.ok) return { ok: false, error: `Dropbox upload failed (${dbxRes.status})` }

    setProgress(p => ({ ...p, [file.name]: { status: 'finalize', message: 'Creating review task…' } }))
    const finRes = await fetch('/api/ai-editor/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reelRecordId: reel.id,
        creatorId,
        dropboxPath: tok.path,
        thumbnailBase64,
        slug: null,
      }),
    })
    const data = await finRes.json()
    if (!finRes.ok) return { ok: false, error: data.error || 'Finalize failed' }

    setProgress(p => ({ ...p, [file.name]: { status: 'done', message: 'Submitted' } }))
    return { ok: true }
  }

  async function runDirectUpload() {
    setStage('direct-upload-progress')
    setError('')

    // Run uploads in parallel. Each is independent; the reel's
    // "Produced For" stamping is idempotent on the server (the same
    // creator linked multiple times still resolves to one link).
    const results = await Promise.all(files.map(uploadOneFile))
    const failures = results
      .map((r, i) => ({ r, file: files[i] }))
      .filter(x => !x.r.ok)

    if (failures.length === 0) {
      onDirectUploadDone({ uploadedCount: results.length, reelId: reel.id })
      onClose()
    } else if (failures.length === results.length) {
      setError(`All ${failures.length} uploads failed. First error: ${failures[0].r.error}`)
    } else {
      // Partial — show the per-file status, let operator close + retry the failed ones.
      setError(`${results.length - failures.length} of ${results.length} uploaded. ${failures.length} failed — see per-file status above.`)
    }
  }

  // ── RENDER: choose-workflow / direct-upload-config / direct-upload-progress ─

  return (
    <Backdrop onClose={stage !== 'direct-upload-progress' ? onClose : null}>
      <Panel>
        <Header onClose={stage !== 'direct-upload-progress' ? onClose : null}>
          New Project
        </Header>

        {/* Source reel preview — always visible once a reel is attached. */}
        <div style={{ padding: '14px 18px 0', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 14 }}>
          {(() => {
            const poster = reelPosterUrl(reel, { width: 160 })
            return poster ? (
              <img src={poster} alt="" style={{ width: 50, height: 80, objectFit: 'cover', borderRadius: 4, background: '#000', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 50, height: 80, background: '#222', borderRadius: 4, flexShrink: 0 }} />
            )
          })()}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Source reel</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
              @{reel.handle || 'reel'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
              {(reel.caption || reel.url || '').slice(0, 80) || (reel.addedVia === 'Editor Upload' ? 'Local upload' : '')}
            </div>
          </div>
          {/* Allow swapping the source reel before committing to a workflow.
              Once you're past Direct Upload config the operator is committed. */}
          {stage === 'choose-workflow' && !preselectedReel && (
            <button
              onClick={() => { setReel(null); setStage('pick-source-method') }}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.10)',
                color: 'var(--foreground-muted)', fontSize: 11, padding: '4px 10px',
                borderRadius: 6, cursor: 'pointer', flexShrink: 0,
              }}
              title="Pick a different source reel">
              Change
            </button>
          )}
        </div>

        {/* Stage 1: choose workflow */}
        {stage === 'choose-workflow' && (
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 14 }}>
              How are you producing the AI content for this reel?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <WorkflowButton
                title="Bedroom Content"
                description="Full TJP workflow — frame extractor, image-to-image, creator injection into a saved bedroom scene. Use when you need to swap the creator into your own setting."
                onClick={() => { onChooseBedroom(reel); onClose() }}
              />
              <WorkflowButton
                title="Direct Upload"
                description="Skip Create Scene — you already have one or more finished AI videos. Each video becomes its own review item, all tied to this source reel."
                accent="palm-pink"
                onClick={() => setStage('direct-upload-config')}
              />
            </div>
          </div>
        )}

        {/* Stage 2: direct-upload file picker */}
        {stage === 'direct-upload-config' && (
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>
              Pick one or more finished AI videos. Each will become its own review item.
            </div>
            <div style={{
              border: '1px dashed rgba(255,255,255,0.18)',
              borderRadius: 10,
              padding: files.length ? 12 : 28,
              textAlign: files.length ? 'left' : 'center',
              background: 'rgba(255,255,255,0.02)',
              cursor: files.length ? 'default' : 'pointer',
            }} onClick={() => !files.length && fileInputRef.current?.click()}>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                onChange={e => setFiles(Array.from(e.target.files || []))}
                style={{ display: 'none' }}
              />
              {files.length === 0 ? (
                <div>
                  <div style={{ fontSize: 30, marginBottom: 8 }}>📦</div>
                  <div style={{ fontSize: 13, color: 'var(--foreground)' }}>Click to select videos</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>One or many — each becomes its own review item</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{files.length} file{files.length === 1 ? '' : 's'} selected</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {files.map((f, i) => (
                      <li key={i} style={{ fontSize: 12, color: 'var(--foreground)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                        <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>{(f.size / (1024*1024)).toFixed(1)} MB</span>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => { setFiles([]); fileInputRef.current.value = '' }}
                    style={{ marginTop: 10, background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                    Pick different files
                  </button>
                </div>
              )}
            </div>
            {error && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStage('choose-workflow')}
                style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer' }}>
                ← Back
              </button>
              <button
                onClick={runDirectUpload}
                disabled={files.length === 0}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 700,
                  background: files.length ? 'var(--palm-pink)' : 'rgba(255,255,255,0.06)',
                  color: files.length ? '#fff' : 'var(--foreground-muted)',
                  border: 'none', borderRadius: 6,
                  cursor: files.length ? 'pointer' : 'not-allowed',
                }}>
                Submit {files.length || ''} for review
              </button>
            </div>
          </div>
        )}

        {/* Stage 3: progress */}
        {stage === 'direct-upload-progress' && (
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>
              Uploading {files.length} file{files.length === 1 ? '' : 's'}…
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map(f => {
                const p = progress[f.name] || { status: 'queued', message: 'Queued' }
                const done = p.status === 'done'
                const failed = p.status === 'error'
                return (
                  <li key={f.name} style={{
                    padding: '8px 10px', borderRadius: 6,
                    background: done ? 'rgba(106,198,138,0.06)' : failed ? 'rgba(232,120,120,0.06)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${done ? 'rgba(106,198,138,0.30)' : failed ? 'rgba(232,120,120,0.30)' : 'rgba(255,255,255,0.06)'}`,
                    fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--foreground)' }}>{f.name}</span>
                      <span style={{ color: done ? '#6AC68A' : failed ? '#E87878' : 'var(--foreground-muted)', flexShrink: 0 }}>{done ? '✓' : failed ? '⨯' : '…'}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--foreground-subtle)', marginTop: 2 }}>{p.message}</div>
                  </li>
                )
              })}
            </ul>
            {error && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>
                {error}
              </div>
            )}
            {error && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={onClose} style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: 700,
                  background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)',
                  border: '1px solid rgba(255,255,255,0.10)', borderRadius: 6, cursor: 'pointer',
                }}>Close</button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </Backdrop>
  )
}

// ── PRESENTATIONAL HELPERS ────────────────────────────────────────────

function SourceUploadProgress({ state, onRetry }) {
  const failed = state?.status === 'error'
  const icon = failed ? '⨯' : state?.status === 'done' ? '✓' : '…'
  const color = failed ? '#E87878' : state?.status === 'done' ? '#6AC68A' : 'var(--foreground-muted)'
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--foreground)', marginBottom: 6, display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
        <span style={{ color, fontSize: 16, fontWeight: 700 }}>{icon}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>
          {state?.fileName || 'Uploading…'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: failed ? '#E87878' : 'var(--foreground-muted)' }}>
        {state?.message || 'Working…'}
      </div>
      {failed && (
        <button onClick={onRetry}
          style={{
            marginTop: 12, padding: '7px 14px', fontSize: 12, fontWeight: 700,
            background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'pointer',
          }}>Try a different file</button>
      )}
    </div>
  )
}

function Chip({ label, count, active, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
        background: active ? 'rgba(232,160,160,0.10)' : 'rgba(255,255,255,0.03)',
        color: active ? 'var(--palm-pink)' : (disabled ? '#555' : '#aaa'),
        border: `1px solid ${active ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}>
      {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
    </button>
  )
}

function Backdrop({ children, onClose }) {
  return (
    <div
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {children}
    </div>
  )
}

function Panel({ children, wide, onDragOver, onDragLeave, onDrop }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        // 'wide' = the picker view, which needs room for a reel grid.
        width: wide ? 'min(880px, 95vw)' : 'min(560px, 95vw)',
        background: 'var(--card-bg-solid, #16161c)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'auto',
      }}>
      {children}
    </div>
  )
}

function Header({ children, onClose }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{children}</div>
      {onClose && (
        <button onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 18, cursor: 'pointer', padding: '0 6px' }}>
          ×
        </button>
      )}
    </div>
  )
}

function WorkflowButton({ title, description, accent, onClick }) {
  const isAccent = accent === 'palm-pink'
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        background: isAccent ? 'rgba(232,160,160,0.06)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isAccent ? 'rgba(232,160,160,0.30)' : 'rgba(255,255,255,0.10)'}`,
        borderRadius: 10,
        cursor: 'pointer',
        color: 'var(--foreground)',
        transition: '0.15s ease',
      }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: isAccent ? 'var(--palm-pink)' : 'var(--foreground)' }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4, lineHeight: 1.4 }}>{description}</div>
    </button>
  )
}
