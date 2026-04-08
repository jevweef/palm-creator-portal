'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { EditorDashboardContent, getSlotLabel } from '@/components/EditorDashboard'
import PostsPage from '@/app/admin/posts/page'

function formatSlot(isoDate) {
  const label = getSlotLabel(isoDate)
  const d = new Date(isoDate)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
  return `${label} · ${dateStr}`
}

const STATUS_COLORS = {
  'To Do': { bg: '#fef3c7', text: '#f59e0b', border: '#fde68a' },
  'In Progress': { bg: '#0a1a3d', text: '#3b82f6', border: '#1a3a6d' },
}

const TAG_COLORS = [
  '#E88FAC', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
]

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg: '#FFF0F3', text: '#999', border: '#E8C4CC' }
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
      setProgress('Preparing upload...')

      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, creatorId: task.creator.id }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId, uploadFolder: exportFolder } = await tokenRes.json()

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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div style={{ background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '24px', width: '440px', maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
          Submit Edit for Review
        </h3>
        <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>
          {task.inspo.title} — {task.creator.name}
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
          onDragOver={e => e.preventDefault()}
          style={{
            border: `2px dashed ${file ? '#22c55e' : 'rgba(0,0,0,0.08)'}`, borderRadius: '18px',
            padding: '24px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s',
            background: file ? '#dcfce7' : 'transparent',
          }}
        >
          {file ? (
            <div>
              <div style={{ fontSize: '13px', color: '#22c55e', fontWeight: 600 }}>{file.name}</div>
              <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                {(file.size / (1024 * 1024)).toFixed(1)} MB — click to change
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13px', color: '#888' }}>Drop edited video here or click to browse</div>
              <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>MP4, MOV</div>
            </div>
          )}
          <input ref={fileRef} type="file" accept="video/*,.mp4,.mov" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
        </div>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Editor notes (optional)"
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

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', color: '#1a1a1a', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: '#E8C4CC' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!file || uploading}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: '6px', color: '#1a1a1a', fontSize: '13px', fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              background: !file || uploading ? '#E8C4CC' : '#E88FAC', opacity: uploading ? 0.6 : 1,
            }}>
            {uploading ? 'Uploading...' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Inspo Tasks Section ──────────────────────────────────────────────────────

function InspoTasks({ showToast }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(new Set())
  const [updating, setUpdating] = useState(null)
  const [submitTask, setSubmitTask] = useState(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/editor')
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [showToast])

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
        setTasks(prev => prev.filter(t => t.id !== taskId))
        showToast('Submitted for review')
      } else {
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
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px 0' }}>Loading tasks...</div>
  }

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
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
                background: filter === tab.key ? '#FFF0F3' : 'transparent',
                color: filter === tab.key ? '#E88FAC' : '#999',
                border: `1px solid ${filter === tab.key ? '#E88FAC' : '#E8C4CC'}`,
                borderRadius: '6px', cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={fetchTasks}
          style={{
            padding: '6px 14px', fontSize: '12px', fontWeight: 600,
            background: '#ffffff', color: '#888', border: '1px solid #E8C4CC',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#555', fontSize: '14px', background: '#ffffff', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          {tasks.length === 0 ? 'No editing tasks in queue.' : 'No tasks match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 520px))', gap: '16px' }}>
          {filtered.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              expanded={expanded.has(task.id)}
              onToggleExpand={() => toggleExpand(task.id)}
              onStartEditing={() => updateStatus(task.id, 'In Progress')}
              onSubmit={() => setSubmitTask(task)}
              updating={updating === task.id}
            />
          ))}
        </div>
      )}

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
    </div>
  )
}

