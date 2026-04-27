'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import ConfirmModal from '@/components/ConfirmModal'

const POSE_ORDER = ['front', 'back', 'face']
const POSE_META = {
  front: { label: 'Front View', model: 'Wan 2.7', emoji: '🧍‍♀️' },
  back: { label: 'Back View', model: 'Wan 2.7', emoji: '🔄' },
  face: { label: 'Close Up Face', model: 'Nano Banana 2', emoji: '🙂' },
}

const HARDCODED_PROMPTS = {
  front:
    'Exact same woman as in the reference images, wearing a black micro bikini, front three-quarter body view, standing pose with hands relaxed, confident posture, soft studio lighting, clean light gray seamless background, hyper realistic photography, ultra detailed skin texture, best quality, 8k, sharp focus, cinematic lighting, masterpiece, photorealistic',
  back:
    'Exact same woman as in the reference images, wearing a black micro bikini, rear full body view, standing straight with hands at sides, elegant posture, soft even studio lighting highlighting her figure, clean light gray seamless background, hyper realistic, ultra detailed skin, best quality, 8k resolution, sharp focus, photorealistic, masterpiece',
  face:
    'Exact same woman as in the reference images, extreme close-up portrait of her face and shoulders, neutral expression, direct gaze, soft diffused studio lighting, clean light gray background, hyper realistic photography, ultra detailed skin texture and pores, best quality, 8k, razor sharp focus on eyes, cinematic, masterpiece, photorealistic, angle should be a half body pic, close up',
}

function Lightbox({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!url) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out', padding: '24px',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="zoom"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain', display: 'block', cursor: 'default', borderRadius: '8px' }}
      />
      <button
        onClick={onClose}
        aria-label="Close"
        style={{ position: 'fixed', top: '16px', right: '16px', width: '32px', height: '32px', fontSize: '18px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', cursor: 'pointer', lineHeight: 1, padding: 0 }}
      >×</button>
    </div>
  )
}

