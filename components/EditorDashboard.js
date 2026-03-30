'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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

export function SubmitModal({ task, creatorName, isRevision, onClose, onSubmit }) {
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
      const rawPath = task.asset.dropboxPath || ''
      let exportFolder = '/Palm Ops/Edited Exports'
      if (rawPath.includes('20_NEEDS_EDIT')) {
        exportFolder = rawPath.substring(0, rawPath.indexOf('20_NEEDS_EDIT')) + '30_EDITED_EXPORTS'
      }

      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId } = await tokenRes.json()

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

// ─── Library clip card ─────────────────────────────────────────────────────────

function LibraryCard({ asset, onRefresh }) {
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const links = asset.dropboxLinks?.length ? asset.dropboxLinks : asset.dropboxLink ? [asset.dropboxLink] : []
  const uploadLabel = asset.uploadWeek || (asset.createdTime ? new Date(asset.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

  const handleStartEdit = async () => {
    setStarting(true)
    setStartError('')
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, creatorId: asset.creatorId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start edit')
      }
      onRefresh()
    } catch (err) {
      setStartError(err.message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '10px', overflow: 'hidden' }}>
      <div style={{ height: '120px', background: '#080808', overflow: 'hidden', position: 'relative' }}>
        {asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '22px' }}>🎬</div>
        )}
        {uploadLabel && (
          <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.75)', color: '#71717a', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>
            {uploadLabel}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {asset.name && (
          <div style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</div>
        )}
        {asset.creatorNotes && (
          <div style={{ fontSize: '10px', color: '#52525b', lineHeight: 1.3 }}>{asset.creatorNotes}</div>
        )}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {links.length ? links.map((link, i, arr) => (
            <a key={i} href={link} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: '#1a1a1a', color: '#71717a', border: '1px solid #2a2a2a', borderRadius: '6px', textDecoration: 'none' }}>
              {arr.length > 1 ? `Clip ${i + 1} ↗` : 'View ↗'}
            </a>
          )) : (
            <span style={{ fontSize: '11px', color: '#3f3f46', fontStyle: 'italic' }}>No link</span>
          )}
        </div>
        <button
          onClick={handleStartEdit}
          disabled={starting}
          style={{
            width: '100%', background: '#13132e', color: '#a78bfa',
            border: '1px solid #2a2a5e', borderRadius: '6px', padding: '7px',
            fontSize: '12px', fontWeight: 600, cursor: starting ? 'not-allowed' : 'pointer',
            opacity: starting ? 0.7 : 1,
          }}
        >
          {starting ? 'Starting...' : 'Start Edit'}
        </button>
        {startError && <p style={{ fontSize: '11px', color: '#ef4444', margin: 0 }}>{startError}</p>}
      </div>
    </div>
  )
}

// ─── Creator section ───────────────────────────────────────────────────────────

