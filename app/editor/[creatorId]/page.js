'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// ── Helpers ────────────────────────────────────────────────────────────────────

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

function isVideo(url) {
  if (!url) return false
  return /\.(mp4|mov|avi|webm|mkv)/i.test(url)
}

function isPhoto(url) {
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i.test(url)
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_META = {
  needsRevision: { dot: '#ef4444', label: 'Needs Revision',       bg: '#0d0505', border: '#2d1515' },
  inProgress:    { dot: '#3b82f6', label: 'In Editing',           bg: '#03071a', border: '#1a3a6d' },
  queue:         { dot: '#a78bfa', label: 'Queue',                bg: '#05030f', border: '#2a1a5e' },
  inReview:      { dot: '#22c55e', label: 'Submitted for Review', bg: '#050f05', border: '#1a3a1a' },
  approved:      { dot: '#f59e0b', label: 'Approved',             bg: '#0d0900', border: '#3d2e00' },
  history:       { dot: '#3f3f46', label: 'History',              bg: '#080808', border: '#1a1a1a' },
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ type, count }) {
  const m = STATUS_META[type]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: m.dot }} />
      <span style={{ fontSize: '11px', fontWeight: 700, color: m.dot, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.label}</span>
      <span style={{ fontSize: '11px', color: '#3f3f46' }}>({count})</span>
    </div>
  )
}

// ── TaskRow ────────────────────────────────────────────────────────────────────

