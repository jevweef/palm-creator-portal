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

const LIB_PAGE_SIZE = 24

function LibraryCard({ asset, onAssign, assigning, forcePhoto = false }) {
  const link = asset.dropboxLinks?.[0] || asset.dropboxLink || ''
  const rawUrl = rawDropboxUrl(link)
  const videoFile = !forcePhoto && isVideo(link)
  const photoFile = forcePhoto || isPhoto(link)

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', aspectRatio: videoFile ? '9/16' : '3/4', maxHeight: '320px', overflow: 'hidden', background: '#080808' }}>
        {videoFile && rawUrl ? (
          <video src={rawUrl} autoPlay muted loop playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
        ) : photoFile && rawUrl ? (
          <img src={rawUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '28px' }}>&#127916;</div>
        )}
        {asset.uploadWeek && (
          <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.75)', color: '#71717a', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>
            {asset.uploadWeek}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        {asset.name && (
          <div style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</div>
        )}
        {asset.creatorNotes && (
          <div style={{ fontSize: '10px', color: '#52525b', lineHeight: 1.3 }}>{asset.creatorNotes}</div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{ textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: '#1a1a1a', color: '#71717a', border: '1px solid #2a2a2a', borderRadius: '6px', textDecoration: 'none' }}>
              View ↗
            </a>
          )}
          <button onClick={() => onAssign(asset)} disabled={!!assigning}
            style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 700, background: assigning === asset.id ? '#0a0a1a' : '#13132e', color: assigning === asset.id ? '#4a4a6e' : '#a78bfa', border: '1px solid #2a2a5e', borderRadius: '6px', cursor: assigning ? 'default' : 'pointer', opacity: assigning && assigning !== asset.id ? 0.5 : 1 }}>
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
        style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: page <= 1 ? '#333' : '#71717a', fontSize: '13px', cursor: page <= 1 ? 'default' : 'pointer', padding: '3px 10px' }}>‹</button>
      <span style={{ fontSize: '12px', color: '#52525b' }}>{page} / {totalPages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
        style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: page >= totalPages ? '#333' : '#71717a', fontSize: '13px', cursor: page >= totalPages ? 'default' : 'pointer', padding: '3px 10px' }}>›</button>
    </div>
  )
}

// ─── Slot label helper ─────────────────────────────────────────────────────────
// 15 UTC = Morning Post (~10 AM EST / 11 AM EDT)
// 23 UTC = Evening Post (~6 PM EST / 7 PM EDT)
export function getSlotLabel(isoDateString) {
  if (!isoDateString) return ''
  const d = new Date(isoDateString)
  const utcHour = d.getUTCHours()
  if (utcHour === 15) return 'Morning Post'
  if (utcHour === 23) return 'Evening Post'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'America/New_York' })
}

// ─── Quota dots ────────────────────────────────────────────────────────────────

