'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { tagStyle } from '@/lib/tagStyle'
import QuotaBar from '@/components/QuotaBar'
import InspoCard from '@/components/InspoCard'
import InspoModal from '@/components/InspoModal'
import UploadModal from '@/components/UploadModal'

const TABS = [
  { key: 'saved', label: 'Saved' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'editing', label: 'Editing' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'posted', label: 'Posted' },
]

const STATUS_COLORS = {
  Uploaded: { bg: 'rgba(120, 180, 232, 0.08)', color: '#78B4E8' },
  'In Editing': { bg: 'rgba(232, 200, 120, 0.08)', color: '#E8C878' },
  'In Review': { bg: '#ffedd5', color: '#E8A878' },
  Scheduled: { bg: '#ede9fe', color: 'var(--palm-pink)' },
  Posted: { bg: 'rgba(125, 211, 164, 0.08)', color: '#4ade80' },
}

function PipelineCard({ item, onClick }) {
  const statusStyle = STATUS_COLORS[item.pipelineStatus] || STATUS_COLORS.Uploaded
  // Show the creator's uploaded clip, fall back to inspo thumbnail
  const cardThumb = item.assetThumbnail || item.inspoThumbnail
  // Creator's clip as playable video (Dropbox raw URL)
  const clipUrl = item.dropboxLink ? rawDropboxUrl(item.dropboxLink) : ''

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card-bg-solid)',
        border: 'none',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        borderRadius: '18px',
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)' } }}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)' } }}
    >
      <div style={{ aspectRatio: '9/16', background: 'rgba(232, 160, 160, 0.04)' }}>
        {item.assetThumbnail ? (
          <img
            src={item.assetThumbnail}
            alt={item.inspoTitle}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : clipUrl ? (
          <video
            src={clipUrl}
            muted
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
          />
        ) : item.inspoThumbnail ? (
          <img
            src={item.inspoThumbnail}
            alt={item.inspoTitle}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
      </div>
      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', margin: 0, lineHeight: 1.3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.inspoTitle || item.assetName}
          </h3>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: '9999px',
            background: statusStyle.bg,
            color: statusStyle.color,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            {item.pipelineStatus}
          </span>
        </div>
        {item.inspoUsername && (
          <p style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>@{item.inspoUsername}</p>
        )}
        {item.creatorNotes && (
          <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '8px', lineHeight: 1.4, fontStyle: 'italic' }}>
            &quot;{item.creatorNotes}&quot;
          </p>
        )}
        {item.inspoTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '10px' }}>
            {item.inspoTags.slice(0, 3).map((tag) => (
              <span key={tag} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', ...tagStyle(tag) }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

function PipelineDetailModal({ item, onClose, onReplace }) {
  const clipUrl = item.dropboxLink ? rawDropboxUrl(item.dropboxLink) : ''
  const inspoUrl = item.inspoDbShareLink ? rawDropboxUrl(item.inspoDbShareLink) : ''
  const canReplace = item.pipelineStatus === 'Uploaded'

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const handleReplace = () => {
    onReplace(item)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '720px',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        margin: '24px',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid transparent' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
              {item.inspoTitle || item.assetName}
            </h2>
            {item.inspoUsername && (
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>@{item.inspoUsername}</p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {canReplace && (
              <button
                onClick={handleReplace}
                style={{
                  padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                  background: 'rgba(232, 160, 160, 0.04)', color: 'var(--palm-pink)', border: '1px solid transparent',
                  borderRadius: '9999px', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                Replace Clip
              </button>
            )}
            <button onClick={onClose} style={{ color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Two videos side by side */}
        <div style={{ display: 'flex', gap: '16px', padding: '20px 24px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--palm-pink)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>My Clip</div>
            <div style={{ borderRadius: '12px', overflow: 'hidden', background: '#000', aspectRatio: '9/16' }}>
              {clipUrl ? (
                <video src={clipUrl} controls playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '13px' }}>No clip</div>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Inspo</div>
            <div style={{ borderRadius: '12px', overflow: 'hidden', background: '#000', aspectRatio: '9/16' }}>
              {inspoUrl ? (
                <video src={inspoUrl} controls playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : item.inspoThumbnail ? (
                <img src={item.inspoThumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(240, 236, 232, 0.85)', fontSize: '13px' }}>No inspo</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ tab }) {
  const messages = {
    saved: 'No saved inspo yet. Browse the Inspo Board to save reels you want to recreate.',
    uploaded: 'No uploaded clips yet. Save some inspo and upload your filmed clips.',
    editing: 'Nothing in editing right now.',
    scheduled: 'No content scheduled yet.',
    posted: 'No posted content yet.',
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)' }}>
      <p style={{ fontSize: '14px' }}>{messages[tab]}</p>
    </div>
  )
}

export default function MyContentPage({ opsIdOverride, hqIdOverride } = {}) {
  const { user } = useUser()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'saved')

  const switchTab = (tab) => {
    setActiveTab(tab)
    router.replace(`${pathname}?tab=${tab}`, { scroll: false })
  }
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modalIndex, setModalIndex] = useState(null) // index into data.saved for InspoModal
  const [uploadRecord, setUploadRecord] = useState(null) // inspo record for upload modal
  const [pipelineItem, setPipelineItem] = useState(null) // pipeline card detail modal
  const [replaceInfo, setReplaceInfo] = useState(null) // { assetId, record } for replace flow

  const creatorOpsId = opsIdOverride || user?.publicMetadata?.airtableOpsId || null
  const creatorHqId = hqIdOverride || user?.publicMetadata?.airtableHqId || null

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-pipeline?creatorOpsId=${creatorOpsId}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (err) {
      console.error('Failed to fetch pipeline data:', err)
    } finally {
      setLoading(false)
    }
  }, [creatorOpsId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const tabCounts = data ? {
    saved: data.saved.length,
    uploaded: data.uploaded.length,
    editing: data.editing.length,
    scheduled: data.scheduled.length,
    posted: data.posted.length,
  } : {}

  // Modal navigation for saved tab
  const savedRecords = data?.saved || []
  const modalRecord = modalIndex !== null ? savedRecords[modalIndex] : null

  const handleCardClick = (index) => {
    setModalIndex(index)
  }

  const handleModalClose = () => {
    setModalIndex(null)
  }

  const handleModalPrev = () => {
    if (modalIndex > 0) setModalIndex(modalIndex - 1)
  }

  const handleModalNext = () => {
    if (modalIndex < savedRecords.length - 1) setModalIndex(modalIndex + 1)
  }

  // Upload button handler from modal
  const handleUploadFromModal = () => {
    if (modalRecord) {
      setModalIndex(null)
      setUploadRecord(modalRecord)
    }
  }

  // Unsave handler — removes from saved list
  const handleUnsave = async (recordId) => {
    // Optimistically remove from local data
    setData((prev) => {
      if (!prev) return prev
      const updated = { ...prev, saved: prev.saved.filter((r) => r.id !== recordId) }
      return updated
    })
    // Close modal if the unsaved record was open
    setModalIndex(null)

    try {
      await fetch('/api/inspo-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, creatorOpsId, action: 'unsave' }),
      })
    } catch (err) {
      console.error('Failed to unsave:', err)
      fetchData() // refetch on error
    }
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }} className="px-4 md:px-8 py-4 md:py-6">
      {/* Page header + quota */}
      <div className="mb-4 md:mb-7">
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: '0 0 16px 0' }}>
          My Content
        </h1>
        <div style={{ minHeight: '24px' }}>
          {data?.quota ? (
            <QuotaBar used={data.quota.used} target={data.quota.target} />
          ) : (
            <div style={{ height: '12px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)' }} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        borderBottom: '1px solid transparent',
        marginBottom: '24px',
        overflowX: 'auto',
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            style={{
              padding: '10px 12px',
              fontSize: '13px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--foreground)' : 'var(--foreground-muted)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '1px solid var(--palm-pink)' : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
            {tabCounts[tab.key] > 0 && (
              <span style={{
                marginLeft: '6px',
                fontSize: '11px',
                background: activeTab === tab.key ? 'var(--palm-pink)' : 'transparent',
                color: activeTab === tab.key ? 'rgba(255,255,255,0.08)' : '#999',
                padding: '1px 7px',
                borderRadius: '9999px',
              }}>
                {tabCounts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--foreground-muted)' }}>
          Loading...
        </div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#E87878' }}>
          Failed to load content pipeline
        </div>
      ) : (
        <>
          {activeTab === 'saved' && (
            savedRecords.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {savedRecords.map((record, i) => (
                  <div key={record.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ position: 'relative', zIndex: 2 }}>
                      <InspoCard
                        record={record}
                        onClick={() => handleCardClick(i)}
                      />
                    </div>
                    <button
                      onClick={() => setUploadRecord(record)}
                      style={{
                        position: 'relative',
                        zIndex: 1,
                        marginTop: '-12px',
                        width: '100%',
                        padding: '22px 8px 10px',
                        background: 'var(--palm-pink)',
                        color: '#060606',
                        border: 'none',
                        borderRadius: '0 0 12px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'filter 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.15)'}
                      onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                    >
                      <svg style={{ width: '14px', height: '14px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Upload Clips
                    </button>
                  </div>
                ))}
              </div>
            ) : <EmptyState tab="saved" />
          )}

          {activeTab === 'uploaded' && (
            data.uploaded.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {data.uploaded.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="uploaded" />
          )}

          {activeTab === 'editing' && (
            data.editing.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {data.editing.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="editing" />
          )}

          {activeTab === 'scheduled' && (
            data.scheduled.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {data.scheduled.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="scheduled" />
          )}

          {activeTab === 'posted' && (
            data.posted.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {data.posted.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="posted" />
          )}
        </>
      )}

      {/* Inspo detail modal for saved tab — same as inspo board */}
      {modalRecord && (
        <InspoModal
          record={modalRecord}
          onClose={handleModalClose}
          onPrev={handleModalPrev}
          onNext={handleModalNext}
          hasPrev={modalIndex > 0}
          hasNext={modalIndex < savedRecords.length - 1}
          onUpload={handleUploadFromModal}
          isSaved={true}
          onSave={handleUnsave}
        />
      )}

      {/* Pipeline detail modal — shows uploaded clip + inspo side by side */}
      {pipelineItem && (
        <PipelineDetailModal
          item={pipelineItem}
          onClose={() => setPipelineItem(null)}
          onReplace={(item) => {
            setPipelineItem(null)
            // Open upload modal in replace mode — build a minimal record object for UploadModal
            setReplaceInfo({ assetId: item.assetId, record: { id: item.inspoId, title: item.inspoTitle || item.assetName } })
          }}
        />
      )}

      {/* Replace clip modal */}
      {replaceInfo && (
        <UploadModal
          record={replaceInfo.record}
          replaceAssetId={replaceInfo.assetId}
          creatorOpsId={creatorOpsId}
          creatorHqId={creatorHqId}
          onClose={() => setReplaceInfo(null)}
          onSuccess={() => {
            setReplaceInfo(null)
            fetchData()
          }}
        />
      )}

      {/* Upload modal */}
      {uploadRecord && (
        <UploadModal
          record={uploadRecord}
          creatorOpsId={creatorOpsId}
          creatorHqId={creatorHqId}
          onClose={() => setUploadRecord(null)}
          onSuccess={() => {
            // Refresh data after successful upload
            fetchData()
          }}
        />
      )}
    </div>
  )
}
