'use client'

import { useState, useRef, useEffect } from 'react'

// New Project Modal — unified entry for both AI editor workflows.
// Today this is Phase A1: preselected reel only. Phase A2 will add a
// library picker + drag-drop local-reel upload for the no-preselect case.
//
// Workflows:
//   "Bedroom Content" — triggers the existing scene-creation flow. Click
//     just closes the modal with onChooseBedroom() — the parent decides what
//     to do (typically open the existing Create Scene tab with the reel).
//   "Direct Upload" — bypass Create Scene entirely. Multi-file picker
//     uploads N final videos, each becomes its own review item all tied to
//     the source reel. Thumbnails are auto-extracted from the first frame
//     of each video via canvas (no manual thumbnail picking).
//
// Why auto-extracted thumbnails: the existing single-file upload requires
// a manual thumbnail pick which would be tedious × N. Auto-extract is good
// enough — admin can re-pick frames in Post Prep if needed. Stream's own
// thumbnail pipeline replaces it after mirror-stream cron runs anyway.

export default function NewProjectModal({ creatorId, preselectedReel, availableReels = [], projectReelIds = new Set(), onClose, onChooseBedroom, onDirectUploadDone }) {
  // Selected reel state — seeded from the preselect prop, mutable via the
  // picker when there's no preselect. Once a reel is picked the modal
  // moves into the workflow-choice stage just like the preselect path.
  const [reel, setReel] = useState(preselectedReel || null)
  const [stage, setStage] = useState(preselectedReel ? 'choose-workflow' : 'pick-reel')
  // Filter chips inside the picker — same shape as the inspo grid chips.
  const [sourceFilter, setSourceFilter] = useState('all')
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState({}) // file.name → { status, message }
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  // Picker view — when no preselected reel + we have an available pool.
  if (stage === 'pick-reel') {
    // Same filtering rules as the inspo grid: skip reels already in a project.
    const pickable = availableReels.filter(r => !projectReelIds.has(r.id))
    const adminCount = pickable.filter(r => r.addedVia !== 'Editor Upload').length
    const editorCount = pickable.filter(r => r.addedVia === 'Editor Upload').length
    const filtered = sourceFilter === 'all'
      ? pickable
      : sourceFilter === 'editor'
        ? pickable.filter(r => r.addedVia === 'Editor Upload')
        : pickable.filter(r => r.addedVia !== 'Editor Upload')

    const CHIPS = [
      { key: 'all',    label: 'All',            count: pickable.length },
      { key: 'admin',  label: 'Admin added',    count: adminCount },
      { key: 'editor', label: 'Editor uploads', count: editorCount },
    ]

    return (
      <Backdrop onClose={onClose}>
        <Panel wide>
          <Header onClose={onClose}>New Project — pick a reel</Header>
          {pickable.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-muted)', fontSize: 13 }}>
              No available reels for this creator. Add some from the Inspo Board first (↑ Upload inspo
              in the Fresh Inspo grid, or have an admin scrape a source).
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                {CHIPS.map(c => {
                  const disabled = c.count === 0 && c.key !== 'all'
                  return (
                    <button
                      key={c.key}
                      onClick={() => setSourceFilter(c.key)}
                      disabled={disabled}
                      style={{
                        padding: '5px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
                        background: sourceFilter === c.key ? 'rgba(232,160,160,0.10)' : 'rgba(255,255,255,0.03)',
                        color: sourceFilter === c.key ? 'var(--palm-pink)' : (disabled ? '#555' : '#aaa'),
                        border: `1px solid ${sourceFilter === c.key ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 999,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >
                      {c.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{c.count}</span>
                    </button>
                  )
                })}
              </div>
              {filtered.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--foreground-muted)', fontSize: 12 }}>
                  No {sourceFilter === 'editor' ? 'editor-uploaded' : 'admin-added'} reels for this creator.
                  {' '}<button onClick={() => setSourceFilter('all')} style={{ background: 'none', border: 'none', color: 'var(--palm-pink)', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 12 }}>Show all</button>.
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
                      {r.thumbnail ? (
                        <img src={r.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : null}
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
                Don't see the reel you want? Close this and upload one via <strong>↑ Upload inspo</strong> on the inspo grid. Drag-drop upload inside this modal ships next.
              </div>
            </>
          )}
        </Panel>
      </Backdrop>
    )
  }

  // ── DIRECT UPLOAD HELPERS ───────────────────────────────────────────────

  // Extract a base64 JPEG from the first decodable frame of a video file.
  // Used as the auto-thumbnail. Resolves to empty string if extraction
  // fails (server-side Stream pipeline will fill in a real thumb later).
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

  // ── RENDER ──────────────────────────────────────────────────────────────

  return (
    <Backdrop onClose={stage !== 'direct-upload-progress' ? onClose : null}>
      <Panel>
        <Header onClose={stage !== 'direct-upload-progress' ? onClose : null}>
          New Project
        </Header>

        {/* Source reel preview — always visible. */}
        <div style={{ padding: '14px 18px 0', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 14 }}>
          {reel.thumbnail ? (
            <img src={reel.thumbnail} alt="" style={{ width: 50, height: 80, objectFit: 'cover', borderRadius: 4, background: '#000', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 50, height: 80, background: '#222', borderRadius: 4, flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Source reel</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
              @{reel.handle || 'reel'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
              {(reel.caption || reel.url || '').slice(0, 80)}
            </div>
          </div>
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

function Backdrop({ children, onClose }) {
  return (
    <div
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {children}
    </div>
  )
}

function Panel({ children, wide }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
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
