'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

// ─── Library helpers ───────────────────────────────────────────────────────────

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}
function isVideo(url) { return !!url && /\.(mp4|mov|avi|webm|mkv)/i.test(url) }
function isPhoto(url) { return !!url && /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i.test(url) }

const LIB_PAGE_SIZE = 15

function LibraryCard({ asset, onAssign, assigning, forcePhoto = false }) {
  const link = asset.dropboxLinks?.[0] || asset.dropboxLink || ''
  const rawUrl = rawDropboxUrl(link)
  const videoFile = !forcePhoto && isVideo(link)
  const photoFile = forcePhoto || isPhoto(link)

  return (
    <div style={{ background: '#FFF5F7', border: '1px solid #FFF0F3', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', aspectRatio: videoFile ? '9/16' : '3/4', maxHeight: '320px', overflow: 'hidden', background: '#FFF5F7' }}>
        {videoFile && rawUrl ? (
          <video src={rawUrl} autoPlay muted loop playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
        ) : photoFile && rawUrl ? (
          <img src={rawUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '28px' }}>&#127916;</div>
        )}
        {asset.uploadWeek && (
          <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.75)', color: '#999', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>
            {asset.uploadWeek}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        {asset.name && (
          <div style={{ fontSize: '11px', color: '#888', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</div>
        )}
        {asset.creatorNotes && (
          <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.3 }}>{asset.creatorNotes}</div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{ textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: '#FFF0F3', color: '#999', border: '1px solid #E8C4CC', borderRadius: '6px', textDecoration: 'none' }}>
              View ↗
            </a>
          )}
          <button onClick={() => onAssign(asset)} disabled={!!assigning}
            style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 700, background: assigning === asset.id ? '#FFF0F3' : '#FFF0F3', color: assigning === asset.id ? '#D4A0B0' : '#E88FAC', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: assigning ? 'default' : 'pointer', opacity: assigning && assigning !== asset.id ? 0.5 : 1 }}>
            {assigning === asset.id ? 'Starting…' : 'Start Edit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LibPickerPaginator({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <button onClick={() => onChange(page - 1)} disabled={page <= 1}
        style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: page <= 1 ? '#E8C4CC' : '#999', fontSize: '13px', cursor: page <= 1 ? 'default' : 'pointer', padding: '3px 10px' }}>‹</button>
      <span style={{ fontSize: '12px', color: '#999' }}>{page} / {totalPages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
        style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: page >= totalPages ? '#E8C4CC' : '#999', fontSize: '13px', cursor: page >= totalPages ? 'default' : 'pointer', padding: '3px 10px' }}>›</button>
    </div>
  )
}

// ─── Slot label helper ─────────────────────────────────────────────────────────
// 11 AM ET = Morning Post, 7 PM ET = Evening Post (DST-aware)
function getETHour(isoDateString) {
  if (!isoDateString) return -1
  return parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(isoDateString)))
}

export function getSlotLabel(isoDateString) {
  if (!isoDateString) return ''
  const etHour = getETHour(isoDateString)
  if (etHour === 11) return 'Morning Post'
  if (etHour === 19) return 'Evening Post'
  return new Date(isoDateString).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'America/New_York' })
}

// ─── Quota dots ────────────────────────────────────────────────────────────────

export function QuotaDots({ slotColors, quota, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
        {Array.from({ length: quota }).map((_, i) => {
          const color = slotColors?.[i] || '#F0D0D8'
          const lit = color !== '#F0D0D8'
          const isNewDay = i > 0 && i % 2 === 0
          return (
            <div key={i} style={{ display: 'contents' }}>
              {isNewDay && <div style={{ width: '1px', height: '8px', background: '#E8C4CC', flexShrink: 0 }} />}
              <div style={{
                width: '11px', height: '11px', borderRadius: '50%', flexShrink: 0,
                background: color,
                border: `1.5px solid ${lit ? color : '#E8C4CC'}`,
                transition: 'all 0.2s',
              }} />
            </div>
          )
        })}
      </div>
      <span style={{ fontSize: '12px', color: done >= quota ? '#22c55e' : '#999', fontWeight: 500, flexShrink: 0 }}>
        {done}/{quota}
      </span>
    </div>
  )
}

// ─── Section label ─────────────────────────────────────────────────────────────

const SECTION = {
  needsRevision: { dot: '#ef4444', label: 'Needs Revision' },
  queue:         { dot: '#E88FAC', label: 'Ready to Edit' },
  inProgress:    { dot: '#3b82f6', label: 'In Editing' },
  inReview:      { dot: '#22c55e', label: 'Sent for Review' },
}

export function SectionLabel({ type, count }) {
  const s = SECTION[type]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      <span style={{ fontSize: '11px', fontWeight: 700, color: s.dot, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {s.label}
      </span>
      <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 500 }}>({count})</span>
    </div>
  )
}

// ─── Upload / Submit Modal ─────────────────────────────────────────────────────

