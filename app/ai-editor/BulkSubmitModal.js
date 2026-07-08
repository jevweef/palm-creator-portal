'use client'

import { useState, useRef, useEffect } from 'react'
import { uploadFileToDropbox } from '@/lib/dropboxUpload'

// Bulk Submit modal — the AI editor's front-and-center "drop a bunch of
// finished AI reels for a creator" flow. Unlike the pool/Direct Upload
// path (FreelanceSubmitModal), this is NOT tied to a source reel: the
// editor already has finished videos and just wants them into admin review
// for a specific creator, marked as AI content.
//
// Per file: extract a first-frame thumbnail → mint a Dropbox path
// (/api/ai-editor/bulk-token) → CHUNKED direct-to-Dropbox upload (any size,
// resumable, per-file % progress) → finalize (/api/ai-editor/bulk-submit)
// which creates the Asset (AI Generated, In Review, linked to creator) +
// review Task. After the batch, the editor sees a thumbnail grid of exactly
// what they submitted.

export default function BulkSubmitModal({ creators, initialCreatorId, onClose, onDone }) {
  const [creatorId, setCreatorId] = useState(initialCreatorId || (creators?.[0]?.id) || '')
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState({}) // name → { status, message, frac }
  const [thumbs, setThumbs] = useState({})      // name → dataURL (for the submitted gallery)
  const [stage, setStage] = useState('pick')    // pick | confirm | uploading | done
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const abortRef = useRef(null)

  const akaName = creators?.find(c => c.id === creatorId)?.name || ''

  // Warn before leaving mid-upload — a half-submitted batch is exactly what
  // we don't want the editor to walk away from thinking it finished.
  useEffect(() => {
    if (stage !== 'uploading') return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [stage])

  // First-frame JPEG (~720px). Returns { base64, dataUrl } — base64 goes to
  // the finalize route (thumbnail), dataUrl feeds the submitted gallery.
  async function extractFirstFrame(file) {
    try {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.src = url
      await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = rej })
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
      return { base64: dataUrl.split(',')[1] || '', dataUrl }
    } catch (e) {
      console.warn('[BulkSubmitModal] thumb extract failed:', e.message)
      return { base64: '', dataUrl: '' }
    }
  }

  // Upload ONE file end to end. Returns { ok, error }.
  async function uploadOneFile(file) {
    const setStatus = (s) => setProgress(p => ({ ...p, [file.name]: { ...(p[file.name] || {}), ...s } }))

    setStatus({ status: 'thumb', message: 'Extracting thumbnail…', frac: 0 })
    const { base64, dataUrl } = await extractFirstFrame(file)
    if (dataUrl) setThumbs(t => ({ ...t, [file.name]: dataUrl }))

    setStatus({ status: 'token', message: 'Preparing upload…' })
    const tokRes = await fetch('/api/ai-editor/bulk-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creatorId, fileName: file.name }),
    })
    const tok = await tokRes.json().catch(() => ({}))
    if (!tokRes.ok) {
      const msg = tok.error || 'Could not start upload'
      setStatus({ status: 'error', message: msg })
      return { ok: false, error: msg }
    }

    setStatus({ status: 'dropbox', message: `Uploading ${(file.size / (1024 * 1024)).toFixed(1)} MB…`, frac: 0 })
    let landedPath = tok.path
    try {
      const meta = await uploadFileToDropbox({
        file,
        path: tok.path,
        accessToken: tok.accessToken,
        pathRoot: JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
        signal: abortRef.current?.signal,
        onProgress: (frac) => setStatus({ frac }),
      })
      landedPath = meta?.path_display || tok.path
    } catch (e) {
      const msg = `Upload failed — ${e.message || 'try again'}`
      setStatus({ status: 'error', message: msg })
      return { ok: false, error: msg }
    }

    setStatus({ status: 'finalize', message: 'Sending to review…', frac: 1 })
    const finRes = await fetch('/api/ai-editor/bulk-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creatorId, dropboxPath: landedPath, thumbnailBase64: base64, fileName: file.name }),
    })
    const fin = await finRes.json().catch(() => ({}))
    if (!finRes.ok) {
      const msg = fin.error || 'Could not create review item'
      setStatus({ status: 'error', message: msg })
      return { ok: false, error: msg }
    }
    setStatus({ status: 'done', message: 'Submitted', frac: 1 })
    return { ok: true }
  }

  function acceptFiles(picked) {
    if (!picked) return
    const arr = Array.from(picked).filter(f => f.type?.startsWith('video/'))
    if (arr.length === 0) { setError('Pick video files (mp4, mov, webm)'); return }
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

  // Run the batch. `only` (optional Set of names) re-runs just those files —
  // used by the "Retry failed" button so successes aren't re-submitted.
  async function runUploads(only = null) {
    if (!creatorId) { setError('Pick a creator first'); return }
    setStage('uploading')
    setError('')
    abortRef.current = new AbortController()
    const queue = only ? files.filter(f => only.has(f.name)) : files
    if (!only) {
      setProgress(Object.fromEntries(files.map(f => [f.name, { status: 'queued', message: 'Queued…', frac: 0 }])))
    } else {
      setProgress(p => { const n = { ...p }; queue.forEach(f => { n[f.name] = { status: 'queued', message: 'Queued…', frac: 0 } }); return n })
    }
    // Sequential — several parallel Dropbox PUTs from one tab draws 429s.
    let failed = 0
    for (const f of queue) {
      const r = await uploadOneFile(f)
      if (!r.ok) failed++
    }
    if (failed === 0) {
      setStage('done')
    } else {
      setError(`${queue.length - failed} of ${queue.length} submitted. ${failed} failed — retry below.`)
      setStage('uploading')
    }
  }

  const closable = stage !== 'uploading'
  const failedNames = files.filter(f => progress[f.name]?.status === 'error').map(f => f.name)

  return (
    <div
      onClick={closable ? (e) => { if (e.target === e.currentTarget) onClose?.() } : undefined}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1600, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
      <div onClick={e => e.stopPropagation()}
        onDragOver={(e) => { if (stage === 'pick') { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { if (stage !== 'pick') return; e.preventDefault(); setDragOver(false); acceptFiles(e.dataTransfer?.files) }}
        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 620, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>Submit finished reels</div>
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 2 }}>
              Drop AI videos → they go straight to admin review, marked AI, for the creator below.
            </div>
          </div>
          {closable && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          )}
        </div>

        {/* Creator picker — always visible, locked once uploading starts */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Creator</span>
          <select
            value={creatorId}
            disabled={stage !== 'pick'}
            onChange={e => setCreatorId(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13, opacity: stage === 'pick' ? 1 : 0.6 }}>
            {(!creators || creators.length === 0) && <option value="">No creators</option>}
            {(creators || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {stage === 'pick' && (
            <>
              <div style={{
                border: `2px dashed ${dragOver ? '#6AC68A' : 'rgba(255,255,255,0.18)'}`,
                background: dragOver ? 'rgba(106,198,138,0.10)' : 'rgba(255,255,255,0.02)',
                borderRadius: 10, padding: files.length ? 14 : 30,
                textAlign: files.length ? 'left' : 'center',
                cursor: files.length ? 'default' : 'pointer', transition: '0.12s ease',
              }} onClick={() => !files.length && fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" accept="video/*" multiple onChange={e => acceptFiles(e.target.files)} style={{ display: 'none' }} />
                {files.length === 0 ? (
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 600 }}>
                      {dragOver ? 'Drop to add reels' : 'Drag reels here, or tap to pick'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
                      One or many. Any size — uploads resume if the connection blips.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      {files.length} reel{files.length === 1 ? '' : 's'} ready
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                      {files.map((f, i) => (
                        <li key={i} style={{ fontSize: 12, color: 'var(--foreground)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <span style={{ color: 'var(--foreground-subtle)' }}>{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
                            <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                              style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', padding: 0, fontSize: 12 }}>×</button>
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
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>{error}</div>
              )}
            </>
          )}

          {stage === 'confirm' && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--foreground)', marginBottom: 12, lineHeight: 1.5 }}>
                Submit <strong>{files.length} reel{files.length === 1 ? '' : 's'}</strong> for <strong>{akaName || 'this creator'}</strong>?
              </div>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                Each becomes its own AI review item the admin will approve or send back.
              </div>
              {error && (
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>{error}</div>
              )}
            </div>
          )}

          {(stage === 'uploading' || stage === 'done') && (
            <>
              {stage === 'done' ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6AC68A', marginBottom: 12 }}>
                    ✓ Submitted {files.length} reel{files.length === 1 ? '' : 's'} for {akaName}. They're in admin review now.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
                    {files.map(f => (
                      <div key={f.name} style={{ position: 'relative', aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', background: '#000', border: '1px solid rgba(106,198,138,0.35)' }}>
                        {thumbs[f.name]
                          ? <img src={thumbs[f.name]} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-subtle)', fontSize: 20 }}>▶</div>}
                        <div style={{ position: 'absolute', top: 4, right: 4, background: '#6AC68A', color: '#0a1a0f', fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '1px 6px' }}>✓</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>
                  Uploading {files.length} reel{files.length === 1 ? '' : 's'}… keep this open.
                </div>
              )}

              {stage === 'uploading' && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {files.map(f => {
                    const p = progress[f.name] || { status: 'queued', message: 'Queued', frac: 0 }
                    const done = p.status === 'done'
                    const failed = p.status === 'error'
                    const pct = Math.round((p.frac || 0) * 100)
                    return (
                      <li key={f.name} style={{
                        padding: '8px 10px', borderRadius: 6,
                        background: done ? 'rgba(106,198,138,0.06)' : failed ? 'rgba(232,120,120,0.06)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${done ? 'rgba(106,198,138,0.30)' : failed ? 'rgba(232,120,120,0.30)' : 'rgba(255,255,255,0.06)'}`,
                        fontSize: 12,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--foreground)' }}>{f.name}</span>
                          <span style={{ color: done ? '#6AC68A' : failed ? '#E87878' : 'var(--foreground-muted)', flexShrink: 0 }}>{done ? '✓' : failed ? '⨯' : `${pct}%`}</span>
                        </div>
                        {!done && !failed && (
                          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #E88FAC, #d4789a)', borderRadius: 3, transition: 'width 0.2s ease' }} />
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: 'var(--foreground-subtle)', marginTop: 3 }}>{p.message}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {error && (
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.30)', borderRadius: 6, fontSize: 12, color: '#E87878' }}>{error}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {stage === 'pick' && (
            <>
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { if (!creatorId) { setError('Pick a creator first'); return } setStage('confirm') }}
                disabled={files.length === 0}
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, background: files.length ? 'var(--palm-pink)' : 'rgba(255,255,255,0.06)', color: files.length ? '#fff' : 'var(--foreground-muted)', border: 'none', borderRadius: 6, cursor: files.length ? 'pointer' : 'not-allowed' }}>
                Submit {files.length || ''} for review
              </button>
            </>
          )}
          {stage === 'confirm' && (
            <>
              <button onClick={() => setStage('pick')} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer' }}>← Back</button>
              <button onClick={() => runUploads()} style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Yes, submit {files.length}
              </button>
            </>
          )}
          {stage === 'uploading' && error && (
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 6, cursor: 'pointer' }}>Close</button>
              {failedNames.length > 0 && (
                <button onClick={() => runUploads(new Set(failedNames))} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, background: 'var(--palm-pink)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                  Retry {failedNames.length} failed
                </button>
              )}
            </div>
          )}
          {stage === 'done' && (
            <button onClick={() => { onDone?.(); onClose?.() }} style={{ marginLeft: 'auto', padding: '10px 18px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
