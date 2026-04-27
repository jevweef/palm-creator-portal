'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { EditorDashboardContent, getSlotLabel, LibraryCard, LibPickerPaginator, isVideo, isPhoto, LIB_PAGE_SIZE } from '@/components/EditorDashboard'
import PostsPage from '@/app/admin/posts/page'
import LongFormUpload from '@/components/LongFormUpload'
import OftvProjectsQueue from '@/components/OftvProjectsQueue'
import GridPlanner from '@/components/GridPlanner'
import CaptionSuggestions from '@/components/CaptionSuggestions'

function formatSlot(isoDate) {
  const label = getSlotLabel(isoDate)
  const d = new Date(isoDate)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
  return `${label} · ${dateStr}`
}

const STATUS_COLORS = {
  'To Do': { bg: 'rgba(232, 200, 120, 0.08)', text: '#E8C878', border: 'rgba(232, 200, 120, 0.2)' },
  'In Progress': { bg: '#0a1a3d', text: '#78B4E8', border: '#1a3a6d' },
}

const TAG_COLORS = [
  'var(--palm-pink)', '#7DD3A4', '#E8C878', '#78B4E8', '#E87878', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
]

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg: 'rgba(232, 160, 160, 0.06)', text: '#999', border: 'transparent' }
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
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '24px', width: '440px', maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
          Submit Edit for Review
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '16px' }}>
          {task.inspo.title} — {task.creator.name}
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
          onDragOver={e => e.preventDefault()}
          style={{
            border: `2px dashed ${file ? '#7DD3A4' : 'rgba(255,255,255,0.08)'}`, borderRadius: '18px',
            padding: '24px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s',
            background: file ? 'rgba(125, 211, 164, 0.08)' : 'transparent',
          }}
        >
          {file ? (
            <div>
              <div style={{ fontSize: '13px', color: '#7DD3A4', fontWeight: 600 }}>{file.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
                {(file.size / (1024 * 1024)).toFixed(1)} MB — click to change
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Drop edited video here or click to browse</div>
              <div style={{ fontSize: '11px', color: 'rgba(240, 236, 232, 0.85)', marginTop: '4px' }}>MP4, MOV</div>
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
            background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px',
            color: 'rgba(240, 236, 232, 0.85)', fontSize: '13px', resize: 'vertical', minHeight: '60px',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />

        {error && <p style={{ fontSize: '12px', color: '#E87878', marginTop: '8px' }}>{error}</p>}
        {progress && <p style={{ fontSize: '12px', color: 'var(--palm-pink)', marginTop: '8px' }}>{progress}</p>}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', color: 'var(--foreground)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: 'transparent' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!file || uploading}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: '6px', color: 'var(--foreground)', fontSize: '13px', fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              background: !file || uploading ? 'transparent' : 'var(--palm-pink)', opacity: uploading ? 0.6 : 1,
            }}>
            {uploading ? 'Uploading...' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Music Panel (inside task card) ──────────────────────────────────────────

function MusicPanel({ task }) {
  const [identifying, setIdentifying] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [identifiedSong, setIdentifiedSong] = useState(task.inspo.identifiedSongData || null)
  const [identifiedLabel, setIdentifiedLabel] = useState(task.inspo.identifiedSong || '')
  const [error, setError] = useState('')
  const [playingPreview, setPlayingPreview] = useState(null)
  const audioRef = useRef(null)

  const audioType = typeof task.inspo.audioType === 'object' ? task.inspo.audioType?.name : task.inspo.audioType

  async function handleIdentify() {
    const videoUrl = task.inspo.dbShareLink || task.asset.dropboxLink
    if (!videoUrl) { setError('No video URL available'); return }
    setIdentifying(true)
    setError('')
    try {
      const res = await fetch('/api/admin/music/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspoId: task.inspo.id, videoUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Identification failed')
      if (data.match) {
        setIdentifiedSong(data.song)
        setIdentifiedLabel(`${data.song.artist} - ${data.song.title}`)
      } else {
        setError('No song match found')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setIdentifying(false)
    }
  }

  async function handleGetSuggestions() {
    setLoadingSuggestions(true)
    setError('')
    try {
      const res = await fetch('/api/admin/music/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspoId: task.inspo.id, creatorId: task.creator.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to get suggestions')
      setSuggestions(data.suggestions || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingSuggestions(false)
    }
  }

  async function handleDownload(track) {
    setDownloading(track.spotifyId)
    try {
      const res = await fetch('/api/admin/music/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUrl: track.spotifyUrl, artist: track.artist, title: track.track }),
      })
      if (res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${track.artist} - ${track.track}.mp3`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        if (data.fallback) {
          if (data.links?.spotify) {
            await navigator.clipboard?.writeText(data.links.spotify).catch(() => {})
            setError('URL copied — paste in spotdown (Cmd+V)')
            setTimeout(() => setError(''), 4000)
          }
          window.open(data.links?.spotdown || 'https://spotdown.org', '_blank')
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(null)
    }
  }

  function togglePreview(track) {
    if (playingPreview === track.spotifyId) {
      audioRef.current?.pause()
      setPlayingPreview(null)
    } else if (track.previewUrl) {
      if (audioRef.current) audioRef.current.pause()
      const audio = new Audio(track.previewUrl)
      audio.play()
      audio.onended = () => setPlayingPreview(null)
      audioRef.current = audio
      setPlayingPreview(track.spotifyId)
    }
  }

  return (
    <div style={{ borderTop: '1px solid transparent', paddingTop: '8px' }}>
      <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Music</div>

      {/* Audio type + identified song */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
        {audioType && (
          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: 'rgba(232, 160, 160, 0.04)', color: 'var(--foreground-muted)', border: '1px solid transparent' }}>
            {audioType}
          </span>
        )}
        {identifiedLabel ? (
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--foreground)' }}>
            {identifiedLabel}
          </span>
        ) : (
          <button onClick={handleIdentify} disabled={identifying}
            style={{
              padding: '3px 10px', fontSize: '11px', fontWeight: 500,
              background: identifying ? 'rgba(255,255,255,0.04)' : '#F0F4FF', color: identifying ? '#999' : '#6B7FE3',
              border: '1px solid rgba(107,127,227,0.2)', borderRadius: '4px', cursor: identifying ? 'default' : 'pointer',
            }}>
            {identifying ? 'Identifying...' : 'Identify Song'}
          </button>
        )}
      </div>

      {/* Spotify link for identified song */}
      {identifiedSong?.spotifyUrl && (
        <div style={{ marginBottom: '6px' }}>
          <a href={identifiedSong.spotifyUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#1DB954', textDecoration: 'none' }}>
            Open in Spotify ↗
          </a>
        </div>
      )}

      {/* Get suggestions button */}
      {(identifiedLabel || task.creator.id) && !suggestions && (
        <button onClick={handleGetSuggestions} disabled={loadingSuggestions}
          style={{
            padding: '5px 12px', fontSize: '11px', fontWeight: 500, marginBottom: '6px',
            background: loadingSuggestions ? 'rgba(255,255,255,0.04)' : 'var(--palm-pink)', color: loadingSuggestions ? '#999' : 'rgba(255,255,255,0.08)',
            border: 'none', borderRadius: '4px', cursor: loadingSuggestions ? 'default' : 'pointer',
          }}>
          {loadingSuggestions ? 'Loading...' : 'Get Similar Songs'}
        </button>
      )}

      {/* Suggestions list */}
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '300px', overflowY: 'auto' }}>
          {suggestions.map((track, i) => (
            <div key={track.spotifyId || i}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
                borderRadius: '4px', background: i % 2 === 0 ? 'var(--card-bg-solid)' : 'transparent', fontSize: '11px',
              }}>
                {track.albumArt && (
                  <img src={track.albumArt} alt="" style={{ width: '28px', height: '28px', borderRadius: '3px', objectFit: 'cover', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.track}</div>
                  <div style={{ color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '10px' }}>{track.artist}</div>
                </div>
                {track.spotifyId && (
                  <button onClick={() => setPlayingPreview(playingPreview === track.spotifyId ? null : track.spotifyId)}
                    style={{ padding: '2px 6px', fontSize: '10px', background: playingPreview === track.spotifyId ? 'var(--palm-pink)' : 'rgba(255,255,255,0.04)', color: playingPreview === track.spotifyId ? 'var(--foreground)' : '#888', border: 'none', borderRadius: '3px', cursor: 'pointer', flexShrink: 0 }}>
                    {playingPreview === track.spotifyId ? '■' : '▶'}
                  </button>
                )}
                <button onClick={() => handleDownload(track)} disabled={downloading === track.spotifyId}
                  style={{
                    padding: '2px 6px', fontSize: '10px', fontWeight: 500, flexShrink: 0,
                    background: downloading === track.spotifyId ? 'rgba(255,255,255,0.04)' : 'rgba(125, 211, 164, 0.08)',
                    color: downloading === track.spotifyId ? '#999' : '#7DD3A4',
                    border: '1px solid transparent', borderRadius: '3px', cursor: downloading === track.spotifyId ? 'default' : 'pointer',
                  }}>
                  {downloading === track.spotifyId ? '...' : '↓'}
                </button>
              </div>
              {playingPreview === track.spotifyId && track.spotifyId && (
                <div style={{ padding: '4px 6px' }}>
                  <iframe
                    src={`https://open.spotify.com/embed/track/${track.spotifyId}?utm_source=generator&theme=0`}
                    width="100%" height="80" frameBorder="0"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    style={{ borderRadius: '8px' }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {suggestions && suggestions.length === 0 && (
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '4px 0' }}>No suggestions found. Try adding Music DNA to the creator profile.</div>
      )}

      {error && <div style={{ fontSize: '11px', color: '#E87878', marginTop: '4px' }}>{error}</div>}
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
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading tasks...</div>
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
                background: filter === tab.key ? 'rgba(232, 160, 160, 0.06)' : 'transparent',
                color: filter === tab.key ? 'var(--palm-pink)' : '#999',
                border: `1px solid ${filter === tab.key ? 'var(--palm-pink)' : 'transparent'}`,
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
            background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', background: 'var(--card-bg-solid)', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
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
      background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Visual header */}
      <div style={{ display: 'flex', height: '200px', background: 'var(--background)' }}>
        {/* Inspo thumbnail */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.inspo.thumbnail ? (
            <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'transparent', fontSize: '12px' }}>No thumbnail</div>
          )}
          <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: 'var(--palm-pink)', fontWeight: 600 }}>
            INSPO
          </div>
        </div>

        {/* Arrow */}
        <div style={{ width: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', flexShrink: 0 }}>
          <span style={{ color: 'transparent', fontSize: '18px' }}>→</span>
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
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(232, 160, 160, 0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = '#0f0f1a'}
            >
              <svg style={{ width: '32px', height: '32px', color: 'var(--palm-pink)', marginBottom: '8px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span style={{ color: 'var(--palm-pink)', fontSize: '12px', fontWeight: 600 }}>Download Clips</span>
            </a>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', color: 'transparent', fontSize: '12px' }}>
              No clip yet
            </div>
          )}
          <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#7DD3A4', fontWeight: 600 }}>
            CREATOR CLIP
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)' }}>
              {task.creator.name || 'Unknown Creator'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
              {task.inspo.title || task.name}
            </div>
          </div>
          <StatusBadge status={task.status} />
        </div>

        {/* Quick links */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {task.inspo.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none', padding: '3px 8px', background: 'rgba(232, 160, 160, 0.04)', borderRadius: '4px', border: '1px solid transparent' }}>
              Original Reel ↗
            </a>
          )}
          {task.inspo.dbShareLink && (
            <a href={task.inspo.dbShareLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none', padding: '3px 8px', background: 'rgba(232, 160, 160, 0.04)', borderRadius: '4px', border: '1px solid transparent' }}>
              Analyzed Video ↗
            </a>
          )}
          {(task.asset.dropboxLinks?.length > 0 ? task.asset.dropboxLinks : task.asset.dropboxLink ? [task.asset.dropboxLink] : []).map((link, i, arr) => (
            <a key={i} href={link} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#7DD3A4', textDecoration: 'none', padding: '3px 8px', background: 'rgba(125, 211, 164, 0.08)', borderRadius: '4px', border: '1px solid transparent' }}>
              {arr.length > 1 ? `Clip ${i + 1} ↗` : 'Creator Clips ↗'}
            </a>
          ))}
        </div>

        {/* Creator notes */}
        {(task.creatorNotes || task.asset.creatorNotes) && (
          <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', padding: '10px' }}>
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Creator Notes
            </div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.4 }}>
              {task.creatorNotes || task.asset.creatorNotes}
            </div>
          </div>
        )}

        {/* Inspo details toggle */}
        {task.inspo.id && (
          <>
            <button
              onClick={onToggleExpand}
              style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: 0 }}
            >
              {expanded ? '▾ Hide Inspo Details' : '▸ View Inspo Details'}
            </button>

            {expanded && (
              <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {task.inspo.notes && (
                  <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {task.inspo.notes}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>On-Screen Text</div>
                  {task.inspo.onScreenText ? (
                    <div style={{ fontSize: '12px', color: '#E8C878', lineHeight: 1.4, background: '#1a1500', border: '1px solid #fef3c7', borderRadius: '6px', padding: '8px 10px' }}>
                      {task.inspo.onScreenText}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)', fontStyle: 'italic' }}>None</div>
                  )}
                </div>
                {task.inspo.transcript && (
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Transcript</div>
                    <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.4, fontStyle: 'italic' }}>
                      {task.inspo.transcript}
                    </div>
                  </div>
                )}
                {task.inspo.tags?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Tags</div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {task.inspo.tags.map((tag, i) => <TagPill key={i} tag={tag} index={i} />)}
                    </div>
                  </div>
                )}
                {/* Music Panel */}
                <MusicPanel task={task} />
              </div>
            )}
          </>
        )}

        {/* Action button */}
        <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
          {task.status === 'To Do' && (
            <button onClick={onStartEditing} disabled={updating}
              style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600, background: updating ? 'transparent' : 'rgba(125, 211, 164, 0.08)', color: updating ? 'rgba(240, 236, 232, 0.85)' : '#7DD3A4', border: '1px solid transparent', borderRadius: '8px', cursor: 'pointer', opacity: updating ? 0.6 : 1 }}>
              {updating ? 'Updating...' : 'Start Editing'}
            </button>
          )}
          {task.status === 'In Progress' && (
            <button onClick={onSubmit}
              style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600, background: 'rgba(232, 160, 160, 0.04)', color: 'var(--palm-pink)', border: '1px solid transparent', borderRadius: '8px', cursor: 'pointer' }}>
              Submit for Review
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Unreviewed Library Section ───────────────────────────────────────────────

