'use client'

import { useState, useRef } from 'react'

export default function ContentRequestItem({ item, hqId, onUpdate }) {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const isSubmitted = item.status === 'Submitted' || item.status === 'Approved'
  const hasDraft = item.status === 'Draft'
  const hasFile = !!item.dropboxLink
  const needsRevision = item.status === 'Revision Requested'

  const handleFileSelect = async (files) => {
    if (!files || files.length === 0) return
    const file = files[0]

    setUploading(true)
    setUploadProgress('Getting upload credentials...')

    try {
      // Get Dropbox token
      const tokenRes = await fetch('/api/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorHqId: hqId }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload token')
      const { accessToken, rootNamespaceId, creatorName } = await tokenRes.json()

      // Build path: /Creator Root/Content Requests/2026-04/Section/filename
      const now = new Date()
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const section = item.label.replace(/[^a-zA-Z0-9\s]/g, '').trim()
      const ext = file.name.split('.').pop()
      const safeName = `${creatorName}_${section}_${Date.now()}.${ext}`

      // Use the upload folder but redirect to Content Requests subfolder
      const uploadPath = `/Content Requests/${month}/${item.label.split(' ').slice(0, -1).join(' ') || 'General'}/${safeName}`

      setUploadProgress(`Uploading ${file.name}...`)

      // Upload to Dropbox
      const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({
            path: uploadPath,
            mode: 'add',
            autorename: true,
            mute: true,
          }),
          'Dropbox-API-Path-Root': JSON.stringify({
            '.tag': 'root',
            root: rootNamespaceId,
          }),
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      })

      if (!uploadRes.ok) {
        const err = await uploadRes.text()
        throw new Error(`Upload failed: ${err}`)
      }

      const uploadData = await uploadRes.json()
      const actualPath = uploadData.path_display

      setUploadProgress('Creating shared link...')

      // Create shared link
      const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Dropbox-API-Path-Root': JSON.stringify({
            '.tag': 'root',
            root: rootNamespaceId,
          }),
        },
        body: JSON.stringify({
          path: actualPath,
          settings: { requested_visibility: 'public' },
        }),
      })

      let dropboxLink = ''
      if (linkRes.ok) {
        const linkData = await linkRes.json()
        dropboxLink = linkData.url
      } else if (linkRes.status === 409) {
        // Link exists, fetch it
        const existing = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Dropbox-API-Path-Root': JSON.stringify({
              '.tag': 'root',
              root: rootNamespaceId,
            }),
          },
          body: JSON.stringify({ path: actualPath, direct_only: true }),
        })
        if (existing.ok) {
          const data = await existing.json()
          if (data.links?.length) dropboxLink = data.links[0].url
        }
      }

      setUploadProgress('Saving to database...')

      // Update Airtable via our API
      const saveRes = await fetch('/api/content-request/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          dropboxPath: actualPath,
          dropboxLink,
          fileName: file.name,
          fileSize: file.size,
        }),
      })

      if (!saveRes.ok) throw new Error('Failed to save upload record')

      // Update local state
      onUpdate(item.id, {
        status: 'Draft',
        dropboxPath: actualPath,
        dropboxLink,
        fileName: file.name,
        fileSize: file.size,
      })

      setUploadProgress('')
    } catch (err) {
      console.error('Upload error:', err)
      setUploadProgress(`Error: ${err.message}`)
      setTimeout(() => setUploadProgress(''), 3000)
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (action) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/content-request/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, action }),
      })
      if (!res.ok) throw new Error('Failed to update status')

      const newStatus = action === 'submit' ? 'Submitted' : 'Draft'
      onUpdate(item.id, { status: newStatus })
    } catch (err) {
      console.error('Submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div
      data-upload-item
      style={{
        background: isSubmitted ? '#f0fdf4' : needsRevision ? '#fef2f2' : '#fff',
        borderRadius: 12,
        padding: '24px 28px',
        marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        border: `1px solid ${isSubmitted ? '#bbf7d0' : needsRevision ? '#fecaca' : '#eee'}`,
      }}
    >
      {/* Status banner */}
      {isSubmitted && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#dcfce7', borderRadius: 6, fontSize: 13, color: '#16a34a' }}>
          <span style={{ fontSize: 16 }}>✓</span>
          The answer is saved and submitted for approval.
        </div>
      )}
      {needsRevision && item.adminNotes && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
          <span style={{ fontSize: 14 }}>!</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Revision requested:</div>
            {item.adminNotes}
          </div>
        </div>
      )}

      {/* Item label */}
      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', margin: '0 0 8px 0' }}>
        {item.label}
        {!isSubmitted && !hasDraft && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
      </h3>

      {/* Script text (for voice/sexting items) */}
      {item.scriptText && (
        <div style={{
          fontSize: 14,
          color: '#555',
          marginBottom: 16,
          padding: '12px 16px',
          background: '#f9f9f9',
          borderRadius: 8,
          lineHeight: 1.6,
          fontStyle: 'italic',
        }}>
          {item.scriptText}
        </div>
      )}

      {/* Uploaded file display */}
      {hasFile && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: '#f9f9f9',
          borderRadius: 8,
          marginBottom: 16,
        }}>
          <div style={{ width: 36, height: 36, background: '#e5e5e5', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#999' }}>
            📄
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.fileName}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              {formatFileSize(item.fileSize)}
              {item.uploadedAt && ` — Uploaded ${new Date(item.uploadedAt).toLocaleDateString()}`}
            </div>
          </div>
          {item.dropboxLink && (
            <a
              href={item.dropboxLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: '#7c3aed', textDecoration: 'none', fontWeight: 500 }}
            >
              Preview
            </a>
          )}
        </div>
      )}

      {/* Upload zone (show when no file or revising) */}
      {(!hasFile || needsRevision) && !uploading && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFileSelect(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#7c3aed' : '#ddd'}`,
            borderRadius: 8,
            padding: '32px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? '#faf5ff' : '#fafafa',
            transition: 'all 0.15s',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8, color: '#ccc' }}>📁</div>
          <div style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
            Click to select one or more files
          </div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
            Or drag and drop here
          </div>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            accept={item.acceptedFileTypes || '*'}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: '#7c3aed',
          fontSize: 13,
          marginBottom: 16,
        }}>
          <div style={{ width: 24, height: 24, border: '3px solid #e5e5e5', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
          {uploadProgress}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {isSubmitted ? (
          <button
            onClick={() => handleSubmit('revise')}
            disabled={submitting}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              padding: '8px 20px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'uppercase',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            Revise
          </button>
        ) : (
          <>
            {hasFile && (
              <button
                onClick={() => handleSubmit('submit')}
                disabled={submitting || !hasFile}
                style={{
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: hasFile ? 'pointer' : 'not-allowed',
                  textTransform: 'uppercase',
                  opacity: submitting || !hasFile ? 0.6 : 1,
                }}
              >
                Submit for Review
              </button>
            )}
            {hasFile && (
              <>
                <span style={{ color: '#999', fontSize: 12 }}>or</span>
                <button
                  onClick={() => handleSubmit('save_draft')}
                  disabled={submitting}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#7c3aed',
                    fontSize: 12,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Save draft and continue
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
