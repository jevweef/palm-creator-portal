'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const STATUS_COLORS = {
  'To Do': { bg: '#332b00', text: '#f59e0b', border: '#5c4b00' },
  'In Progress': { bg: '#0a1a3d', text: '#3b82f6', border: '#1a3a6d' },
}

const TAG_COLORS = [
  '#a78bfa', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
]

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg: '#1a1a1a', text: '#71717a', border: '#333' }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>
      {status}
    </span>
  )
}

function TagPill({ tag, index }) {
  const color = TAG_COLORS[index % TAG_COLORS.length]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500,
      background: `${color}15`, color, border: `1px solid ${color}30`,
    }}>
      {typeof tag === 'object' ? tag.name : tag}
    </span>
  )
}

function SubmitModal({ task, onClose, onSubmit }) {
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
      // Get Dropbox credentials — derive export folder from the raw clip path
      setProgress('Preparing upload...')
      const rawPath = task.asset.dropboxPath || ''
      // Replace 20_NEEDS_EDIT with 30_EDITED_EXPORTS in the path
      let exportFolder = ''
      if (rawPath.includes('20_NEEDS_EDIT')) {
        exportFolder = rawPath.substring(0, rawPath.indexOf('20_NEEDS_EDIT')) + '30_EDITED_EXPORTS'
      } else {
        // Fallback: just use a generic exports path
        exportFolder = '/Palm Ops/Edited Exports'
      }

      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId } = await tokenRes.json()

      // Build filename
      const titleSlug = (task.inspo.title || 'edit').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50)
      const creatorSlug = (task.creator.name || 'creator').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
      const fileName = `${titleSlug}_${creatorSlug}_EDITED_${timestamp}.${ext}`

      setProgress(`Uploading ${fileName}...`)
      const buffer = await file.arrayBuffer()
      const filePath = `${exportFolder}/${fileName}`
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: filePath, mode: 'add', autorename: true, mute: true }),
          'Dropbox-API-Path-Root': pathRoot,
          'Content-Type': 'application/octet-stream',
        },
        body: buffer,
      })
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed: ${await dbxRes.text()}`)
      const result = await dbxRes.json()

      // Create shared link
      setProgress('Creating link...')
      let sharedLink = ''
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: result.path_display }),
        })
        if (linkRes.ok) sharedLink = (await linkRes.json()).url || ''
      } catch {}

      // Submit to API
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: '12px', padding: '24px', width: '440px', maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
          Submit Edit for Review
        </h3>
        <p style={{ fontSize: '12px', color: '#71717a', marginBottom: '16px' }}>
          {task.inspo.title} — {task.creator.name}
        </p>

        {/* File drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
          onDragOver={e => e.preventDefault()}
          style={{
            border: `2px dashed ${file ? '#22c55e' : '#333'}`, borderRadius: '10px',
            padding: '24px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s',
            background: file ? '#0a2e0a' : 'transparent',
          }}
        >
          {file ? (
            <div>
              <div style={{ fontSize: '13px', color: '#22c55e', fontWeight: 600 }}>{file.name}</div>
              <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>
                {(file.size / (1024 * 1024)).toFixed(1)} MB — click to change
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13px', color: '#a1a1aa' }}>Drop edited video here or click to browse</div>
              <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>MP4, MOV</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="video/*,.mp4,.mov" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
        </div>

        {/* Editor notes */}
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Editor notes (optional)"
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

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: '#333' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!file || uploading}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              background: !file || uploading ? '#333' : '#a78bfa', opacity: uploading ? 0.6 : 1,
            }}>
            {uploading ? 'Uploading...' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function EditorQueue() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(new Set())
  const [updating, setUpdating] = useState(null)
  const [toast, setToast] = useState(null)
  const [submitTask, setSubmitTask] = useState(null)

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/editor')
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (err) {
      console.error(err)
      showToast(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const updateStatus = async (taskId, newStatus) => {
    setUpdating(taskId)
    try {
      const res = await fetch('/api/admin/editor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, newStatus }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Update failed')

      if (newStatus === 'Done') {
        // Remove from queue
        setTasks(prev => prev.filter(t => t.id !== taskId))
        showToast('Submitted for review')
      } else {
        // Update status in place
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
        showToast('Started editing')
      }
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setUpdating(null)
    }
  }

  const toggleExpand = (taskId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(taskId) ? next.delete(taskId) : next.add(taskId)
      return next
    })
  }

  const filtered = filter === 'all' ? tasks : tasks.filter(t => {
    if (filter === 'todo') return t.status === 'To Do'
    if (filter === 'inprogress') return t.status === 'In Progress'
    return true
  })

  const counts = {
    all: tasks.length,
    todo: tasks.filter(t => t.status === 'To Do').length,
    inprogress: tasks.filter(t => t.status === 'In Progress').length,
  }

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px' }}>Loading editor queue...</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>Editor Queue</h1>
          <p style={{ fontSize: '13px', color: '#71717a', marginTop: '4px' }}>
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} pending
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchTasks() }}
          style={{
            padding: '8px 16px', fontSize: '13px', fontWeight: 600,
            background: '#111', color: '#a1a1aa', border: '1px solid #333',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'todo', label: `To Do (${counts.todo})` },
          { key: 'inprogress', label: `In Progress (${counts.inprogress})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 600,
              background: filter === tab.key ? '#1a1a2e' : 'transparent',
              color: filter === tab.key ? '#a78bfa' : '#71717a',
              border: `1px solid ${filter === tab.key ? '#a78bfa' : '#333'}`,
              borderRadius: '6px', cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Task grid */}
      {filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
          {tasks.length === 0 ? 'No editing tasks in queue.' : 'No tasks match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 520px))', gap: '16px' }}>
          {filtered.map(task => (
            <div key={task.id} style={{
              background: '#111', border: '1px solid #222', borderRadius: '12px',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
              {/* Visual header — inspo thumbnail + clip side by side */}
              <div style={{ display: 'flex', height: '200px', background: '#0a0a0a' }}>
                {/* Inspo thumbnail (left) */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  {task.inspo.thumbnail ? (
                    <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '12px' }}>No thumbnail</div>
                  )}
                  <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.7)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#a78bfa', fontWeight: 600 }}>
                    INSPO
                  </div>
                </div>

                {/* Divider arrow */}
                <div style={{ width: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', flexShrink: 0 }}>
                  <span style={{ color: '#333', fontSize: '18px' }}>→</span>
                </div>

                {/* Creator clip (right) — show thumbnail if available, otherwise download icon */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  {task.asset.thumbnail ? (
                    <a href={task.asset.dropboxLink || '#'} target={task.asset.dropboxLink ? '_blank' : undefined} rel="noopener noreferrer"
                      style={{ display: 'block', width: '100%', height: '100%' }}>
                      <img src={task.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </a>
                  ) : task.asset.dropboxLink ? (
                    <a href={task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
                      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', background: '#0f0f1a', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1a1a2e'}
                      onMouseLeave={e => e.currentTarget.style.background = '#0f0f1a'}
                    >
                      <svg style={{ width: '32px', height: '32px', color: '#a78bfa', marginBottom: '8px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span style={{ color: '#a78bfa', fontSize: '12px', fontWeight: 600 }}>Download Clips</span>
                    </a>
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#333', fontSize: '12px' }}>
                      No clip yet
                    </div>
                  )}
                  <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.7)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#22c55e', fontWeight: 600 }}>
                    CREATOR CLIP
                  </div>
                </div>
              </div>

              {/* Content area */}
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                {/* Creator + Status + Title */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
                      {task.creator.name || 'Unknown Creator'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#a1a1aa', marginTop: '2px' }}>
                      {task.inspo.title || task.name}
                    </div>
                  </div>
                  <StatusBadge status={task.status} />
                </div>

                {/* Quick links */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {task.inspo.contentLink && (
                    <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '3px 8px', background: '#1a1a2e', borderRadius: '4px', border: '1px solid #333' }}>
                      Original Reel ↗
                    </a>
                  )}
                  {task.inspo.dbShareLink && (
                    <a href={task.inspo.dbShareLink} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '3px 8px', background: '#1a1a2e', borderRadius: '4px', border: '1px solid #333' }}>
                      Analyzed Video ↗
                    </a>
                  )}
                  {(task.asset.dropboxLinks?.length > 0 ? task.asset.dropboxLinks : task.asset.dropboxLink ? [task.asset.dropboxLink] : []).map((link, i, arr) => (
                    <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '3px 8px', background: '#0a2e0a', borderRadius: '4px', border: '1px solid #1a5c1a' }}>
                      {arr.length > 1 ? `Clip ${i + 1} ↗` : 'Creator Clips ↗'}
                    </a>
                  ))}
                </div>

                {/* Creator notes */}
                {(task.creatorNotes || task.asset.creatorNotes) && (
                  <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px' }}>
                    <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                      Creator Notes
                    </div>
                    <div style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: 1.4 }}>
                      {task.creatorNotes || task.asset.creatorNotes}
                    </div>
                  </div>
                )}

                {/* Inspo details toggle */}
                {task.inspo.id && (
                  <>
                    <button
                      onClick={() => toggleExpand(task.id)}
                      style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                    >
                      {expanded.has(task.id) ? '▾ Hide Inspo Details' : '▸ View Inspo Details'}
                    </button>

                    {expanded.has(task.id) && (
                      <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {task.inspo.notes && (
                          <div style={{ fontSize: '12px', color: '#d4d4d8', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {task.inspo.notes}
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>On-Screen Text</div>
                          {task.inspo.onScreenText ? (
                            <div style={{ fontSize: '12px', color: '#f59e0b', lineHeight: 1.4, background: '#1a1500', border: '1px solid #332b00', borderRadius: '6px', padding: '8px 10px' }}>
                              {task.inspo.onScreenText}
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>None</div>
                          )}
                        </div>
                        {task.inspo.transcript && (
                          <div>
                            <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Transcript</div>
                            <div style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: 1.4, fontStyle: 'italic' }}>
                              {task.inspo.transcript}
                            </div>
                          </div>
                        )}
                        {task.inspo.tags?.length > 0 && (
                          <div>
                            <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Tags</div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {task.inspo.tags.map((tag, i) => <TagPill key={i} tag={tag} index={i} />)}
                            </div>
                          </div>
                        )}
                        {task.inspo.audioType && (
                          <div>
                            <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Audio</div>
                            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: '#1a1a1a', color: '#a1a1aa', border: '1px solid #333' }}>
                              {typeof task.inspo.audioType === 'object' ? task.inspo.audioType.name : task.inspo.audioType}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Action button */}
                <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
                  {task.status === 'To Do' && (
                    <button onClick={() => updateStatus(task.id, 'In Progress')} disabled={updating === task.id}
                      style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600, background: updating === task.id ? '#333' : '#0a2e0a', color: updating === task.id ? '#555' : '#22c55e', border: '1px solid #1a5c1a', borderRadius: '8px', cursor: 'pointer', opacity: updating === task.id ? 0.6 : 1 }}>
                      {updating === task.id ? 'Updating...' : 'Start Editing'}
                    </button>
                  )}
                  {task.status === 'In Progress' && (
                    <button onClick={() => setSubmitTask(task)}
                      style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600, background: '#1a1a2e', color: '#a78bfa', border: '1px solid #a78bfa', borderRadius: '8px', cursor: 'pointer' }}>
                      Submit for Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Submit Modal */}
      {submitTask && (
        <SubmitModal
          task={submitTask}
          onClose={() => setSubmitTask(null)}
          onSubmit={async (taskId, editedFileLink, editedFilePath, editorNotes) => {
            const res = await fetch('/api/admin/editor', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, newStatus: 'Done', editedFileLink, editedFilePath, editorNotes }),
            })
            if (!res.ok) throw new Error((await res.json()).error || 'Submit failed')
            setTasks(prev => prev.filter(t => t.id !== taskId))
            setSubmitTask(null)
            showToast('Edit submitted for review')
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#2d1515' : '#0a2e0a',
          color: toast.error ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.error ? '#5c2020' : '#1a5c1a'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