function TaskCard({ task, expanded, onToggleExpand, onStartEditing, onSubmit, updating }) {
  return (
    <div style={{
      background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Visual header */}
      <div style={{ display: 'flex', height: '200px', background: '#FFF5F7' }}>
        {/* Inspo thumbnail */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.inspo.thumbnail ? (
            <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '12px' }}>No thumbnail</div>
          )}
          <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#E88FAC', fontWeight: 600 }}>
            INSPO
          </div>
        </div>

        {/* Arrow */}
        <div style={{ width: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF5F7', flexShrink: 0 }}>
          <span style={{ color: '#E8C4CC', fontSize: '18px' }}>→</span>
        </div>

        {/* Creator clip */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.asset.thumbnail ? (
            <a href={task.asset.dropboxLink || '#'} target={task.asset.dropboxLink ? '_blank' : undefined} rel="noopener noreferrer"
              style={{ display: 'block', width: '100%', height: '100%' }}>
              <img src={task.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </a>
          ) : task.asset.dropboxLink ? (
            <a href={task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
              style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', background: '#0f0f1a', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FFF0F3'}
              onMouseLeave={e => e.currentTarget.style.background = '#0f0f1a'}
            >
              <svg style={{ width: '32px', height: '32px', color: '#E88FAC', marginBottom: '8px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span style={{ color: '#E88FAC', fontSize: '12px', fontWeight: 600 }}>Download Clips</span>
            </a>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF5F7', color: '#E8C4CC', fontSize: '12px' }}>
              No clip yet
            </div>
          )}
          <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#22c55e', fontWeight: 600 }}>
            CREATOR CLIP
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
              {task.creator.name || 'Unknown Creator'}
            </div>
            <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>
              {task.inspo.title || task.name}
            </div>
          </div>
          <StatusBadge status={task.status} />
        </div>

        {/* Quick links */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {task.inspo.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', padding: '3px 8px', background: '#FFF0F3', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
              Original Reel ↗
            </a>
          )}
          {task.inspo.dbShareLink && (
            <a href={task.inspo.dbShareLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', padding: '3px 8px', background: '#FFF0F3', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
              Analyzed Video ↗
            </a>
          )}
          {(task.asset.dropboxLinks?.length > 0 ? task.asset.dropboxLinks : task.asset.dropboxLink ? [task.asset.dropboxLink] : []).map((link, i, arr) => (
            <a key={i} href={link} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '3px 8px', background: '#dcfce7', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
              {arr.length > 1 ? `Clip ${i + 1} ↗` : 'Creator Clips ↗'}
            </a>
          ))}
        </div>

        {/* Creator notes */}
        {(task.creatorNotes || task.asset.creatorNotes) && (
          <div style={{ background: '#FFF5F7', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '6px', padding: '10px' }}>
            <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Creator Notes
            </div>
            <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.4 }}>
              {task.creatorNotes || task.asset.creatorNotes}
            </div>
          </div>
        )}

        {/* Inspo details toggle */}
        {task.inspo.id && (
          <>
            <button
              onClick={onToggleExpand}
              style={{ background: 'none', border: 'none', color: '#999', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: 0 }}
            >
              {expanded ? '▾ Hide Inspo Details' : '▸ View Inspo Details'}
            </button>

            {expanded && (
              <div style={{ background: '#FFF5F7', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {task.inspo.notes && (
                  <div style={{ fontSize: '12px', color: '#4a4a4a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {task.inspo.notes}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>On-Screen Text</div>
                  {task.inspo.onScreenText ? (
                    <div style={{ fontSize: '12px', color: '#f59e0b', lineHeight: 1.4, background: '#1a1500', border: '1px solid #fef3c7', borderRadius: '6px', padding: '8px 10px' }}>
                      {task.inspo.onScreenText}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>None</div>
                  )}
                </div>
                {task.inspo.transcript && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Transcript</div>
                    <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.4, fontStyle: 'italic' }}>
                      {task.inspo.transcript}
                    </div>
                  </div>
                )}
                {task.inspo.tags?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Tags</div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {task.inspo.tags.map((tag, i) => <TagPill key={i} tag={tag} index={i} />)}
                    </div>
                  </div>
                )}
                {task.inspo.audioType && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Audio</div>
                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: '#FFF0F3', color: '#888', border: '1px solid #E8C4CC' }}>
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
            <button onClick={onStartEditing} disabled={updating}
              style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600, background: updating ? '#E8C4CC' : '#dcfce7', color: updating ? '#555' : '#22c55e', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer', opacity: updating ? 0.6 : 1 }}>
              {updating ? 'Updating...' : 'Start Editing'}
            </button>
          )}
          {task.status === 'In Progress' && (
            <button onClick={onSubmit}
              style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E88FAC', borderRadius: '8px', cursor: 'pointer' }}>
              Submit for Review
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Unreviewed Library Section ───────────────────────────────────────────────

function UnreviewedLibrary({ showToast }) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCreator, setSelectedCreator] = useState('all')

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/editor/unreviewed')
      if (!res.ok) throw new Error('Failed to load unreviewed library')
      const data = await res.json()
      setAssets(data.assets || [])
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  // Build creator list from assets
  const creators = [...new Map(
    assets.filter(a => a.creator?.id).map(a => [a.creator.id, a.creator.name])
  )].sort((a, b) => a[1].localeCompare(b[1]))

  const filtered = selectedCreator === 'all'
    ? assets
    : assets.filter(a => a.creator?.id === selectedCreator)

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px 0' }}>Loading library...</div>
  }

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <select
            value={selectedCreator}
            onChange={e => setSelectedCreator(e.target.value)}
            style={{
              padding: '6px 12px', fontSize: '13px', fontWeight: 500,
              background: '#FFF5F7', color: '#1a1a1a', border: '1px solid #E8C4CC',
              borderRadius: '6px', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="all">All Creators ({assets.length})</option>
            {creators.map(([id, name]) => {
              const count = assets.filter(a => a.creator?.id === id).length
              return <option key={id} value={id}>{name} ({count})</option>
            })}
          </select>
          <span style={{ fontSize: '13px', color: '#999' }}>
            {filtered.length} {filtered.length === 1 ? 'clip' : 'clips'}
          </span>
        </div>
        <button
          onClick={fetchAssets}
          style={{
            padding: '6px 14px', fontSize: '12px', fontWeight: 600,
            background: '#ffffff', color: '#888', border: '1px solid #E8C4CC',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#555', fontSize: '14px', background: '#ffffff', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          {selectedCreator === 'all' ? 'No unreviewed clips in library.' : 'No clips for this creator.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 380px))', gap: '16px' }}>
          {filtered.map(asset => (
            <UnreviewedCard key={asset.id} asset={asset} />
          ))}
        </div>
      )}
    </div>
  )
}

function UnreviewedCard({ asset }) {
  const formattedDate = asset.createdTime
    ? new Date(asset.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  // Derive a short folder label from the path
  const pathParts = (asset.dropboxPath || '').split('/')
  const folderLabel = pathParts.length > 2 ? pathParts[pathParts.length - 2] : null

  return (
    <div style={{
      background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Thumbnail */}
      <div style={{ height: '180px', background: '#FFF5F7', position: 'relative', overflow: 'hidden' }}>
        {asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <svg style={{ width: '36px', height: '36px', color: '#E8C4CC' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <span style={{ fontSize: '11px', color: '#444' }}>No thumbnail</span>
          </div>
        )}
        {/* Unreviewed badge */}
        <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#f59e0b', fontWeight: 600 }}>
          UNREVIEWED
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        {/* Creator + date */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
              {asset.creator.name || 'Unknown Creator'}
            </div>
            {formattedDate && (
              <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
                Added {formattedDate}
              </div>
            )}
          </div>
          {asset.sourceType && (
            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, background: '#FFF0F3', color: '#999', border: '1px solid #E8C4CC', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {asset.sourceType}
            </span>
          )}
        </div>

        {/* Folder path hint */}
        {folderLabel && (
          <div style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace', background: '#FFF5F7', padding: '4px 8px', borderRadius: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📁 {folderLabel}
          </div>
        )}

        {/* Creator notes */}
        {asset.creatorNotes && (
          <div style={{ background: '#FFF5F7', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Notes</div>
            <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.4 }}>{asset.creatorNotes}</div>
          </div>
        )}

        {/* Download links */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: 'auto' }}>
          {(asset.dropboxLinks?.length > 0 ? asset.dropboxLinks : asset.dropboxLink ? [asset.dropboxLink] : []).map((link, i, arr) => (
            <a key={i} href={link} target="_blank" rel="noopener noreferrer"
              style={{
                flex: 1, minWidth: '80px', textAlign: 'center',
                padding: '8px', fontSize: '12px', fontWeight: 600,
                background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E8C4CC',
                borderRadius: '6px', textDecoration: 'none',
              }}>
              {arr.length > 1 ? `Clip ${i + 1} ↗` : 'View Clip ↗'}
            </a>
          ))}
          {!asset.dropboxLink && asset.dropboxLinks?.length === 0 && (
            <span style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>No link available</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── For Review Section (Admin) ───────────────────────────────────────────────

// ── RevisionFramePicker ───────────────────────────────────────────────────────
// Two modes: 'scrub' (pick the frame) → 'crop' (drag corners to crop it)
function RevisionFramePicker({ videoUrl, taskId, onCapture, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const scaleRef = useRef(1)
  const dragging = useRef(false)
  const startPos = useRef(null)
  const capturedJpegRef = useRef(null)

  const [mode, setMode] = useState('scrub') // 'scrub' | 'crop'
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sel, setSel] = useState(null)
  const [error, setError] = useState('')

  const rawUrl = videoUrl.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (videoUrl.includes('?') ? '&raw=1' : '?raw=1')

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  // ── Crop canvas helpers ──────────────────────────────────────────────────────
  function drawCrop(selection) {
    const canvas = canvasRef.current
    const image = imgRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (!selection) return
    const x = Math.min(selection.x1, selection.x2)
    const y = Math.min(selection.y1, selection.y2)
    const w = Math.abs(selection.x2 - selection.x1)
    const h = Math.abs(selection.y2 - selection.y1)
    // dim outside
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, x / scaleRef.current, y / scaleRef.current, w / scaleRef.current, h / scaleRef.current, x, y, w, h)
    // border
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    // corner handles
    const hs = 8
    ctx.fillStyle = '#ef4444'
    ;[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([cx, cy]) => {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs)
    })
  }

  function getCanvasPos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * (canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * (canvas.height / rect.height))),
    }
  }

  const onMouseDown = (e) => {
    e.preventDefault()
    dragging.current = true
    const pos = getCanvasPos(e)
    startPos.current = pos
    const newSel = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y }
    setSel(newSel)
    drawCrop(newSel)
  }

  const onMouseMove = (e) => {
    if (!dragging.current) return
    const pos = getCanvasPos(e)
    const newSel = { x1: startPos.current.x, y1: startPos.current.y, x2: pos.x, y2: pos.y }
    setSel(newSel)
    drawCrop(newSel)
  }

  const onMouseUp = () => { dragging.current = false }

  // ── Load captured JPEG onto crop canvas ──────────────────────────────────────
  useEffect(() => {
    if (mode !== 'crop' || !capturedJpegRef.current) return
    const image = new Image()
    image.onload = () => {
      imgRef.current = image
      const canvas = canvasRef.current
      if (!canvas) return
      const maxW = 340, maxH = 500
      const scale = Math.min(maxW / image.width, maxH / image.height, 1)
      scaleRef.current = scale
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      drawCrop(null)
    }
    image.src = `data:image/jpeg;base64,${capturedJpegRef.current}`
  }, [mode])

  // ── Capture frame (server-side FFmpeg) ───────────────────────────────────────
  const handleCapture = async () => {
    setCapturing(true)
    setError('')
    try {
      const frameRes = await fetch('/api/admin/posts/thumbnail/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, timestamp: currentTime }),
      })
      const frameData = await frameRes.json()
      if (!frameRes.ok) throw new Error(frameData.error || 'Frame extraction failed')
      capturedJpegRef.current = frameData.jpeg
      setSel(null)
      setMode('crop')
    } catch (err) {
      setError(err.message)
    } finally {
      setCapturing(false)
    }
  }

  // ── Upload blob to Dropbox and call onCapture ────────────────────────────────
  const uploadBlob = async (blob) => {
    setUploading(true)
    setError('')
    try {
      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId } = await tokenRes.json()
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

      const fileName = `revision_frame_${Date.now()}.jpg`
      const filePath = `/Palm Ops/Revision Notes/${fileName}`

      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: filePath, mode: 'add', autorename: true, mute: true }),
          'Dropbox-API-Path-Root': pathRoot,
          'Content-Type': 'application/octet-stream',
        },
        body: blob,
      })
      if (!dbxRes.ok) throw new Error(`Upload failed: ${await dbxRes.text()}`)
      const result = await dbxRes.json()

      let sharedLink = ''
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: result.path_display }),
        })
        if (linkRes.ok) sharedLink = ((await linkRes.json()).url || '').replace(/([?&])dl=0/, '$1raw=1')
      } catch {}

      if (!sharedLink) throw new Error('Failed to create shared link')
      onCapture(sharedLink)
      onClose()
    } catch (err) {
      setError(err.message)
      setUploading(false)
    }
  }

  const handleCropAndAdd = () => {
    if (!sel || !imgRef.current) return
    const selW = Math.abs(sel.x2 - sel.x1)
    const selH = Math.abs(sel.y2 - sel.y1)
    if (selW < 10 || selH < 10) return
    const x = Math.min(sel.x1, sel.x2)
    const y = Math.min(sel.y1, sel.y2)
    const scale = scaleRef.current
    const crop = document.createElement('canvas')
    crop.width = Math.round(selW / scale)
    crop.height = Math.round(selH / scale)
    crop.getContext('2d').drawImage(imgRef.current, x / scale, y / scale, selW / scale, selH / scale, 0, 0, crop.width, crop.height)
    crop.toBlob(blob => uploadBlob(blob), 'image/jpeg', 0.92)
  }

  const handleUseFullFrame = () => {
    const blob = new Blob([Uint8Array.from(atob(capturedJpegRef.current), c => c.charCodeAt(0))], { type: 'image/jpeg' })
    uploadBlob(blob)
  }

  const selW = sel ? Math.abs(sel.x2 - sel.x1) : 0
  const selH = sel ? Math.abs(sel.y2 - sel.y1) : 0
  const canCrop = selW > 10 && selH > 10

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div style={{ background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '100%', maxWidth: '380px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#4a4a4a' }}>
              {mode === 'scrub' ? 'Pick a frame' : 'Crop frame'}
            </div>
            <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
              {mode === 'scrub' ? 'Scrub to the moment you want to flag' : 'Drag to select — adjust corners to isolate the issue'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {mode === 'crop' && (
              <button onClick={() => { setMode('scrub'); setSel(null) }}
                style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                ← Back
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
        </div>

        {/* Scrub mode: video player */}
        {mode === 'scrub' && (
          <>
            <div style={{ background: '#080808', aspectRatio: '9/16', overflow: 'hidden' }}>
              <video ref={videoRef} src={rawUrl} muted playsInline preload="metadata"
                onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '11px', color: '#999', minWidth: '32px', fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)}</span>
                <input type="range" min={0} max={duration || 100} step={0.05} value={currentTime}
                  onChange={e => { const t = parseFloat(e.target.value); setCurrentTime(t); if (videoRef.current) videoRef.current.currentTime = t }}
                  style={{ flex: 1, accentColor: '#ef4444', cursor: 'pointer' }} />
                <span style={{ fontSize: '11px', color: '#999', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTime(duration)}</span>
              </div>
              {error && <div style={{ fontSize: '11px', color: '#ef4444', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '6px 10px' }}>{error}</div>}
              <button onClick={handleCapture} disabled={capturing || !duration}
                style={{ padding: '10px', background: capturing || !duration ? '#0d0d0d' : '#1a0a0a', border: '1px solid #5c2020', color: capturing || !duration ? '#3f3f46' : '#ef4444', borderRadius: '8px', cursor: capturing || !duration ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
                {capturing ? 'Extracting frame...' : '📸 Capture this frame'}
              </button>
            </div>
          </>
        )}

        {/* Crop mode: canvas with drag selection */}
        {mode === 'crop' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: '#080808', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8px' }}>
              <canvas
                ref={canvasRef}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                style={{ display: 'block', cursor: 'crosshair', maxWidth: '100%', borderRadius: '4px', userSelect: 'none' }}
              />
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {error && <div style={{ fontSize: '11px', color: '#ef4444', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '6px 10px' }}>{error}</div>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleUseFullFrame} disabled={uploading}
                  style={{ flex: 1, padding: '9px', background: '#FFF0F3', border: '1px solid #E8C4CC', color: '#999', borderRadius: '8px', cursor: uploading ? 'default' : 'pointer', fontSize: '12px', fontWeight: 600, opacity: uploading ? 0.5 : 1 }}>
                  Use full frame
                </button>
                <button onClick={handleCropAndAdd} disabled={!canCrop || uploading}
                  style={{ flex: 2, padding: '9px', background: canCrop && !uploading ? '#1a0a0a' : '#0d0d0d', border: '1px solid #5c2020', color: canCrop && !uploading ? '#ef4444' : '#3f3f46', borderRadius: '8px', cursor: canCrop && !uploading ? 'pointer' : 'default', fontSize: '12px', fontWeight: 700 }}>
                  {uploading ? 'Uploading...' : 'Crop & Add'}
                </button>
              </div>
              {!canCrop && <div style={{ fontSize: '10px', color: '#3f3f46', textAlign: 'center' }}>Drag on the image to select an area</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CropperModal ──────────────────────────────────────────────────────────────
function CropperModal({ file, onCrop, onSkip }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const scaleRef = useRef(1)
  const dragging = useRef(false)
  const startPos = useRef(null)
  const [sel, setSel] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const image = new Image()
      image.onload = () => {
        imgRef.current = image
        const canvas = canvasRef.current
        if (!canvas) return
        const maxW = 580, maxH = 460
        const scale = Math.min(maxW / image.width, maxH / image.height, 1)
        scaleRef.current = scale
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        draw(null)
        setReady(true)
      }
      image.src = e.target.result
    }
    reader.readAsDataURL(file)
  }, [file])

  function draw(selection) {
    const canvas = canvasRef.current
    const image = imgRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (selection) {
      const x = Math.min(selection.x1, selection.x2)
      const y = Math.min(selection.y1, selection.y2)
      const w = Math.abs(selection.x2 - selection.x1)
      const h = Math.abs(selection.y2 - selection.y1)
      // dim everything outside selection
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // redraw selected region clearly
      ctx.drawImage(image, x / scaleRef.current, y / scaleRef.current, w / scaleRef.current, h / scaleRef.current, x, y, w, h)
      // selection border
      ctx.strokeStyle = '#E88FAC'
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      // corner handles
      const hs = 6
      ctx.fillStyle = '#E88FAC'
      ;[[x, y], [x+w, y], [x, y+h], [x+w, y+h]].forEach(([cx, cy]) => {
        ctx.fillRect(cx - hs/2, cy - hs/2, hs, hs)
      })
    }
  }

  function getPos(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * (canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * (canvas.height / rect.height))),
    }
  }

  function onMouseDown(e) {
    e.preventDefault()
    dragging.current = true
    const pos = getPos(e)
    startPos.current = pos
    const newSel = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y }
    setSel(newSel)
    draw(newSel)
  }

  function onMouseMove(e) {
    if (!dragging.current) return
    const pos = getPos(e)
    const newSel = { x1: startPos.current.x, y1: startPos.current.y, x2: pos.x, y2: pos.y }
    setSel(newSel)
    draw(newSel)
  }

  function onMouseUp() { dragging.current = false }

  const selW = sel ? Math.abs(sel.x2 - sel.x1) : 0
  const selH = sel ? Math.abs(sel.y2 - sel.y1) : 0
  const canCrop = selW > 15 && selH > 15

  const handleCrop = () => {
    if (!canCrop || !imgRef.current || !sel) return
    const scale = scaleRef.current
    const x = Math.min(sel.x1, sel.x2)
    const y = Math.min(sel.y1, sel.y2)
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = Math.round(selW / scale)
    cropCanvas.height = Math.round(selH / scale)
    const ctx = cropCanvas.getContext('2d')
    ctx.drawImage(imgRef.current, x / scale, y / scale, selW / scale, selH / scale, 0, 0, cropCanvas.width, cropCanvas.height)
    cropCanvas.toBlob(blob => {
      const name = file.name.replace(/\.[^.]+$/, '') + '_crop.png'
      onCrop(new File([blob], name, { type: 'image/png' }))
    }, 'image/png', 0.95)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#ffffff', border: '1px solid #E8C4CC', borderRadius: '16px', padding: '20px', maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: '12px' }}
        onClick={e => e.stopPropagation()}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>Crop Screenshot</div>
          <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>Drag to select what to send · or skip to use the full image</div>
        </div>
        {!ready && <div style={{ width: '200px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' }}>Loading...</div>}
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ display: ready ? 'block' : 'none', cursor: 'crosshair', maxWidth: '100%', borderRadius: '8px', border: '1px solid #E8C4CC', userSelect: 'none' }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={() => onSkip(file)}
            style={{ padding: '8px 16px', border: '1px solid #E8C4CC', borderRadius: '8px', color: '#888', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: 'transparent' }}>
            Use Full Image
          </button>
          <button onClick={handleCrop} disabled={!canCrop}
            style={{ padding: '8px 18px', border: 'none', borderRadius: '8px', color: '#1a1a1a', fontSize: '12px', fontWeight: 700, cursor: canCrop ? 'pointer' : 'not-allowed', background: canCrop ? '#E88FAC' : '#E8C4CC', opacity: canCrop ? 1 : 0.5 }}>
            Crop & Add
          </button>
        </div>
      </div>
    </div>
  )
}