function TaskRow({ task, type }) {
  const [expanded, setExpanded] = useState(false)
  const m = STATUS_META[type]

  return (
    <div style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: '10px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {task.inspo?.thumbnail && (
          <img src={task.inspo.thumbnail} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.inspo?.title || task.name || 'Untitled'}
          </div>
          {task.inspo?.username && <div style={{ fontSize: '11px', color: '#52525b', marginTop: '2px' }}>@{task.inspo.username}</div>}
          {task.completedAt && (
            <div style={{ fontSize: '11px', color: '#3f3f46', marginTop: '2px' }}>
              {new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {task.inspo?.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#0d0a2e', borderRadius: '4px', border: '1px solid #2a1a5e' }}>
              Inspo ↗
            </a>
          )}
          {task.asset?.editedFileLink && (
            <a href={task.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
              Edited file ↗
            </a>
          )}
          {task.asset?.dropboxLinks?.length > 0 && !task.asset?.editedFileLink && (
            <a href={task.asset.dropboxLinks[0]} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
              Clip ↗
            </a>
          )}
        </div>
      </div>

      {type === 'needsRevision' && task.adminFeedback && (
        <div style={{ fontSize: '11px', color: '#fca5a5', background: '#1a0a0a', border: '1px solid #5c2020', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.5 }}>
          {task.adminFeedback}
        </div>
      )}

      {task.inspo?.notes && (
        <>
          <button onClick={() => setExpanded(p => !p)}
            style={{ background: 'none', border: 'none', color: '#3f3f46', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
            {expanded ? '▾ Hide direction' : '▸ View direction'}
          </button>
          {expanded && (
            <div style={{ fontSize: '11px', color: '#d4d4d8', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {task.inspo.notes}
              {task.inspo.onScreenText && (
                <div style={{ marginTop: '6px', color: '#f59e0b', background: '#1a1500', border: '1px solid #332b00', borderRadius: '4px', padding: '4px 6px' }}>
                  &ldquo;{task.inspo.onScreenText}&rdquo;
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── InspoClipRow ───────────────────────────────────────────────────────────────

function InspoClipRow({ clip }) {
  return (
    <div style={{ background: '#0d0900', border: '1px solid #2a2000', borderRadius: '10px', padding: '12px 16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
      {(clip.thumbnail || clip.inspo?.thumbnail) && (
        <img src={clip.thumbnail || clip.inspo?.thumbnail} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {clip.inspo?.title || clip.name}
        </div>
        {clip.inspo?.username && <div style={{ fontSize: '11px', color: '#52525b', marginTop: '2px' }}>@{clip.inspo.username}</div>}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {clip.dropboxLink && (
          <a href={clip.dropboxLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#0a1a0a', borderRadius: '4px', border: '1px solid #1a4a1a' }}>
            Clip ↗
          </a>
        )}
        {clip.inspo?.contentLink && (
          <a href={clip.inspo.contentLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#0d0a2e', borderRadius: '4px', border: '1px solid #2a1a5e' }}>
            Inspo ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ── LibraryVideoCard ───────────────────────────────────────────────────────────

function LibraryVideoCard({ asset, creatorId, onRefresh, forcePhoto = false }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const link = asset.dropboxLinks?.[0] || asset.dropboxLink || ''
  const rawUrl = rawDropboxUrl(link)
  const videoFile = !forcePhoto && isVideo(link)
  const photoFile = forcePhoto || isPhoto(link)

  const handleStart = async () => {
    setStarting(true)
    setError('')
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, creatorId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onRefresh()
    } catch (err) {
      setError(err.message)
      setStarting(false)
    }
  }

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#080808', position: 'relative', aspectRatio: videoFile ? '9/16' : '4/3', maxHeight: '260px', overflow: 'hidden' }}>
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
        <div style={{ display: 'flex', gap: '4px', marginTop: 'auto' }}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: '#1a1a1a', color: '#71717a', border: '1px solid #2a2a2a', borderRadius: '6px', textDecoration: 'none' }}>
              View ↗
            </a>
          )}
        </div>
        <button onClick={handleStart} disabled={starting}
          style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 700, background: starting ? '#0a0a1a' : '#13132e', color: starting ? '#4a4a6e' : '#a78bfa', border: '1px solid #2a2a5e', borderRadius: '6px', cursor: starting ? 'default' : 'pointer' }}>
          {starting ? 'Starting...' : 'Start Edit'}
        </button>
        {error && <div style={{ fontSize: '10px', color: '#ef4444' }}>{error}</div>}
      </div>
    </div>
  )
}

// ── Paginator ──────────────────────────────────────────────────────────────────

function Paginator({ page, totalPages, onChange }) {
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

// ── LibrarySection ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 24

function LibrarySection({ title, dot, assets, creatorId, onRefresh }) {
  if (!assets.length) return null
  const videos = assets.filter(a => a.assetType === 'Video' || (!a.assetType && isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const photos = assets.filter(a => a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && !isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '') && isPhoto(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const [activeTab, setActiveTab] = useState('videos')
  const [page, setPage] = useState(1)
  const shown = activeTab === 'videos' ? videos : photos
  const totalPages = Math.ceil(shown.length / PAGE_SIZE)
  const paged = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const tabs = [
    { key: 'videos', label: 'Videos', count: videos.length },
    { key: 'photos', label: 'Photos', count: photos.length },
  ].filter(t => t.count > 0)

  const switchTab = key => { setActiveTab(key); setPage(1) }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
          <span style={{ fontSize: '11px', color: '#3f3f46' }}>({assets.length})</span>
        </div>
        {tabs.length > 1 && (
          <div style={{ display: 'flex', gap: '4px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '3px' }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => switchTab(t.key)}
                style={{ padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: activeTab === t.key ? '#1e1e1e' : 'transparent',
                  color: activeTab === t.key ? '#d4d4d8' : '#52525b' }}>
                {t.label} <span style={{ color: activeTab === t.key ? '#71717a' : '#3f3f46', fontWeight: 400 }}>{t.count}</span>
              </button>
            ))}
          </div>
        )}
        <Paginator page={page} totalPages={totalPages} onChange={setPage} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
        {paged.map(asset => (
          <LibraryVideoCard key={asset.id} asset={asset} creatorId={creatorId} onRefresh={onRefresh} forcePhoto={activeTab === 'photos'} />
        ))}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
          <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CreatorDetailPage() {
  const { creatorId: id } = useParams()
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/editor/creator/${id}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load')
      setData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
      Loading...
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
      {error}
    </div>
  )

  const { creator, tasks, inspoClips, library } = data
  const bufferColor = creator.bufferDays >= 2 ? '#22c55e' : creator.bufferDays >= 1 ? '#f59e0b' : '#ef4444'

  const taskSections = [
    { key: 'needsRevision', items: tasks.needsRevision },
    { key: 'inProgress',    items: tasks.inProgress },
    { key: 'queue',         items: tasks.queue },
    { key: 'inReview',      items: tasks.inReview },
    { key: 'approved',      items: tasks.approved },
    { key: 'history',       items: tasks.history },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <Link href="/editor"
            style={{ fontSize: '12px', color: '#52525b', textDecoration: 'none', padding: '5px 10px', border: '1px solid #2a2a2a', borderRadius: '6px' }}>
            ← Back
          </Link>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{creator.name}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: bufferColor }}>{creator.bufferDays}</span>
            <span style={{ fontSize: '12px', color: bufferColor, fontWeight: 600 }}>d runway</span>
          </div>
          <button onClick={fetchData}
            style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: '#111', color: '#a1a1aa', border: '1px solid #333', borderRadius: '6px', cursor: 'pointer' }}>
            Refresh
          </button>
        </div>

        {/* Task sections */}
        {taskSections.map(({ key, items }) => items.length === 0 ? null : (
          <div key={key} style={{ marginBottom: '28px' }}>
            <SectionLabel type={key} count={items.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(task => <TaskRow key={task.id} task={task} type={key} />)}
            </div>
          </div>
        ))}

        {/* Inspo clips uploaded by creator */}
        {inspoClips.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#f59e0b' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Creator Clips Uploaded</span>
              <span style={{ fontSize: '11px', color: '#3f3f46' }}>({inspoClips.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {inspoClips.map(clip => <InspoClipRow key={clip.id} clip={clip} />)}
            </div>
          </div>
        )}

        {/* Unreviewed library */}
        {library.length > 0 && (
          <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '32px', marginBottom: '28px' }}>
            <LibrarySection title="Unreviewed Library" dot="#a78bfa" assets={library} creatorId={id} onRefresh={fetchData} />
          </div>
        )}

        {/* Empty state */}
        {taskSections.every(s => s.items.length === 0) && inspoClips.length === 0 && library.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', color: '#3f3f46', fontSize: '14px', background: '#0d0d0d', borderRadius: '12px', border: '1px solid #1a1a1a' }}>
            No editing activity yet for {creator.name}.
          </div>
        )}
      </div>
    </div>
  )
}