export function QuotaDots({ slotColors, quota, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
      <span style={{ fontSize: '9px', fontWeight: 700, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>Weekly</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
        {Array.from({ length: quota }).map((_, i) => {
          const color = slotColors?.[i] || '#1a1a1a'
          const lit = color !== '#1a1a1a'
          const isNewDay = i > 0 && i % 2 === 0
          return (
            <div key={i} style={{ display: 'contents' }}>
              {isNewDay && <div style={{ width: '1px', height: '8px', background: '#2a2a2a', flexShrink: 0 }} />}
              <div style={{
                width: '11px', height: '11px', borderRadius: '50%', flexShrink: 0,
                background: color,
                border: `1.5px solid ${lit ? color : '#2a2a2a'}`,
                transition: 'all 0.2s',
              }} />
            </div>
          )
        })}
      </div>
      <span style={{ fontSize: '12px', color: done >= quota ? '#22c55e' : '#52525b', fontWeight: 500, flexShrink: 0 }}>
        {done}/{quota} this week
      </span>
    </div>
  )
}

// ─── Section label ─────────────────────────────────────────────────────────────

const SECTION = {
  needsRevision: { dot: '#ef4444', label: 'Needs Revision' },
  queue:         { dot: '#a78bfa', label: 'Ready to Edit' },
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
      <span style={{ fontSize: '11px', color: '#3f3f46', fontWeight: 500 }}>({count})</span>
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}
    >
      <div
        style={{ background: '#111', border: '1px solid #333', borderRadius: '16px', padding: '28px', width: '460px', maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
          {isRevision ? 'Upload Revision' : 'Submit Edit for Review'}
        </h3>
        <p style={{ fontSize: '12px', color: '#71717a', marginBottom: '20px' }}>
          {task.inspo.title || task.name} · {creatorName}
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
          onDragOver={e => e.preventDefault()}
          style={{
            border: `2px dashed ${file ? '#22c55e' : '#333'}`, borderRadius: '10px',
            padding: '28px', textAlign: 'center', cursor: 'pointer',
            background: file ? '#0a2e0a' : 'transparent',
          }}
        >
          {file ? (
            <>
              <div style={{ fontSize: '13px', color: '#22c55e', fontWeight: 600 }}>{file.name}</div>
              <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB · click to change
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: '#a1a1aa' }}>Drop video here or click to browse</div>
              <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>MP4, MOV</div>
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
            background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px',
            color: '#d4d4d8', fontSize: '13px', resize: 'vertical', minHeight: '60px',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />

        {error && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px' }}>{error}</p>}
        {progress && <p style={{ fontSize: '12px', color: '#a78bfa', marginTop: '8px' }}>{progress}</p>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '9px 18px', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: '#333' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!file || uploading}
            style={{
              padding: '9px 22px', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              background: !file || uploading ? '#333' : isRevision ? '#ef4444' : '#a78bfa',
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
    needsRevision: '#5c2020',
    queue:         '#2a2a5e',
    inProgress:    '#1a3a6d',
    inReview:      '#1a3a1a',
  }

  return (
    <div style={{
      background: '#0d0d0d', border: `1px solid ${borderColors[type]}`, borderRadius: '12px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Thumbnail strip: inspo → creator clip */}
      <div style={{ display: 'flex', height: '155px', background: '#080808' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.inspo.thumbnail ? (
            <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '11px' }}>No thumbnail</div>
          )}
          <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', color: '#a78bfa', fontWeight: 700, letterSpacing: '0.06em' }}>
            INSPO
          </div>
        </div>

        <div style={{ width: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '13px', flexShrink: 0 }}>→</div>

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.asset.dropboxLink ? (
            <a href={task.asset.dropboxLinks?.[0] || task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', width: '100%', height: '100%', textDecoration: 'none' }}>
              {task.asset.thumbnail ? (
                <img src={task.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f1a0f', gap: '4px' }}>
                  <svg style={{ width: '24px', height: '24px', color: '#22c55e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span style={{ fontSize: '10px', color: '#22c55e', fontWeight: 600 }}>Download</span>
                </div>
              )}
            </a>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '11px' }}>No clip yet</div>
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
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7', lineHeight: 1.3 }}>
            {task.inspo.title || task.name || 'Untitled'}
          </div>
          {task.inspo.username && (
            <div style={{ fontSize: '11px', color: '#52525b', marginTop: '2px' }}>@{task.inspo.username}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {task.inspo.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#13132e', borderRadius: '4px', border: '1px solid #2a2a5e' }}>
              Original ↗
            </a>
          )}
          {task.asset.dropboxLinks?.length > 1
            ? task.asset.dropboxLinks.map((link, i) => (
                <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
                  Clip {i + 1} ↗
                </a>
              ))
            : task.asset.dropboxLink ? (
                <a href={task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
                  Creator Clips ↗
                </a>
              ) : null
          }
        </div>

        {type === 'needsRevision' && task.adminFeedback && (
          <div style={{ background: '#1a0a0a', border: '1px solid #5c2020', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
              Feedback from reviewer
            </div>
            <div style={{ fontSize: '12px', color: '#fca5a5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {task.adminFeedback}
            </div>
            {task.adminScreenshots?.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                {task.adminScreenshots.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', width: '56px', height: '56px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #5c2020', flexShrink: 0 }}>
                    <img src={url} alt={`Screenshot ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {(task.creatorNotes || task.asset.creatorNotes) && (
          <div style={{ fontSize: '11px', color: '#71717a', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600, color: '#3f3f46' }}>Creator: </span>
            {task.creatorNotes || task.asset.creatorNotes}
          </div>
        )}

        {task.inspo.notes && (
          <button onClick={() => setExpanded(p => !p)}
            style={{ background: 'none', border: 'none', color: '#3f3f46', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
            {expanded ? '▾ Hide direction' : '▸ View direction'}
          </button>
        )}

        {expanded && (
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: '#d4d4d8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.inspo.notes}</div>
            {task.inspo.onScreenText && (
              <div style={{ fontSize: '11px', color: '#f59e0b', background: '#1a1500', border: '1px solid #332b00', borderRadius: '4px', padding: '6px 8px' }}>
                "{task.inspo.onScreenText}"
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
          {type === 'queue' && (
            <button onClick={() => onAction('startEditing', task)} disabled={updating}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: '#0a2e0a', color: '#22c55e', border: '1px solid #1a5c1a', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
              {updating ? 'Starting...' : 'Start Editing'}
            </button>
          )}
          {type === 'inProgress' && (
            <button onClick={() => onAction('submit', task)}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: '#0a0a3d', color: '#a78bfa', border: '1px solid #a78bfa', borderRadius: '8px', cursor: 'pointer' }}>
              Submit for Review
            </button>
          )}
          {type === 'needsRevision' && (
            <button onClick={() => onAction('revision', task)}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: '#2d1515', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '8px', cursor: 'pointer' }}>
              Upload Revision
            </button>
          )}
          {type === 'inReview' && (
            <div style={{ textAlign: 'center', padding: '9px', fontSize: '12px', color: '#22c55e', background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: '8px' }}>
              Submitted · Awaiting review
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Library Picker Modal (for empty slots) ────────────────────────────────────

function LibraryPickerModal({ creator, onClose, onRefresh }) {
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
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onRefresh()
      onClose()
    } catch (e) {
      setErr(e.message)
      setAssigning(null)
    }
  }

  const sortedLibrary = library ? [...library].sort((a, b) => {
    const da = new Date(a.createdAt || 0), db = new Date(b.createdAt || 0)
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '16px', width: '100%', maxWidth: '1100px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>Unreviewed Library</div>
            <div style={{ fontSize: '12px', color: '#52525b', marginTop: '2px' }}>{creator.name}</div>
          </div>
          {tabs.length > 1 && !loading && (
            <div style={{ display: 'flex', gap: '4px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '3px' }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => switchTab(t.key)}
                  style={{ padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: activeTab === t.key ? '#1e1e1e' : 'transparent',
                    color: activeTab === t.key ? '#d4d4d8' : '#52525b' }}>
                  {t.label} <span style={{ color: activeTab === t.key ? '#71717a' : '#3f3f46', fontWeight: 400 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && (
            <div style={{ display: 'flex', gap: '4px', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '3px' }}>
              {[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }].map(s => (
                <button key={s.key} onClick={() => { setSortOrder(s.key); setPage(1) }}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: sortOrder === s.key ? '#1e1e1e' : 'transparent',
                    color: sortOrder === s.key ? '#d4d4d8' : '#52525b' }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {!loading && totalPages > 1 && (
            <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 28px', flex: 1 }}>
          {loading && <div style={{ color: '#52525b', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>Loading library…</div>}
          {err && <div style={{ color: '#ef4444', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>{err}</div>}
          {!loading && !err && library?.length === 0 && (
            <div style={{ color: '#3f3f46', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>No unreviewed clips found for {creator.name}.</div>
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

function MediaPanel({ label, link, rawUrl, fallbackThumb, accentColor = '#71717a' }) {
  const videoSrc = rawUrl && isVideo(link) ? rawUrl : null
  const photoSrc = rawUrl && isPhoto(link) ? rawUrl : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: '#080808', aspectRatio: '9/16', flex: 1 }}>
        {videoSrc ? (
          <video src={videoSrc} autoPlay muted loop playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
        ) : photoSrc ? (
          <img src={photoSrc} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : fallbackThumb ? (
          <img src={fallbackThumb} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '32px' }}>&#127916;</div>
        )}
      </div>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', textAlign: 'center', padding: '7px', fontSize: '12px', fontWeight: 600, background: '#0d0d0d', color: accentColor, border: `1px solid #2a2a2a`, borderRadius: '7px', textDecoration: 'none' }}>
          Open ↗
        </a>
      )}
    </div>
  )
}

function TaskDetailModal({ slot, creator, onAction, onInspoClipStart, updating, onClose }) {
  const task = slot.task || null
  const clip = slot.clip || null
  const isClip = slot.type === 'inspoClip'
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState('')

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
    ? { label: 'Approved', color: '#22c55e', bg: '#0a2e0a', border: '#1a5c1a' }
    : adminStatus === 'Pending Review'
    ? { label: 'In Review', color: '#22c55e', bg: '#0a2e0a', border: '#1a4a1a' }
    : adminStatus === 'Needs Revision'
    ? { label: 'Needs Revision', color: '#ef4444', bg: '#2d1515', border: '#5c2020' }
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

  const title = inspo.title || task?.name || clip?.inspo?.title || 'Edit task'
  const username = inspo.username || ''
  const creatorNotes = task?.asset?.creatorNotes || clip?.creatorNotes || task?.creatorNotes || ''

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', padding: '24px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '16px', width: '100%', maxWidth: '1050px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header bar */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            {username && <div style={{ fontSize: '12px', color: '#52525b', marginTop: '2px' }}>@{username}</div>}
          </div>
          {statusBadge && (
            <span style={{ fontSize: '11px', fontWeight: 700, color: statusBadge.color, background: statusBadge.bg, border: `1px solid ${statusBadge.border}`, borderRadius: '4px', padding: '3px 10px', flexShrink: 0 }}>{statusBadge.label}</span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', fontSize: '22px', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Body — two columns */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* LEFT — media panels */}
          <div style={{ width: '50%', padding: '20px', borderRight: '1px solid #1a1a1a', display: 'flex', gap: '12px', overflow: 'hidden' }}>
            {editedLink ? (
              <>
                <MediaPanel
                  label="Submitted Edit"
                  link={editedLink}
                  rawUrl={editedRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || ''}
                  accentColor="#a78bfa"
                />
                <MediaPanel
                  label="Raw Clip"
                  link={assetLink}
                  rawUrl={assetRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || clip?.thumbnail || ''}
                  accentColor="#52525b"
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
                  accentColor="#a78bfa"
                />
              </>
            )}
          </div>

          {/* RIGHT — info + action */}
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>

            {/* Admin feedback */}
            {task?.adminFeedback && (
              <div style={{ background: '#1a0a0a', border: '1px solid #5c2020', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>Admin Feedback</div>
                <div style={{ fontSize: '12px', color: '#fca5a5', lineHeight: 1.5 }}>{task.adminFeedback}</div>
              </div>
            )}

            {/* Direction */}
            {inspo.notes && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Direction</div>
                <div style={{ fontSize: '12px', color: '#d4d4d8', lineHeight: 1.6, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px', padding: '10px 12px', whiteSpace: 'pre-wrap' }}>
                  {inspo.notes}
                </div>
              </div>
            )}

            {/* On-screen text */}
            {inspo.onScreenText && (
              <div style={{ background: '#1a1500', border: '1px solid #332b00', borderRadius: '8px', padding: '8px 12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>On-Screen Text</div>
                <div style={{ fontSize: '12px', color: '#fde68a' }}>"{inspo.onScreenText}"</div>
              </div>
            )}

            {/* Creator notes */}
            {creatorNotes && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Creator Notes</div>
                <div style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: 1.5, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px', padding: '10px 12px' }}>
                  {creatorNotes}
                </div>
              </div>
            )}

            {/* Tags */}
            {inspo.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {inspo.tags.map(tag => (
                  <span key={tag} style={{ fontSize: '11px', color: '#52525b', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '4px', padding: '2px 8px' }}>{tag}</span>
                ))}
              </div>
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Action button */}
            {slot.type === 'toDo' && (
              <button onClick={() => { onAction('startEditing', task); onClose() }} disabled={updating}
                style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: '#0a2e0a', color: '#22c55e', border: '1px solid #1a5c1a', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
                {updating ? 'Starting...' : 'Start Editing →'}
              </button>
            )}
            {slot.type === 'inProgress' && (
              <button onClick={() => { onAction('submit', task); onClose() }}
                style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: '#0a0a3d', color: '#a78bfa', border: '1px solid #a78bfa', borderRadius: '8px', cursor: 'pointer' }}>
                Submit for Review ↑
              </button>
            )}
            {isClip && (
              <>
                <button onClick={handleClipStart} disabled={starting}
                  style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: '#1a1000', color: '#f59e0b', border: '1px solid #5c4000', borderRadius: '8px', cursor: starting ? 'not-allowed' : 'pointer', opacity: starting ? 0.6 : 1 }}>
                  {starting ? 'Starting...' : 'Start Edit →'}
                </button>
                {startErr && <div style={{ fontSize: '12px', color: '#ef4444' }}>{startErr}</div>}
              </>
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
  const inspo = task?.inspo || clip?.inspo || {}
  const thumb = inspo.thumbnail || clip?.thumbnail || task?.asset?.thumbnail || ''
  const title = inspo.title || task?.name || clip?.inspo?.title || ''
  const username = inspo.username || ''

  if (slot.type === 'empty') {
    return <div style={{ fontSize: '12px', color: '#2a2a2a' }}>+ Assign from library</div>
  }

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
      {thumb && (
        <img src={thumb} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0, opacity: slot.type === 'done' ? 0.5 : 1 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: slot.type === 'done' ? '#3f3f46' : '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title || 'Edit task'}
        </div>
        {username && (
          <div style={{ fontSize: '11px', color: '#3f3f46', marginTop: '2px' }}>@{username}</div>
        )}
      </div>
    </div>
  )
}

function doneSlotStyle(task) {
  const s = task?.adminReviewStatus || ''
  if (s === 'Approved') return { borderColor: '#1a3a1a', bg: '#030f03', dotColor: '#22c55e', label: 'Approved ✓' }
  return { borderColor: '#2a3a10', bg: '#0a0f02', dotColor: '#a3e635', label: 'In Review' }
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

  const navBtn = { background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#71717a', fontSize: '14px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }
  const dotColors = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: '6px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '14px', width: '228px', boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d4d4d8' }}>{monthNames[calMonth]} {calYear}</span>
          <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: '10px', color: '#52525b', fontWeight: 600, padding: '3px 0' }}>{d}</div>
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
                style={{ background: isSel ? '#7c3aed' : isToday ? '#1e1a2e' : 'transparent', border: isToday && !isSel ? '1px solid #4c3a8a' : '1px solid transparent', borderRadius: '6px', color: isSel ? '#fff' : isToday ? '#a78bfa' : '#a1a1aa', fontSize: '12px', fontWeight: isSel || isToday ? 700 : 400, padding: '4px 0 2px', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                <span>{day}</span>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: color ? dotColors[color] : 'transparent', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #1e1e1e' }}>
          <button onClick={() => { onSelect(todayStr); onClose() }}
            style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer' }}>Today</button>
        </div>
      </div>
    </>
  )
}

function VideoSlot({ slotLabel, slot, isNext, isLocked, creator, onAction, updating, onRefresh, onSlotClick }) {
  const typeStyle = slot.type === 'done'
    ? doneSlotStyle(slot.task)
    : {
        inProgress: { borderColor: '#1a3a6d', bg: '#03071a', dotColor: '#3b82f6', label: 'In editing' },
        toDo:       { borderColor: '#2a1a5e', bg: '#05030f', dotColor: '#a78bfa', label: 'Ready to edit' },
        inspoClip:  { borderColor: '#5c4000', bg: '#0d0900', dotColor: '#f59e0b', label: 'Creator clip uploaded' },
        empty:      { borderColor: '#1a1a1a', bg: '#080808', dotColor: '#3f3f46', label: 'Open slot' },
      }[slot.type] || { borderColor: '#1a1a1a', bg: '#080808', dotColor: '#3f3f46', label: '' }

  const isDone = slot.type === 'done'
  const clickable = isDone || isNext
  const opacity = isLocked ? 0.35 : 1

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
          <span style={{ fontSize: '10px', color: '#3f3f46', marginLeft: 'auto' }}>{slotLabel}</span>
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
        onRefresh()
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
    setSubmitModal(null)
    showToast(isRevision ? 'Revision submitted' : 'Edit submitted for review')
    onRefresh()
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

  // Build per-date color map for calendar dots
  const dateColors = (() => {
    const colors = {}
    // Past dates: use completed task data (14-day window)
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
      const doneTasks = (creator.recentDone || [])
        .filter(t => (t.completedAt || '').startsWith(ds))
        .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      const ipTasks = isToday ? (creator.inProgress || []) : []
      const qTasks = isToday ? (creator.queue || []) : []
      for (let s = 0; s < dailyQuota; s++) {
        if (s < doneTasks.length) {
          colors.push(statusColor(doneTasks[s].adminReviewStatus))
        } else if (isToday) {
          const ipIdx = s - doneTasks.length
          if (ipIdx < ipTasks.length) colors.push('#60a5fa')
          else if (ipIdx - ipTasks.length < qTasks.length) colors.push('#a78bfa')
          else colors.push('#1a1a1a')
        } else {
          colors.push('#1a1a1a')
        }
      }
    }
    return colors
  })()

  // Done tasks for selected date (from recentDone for history, doneTodayList for today)
  const selectedDoneList = isToday
    ? (creator.doneTodayList || [])
    : (creator.recentDone || []).filter(t => (t.completedAt || '').startsWith(selectedDate))

  // Active fill items only apply to today (past days show history, future shows queue)
  const activeFillItems = [
    ...creator.inProgress.map(t => ({ type: 'inProgress', task: t })),
    ...creator.queue.map(t => ({ type: 'toDo', task: t })),
    ...(creator.inspoClips || []).map(c => ({ type: 'inspoClip', clip: c })),
  ]

  const slots = []
  selectedDoneList.forEach(t => slots.push({ type: 'done', task: t }))
  if (isToday) {
    const remaining = Math.max(0, dailyQuota - slots.length)
    activeFillItems.slice(0, remaining).forEach(item => slots.push(item))
  }
  while (slots.length < dailyQuota) slots.push({ type: 'empty' })

  const allDone = selectedDoneList.length >= dailyQuota

  return (
    <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '16px', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #1a1a1a' }}>
        {/* Row 1: name + See More */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: 0 }}>{creator.name}</h2>
          <Link href={`/editor/${creator.id}`}
            style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'transparent', color: '#52525b', border: '1px solid #2a2a2a', textDecoration: 'none', flexShrink: 0 }}>
            See More →
          </Link>
        </div>
        {/* Row 2: status pills — always has at least the 'needed' pill */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
          {creator.needsRevision.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#2d1515', color: '#ef4444', border: '1px solid #5c2020' }}>
              ⚠ {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''}
            </span>
          )}
          {creator.queue.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#1a0f3a', color: '#a78bfa', border: '1px solid #3a1f8a' }}>
              {creator.queue.length} queued
            </span>
          )}
          {creator.inProgress.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#03071a', color: '#60a5fa', border: '1px solid #1a3a6d' }}>
              {creator.inProgress.length} editing
            </span>
          )}
          {creator.inReview.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a0f02', color: '#a3e635', border: '1px solid #2a3a10' }}>
              {creator.inReview.length} in review
            </span>
          )}
          {(creator.approved || []).length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a2e0a', color: '#22c55e', border: '1px solid #1a5c1a' }}>
              {creator.approved.length} approved
            </span>
          )}
          {(() => {
            const needed = Math.max(0, creator.quota - creator.doneToday)
            return needed > 0 ? (
              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#111', color: '#3f3f46', border: '1px solid #2a2a2a' }}>
                {needed} open
              </span>
            ) : null
          })()}
        </div>
        {/* Row 2: quota dots full width */}
        <QuotaDots slotColors={slotColors} quota={creator.quota} done={creator.doneToday} />
      </div>

      {/* Needs Revision — urgent, above slots */}
      {creator.needsRevision.length > 0 && (
        <div style={{ padding: '14px 24px', background: '#0d0505', borderBottom: '1px solid #2d1515' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
            ⚠ Needs Revision
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {creator.needsRevision.map(task => (
              <div key={task.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  {task.inspo?.thumbnail && (
                    <img src={task.inspo.thumbnail} alt="" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                  )}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#fca5a5' }}>{task.inspo?.title || task.name}</div>
                    {task.adminFeedback && (
                      <div style={{ fontSize: '11px', color: '#71717a', marginTop: '2px', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.adminFeedback}</div>
                    )}
                  </div>
                </div>
                <button onClick={() => handleAction('revision', task)}
                  style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 700, background: '#2d1515', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '7px', cursor: 'pointer', flexShrink: 0 }}>
                  Upload Revision
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Work Slots */}
      <div style={{ padding: '16px 24px' }}>
        {/* Date navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>Daily</span>
          <button onClick={() => shiftDate(-1)}
            style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#52525b', fontSize: '13px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>‹</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowDatePicker(p => !p)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: isToday ? '#a78bfa' : '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isToday ? 'Today · ' : ''}{selectedDayLabel}
              </span>
              <span style={{ fontSize: '10px', color: '#3f3f46' }}>▾</span>
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
            style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#52525b', fontSize: '13px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>›</button>
          {!isToday && (
            <button onClick={() => setSelectedDate(todayDateStr)}
              style={{ background: 'none', border: 'none', color: '#3f3f46', fontSize: '11px', cursor: 'pointer', padding: '0 4px' }}>Today</button>
          )}
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
              return (
                <VideoSlot
                  key={i}
                  slotLabel={`${dateLabel} / ${slotNames[i] || `Slot ${i + 1}`}`}
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
        />
      )}

      {libraryModal && (
        <LibraryPickerModal
          creator={creator}
          onClose={() => setLibraryModal(false)}
          onRefresh={onRefresh}
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

      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#2d1515' : '#0a2e0a',
          color: toast.error ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.error ? '#5c2020' : '#1a5c1a'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
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
  const bg = isGreen ? '#050f05' : isYellow ? '#0d0a00' : '#100505'
  const border = isGreen ? '#1a3a1a' : isYellow ? '#3d2e00' : '#3d1515'
  const barBg = isGreen ? '#0a2e0a' : isYellow ? '#1a1400' : '#1a0808'

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '12px', padding: '16px 18px' }}>
      {/* Name + buffer days */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{creator.name}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span style={{ fontSize: '22px', fontWeight: 800, color, lineHeight: 1 }}>{bufferDays}</span>
          <span style={{ fontSize: '11px', color, fontWeight: 600 }}>d runway</span>
        </div>
      </div>

      {/* Buffer bar */}
      <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', marginBottom: '10px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: '2px', background: color,
          width: `${Math.min(100, (bufferDays / 7) * 100)}%`,
          transition: 'width 0.3s',
        }} />
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
        <span style={{ color: '#52525b' }}>
          <span style={{ color: color, fontWeight: 600 }}>{approvedBuffer}</span> posts scheduled
        </span>
        {pendingEdit > 0 && (
          <span style={{ color: '#52525b' }}>
            <span style={{ color: '#a78bfa', fontWeight: 600 }}>{pendingEdit}</span> to edit
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
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#fff', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/editor/dashboard')
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`${res.status}: ${body}`)
      }
      const data = await res.json()
      setCreators(data.creators || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px 0' }}>Loading editor dashboard...</div>
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
          <span style={{ fontSize: '13px', color: '#52525b' }}>{greeting}, </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#a1a1aa' }}>{firstName}</span>
        </div>
        <button onClick={fetchData}
          style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: '#111', color: '#a1a1aa', border: '1px solid #333', borderRadius: '6px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      <BufferOverview creators={creators} />

      {creators.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#3f3f46', fontSize: '14px', background: '#0d0d0d', borderRadius: '12px', border: '1px solid #1a1a1a' }}>
          No creators assigned — toggle Social Media Editing on a creator to assign them.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {creators.map(creator => (
            <div key={creator.id} style={{ minWidth: 0 }}>
              <CreatorSection creator={creator} onRefresh={fetchData} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
