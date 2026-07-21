'use client'

import { useState, useRef } from 'react'
import ContentRequestUploadModal from './ContentRequestUploadModal'

const FILE_TYPE_LABELS = {
  'image/*': 'Photos',
  'video/*': 'Videos',
  'audio/*': 'Audio files',
  'image/*,video/*': 'Photos or videos',
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i
const PHOTO_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|opus)$/i

// A Dropbox shared link → an inline-content URL usable as an <img>/<video> src.
// Shared links end in ?...&dl=0; raw=1 serves the bytes inline.
function toRawUrl(link) {
  if (!link) return ''
  if (/[?&]dl=[01]/.test(link)) return link.replace(/([?&])dl=[01]/, '$1raw=1')
  return link + (link.includes('?') ? '&raw=1' : '?raw=1')
}
function kindOf(fileName) {
  const n = fileName || ''
  if (VIDEO_EXT.test(n)) return 'video'
  if (PHOTO_EXT.test(n)) return 'photo'
  if (AUDIO_EXT.test(n)) return 'audio'
  return 'file'
}

export default function ContentRequestSectionCard({
  section,
  hqId,
  requestId,
  accountLabel,
  creatorOpsId,
  month,
  onFilesUploaded,
  onFileDeleted,
}) {
  const [dragOver, setDragOver] = useState(false)
  // Instructions collapsed by default — the expanded wall of text buried the
  // dropzone (Evan 2026-07-20). Long guides live behind "View instructions".
  const [showDescription, setShowDescription] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const [viewing, setViewing] = useState(null) // uploaded file being previewed in the lightbox
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')
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

  // Delete one uploaded file (Airtable record + Dropbox file). "Replace" = delete
  // then upload a new one. Removes it from the section + drops the count.
  const handleDelete = async (file) => {
    if (!file?.id || deletingId) return
    setDeletingId(file.id)
    setDeleteError('')
    try {
      const res = await fetch('/api/content-request/item', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: file.id, dropboxPath: file.dropboxPath || '' }),
      })
      if (!res.ok) {
        let msg = 'Delete failed'
        try { msg = (await res.json()).error || msg } catch { /* non-JSON */ }
        throw new Error(msg)
      }
      if (viewing?.id === file.id) setViewing(null)
      onFileDeleted?.(name, file.id)
    } catch (err) {
      setDeleteError(err.message || 'Delete failed')
    } finally {
      setDeletingId(null)
    }
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
        accountLabel={accountLabel}
        creatorOpsId={creatorOpsId}
        month={month}
        initialFiles={pendingFiles}
        onUploaded={onFilesUploaded}
      />

      {/* Uploaded files — thumbnail grid. Photos show inline (HEIC-safe via the
          server thumbnail route); videos/audio are play tiles. Tap any tile to
          view it big + delete. Delete lives in the viewer (not a tiny grid ×)
          so a stray tap can't nuke a file. */}
      {deleteError && (
        <div style={{ fontSize: 12, color: '#E87878', marginBottom: 8 }}>{deleteError}</div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
          {files.map((file, idx) => {
            const kind = kindOf(file.fileName)
            const isDeleting = deletingId === file.id
            return (
              <div key={file.id || idx}
                title={file.fileName}
                onClick={() => setViewing({ ...file, kind })}
                style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', opacity: isDeleting ? 0.4 : 1, background: 'linear-gradient(135deg, rgba(232,160,160,0.08), rgba(120,180,232,0.05))' }}>
                {kind === 'photo' && file.id ? (
                  <img src={`/api/content-request/thumbnail?itemId=${file.id}&size=sm`} alt={file.fileName} loading="lazy" decoding="async"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 22 }}>
                    {kind === 'audio' ? '♪' : kind === 'video' ? '▶' : ''}
                  </div>
                )}
                {kind === 'video' && (
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <span style={{ color: '#fff', fontSize: 12, marginLeft: 2 }}>▶</span>
                  </div>
                )}
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, padding: '2px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.fileName}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lightbox — view/play the selected upload + delete it */}
      {viewing && (
        <div onClick={() => setViewing(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '94vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {viewing.kind === 'video' ? (
              <video src={toRawUrl(viewing.dropboxLink)} controls playsInline preload="metadata"
                style={{ maxWidth: '94vw', maxHeight: '80vh', borderRadius: 10, background: '#000' }} />
            ) : viewing.kind === 'audio' ? (
              <audio src={toRawUrl(viewing.dropboxLink)} controls style={{ width: 'min(420px, 90vw)' }} />
            ) : viewing.kind === 'photo' && viewing.id ? (
              <img src={`/api/content-request/thumbnail?itemId=${viewing.id}&size=lg`} alt={viewing.fileName}
                style={{ maxWidth: '94vw', maxHeight: '80vh', borderRadius: 10, objectFit: 'contain' }} />
            ) : (
              <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, padding: 40 }}>{viewing.fileName}</div>
            )}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', maxWidth: '60vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewing.fileName}</span>
              <button onClick={() => handleDelete(viewing)} disabled={deletingId === viewing.id}
                style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(232,120,120,0.4)', background: 'rgba(232,120,120,0.12)', color: '#E87878', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {deletingId === viewing.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
            <button onClick={() => setViewing(null)} aria-label="Close"
              style={{ position: 'absolute', top: -6, right: -6, width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