function CreatorSection({ creator, onRefresh }) {
  const [updating, setUpdating] = useState(null)
  const [submitModal, setSubmitModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [showLibrary, setShowLibrary] = useState(true)

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
    showToast(isRevision ? 'Revision submitted for review' : 'Edit submitted for review')
    onRefresh()
  }

  const totalActive = creator.needsRevision.length + creator.queue.length + creator.inProgress.length

  return (
    <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '16px', overflow: 'hidden', marginBottom: '16px' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>{creator.name}</h2>
          <QuotaDots done={creator.doneToday} quota={creator.quota} />
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {creator.needsRevision.length > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#2d1515', color: '#ef4444', border: '1px solid #5c2020' }}>
              {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''}
            </span>
          )}
          {creator.queue.length > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#13132e', color: '#a78bfa', border: '1px solid #2a2a5e' }}>
              {creator.queue.length} ready to edit
            </span>
          )}
          {creator.inProgress.length > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a1a3d', color: '#3b82f6', border: '1px solid #1a3a6d' }}>
              {creator.inProgress.length} in progress
            </span>
          )}
          {creator.inReview.length > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a1a0a', color: '#22c55e', border: '1px solid #1a3a1a' }}>
              {creator.inReview.length} in review
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
        {totalActive === 0 && creator.inReview.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0 8px', color: '#3f3f46', fontSize: '13px' }}>
            No active tasks — check the content library below
          </div>
        )}

        {creator.needsRevision.length > 0 && (
          <div>
            <SectionLabel type="needsRevision" count={creator.needsRevision.length} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {creator.needsRevision.map(task => (
                <TaskCard key={task.id} task={task} type="needsRevision" creatorName={creator.name}
                  onAction={handleAction} updating={updating === task.id} />
              ))}
            </div>
          </div>
        )}

        {creator.queue.length > 0 && (
          <div>
            <SectionLabel type="queue" count={creator.queue.length} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {creator.queue.map(task => (
                <TaskCard key={task.id} task={task} type="queue" creatorName={creator.name}
                  onAction={handleAction} updating={updating === task.id} />
              ))}
            </div>
          </div>
        )}

        {creator.inProgress.length > 0 && (
          <div>
            <SectionLabel type="inProgress" count={creator.inProgress.length} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {creator.inProgress.map(task => (
                <TaskCard key={task.id} task={task} type="inProgress" creatorName={creator.name}
                  onAction={handleAction} updating={updating === task.id} />
              ))}
            </div>
          </div>
        )}

        {creator.inReview.length > 0 && (
          <div>
            <SectionLabel type="inReview" count={creator.inReview.length} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {creator.inReview.map(task => (
                <TaskCard key={task.id} task={task} type="inReview" creatorName={creator.name}
                  onAction={handleAction} updating={false} />
              ))}
            </div>
          </div>
        )}

        {/* ── Content Library ── */}
        <div>
          <button onClick={() => setShowLibrary(p => !p)}
            style={{ background: 'none', border: 'none', color: showLibrary ? '#d4d4d8' : '#52525b', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: showLibrary ? '14px' : 0, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#3f3f46', flexShrink: 0 }} />
            Content Library
            <span style={{ fontSize: '11px', color: '#3f3f46', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              ({creator.library.length} clip{creator.library.length !== 1 ? 's' : ''})
            </span>
            <span style={{ fontSize: '11px', color: '#3f3f46' }}>{showLibrary ? '▾' : '▸'}</span>
          </button>
          {showLibrary && (
            creator.library.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {creator.library.map(asset => <LibraryCard key={asset.id} asset={{...asset, creatorId: creator.id}} onRefresh={onRefresh} />)}
              </div>
            ) : (
              <div style={{ padding: '20px', color: '#3f3f46', fontSize: '12px', textAlign: 'center', background: '#0a0a0a', borderRadius: '8px', border: '1px dashed #1a1a1a' }}>
                No clips yet — content will appear here after creator uploads
              </div>
            )
          )}
        </div>

        {/* ── AI Matching (coming soon) ── */}
        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#1a1a1a', flexShrink: 0 }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Inspo Matching</span>
            <span style={{ fontSize: '10px', color: '#1e1e1e', background: '#141414', border: '1px solid #1e1e1e', borderRadius: '4px', padding: '2px 6px', fontWeight: 600 }}>Coming soon</span>
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#2a2a2a', lineHeight: 1.5 }}>
            Automatic inspo suggestions for each uploaded clip — matched by visual content analysis
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#2d1515' : '#0a2e0a',
          color: toast.error ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.error ? '#5c2020' : '#1a5c1a'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {toast.msg}
        </div>
      )}

      {submitModal && (
        <SubmitModal
          task={submitModal.task}
          creatorName={creator.name}
          isRevision={submitModal.isRevision}
          onClose={() => setSubmitModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

// ─── Main exported component ───────────────────────────────────────────────────

export function EditorDashboardContent() {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {totalRevisions > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: '#2d1515', color: '#ef4444', border: '1px solid #5c2020' }}>
              {totalRevisions} revision{totalRevisions > 1 ? 's' : ''} needed
            </span>
          )}
          {totalQueue > 0 && (
            <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: '#13132e', color: '#a78bfa', border: '1px solid #2a2a5e' }}>
              {totalQueue} in queue
            </span>
          )}
          {totalRevisions === 0 && totalQueue === 0 && (
            <span style={{ fontSize: '13px', color: '#52525b' }}>Queue is clear</span>
          )}
        </div>
        <button onClick={fetchData}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: '#111', color: '#a1a1aa', border: '1px solid #333', borderRadius: '6px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {creators.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#3f3f46', fontSize: '14px', background: '#0d0d0d', borderRadius: '12px', border: '1px solid #1a1a1a' }}>
          No creators assigned — toggle Social Media Editing on a creator to assign them.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {creators.map(creator => {
            const totalActive = creator.needsRevision.length + creator.queue.length + creator.inProgress.length
            return (
              <a key={creator.id} href={`/editor/${creator.id}`}
                style={{ display: 'block', background: '#111', border: '1px solid #1e1e1e', borderRadius: '16px', padding: '20px 24px', textDecoration: 'none', color: 'inherit', cursor: 'pointer', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#3f3f46'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1e1e'}
              >
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px' }}>{creator.name}</h2>
                <QuotaDots done={creator.doneToday} quota={creator.quota} />
                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {creator.needsRevision.length > 0 && (
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#2d1515', color: '#ef4444', border: '1px solid #5c2020' }}>
                      {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {creator.queue.length > 0 && (
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#13132e', color: '#a78bfa', border: '1px solid #2a2a5e' }}>
                      {creator.queue.length} to edit
                    </span>
                  )}
                  {creator.inProgress.length > 0 && (
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a1a3d', color: '#3b82f6', border: '1px solid #1a3a6d' }}>
                      {creator.inProgress.length} in progress
                    </span>
                  )}
                  {creator.inReview.length > 0 && (
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#0a1a0a', color: '#22c55e', border: '1px solid #1a3a1a' }}>
                      {creator.inReview.length} in review
                    </span>
                  )}
                  {totalActive === 0 && creator.inReview.length === 0 && (
                    <span style={{ fontSize: '11px', color: '#3f3f46' }}>No active tasks</span>
                  )}
                </div>
                <div style={{ marginTop: '12px', fontSize: '11px', color: '#3f3f46' }}>
                  {creator.library.length} clip{creator.library.length !== 1 ? 's' : ''} in library &#8594;
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
