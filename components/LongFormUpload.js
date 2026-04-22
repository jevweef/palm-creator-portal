'use client'

import { useState, useEffect, useRef } from 'react'

export default function LongFormUpload({ showToast }) {
  const [creators, setCreators] = useState([])
  const [selectedCreator, setSelectedCreator] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [uploads, setUploads] = useState([])
  const fileRef = useRef(null)
  const [urlInput, setUrlInput] = useState('')
  const [uploadMode, setUploadMode] = useState('file') // 'file' | 'url'

  useEffect(() => {
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(d => setCreators((d.creators || []).sort((a, b) => (a.aka || a.name || '').localeCompare(b.aka || b.name || ''))))
      .catch(() => {})
  }, [])

  const toast = (msg, error = false) => {
    if (showToast) showToast(msg, error)
    else alert(msg)
  }

  const handleUpload = async () => {
    if (!selectedCreator || files.length === 0) return
    setUploading(true)
    setProgress('Getting upload credentials...')
    try {
      const creator = creators.find(c => c.id === selectedCreator)
      const creatorName = creator?.aka || creator?.name || 'Creator'

      const tokenRes = await fetch('/api/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorHqId: creator?.hqId || '' }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId } = await tokenRes.json()
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

      const uploadFolder = `/Palm Ops/Creators/${creatorName}/Long Form/35_FINALS_FOR_REVIEW`

      const completed = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setProgress(`Uploading ${i + 1}/${files.length}: ${file.name}...`)

        const buffer = await file.arrayBuffer()
        const filePath = `${uploadFolder}/${file.name}`

        const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: filePath, mode: 'add', autorename: true, mute: true }),
            'Dropbox-API-Path-Root': pathRoot,
            'Content-Type': 'application/octet-stream',
          },
          body: buffer,
        })
        if (!dbxRes.ok) throw new Error(`Upload failed for ${file.name}: ${await dbxRes.text()}`)
        const result = await dbxRes.json()
        completed.push({ name: file.name, path: result.path_display, size: file.size })
      }

      setUploads(prev => [...completed, ...prev])
      setFiles([])
      toast(`${completed.length} file${completed.length > 1 ? 's' : ''} uploaded for ${creatorName}`)
    } catch (err) {
      toast(err.message, true)
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  const handleUrlUpload = async () => {
    if (!selectedCreator || !urlInput.trim()) return
    setUploading(true)
    setProgress('Downloading from URL...')
    try {
      const creator = creators.find(c => c.id === selectedCreator)
      const creatorName = creator?.aka || creator?.name || 'Creator'

      const res = await fetch('/api/admin/longform-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim(), creatorName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setUploads(prev => [{ name: data.name, path: data.path, size: data.size }, ...prev])
      setUrlInput('')
      toast(`Uploaded ${data.name} for ${creatorName}`)
    } catch (err) {
      toast(err.message, true)
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' }}>
        {/* Creator picker */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Creator</div>
          <select value={selectedCreator} onChange={e => setSelectedCreator(e.target.value)}
            style={{ padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid transparent', background: 'var(--card-bg-solid)', minWidth: '180px' }}>
            <option value="">Select creator...</option>
            {creators.map(c => (
              <option key={c.id} value={c.id}>{c.aka || c.name}</option>
            ))}
          </select>
        </div>

        {/* Mode toggle */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Source</div>
          <div style={{ display: 'flex', gap: '0', border: '1px solid transparent', borderRadius: '8px', overflow: 'hidden' }}>
            {[{ key: 'file', label: 'File' }, { key: 'url', label: 'URL' }].map(m => (
              <button key={m.key} onClick={() => setUploadMode(m.key)}
                style={{ padding: '7px 14px', fontSize: '11px', fontWeight: 600, background: uploadMode === m.key ? 'rgba(232, 160, 160, 0.05)' : 'rgba(255,255,255,0.08)', color: uploadMode === m.key ? 'var(--palm-pink)' : '#999', border: 'none', cursor: 'pointer' }}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {uploadMode === 'file' && (
          <>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Files</div>
              <button onClick={() => fileRef.current?.click()}
                style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, background: 'rgba(232, 160, 160, 0.05)', color: 'var(--palm-pink)', border: '1px solid #E88FAC', borderRadius: '8px', cursor: 'pointer' }}>
                {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : 'Choose files'}
              </button>
              <input ref={fileRef} type="file" multiple accept="video/*" style={{ display: 'none' }}
                onChange={e => setFiles(Array.from(e.target.files || []))} />
            </div>
            <button onClick={handleUpload} disabled={!selectedCreator || files.length === 0 || uploading}
              style={{
                padding: '8px 20px', fontSize: '13px', fontWeight: 700,
                background: uploading || !selectedCreator || files.length === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(125, 211, 164, 0.08)',
                color: uploading || !selectedCreator || files.length === 0 ? '#999' : '#7DD3A4',
                border: `1px solid ${uploading ? 'rgba(255,255,255,0.08)' : 'rgba(125, 211, 164, 0.2)'}`,
                borderRadius: '8px', cursor: uploading ? 'default' : 'pointer',
              }}>
              {uploading ? progress || 'Uploading...' : 'Upload'}
            </button>
          </>
        )}
      </div>

      {uploadMode === 'url' && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="Paste Google Drive link..."
            style={{ flex: 1, padding: '8px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid transparent', outline: 'none' }} />
          <button onClick={handleUrlUpload} disabled={!selectedCreator || !urlInput.trim() || uploading}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: 700, flexShrink: 0,
              background: uploading || !selectedCreator || !urlInput.trim() ? 'rgba(255,255,255,0.04)' : 'rgba(125, 211, 164, 0.08)',
              color: uploading || !selectedCreator || !urlInput.trim() ? '#999' : '#7DD3A4',
              border: `1px solid ${uploading ? 'rgba(255,255,255,0.08)' : 'rgba(125, 211, 164, 0.2)'}`,
              borderRadius: '8px', cursor: uploading ? 'default' : 'pointer',
            }}>
            {uploading ? progress || 'Downloading...' : 'Upload from URL'}
          </button>
        </div>
      )}

      {uploadMode === 'file' && files.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--card-bg-solid)', borderRadius: '10px', border: '1px solid transparent' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Ready to upload</div>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px' }}>
              <span style={{ color: '#333' }}>{f.name}</span>
              <span style={{ color: 'var(--foreground-muted)', fontSize: '11px' }}>{(f.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          ))}
        </div>
      )}

      {selectedCreator && (
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '16px' }}>
          Uploads go to: <span style={{ color: 'var(--foreground-muted)', fontFamily: 'monospace' }}>
            /Creators/{creators.find(c => c.id === selectedCreator)?.aka || '...'}/Long Form/35_FINALS_FOR_REVIEW/
          </span>
        </div>
      )}

      {uploads.length > 0 && (
        <div style={{ padding: '12px', background: 'rgba(125, 211, 164, 0.06)', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#7DD3A4', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Uploaded this session ({uploads.length})
          </div>
          {uploads.map((u, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', fontSize: '11px' }}>
              <span style={{ color: '#333' }}>{u.name}</span>
              <span style={{ color: 'var(--foreground-muted)' }}>{(u.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
