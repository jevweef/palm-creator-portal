'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { QuotaDots, TaskCard, SectionLabel, SubmitModal } from '@/components/EditorDashboard'

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

function LibraryVideoCard({ asset, creatorId, onRefresh, forcePhoto = false }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const link = asset.dropboxLinks?.[0] || asset.dropboxLink || ''
  const rawUrl = rawDropboxUrl(link)
  const videoUrl = rawUrl
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
          <video src={rawUrl} autoPlay muted loop playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
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
        {asset.onScreenText && (
          <div style={{ fontSize: '10px', color: '#71717a', lineHeight: 1.3, fontStyle: 'italic' }}>&ldquo;{asset.onScreenText}&rdquo;</div>
        )}
        {asset.creatorNotes && (
          <div style={{ fontSize: '10px', color: '#52525b', lineHeight: 1.3 }}>{asset.creatorNotes}</div>
        )}
        <div style={{ display: 'flex', gap: '4px', marginTop: 'auto' }}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: '#1a1a1a', color: '#71717a', border: '1px solid #2a2a2a', borderRadius: '6px', textDecoration: 'none' }}>
              View &#8599;
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

function AssetSubGroup({ label, assets, creatorId, onRefresh }) {
  if (!assets.length) return null
  return (
    <div>
      <div style={{ fontSize: '11px', color: '#52525b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
        {label} <span style={{ color: '#3f3f46', fontWeight: 400 }}>({assets.length})</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
        {assets.map(asset => (
          <LibraryVideoCard key={asset.id} asset={asset} creatorId={creatorId} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  )
}

const PAGE_SIZE = 24

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

function LibrarySection({ title, dot, assets, creatorId, onRefresh }) {
  if (!assets.length) return null
  const videos = assets.filter(a => a.assetType === 'Video' || (!a.assetType && isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const photos = assets.filter(a => a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && !isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const [activeTab, setActiveTab] = useState('videos')
  const [page, setPage] = useState(1)
  const shown = activeTab === 'videos' ? videos : photos
  const totalPages = Math.ceil(shown.length / PAGE_SIZE)
  const paged = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const tabs = [
    { key: 'videos', label: 'Videos', count: videos.length },
    { key: 'photos', label: 'Photos', count: photos.length },
  ].filter(t => t.count > 0)

  const switchTab = (key) => { setActiveTab(key); setPage(1) }

  return (
    <div>
      {/* Section header + tabs + top paginator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
          <span style={{ fontSize: '11px', color: '#3f3f46' }}>({assets.length})</span>
        </div>
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
        <Paginator page={page} totalPages={totalPages} onChange={setPage} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
        {paged.map(asset => (
          <LibraryVideoCard key={asset.id} asset={asset} creatorId={creatorId} onRefresh={onRefresh} forcePhoto={activeTab === 'photos'} />
        ))}
      </div>
      {/* Bottom paginator */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
          <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  )
}

function TelegramSendModal({ task, threadId, onClose, onSent }) {
  const [caption, setCaption] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const editedFileLink = task.asset?.editedFileLink || ''

  const handleSend = async () => {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editedFileLink,
          threadId,
          caption: caption.trim() || undefined,
          taskName: task.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      onSent()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '28px', width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#d4d4d8' }}>Send to Telegram</div>
            <div style={{ fontSize: '12px', color: '#52525b', marginTop: '2px' }}>{task.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>

        {editedFileLink ? (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>File to send</div>
            <a href={editedFileLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '12px', color: '#a78bfa', textDecoration: 'none', wordBreak: 'break-all' }}>
              {editedFileLink}
            </a>
          </div>
        ) : (
          <div style={{ background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', color: '#ef4444' }}>
            No edited file link on this task.
          </div>
        )}

        <div>
          <div style={{ fontSize: '11px', color: '#52525b', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Caption <span style={{ color: '#3f3f46', fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Add a caption for the post..."
            rows={4}
            style={{ width: '100%', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#d4d4d8', fontSize: '13px', padding: '10px 12px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>

        {error && <div style={{ fontSize: '12px', color: '#ef4444', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '8px 12px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#71717a', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !editedFileLink}
            style={{ flex: 2, padding: '10px', background: sending || !editedFileLink ? '#0d1a0d' : '#0f2d0f', border: `1px solid ${sending || !editedFileLink ? '#1a3d1a' : '#1a5c1a'}`, color: sending || !editedFileLink ? '#2d5c2d' : '#22c55e', borderRadius: '8px', cursor: sending || !editedFileLink ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
            {sending ? 'Sending...' : '✈ Send to Telegram'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CreatorEditorPage() {
  const { creatorId } = useParams()
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitModal, setSubmitModal] = useState(null)
  const [telegramModal, setTelegramModal] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/editor/creator/${creatorId}`)
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      setData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [creatorId])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAction = async (type, task) => {
    if (type === 'startEditing') {
      setUpdating(task.id)
      try {
        const res = await fetch('/api/admin/editor', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, newStatus: 'In Progress' }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed')
        showToast('Started editing')
        fetchData()
      } catch (err) { showToast(err.message, true) }
      finally { setUpdating(null) }
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
    fetchData()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
          <button onClick={() => router.push('/editor')}
            style={{ background: 'none', border: '1px solid #2a2a2a', color: '#71717a', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
            &#8592; All Creators
          </button>
          {data && (
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>{data.creator.name}</h1>
              <div style={{ marginTop: '6px' }}>
                <QuotaDots done={data.creator.doneThisWeek} quota={data.creator.quota} />
              </div>
            </div>
          )}
          <button onClick={fetchData} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #2a2a2a', color: '#52525b', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            Refresh
          </button>
        </div>

        {loading && <div style={{ color: '#3f3f46', textAlign: 'center', padding: '60px' }}>Loading...</div>}
        {error && <div style={{ color: '#ef4444', padding: '20px' }}>{error}</div>}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
            {/* Task sections */}
            {data.needsRevision.length > 0 && (
              <div>
                <SectionLabel type="needsRevision" count={data.needsRevision.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                  {data.needsRevision.map(task => (
                    <TaskCard key={task.id} task={task} type="needsRevision" creatorName={data.creator.name}
                      onAction={handleAction} updating={updating === task.id} />
                  ))}
                </div>
              </div>
            )}
            {data.queue.length > 0 && (
              <div>
                <SectionLabel type="queue" count={data.queue.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                  {data.queue.map(task => (
                    <TaskCard key={task.id} task={task} type="queue" creatorName={data.creator.name}
                      onAction={handleAction} updating={updating === task.id} />
                  ))}
                </div>
              </div>
            )}
            {data.inProgress.length > 0 && (
              <div>
                <SectionLabel type="inProgress" count={data.inProgress.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                  {data.inProgress.map(task => (
                    <TaskCard key={task.id} task={task} type="inProgress" creatorName={data.creator.name}
                      onAction={handleAction} updating={updating === task.id} />
                  ))}
                </div>
              </div>
            )}
            {data.inReview.length > 0 && (
              <div>
                <SectionLabel type="inReview" count={data.inReview.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                  {data.inReview.map(task => (
                    <div key={task.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <TaskCard task={task} type="inReview" creatorName={data.creator.name}
                        onAction={handleAction} updating={false} />
                      {task.asset?.editedFileLink && (
                        <button
                          onClick={() => setTelegramModal({ task, threadId: data.creator.telegramThreadId })}
                          style={{ width: '100%', padding: '9px', fontSize: '12px', fontWeight: 700, background: '#0d1a0d', color: '#22c55e', border: '1px solid #1a3d1a', borderRadius: '8px', cursor: 'pointer', letterSpacing: '0.02em' }}>
                          ✈ Send to Telegram
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Library sections */}
            <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '32px', display: 'flex', flexDirection: 'column', gap: '36px' }}>
              <LibrarySection title="Inspo Uploads" dot="#a78bfa" assets={data.inspoUploads} creatorId={creatorId} onRefresh={fetchData} />
              <LibrarySection title="File Request Library" dot="#3f3f46" assets={data.libraryClips} creatorId={creatorId} onRefresh={fetchData} />
            </div>

            {/* AI placeholder */}
            <div style={{ borderTop: '1px solid #141414', paddingTop: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#1a1a1a' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Inspo Matching</span>
                <span style={{ fontSize: '10px', color: '#1e1e1e', background: '#141414', border: '1px solid #1e1e1e', borderRadius: '4px', padding: '2px 6px', fontWeight: 600 }}>Coming soon</span>
              </div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#2a2a2a', lineHeight: 1.5 }}>
                Automatic inspo suggestions for each uploaded clip
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 300, padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, background: toast.isError ? '#2d1515' : '#0a2e0a', color: toast.isError ? '#ef4444' : '#22c55e', border: `1px solid ${toast.isError ? '#5c2020' : '#1a5c1a'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {submitModal && (
        <SubmitModal
          task={submitModal.task}
          creatorName={data?.creator?.name || ''}
          isRevision={submitModal.isRevision}
          onClose={() => setSubmitModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {telegramModal && (
        <TelegramSendModal
          task={telegramModal.task}
          threadId={telegramModal.threadId}
          onClose={() => setTelegramModal(null)}
          onSent={() => showToast('Sent to Telegram ✓')}
        />
      )}
    </div>
  )
}