export function SubmitModal({ task, creatorName, creatorId, isRevision, onClose, onSubmit }) {
  const [file, setFile] = useState(null)
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const handleSubmit = async () => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      setProgress('Preparing upload...')

      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, creatorId }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId, uploadFolder } = await tokenRes.json()
      const exportFolder = uploadFolder

      const titleSlug = (task.inspo.title || 'edit').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50)
      const creatorSlug = (creatorName || 'creator').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
      const suffix = isRevision ? 'REVISION' : 'EDITED'
      const fileName = `${titleSlug}_${creatorSlug}_${suffix}_${timestamp}.${ext}`

      setProgress(`Uploading ${fileName}...`)
      const buffer = await file.arrayBuffer()
      const filePath = `${exportFolder}/${fileName}`
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

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
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed: ${await dbxRes.text()}`)
      const result = await dbxRes.json()

      setProgress('Creating share link...')
      let sharedLink = ''
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: result.path_display }),
        })
        if (linkRes.ok) sharedLink = (await linkRes.json()).url || ''
      } catch {}

      setProgress('Submitting...')
      await onSubmit(task.id, sharedLink, result.path_display, notes)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}
    >
      <div
        style={{ background: '#ffffff', border: '1px solid #E8C4CC', borderRadius: '16px', padding: '28px', width: '460px', maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>
          {isRevision ? 'Upload Revision' : 'Submit Edit for Review'}
        </h3>
        <p style={{ fontSize: '12px', color: '#999', marginBottom: '20px' }}>
          {task.inspo.title || task.name} · {creatorName}
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
          onDragOver={e => e.preventDefault()}
          style={{
            border: `2px dashed ${file ? '#22c55e' : '#E8C4CC'}`, borderRadius: '10px',
            padding: '28px', textAlign: 'center', cursor: 'pointer',
            background: file ? '#dcfce7' : 'transparent',
          }}
        >
          {file ? (
            <>
              <div style={{ fontSize: '13px', color: '#22c55e', fontWeight: 600 }}>{file.name}</div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB · click to change
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: '#888' }}>Drop video here or click to browse</div>
              <div style={{ fontSize: '11px', color: '#bbb', marginTop: '4px' }}>MP4, MOV</div>
            </>
          )}
          <input ref={fileRef} type="file" accept="video/*,.mp4,.mov" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
        </div>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes for reviewer (optional)"
          disabled={uploading}
          style={{
            width: '100%', marginTop: '12px', padding: '10px 12px',
            background: '#FFF5F7', border: '1px solid #E8C4CC', borderRadius: '8px',
            color: '#4a4a4a', fontSize: '13px', resize: 'vertical', minHeight: '60px',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />

        {error && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px' }}>{error}</p>}
        {progress && <p style={{ fontSize: '12px', color: '#E88FAC', marginTop: '8px' }}>{progress}</p>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '9px 18px', border: 'none', borderRadius: '8px', color: '#1a1a1a', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: '#E8C4CC' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!file || uploading}
            style={{
              padding: '9px 22px', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              background: !file || uploading ? '#E8C4CC' : isRevision ? '#ef4444' : '#E88FAC',
              opacity: uploading ? 0.6 : 1,
            }}>
            {uploading ? 'Uploading...' : isRevision ? 'Submit Revision' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Task card ─────────────────────────────────────────────────────────────────

export function TaskCard({ task, type, creatorName, onAction, updating }) {
  const [expanded, setExpanded] = useState(false)
  const borderColors = {
    needsRevision: '#f5c6c6',
    queue:         '#E8C4CC',
    inProgress:    '#bfdbfe',
    inReview:      '#bbf7d0',
  }

  return (
    <div style={{
      background: '#FFF5F7', border: `1px solid ${borderColors[type]}`, borderRadius: '12px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Thumbnail strip: inspo → creator clip */}
      <div style={{ display: 'flex', height: '155px', background: '#FFF5F7' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.inspo.thumbnail ? (
            <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '11px' }}>No thumbnail</div>
          )}
          <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', color: '#E88FAC', fontWeight: 700, letterSpacing: '0.06em' }}>
            INSPO
          </div>
        </div>

        <div style={{ width: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '13px', flexShrink: 0 }}>→</div>

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.asset.dropboxLink ? (
            <a href={task.asset.dropboxLinks?.[0] || task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', width: '100%', height: '100%', textDecoration: 'none' }}>
              {task.asset.thumbnail ? (
                <img src={task.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#dcfce7', gap: '4px' }}>
                  <svg style={{ width: '24px', height: '24px', color: '#22c55e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span style={{ fontSize: '10px', color: '#22c55e', fontWeight: 600 }}>Download</span>
                </div>
              )}
            </a>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '11px' }}>No clip yet</div>
          )}
          <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', color: '#22c55e', fontWeight: 700, letterSpacing: '0.06em' }}>
            CLIP
          </div>
          {task.asset.dropboxLinks?.length > 1 && (
            <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', color: '#f59e0b', fontWeight: 600 }}>
              {task.asset.dropboxLinks.length} clips
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#2a2a2a', lineHeight: 1.3 }}>
            {task.inspo.title || task.name || 'Untitled'}
          </div>
          {task.inspo.username && (
            <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>@{task.inspo.username}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {task.inspo.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', padding: '2px 8px', background: '#FFF0F3', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
              Original ↗
            </a>
          )}
          {task.asset.dropboxLinks?.length > 1
            ? task.asset.dropboxLinks.map((link, i) => (
                <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#dcfce7', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
                  Clip {i + 1} ↗
                </a>
              ))
            : task.asset.dropboxLink ? (
                <a href={task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#dcfce7', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
                  Creator Clips ↗
                </a>
              ) : null
          }
        </div>

        {type === 'needsRevision' && task.adminFeedback && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
              Feedback from reviewer
            </div>
            <div style={{ fontSize: '12px', color: '#b91c1c', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {task.adminFeedback}
            </div>
            {task.adminScreenshots?.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                {task.adminScreenshots.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', width: '56px', height: '56px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #fecaca', flexShrink: 0 }}>
                    <img src={url} alt={`Screenshot ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {(task.creatorNotes || task.asset.creatorNotes) && (
          <div style={{ fontSize: '11px', color: '#999', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600, color: '#aaa' }}>Creator: </span>
            {task.creatorNotes || task.asset.creatorNotes}
          </div>
        )}

        {task.inspo.notes && (
          <button onClick={() => setExpanded(p => !p)}
            style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
            {expanded ? '▾ Hide direction' : '▸ View direction'}
          </button>
        )}

        {expanded && (
          <div style={{ background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: '#4a4a4a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.inspo.notes}</div>
            {task.inspo.onScreenText && (
              <div style={{ fontSize: '11px', color: '#f59e0b', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '4px', padding: '6px 8px' }}>
                "{task.inspo.onScreenText}"
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
          {type === 'queue' && (
            <button onClick={() => onAction('startEditing', task)} disabled={updating}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: '#dcfce7', color: '#22c55e', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
              {updating ? 'Starting...' : 'Start Editing'}
            </button>
          )}
          {type === 'inProgress' && (
            <button onClick={() => onAction('submit', task)}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E88FAC', borderRadius: '8px', cursor: 'pointer' }}>
              Submit for Review
            </button>
          )}
          {type === 'needsRevision' && (
            <button onClick={() => onAction('revision', task)}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: '#fef2f2', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '8px', cursor: 'pointer' }}>
              Upload Revision
            </button>
          )}
          {type === 'inReview' && (
            <div style={{ textAlign: 'center', padding: '9px', fontSize: '12px', color: '#22c55e', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
              Submitted · Awaiting review
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Library Picker Modal (for empty slots) ────────────────────────────────────

function LibraryPickerModal({ creator, onClose, onRefresh, onTaskCreated }) {
  const [library, setLibrary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  const [err, setErr] = useState('')
  const [activeTab, setActiveTab] = useState('videos')
  const [page, setPage] = useState(1)
  const [sortOrder, setSortOrder] = useState('newest')

  useEffect(() => {
    fetch(`/api/editor/creator/${creator.id}`)
      .then(r => r.json())
      .then(d => { setLibrary(d.library || []); setLoading(false) })
      .catch(() => { setErr('Failed to load library'); setLoading(false) })
  }, [creator.id])

  const handleAssign = async (asset) => {
    setAssigning(asset.id)
    setErr('')
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, creatorId: creator.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (onTaskCreated) {
        onTaskCreated(data.taskId, asset)
      } else {
        await onRefresh()
        onClose()
      }
    } catch (e) {
      setErr(e.message)
      setAssigning(null)
    }
  }

  const sortedLibrary = library ? [...library].sort((a, b) => {
    const da = new Date(a.createdTime || a.createdAt || 0), db = new Date(b.createdTime || b.createdAt || 0)
    return sortOrder === 'newest' ? db - da : da - db
  }) : []
  const videos = sortedLibrary.filter(a => a.assetType === 'Video' || (!a.assetType && isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const photos = sortedLibrary.filter(a => a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && isPhoto(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const tabs = [
    { key: 'videos', label: 'Videos', count: videos.length },
    { key: 'photos', label: 'Photos', count: photos.length },
  ].filter(t => t.count > 0)
  const shown = activeTab === 'videos' ? videos : photos
  const totalPages = Math.ceil(shown.length / LIB_PAGE_SIZE)
  const paged = shown.slice((page - 1) * LIB_PAGE_SIZE, page * LIB_PAGE_SIZE)

  const switchTab = key => { setActiveTab(key); setPage(1) }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#ffffff', border: '1px solid #F0D0D8', borderRadius: '16px', width: '100%', maxWidth: '1100px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid #F0D0D8', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a' }}>Unreviewed Library</div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{creator.name}</div>
          </div>
          {tabs.length > 1 && !loading && (
            <div style={{ display: 'flex', gap: '4px', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '3px' }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => switchTab(t.key)}
                  style={{ padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: activeTab === t.key ? '#FFF0F3' : 'transparent',
                    color: activeTab === t.key ? '#4a4a4a' : '#999' }}>
                  {t.label} <span style={{ color: activeTab === t.key ? '#999' : '#aaa', fontWeight: 400 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && (
            <div style={{ display: 'flex', gap: '4px', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '3px' }}>
              {[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }].map(s => (
                <button key={s.key} onClick={() => { setSortOrder(s.key); setPage(1) }}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: sortOrder === s.key ? '#FFF0F3' : 'transparent',
                    color: sortOrder === s.key ? '#4a4a4a' : '#999' }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {!loading && totalPages > 1 && (
            <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 28px', flex: 1 }}>
          {loading && <div style={{ color: '#999', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>Loading library…</div>}
          {err && <div style={{ color: '#ef4444', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>{err}</div>}
          {!loading && !err && library?.length === 0 && (
            <div style={{ color: '#aaa', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>No unreviewed clips found for {creator.name}.</div>
          )}
          {!loading && paged.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
              {paged.map(asset => (
                <LibraryCard key={asset.id} asset={asset} onAssign={handleAssign} assigning={assigning} forcePhoto={activeTab === 'photos'} />
              ))}
            </div>
          )}
          {!loading && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
              <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Task Detail Modal ─────────────────────────────────────────────────────────

function MediaPanel({ label, link, rawUrl, fallbackThumb, accentColor = '#999' }) {
  const videoSrc = rawUrl && isVideo(link) ? rawUrl : null
  const photoSrc = rawUrl && isPhoto(link) ? rawUrl : null
  const [copied, setCopied] = useState(false)

  const filename = (() => {
    if (!link) return ''
    try {
      const pathname = new URL(link).pathname
      return decodeURIComponent(pathname.split('/').pop() || '')
    } catch { return '' }
  })()

  const copyFilename = async (e) => {
    e.preventDefault()
    if (!filename) return
    await navigator.clipboard.writeText(filename)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: '#FFF5F7', aspectRatio: '9/16', flex: 1 }}>
        {videoSrc ? (
          <video src={videoSrc} autoPlay muted loop playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
        ) : photoSrc ? (
          <img src={photoSrc} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : fallbackThumb ? (
          <img src={fallbackThumb} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '32px' }}>&#127916;</div>
        )}
      </div>
      {link && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <a href={link} target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, display: 'block', textAlign: 'center', padding: '7px', fontSize: '12px', fontWeight: 600, background: '#FFF5F7', color: accentColor, border: `1px solid #E8C4CC`, borderRadius: '7px', textDecoration: 'none' }}>
            Open ↗
          </a>
          {filename && (
            <button onClick={copyFilename}
              style={{ padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: copied ? '#dcfce7' : '#FFF5F7', color: copied ? '#22c55e' : '#999', border: `1px solid ${copied ? '#bbf7d0' : '#E8C4CC'}`, borderRadius: '7px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
              {copied ? '✓' : 'Copy Name'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function TaskDetailModal({ slot, creator, onAction, onInspoClipStart, updating, onClose, onSaved, onRefresh }) {
  const task = slot.task || null
  const clip = slot.clip || null
  const isClip = slot.type === 'inspoClip'
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState('')

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const handleCancelEdit = async () => {
    setCancelling(true)
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task?.id, assetId: task?.asset?.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onClose()
      onRefresh?.()
    } catch (err) {
      setCancelling(false)
      setConfirmCancel(false)
    }
  }

  // Editor submit tool state
  const [editorTab, setEditorTab] = useState('upload') // 'create' | 'upload'
  const [caption, setCaption] = useState('')
  const [yPosition, setYPosition] = useState(75)
  const [rendering, setRendering] = useState(false)
  const [renderId, setRenderId] = useState(null)
  const [renderStatus, setRenderStatus] = useState('idle') // idle | rendering | succeeded | failed
  const [renderUrl, setRenderUrl] = useState(null)
  const [renderErr, setRenderErr] = useState('')
  const [uploadUrl, setUploadUrl] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef(null)

  const inspo = task?.inspo || clip?.inspo || {}
  const assetLink = task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || clip?.dropboxLink || ''
  const assetRawUrl = rawDropboxUrl(assetLink)
  const inspoLink = inspo.dbShareLink || inspo.contentLink || ''
  const inspoRawUrl = inspo.dbShareLink ? rawDropboxUrl(inspo.dbShareLink) : ''
  const editedLink = task?.asset?.editedFileLink || ''
  const editedRawUrl = rawDropboxUrl(editedLink)

  // Compute actual status badge from task data
  const adminStatus = task?.adminReviewStatus || ''
  const statusBadge = adminStatus === 'Approved'
    ? { label: 'Approved', color: '#22c55e', bg: '#dcfce7', border: '#bbf7d0' }
    : adminStatus === 'Pending Review'
    ? { label: 'In Review', color: '#22c55e', bg: '#dcfce7', border: '#bbf7d0' }
    : adminStatus === 'Needs Revision'
    ? { label: 'Needs Revision', color: '#ef4444', bg: '#fef2f2', border: '#fecaca' }
    : null

  const handleClipStart = async () => {
    setStarting(true)
    setStartErr('')
    try {
      await onInspoClipStart(clip)
      onClose()
    } catch (err) {
      setStartErr(err.message)
      setStarting(false)
    }
  }

  // Poll for render completion
  useEffect(() => {
    if (!renderId || renderStatus !== 'rendering') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/editor/render/${renderId}`)
        const data = await res.json()
        if (data.status === 'succeeded') {
          setRenderStatus('succeeded')
          setRenderUrl(data.url)
          clearInterval(interval)
        } else if (data.status === 'failed') {
          setRenderStatus('failed')
          setRenderErr(data.errorMessage || 'Render failed')
          clearInterval(interval)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [renderId, renderStatus])

  const handleFileUpload = async (file) => {
    if (!file) return
    setUploadProgress('Preparing upload...')
    setUploadError('')
    try {
      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator?.id }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId, uploadFolder } = await tokenRes.json()

      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
      const taskSlug = (task?.name || 'edit').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const fileName = `${taskSlug}_EDITED_${timestamp}.${ext}`
      const filePath = `${uploadFolder}/${fileName}`

      setUploadProgress(`Uploading ${fileName}...`)
      const buffer = await file.arrayBuffer()
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

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
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed: ${await dbxRes.text()}`)
      const result = await dbxRes.json()

      setUploadProgress('Creating share link...')
      let sharedLink = ''
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: result.path_display }),
        })
        if (linkRes.ok) sharedLink = (await linkRes.json()).url || ''
      } catch {}

      await handleSave(sharedLink || filePath)
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploadProgress('')
    }
  }

  const handleRender = async () => {
    const clipUrl = rawDropboxUrl(task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || '')
    if (!clipUrl) { setRenderErr('No clip URL found'); return }
    if (!caption.trim()) { setRenderErr('Enter a caption first'); return }
    setRendering(true)
    setRenderErr('')
    setRenderUrl(null)
    setRenderStatus('rendering')
    try {
      const res = await fetch('/api/editor/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipUrl, caption: caption.trim(), yPosition, safeZone: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Render failed')
      setRenderId(data.renderId)
    } catch (err) {
      setRenderStatus('failed')
      setRenderErr(err.message)
    } finally {
      setRendering(false)
    }
  }

  const handleSave = async (url) => {
    if (!url) return
    setSaving(true)
    setSaveErr('')
    try {
      const res = await fetch('/api/editor/save-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: task?.asset?.id || null,
          taskId: task?.id || null,
          editedFileLink: url,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setSaved(true)
      setTimeout(() => {
        if (onSaved) onSaved(task)
        else onClose()
      }, 1200)
    } catch (err) {
      setSaveErr(err.message)
    } finally {
      setSaving(false)
    }
  }

  const title = inspo.title || task?.name || clip?.inspo?.title || 'Edit task'
  const username = inspo.username || ''
  const creatorNotes = task?.asset?.creatorNotes || clip?.creatorNotes || task?.creatorNotes || ''

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '24px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#ffffff', border: '1px solid #F0D0D8', borderRadius: '16px', width: '100%', maxWidth: '1050px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header bar */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #F0D0D8', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
              {creator?.name && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#E88FAC', background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '4px', padding: '2px 8px', flexShrink: 0 }}>
                  {creator.name}
                </span>
              )}
            </div>
            {username && <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>@{username}</div>}
          </div>
          {statusBadge && (
            <span style={{ fontSize: '11px', fontWeight: 700, color: statusBadge.color, background: statusBadge.bg, border: `1px solid ${statusBadge.border}`, borderRadius: '4px', padding: '3px 10px', flexShrink: 0 }}>{statusBadge.label}</span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', fontSize: '22px', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Body — two columns */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* LEFT — media panels */}
          <div style={{ width: '50%', padding: '20px', borderRight: '1px solid #F0D0D8', display: 'flex', gap: '12px', overflow: 'hidden' }}>
            {editedLink ? (
              <>
                <MediaPanel
                  label="Submitted Edit"
                  link={editedLink}
                  rawUrl={editedRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || ''}
                  accentColor="#E88FAC"
                />
                <MediaPanel
                  label="Raw Clip"
                  link={assetLink}
                  rawUrl={assetRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || clip?.thumbnail || ''}
                  accentColor="#999"
                />
              </>
            ) : (
              <>
                <MediaPanel
                  label={isClip ? 'Creator Upload' : 'Creator Clip'}
                  link={assetLink}
                  rawUrl={assetRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || clip?.thumbnail || ''}
                  accentColor="#22c55e"
                />
                <MediaPanel
                  label="Inspo"
                  link={inspoLink}
                  rawUrl={inspoRawUrl}
                  fallbackThumb={inspo.thumbnail || ''}
                  accentColor="#E88FAC"
                />
              </>
            )}
          </div>

          {/* RIGHT — info + action */}
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>

            {/* Admin feedback */}
            {task?.adminFeedback && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>Admin Feedback</div>
                <div style={{ fontSize: '12px', color: '#b91c1c', lineHeight: 1.5 }}>{task.adminFeedback}</div>
              </div>
            )}

            {/* Admin screenshots */}
            {task?.adminScreenshots?.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Reference Screenshots</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {task.adminScreenshots.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', flexShrink: 0 }}>
                      <img src={url} alt={`Screenshot ${i + 1}`} style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #E8C4CC', cursor: 'pointer' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Direction */}
            {inspo.notes && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Direction</div>
                <div style={{ fontSize: '12px', color: '#4a4a4a', lineHeight: 1.6, background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '10px 12px', whiteSpace: 'pre-wrap' }}>
                  {inspo.notes}
                </div>
              </div>
            )}

            {/* On-screen text */}
            {inspo.onScreenText && (
              <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>On-Screen Text</div>
                <div style={{ fontSize: '12px', color: '#92400e' }}>"{inspo.onScreenText}"</div>
              </div>
            )}

            {/* Creator notes */}
            {creatorNotes && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Creator Notes</div>
                <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.5, background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '10px 12px' }}>
                  {creatorNotes}
                </div>
              </div>
            )}

            {/* Tags */}
            {inspo.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {inspo.tags.map(tag => (
                  <span key={tag} style={{ fontSize: '11px', color: '#999', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '4px', padding: '2px 8px' }}>{tag}</span>
                ))}
              </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Action button */}
            {slot.type === 'toDo' && (
              <button onClick={() => onAction('startEditing', task)} disabled={updating}
                style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: '#dcfce7', color: '#22c55e', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
                {updating ? 'Starting...' : 'Start Editing →'}
              </button>
            )}
            {slot.type === 'inProgress' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Tab switcher */}
                <div style={{ display: 'flex', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '3px', gap: '3px' }}>
                  {['create', 'upload', 'asis'].map(tab => (
                    <button key={tab} onClick={() => setEditorTab(tab)}
                      style={{ flex: 1, padding: '7px', fontSize: '11px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', background: editorTab === tab ? '#FFF0F3' : 'transparent', color: editorTab === tab ? '#1a1a1a' : '#999' }}>
                      {tab === 'create' ? 'Creatomate' : tab === 'upload' ? 'Upload' : 'Post As Is'}
                    </button>
                  ))}
                </div>

                {/* CREATE tab */}
                {editorTab === 'create' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Caption Text</div>
                      <textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Type the on-screen text..."
                        rows={2}
                        style={{ width: '100%', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '7px', padding: '8px 10px', fontSize: '13px', color: '#2a2a2a', resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                      />
                    </div>

                    {/* Vertical position picker */}
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                        Position — {yPosition <= 25 ? 'Top' : yPosition <= 55 ? 'Middle' : 'Lower Third'}
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {/* Frame preview */}
                        <div style={{ position: 'relative', width: '54px', height: '96px', background: '#000', borderRadius: '5px', overflow: 'hidden', flexShrink: 0, border: '1px solid #E8C4CC' }}>
                          {task?.asset?.thumbnail && (
                            <img src={task.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }} />
                          )}
                          {/* Safe zone guides */}
                          <div style={{ position: 'absolute', inset: '8% 8%', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '2px', pointerEvents: 'none' }} />
                          {/* Text bar indicator */}
                          <div style={{ position: 'absolute', left: '8%', right: '8%', top: `${yPosition}%`, transform: 'translateY(-50%)', background: 'rgba(232,143,172,0.85)', borderRadius: '2px', padding: '2px 3px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '10px' }}>
                            <span style={{ fontSize: '5px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                              {caption || 'TEXT'}
                            </span>
                          </div>
                        </div>
                        {/* Vertical slider */}
                        <input
                          type="range" min={5} max={95} value={yPosition}
                          onChange={e => setYPosition(Number(e.target.value))}
                          style={{ writingMode: 'vertical-lr', height: '96px', width: '20px', accentColor: '#E88FAC', cursor: 'pointer', flexShrink: 0 }}
                        />
                        <div style={{ fontSize: '11px', color: '#999' }}>{yPosition}%</div>
                      </div>
                    </div>

                    {/* Render result */}
                    {renderUrl && (
                      <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #F0D0D8' }}>
                        <video src={renderUrl} controls muted loop playsInline style={{ width: '100%', display: 'block', maxHeight: '180px', objectFit: 'contain', background: '#000' }} />
                      </div>
                    )}

                    {renderErr && <div style={{ fontSize: '12px', color: '#ef4444' }}>{renderErr}</div>}

                    {renderStatus === 'rendering' && (
                      <div style={{ fontSize: '12px', color: '#E88FAC', textAlign: 'center' }}>Rendering... this takes ~30–40s</div>
                    )}

                    {!renderUrl ? (
                      <button onClick={handleRender} disabled={rendering || renderStatus === 'rendering' || !caption.trim()}
                        style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #D4A0B0', borderRadius: '8px', cursor: (rendering || renderStatus === 'rendering' || !caption.trim()) ? 'not-allowed' : 'pointer', opacity: (rendering || renderStatus === 'rendering' || !caption.trim()) ? 0.5 : 1 }}>
                        {rendering ? 'Starting...' : renderStatus === 'rendering' ? 'Rendering...' : 'Render ↗'}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => { setRenderUrl(null); setRenderId(null); setRenderStatus('idle') }}
                          style={{ flex: 1, padding: '10px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: '#999', border: '1px solid #F0D0D8', borderRadius: '8px', cursor: 'pointer' }}>
                          Re-render
                        </button>
                        <button onClick={() => handleSave(renderUrl)} disabled={saving || saved}
                          style={{ flex: 2, padding: '10px', fontSize: '13px', fontWeight: 700, background: saved ? '#dcfce7' : '#FFF0F3', color: saved ? '#22c55e' : '#E88FAC', border: `1px solid ${saved ? '#bbf7d0' : '#E88FAC'}`, borderRadius: '8px', cursor: (saving || saved) ? 'not-allowed' : 'pointer' }}>
                          {saved ? 'Saved ✓' : saving ? 'Saving...' : 'Save & Submit ↑'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* UPLOAD tab */}
                {editorTab === 'upload' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Drag-and-drop zone */}
                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setUploadFile(f) }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{ border: `2px dashed ${uploadFile ? '#E88FAC' : '#E8C4CC'}`, borderRadius: '10px', padding: '20px', textAlign: 'center', cursor: 'pointer', background: '#FFF5F7', transition: 'border-color 0.2s' }}
                    >
                      <input ref={fileInputRef} type="file" accept="video/*,.mov,.mp4,.m4v" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) setUploadFile(f) }} />
                      {uploadFile ? (
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#E88FAC' }}>{uploadFile.name}</div>
                          <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>{(uploadFile.size / 1024 / 1024).toFixed(1)} MB — click to change</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: '24px', marginBottom: '6px' }}>⬆</div>
                          <div style={{ fontSize: '13px', color: '#999' }}>Drop video here or click to browse</div>
                          <div style={{ fontSize: '11px', color: '#ccc', marginTop: '4px' }}>MP4, MOV supported</div>
                        </div>
                      )}
                    </div>

                    {/* Or paste link */}
                    <div style={{ fontSize: '11px', color: '#ccc', textAlign: 'center' }}>— or paste a Dropbox link —</div>
                    <input type="url" value={uploadUrl} onChange={e => setUploadUrl(e.target.value)}
                      placeholder="https://www.dropbox.com/..."
                      style={{ width: '100%', background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: '#2a2a2a', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />

                    {uploadProgress && <div style={{ fontSize: '12px', color: '#E88FAC' }}>{uploadProgress}</div>}
                    {uploadError && <div style={{ fontSize: '12px', color: '#ef4444' }}>{uploadError}</div>}
                    {saveErr && <div style={{ fontSize: '12px', color: '#ef4444' }}>{saveErr}</div>}

                    <button
                      onClick={() => uploadFile ? handleFileUpload(uploadFile) : handleSave(uploadUrl)}
                      disabled={saving || saved || (!uploadFile && !uploadUrl.trim()) || !!uploadProgress}
                      style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: saved ? '#dcfce7' : '#FFF0F3', color: saved ? '#22c55e' : '#E88FAC', border: `1px solid ${saved ? '#bbf7d0' : '#E88FAC'}`, borderRadius: '8px', cursor: (saving || saved || (!uploadFile && !uploadUrl.trim()) || !!uploadProgress) ? 'not-allowed' : 'pointer', opacity: (!uploadFile && !uploadUrl.trim() && !saved) ? 0.5 : 1 }}>
                      {saved ? 'Saved ✓' : saving || uploadProgress ? 'Uploading...' : 'Save & Submit ↑'}
                    </button>
                  </div>
                )}

                {/* POST AS IS tab */}
                {editorTab === 'asis' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '12px', color: '#999', lineHeight: 1.5, background: '#FFF5F7', border: '1px solid #F0D0D8', borderRadius: '8px', padding: '10px 12px' }}>
                      Sends the raw clip for review with no edits. Use this when the clip doesn't need a caption or any changes.
                    </div>
                    {saveErr && <div style={{ fontSize: '12px', color: '#ef4444' }}>{saveErr}</div>}
                    <button
                      onClick={() => handleSave(task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || '')}
                      disabled={saving || saved}
                      style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: saved ? '#dcfce7' : '#ffffff', color: saved ? '#22c55e' : '#999', border: `1px solid ${saved ? '#bbf7d0' : '#E8C4CC'}`, borderRadius: '8px', cursor: (saving || saved) ? 'not-allowed' : 'pointer' }}>
                      {saved ? 'Submitted ✓' : saving ? 'Submitting...' : 'Submit Raw Clip for Review ↑'}
                    </button>
                  </div>
                )}

                {saveErr && editorTab === 'create' && <div style={{ fontSize: '12px', color: '#ef4444' }}>{saveErr}</div>}
              </div>
            )}
            {isClip && (
              <>
                <button onClick={handleClipStart} disabled={starting}
                  style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: '#fef3c7', color: '#f59e0b', border: '1px solid #fde68a', borderRadius: '8px', cursor: starting ? 'not-allowed' : 'pointer', opacity: starting ? 0.6 : 1 }}>
                  {starting ? 'Starting...' : 'Start Edit →'}
                </button>
                {startErr && <div style={{ fontSize: '12px', color: '#ef4444' }}>{startErr}</div>}
              </>
            )}

            {/* Remove from queue — for active tasks only */}
            {(slot.type === 'toDo' || slot.type === 'inProgress') && task?.id && (
              <div style={{ borderTop: '1px solid #F0D0D8', paddingTop: '12px', marginTop: '4px' }}>
                {!confirmCancel ? (
                  <button onClick={() => setConfirmCancel(true)}
                    style={{ background: 'none', border: 'none', color: '#999', fontSize: '11px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Remove from queue
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#888' }}>Remove this task and reset the clip?</span>
                    <button onClick={handleCancelEdit} disabled={cancelling}
                      style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '5px', padding: '3px 10px', cursor: cancelling ? 'default' : 'pointer' }}>
                      {cancelling ? 'Removing...' : 'Yes, remove'}
                    </button>
                    <button onClick={() => setConfirmCancel(false)}
                      style={{ fontSize: '11px', color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Today's Work slot components ─────────────────────────────────────────────

function SlotContent({ slot }) {
  const task = slot.task
  const clip = slot.clip
  const isDone = slot.type === 'done'
  const isEditing = slot.type === 'inProgress' || slot.type === 'toDo'
  const isClipSlot = slot.type === 'inspoClip'

  if (slot.type === 'empty') {
    return <div style={{ fontSize: '12px', color: '#E8C4CC' }}>+ Assign from library</div>
  }

  // Done/submitted: prefer submitted edit video, fall back to thumbnails
  if (isDone) {
    const editedUrl = task?.asset?.editedFileLink ? rawDropboxUrl(task.asset.editedFileLink) : ''
    const thumb = task?.asset?.thumbnail || task?.inspo?.thumbnail || ''
    const title = task?.inspo?.title || task?.name || ''
    return (
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {editedUrl ? (
          <video src={editedUrl} muted playsInline style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0, opacity: 0.7 }} />
        ) : thumb ? (
          <img src={thumb} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0, opacity: 0.6 }} />
        ) : null}
        <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title || 'Edit task'}
        </div>
      </div>
    )
  }

  // Needs Revision: show red title + feedback snippet
  if (isEditing && task?.adminReviewStatus === 'Needs Revision') {
    const thumb = task?.inspo?.thumbnail || task?.asset?.thumbnail || ''
    const title = task?.inspo?.title || task?.name || ''
    return (
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {thumb && <img src={thumb} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0, border: '1px solid #fecaca' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Edit task'}</div>
          {task.adminFeedback && <div style={{ fontSize: '11px', color: '#999', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.adminFeedback}</div>}
        </div>
      </div>
    )
  }

  // Editing with inspo: show inspo thumbnail + creator clip thumbnail side by side
  if (isEditing && task?.inspo?.thumbnail && task?.asset?.thumbnail) {
    return (
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <img src={task.inspo.thumbnail} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
        <img src={task.asset.thumbnail} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.inspo.title || task.name}</div>
          {task.inspo.username && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>@{task.inspo.username}</div>}
        </div>
      </div>
    )
  }

  // Editing with only inspo (no clip yet) or only a library asset
  if (isEditing) {
    const thumb = task?.inspo?.thumbnail || task?.asset?.thumbnail || ''
    const rawClipUrl = !thumb ? rawDropboxUrl(task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || '') : ''
    const title = task?.inspo?.title || task?.name || ''
    const username = task?.inspo?.username || ''
    return (
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
        ) : rawClipUrl ? (
          <video src={rawClipUrl} muted playsInline style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Edit task'}</div>
          {username && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>@{username}</div>}
        </div>
      </div>
    )
  }

  // inspoClip slot
  const thumb = clip?.thumbnail || clip?.inspo?.thumbnail || ''
  const title = clip?.inspo?.title || clip?.name || ''
  const username = clip?.inspo?.username || ''
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
      {thumb && <img src={thumb} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Creator clip'}</div>
        {username && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>@{username}</div>}
      </div>
    </div>
  )
}

function doneSlotStyle(task) {
  const s = task?.adminReviewStatus || ''
  if (task?.telegramSentAt) return { borderColor: '#bbf7d0', bg: '#f0fdf4', dotColor: '#4ade80', label: 'Sent ✈' }
  if (s === 'Approved') return { borderColor: '#bbf7d0', bg: '#f0fdf4', dotColor: '#22c55e', label: 'Approved ✓' }
  return { borderColor: '#d9f99d', bg: '#fefce8', dotColor: '#a3e635', label: 'In Review' }
}

function CustomCalendar({ selectedDate, todayStr, onSelect, onClose, dateColors = {} }) {
  const initDate = new Date(selectedDate + 'T12:00:00')
  const [calYear, setCalYear] = useState(initDate.getFullYear())
  const [calMonth, setCalMonth] = useState(initDate.getMonth())

  const shiftMonth = (delta) => {
    let m = calMonth + delta, y = calYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setCalMonth(m); setCalYear(y)
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const navBtn = { background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: '#999', fontSize: '14px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }
  const dotColors = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: '6px', background: '#ffffff', border: '1px solid #E8C4CC', borderRadius: '12px', padding: '14px', width: '228px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#4a4a4a' }}>{monthNames[calMonth]} {calYear}</span>
          <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: '10px', color: '#999', fontWeight: 600, padding: '3px 0' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} />
            const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isSel = ds === selectedDate
            const isToday = ds === todayStr
            const color = dateColors[ds]
            return (
              <button key={i} onClick={() => { onSelect(ds); onClose() }}
                style={{ background: isSel ? '#E88FAC' : isToday ? '#FFF0F3' : 'transparent', border: isToday && !isSel ? '1px solid #E8C4CC' : '1px solid transparent', borderRadius: '6px', color: isSel ? '#fff' : isToday ? '#E88FAC' : '#888', fontSize: '12px', fontWeight: isSel || isToday ? 700 : 400, padding: '4px 0 2px', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                <span>{day}</span>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: color ? dotColors[color] : 'transparent', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #F0D0D8' }}>
          <button onClick={() => { onSelect(todayStr); onClose() }}
            style={{ fontSize: '11px', fontWeight: 700, color: '#E88FAC', background: 'none', border: 'none', cursor: 'pointer' }}>Today</button>
        </div>
      </div>
    </>
  )
}

function VideoSlot({ slotLabel, slot, isNext, isLocked, creator, onAction, updating, onRefresh, onSlotClick }) {
  const isNeedsRevision = slot.type === 'inProgress' && slot.task?.adminReviewStatus === 'Needs Revision'
  const typeStyle = isNeedsRevision
    ? { borderColor: '#fecaca', bg: '#fef2f2', dotColor: '#ef4444', label: 'Needs Revision' }
    : slot.type === 'done'
    ? doneSlotStyle(slot.task)
    : {
        inProgress: { borderColor: '#bfdbfe', bg: '#eff6ff', dotColor: '#3b82f6', label: 'In editing' },
        toDo:       { borderColor: '#E8C4CC', bg: '#FFF5F7', dotColor: '#E88FAC', label: 'Ready to edit' },
        inspoClip:  { borderColor: '#fde68a', bg: '#fefce8', dotColor: '#f59e0b', label: 'Creator clip uploaded' },
        empty:      { borderColor: '#F0D0D8', bg: '#FFF5F7', dotColor: '#aaa', label: 'Open slot' },
      }[slot.type] || { borderColor: '#F0D0D8', bg: '#FFF5F7', dotColor: '#aaa', label: '' }

  const isDone = slot.type === 'done'
  const clickable = true
  const opacity = 1

  return (
    <div
      onClick={clickable ? () => onSlotClick(slot) : undefined}
      style={{ border: `1px solid ${typeStyle.borderColor}`, background: typeStyle.bg, borderRadius: '10px', padding: '14px 16px', height: '100px', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: clickable ? 'pointer' : 'default', transition: 'border-color 0.15s', opacity }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.borderColor = typeStyle.dotColor }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = typeStyle.borderColor }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: typeStyle.dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: '10px', fontWeight: 700, color: typeStyle.dotColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {typeStyle.label}
          </span>
        </div>
        {slotLabel && (
          <span style={{ fontSize: '10px', color: '#aaa', marginLeft: 'auto' }}>{slotLabel}</span>
        )}
      </div>
      <SlotContent slot={slot} />
    </div>
  )
}

// ─── Creator section ───────────────────────────────────────────────────────────

function CreatorSection({ creator, onRefresh }) {
  const [updating, setUpdating] = useState(null)
  const [submitModal, setSubmitModal] = useState(null)
  const [taskModal, setTaskModal] = useState(null)
  const [libraryModal, setLibraryModal] = useState(false)
  const [toast, setToast] = useState(null)
  const [dnaModal, setDnaModal] = useState(false)

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  const handleAction = async (type, task) => {
    if (type === 'startEditing') {
      setUpdating(task.id)
      try {
        const res = await fetch('/api/admin/editor', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, newStatus: 'In Progress' }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Update failed')
        showToast('Started editing')
        // Update task modal in-place to show In Progress state — set before refresh
        // so the modal stays open and shows the editing tools immediately
        setTaskModal({ type: 'inProgress', task: { ...task, status: 'In Progress' } })
        await onRefresh()
      } catch (err) {
        showToast(err.message, true)
      } finally {
        setUpdating(null)
      }
    } else if (type === 'submit') {
      setSubmitModal({ task, isRevision: false })
    } else if (type === 'revision') {
      setSubmitModal({ task, isRevision: true })
    }
  }

  const handleInspoClipStart = async (clip) => {
    const res = await fetch('/api/editor/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: clip.id, creatorId: creator.id }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed')
    onRefresh()
  }

  const handleSubmit = async (taskId, editedFileLink, editedFilePath, editorNotes) => {
    const isRevision = submitModal?.isRevision
    const res = await fetch('/api/admin/editor', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, newStatus: 'Done', editedFileLink, editedFilePath, editorNotes, isRevision }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Submit failed')
    const submittedTask = submitModal?.task
    setSubmitModal(null)
    showToast(isRevision ? 'Revision submitted' : 'Edit submitted for review')
    // Update task modal to show In Review state
    setTaskModal({ type: 'inReview', task: { ...submittedTask, status: 'Done', adminReviewStatus: 'Pending Review' } })
    await onRefresh()
  }

  const dailyQuota = creator.dailyQuota || 2
  const estNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const pad = n => String(n).padStart(2, '0')
  const estDs = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const todayDateStr = estDs(estNow)
  const [selectedDate, setSelectedDate] = useState(todayDateStr)
  const [showDatePicker, setShowDatePicker] = useState(false)

  const isToday = selectedDate === todayDateStr

  const shiftDate = (days) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const selectedDayLabel = (() => {
    const d = new Date(selectedDate + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  })()

  // Sort done tasks by when the editor actually completed them (earliest = Morning slot)
  const sortBySlot = arr => [...arr].sort((a, b) =>
    new Date(a.completedAt || 0) - new Date(b.completedAt || 0)
  )

  // Build per-date color map for calendar dots
  const dateColors = (() => {
    const colors = {}

    // Past dates: use completed task data (14-day window), grouped by completedAt date
    const byDate = {}
    for (const t of (creator.recentDone || [])) {
      const d = (t.completedAt || '').split('T')[0]
      if (!d) continue
      if (!byDate[d]) byDate[d] = []
      byDate[d].push(t)
    }
    for (const [date, tasks] of Object.entries(byDate)) {
      const allApproved = tasks.length >= dailyQuota && tasks.every(t => t.adminReviewStatus === 'Approved')
      colors[date] = allApproved ? 'green' : 'yellow'
    }
    // Today: factor in inProgress too
    const todayDone = creator.doneTodayList || []
    const todayIP = creator.inProgress || []
    if (todayDone.length >= dailyQuota) {
      colors[todayDateStr] = todayDone.every(t => t.adminReviewStatus === 'Approved') ? 'green' : 'yellow'
    } else if (todayDone.length > 0 || todayIP.length > 0) {
      colors[todayDateStr] = 'yellow'
    } else {
      colors[todayDateStr] = 'red'
    }
    // All dates: overlay post schedule data (past 60 days + future)
    // Task completion data (recentDone) takes precedence where it exists
    const postsByDate = creator.postsByDate || {}
    // Enumerate 60 days back + 60 days forward
    for (let i = -60; i <= 60; i++) {
      if (i === 0) continue // today handled above
      const d = new Date(todayDateStr + 'T12:00:00')
      d.setDate(d.getDate() + i)
      const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
      if (colors[ds]) continue // already set by recentDone task data
      const count = postsByDate[ds] || 0
      if (count >= dailyQuota) colors[ds] = 'green'
      else if (count > 0) colors[ds] = 'yellow'
      else if (i < 0) colors[ds] = 'red' // past date with no posts = missed
      else colors[ds] = 'red' // future date with no posts scheduled
    }
    return colors
  })()

  // Per-slot colors for quota dots: Sun morning, Sun evening, Mon morning, Mon evening...
  const slotColors = (() => {
    const statusColor = s => {
      if (s === 'Approved') return '#22c55e'
      if (s === 'Pending Review') return '#a3e635'
      if (s === 'Needs Revision') return '#ef4444'
      return '#22c55e'
    }
    const sun = new Date(todayDateStr + 'T12:00:00')
    sun.setDate(sun.getDate() - sun.getDay())
    const colors = []
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(sun); dayDate.setDate(sun.getDate() + d)
      const ds = estDs(dayDate)
      const isToday = ds === todayDateStr
      const isFuture = ds > todayDateStr
      const doneTasks = sortBySlot((creator.recentDone || [])
        .filter(t => t.etSlotDate === ds))
      const ipTasks = isToday ? (creator.inProgress || []) : []
      const qTasks = isToday ? (creator.queue || []) : []
      for (let s = 0; s < dailyQuota; s++) {
        if (s < doneTasks.length) {
          colors.push(statusColor(doneTasks[s].adminReviewStatus))
        } else if (isToday) {
          const ipIdx = s - doneTasks.length
          if (ipIdx < ipTasks.length) colors.push('#60a5fa')
          else if (ipIdx - ipTasks.length < qTasks.length) colors.push('#E88FAC')
          else colors.push('#F0D0D8')
        } else {
          colors.push('#F0D0D8')
        }
      }
    }
    return colors
  })()

  // Done tasks for selected date, sorted by completion time (earliest = Morning slot)
  const selectedDoneList = sortBySlot(
    isToday
      ? (creator.doneTodayList || [])
      : (creator.recentDone || []).filter(t => t.etSlotDate === selectedDate)
  )

  // All active items = in-progress + to-do + inspo clips (in priority order)
  // In-progress stays in the same position it was when it was in the queue
  const allActiveItems = [
    ...creator.inProgress.map(t => ({ type: 'inProgress', task: t })),
    ...creator.queue.map(t => ({ type: 'toDo', task: t })),
    ...(creator.inspoClips || []).map(c => ({ type: 'inspoClip', clip: c })),
  ]

  const slots = []
  selectedDoneList.forEach(t => slots.push({ type: 'done', task: t }))

  // Distribute active items across today + future days
  // Today's done tasks take up today's slots first, then active items fill the rest
  // Future days each get dailyQuota items from the remaining active list
  const isFutureOrToday = selectedDate >= todayDateStr
  if (isFutureOrToday && allActiveItems.length > 0) {
    const todayDoneCount = (creator.doneTodayList || []).length
    const todayAvail = Math.max(0, dailyQuota - todayDoneCount)

    const todayD = new Date(todayDateStr + 'T12:00:00')
    const selD = new Date(selectedDate + 'T12:00:00')
    const daysAhead = Math.round((selD - todayD) / (1000 * 60 * 60 * 24))

    // Today takes first todayAvail items, each future day takes dailyQuota
    const skipCount = isToday ? 0 : (todayAvail + (daysAhead - 1) * dailyQuota)
    const remaining = Math.max(0, dailyQuota - slots.length)

    allActiveItems.slice(skipCount, skipCount + remaining).forEach(item => slots.push(item))
  }

  while (slots.length < dailyQuota) slots.push({ type: 'empty' })

  const allDone = selectedDoneList.length >= dailyQuota

  return (
    <div style={{ background: '#ffffff', border: '1px solid #F0D0D8', borderRadius: '16px', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F0D0D8' }}>
        {/* Row 1: name + See More inline left, Weekly label top right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>{creator.name}</h2>
            <Link href={`/editor/${creator.id}`}
              style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, background: 'transparent', color: '#999', border: '1px solid #E8C4CC', textDecoration: 'none', flexShrink: 0 }}>
              See More →
            </Link>
            {creator.profileSummary && (
              <button onClick={() => setDnaModal(true)}
                style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E88FAC', cursor: 'pointer', flexShrink: 0 }}>
                DNA
              </button>
            )}
          </div>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0, paddingTop: '4px' }}>Weekly</span>
        </div>
        {/* Row 2: status pills — always has at least the 'needed' pill */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
          {creator.needsRevision.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' }}>
              ⚠ {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''}
            </span>
          )}
          {creator.queue.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E8C4CC' }}>
              {creator.queue.length} queued
            </span>
          )}
          {creator.inProgress.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#eff6ff', color: '#60a5fa', border: '1px solid #bfdbfe' }}>
              {creator.inProgress.length} editing
            </span>
          )}
          {creator.inReview.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#fefce8', color: '#a3e635', border: '1px solid #d9f99d' }}>
              {creator.inReview.length} in review
            </span>
          )}
          {(creator.approved || []).length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#dcfce7', color: '#22c55e', border: '1px solid #bbf7d0' }}>
              {creator.approved.length} approved
            </span>
          )}
          {(() => {
            const needed = Math.max(0, creator.quota - creator.doneToday)
            return needed > 0 ? (
              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#ffffff', color: '#aaa', border: '1px solid #E8C4CC' }}>
                {needed} open
              </span>
            ) : null
          })()}
        </div>
        {/* Row 2: quota dots full width */}
        <QuotaDots slotColors={slotColors} quota={creator.quota} done={creator.doneToday} />
      </div>

      {/* Daily Work Slots */}
      <div style={{ padding: '16px 24px' }}>
        {/* Date navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <button onClick={() => shiftDate(-1)}
            style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: '#999', fontSize: '13px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>‹</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowDatePicker(p => !p)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: isToday ? '#E88FAC' : '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isToday ? 'Today · ' : ''}{selectedDayLabel}
              </span>
              <span style={{ fontSize: '10px', color: '#aaa' }}>▾</span>
            </button>
            {showDatePicker && (
              <CustomCalendar
                selectedDate={selectedDate}
                todayStr={todayDateStr}
                onSelect={setSelectedDate}
                onClose={() => setShowDatePicker(false)}
                dateColors={dateColors}
              />
            )}
          </div>
          <button onClick={() => shiftDate(1)}
            style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: '#999', fontSize: '13px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>›</button>
          {!isToday && (
            <button onClick={() => setSelectedDate(todayDateStr)}
              style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '11px', cursor: 'pointer', padding: '0 4px' }}>Today</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Daily</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(() => {
            const slotNames = dailyQuota === 1 ? ['Morning'] :
              dailyQuota === 2 ? ['Morning', 'Evening'] :
              dailyQuota === 3 ? ['Morning', 'Afternoon', 'Evening'] :
              Array.from({ length: dailyQuota }, (_, i) => `Slot ${i + 1}`)
            const d = new Date(selectedDate + 'T12:00:00')
            const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`
            const nextActionableIndex = slots.findIndex(s => s.type !== 'done')
            return slots.map((slot, i) => {
              const isNext = i === nextActionableIndex
              const isLocked = slot.type !== 'done' && !isNext
              // All slots use positional labels. Done tasks use the ET date they were
              // completed on (editor's work day), not the Post's scheduled date.
              let slotLabel
              if (slot.type === 'done') {
                // Use the ET calendar date of completion + position-based slot name
                const etDate = slot.task?.etSlotDate || slot.task?.etCompletedDate || selectedDate
                const [ey, em, ed] = etDate.split('-').map(Number)
                const completionDateLabel = `${em}/${ed}`
                slotLabel = `${completionDateLabel} / ${slotNames[i] || `Slot ${i + 1}`}`
              } else {
                slotLabel = `${dateLabel} / ${slotNames[i] || `Slot ${i + 1}`}`
              }
              return (
                <VideoSlot
                  key={i}
                  slotLabel={slotLabel}
                  slot={slot}
                  isNext={isNext}
                  isLocked={isLocked}
                  creator={creator}
                  onAction={handleAction}
                  updating={updating}
                  onRefresh={onRefresh}
                  onSlotClick={slot => slot.type === 'empty' ? setLibraryModal(true) : setTaskModal(slot)}
                />
              )
            })
          })()}
        </div>
      </div>

      {taskModal && (
        <TaskDetailModal
          slot={taskModal}
          creator={creator}
          onAction={handleAction}
          onInspoClipStart={handleInspoClipStart}
          updating={updating}
          onClose={() => setTaskModal(null)}
          onRefresh={onRefresh}
          onSaved={async (task) => {
            setTaskModal({ type: 'inReview', task: { ...task, status: 'Done', adminReviewStatus: 'Pending Review' } })
            await onRefresh()
          }}
        />
      )}

      {libraryModal && (
        <LibraryPickerModal
          creator={creator}
          onClose={() => setLibraryModal(false)}
          onRefresh={onRefresh}
          onTaskCreated={async (taskId, asset) => {
            setLibraryModal(false)
            // Open task detail modal immediately in editing state (skip the "Start Editing" step)
            const newTask = {
              id: taskId,
              name: `Edit: ${asset.name || ''}`,
              status: 'In Progress',
              asset: {
                id: asset.id,
                dropboxLinks: asset.dropboxLinks || [],
                dropboxLink: asset.dropboxLink || '',
                thumbnail: asset.thumbnail || '',
                creatorNotes: asset.creatorNotes || '',
              },
            }
            setTaskModal({ type: 'inProgress', task: newTask })
            // Fire the status change to In Progress in the background
            try {
              await fetch('/api/admin/editor', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, newStatus: 'In Progress' }),
              })
              onRefresh()
            } catch {}
          }}
        />
      )}

      {submitModal && (
        <SubmitModal
          task={submitModal.task}
          creatorName={creator.name}
          creatorId={creator.id}
          isRevision={submitModal.isRevision}
          onClose={() => setSubmitModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {/* Creator DNA Modal */}
      {dnaModal && (
        <div onClick={() => setDnaModal(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '560px',
            maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>{creator.name}</div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>Creator DNA</div>
              </div>
              <button onClick={() => setDnaModal(false)} style={{
                background: '#f5f5f5', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
                cursor: 'pointer', fontSize: '14px', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✕</button>
            </div>
            <div style={{ padding: '20px 28px 28px' }}>
              {creator.profileSummary && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Profile</div>
                  <div style={{ fontSize: '13px', color: '#4a4a4a', lineHeight: '1.6' }}>{creator.profileSummary}</div>
                </div>
              )}
              {creator.contentDirectionNotes && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Content Direction</div>
                  <div style={{ fontSize: '13px', color: '#4a4a4a', lineHeight: '1.6' }}>{creator.contentDirectionNotes}</div>
                </div>
              )}
              {creator.dosDonts && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Do / Don't</div>
                  <div style={{ fontSize: '12px', color: '#4a4a4a', lineHeight: '1.7', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: '#FAFAFA', borderRadius: '10px', padding: '10px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>{creator.dosDonts}</div>
                </div>
              )}
              {creator.topTags?.length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Top Tags</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {creator.topTags.map(tw => (
                      <span key={tw.tag} style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: '#FFF0F3', color: '#E88FAC', border: '1px solid rgba(0,0,0,0.04)' }}>
                        {tw.tag} · {tw.weight}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#fef2f2' : '#dcfce7',
          color: toast.error ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.error ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ─── Buffer Overview strip ─────────────────────────────────────────────────────

function BufferCreatorCard({ creator }) {
  const bufferDays = creator.bufferDays ?? 0
  const approvedBuffer = creator.approvedBuffer ?? 0
  const pendingEdit = creator.queue.length + creator.inProgress.length + creator.needsRevision.length

  const isRed = bufferDays < 1
  const isYellow = bufferDays >= 1 && bufferDays < 2
  const isGreen = bufferDays >= 2

  const color = isGreen ? '#22c55e' : isYellow ? '#f59e0b' : '#ef4444'
  const bg = isGreen ? '#f0fdf4' : isYellow ? '#fefce8' : '#fef2f2'
  const border = isGreen ? '#bbf7d0' : isYellow ? '#fde68a' : '#fecaca'
  const barBg = isGreen ? '#dcfce7' : isYellow ? '#fef3c7' : '#fee2e2'

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '12px', padding: '16px 18px' }}>
      {/* Name + buffer days */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{creator.name}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '22px', fontWeight: 800, color, lineHeight: 1 }}>{bufferDays}</span>
          <span style={{ fontSize: '11px', color, fontWeight: 600 }}>d runway</span>
        </div>
      </div>

      {/* Buffer bar */}
      <div style={{ height: '4px', background: '#F0D0D8', borderRadius: '2px', marginBottom: '10px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: '2px', background: color,
          width: `${Math.min(100, (bufferDays / 7) * 100)}%`,
          transition: 'width 0.3s',
        }} />
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
        <span style={{ color: '#999' }}>
          <span style={{ color: color, fontWeight: 600 }}>{approvedBuffer}</span> posts scheduled
        </span>
        {pendingEdit > 0 && (
          <span style={{ color: '#999' }}>
            <span style={{ color: '#E88FAC', fontWeight: 600 }}>{pendingEdit}</span> to edit
          </span>
        )}
      </div>

      {/* Revision warning */}
      {creator.needsRevision.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>
          ⚠ {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''} needed
        </div>
      )}
    </div>
  )
}

function BufferOverview({ creators }) {
  const sorted = [...creators].sort((a, b) => (a.bufferDays ?? 0) - (b.bufferDays ?? 0))
  const redCount = creators.filter(c => (c.bufferDays ?? 0) < 1).length
  const allHealthy = redCount === 0 && creators.every(c => (c.bufferDays ?? 0) >= 2)

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '14px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Content Buffer
        </h2>
        {allHealthy ? (
          <span style={{ fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>All creators healthy ✓</span>
        ) : redCount > 0 ? (
          <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>{redCount} creator{redCount > 1 ? 's' : ''} need content</span>
        ) : (
          <span style={{ fontSize: '12px', color: '#f59e0b' }}>Some creators running low</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
        {sorted.map(creator => (
          <BufferCreatorCard key={creator.id} creator={creator} />
        ))}
      </div>
    </div>
  )
}

// ─── Main exported component ───────────────────────────────────────────────────

export function EditorDashboardContent() {
  const { user } = useUser()
  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/editor/dashboard')
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`${res.status}: ${body}`)
      }
      const data = await res.json()
      setCreators(data.creators || [])
    } catch (err) {
      if (!silent) setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div style={{ color: '#bbb', fontSize: '14px', padding: '40px 0' }}>Loading editor dashboard...</div>
  }

  if (error) {
    return <div style={{ color: '#ef4444', fontSize: '14px', padding: '40px 0' }}>{error}</div>
  }

  const totalRevisions = creators.reduce((sum, c) => sum + c.needsRevision.length, 0)
  const totalQueue = creators.reduce((sum, c) => sum + c.queue.length + c.inProgress.length, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <div>
          <span style={{ fontSize: '13px', color: '#999' }}>{greeting}, </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#888' }}>{firstName}</span>
        </div>
        <button onClick={fetchData}
          style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: '#ffffff', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      <BufferOverview creators={creators} />

      {creators.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#aaa', fontSize: '14px', background: '#FFF5F7', borderRadius: '12px', border: '1px solid #F0D0D8' }}>
          No creators assigned — toggle Social Media Editing on a creator to assign them.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {creators.map(creator => (
            <div key={creator.id} style={{ minWidth: 0 }}>
              <CreatorSection creator={creator} onRefresh={() => fetchData(true)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
