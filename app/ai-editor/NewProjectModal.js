'use client'

import { useState, useRef } from 'react'
import { buildStreamPosterUrl } from '@/lib/cfStreamUrl'

// Most reels live in Cloudflare Stream — their visible thumbnail is the
// Stream poster derived from streamUid. `r.thumbnail` is only populated
// for a small subset (legacy uploads, manually-set thumbs).
function reelPosterUrl(r, { width = 240 } = {}) {
  if (!r) return null
  if (r.streamUid) return buildStreamPosterUrl(r.streamUid, { width, fit: 'crop' })
  return r.thumbnail || null
}

// New Project Modal — unified entry to the AI editor.
//
// Stages:
//   pick-source-method   — empty source slot, "Pick from Library" or
//                          "Upload from Computer". Drag-drop welcome.
//   pick-source-uploading— local-reel upload progress.
//   pick-reel            — multi-select library grid. Each tile is a
//                          checkbox. Footer button counts the selection
//                          and advances to choose-workflow.
//   choose-workflow      — pick ONE workflow type that applies to ALL
//                          selected reels. Each reel becomes its own
//                          project of that type (N reels = N projects).
//
// Workflow types:
//   Freelance — editor produces final reels in TJP and uploads them
//               from the project card via FreelanceSubmitModal. Project
//               creation = placeholder only, no file picker in this
//               modal.
//   Bedroom   — full portal create-scene flow. Project card next-steps
//               the editor to "upload TJP photo".

