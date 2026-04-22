'use client'

import { useState, useRef } from 'react'

const FILE_TYPE_LABELS = {
  'image/*': 'Photos',
  'video/*': 'Videos',
  'audio/*': 'Audio files',
  'image/*,video/*': 'Photos or videos',
}

export default function ContentRequestSectionCard({
  section,
  hqId,
  requestId,
  creatorOpsId,
  month,
  onFilesUploaded,
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const fileInputRef = useRef(null)

  const { name, description, minCount, acceptedFileTypes, scripts, files, uploadedCount, itemType } = section
  const metMin = uploadedCount >= minCount
  const progressPercent = minCount > 0 ? Math.min(100, Math.round((uploadedCount / minCount) * 100)) : 0
  const typeLabel = FILE_TYPE_LABELS[acceptedFileTypes] || 'Files'

  const handleFileSelect = async (selectedFiles) => {
    if (!selectedFiles || selectedFiles.length === 0) return

    setUploading(true)
    const fileArray = Array.from(selectedFiles)
    const uploaded = []

    try {
      setUploadProgress('Getting upload credentials...')
      const tokenRes = await fetch('/api/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorHqId: hqId }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload token')
      const { accessToken, rootNamespaceId, creatorName } = await tokenRes.json()

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i]
        setUploadProgress(`Uploading ${i + 1} of ${fileArray.length}: ${file.name}`)

        const ext = file.name.split('.').pop()
        const safeName = `${creatorName}_${Date.now()}_${i + 1}.${ext}`
        const uploadPath = `/Content Requests/${month}/${name}/${safeName}`

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
            'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNamespaceId }),
            'Content-Type': 'application/octet-stream',
          },
          body: file,
        })

        if (!uploadRes.ok) {
          console.error(`Upload failed for ${file.name}:`, await uploadRes.text())
          continue
        }

        const uploadData = await uploadRes.json()
        const actualPath = uploadData.path_display

        // Create shared link
        let dropboxLink = ''
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNamespaceId }),
          },
          body: JSON.stringify({ path: actualPath, settings: { requested_visibility: 'public' } }),
        })
        if (linkRes.ok) {
          dropboxLink = (await linkRes.json()).url
        } else if (linkRes.status === 409) {
          const existing = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNamespaceId }),
            },
            body: JSON.stringify({ path: actualPath, direct_only: true }),
          })
          if (existing.ok) {
            const data = await existing.json()
            if (data.links?.length) dropboxLink = data.links[0].url
          }
        }

        // Save to Airtable
        setUploadProgress(`Saving ${i + 1} of ${fileArray.length}...`)
        const saveRes = await fetch('/api/content-request/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            creatorOpsId,
            section: name,
            dropboxPath: actualPath,
            dropboxLink,
            fileName: file.name,
            fileSize: file.size,
          }),
        })

        if (saveRes.ok) {
          const { recordId } = await saveRes.json()
          uploaded.push({
            id: recordId,
            section: name,
            fileName: file.name,
            fileSize: file.size,
            dropboxLink,
            dropboxPath: actualPath,
            uploadedAt: new Date().toISOString(),
            status: 'Draft',
          })
        }
      }

      if (uploaded.length > 0) {
        onFilesUploaded(name, uploaded)
      }
      setUploadProgress('')
    } catch (err) {
      console.error('Upload error:', err)
      setUploadProgress(`Error: ${err.message}`)
      setTimeout(() => setUploadProgress(''), 3000)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div style={{
      background: 'var(--card-bg-solid)',
      borderRadius: 18,
      padding: '28px 32px',
      marginBottom: 24,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      {/* Section header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', margin: 0, textTransform: 'uppercase' }}>
          {name}
        </h2>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: metMin ? '#16a34a' : uploadedCount > 0 ? '#f59e0b' : '#999',
        }}>
          {uploadedCount} / {minCount}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          height: '100%',
          width: `${progressPercent}%`,
          background: metMin ? '#16a34a' : '#E88FAC',
          borderRadius: 3,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Min count warning */}
      {!metMin && (
        <div style={{
          fontSize: 12,
          color: uploadedCount > 0 ? '#f59e0b' : '#ef4444',
          marginBottom: 12,
          fontWeight: 500,
        }}>
          {uploadedCount === 0
            ? `Minimum ${minCount} ${typeLabel.toLowerCase()} required`
            : `${minCount - uploadedCount} more needed (minimum ${minCount})`
          }
        </div>
      )}
      {metMin && uploadedCount > 0 && (
        <div style={{ fontSize: 12, color: '#16a34a', marginBottom: 12, fontWeight: 500 }}>
          Minimum met
        </div>
      )}

      {/* Description toggle */}
      {description && (
        <div style={{ marginBottom: 16 }}>
          <button
            onClick={() => setShowDescription(!showDescription)}
            style={{
              background: 'none',
              border: 'none',
              color: '#E88FAC',
              fontSize: 13,
              cursor: 'pointer',
              padding: 0,
              fontWeight: 500,
            }}
          >
            {showDescription ? 'Hide instructions' : 'View instructions'} {showDescription ? '▴' : '▾'}
          </button>
          {showDescription && (
            <div style={{
              marginTop: 10,
              padding: '14px 18px',
              background: 'var(--background)',
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.7,
              color: '#444',
              whiteSpace: 'pre-wrap',
            }}>
              {description}
            </div>
          )}
        </div>
      )}

      {/* Scripts (voice messages / sexting) */}
      {scripts && scripts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#666', marginBottom: 8 }}>
            Scripts to record:
          </div>
          <div style={{
            background: 'var(--background)',
            borderRadius: 10,
            padding: '12px 18px',
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            {scripts.map((script, idx) => (
              <div key={idx} style={{
                fontSize: 13,
                color: '#444',
                padding: '6px 0',
                borderBottom: idx < scripts.length - 1 ? '1px solid transparent' : 'none',
                display: 'flex',
                gap: 8,
              }}>
                <span style={{ color: '#E88FAC', fontWeight: 600, minWidth: 20 }}>{idx + 1}.</span>
                <span style={{ fontStyle: 'italic' }}>{script}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drop zone */}
      {!uploading && (
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
            border: `2px dashed ${dragOver ? '#E88FAC' : 'transparent'}`,
            borderRadius: 12,
            padding: '28px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? '#FFF5F7' : '#fafafa',
            transition: 'all 0.15s',
            marginBottom: files.length > 0 ? 16 : 0,
          }}
        >
          <div style={{ fontSize: 13, color: '#666', fontWeight: 500 }}>
            Drop {typeLabel.toLowerCase()} here or click to browse
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
            You can select multiple files at once
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            accept={acceptedFileTypes || '*'}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div style={{
          padding: '24px 20px',
          textAlign: 'center',
          border: '2px solid #E8C4CC',
          borderRadius: 12,
          background: 'var(--background)',
          marginBottom: files.length > 0 ? 16 : 0,
        }}>
          <div style={{
            width: 24,
            height: 24,
            border: '3px solid #F0D0D8',
            borderTopColor: '#E88FAC',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 8px',
          }} />
          <div style={{ fontSize: 13, color: '#E88FAC', fontWeight: 500 }}>{uploadProgress}</div>
        </div>
      )}

      {/* Uploaded files list */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {files.map((file, idx) => (
            <div key={file.id || idx} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'var(--background)',
              borderRadius: 8,
              fontSize: 12,
              color: '#666',
              maxWidth: 220,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {file.fileName}
              </span>
              <span style={{ color: '#aaa', flexShrink: 0 }}>{formatFileSize(file.fileSize)}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