// ─── Creator Music Radio (DNA-only, no inspo reel needed) ────────────────────

function CreatorMusicRadio({ creatorId, creatorName, hasPlaylist }) {
  const [suggestions, setSuggestions] = useState(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [playingPreview, setPlayingPreview] = useState(null)
  const [error, setError] = useState('')
  const audioRef = useRef(null)
  const [musicTab, setMusicTab] = useState('creator')
  const [top50, setTop50] = useState(null)
  const [loadingTop50, setLoadingTop50] = useState(false)
  const [billboard, setBillboard] = useState(null)
  const [loadingBillboard, setLoadingBillboard] = useState(false)
  const [usedSongIds, setUsedSongIds] = useState(new Set())

  useEffect(() => {
    if (!creatorId) return
    fetch(`/api/admin/music/usage?creatorId=${creatorId}`)
      .then(r => r.json())
      .then(d => { if (d.usedIds) setUsedSongIds(new Set(d.usedIds)) })
      .catch(() => {})
  }, [creatorId])

  const filterUsed = (tracks) => tracks?.filter(t => !t.spotifyId || !usedSongIds.has(t.spotifyId)) || []

  async function handleGetSuggestions() {
    if (suggestions) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/music/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to get suggestions')
      setSuggestions(data.suggestions || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchTop50() {
    if (top50) return
    setLoadingTop50(true)
    try {
      const res = await fetch('/api/admin/music/charts')
      const data = await res.json()
      if (res.ok) setTop50(data.tracks || [])
      else setError(data.error || 'Failed')
    } catch (e) { setError(e.message) }
    finally { setLoadingTop50(false) }
  }

  async function fetchBillboard() {
    if (billboard) return
    setLoadingBillboard(true)
    try {
      const res = await fetch('/api/admin/music/billboard')
      const data = await res.json()
      if (res.ok) setBillboard(data.tracks || [])
      else setError(data.error || 'Failed')
    } catch (e) { setError(e.message) }
    finally { setLoadingBillboard(false) }
  }

  async function handleDownload(track) {
    setDownloading(track.spotifyId)
    try {
      const res = await fetch('/api/admin/music/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUrl: track.spotifyUrl, artist: track.artist, title: track.track }),
      })
      if (res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${track.artist} - ${track.track}.mp3`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        if (data.fallback) {
          if (data.links?.spotify) {
            await navigator.clipboard?.writeText(data.links.spotify).catch(() => {})
            setError('URL copied — paste in spotdown (Cmd+V)')
            setTimeout(() => setError(''), 4000)
          }
          window.open(data.links?.spotdown || 'https://spotdown.org', '_blank')
        }
      }
      // Log song as used for this creator
      if (track.spotifyId && creatorId) {
        fetch('/api/admin/music/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorId, spotifyId: track.spotifyId, songTitle: track.track, artist: track.artist }),
        }).then(() => {
          setUsedSongIds(prev => new Set([...prev, track.spotifyId]))
        }).catch(() => {})
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(null)
    }
  }

  function renderTrackList(tracks) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '500px', overflowY: 'auto' }}>
        {tracks.map((track, i) => (
          <div key={track.spotifyId || i}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
              borderRadius: '4px', background: i % 2 === 0 ? 'var(--card-bg-solid)' : 'transparent', fontSize: '11px',
            }}>
              {track.albumArt && (
                <img src={track.albumArt} alt="" style={{ width: '24px', height: '24px', borderRadius: '3px', objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px' }}>{track.track}</div>
                <div style={{ color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '9px' }}>{track.artist}</div>
              </div>
              {track.spotifyId && (
                <button onClick={() => setPlayingPreview(playingPreview === track.spotifyId ? null : track.spotifyId)}
                  style={{ padding: '2px 5px', fontSize: '9px', background: playingPreview === track.spotifyId ? 'var(--palm-pink)' : 'rgba(255,255,255,0.04)', color: playingPreview === track.spotifyId ? 'var(--foreground)' : '#888', border: 'none', borderRadius: '3px', cursor: 'pointer', flexShrink: 0 }}>
                  {playingPreview === track.spotifyId ? '■' : '▶'}
                </button>
              )}
              <button onClick={() => handleDownload(track)} disabled={downloading === track.spotifyId}
                style={{
                  padding: '2px 5px', fontSize: '9px', fontWeight: 500, flexShrink: 0,
                  background: downloading === track.spotifyId ? 'rgba(255,255,255,0.04)' : 'rgba(125, 211, 164, 0.08)',
                  color: downloading === track.spotifyId ? '#999' : '#7DD3A4',
                  border: '1px solid transparent', borderRadius: '3px', cursor: downloading === track.spotifyId ? 'default' : 'pointer',
                }}>
                {downloading === track.spotifyId ? '...' : '↓'}
              </button>
            </div>
            {playingPreview === track.spotifyId && track.spotifyId && (
              <div style={{ padding: '4px 6px' }}>
                <iframe
                  src={`https://open.spotify.com/embed/track/${track.spotifyId}?utm_source=generator&theme=0`}
                  width="100%" height="80" frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  style={{ borderRadius: '8px' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (!expanded) {
    return (
      <button onClick={() => { setExpanded(true); if (hasPlaylist) handleGetSuggestions(); else { setMusicTab('top50'); fetchTop50() } }}
        disabled={loading}
        style={{
          width: '100%', padding: '7px', fontSize: '11px', fontWeight: 600,
          background: loading ? 'rgba(255,255,255,0.04)' : '#F0F4FF', color: loading ? '#999' : '#6B7FE3',
          border: '1px solid rgba(107,127,227,0.2)', borderRadius: '6px',
          cursor: loading ? 'default' : 'pointer',
        }}>
        {hasPlaylist ? '♫ Music Radio' : '♫ Music (Need Playlist)'}
      </button>
    )
  }

  return (
    <div style={{ borderTop: '1px solid transparent', paddingTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ display: 'flex', gap: '0', flex: 1 }}>
          {[
            { key: 'creator', label: `For ${creatorName?.split(' ')[0] || 'Creator'}`, onClick: () => { if (!suggestions && hasPlaylist) handleGetSuggestions() } },
            { key: 'top50', label: 'TikTok', onClick: fetchTop50 },
            { key: 'billboard', label: 'Billboard', onClick: fetchBillboard },
          ].map(tab => (
            <button key={tab.key} onClick={() => { setMusicTab(tab.key); tab.onClick() }}
              style={{ padding: '4px 6px', fontSize: '9px', fontWeight: musicTab === tab.key ? 700 : 400, color: musicTab === tab.key ? '#6B7FE3' : '#aaa', background: 'none', border: 'none', borderBottom: musicTab === tab.key ? '2px solid #6B7FE3' : '2px solid transparent', cursor: 'pointer' }}>
              {tab.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setExpanded(false); if (audioRef.current) audioRef.current.pause(); setPlayingPreview(null) }}
          style={{ fontSize: '10px', color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕
        </button>
      </div>

      {musicTab === 'creator' && (
        !hasPlaylist ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '8px 0', textAlign: 'center' }}>
            No Music DNA playlist uploaded. <span style={{ color: '#6B7FE3', fontWeight: 600 }}>Need Playlist</span>
          </div>
        ) : loading ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '4px 0' }}>Loading suggestions...</div>
        ) : suggestions && suggestions.length > 0 ? (
          renderTrackList(filterUsed(suggestions))
        ) : suggestions && suggestions.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '4px 0' }}>No suggestions found.</div>
        ) : null
      )}

      {musicTab === 'top50' && (
        loadingTop50 ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '4px 0' }}>Loading chart...</div>
        ) : top50 && top50.length > 0 ? (
          renderTrackList(filterUsed(top50))
        ) : null
      )}

      {musicTab === 'billboard' && (
        loadingBillboard ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '4px 0' }}>Loading chart...</div>
        ) : billboard && billboard.length > 0 ? (
          renderTrackList(filterUsed(billboard))
        ) : null
      )}

      {error && <div style={{ fontSize: '11px', color: '#E87878', marginTop: '4px' }}>{error}</div>}
    </div>
  )
}