export default function NewProjectModal({
  creatorId,
  preselectedReel,
  availableReels = [],
  projectReelIds = new Set(),
  onClose,
  // ({ workflowType, reelIds, navigateReelId? }) — fired once after
  // /start succeeds. Parent refreshes lists; for single-reel Bedroom
  // it also routes to the Create Scene page.
  onStarted,
}) {
  const initialSelected = preselectedReel ? new Map([[preselectedReel.id, preselectedReel]]) : new Map()
  const [selected, setSelected] = useState(initialSelected)
  const [stage, setStage] = useState(preselectedReel ? 'choose-workflow' : 'pick-source-method')

  const [sourceFilter, setSourceFilter] = useState('all')
  const [handleFilter, setHandleFilter] = useState('all')

  const [sourceUpload, setSourceUpload] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const sourceUploadRef = useRef(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')

  const selectedReels = Array.from(selected.values())
  const selectedCount = selected.size
  const toggleSelected = (r) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(r.id)) next.delete(r.id)
      else next.set(r.id, r)
      return next
    })
  }
  const clearSelected = () => setSelected(new Map())

  // ── HELPERS ────────────────────────────────────────────────────────

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
      video.currentTime = Math.min(0.1, video.duration || 0.1)
      await new Promise((res) => { video.onseeked = res })
      const canvas = document.createElement('canvas')
      const maxDim = 720
      const scale = Math.min(maxDim / video.videoWidth, maxDim / video.videoHeight, 1)
      canvas.width = Math.floor(video.videoWidth * scale)
      canvas.height = Math.floor(video.videoHeight * scale)
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      URL.revokeObjectURL(url)
      return dataUrl.split(',')[1] || ''
    } catch (e) {
      console.warn('[NewProjectModal] thumb extract failed:', e.message)
      return ''
    }
  }

  // Source reel direct upload — 3-step direct-to-Dropbox flow. On
  // success, the new reel is pre-selected and we advance to
  // choose-workflow with N=1.
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

      const justUploaded = {
        id: fin.reelRecordId,
        handle: fin.handle || 'editor',
        thumbnail: thumbBase64 ? `data:image/jpeg;base64,${thumbBase64}` : null,
        caption: '',
        addedVia: 'Editor Upload',
        streamUid: null,
      }
      setSelected(prev => {
        const next = new Map(prev)
        next.set(justUploaded.id, justUploaded)
        return next
      })
      setSourceUpload(null)
      setStage('choose-workflow')
    } catch (e) {
      setSourceUpload(s => ({ ...(s || {}), status: 'error', message: e.message }))
    }
  }

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

  // ── /start call — Bedroom and Freelance both go through here ───────

  async function startProjects(workflowType) {
    if (selectedCount === 0) return
    setStarting(true)
    setStartError('')
    try {
      const reelIds = selectedReels.map(r => r.id)
      const res = await fetch('/api/admin/recreate-rooms/stage-b/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, reelRecordIds: reelIds, workflowType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create projects')
      // Bedroom + single reel: route to the Create Scene workflow page so
      // the editor can keep working (matches the legacy "↓ Raw" handoff).
      // For N>1 or Freelance: stay on /ai-editor; project cards appear
      // after refresh.
      const navigateReelId = (workflowType === 'Bedroom' && reelIds.length === 1) ? reelIds[0] : null
      onStarted?.({ workflowType, reelIds, navigateReelId })
      onClose?.()
    } catch (e) {
      setStartError(e.message)
    } finally {
      setStarting(false)
    }
  }

  // ── STAGE: pick-source-method / pick-source-uploading ──────────────

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
                    {dragOver ? 'Drop to upload as the source reel' : 'Pick reels, or drag a video here'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 14 }}>
                    One or many — each reel becomes its own project
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

  // ── STAGE: pick-reel (library picker, multi-select) ────────────────

  if (stage === 'pick-reel') {
    const pickable = availableReels.filter(r => !projectReelIds.has(r.id))
    const adminCount = pickable.filter(r => r.addedVia !== 'Editor Upload').length
    const editorCount = pickable.filter(r => r.addedVia === 'Editor Upload').length

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
              <span>New Project — pick reels</span>
              {selectedCount > 0 && (
                <span style={{ fontSize: 11, color: 'var(--palm-pink)', fontWeight: 600 }}>
                  · {selectedCount} selected
                </span>
              )}
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
              {selectedCount > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between',
                  padding: '8px 18px', background: 'rgba(232,160,160,0.06)',
                  borderTop: '1px solid rgba(232,160,160,0.20)', borderBottom: '1px solid rgba(232,160,160,0.20)',
                }}>
                  <div style={{ fontSize: 12, color: 'var(--foreground)' }}>
                    <strong>{selectedCount}</strong> reel{selectedCount === 1 ? '' : 's'} selected — each becomes its own project
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={clearSelected}
                      style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                      Clear
                    </button>
                    <button onClick={() => setStage('choose-workflow')}
                      style={{
                        padding: '6px 14px', fontSize: 12, fontWeight: 700,
                        background: 'var(--palm-pink)', color: '#fff',
                        border: 'none', borderRadius: 6, cursor: 'pointer',
                      }}>
                      Continue with {selectedCount} →
                    </button>
                  </div>
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
                  overflowY: 'auto',
                  maxHeight: '50vh',
                }}>
                  {filtered.map(r => {
                    const isSelected = selected.has(r.id)
                    return (
                      <button
                        key={r.id}
                        onClick={() => toggleSelected(r)}
                        style={{
                          position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: '#111',
                          border: `2px solid ${isSelected ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 8, padding: 0, cursor: 'pointer',
                          boxShadow: isSelected ? '0 0 0 2px rgba(232,160,160,0.25)' : 'none',
                        }}
                        title={isSelected ? 'Click to unselect' : (r.handle ? `@${r.handle} — click to add` : 'Click to add')}
                      >
                        {(() => {
                          const poster = reelPosterUrl(r, { width: 240 })
                          return poster ? (
                            <img src={poster} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isSelected ? 0.85 : 1 }} />
                          ) : null
                        })()}
                        <div style={{
                          position: 'absolute', top: 4, right: 4,
                          width: 20, height: 20, borderRadius: '50%',
                          background: isSelected ? 'var(--palm-pink)' : 'rgba(0,0,0,0.5)',
                          border: `1px solid ${isSelected ? 'var(--palm-pink)' : 'rgba(255,255,255,0.4)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: '#fff',
                        }}>{isSelected ? '✓' : ''}</div>
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
                    )
                  })}
                </div>
              )}
              <div style={{
                padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.06)',
                fontSize: 11, color: 'var(--foreground-subtle)',
              }}>
                Tip: drag a video file anywhere on this modal to upload a brand-new reel as a source.
              </div>
            </>
          )}
        </Panel>
      </Backdrop>
    )
  }

  // ── STAGE: choose-workflow (the moment of project creation) ────────

  return (
    <Backdrop onClose={!starting ? onClose : null}>
      <Panel>
        <Header onClose={!starting ? onClose : null}>
          New Project{selectedCount > 1 ? ` × ${selectedCount}` : ''}
        </Header>

        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {selectedCount === 1 ? 'Source reel' : `${selectedCount} source reels`}
          </div>
          {selectedCount === 1 ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {(() => {
                const r = selectedReels[0]
                const poster = reelPosterUrl(r, { width: 160 })
                return poster ? (
                  <img src={poster} alt="" style={{ width: 50, height: 80, objectFit: 'cover', borderRadius: 4, background: '#000', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 50, height: 80, background: '#222', borderRadius: 4, flexShrink: 0 }} />
                )
              })()}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  @{selectedReels[0].handle || 'reel'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                  {(selectedReels[0].caption || selectedReels[0].url || '').slice(0, 80) || (selectedReels[0].addedVia === 'Editor Upload' ? 'Local upload' : '')}
                </div>
              </div>
              {!preselectedReel && (
                <button
                  onClick={() => { clearSelected(); setStage('pick-source-method') }}
                  style={{
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.10)',
                    color: 'var(--foreground-muted)', fontSize: 11, padding: '4px 10px',
                    borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                  }}
                  title="Pick different reels">
                  Change
                </button>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', overflowY: 'auto', maxHeight: 140 }}>
                {selectedReels.map(r => {
                  const poster = reelPosterUrl(r, { width: 120 })
                  return (
                    <div key={r.id} title={`@${r.handle || 'reel'}`}
                      style={{ position: 'relative', width: 40, height: 64, borderRadius: 3, overflow: 'hidden', background: '#222', flexShrink: 0 }}>
                      {poster && <img src={poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--foreground-muted)' }}>
                Each reel becomes its own project of the type you pick below.
              </div>
              {!preselectedReel && (
                <button
                  onClick={() => setStage('pick-reel')}
                  style={{
                    marginTop: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.10)',
                    color: 'var(--foreground-muted)', fontSize: 11, padding: '5px 12px',
                    borderRadius: 6, cursor: 'pointer',
                  }}>
                  ← Adjust selection
                </button>
              )}
            </>
          )}
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 14 }}>
            How {selectedCount === 1 ? 'is this project produced' : `are these ${selectedCount} projects produced`}?
            {selectedCount > 1 && <> All {selectedCount} get the same type.</>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <WorkflowButton
              title={`Freelance${selectedCount > 1 ? ` × ${selectedCount}` : ''}`}
              description={
                selectedCount === 1
                  ? 'Editor produces the final reel anywhere (TJP, custom edits, freelance). The project card will show ↑ Upload final reels — no portal scene step.'
                  : `Create ${selectedCount} freelance projects. Each card shows ↑ Upload final reels — editor uploads from there when finished.`
              }
              accent="palm-pink"
              disabled={starting || selectedCount === 0}
              onClick={() => startProjects('Freelance')}
            />
            <WorkflowButton
              title={`Bedroom Content${selectedCount > 1 ? ` × ${selectedCount}` : ''}`}
              description={
                selectedCount === 1
                  ? 'Full portal flow — frame extractor, image-to-image in TJP, scene generation, outfit/motion step, upload back. Use when the portal injects the creator into a saved bedroom scene.'
                  : `Create ${selectedCount} Bedroom Content projects. Each starts at the Need TJP photo step.`
              }
              disabled={starting || selectedCount === 0}
              onClick={() => startProjects('Bedroom')}
            />
          </div>
          {starting && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--foreground-muted)' }}>
              Creating {selectedCount} project{selectedCount === 1 ? '' : 's'}…
            </div>
          )}
          {startError && (
            <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>
              {startError}
            </div>
          )}
        </div>
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

function WorkflowButton({ title, description, onClick, accent, disabled }) {
  const isPink = accent === 'palm-pink'
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        textAlign: 'left', padding: '14px 16px',
        background: isPink ? 'rgba(232,160,160,0.10)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isPink ? 'var(--palm-pink)' : 'rgba(255,255,255,0.10)'}`,
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: isPink ? 'var(--palm-pink)' : 'var(--foreground)', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: 'var(--foreground-muted)', lineHeight: 1.45 }}>
        {description}
      </div>
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
        background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
        width: '100%', maxWidth: wide ? 760 : 460, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
      {children}
    </div>
  )
}

function Header({ children, onClose }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      fontSize: 14, fontWeight: 700, color: 'var(--foreground)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
      {onClose && (
        <button onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 18, cursor: 'pointer', padding: 0 }}>
          ×
        </button>
      )}
    </div>
  )
}
