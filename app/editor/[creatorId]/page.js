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
  needsRevision: { dot: '#ef4444', label: 'Needs Revision',       bg: '#fef2f2', border: '#fecaca' },
  inProgress:    { dot: '#3b82f6', label: 'In Editing',           bg: '#dbeafe', border: '#bfdbfe' },
  queue:         { dot: '#E88FAC', label: 'Queue',                bg: '#fdf4ff', border: '#E8C4CC' },
  inReview:      { dot: '#22c55e', label: 'Submitted for Review', bg: '#f0fdf4', border: '#bbf7d0' },
  approved:      { dot: '#f59e0b', label: 'Approved',             bg: '#fffbeb', border: '#fde68a' },
  history:       { dot: '#aaa', label: 'History',              bg: '#f5f5f5', border: 'rgba(0,0,0,0.04)' },
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ type, count }) {
  const m = STATUS_META[type]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: m.dot }} />
      <span style={{ fontSize: '11px', fontWeight: 700, color: m.dot, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.label}</span>
      <span style={{ fontSize: '11px', color: '#aaa' }}>({count})</span>
    </div>
  )
}

// ── TaskRow ────────────────────────────────────────────────────────────────────

function TaskRow({ task, type }) {
  const [expanded, setExpanded] = useState(false)
  const m = STATUS_META[type]

  return (
    <div style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: '18px', padding: '12px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {task.inspo?.thumbnail && (
          <img src={task.inspo.thumbnail} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.inspo?.title || task.name || 'Untitled'}
          </div>
          {task.inspo?.username && <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>@{task.inspo.username}</div>}
          {task.completedAt && (
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>
              {new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {task.inspo?.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', padding: '2px 8px', background: '#fdf4ff', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
              Inspo ↗
            </a>
          )}
          {task.asset?.editedFileLink && (
            <a href={task.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#f0fdf4', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
              Edited file ↗
            </a>
          )}
          {task.asset?.dropboxLinks?.length > 0 && !task.asset?.editedFileLink && (
            <a href={task.asset.dropboxLinks[0]} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#f0fdf4', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
              Clip ↗
            </a>
          )}
        </div>
      </div>

      {type === 'needsRevision' && task.adminFeedback && (
        <div style={{ fontSize: '11px', color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.5 }}>
          {task.adminFeedback}
        </div>
      )}

      {task.inspo?.notes && (
        <>
          <button onClick={() => setExpanded(p => !p)}
            style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
            {expanded ? '▾ Hide direction' : '▸ View direction'}
          </button>
          {expanded && (
            <div style={{ fontSize: '11px', color: '#4a4a4a', background: '#FFF5F7', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {task.inspo.notes}
              {task.inspo.onScreenText && (
                <div style={{ marginTop: '6px', color: '#f59e0b', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px', padding: '4px 6px' }}>
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

// ── CompactThumbCard (for approved + history columns) ─────────────────────────

function CompactThumbCard({ task, type }) {
  const m = STATUS_META[type]
  const thumb = task.inspo?.thumbnail || task.asset?.thumbnail || ''
  const title = task.inspo?.title || task.name || 'Untitled'
  return (
    <div style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: '8px', padding: '10px 12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
      {thumb && (
        <img src={thumb} alt="" style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {task.completedAt && (
          <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
            {new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        {task.asset?.editedFileLink && (
          <a href={task.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '10px', color: '#22c55e', textDecoration: 'none', padding: '2px 6px', background: '#f0fdf4', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
            File ↗
          </a>
        )}
        {task.inspo?.contentLink && (
          <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '10px', color: '#E88FAC', textDecoration: 'none', padding: '2px 6px', background: '#fdf4ff', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
            Inspo ↗
          </a>
        )}
      </div>
    </div>
  )
}

const COLLAPSED_LIMIT = 4

function CollapsibleColumn({ sectionKey, items }) {
  const [expanded, setExpanded] = useState(false)
  const m = STATUS_META[sectionKey]
  const shown = expanded ? items : items.slice(0, COLLAPSED_LIMIT)
  const hasMore = items.length > COLLAPSED_LIMIT

  return (
    <div style={{ background: '#FFF5F7', border: `1px solid ${m.border}`, borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: m.dot }} />
        <span style={{ fontSize: '11px', fontWeight: 700, color: m.dot, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.label}</span>
        <span style={{ fontSize: '11px', color: '#aaa' }}>({items.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {shown.map(task => <CompactThumbCard key={task.id} task={task} type={sectionKey} />)}
      </div>
      {hasMore && (
        <button onClick={() => setExpanded(p => !p)}
          style={{ marginTop: '10px', width: '100%', background: 'none', border: 'none', color: '#999', fontSize: '11px', cursor: 'pointer', textAlign: 'center', padding: '4px 0' }}>
          {expanded ? '▴ Show less' : `▾ Show ${items.length - COLLAPSED_LIMIT} more`}
        </button>
      )}
    </div>
  )
}

// ── InspoClipRow ───────────────────────────────────────────────────────────────

function InspoClipRow({ clip }) {
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '18px', padding: '12px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', display: 'flex', gap: '12px', alignItems: 'center' }}>
      {(clip.thumbnail || clip.inspo?.thumbnail) && (
        <img src={clip.thumbnail || clip.inspo?.thumbnail} alt="" style={{ width: '44px', height: '44px', borderRadius: '7px', objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {clip.inspo?.title || clip.name}
        </div>
        {clip.inspo?.username && <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>@{clip.inspo.username}</div>}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {clip.dropboxLink && (
          <a href={clip.dropboxLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#22c55e', textDecoration: 'none', padding: '2px 8px', background: '#f0fdf4', borderRadius: '4px', border: '1px solid #bbf7d0' }}>
            Clip ↗
          </a>
        )}
        {clip.inspo?.contentLink && (
          <a href={clip.inspo.contentLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', padding: '2px 8px', background: '#fdf4ff', borderRadius: '4px', border: '1px solid #E8C4CC' }}>
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
    <div style={{ background: '#FFF5F7', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#FFF5F7', position: 'relative', aspectRatio: videoFile ? '9/16' : '4/3', maxHeight: '260px', overflow: 'hidden' }}>
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
        <div style={{ display: 'flex', gap: '4px', marginTop: 'auto' }}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(0,0,0,0.04)', color: '#999', border: '1px solid #E8C4CC', borderRadius: '6px', textDecoration: 'none' }}>
              View ↗
            </a>
          )}
        </div>
        <button onClick={handleStart} disabled={starting}
          style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 700, background: starting ? '#fdf4ff' : '#fdf4ff', color: starting ? '#D4A0B0' : '#E88FAC', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: starting ? 'default' : 'pointer' }}>
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
        style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: page <= 1 ? '#E8C4CC' : '#999', fontSize: '13px', cursor: page <= 1 ? 'default' : 'pointer', padding: '3px 10px' }}>‹</button>
      <span style={{ fontSize: '12px', color: '#999' }}>{page} / {totalPages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
        style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: page >= totalPages ? '#E8C4CC' : '#999', fontSize: '13px', cursor: page >= totalPages ? 'default' : 'pointer', padding: '3px 10px' }}>›</button>
    </div>
  )
}

// ── LibrarySection ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 24

function LibrarySection({ title, dot, assets, creatorId, onRefresh }) {
  if (!assets.length) return null
  const [activeTab, setActiveTab] = useState('videos')
  const [page, setPage] = useState(1)
  const [sortOrder, setSortOrder] = useState('newest')

  const sorted = [...assets].sort((a, b) => {
    const da = new Date(a.createdAt || 0), db = new Date(b.createdAt || 0)
    return sortOrder === 'newest' ? db - da : da - db
  })
  const videos = sorted.filter(a => a.assetType === 'Video' || (!a.assetType && isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const photos = sorted.filter(a => a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && !isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '') && isPhoto(a.dropboxLinks?.[0] || a.dropboxLink || '')))
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
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#4a4a4a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
          <span style={{ fontSize: '11px', color: '#aaa' }}>({assets.length})</span>
        </div>
        {tabs.length > 1 && (
          <div style={{ display: 'flex', gap: '4px', background: '#ffffff', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '8px', padding: '3px' }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => switchTab(t.key)}
                style={{ padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: activeTab === t.key ? '#F0D0D8' : 'transparent',
                  color: activeTab === t.key ? '#4a4a4a' : '#999' }}>
                {t.label} <span style={{ color: activeTab === t.key ? '#999' : '#aaa', fontWeight: 400 }}>{t.count}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '4px', background: '#ffffff', border: '1px solid rgba(0,0,0,0.04)', borderRadius: '8px', padding: '3px' }}>
          {[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }].map(s => (
            <button key={s.key} onClick={() => { setSortOrder(s.key); setPage(1) }}
              style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: sortOrder === s.key ? '#F0D0D8' : 'transparent',
                color: sortOrder === s.key ? '#4a4a4a' : '#999' }}>
              {s.label}
            </button>
          ))}
        </div>
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
    <div style={{ minHeight: '100vh', background: '#FFF5F7', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
      Loading...
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>
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
  ]
  const hasApprovedOrHistory = tasks.approved.length > 0 || tasks.history.length > 0

  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', color: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <Link href="/editor"
            style={{ fontSize: '12px', color: '#999', textDecoration: 'none', padding: '5px 10px', border: '1px solid #E8C4CC', borderRadius: '6px' }}>
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
            style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: '#ffffff', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: 'pointer' }}>
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

        {/* Approved + History side by side */}
        {hasApprovedOrHistory && (
          <div style={{ display: 'grid', gridTemplateColumns: tasks.approved.length && tasks.history.length ? '1fr 1fr' : '1fr', gap: '16px', marginBottom: '28px' }}>
            {tasks.approved.length > 0 && <CollapsibleColumn sectionKey="approved" items={tasks.approved} />}
            {tasks.history.length > 0 && <CollapsibleColumn sectionKey="history" items={tasks.history} />}
          </div>
        )}

        {/* Inspo clips uploaded by creator */}
        {inspoClips.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#f59e0b' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Creator Clips Uploaded</span>
              <span style={{ fontSize: '11px', color: '#aaa' }}>({inspoClips.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {inspoClips.map(clip => <InspoClipRow key={clip.id} clip={clip} />)}
            </div>
          </div>
        )}

        {/* Unreviewed library */}
        {library.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.04)', paddingTop: '32px', marginBottom: '28px' }}>
            <LibrarySection title="Unreviewed Library" dot="#E88FAC" assets={library} creatorId={id} onRefresh={fetchData} />
          </div>
        )}

        {/* Empty state */}
        {taskSections.every(s => s.items.length === 0) && !hasApprovedOrHistory && inspoClips.length === 0 && library.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', color: '#aaa', fontSize: '14px', background: '#FFF5F7', borderRadius: '18px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            No editing activity yet for {creator.name}.
          </div>
        )}
      </div>
    </div>
  )
}