// ─── Unreviewed Library ───────────────────────────────────────────────────────

function UnreviewedLibrary({ showToast }) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCreator, setSelectedCreator] = useState('all')
  const [activeTab, setActiveTab] = useState('videos')
  const [page, setPage] = useState(1)
  const [sortOrder, setSortOrder] = useState('newest')
  const [assigning, setAssigning] = useState(null)

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

  // Reset page when creator/tab/sort changes
  useEffect(() => { setPage(1) }, [selectedCreator, activeTab, sortOrder])

  // Build creator list from assets
  const creators = [...new Map(
    assets.filter(a => a.creator?.id).map(a => [a.creator.id, a.creator.name])
  )].sort((a, b) => a[1].localeCompare(b[1]))

  const filtered = selectedCreator === 'all'
    ? assets
    : assets.filter(a => a.creator?.id === selectedCreator)

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const da = new Date(a.createdTime || 0)
    const db = new Date(b.createdTime || 0)
    return sortOrder === 'newest' ? db - da : da - db
  })

  // Split by asset type — fall back to URL sniffing when Asset Type missing
  const videos = sorted.filter(a => {
    const link = a.dropboxLinks?.[0] || a.dropboxLink || ''
    return a.assetType === 'Video' || (!a.assetType && isVideo(link))
  })
  const photos = sorted.filter(a => {
    const link = a.dropboxLinks?.[0] || a.dropboxLink || ''
    return a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && isPhoto(link))
  })

  const shown = activeTab === 'videos' ? videos : photos
  const totalPages = Math.max(1, Math.ceil(shown.length / LIB_PAGE_SIZE))
  const paged = shown.slice((page - 1) * LIB_PAGE_SIZE, page * LIB_PAGE_SIZE)

  const handleAssign = async (asset) => {
    const creatorId = asset.creator?.id
    if (!creatorId) {
      showToast('Asset has no creator linked', true)
      return
    }
    setAssigning(asset.id)
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start edit')
      showToast('Edit started — moved to editor queue')
      // Remove from local list so the grid updates immediately
      setAssets(prev => prev.filter(a => a.id !== asset.id))
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setAssigning(null)
    }
  }

  if (loading) {
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading library...</div>
  }

  const tabCounts = { videos: videos.length, photos: photos.length }

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <select
            value={selectedCreator}
            onChange={e => setSelectedCreator(e.target.value)}
            style={{
              padding: '6px 12px', fontSize: '13px', fontWeight: 500,
              background: 'var(--background)', color: 'var(--foreground)', border: '1px solid transparent',
              borderRadius: '6px', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="all">All Creators ({assets.length})</option>
            {creators.map(([id, name]) => {
              const count = assets.filter(a => a.creator?.id === id).length
              return <option key={id} value={id}>{name} ({count})</option>
            })}
          </select>

          {/* Videos / Photos tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '3px' }}>
            {[{ key: 'videos', label: 'Videos' }, { key: 'photos', label: 'Photos' }].map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: activeTab === t.key ? 'rgba(232, 160, 160, 0.05)' : 'transparent',
                  color: activeTab === t.key ? 'rgba(240, 236, 232, 0.85)' : '#999',
                }}
              >
                {t.label} <span style={{ color: activeTab === t.key ? '#999' : '#aaa', fontWeight: 400 }}>{tabCounts[t.key]}</span>
              </button>
            ))}
          </div>

          {/* Sort */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '3px' }}>
            {[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }].map(s => (
              <button
                key={s.key}
                onClick={() => setSortOrder(s.key)}
                style={{
                  padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: sortOrder === s.key ? 'rgba(232, 160, 160, 0.05)' : 'transparent',
                  color: sortOrder === s.key ? 'rgba(240, 236, 232, 0.85)' : '#999',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            {shown.length} {shown.length === 1 ? 'clip' : 'clips'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {totalPages > 1 && (
            <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
          )}
          <button
            onClick={fetchAssets}
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 600,
              background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent',
              borderRadius: '6px', cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', background: 'var(--card-bg-solid)', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          {selectedCreator === 'all'
            ? `No unreviewed ${activeTab} in library.`
            : `No ${activeTab} for this creator.`}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            {paged.map(asset => (
              <div key={asset.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <LibraryCard
                  asset={asset}
                  onAssign={handleAssign}
                  assigning={assigning}
                  forcePhoto={activeTab === 'photos'}
                />
                {selectedCreator === 'all' && asset.creator?.name && (
                  <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', paddingLeft: '2px' }}>
                    {asset.creator.name}
                  </div>
                )}
                <CaptionSuggestions
                  thumbnailUrl={asset.thumbnail}
                  videoUrl={(asset.dropboxLinks?.[0] || asset.dropboxLink || '').replace(/([?&])dl=[01]/, '$1raw=1')}
                  creatorId={asset.creator?.id}
                />

              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
              <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </>
      )}
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
    ctx.strokeStyle = '#E87878'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    // corner handles
    const hs = 8
    ctx.fillStyle = '#E87878'
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
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '100%', maxWidth: '380px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>
              {mode === 'scrub' ? 'Pick a frame' : 'Crop frame'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
              {mode === 'scrub' ? 'Scrub to the moment you want to flag' : 'Drag to select — adjust corners to isolate the issue'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {mode === 'crop' && (
              <button onClick={() => { setMode('scrub'); setSel(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                ← Back
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
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
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', minWidth: '32px', fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)}</span>
                <input type="range" min={0} max={duration || 100} step={0.05} value={currentTime}
                  onChange={e => { const t = parseFloat(e.target.value); setCurrentTime(t); if (videoRef.current) videoRef.current.currentTime = t }}
                  style={{ flex: 1, accentColor: '#E87878', cursor: 'pointer' }} />
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTime(duration)}</span>
              </div>
              {error && <div style={{ fontSize: '11px', color: '#E87878', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '6px 10px' }}>{error}</div>}
              <button onClick={handleCapture} disabled={capturing || !duration}
                style={{ padding: '10px', background: capturing || !duration ? '#0d0d0d' : '#1a0a0a', border: '1px solid #5c2020', color: capturing || !duration ? '#3f3f46' : '#E87878', borderRadius: '8px', cursor: capturing || !duration ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
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
              {error && <div style={{ fontSize: '11px', color: '#E87878', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '6px 10px' }}>{error}</div>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleUseFullFrame} disabled={uploading}
                  style={{ flex: 1, padding: '9px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', color: 'var(--foreground-muted)', borderRadius: '8px', cursor: uploading ? 'default' : 'pointer', fontSize: '12px', fontWeight: 600, opacity: uploading ? 0.5 : 1 }}>
                  Use full frame
                </button>
                <button onClick={handleCropAndAdd} disabled={!canCrop || uploading}
                  style={{ flex: 2, padding: '9px', background: canCrop && !uploading ? '#1a0a0a' : '#0d0d0d', border: '1px solid #5c2020', color: canCrop && !uploading ? '#E87878' : '#3f3f46', borderRadius: '8px', cursor: canCrop && !uploading ? 'pointer' : 'default', fontSize: '12px', fontWeight: 700 }}>
                  {uploading ? 'Uploading...' : 'Crop & Add'}
                </button>
              </div>
              {!canCrop && <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', textAlign: 'center' }}>Drag on the image to select an area</div>}
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
      ctx.strokeStyle = 'var(--palm-pink)'
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      // corner handles
      const hs = 6
      ctx.fillStyle = 'var(--palm-pink)'
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
      <div style={{ background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '16px', padding: '20px', maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: '12px' }}
        onClick={e => e.stopPropagation()}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>Crop Screenshot</div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>Drag to select what to send · or skip to use the full image</div>
        </div>
        {!ready && <div style={{ width: '200px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading...</div>}
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ display: ready ? 'block' : 'none', cursor: 'crosshair', maxWidth: '100%', borderRadius: '8px', border: '1px solid transparent', userSelect: 'none' }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={() => onSkip(file)}
            style={{ padding: '8px 16px', border: '1px solid transparent', borderRadius: '8px', color: 'var(--foreground-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: 'transparent' }}>
            Use Full Image
          </button>
          <button onClick={handleCrop} disabled={!canCrop}
            style={{ padding: '8px 18px', border: 'none', borderRadius: '8px', color: 'var(--foreground)', fontSize: '12px', fontWeight: 700, cursor: canCrop ? 'pointer' : 'not-allowed', background: canCrop ? 'var(--palm-pink)' : 'transparent', opacity: canCrop ? 1 : 0.5 }}>
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
      <div style={{ background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '16px', padding: '28px', width: '500px', maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--foreground)', margin: '0 0 4px' }}>Request Revision</h3>
        <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '20px' }}>
          {task.inspo.title || task.name} · {task.creator.name}
        </p>

        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Feedback</div>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Describe what needs to change..."
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', background: 'var(--background)',
              border: '1px solid transparent', borderRadius: '8px', color: 'rgba(240, 236, 232, 0.85)',
              fontSize: '13px', resize: 'vertical', minHeight: '100px',
              fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5,
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Screenshots <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--foreground-muted)' }}>— drag to crop after selecting</span>
          </div>
          {screenshots.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {screenshots.map((url, i) => (
                <div key={i} style={{ position: 'relative', width: '72px', height: '72px' }}>
                  <img src={url.replace(/([?&])dl=[01]/, '$1raw=1')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px', border: '1px solid transparent' }} />
                  <button
                    onClick={() => setScreenshots(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#E87878', border: 'none', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', color: 'var(--foreground)', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
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
              style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 600, background: 'rgba(232, 160, 160, 0.04)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '6px', cursor: 'pointer', opacity: (uploading || cropQueue.length > 0) ? 0.6 : 1 }}>
              {uploading ? progress || 'Uploading...' : '+ Add Screenshot'}
            </button>
            {hasVideo && (
              <button
                onClick={() => setShowFramePicker(true)}
                disabled={uploading || cropQueue.length > 0}
                style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 600, background: '#1a0a0a', color: '#E87878', border: '1px solid #5c2020', borderRadius: '6px', cursor: 'pointer', opacity: (uploading || cropQueue.length > 0) ? 0.6 : 1 }}>
                📸 Pick frame from video
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => handleFileSelect(e.target.files)} style={{ display: 'none' }} />
        </div>

        {error && <p style={{ fontSize: '12px', color: '#E87878', marginBottom: '12px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '9px 18px', border: 'none', borderRadius: '8px', color: 'var(--foreground)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: 'transparent' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={uploading || !feedback.trim()}
            style={{
              padding: '9px 22px', border: 'none', borderRadius: '8px', color: 'var(--foreground)', fontSize: '13px', fontWeight: 600,
              cursor: uploading || !feedback.trim() ? 'not-allowed' : 'pointer',
              background: uploading || !feedback.trim() ? 'transparent' : '#E87878', opacity: uploading ? 0.6 : 1,
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
          style={{ position: 'absolute', top: '-14px', right: '-14px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '50%', width: '32px', height: '32px', color: 'var(--foreground)', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ×
        </button>
      </div>
    </div>
  )
}

const REVIEW_PAGE_SIZE = 10

function ForReview({ showToast }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())
  const [videoModal, setVideoModal] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [revisionTask, setRevisionTask] = useState(null)
  const [page, setPage] = useState(0)

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
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading review queue...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: 0 }}>
          {tasks.length} edit{tasks.length !== 1 ? 's' : ''} waiting for your review
        </p>
        <button onClick={fetchTasks}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '6px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {tasks.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', background: 'var(--card-bg-solid)', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          No edits waiting for review.
        </div>
      ) : (() => {
        // Paginate to REVIEW_PAGE_SIZE per page; clamp the page if approvals
        // dropped tasks from later pages and we're now past the end.
        const totalPages = Math.max(1, Math.ceil(tasks.length / REVIEW_PAGE_SIZE))
        const safePage = Math.min(page, totalPages - 1)
        const pagedTasks = tasks.slice(safePage * REVIEW_PAGE_SIZE, (safePage + 1) * REVIEW_PAGE_SIZE)
        return (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {pagedTasks.map(task => {
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
              <div key={task.id} style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', overflow: 'hidden' }}>
                {/* Video strip — RAW | EDIT | INSPO */}
                <div style={{ display: 'flex', background: 'var(--background)', gap: '2px' }}>

                  {/* RAW clip */}
                  <div style={{ flex: 1, position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: 'var(--background)' }}>
                    {rawClipUrl ? (
                      <>
                        <video src={rawClipUrl} autoPlay muted loop playsInline preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                          onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
                        <button onClick={() => setVideoModal(task.asset.dropboxLink.split('\n').filter(Boolean)[0])}
                          style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: 'var(--foreground)', fontSize: '10px', fontWeight: 600, padding: '2px 6px', cursor: 'pointer' }}>
                          ⛶
                        </button>
                      </>
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'transparent', fontSize: '11px' }}>No raw clip</div>
                    )}
                    <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#78B4E8', fontWeight: 600 }}>RAW</div>
                  </div>

                  {/* EDIT clip */}
                  <div style={{ flex: 1, position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: 'var(--background)' }}>
                    {editUrl ? (
                      <>
                        <video src={editUrl} autoPlay muted loop playsInline preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                          onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
                        <button onClick={() => setVideoModal(task.asset.editedFileLink)}
                          style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: 'var(--foreground)', fontSize: '10px', fontWeight: 600, padding: '2px 6px', cursor: 'pointer' }}>
                          ⛶
                        </button>
                      </>
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'transparent', fontSize: '11px' }}>No edit yet</div>
                    )}
                    <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#7DD3A4', fontWeight: 600 }}>EDIT</div>
                  </div>

                  {/* INSPO clip — only if available */}
                  {hasInspo && (
                    <div style={{ flex: 1, position: 'relative', aspectRatio: '9/16', overflow: 'hidden', background: 'var(--background)' }}>
                      {inspoVideoUrl ? (
                        <video src={inspoVideoUrl} autoPlay muted loop playsInline preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
                          onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
                      ) : task.inspo.thumbnail ? (
                        <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                      ) : null}
                      <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: 'var(--palm-pink)', fontWeight: 600 }}>INSPO</div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)' }}>{task.creator.name}</div>
                      <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '2px' }}>{task.inspo.title || task.name}</div>
                    </div>
                    {fmtDate && <span style={{ fontSize: '10px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap', marginTop: '2px' }}>Submitted {fmtDate}</span>}
                  </div>

                  {/* Quick links */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {task.asset.editedFileLink && (
                      <a href={task.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '11px', color: '#7DD3A4', textDecoration: 'none', padding: '3px 8px', background: 'rgba(125, 211, 164, 0.08)', borderRadius: '4px', border: '1px solid transparent' }}>
                        Download Edit ↗
                      </a>
                    )}
                    {task.inspo.contentLink && (
                      <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none', padding: '3px 8px', background: 'rgba(232, 160, 160, 0.04)', borderRadius: '4px', border: '1px solid transparent' }}>
                        Original Reel ↗
                      </a>
                    )}
                  </div>

                  {/* Editor notes */}
                  {task.editorNotes && (
                    <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Editor Notes</div>
                      <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.4 }}>{task.editorNotes}</div>
                    </div>
                  )}

                  {/* Inspo details toggle */}
                  {task.inspo.notes && (
                    <>
                      <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n })}
                        style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                        {isExpanded ? '▾ Hide inspo' : '▸ View inspo direction'}
                      </button>
                      {isExpanded && (
                        <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '12px' }}>
                          <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{task.inspo.notes}</div>
                          {task.inspo.onScreenText && (
                            <div style={{ marginTop: '8px', fontSize: '12px', color: '#E8C878', background: '#1a1500', border: '1px solid #fef3c7', borderRadius: '6px', padding: '8px 10px' }}>
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
                      style={{ padding: '10px', fontSize: '13px', fontWeight: 600, background: '#2d1515', color: '#E87878', border: '1px solid #5c2020', borderRadius: '8px', cursor: 'pointer', opacity: updating === task.id ? 0.6 : 1 }}>
                      Request Revision
                    </button>
                    <button
                      onClick={() => handleApprove(task.id)}
                      disabled={updating === task.id}
                      style={{ padding: '10px', fontSize: '13px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid transparent', borderRadius: '8px', cursor: 'pointer', opacity: updating === task.id ? 0.6 : 1 }}>
                      {updating === task.id ? 'Saving...' : 'Approve ✓'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '20px' }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '8px', color: safePage === 0 ? 'var(--foreground-muted)' : 'rgba(240,236,232,0.85)', cursor: safePage === 0 ? 'default' : 'pointer', opacity: safePage === 0 ? 0.5 : 1 }}>
              ← Prev
            </button>
            <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
              Page {safePage + 1} of {totalPages} · {tasks.length} total
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '8px', color: safePage === totalPages - 1 ? 'var(--foreground-muted)' : 'rgba(240,236,232,0.85)', cursor: safePage === totalPages - 1 ? 'default' : 'pointer', opacity: safePage === totalPages - 1 ? 0.5 : 1 }}>
              Next →
            </button>
          </div>
        )}
        </>)
      })()}

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

// ─── Submissions Feed (Admin) ─────────────────────────────────────────────────
// Activity feed of editor submissions, grouped by ET day, sorted newest first.
// Filterable by submission type (Initial / Revision) and by creator.
// Each row shows the timestamp of the LATEST submission for that task — for
// revisions, that's when the editor resubmitted (not when the original task
// was created).

function SubmissionsFeed({ showToast }) {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all') // all | Initial | Revision
  const [creatorFilter, setCreatorFilter] = useState('all')
  const [videoModal, setVideoModal] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/editor/submissions')
      if (!res.ok) throw new Error(`Failed to load submissions (${res.status})`)
      const data = await res.json()
      setSubmissions(data.submissions || [])
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { fetchData() }, [fetchData])

  // Build creator dropdown options from the data we have
  const creatorOptions = (() => {
    const map = new Map()
    for (const s of submissions) {
      if (s.creator?.id && !map.has(s.creator.id)) {
        map.set(s.creator.id, s.creator.name || '(unnamed)')
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  })()

  const filtered = submissions.filter(s => {
    if (typeFilter !== 'all' && s.type !== typeFilter) return false
    if (creatorFilter !== 'all' && s.creator?.id !== creatorFilter) return false
    return true
  })

  // Group by ET date
  const etDateStr = iso => {
    if (!iso) return ''
    const d = new Date(iso)
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d) // YYYY-MM-DD
  }
  const todayET = etDateStr(new Date().toISOString())
  const yesterdayET = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return etDateStr(d.toISOString())
  })()

  const groups = (() => {
    const m = new Map()
    for (const s of filtered) {
      const k = etDateStr(s.submittedAt)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(s)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])) // desc by date
  })()

  const dateLabel = ds => {
    if (ds === todayET) return 'Today'
    if (ds === yesterdayET) return 'Yesterday'
    const d = new Date(ds + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  }

  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  })

  const toRawUrl = url => url ? url.replace(/([?&])dl=[01]/, '$1raw=1').replace(/^(https:\/\/www\.dropbox\.com\/.+)(?<![?&]raw=1)$/, m => m.includes('?') ? m + '&raw=1' : m + '?raw=1') : ''

  if (loading) {
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading submission feed...</div>
  }

  return (
    <div>
      {/* Header + filters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: 0 }}>
            {filtered.length} submission{filtered.length === 1 ? '' : 's'}
            {(typeFilter !== 'all' || creatorFilter !== 'all') && submissions.length !== filtered.length && (
              <span style={{ marginLeft: '6px' }}>· filtered from {submissions.length}</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Type filter pills */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--card-bg-solid)', padding: '3px', borderRadius: '7px' }}>
            {[
              { key: 'all', label: 'All' },
              { key: 'Initial', label: 'Initial' },
              { key: 'Revision', label: 'Revision' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setTypeFilter(opt.key)}
                style={{ padding: '5px 10px', fontSize: '11px', fontWeight: 600, background: typeFilter === opt.key ? 'var(--background)' : 'transparent', color: typeFilter === opt.key ? 'var(--foreground)' : 'var(--foreground-muted)', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                {opt.label}
              </button>
            ))}
          </div>
          {/* Creator dropdown */}
          <select value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}
            style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 500, background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid transparent', borderRadius: '7px', cursor: 'pointer', outline: 'none' }}>
            <option value="all">All creators</option>
            {creatorOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <button onClick={fetchData}
            style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '6px', cursor: 'pointer' }}>
            Refresh
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', background: 'var(--card-bg-solid)', borderRadius: '18px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          No submissions match the current filters.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {groups.map(([ds, items]) => (
            <div key={ds}>
              {/* Date header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid var(--card-border)' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>{dateLabel(ds)}</h3>
                <span style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>{items.length} submission{items.length === 1 ? '' : 's'}</span>
              </div>
              {/* Submission rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {items.map(s => {
                  const isRevision = s.type === 'Revision'
                  const statusBadge = s.adminReviewStatus === 'Approved'
                    ? { label: 'Approved ✓', color: '#7DD3A4', bg: 'rgba(125, 211, 164, 0.08)' }
                    : s.adminReviewStatus === 'Needs Revision'
                    ? { label: 'Needs Revision', color: '#E87878', bg: 'rgba(232, 120, 120, 0.06)' }
                    : { label: 'Pending Review', color: '#E8C878', bg: 'rgba(232, 200, 120, 0.08)' }
                  const editUrl = toRawUrl(s.asset?.editedFileLink || '')
                  return (
                    <div key={s.id} style={{ background: 'var(--card-bg-solid)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                      {/* Thumbnail */}
                      <div style={{ width: '48px', height: '64px', borderRadius: '6px', overflow: 'hidden', background: 'var(--background)', flexShrink: 0 }}>
                        {(s.asset?.thumbnail || s.inspo?.thumbnail) && (
                          <img src={s.asset?.thumbnail || s.inspo?.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>{s.creator?.name || '—'}</span>
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.06em', background: isRevision ? 'rgba(232, 120, 120, 0.08)' : 'rgba(120, 180, 232, 0.08)', color: isRevision ? '#E87878' : '#78B4E8' }}>
                            {isRevision ? 'Revision' : 'Initial'}
                          </span>
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: statusBadge.bg, color: statusBadge.color }}>
                            {statusBadge.label}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.taskName || s.asset?.name}
                        </div>
                      </div>
                      {/* Submitted at + actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                        <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
                          Submitted {fmtTime(s.submittedAt)}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {editUrl && (
                            <button onClick={() => setVideoModal(s.asset.editedFileLink)}
                              style={{ padding: '3px 9px', fontSize: '11px', fontWeight: 600, color: '#7DD3A4', background: 'rgba(125, 211, 164, 0.06)', border: '1px solid transparent', borderRadius: '5px', cursor: 'pointer' }}>
                              Watch edit
                            </button>
                          )}
                          {s.asset?.editedFileLink && (
                            <a href={s.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
                              style={{ padding: '3px 9px', fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid transparent', borderRadius: '5px', textDecoration: 'none' }}>
                              ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {videoModal && <VideoModal url={videoModal} onClose={() => setVideoModal(null)} />}
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
    { key: 'submissions', label: '📨 Submissions' },
    { key: 'postprep', label: '✈️ Post Prep' },
    { key: 'grid', label: '▦ Grid Planner' },
    { key: 'library', label: '📁 Creator Library' },
    { key: 'oftv', label: '🎬 OFTV Projects' },
    { key: 'longform', label: '⬆️ Long Form Upload' },
  ]

  return (
    <div>
      {/* Mobile-only header overrides */}
      <style>{`
        @media (max-width: 768px) {
          .admin-editor-header {
            flex-wrap: wrap !important;
            gap: 8px !important;
            margin-bottom: 16px !important;
          }
          .admin-editor-tabs {
            order: 2;
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            white-space: nowrap;
            flex-wrap: nowrap !important;
          }
          .admin-editor-tabs::-webkit-scrollbar { display: none; }
          .admin-editor-tabs button { flex-shrink: 0; }
          .admin-editor-notif { order: 1; margin-left: auto; }
        }
      `}</style>
      {/* Header row: tabs + notification */}
      <div className="admin-editor-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div className="admin-editor-tabs" style={{ display: 'flex', gap: '0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => switchSection(tab.key)}
            style={{
              padding: '10px 20px', fontSize: '12px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: activeSection === tab.key ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none',
              borderBottom: activeSection === tab.key ? '1px solid var(--palm-pink)' : '1px solid transparent',
              cursor: 'pointer', marginBottom: '-1px', transition: 'all 0.3s var(--ease-stripe)',
            }}
          >
            {tab.label}
          </button>
        ))}
        </div>
        {/* Notification opt-in */}
        {'Notification' in (typeof window !== 'undefined' ? window : {}) && (
          <div className="admin-editor-notif" style={{ flexShrink: 0 }}>
            {notifStatus === 'idle' && (
              <button onClick={handleEnableNotifications}
                style={{ fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '8px', border: '1px solid transparent', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                🔔 Notifications
              </button>
            )}
            {notifStatus === 'subscribed' && (
              <span style={{ fontSize: '11px', color: '#7DD3A4', display: 'flex', alignItems: 'center', gap: '4px' }}>🔔 On</span>
            )}
            {notifStatus === 'denied' && (
              <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>🔔 Blocked</span>
            )}
          </div>
        )}
      </div>

      {/* Section content */}
      {activeSection === 'editorview' && <EditorDashboardContent />}
      {activeSection === 'review' && <ForReview showToast={showToast} />}
      {activeSection === 'submissions' && <SubmissionsFeed showToast={showToast} />}
      {activeSection === 'postprep' && <PostsPage />}
      {activeSection === 'grid' && <GridPlanner />}
      {activeSection === 'library' && <UnreviewedLibrary showToast={showToast} />}
      {activeSection === 'oftv' && <OftvProjectsQueue showToast={showToast} />}
      {activeSection === 'longform' && <LongFormUpload showToast={showToast} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#2d1515' : 'rgba(125, 211, 164, 0.08)',
          color: toast.error ? '#E87878' : '#7DD3A4',
          border: `1px solid ${toast.error ? '#5c2020' : 'rgba(125, 211, 164, 0.2)'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
