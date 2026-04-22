'use client'

import { useState, useRef } from 'react'

export default function UploadModal({ record, creatorOpsId, creatorHqId, onClose, onSuccess, replaceAssetId }) {
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef(null)

  const handleFiles = (newFiles) => {
    const videoFiles = Array.from(newFiles).filter((f) =>
      f.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|m4v)$/i.test(f.name)
    )
    setFiles((prev) => [...prev, ...videoFiles])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const slugify = (str) => str.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 60)

  // Extract a thumbnail frame from a video file at 1 second
  const extractThumbnail = (file) => {
    return new Promise((resolve) => {
      try {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.playsInline = true

        const url = URL.createObjectURL(file)
        video.src = url

        video.onloadeddata = () => {
          video.currentTime = Math.min(1, video.duration * 0.25)
        }

        video.onseeked = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d')
            ctx.drawImage(video, 0, 0)
            canvas.toBlob((blob) => {
              URL.revokeObjectURL(url)
              resolve(blob)
            }, 'image/jpeg', 0.85)
          } catch {
            URL.revokeObjectURL(url)
            resolve(null)
          }
        }

        video.onerror = () => {
          URL.revokeObjectURL(url)
          resolve(null)
        }

        // Timeout after 10 seconds
        setTimeout(() => {
          URL.revokeObjectURL(url)
          resolve(null)
        }, 10000)
      } catch {
        resolve(null)
      }
    })
  }

  const handleUpload = async () => {
    if (files.length === 0) return
    setUploading(true)
    setError('')

    try {
      // Step 1: Get Dropbox token + folder path + creator name from server
      setProgress('Preparing upload...')
      const tokenRes = await fetch('/api/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorHqId }),
      })

      if (!tokenRes.ok) {
        const err = await tokenRes.json()
        throw new Error(err.error || 'Failed to get upload credentials')
      }

      const { accessToken, rootNamespaceId, uploadFolder, creatorName } = await tokenRes.json()

      // Build file names: {InspoTitle}_{CreatorName}_{timestamp}_{fileNumber}.ext
      const titleSlug = slugify(record.title || 'untitled')
      const nameSlug = slugify(creatorName || 'creator')
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

      // Step 2: Upload each file directly to Dropbox from browser
      const uploadedFiles = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileNum = String(i + 1).padStart(2, '0')
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mov'
        const newName = `${titleSlug}_${nameSlug}_${timestamp}_${fileNum}.${ext}`

        setProgress(`Uploading ${i + 1} of ${files.length}: ${newName}...`)

        const buffer = await file.arrayBuffer()
        const filePath = `${uploadFolder}/${newName}`

        const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({
              path: filePath,
              mode: 'add',
              autorename: true,
              mute: true,
            }),
            'Dropbox-API-Path-Root': pathRoot,
            'Content-Type': 'application/octet-stream',
          },
          body: buffer,
        })

        if (!dbxRes.ok) {
          const errText = await dbxRes.text()
          throw new Error(`Dropbox upload failed for ${newName}: ${errText}`)
        }

        const result = await dbxRes.json()

        // Create shared link for the uploaded file
        let sharedLink = ''
        try {
          const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Dropbox-API-Path-Root': pathRoot,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: result.path_display }),
          })
          if (linkRes.ok) {
            const linkData = await linkRes.json()
            sharedLink = linkData.url || ''
          }
        } catch {}

        uploadedFiles.push({
          name: newName,
          path: result.path_display,
          size: result.size,
          sharedLink,
        })
      }

      // Step 3: Extract thumbnail from first video
      setProgress('Generating thumbnail...')
      let thumbnailBase64 = null
      try {
        const thumbBlob = await extractThumbnail(files[0])
        if (thumbBlob) {
          const reader = new FileReader()
          thumbnailBase64 = await new Promise((resolve) => {
            reader.onload = () => resolve(reader.result.split(',')[1]) // strip data:image/jpeg;base64,
            reader.readAsDataURL(thumbBlob)
          })
        }
      } catch {}

      // Step 4: Create or replace Airtable records via our API
      setProgress(replaceAssetId ? 'Replacing clip...' : 'Creating records...')
      const endpoint = replaceAssetId ? '/api/content-replace' : '/api/content-upload'
      const payload = replaceAssetId
        ? { assetId: replaceAssetId, creatorOpsId, notes, uploadedFiles, thumbnailBase64 }
        : { inspoRecordId: record.id, creatorOpsId, notes, uploadedFiles, thumbnailBase64 }

      const recordRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!recordRes.ok) {
        const err = await recordRes.json()
        throw new Error(err.error || 'Failed to create records')
      }

      setSuccess(true)
      setProgress('')
      if (onSuccess) onSuccess()
    } catch (err) {
      setError(err.message)
      setProgress('')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !uploading && onClose()}
    >
      <div className="relative w-full max-w-lg mx-4 md:mx-0 bg-white overflow-hidden" style={{boxShadow:'0 8px 40px rgba(0,0,0,0.15)', borderRadius:'18px', border:'none'}}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px', borderBottom: '1px solid transparent',
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: 0 }}>
              {replaceAssetId ? 'Replace Clip' : 'Upload Clips'}
            </h2>
            <p style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
              {record.title}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            style={{ color: '#999', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '22px' }}>
          {success ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg style={{ width: '24px', height: '24px', color: '#4ade80' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#16a34a', marginBottom: '8px' }}>
                {replaceAssetId ? 'Clip replaced!' : 'Clips uploaded!'}
              </p>
              <p style={{ fontSize: '13px', color: '#999' }}>
                {replaceAssetId ? 'Your new clip has replaced the original.' : 'Your clips are now in the editing queue.'}
              </p>
              <button
                onClick={onClose}
                style={{
                  marginTop: '20px', padding: '10px 28px',
                  background: '#E88FAC', color: '#fff', border: 'none',
                  borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Replace warning */}
              {replaceAssetId && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', marginBottom: '16px',
                  background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px',
                  fontSize: '12px', color: '#92400e', lineHeight: 1.4,
                }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
                  <span>This will permanently delete your current clip and replace it with the new one.</span>
                </div>
              )}
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed rgba(0,0,0,0.08)',
                  borderRadius: '12px',
                  padding: '32px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.border = '2px dashed #E88FAC'}
                onMouseLeave={(e) => e.currentTarget.style.border = '2px dashed rgba(0,0,0,0.08)'}
              >
                <svg style={{ width: '32px', height: '32px', margin: '0 auto 12px', color: 'rgba(212, 160, 176, 0.3)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <p style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>
                  Drop video files here or click to browse
                </p>
                <p style={{ fontSize: '11px', color: '#bbb' }}>
                  MP4, MOV accepted
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="video/*,.mp4,.mov,.avi,.mkv,.m4v"
                  onChange={(e) => handleFiles(e.target.files)}
                  style={{ display: 'none' }}
                />
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {files.map((file, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', background: 'var(--background)', borderRadius: '8px', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: '12px', color: '#4a4a4a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </p>
                        <p style={{ fontSize: '10px', color: '#999' }}>{formatSize(file.size)}</p>
                      </div>
                      <button
                        onClick={() => removeFile(i)}
                        disabled={uploading}
                        style={{ color: '#999', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', flexShrink: 0 }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes for the editor (optional)"
                disabled={uploading}
                style={{
                  width: '100%', marginTop: '16px', padding: '10px 12px',
                  background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '8px',
                  color: '#333', fontSize: '13px', resize: 'vertical', minHeight: '60px',
                  fontFamily: 'inherit',
                }}
              />

              {/* Error */}
              {error && (
                <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '12px' }}>{error}</p>
              )}

              {/* Progress */}
              {progress && (
                <p style={{ fontSize: '12px', color: '#E88FAC', marginTop: '12px' }}>{progress}</p>
              )}

              {/* Upload button */}
              <button
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
                style={{
                  marginTop: '16px', width: '100%', padding: '12px',
                  background: files.length === 0 || uploading ? 'transparent' : '#E88FAC',
                  color: files.length === 0 || uploading ? '#C88FA0' : '#fff',
                  border: 'none', borderRadius: '10px',
                  fontSize: '14px', fontWeight: 600, cursor: files.length === 0 || uploading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
                {uploading ? (
                  <>Uploading...</>
                ) : (
                  <>
                    <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload {files.length > 0 ? `${files.length} clip${files.length !== 1 ? 's' : ''}` : 'Clips'}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
