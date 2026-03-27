'use client'

import { useState, useRef } from 'react'

export default function UploadModal({ record, creatorOpsId, creatorHqId, onClose, onSuccess }) {
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

  const handleUpload = async () => {
    if (files.length === 0) return
    setUploading(true)
    setError('')
    setProgress('Uploading to Dropbox...')

    try {
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))
      formData.append('inspoRecordId', record.id)
      formData.append('creatorOpsId', creatorOpsId)
      formData.append('creatorHqId', creatorHqId)
      formData.append('notes', notes)

      const res = await fetch('/api/content-upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !uploading && onClose()}
    >
      <div className="relative w-full max-w-lg mx-4 md:mx-0 bg-[#111] border border-[#2a2a2a] rounded-2xl overflow-hidden">
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px', borderBottom: '1px solid #222',
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', margin: 0 }}>
              Upload Clips
            </h2>
            <p style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>
              {record.title}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            style={{ color: '#71717a', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '22px' }}>
          {success ? (
            /* Success state */
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#10003;</div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#4ade80', marginBottom: '8px' }}>
                Clips uploaded!
              </p>
              <p style={{ fontSize: '13px', color: '#71717a' }}>
                Your clips are now in the editing queue.
              </p>
              <button
                onClick={onClose}
                style={{
                  marginTop: '20px', padding: '10px 28px',
                  background: '#a855f7', color: '#fff', border: 'none',
                  borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #333',
                  borderRadius: '12px',
                  padding: '32px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#a855f7'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#333'}
              >
                <svg style={{ width: '32px', height: '32px', margin: '0 auto 12px', color: '#52525b' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <p style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '4px' }}>
                  Drop video files here or click to browse
                </p>
                <p style={{ fontSize: '11px', color: '#52525b' }}>
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
                      padding: '8px 12px', background: '#1a1a1a', borderRadius: '8px',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: '12px', color: '#d4d4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </p>
                        <p style={{ fontSize: '10px', color: '#52525b' }}>{formatSize(file.size)}</p>
                      </div>
                      <button
                        onClick={() => removeFile(i)}
                        disabled={uploading}
                        style={{ color: '#71717a', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', flexShrink: 0 }}
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
                  background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px',
                  color: '#d4d4d8', fontSize: '13px', resize: 'vertical', minHeight: '60px',
                  fontFamily: 'inherit',
                }}
              />

              {/* Error */}
              {error && (
                <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '12px' }}>{error}</p>
              )}

              {/* Progress */}
              {progress && (
                <p style={{ fontSize: '12px', color: '#a855f7', marginTop: '12px' }}>{progress}</p>
              )}

              {/* Upload button */}
              <button
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
                style={{
                  marginTop: '16px', width: '100%', padding: '12px',
                  background: files.length === 0 || uploading ? '#333' : '#a855f7',
                  color: files.length === 0 || uploading ? '#71717a' : '#fff',
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
