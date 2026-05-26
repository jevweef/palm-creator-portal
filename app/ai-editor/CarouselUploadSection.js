'use client'
import { useRef, useState } from 'react'

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

export default function CarouselUploadSection({ creatorId, creators }) {
  const [files, setFiles] = useState([])  // [{ file, previewUrl }]
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, lastError: '' })
  const [lastResult, setLastResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

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

  const submit = async () => {
    if (!creatorId) { setProgress(p => ({ ...p, lastError: 'Pick a creator first' })); return }
    if (!files.length) { setProgress(p => ({ ...p, lastError: 'Add at least one image' })); return }

    setSubmitting(true)
    setLastResult(null)
    const batchId = genBatchId()
    let okCount = 0
    let firstError = ''
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
        okCount++
        setProgress({ current: i + 1, total: files.length, lastError: '' })
      } catch (err) {
        if (!firstError) firstError = err.message
        setProgress(p => ({ ...p, current: i + 1, lastError: err.message }))
        // Keep going — other slides might succeed; admin can re-review.
      }
    }

    setSubmitting(false)
    setLastResult({
      ok: okCount === files.length,
      uploaded: okCount,
      total: files.length,
      batchId,
      error: firstError,
    })
    if (okCount > 0) {
      // Clear the tray so the editor sees a clean slate. Keep title for
      // quick repeat submissions.
      files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl))
      setFiles([])
    }
  }

  const creatorName = creators?.find(c => c.id === creatorId)?.name || ''

  return (
    <div style={{ maxWidth: 900, marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>📸 AI Carousel Upload</h2>
        <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: 0 }}>
          Upload AI-generated carousel slides. After submit, admins see the batch in their For Review tab. Approved batches become available in the Carousels picker under <em>AI Generated</em>.
        </p>
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
