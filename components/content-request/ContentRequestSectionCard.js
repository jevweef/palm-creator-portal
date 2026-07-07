'use client'

import { useState, useRef } from 'react'
import ContentRequestUploadModal from './ContentRequestUploadModal'

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
  const [dragOver, setDragOver] = useState(false)
  const [showDescription, setShowDescription] = useState(true) // instructions expanded by default
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const fileInputRef = useRef(null)

  const { name, description, minCount, acceptedFileTypes, scripts, files, uploadedCount, itemType } = section
  const metMin = uploadedCount >= minCount
  const progressPercent = minCount > 0 ? Math.min(100, Math.round((uploadedCount / minCount) * 100)) : 0
  const typeLabel = FILE_TYPE_LABELS[acceptedFileTypes] || 'Files'

  // Hand selected/dropped files to the upload modal, which manages the queue.
  const openWith = (fileList) => {
    setPendingFiles(Array.from(fileList || []))
    setModalOpen(true)
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
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', margin: 0, textTransform: 'uppercase' }}>
          {name}
        </h2>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: metMin ? '#7DD3A4' : uploadedCount > 0 ? '#E8C878' : '#999',
        }}>
          {uploadedCount} / {minCount}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          height: '100%',
          width: `${progressPercent}%`,
          background: metMin ? '#7DD3A4' : 'var(--palm-pink)',
          borderRadius: 3,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Min count warning */}
      {!metMin && (
        <div style={{
          fontSize: 12,
          color: uploadedCount > 0 ? '#E8C878' : '#E87878',
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
        <div style={{ fontSize: 12, color: '#7DD3A4', marginBottom: 12, fontWeight: 500 }}>
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
              color: 'var(--palm-pink)',
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
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(240, 236, 232, 0.75)', marginBottom: 8 }}>
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
                <span style={{ color: 'var(--palm-pink)', fontWeight: 600, minWidth: 20 }}>{idx + 1}.</span>
                <span style={{ fontStyle: 'italic' }}>{script}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drop zone — opens the upload queue modal */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          openWith(e.dataTransfer.files)
        }}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--palm-pink)' : 'transparent'}`,
          borderRadius: 12,
          padding: '28px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--background)' : 'var(--card-bg-solid)',
          transition: 'all 0.15s',
          marginBottom: files.length > 0 ? 16 : 0,
        }}
      >
        <div style={{ fontSize: 13, color: 'rgba(240, 236, 232, 0.75)', fontWeight: 500 }}>
          Drop {typeLabel.toLowerCase()} here or click to browse
        </div>
        <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginTop: 4 }}>
          You can select multiple files at once — large files are fine
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          accept={acceptedFileTypes || '*'}
          onChange={(e) => { openWith(e.target.files); e.target.value = '' }}
        />
      </div>

      <ContentRequestUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        sectionName={name}
        acceptedFileTypes={acceptedFileTypes}
        hqId={hqId}
        requestId={requestId}
        creatorOpsId={creatorOpsId}
        month={month}
        initialFiles={pendingFiles}
        onUploaded={onFilesUploaded}
      />

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
              color: 'rgba(240, 236, 232, 0.75)',
              maxWidth: 220,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {file.fileName}
              </span>
              <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>{formatFileSize(file.fileSize)}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