function PoseCard({ creatorId, pose, state, prompts, onPromptChange, onRefresh, onZoom, onConfirm }) {
  const meta = POSE_META[pose]
  const inputs = state.inputsByPose[pose] || []
  const output = state.outputs[pose]
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [generating, setGenerating] = useState(false)
  // inFlight: in-progress task IDs (component state — for showing spinners
  // while WaveSpeed is still working). Once each task completes, the saved
  // candidate appears in `state.candidates[pose]` from Airtable.
  const [inFlight, setInFlight] = useState([]) // [{ taskId, status, error? }]
  const [count, setCount] = useState(1)
  const [approving, setApproving] = useState(null) // url being approved
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const savedCandidates = state.candidates?.[pose] || []

  // Poll each in-flight task. On completion the server saves to Dropbox +
  // Airtable Candidates field, so we trigger an onRefresh to pick up the
  // new saved candidate, and remove the task from inFlight.
  useEffect(() => {
    const processing = inFlight.filter(t => t.status === 'processing')
    if (!processing.length) return
    let cancelled = false

    const pollOne = async (taskId) => {
      try {
        const res = await fetch('/api/admin/creator-ai-clone/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, creatorId, pose }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setInFlight(prev => prev.map(t => t.taskId === taskId ? { ...t, status: 'failed', error: data.error || `${res.status}` } : t))
          return
        }
        if (data.status === 'completed') {
          // Saved to Airtable. Refresh state to pick it up, then drop from inFlight.
          await onRefresh()
          setInFlight(prev => prev.filter(t => t.taskId !== taskId))
        } else if (data.status === 'failed') {
          setInFlight(prev => prev.map(t => t.taskId === taskId ? { ...t, status: 'failed', error: data.error } : t))
        } else {
          setTimeout(() => pollOne(taskId), 4000)
        }
      } catch (e) {
        if (cancelled) return
        setInFlight(prev => prev.map(t => t.taskId === taskId ? { ...t, status: 'failed', error: e.message } : t))
      }
    }

    processing.forEach(t => pollOne(t.taskId))
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight.map(t => `${t.taskId}:${t.status}`).join(',')])

  // When no tasks are still processing, flip generating off
  useEffect(() => {
    if (!generating) return
    const processing = inFlight.filter(t => t.status === 'processing')
    if (processing.length === 0) setGenerating(false)
  }, [inFlight, generating])

  // Direct browser → Dropbox upload. Bypasses Vercel's 4.5MB body limit
  // entirely (server never sees the file bytes). Photos go up at full
  // original quality, no size cap.
  // Flow: get short-lived token + folder + start index → loop upload
  // each file straight to Dropbox → call finalize so server creates
  // shared links + attaches to Airtable.
  const handleUpload = async (filesList) => {
    const files = Array.from(filesList || [])
    if (!files.length) return
    setUploading(true); setError('')
    setUploadProgress({ current: 0, total: files.length, name: '' })

    try {
      // 1) Get token + namespace + folder + starting index from server
      const initRes = await fetch('/api/admin/creator-ai-clone/upload-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, pose }),
      })
      const init = await initRes.json()
      if (!initRes.ok) throw new Error(init.error || 'Init failed')

      const uploaded = []
      const failures = []

      // 2) Upload each file directly to Dropbox
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setUploadProgress({ current: i + 1, total: files.length, name: file.name })
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext) ? ext : 'jpg'
        const filename = `${init.poseLabel} input_${init.startIndex + i}.${safeExt}`
        const path = `${init.folder}/${filename}`

        try {
          const upRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${init.accessToken}`,
              'Dropbox-API-Arg': JSON.stringify({
                path, mode: 'overwrite', autorename: false, mute: true,
              }),
              'Dropbox-API-Path-Root': JSON.stringify({
                '.tag': 'root', root: init.rootNamespaceId,
              }),
              'Content-Type': 'application/octet-stream',
            },
            body: file,
          })
          if (!upRes.ok) {
            const errText = await upRes.text()
            throw new Error(errText.slice(0, 120))
          }
          uploaded.push({ path, filename })
        } catch (e) {
          failures.push(`${file.name}: ${e.message}`)
        }
      }

      // 3) Finalize — server creates shared links + attaches to Airtable
      if (uploaded.length) {
        const finRes = await fetch('/api/admin/creator-ai-clone/upload-finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorId, paths: uploaded }),
        })
        const finData = await finRes.json()
        if (!finRes.ok) throw new Error(finData.error || 'Finalize failed')
        await onRefresh()
      }

      if (failures.length) {
        setError(`${failures.length} of ${files.length} failed: ${failures[0]}`)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const requestDelete = (attachmentId, filename) => {
    onConfirm({
      title: 'Remove input photo?',
      message: filename ? `Remove "${filename}" from this pose's input set?` : 'Remove this input photo from the input set?',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => doDelete(attachmentId),
    })
  }
  const doDelete = async (attachmentId) => {
    setError('')
    try {
      const res = await fetch('/api/admin/creator-ai-clone', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, attachmentId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      await onRefresh()
    } catch (e) { setError(e.message) }
  }

  const handleGenerate = async () => {
    setError('')
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/creator-ai-clone/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, pose, count, customPrompt: prompts[pose] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generate failed')
      setInFlight(prev => [...prev, ...data.taskIds.map(id => ({ taskId: id, status: 'processing' }))])
    } catch (e) { setError(e.message); setGenerating(false) }
  }

  // Non-destructive — current approved image stays until user clicks Approve
  // on a new candidate. No confirmation needed.
  const handleRegenerate = () => handleGenerate()

  const handleApprove = async (outputUrl) => {
    setApproving(outputUrl)
    setError('')
    try {
      const res = await fetch('/api/admin/creator-ai-clone/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, pose, outputUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Approve failed')
      await onRefresh()
    } catch (e) { setError(e.message) }
    finally { setApproving(null) }
  }

  const handleDeleteCandidate = async (attachmentId) => {
    setError('')
    try {
      const res = await fetch('/api/admin/creator-ai-clone', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, attachmentId, target: 'candidates', pose }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      await onRefresh()
    } catch (e) { setError(e.message) }
  }

  const handleLockIn = () => {
    onConfirm({
      title: `Lock in ${meta.label}?`,
      message: `This deletes all ${savedCandidates.length} candidate${savedCandidates.length === 1 ? '' : 's'} for ${meta.label} and hides the candidates section. The approved AI Reference stays.`,
      confirmLabel: 'Lock in',
      onConfirm: async () => {
        for (const c of savedCandidates) {
          try {
            await fetch('/api/admin/creator-ai-clone', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creatorId, attachmentId: c.id, target: 'candidates', pose }),
            })
          } catch (e) { /* keep going */ }
        }
        await onRefresh()
      },
    })
  }

  const [resyncing, setResyncing] = useState(false)
  const handleResync = async () => {
    setResyncing(true)
    setError('')
    try {
      const res = await fetch('/api/admin/creator-ai-clone/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, pose }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Resync failed')
      await onRefresh()
    } catch (e) { setError(e.message) }
    finally { setResyncing(false) }
  }

  const canGenerate = inputs.length > 0 && !generating

  // Drag handlers — apply to the whole inputs section so users can drop anywhere
  const dragHandlers = {
    onDragEnter: (e) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragOver(true) },
    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragOver(true) },
    onDragLeave: (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) },
    onDrop: (e) => {
      e.preventDefault(); e.stopPropagation(); setDragOver(false)
      if (uploading) return
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'))
      if (files.length) handleUpload(files)
    },
  }

  const showGallery = output || savedCandidates.length > 0 || inFlight.length > 0

  return (
    <div style={{
      background: 'var(--card-bg-solid)',
      borderRadius: '14px', padding: '14px 16px', marginBottom: '12px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      maxWidth: '1100px',
    }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px' }}>{meta.emoji}</span>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>{meta.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>· {meta.model}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {output && (
            <button
              onClick={handleResync}
              disabled={resyncing}
              title="Re-fetch from Dropbox"
              style={{ padding: '2px 6px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: resyncing ? 'wait' : 'pointer' }}
            >{resyncing ? '…' : '🔁 Sync'}</button>
          )}
          {output && (
            <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid rgba(125, 211, 164, 0.2)' }}>
              ✓ APPROVED
            </span>
          )}
        </div>
      </div>

      {/* INPUTS — full width, compact */}
      <div
        {...dragHandlers}
        style={{
          position: 'relative',
          border: dragOver ? '1px dashed var(--palm-pink)' : '1px dashed transparent',
          background: dragOver ? 'rgba(232, 160, 160, 0.06)' : 'transparent',
          borderRadius: '8px', padding: dragOver ? '6px' : '0',
          transition: 'background 0.12s, border-color 0.12s',
          marginBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Inputs ({inputs.length})
          </div>
          {inputs.length > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', fontStyle: 'italic' }}>
              First image = face anchor
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 64px))', gap: '5px' }}>
          {inputs.map((att, i) => (
            <div key={att.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: '5px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)', cursor: 'zoom-in' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.url}
                alt={att.filename}
                onClick={() => onZoom(att.url)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {i === 0 && (
                <div style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '8px', fontWeight: 700, padding: '1px 4px', background: 'var(--palm-pink)', color: '#060606', borderRadius: '3px', pointerEvents: 'none' }}>
                  ANCHOR
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); requestDelete(att.id, att.filename) }}
                title={`Delete ${att.filename}`}
                style={{ position: 'absolute', top: '2px', right: '2px', width: '15px', height: '15px', fontSize: '10px', background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', cursor: 'pointer', lineHeight: 1, padding: 0 }}
              >×</button>
            </div>
          ))}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            disabled={uploading}
            onChange={e => handleUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => !uploading && fileInputRef.current?.click()}
            disabled={uploading}
            title="Add photos (or drag/drop anywhere)"
            style={{
              aspectRatio: '1',
              border: '1px dashed rgba(232, 160, 160, 0.5)',
              background: 'transparent',
              color: 'var(--palm-pink)',
              fontSize: uploading ? '10px' : '18px', fontWeight: 600,
              borderRadius: '5px',
              cursor: uploading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
              lineHeight: 1.2,
            }}
          >
            {uploading
              ? (uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}` : '…')
              : '+'}
          </button>
        </div>
        {uploading && uploadProgress && (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '5px' }}>
            Uploading {uploadProgress.current}/{uploadProgress.total}: <span style={{ color: 'var(--foreground)' }}>{uploadProgress.name}</span>
          </div>
        )}
        {!uploading && inputs.length === 0 && (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '5px', fontStyle: 'italic' }}>
            Drag &amp; drop photos anywhere here, or click the + tile.
          </div>
        )}
      </div>

      {/* PROMPT (collapsible) */}
      <details style={{ marginBottom: '10px' }}>
        <summary style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', padding: '4px 0' }}>
          Prompt {prompts[pose] !== HARDCODED_PROMPTS[pose] && <span style={{ color: 'var(--palm-pink)', textTransform: 'none' }}> · edited</span>}
        </summary>
        <textarea
          value={prompts[pose]}
          onChange={e => onPromptChange(pose, e.target.value)}
          rows={4}
          style={{ width: '100%', marginTop: '6px', padding: '8px', fontSize: '11px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
        />
        {prompts[pose] !== HARDCODED_PROMPTS[pose] && (
          <button onClick={() => onPromptChange(pose, HARDCODED_PROMPTS[pose])} style={{ marginTop: '4px', padding: '3px 8px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </details>

      {/* CONTROLS — count + generate, right-aligned */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px', flexWrap: 'wrap', marginBottom: showGallery ? '12px' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '10px', color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Count
          </label>
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={count}
            onChange={e => setCount(parseInt(e.target.value, 10))}
            disabled={generating}
            style={{ width: '90px', accentColor: 'var(--palm-pink)', cursor: generating ? 'not-allowed' : 'pointer' }}
          />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', minWidth: '14px', textAlign: 'right' }}>{count}</span>
        </div>
        <button
          onClick={output ? handleRegenerate : handleGenerate}
          disabled={!canGenerate}
          style={{
            padding: '8px 16px', fontSize: '12px', fontWeight: 700,
            background: canGenerate ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
            color: canGenerate ? '#060606' : 'var(--foreground-subtle)',
            border: 'none', borderRadius: '6px',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
          }}
        >
          {generating ? '⏳ Generating…' : output ? `🔄 Regenerate ${count > 1 ? `(${count})` : ''}` : `✨ Generate ${count > 1 ? `(${count})` : ''}`}
        </button>
      </div>

      {/* GALLERY — AI Reference + candidates in one horizontal row */}
      {showGallery && (
        <div>
          {(savedCandidates.length > 0) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
              <button
                onClick={handleLockIn}
                title="Delete candidates and clear this section"
                style={{ padding: '3px 10px', fontSize: '10px', fontWeight: 600, background: 'transparent', color: 'var(--palm-pink)', border: '1px solid var(--palm-pink)', borderRadius: '6px', cursor: 'pointer' }}
              >
                🔒 Lock In
              </button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 130px))', gap: '8px' }}>
            {/* AI Reference (first, distinguished) */}
            {output && (
              <div style={{ position: 'relative', aspectRatio: '9/16', borderRadius: '6px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)', cursor: 'zoom-in', border: '2px solid #7DD3A4' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={output.url}
                  alt={output.filename}
                  onClick={() => onZoom(output.url)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '8px', fontWeight: 700, padding: '2px 5px', background: '#7DD3A4', color: '#060606', borderRadius: '3px', pointerEvents: 'none' }}>
                  ✓ APPROVED
                </div>
              </div>
            )}
            {/* In-flight tasks */}
            {inFlight.map((t) => (
              <div key={t.taskId} style={{ position: 'relative', aspectRatio: '9/16', borderRadius: '6px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
                {t.status === 'processing' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--foreground-muted)', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ width: '18px', height: '18px', border: '2px solid rgba(232,160,160,0.3)', borderTopColor: 'var(--palm-pink)', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
                    <span>Generating…</span>
                  </div>
                )}
                {t.status === 'failed' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#E87878', textAlign: 'center', padding: '6px' }}>
                    <div>
                      <div>✕ {t.error || 'Failed'}</div>
                      <button
                        onClick={() => setInFlight(prev => prev.filter(x => x.taskId !== t.taskId))}
                        style={{ marginTop: '4px', padding: '2px 6px', fontSize: '9px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', cursor: 'pointer' }}
                      >Dismiss</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {/* Saved candidates */}
            {savedCandidates.map((c) => (
              <div key={c.id} style={{ position: 'relative', aspectRatio: '9/16', borderRadius: '6px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.url}
                  alt={c.filename}
                  onClick={() => onZoom(c.url)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCandidate(c.id) }}
                  title="Delete this candidate"
                  style={{ position: 'absolute', top: '4px', right: '4px', width: '16px', height: '16px', fontSize: '10px', background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', cursor: 'pointer', lineHeight: 1, padding: 0 }}
                >×</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleApprove(c.url) }}
                  disabled={!!approving}
                  title="Approve as the reference"
                  style={{ position: 'absolute', bottom: '4px', left: '4px', right: '4px', padding: '4px 6px', fontSize: '10px', fontWeight: 700, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '4px', cursor: approving ? 'wait' : 'pointer' }}
                >
                  {approving === c.url ? '…' : '✓ Approve'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {generating && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
          Calling {meta.model}… typically 30-60s per image.
        </div>
      )}

      {error && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
          {error}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}


export default function AISuperClonePanel({ creatorId }) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')
  const [prompts, setPrompts] = useState(HARDCODED_PROMPTS)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/creator-ai-clone?creatorId=${creatorId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setState(data.state)
      setError('')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [creatorId])

  useEffect(() => { fetchState() }, [fetchState])

  const handleToggle = async () => {
    if (!state) return
    setToggling(true)
    try {
      const res = await fetch('/api/admin/creator-ai-clone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, enabled: !state.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Toggle failed')
      setState(prev => ({ ...prev, enabled: data.enabled }))
    } catch (e) { setError(e.message) }
    finally { setToggling(false) }
  }

  if (loading) return <div style={{ padding: '20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading…</div>
  if (!state) return <div style={{ padding: '20px', color: '#E87878', fontSize: '13px' }}>{error || 'No state'}</div>

  return (
    <div>
      {/* Toggle */}
      <div style={{ background: 'var(--card-bg-solid)', borderRadius: '14px', padding: '14px 18px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>AI Conversions</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
            {state.enabled
              ? 'Enabled — reference setup unlocked. AI Recreate workflow uses these references.'
              : 'Disabled — toggle on to start the reference image setup.'}
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggling}
          style={{
            position: 'relative', width: '40px', height: '22px',
            background: state.enabled ? '#7DD3A4' : 'rgba(255,255,255,0.1)',
            borderRadius: '11px', border: 'none', cursor: toggling ? 'wait' : 'pointer',
            transition: 'background 0.15s', flexShrink: 0,
          }}
        >
          <div style={{
            position: 'absolute', top: '3px', left: state.enabled ? '21px' : '3px',
            width: '16px', height: '16px', borderRadius: '50%',
            background: 'white', transition: 'left 0.15s',
          }} />
        </button>
      </div>

      {!state.enabled && (
        <div style={{ background: 'rgba(255, 200, 100, 0.04)', border: '1px solid rgba(255, 200, 100, 0.15)', borderRadius: '12px', padding: '14px', fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.6 }}>
          When toggled on, you&apos;ll get three pose cards (Front / Back / Face) where you upload source photos
          for each pose. We auto-rename them in Dropbox, send them to WaveSpeed, and surface the generated AI
          references inline for approval. Once all three are approved, the creator&apos;s identity packet is ready
          for the Recreate workflow.
        </div>
      )}

      {state.enabled && POSE_ORDER.map(pose => (
        <PoseCard
          key={pose}
          creatorId={creatorId}
          pose={pose}
          state={state}
          prompts={prompts}
          onPromptChange={(p, value) => setPrompts(prev => ({ ...prev, [p]: value }))}
          onRefresh={fetchState}
          onZoom={setLightboxUrl}
          onConfirm={setConfirmDialog}
        />
      ))}

      {error && (
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '8px 12px' }}>
          {error}
        </div>
      )}

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      <ConfirmModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  )
}
