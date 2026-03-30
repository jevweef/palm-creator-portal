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

function LibraryVideoCard({ asset, creatorId, onRefresh }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const link = asset.dropboxLinks?.[0] || asset.dropboxLink || ''
  const rawUrl = rawDropboxUrl(link)
  const videoUrl = rawUrl
  const videoFile = isVideo(link)
  const photoFile = isPhoto(link)

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

function LibrarySection({ title, dot, assets, creatorId, onRefresh }) {
  if (!assets.length) return null
  const videos = assets.filter(a => a.assetType === 'Video' || (!a.assetType && isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const photos = assets.filter(a => a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && !isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const [activeTab, setActiveTab] = useState('videos')
  const shown = activeTab === 'videos' ? videos : photos
  const tabs = [
    { key: 'videos', label: 'Videos', count: videos.length },
    { key: 'photos', label: 'Photos', count: photos.length },
  ].filter(t => t.count > 0)

  return (
    <div>
      {/* Section header + tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
          <span style={{ fontSize: '11px', color: '#3f3f46' }}>({assets.length})</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '3px' }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: activeTab === t.key ? '#1e1e1e' : 'transparent',
                color: activeTab === t.key ? '#d4d4d8' : '#52525b' }}>
              {t.label} <span style={{ color: activeTab === t.key ? '#71717a' : '#3f3f46', fontWeight: 400 }}>{t.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
        {shown.map(asset => (
          <LibraryVideoCard key={asset.id} asset={asset} creatorId={creatorId} onRefresh={onRefresh} />
        ))}
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
                    <TaskCard key={task.id} task={task} type="inReview" creatorName={data.creator.name}
                      onAction={handleAction} updating={false} />
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
    </div>
  )
}