function RevisionModal({ task, onClose, onSubmit }) {
  const [feedback, setFeedback] = useState('')
  const [screenshots, setScreenshots] = useState([])
  const [cropQueue, setCropQueue] = useState([])
  const [showFramePicker, setShowFramePicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const videoUrl = task?.asset?.editedFileLink || ''
  const hasVideo = !!videoUrl

  const uploadFiles = async (files) => {
    if (!files.length) return
    setUploading(true)
    setProgress('Uploading...')
    setError('')
    try {
      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId } = await tokenRes.json()
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

      const uploaded = []
      for (const file of files) {
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
        const fileName = `revision_note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
        const filePath = `/Palm Ops/Revision Notes/${fileName}`
        const buffer = await file.arrayBuffer()

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
        if (!dbxRes.ok) throw new Error(`Upload failed: ${await dbxRes.text()}`)
        const result = await dbxRes.json()

        let sharedLink = ''
        try {
          const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: result.path_display }),
          })
          if (linkRes.ok) sharedLink = ((await linkRes.json()).url || '').replace(/([?&])dl=0/, '$1raw=1')
        } catch {}
        if (sharedLink) uploaded.push(sharedLink)
      }
      setScreenshots(prev => [...prev, ...uploaded])
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  const handleFileSelect = (files) => {
    if (!files.length) return
    setCropQueue(Array.from(files))
  }

  const handleCropDone = (croppedFile) => {
    uploadFiles([croppedFile])
    setCropQueue(prev => prev.slice(1))
  }

  const handleSkip = (originalFile) => {
    uploadFiles([originalFile])
    setCropQueue(prev => prev.slice(1))
  }

  const handleSubmit = async () => {
    if (!feedback.trim()) { setError('Please enter feedback before sending'); return }
    await onSubmit(task.id, feedback, screenshots)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div style={{ background: '#ffffff', border: '1px solid #E8C4CC', borderRadius: '16px', padding: '28px', width: '500px', maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Request Revision</h3>
        <p style={{ fontSize: '12px', color: '#999', marginBottom: '20px' }}>
          {task.inspo.title || task.name} · {task.creator.name}
        </p>

        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Feedback</div>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Describe what needs to change..."
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', background: '#FFF5F7',
              border: '1px solid #E8C4CC', borderRadius: '8px', color: '#4a4a4a',
              fontSize: '13px', resize: 'vertical', minHeight: '100px',
              fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5,
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Screenshots <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#3f3f46' }}>— drag to crop after selecting</span>
          </div>
          {screenshots.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {screenshots.map((url, i) => (
                <div key={i} style={{ position: 'relative', width: '72px', height: '72px' }}>
                  <img src={url.replace(/([?&])dl=[01]/, '$1raw=1')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px', border: '1px solid #E8C4CC' }} />
                  <button
                    onClick={() => setScreenshots(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#ef4444', border: 'none', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', color: '#1a1a1a', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || cropQueue.length > 0}
              style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 600, background: '#FFF0F3', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: 'pointer', opacity: (uploading || cropQueue.length > 0) ? 0.6 : 1 }}>
              {uploading ? progress || 'Uploading...' : '+ Add Screenshot'}
            </button>
            {hasVideo && (
              <button
                onClick={() => setShowFramePicker(true)}
                disabled={uploading || cropQueue.length > 0}
                style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 600, background: '#1a0a0a', color: '#ef4444', border: '1px solid #5c2020', borderRadius: '6px', cursor: 'pointer', opacity: (uploading || cropQueue.length > 0) ? 0.6 : 1 }}>
                📸 Pick frame from video
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => handleFileSelect(e.target.files)} style={{ display: 'none' }} />
        </div>

        {error && <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '9px 18px', border: 'none', borderRadius: '8px', color: '#1a1a1a', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: '#E8C4CC' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={uploading || !feedback.trim()}
            style={{
              padding: '9px 22px', border: 'none', borderRadius: '8px', color: '#1a1a1a', fontSize: '13px', fontWeight: 600,
              cursor: uploading || !feedback.trim() ? 'not-allowed' : 'pointer',
              background: uploading || !feedback.trim() ? '#E8C4CC' : '#ef4444', opacity: uploading ? 0.6 : 1,
            }}>
            Send Revision Request
          </button>
        </div>
      </div>

      {/* Crop modal portal */}
      {cropQueue.length > 0 && typeof document !== 'undefined' && createPortal(
        <CropperModal
          file={cropQueue[0]}
          onCrop={handleCropDone}
          onSkip={handleSkip}
        />,
        document.body
      )}

      {/* Frame picker portal */}
      {showFramePicker && hasVideo && typeof document !== 'undefined' && createPortal(
        <RevisionFramePicker
          videoUrl={videoUrl}
          taskId={task.id}
          onCapture={(url) => setScreenshots(prev => [...prev, url])}
          onClose={() => setShowFramePicker(false)}
        />,
        document.body
      )}
    </div>
  )
}

function VideoModal({ url, onClose }) {
  const rawUrl = url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ position: 'relative', maxHeight: '90vh', maxWidth: '420px', width: '100%' }}>
        <video src={rawUrl} controls autoPlay playsInline
          style={{ width: '100%', maxHeight: '90vh', borderRadius: '10px', display: 'block', background: '#000' }} />
        <button onClick={onClose}
          style={{ position: 'absolute', top: '-14px', right: '-14px', background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '50%', width: '32px', height: '32px', color: '#1a1a1a', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ×
        </button>
      </div>
    </div>
  )
}

function ForReview({ showToast }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())
  const [videoModal, setVideoModal] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [revisionTask, setRevisionTask] = useState(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/editor/review')
      if (!res.ok) throw new Error('Failed to load review queue')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const handleApprove = async (taskId) => {
    setUpdating(taskId)
    try {
      const res = await fetch('/api/admin/editor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action: 'approve' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Approve failed')
      setTasks(prev => prev.filter(t => t.id !== taskId))
      const slotLabel = data.scheduledDate ? formatSlot(data.scheduledDate) : null
      showToast(slotLabel ? `Approved — ${slotLabel}` : 'Approved')
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setUpdating(null)
    }
  }

  const handleRevision = async (taskId, adminFeedback, adminScreenshotUrls) => {
    setUpdating(taskId)
    try {
      const res = await fetch('/api/admin/editor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action: 'requestRevision', adminFeedback, adminScreenshotUrls }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Revision request failed')
      setTasks(prev => prev.filter(t => t.id !== taskId))
      setRevisionTask(null)
      showToast('Revision sent back to editor')
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setUpdating(null)
    }
  }

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px 0' }}>Loading review queue...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>
          {tasks.length} edit{tasks.length !== 1 ? 's' : ''} waiting for your review
        </p>
        <button onClick={fetchTasks}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: '#ffffff', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {tasks.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#555', fontSize: '14px', background: '#ffffff', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          No edits waiting for review.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {tasks.map(task => {
            const isExpanded = expanded.has(task.id)
            const fmtDate = task.completedAt
              ? new Date(task.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
              : null

            const toRawUrl = url => url ? url.replace(/([?&])dl=[01]/, '$1raw=1').replace(/^(https:\/\/www\.dropbox\.com\/.+)(?<![?&]raw=1)$/, (m) => m.includes('?') ? m + '&raw=1' : m + '?raw=1') : ''
            const rawClipUrl = toRawUrl((task.asset.dropboxLink || '').split('\n').filter(Boolean)[0] || '')
            const editUrl = task.asset.editedFileLink ? task.asset.editedFileLink.replace(/([?&])dl=[01]/, '$1raw=1') : ''
            const inspoVideoUrl = task.inspo.dbShareLink ? toRawUrl(task.inspo.dbShareLink) : ''
            const hasInspo = !!(inspoVideoUrl || task.inspo.thumbnail)

            return (
              <div key={task.id} style={{ background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', overflow: 'hidden' }}>
                {/* Video strip — RAW | EDIT | INSPO */}
                <div style={{ display: 'flex', background: '#FFF5F7', gap: '2px' }}>

                  {/* RAW clip */}
                  <div style={{ flex: 1, position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: '#0a0a14' }}>
                    {rawClipUrl ? (
                      <>
                        <video src={rawClipUrl} autoPlay muted loop playsInline preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                          onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
                        <button onClick={() => setVideoModal(task.asset.dropboxLink.split('\n').filter(Boolean)[0])}
                          style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#1a1a1a', fontSize: '10px', fontWeight: 600, padding: '2px 6px', cursor: 'pointer' }}>
                          ⛶
                        </button>
                      </>
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '11px' }}>No raw clip</div>
                    )}
                    <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#3b82f6', fontWeight: 600 }}>RAW</div>
                  </div>

                  {/* EDIT clip */}
                  <div style={{ flex: 1, position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: '#0a1a0a' }}>
                    {editUrl ? (
                      <>
                        <video src={editUrl} autoPlay muted loop playsInline preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                          onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
                        <button onClick={() => setVideoModal(task.asset.editedFileLink)}
                          style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: '#1a1a1a', fontSize: '10px', fontWeight: 600, padding: '2px 6px', cursor: 'pointer' }}>
                          ⛶
                        </button>
                      </>
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8C4CC', fontSize: '11px' }}>No edit yet</div>
                    )}
                    <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#22c55e', fontWeight: 600 }}>EDIT</div>
                  </div>

                  {/* INSPO clip — only if available */}
                  {hasInspo && (
                    <div style={{ flex: 1, position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: '#14000a' }}>
                      {inspoVideoUrl ? (
                        <video src={inspoVideoUrl} autoPlay muted loop playsInline preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                          onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
                      ) : task.inspo.thumbnail ? (
                        <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                      ) : null}
                      <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#E88FAC', fontWeight: 600 }}>INSPO</div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>{task.creator.name}</div>
                      <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{task.inspo.title || task.name}</div>
                    </div>
                    {fmtDate && <span style={{ fontSize: '10px', color: '#999', whiteSpace: 'nowrap', marginTop: '2px' }}>Submitted {fmtDate}</span>}
                  </div>

                  {/* Quick links */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {task.asset.editedFileLink && (
                      <a href={task.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '3px 8px', background: '#dcfce7', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
                        Download Edit ↗
                      </a>
                    )}
                    {task.inspo.contentLink && (
                      <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', padding: '3px 8px', background: '#FFF0F3', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
                        Original Reel ↗
                      </a>
                    )}
                  </div>

                  {/* Editor notes */}
                  {task.editorNotes && (
                    <div style={{ background: '#FFF5F7', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Editor Notes</div>
                      <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.4 }}>{task.editorNotes}</div>
                    </div>
                  )}

                  {/* Inspo details toggle */}
                  {task.inspo.notes && (
                    <>
                      <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n })}
                        style={{ background: 'none', border: 'none', color: '#999', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                        {isExpanded ? '▾ Hide inspo' : '▸ View inspo direction'}
                      </button>
                      {isExpanded && (
                        <div style={{ background: '#FFF5F7', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '8px', padding: '12px' }}>
                          <div style={{ fontSize: '12px', color: '#4a4a4a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{task.inspo.notes}</div>
                          {task.inspo.onScreenText && (
                            <div style={{ marginTop: '8px', fontSize: '12px', color: '#f59e0b', background: '#1a1500', border: '1px solid #fef3c7', borderRadius: '6px', padding: '8px 10px' }}>
                              "{task.inspo.onScreenText}"
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                    <button
                      onClick={() => setRevisionTask(task)}
                      disabled={updating === task.id}
                      style={{ padding: '10px', fontSize: '13px', fontWeight: 600, background: '#2d1515', color: '#ef4444', border: '1px solid #5c2020', borderRadius: '8px', cursor: 'pointer', opacity: updating === task.id ? 0.6 : 1 }}>
                      Request Revision
                    </button>
                    <button
                      onClick={() => handleApprove(task.id)}
                      disabled={updating === task.id}
                      style={{ padding: '10px', fontSize: '13px', fontWeight: 600, background: '#dcfce7', color: '#22c55e', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer', opacity: updating === task.id ? 0.6 : 1 }}>
                      {updating === task.id ? 'Saving...' : 'Approve ✓'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {revisionTask && (
        <RevisionModal
          task={revisionTask}
          onClose={() => setRevisionTask(null)}
          onSubmit={(taskId, feedback, screenshots) => handleRevision(taskId, feedback, screenshots)}
        />
      )}

      {videoModal && (
        <VideoModal url={videoModal} onClose={() => setVideoModal(null)} />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EditorQueue() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [activeSection, setActiveSection] = useState(searchParams.get('tab') || 'editorview')
  useEffect(() => { const t = searchParams.get('tab'); if (t) setActiveSection(t) }, [searchParams])

  const switchSection = (key) => {
    setActiveSection(key)
    router.replace(`${pathname}?tab=${key}`, { scroll: false })
  }
  const [toast, setToast] = useState(null)
  const [notifStatus, setNotifStatus] = useState('idle') // 'idle' | 'subscribed' | 'denied'

  const showToast = useCallback((msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'granted' && localStorage.getItem('pushSubscribed') === '1') {
      setNotifStatus('subscribed')
    } else if (Notification.permission === 'denied') {
      setNotifStatus('denied')
    }
  }, [])

  const handleEnableNotifications = async () => {
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setNotifStatus('denied'); return }

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BBAmRh4Y45N-wv0Xpj3kf0scyA0dCt-nJFhurWAM69kqcRarLkdrz9ttIZT4K-isDyN0Zm_vLtVJiLGQwMdGIZk'
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      })

      const res = await fetch('/api/admin/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('Failed to save subscription')

      localStorage.setItem('pushSubscribed', '1')
      setNotifStatus('subscribed')
      showToast('Notifications enabled')
    } catch (err) {
      showToast(err.message, true)
    }
  }

  const TABS = [
    { key: 'editorview', label: '📋 Dashboard' },
    { key: 'review', label: '👁 For Review' },
    { key: 'postprep', label: '✈️ Post Prep' },
    { key: 'library', label: '📁 Creator Library' },
  ]

  return (
    <div>
      {/* Header row: tabs + notification */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => switchSection(tab.key)}
            style={{
              padding: '6px 16px', fontSize: '13px', fontWeight: activeSection === tab.key ? 700 : 400,
              color: activeSection === tab.key ? '#1a1a1a' : '#bbb', background: 'none', border: 'none',
              borderBottom: activeSection === tab.key ? '2px solid #E88FAC' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-2px', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
        </div>
        {/* Notification opt-in */}
        {'Notification' in (typeof window !== 'undefined' ? window : {}) && (
          <div style={{ flexShrink: 0 }}>
            {notifStatus === 'idle' && (
              <button onClick={handleEnableNotifications}
                style={{ fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '8px', border: '1px solid #E8C4CC', background: 'transparent', color: '#999', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                🔔 Notifications
              </button>
            )}
            {notifStatus === 'subscribed' && (
              <span style={{ fontSize: '11px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '4px' }}>🔔 On</span>
            )}
            {notifStatus === 'denied' && (
              <span style={{ fontSize: '11px', color: '#999' }}>🔔 Blocked</span>
            )}
          </div>
        )}
      </div>

      {/* Section content */}
      {activeSection === 'editorview' && <EditorDashboardContent />}
      {activeSection === 'review' && <ForReview showToast={showToast} />}
      {activeSection === 'postprep' && <PostsPage />}
      {activeSection === 'library' && <UnreviewedLibrary showToast={showToast} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#2d1515' : '#dcfce7',
          color: toast.error ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.error ? '#5c2020' : '#bbf7d0'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
