'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'

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

export function QuotaDots({ done, quota }) {
  const over = done > quota
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '5px' }}>
        {Array.from({ length: quota }).map((_, i) => (
          <div key={i} style={{
            width: '11px', height: '11px', borderRadius: '50%',
            background: i < done ? '#22c55e' : '#1a1a1a',
            border: `1.5px solid ${i < done ? '#22c55e' : '#2a2a2a'}`,
            transition: 'all 0.2s',
          }} />
        ))}
      </div>
      <span style={{ fontSize: '12px', color: done >= quota ? '#22c55e' : '#52525b', fontWeight: 500 }}>
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

// ─── Today's Work slot components ─────────────────────────────────────────────

function DoneSlotContent({ task }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      {task.inspo?.thumbnail && (
        <img src={task.inspo.thumbnail} alt="" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover', opacity: 0.5 }} />
      )}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#3f3f46' }}>{task.inspo?.title || task.name}</div>
        <div style={{ fontSize: '11px', color: '#2a2a2a', marginTop: '2px' }}>Submitted for review</div>
      </div>
    </div>
  )
}

function ActiveTaskSlot({ task, type, creator, onAction, updating }) {
  const [expanded, setExpanded] = useState(false)
  const links = task.asset?.dropboxLinks?.length ? task.asset.dropboxLinks : task.asset?.dropboxLink ? [task.asset.dropboxLink] : []

  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      {task.inspo?.thumbnail && (
        <img src={task.inspo.thumbnail} alt="" style={{ width: '52px', height: '52px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.inspo?.title || task.name || 'Edit task'}
        </div>
        {task.inspo?.username && (
          <div style={{ fontSize: '11px', color: '#52525b', marginBottom: '6px' }}>@{task.inspo.username}</div>
        )}
        {task.adminFeedback && type === 'needsRevision' && (
          <div style={{ fontSize: '11px', color: '#fca5a5', background: '#1a0a0a', border: '1px solid #5c2020', borderRadius: '6px', padding: '6px 8px', marginBottom: '8px', lineHeight: 1.4 }}>
            {task.adminFeedback}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {links.map((link, i) => (
            <a key={i} href={link} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
              {links.length > 1 ? `Clip ${i + 1} ↗` : 'Creator clip ↗'}
            </a>
          ))}
          {task.inspo?.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#0d0a2e', borderRadius: '4px', border: '1px solid #2a1a5e' }}>
              Inspo ↗
            </a>
          )}
        </div>
        {task.inspo?.notes && (
          <div style={{ marginBottom: '8px' }}>
            <button onClick={() => setExpanded(p => !p)}
              style={{ background: 'none', border: 'none', color: '#3f3f46', fontSize: '11px', cursor: 'pointer', padding: 0 }}>
              {expanded ? '▾ Hide direction' : '▸ View direction'}
            </button>
            {expanded && (
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#d4d4d8', lineHeight: 1.6, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                {task.inspo.notes}
                {task.inspo.onScreenText && (
                  <div style={{ marginTop: '6px', color: '#f59e0b', background: '#1a1500', border: '1px solid #332b00', borderRadius: '4px', padding: '4px 6px' }}>
                    "{task.inspo.onScreenText}"
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div>
          {type === 'toDo' && (
            <button onClick={() => onAction('startEditing', task)} disabled={updating}
              style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 700, background: '#0a2e0a', color: '#22c55e', border: '1px solid #1a5c1a', borderRadius: '7px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
              {updating ? 'Starting...' : 'Start Editing →'}
            </button>
          )}
          {type === 'inProgress' && (
            <button onClick={() => onAction('submit', task)}
              style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 700, background: '#0a0a3d', color: '#a78bfa', border: '1px solid #a78bfa', borderRadius: '7px', cursor: 'pointer' }}>
              Submit for Review ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function InspoClipSlot({ clip, creator, onRefresh }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const handleStart = async () => {
    setStarting(true)
    setError('')
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: clip.id, creatorId: creator.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onRefresh()
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      {(clip.thumbnail || clip.inspo?.thumbnail) && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <img src={clip.thumbnail || clip.inspo?.thumbnail} alt="" style={{ width: '52px', height: '52px', borderRadius: '8px', objectFit: 'cover' }} />
          {clip.inspo?.thumbnail && clip.thumbnail && (
            <img src={clip.inspo.thumbnail} alt="" style={{ position: 'absolute', bottom: '-6px', right: '-6px', width: '28px', height: '28px', borderRadius: '4px', objectFit: 'cover', border: '2px solid #0a0a0a' }} />
          )}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {clip.inspo?.title || 'Recreate this inspo'}
        </div>
        {clip.inspo?.username && (
          <div style={{ fontSize: '11px', color: '#52525b', marginBottom: '6px' }}>@{clip.inspo.username}</div>
        )}
        {clip.creatorNotes && (
          <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>{clip.creatorNotes}</div>
        )}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          {clip.dropboxLink && (
            <a href={clip.dropboxLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
              Creator clip ↗
            </a>
          )}
          {clip.inspo?.contentLink && (
            <a href={clip.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#0d0a2e', borderRadius: '4px', border: '1px solid #2a1a5e' }}>
              Inspo ↗
            </a>
          )}
        </div>
        <button onClick={handleStart} disabled={starting}
          style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 700, background: '#1a1000', color: '#f59e0b', border: '1px solid #5c4000', borderRadius: '7px', cursor: starting ? 'not-allowed' : 'pointer', opacity: starting ? 0.6 : 1 }}>
          {starting ? 'Starting...' : 'Start Edit →'}
        </button>
        {error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>{error}</div>}
      </div>
    </div>
  )
}

function EmptySlot() {
  return (
    <div style={{ fontSize: '13px', color: '#3f3f46' }}>No clip assigned yet</div>
  )
}

function VideoSlot({ number, slot, creator, onAction, updating, onRefresh }) {
  const typeStyle = {
    done:       { borderColor: '#1a2e1a', bg: '#050f05', dotColor: '#22c55e', label: 'Done ✓' },
    inProgress: { borderColor: '#1a3a6d', bg: '#03071a', dotColor: '#3b82f6', label: 'In editing' },
    toDo:       { borderColor: '#2a1a5e', bg: '#05030f', dotColor: '#a78bfa', label: 'Ready to edit' },
    inspoClip:  { borderColor: '#5c4000', bg: '#0d0900', dotColor: '#f59e0b', label: 'Creator clip uploaded' },
    empty:      { borderColor: '#1a1a1a', bg: '#080808', dotColor: '#3f3f46', label: 'Open slot' },
  }[slot.type] || { borderColor: '#1a1a1a', bg: '#080808', dotColor: '#3f3f46', label: '' }

  return (
    <div style={{ border: `1px solid ${typeStyle.borderColor}`, background: typeStyle.bg, borderRadius: '10px', padding: '14px 16px', height: '200px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#111', border: `1.5px solid ${typeStyle.dotColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, color: typeStyle.dotColor, flexShrink: 0 }}>
          {number}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: typeStyle.dotColor }} />
          <span style={{ fontSize: '10px', fontWeight: 700, color: typeStyle.dotColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {typeStyle.label}
          </span>
        </div>
      </div>
      {slot.type === 'done' && <DoneSlotContent task={slot.task} />}
      {slot.type === 'inProgress' && <ActiveTaskSlot task={slot.task} type="inProgress" creator={creator} onAction={onAction} updating={updating === slot.task?.id} />}
      {slot.type === 'toDo' && <ActiveTaskSlot task={slot.task} type="toDo" creator={creator} onAction={onAction} updating={updating === slot.task?.id} />}
      {slot.type === 'inspoClip' && <InspoClipSlot clip={slot.clip} creator={creator} onRefresh={onRefresh} />}
      {slot.type === 'empty' && <EmptySlot />}
    </div>
  )
}

// ─── Creator section ───────────────────────────────────────────────────────────

function CreatorSection({ creator, onRefresh }) {
  const [updating, setUpdating] = useState(null)
  const [submitModal, setSubmitModal] = useState(null)
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
  const doneTodayList = creator.doneTodayList || []

  // Build today's slots in priority order
  const activeFillItems = [
    // Needs Revision tasks are shown separately as urgent — skip from slots
    ...creator.inProgress.map(t => ({ type: 'inProgress', task: t })),
    ...creator.queue.map(t => ({ type: 'toDo', task: t })),
    ...(creator.inspoClips || []).map(c => ({ type: 'inspoClip', clip: c })),
  ]

  const slots = []
  doneTodayList.forEach(t => slots.push({ type: 'done', task: t }))
  const remaining = Math.max(0, dailyQuota - slots.length)
  activeFillItems.slice(0, remaining).forEach(item => slots.push(item))
  while (slots.length < dailyQuota) slots.push({ type: 'empty' })

  const today = new Date()
  const dayLabel = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const doneToday = doneTodayList.length
  const allDone = doneToday >= dailyQuota

  return (
    <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '16px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: '0 0 5px' }}>{creator.name}</h2>
          <QuotaDots done={creator.doneToday} quota={creator.quota} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {creator.needsRevision.length > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#2d1515', color: '#ef4444', border: '1px solid #5c2020' }}>
              ⚠ {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''}
            </span>
          )}
          {creator.inReview.length > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a1a0a', color: '#22c55e', border: '1px solid #1a3a1a' }}>
              {creator.inReview.length} in review
            </span>
          )}
          <Link href={`/editor/${creator.id}`}
            style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'transparent', color: '#52525b', border: '1px solid #2a2a2a', textDecoration: 'none' }}>
            Details →
          </Link>
          {allDone && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a2e0a', color: '#22c55e', border: '1px solid #1a5c1a' }}>
              ✓ Today done
            </span>
          )}
        </div>
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

      {/* Today's Work Slots */}
      <div style={{ padding: '16px 24px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>
          Today · {dayLabel}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {slots.map((slot, i) => (
            <VideoSlot
              key={i}
              number={i + 1}
              slot={slot}
              creator={creator}
              onAction={handleAction}
              updating={updating}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      </div>

      {/* In Review — below the fold */}
      {creator.inReview.length > 0 && (
        <div style={{ padding: '0 24px 16px' }}>
          <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Submitted · Awaiting Review
            </div>
            {creator.inReview.map(task => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
                {task.inspo?.thumbnail && (
                  <img src={task.inspo.thumbnail} alt="" style={{ width: '32px', height: '32px', borderRadius: '5px', objectFit: 'cover', opacity: 0.6 }} />
                )}
                <div style={{ fontSize: '12px', color: '#3f3f46', flex: 1 }}>{task.inspo?.title || task.name}</div>
                <div style={{ fontSize: '11px', color: '#22c55e', background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: '4px', padding: '2px 8px' }}>
                  In review
                </div>
              </div>
            ))}
          </div>
        </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', alignItems: 'start' }}>
          {creators.map(creator => (
            <CreatorSection key={creator.id} creator={creator} onRefresh={fetchData} />
          ))}
        </div>
      )}
    </div>
  )
}
