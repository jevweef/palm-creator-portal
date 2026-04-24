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

  async function handleFiles(files) {
    const list = Array.from(files || []).filter(f => f.type.startsWith('image/'))
    if (list.length === 0) { alert('Please pick image files.'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      list.forEach(f => fd.append('file', f))
      const r = await fetch(`/api/admin/onboarding/${creatorId}/photos`, { method: 'POST', body: fd })
      if (!r.ok) { const d = await r.json(); alert(`Upload failed: ${d.error || 'unknown'}`); return }
      await load()
    } finally { setUploading(false) }
  }

  async function deletePhoto(attachmentId) {
    if (!confirm('Delete this photo?')) return
    const r = await fetch(`/api/admin/onboarding/${creatorId}/photos?attachmentId=${attachmentId}`, { method: 'DELETE' })
    if (r.ok) await load()
    else alert('Delete failed')
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
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '4px' }}>
          {uploading ? 'Uploading...' : 'Drop photos here or click to pick'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
          JPEG / PNG / HEIC · stored in Dropbox at /Palm Ops/Creators/{creator?.aka || '...'}/Profile Photos/
        </div>
      </div>

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
