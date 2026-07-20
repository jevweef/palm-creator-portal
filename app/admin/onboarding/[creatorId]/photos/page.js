'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ProfilePhotosPage() {
  const { creatorId } = useParams()
  const router = useRouter()
  const fileInputRef = useRef(null)

  const [creator, setCreator] = useState(null)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/onboarding/${creatorId}/photos`)
      const d = await r.json()
      setCreator({ name: d.name, aka: d.aka })
      setPhotos(d.photos || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [creatorId])

  // Upload straight to Dropbox from the browser: (1) ask our route for a
  // short-lived Dropbox upload link per file, (2) POST each file's bytes
  // directly to Dropbox (bypasses Vercel's ~4.5 MB body cap; handles HEIC/any
  // size), (3) finalize so the route mirrors them to Airtable + returns the list.
  async function handleFiles(files) {
    const list = Array.from(files || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (list.length === 0) { setError('Please pick image files (JPEG, PNG, HEIC).'); return }
    setError(''); setUploading(true)
    try {
      setProgress('Preparing…')
      const prep = await fetch(`/api/admin/onboarding/${creatorId}/photos?step=prepare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: list.map(f => f.name) }),
      })
      const prepText = await prep.text()
      let prepData; try { prepData = JSON.parse(prepText) } catch { throw new Error(prepText.slice(0, 160) || 'Could not start upload') }
      if (!prep.ok) throw new Error(prepData.error || 'Could not start upload')
      const targets = prepData.targets || []

      const done = []
      for (let i = 0; i < list.length; i++) {
        const t = targets[i]; if (!t) continue
        setProgress(`Uploading ${i + 1} of ${list.length}…`)
        const up = await fetch(t.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: list[i] })
        if (!up.ok) throw new Error(`Dropbox rejected ${list[i].name} (${up.status})`)
        done.push(t.path)
      }

      setProgress('Finishing…')
      const fin = await fetch(`/api/admin/onboarding/${creatorId}/photos?step=finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: done }),
      })
      const finData = await fin.json().catch(() => ({}))
      if (!fin.ok) throw new Error(finData.error || 'Finalize failed')
      setPhotos(finData.photos || [])
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally { setUploading(false); setProgress('') }
  }

  async function deletePhoto(path) {
    if (!confirm('Delete this photo?')) return
    const r = await fetch(`/api/admin/onboarding/${creatorId}/photos?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    if (r.ok) setPhotos(d.photos || [])
    else setError(`Delete failed: ${d.error || ''}`)
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/admin/onboarding" style={{ fontSize: '12px', color: 'var(--foreground-muted)', textDecoration: 'none' }}>
          ← Onboarding
        </Link>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', marginBottom: '4px' }}>
          Profile Photos{creator?.aka ? ` — ${creator.aka}` : ''}
        </h1>
        <p style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>
          Upload 3–6 reference photos. SMM uses these when setting up the creator's Palm IG accounts.
        </p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '40px 20px',
          border: `2px dashed ${dragging ? 'var(--palm-pink)' : 'var(--card-border)'}`,
          borderRadius: '12px',
          background: dragging ? 'rgba(232,160,160,0.06)' : 'rgba(255,255,255,0.02)',
          textAlign: 'center', cursor: 'pointer',
          transition: '0.15s ease',
          marginBottom: '24px',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '4px' }}>
          {uploading ? (progress || 'Uploading…') : 'Drop photos here or click to pick'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
          JPEG / PNG / HEIC · stored in Dropbox at /Palm Ops/Creators/{creator?.aka || '...'}/Profile Pictures/
        </div>
      </div>

      {error && (
        <div style={{ marginTop: '-12px', marginBottom: '20px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(220,80,80,0.1)', border: '1px solid rgba(220,80,80,0.35)', color: '#f0a0a0', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)' }}>Loading...</div>
      ) : photos.length === 0 ? (
        <div style={{ padding: '30px', color: 'var(--foreground-muted)', textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--card-border)', borderRadius: '10px' }}>
          No photos yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {photos.map(p => (
            <div key={p.id} style={{ position: 'relative', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', overflow: 'hidden' }}>
              <img src={p.thumbnail} alt={p.filename} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
              <button
                onClick={() => deletePhoto(p.id)}
                style={{
                  position: 'absolute', top: '6px', right: '6px',
                  background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '6px', padding: '4px 8px',
                  color: '#fff', fontSize: '11px', cursor: 'pointer',
                }}
              >Delete</button>
              <div style={{ padding: '6px 8px', fontSize: '11px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.filename}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
