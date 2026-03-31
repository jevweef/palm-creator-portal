'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const LIBRARY_PAGE_SIZE = 4

const STATUS_META = {
  needsRevision: { dot: '#ef4444', label: 'Needs Revision', bg: '#0d0505', border: '#2d1515' },
  inProgress:    { dot: '#3b82f6', label: 'In Editing',     bg: '#03071a', border: '#1a3a6d' },
  queue:         { dot: '#a78bfa', label: 'Queue',          bg: '#05030f', border: '#2a1a5e' },
  inReview:      { dot: '#22c55e', label: 'Submitted for Review', bg: '#050f05', border: '#1a3a1a' },
  approved:      { dot: '#f59e0b', label: 'Approved',       bg: '#0d0900', border: '#3d2e00' },
  history:       { dot: '#3f3f46', label: 'History',        bg: '#080808', border: '#1a1a1a' },
}

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
                  "{task.inspo.onScreenText}"
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function LibraryAsset({ asset }) {
  const links = asset.dropboxLinks?.length ? asset.dropboxLinks : asset.dropboxLink ? [asset.dropboxLink] : []
  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '10px', padding: '12px 16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
      {asset.thumbnail
        ? <img src={asset.thumbnail} alt="" style={{ width: '52px', height: '52px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
        : <div style={{ width: '52px', height: '52px', borderRadius: '8px', background: '#1a1a1a', flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
        <div style={{ fontSize: '11px', color: '#52525b', marginTop: '2px' }}>{asset.sourceType}{asset.uploadWeek ? ` · ${asset.uploadWeek}` : ''}</div>
        {asset.creatorNotes && <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>{asset.creatorNotes}</div>}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {links.length > 1
          ? links.map((l, i) => (
              <a key={i} href={l} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#0d0a2e', borderRadius: '4px', border: '1px solid #2a1a5e' }}>
                Clip {i + 1} ↗
              </a>
            ))
          : links[0]
            ? <a href={links[0]} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '2px 8px', background: '#0d0a2e', borderRadius: '4px', border: '1px solid #2a1a5e' }}>
                View ↗
              </a>
            : null
        }
      </div>
    </div>
  )
}

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

export default function CreatorDetailPage() {
  const { creatorId: id } = useParams()
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [libraryPage, setLibraryPage] = useState(0)

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
  const libraryPageCount = Math.ceil(library.length / LIBRARY_PAGE_SIZE)
  const librarySlice = library.slice(libraryPage * LIBRARY_PAGE_SIZE, (libraryPage + 1) * LIBRARY_PAGE_SIZE)

  const bufferColor = creator.bufferDays >= 2 ? '#22c55e' : creator.bufferDays >= 1 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ padding: '20px 32px', maxWidth: '960px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <Link href="/editor" style={{ fontSize: '12px', color: '#52525b', textDecoration: 'none', padding: '5px 10px', border: '1px solid #2a2a2a', borderRadius: '6px' }}>
            ← Back
          </Link>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{creator.name}</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: bufferColor }}>{creator.bufferDays}</span>
            <span style={{ fontSize: '12px', color: bufferColor, fontWeight: 600 }}>d runway</span>
          </div>
          <button onClick={fetchData} style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: '#111', color: '#a1a1aa', border: '1px solid #333', borderRadius: '6px', cursor: 'pointer' }}>
            Refresh
          </button>
        </div>

        {/* Task sections */}
        {[
          { key: 'needsRevision', items: tasks.needsRevision },
          { key: 'inProgress',    items: tasks.inProgress },
          { key: 'queue',         items: tasks.queue },
          { key: 'inReview',      items: tasks.inReview },
          { key: 'approved',      items: tasks.approved },
          { key: 'history',       items: tasks.history },
        ].map(({ key, items }) => items.length === 0 ? null : (
          <div key={key} style={{ marginBottom: '28px' }}>
            <SectionLabel type={key} count={items.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(task => <TaskRow key={task.id} task={task} type={key} />)}
            </div>
          </div>
        ))}

        {/* Creator clips uploaded (inspo-linked) */}
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

        {/* Unreviewed Library */}
        {library.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#a78bfa' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Unreviewed Library</span>
              <span style={{ fontSize: '11px', color: '#3f3f46' }}>({library.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {librarySlice.map(asset => <LibraryAsset key={asset.id} asset={asset} />)}
            </div>
            {libraryPageCount > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <button onClick={() => setLibraryPage(p => Math.max(0, p - 1))} disabled={libraryPage === 0}
                  style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, background: '#111', color: libraryPage === 0 ? '#3f3f46' : '#a1a1aa', border: '1px solid #333', borderRadius: '6px', cursor: libraryPage === 0 ? 'default' : 'pointer' }}>
                  ← Prev
                </button>
                <span style={{ fontSize: '12px', color: '#52525b' }}>{libraryPage + 1} / {libraryPageCount}</span>
                <button onClick={() => setLibraryPage(p => Math.min(libraryPageCount - 1, p + 1))} disabled={libraryPage === libraryPageCount - 1}
                  style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 600, background: '#111', color: libraryPage === libraryPageCount - 1 ? '#3f3f46' : '#a1a1aa', border: '1px solid #333', borderRadius: '6px', cursor: libraryPage === libraryPageCount - 1 ? 'default' : 'pointer' }}>
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {tasks.needsRevision.length + tasks.inProgress.length + tasks.queue.length + tasks.inReview.length + tasks.approved.length + tasks.history.length + inspoClips.length + library.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', color: '#3f3f46', fontSize: '14px', background: '#0d0d0d', borderRadius: '12px', border: '1px solid #1a1a1a' }}>
            No editing activity yet for {creator.name}.
          </div>
        )}
      </div>
    </div>
  )
}
