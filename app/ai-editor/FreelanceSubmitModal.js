'use client'

import { useState, useRef } from 'react'
import { buildStreamPosterUrl } from '@/lib/cfStreamUrl'

// Freelance submit modal — opened from a Freelance project card's
// "↑ Upload final reels" CTA. The editor produced one or more finished
// AI videos in TJP (or anywhere else); each file becomes its own review
// item under the same source reel + project.
//
// Flow:
//   1. Editor drops 1+ video files (drag-drop or file picker)
//   2. Modal shows the list + a single "Submit N for review" button
//   3. Confirmation dialog spells out the count + AKA name
//   4. On confirm: each file runs the existing 3-step upload (token →
//      Dropbox PUT → /api/ai-editor/upload), which creates Asset+Task
//      pairs + stamps Uploaded At on the Stage B Output via the slug.
//
// Reuses the same upload pipeline as the legacy Direct Upload path in
// NewProjectModal — no new backend code needed, just the slug carried
// through so the Stage B Output's Uploaded At timestamp lands.

export default function FreelanceSubmitModal({
  reel,
  creatorId,
  akaName,
  slug,
  onClose,
  onDone,
}) {
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState({}) // file.name → { status, message }
  const [stage, setStage] = useState('pick') // pick | confirm | uploading | done
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  // First-frame JPEG, ~720px max dim. Same approach as NewProjectModal —
  // gives the For Review card something to render while Cloudflare Stream
  // catches up with the actual poster.
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
      console.warn('[FreelanceSubmitModal] thumb extract failed:', e.message)
      return ''
    }
  }

  // 3-step direct-to-Dropbox upload for ONE video file, ending in an
  // Asset+Task pair. Carrying the project slug lets the upload route
  // stamp Uploaded At on the matching Stage B Output so the card flips
  // out of "ready to upload" into "submitted — awaiting admin" without
  // a separate write. Returns { ok, error }.
  async function uploadOneFile(file) {
    const setStatus = (s) => setProgress(p => ({ ...p, [file.name]: s }))
    setStatus({ status: 'extracting-thumb', message: 'Extracting thumbnail…' })
    const thumbnailBase64 = await extractFirstFrameBase64(file)

    setStatus({ status: 'token', message: 'Requesting Dropbox token…' })
    const tokRes = await fetch('/api/ai-editor/upload-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reelRecordId: reel?.id, slug: slug || null }),
    })
    const tok = await tokRes.json()
    if (!tokRes.ok) {
      setStatus({ status: 'error', message: tok.error || 'token failed' })
      return { ok: false, error: tok.error || 'token failed' }
    }
    // The token route resolves the slug to a fresh "_O{nn}" variant when
    // the requested path is already taken — which is exactly the multi-file
    // batch case, where every file arrives with the same project slug.
    // Carry the RESOLVED slug into finalize so each Asset/Task is named
    // after the file we actually wrote, instead of N cards all reading the
    // bare project slug (the "3 of the same" bug).
    const resolvedSlug = tok.slug || slug || null

    setStatus({ status: 'dropbox', message: `Uploading ${(file.size / (1024*1024)).toFixed(1)} MB to Dropbox…` })
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
    if (!dbxRes.ok) {
      const msg = `Dropbox upload failed (${dbxRes.status})`
      setStatus({ status: 'error', message: msg })
      return { ok: false, error: msg }
    }

    setStatus({ status: 'finalize', message: 'Creating review task…' })
    const finRes = await fetch('/api/ai-editor/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reelRecordId: reel?.id,
        creatorId,
        dropboxPath: tok.path,
        thumbnailBase64,
        slug: resolvedSlug,
      }),
    })
    const fin = await finRes.json()
    if (!finRes.ok) {
      const msg = fin.error || 'Finalize failed'
      setStatus({ status: 'error', message: msg })
      return { ok: false, error: msg }
    }
    setStatus({ status: 'done', message: '✓ Submitted' })
    return { ok: true }
  }

  function acceptFiles(picked) {
    if (!picked) return
    const arr = Array.from(picked).filter(f => f.type?.startsWith('video/'))
    if (arr.length === 0) { setError('Need video files (mp4, mov, webm)'); return }
    setError('')
    setFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}|${f.size}`))
      const merged = [...prev]
      for (const f of arr) {
        const k = `${f.name}|${f.size}`
        if (!seen.has(k)) { seen.add(k); merged.push(f) }
      }
      return merged
    })
  }

  async function runUploads() {
    setStage('uploading')
    setError('')
    // Seed all rows as "queued" so long files show something before
    // their turn comes up. Then run sequentially — three Dropbox PUTs
    // in parallel from a single browser tab gives flaky 429s.
    setProgress(Object.fromEntries(files.map(f => [f.name, { status: 'queued', message: 'Queued…' }])))
    let failed = 0
    for (const f of files) {
      const r = await uploadOneFile(f)
      if (!r.ok) failed++
    }
    if (failed === 0) {
      setStage('done')
      // Brief pause so the editor sees the ✓ row states before close.
      setTimeout(() => onDone?.(), 700)
    } else {
      setError(`${files.length - failed} of ${files.length} submitted. ${failed} failed — see per-file status above. Close and re-open the modal to retry the failed ones.`)
      setStage('uploading') // stay so they can read the failures
    }
  }

  const reelPoster = (reel?.streamUid && buildStreamPosterUrl(reel.streamUid, { width: 240, fit: 'crop' })) || reel?.thumbnail || null

  // Modal is non-closable mid-upload to prevent half-submitted batches
  // from looking "done" — editor can close once every row shows ✓ / ×.
  const closable = stage !== 'uploading'

  return (
    <div
      onClick={closable ? (e) => { if (e.target === e.currentTarget) onClose?.() } : undefined}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        onDragOver={(e) => { if (stage === 'pick') { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (stage !== 'pick') return
          e.preventDefault(); setDragOver(false)
          acceptFiles(e.dataTransfer?.files)
        }}
        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10, width: '100%', maxWidth: 520, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>
            Upload final reels{akaName ? ` — ${akaName}` : ''}
          </div>
          {closable && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 18, cursor: 'pointer', padding: 0 }}>×</button>
          )}
        </div>

        {/* Source reel preview — always visible */}
        <div style={{ padding: '12px 18px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {reelPoster ? (
            <img src={reelPoster} alt="" style={{ width: 44, height: 70, objectFit: 'cover', borderRadius: 4, background: '#000', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 44, height: 70, background: '#222', borderRadius: 4, flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reference reel</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginTop: 2 }}>
              @{reel?.handle || 'reel'}
            </div>
            {slug && (
              <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 2 }}>{slug}</div>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {stage === 'pick' && (
            <>
              <div style={{
                border: `2px dashed ${dragOver ? '#6AC68A' : 'rgba(255,255,255,0.18)'}`,
                background: dragOver ? 'rgba(106,198,138,0.10)' : 'rgba(255,255,255,0.02)',
                borderRadius: 10,
                padding: files.length ? 14 : 28,
                textAlign: files.length ? 'left' : 'center',
                cursor: files.length ? 'default' : 'pointer',
                transition: '0.12s ease',
              }} onClick={() => !files.length && fileInputRef.current?.click()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  onChange={e => acceptFiles(e.target.files)}
                  style={{ display: 'none' }}
                />
                {files.length === 0 ? (
                  <div>
                    <div style={{ fontSize: 32, marginBottom: 6 }}>{dragOver ? '⬇️' : '📥'}</div>
                    <div style={{ fontSize: 13, color: 'var(--foreground)' }}>
                      {dragOver ? 'Drop to add files' : 'Drag video files here, or click to pick'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
                      One or many — each becomes its own review item, all linked to this reel
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      {files.length} file{files.length === 1 ? '' : 's'} selected
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                      {files.map((f, i) => (
                        <li key={i} style={{ fontSize: 12, color: 'var(--foreground)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <span style={{ color: 'var(--foreground-subtle)' }}>{(f.size / (1024*1024)).toFixed(1)} MB</span>
                            <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                              style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', padding: 0, fontSize: 11 }}>×</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <button onClick={() => fileInputRef.current?.click()}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--foreground-muted)', fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>
                        + Add more
                      </button>
                      <button onClick={() => { setFiles([]); if (fileInputRef.current) fileInputRef.current.value = '' }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                        Clear all
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {error && (
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>
                  {error}
                </div>
              )}
            </>
          )}

          {stage === 'confirm' && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--foreground)', marginBottom: 14, lineHeight: 1.5 }}>
                {files.length === 1
                  ? <>Are you sure you want to submit <strong>1 final reel</strong>{akaName ? <> for <strong>{akaName}</strong></> : null} with this reference reel?</>
                  : <>Are you sure you want to submit <strong>{files.length} separate final reels</strong>, each with the same reference reel{akaName ? <> for <strong>{akaName}</strong></> : null}?</>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 14 }}>
                Each file becomes its own review item the admin will approve or send back.
              </div>
            </div>
          )}

          {(stage === 'uploading' || stage === 'done') && (
            <>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>
                {stage === 'done' ? `✓ Submitted ${files.length} reel${files.length === 1 ? '' : 's'}.` : `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`}
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
            </>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {stage === 'pick' && (
            <>
              <button onClick={onClose}
                style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => setStage('confirm')}
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
            </>
          )}
          {stage === 'confirm' && (
            <>
              <button onClick={() => setStage('pick')}
                style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer' }}>
                ← Back
              </button>
              <button onClick={runUploads}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: 700,
                  background: 'var(--palm-pink)', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                }}>
                Yes, submit {files.length}
              </button>
            </>
          )}
          {stage === 'uploading' && error && (
            <button onClick={onClose}
              style={{
                marginLeft: 'auto',
                padding: '8px 16px', fontSize: 12, fontWeight: 700,
                background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)',
                border: '1px solid rgba(255,255,255,0.10)', borderRadius: 6, cursor: 'pointer',
              }}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
