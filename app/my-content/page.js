'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
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
  Uploaded: { bg: '#dbeafe', color: '#60a5fa' },
  'In Editing': { bg: '#fef3c7', color: '#facc15' },
  'In Review': { bg: '#ffedd5', color: '#fb923c' },
  Scheduled: { bg: '#ede9fe', color: '#E88FAC' },
  Posted: { bg: '#dcfce7', color: '#4ade80' },
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
        background: '#ffffff',
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
      <div style={{ aspectRatio: '9/16', background: '#000' }}>
        {clipUrl ? (
          <video
            src={clipUrl}
            muted
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
          />
        ) : cardThumb ? (
          <img
            src={cardThumb}
            alt={item.inspoTitle}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
      </div>
      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', margin: 0, lineHeight: 1.3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <p style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>@{item.inspoUsername}</p>
        )}
        {item.creatorNotes && (
          <p style={{ fontSize: '12px', color: '#888', marginTop: '8px', lineHeight: 1.4, fontStyle: 'italic' }}>
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

function parseNotes(notes) {
  if (!notes) return { inspoDirection: '', whatMattersMost: '' }
  const inspoMatch = notes.match(/Inspo direction:\n?([\s\S]*?)(?=What matters most:|$)/i)
  const wmmMatch = notes.match(/What matters most:\n?([\s\S]*?)$/i)
  return {
    inspoDirection: inspoMatch ? inspoMatch[1].trim() : '',
    whatMattersMost: wmmMatch ? wmmMatch[1].trim() : '',
  }
}

function PipelineDetailModal({ item, onClose }) {
  const clipUrl = item.dropboxLink ? rawDropboxUrl(item.dropboxLink) : ''
  const inspoUrl = item.inspoDbShareLink ? rawDropboxUrl(item.inspoDbShareLink) : ''
  const statusStyle = STATUS_COLORS[item.pipelineStatus] || STATUS_COLORS.Uploaded
  const { inspoDirection, whatMattersMost } = parseNotes(item.inspoNotes)

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full h-full md:h-auto md:max-h-[85vh] md:max-w-5xl md:mx-6 md:rounded-2xl bg-white overflow-hidden flex flex-col" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.15)', border: 'none' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid rgba(0,0,0,0.06)', gap: '16px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4, margin: 0 }}>
                {item.inspoTitle || item.assetName}
              </h2>
              <span style={{
                fontSize: '10px', fontWeight: 600, padding: '3px 10px', borderRadius: '9999px',
                background: statusStyle.bg, color: statusStyle.color, flexShrink: 0,
              }}>
                {item.pipelineStatus}
              </span>
            </div>
            {item.inspoUsername && (
              <p style={{ fontSize: '12px', color: '#999', marginTop: '6px' }}>@{item.inspoUsername}</p>
            )}
          </div>
          <button onClick={onClose} style={{ color: '#999', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', marginTop: '2px' }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — video drives height, right side scrolls */}
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto md:overflow-visible md:relative md:flex-none">

          {/* Creator's clip — 9:16 aspect ratio */}
          <div className="w-full shrink-0 md:shrink md:w-[280px] bg-black overflow-hidden" style={{ aspectRatio: '9/16' }}>
            {clipUrl ? (
              <video src={clipUrl} controls autoPlay muted loop playsInline className="w-full md:h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#D4A0B0]">
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>

          {/* Details panel — absolute on desktop */}
          <div className="flex flex-col gap-5 p-[22px_28px] bg-white md:absolute md:top-0 md:bottom-0 md:left-[280px] md:right-0 md:overflow-y-auto border-t md:border-t-0 md:border-l border-[rgba(0,0,0,0.06)]">

            {/* Creator notes */}
            {item.creatorNotes && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: '8px' }}>Your Notes</p>
                <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.6, fontStyle: 'italic' }}>&quot;{item.creatorNotes}&quot;</p>
              </div>
            )}

            {/* Tags */}
            {item.inspoTags?.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: '12px' }}>Tags</p>
                <div className="flex flex-wrap gap-2">
                  {item.inspoTags.map((tag) => (
                    <span key={tag} style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '9999px', ...tagStyle(tag) }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Inspo Direction */}
            {inspoDirection && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: '8px' }}>Inspo Direction</p>
                <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.6 }}>{inspoDirection}</p>
              </div>
            )}

            {/* What Matters Most */}
            {whatMattersMost && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: '8px' }}>What Matters Most</p>
                <p style={{ fontSize: '14px', color: '#333', lineHeight: 1.6 }}>{whatMattersMost}</p>
              </div>
            )}

            {/* Inspo reference video */}
            {(inspoUrl || item.inspoThumbnail) && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: '10px' }}>Inspo Reference</p>
                <div style={{ maxWidth: '220px', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
                  {inspoUrl ? (
                    <video src={inspoUrl} controls playsInline muted style={{ width: '100%', display: 'block' }} />
                  ) : (
                    <img src={item.inspoThumbnail} alt="" style={{ width: '100%', display: 'block' }} />
                  )}
                </div>
              </div>
            )}
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
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
      <p style={{ fontSize: '14px' }}>{messages[tab]}</p>
    </div>
  )
}

export default function MyContentPage({ opsIdOverride, hqIdOverride } = {}) {
  const { user } = useUser()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'saved')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modalIndex, setModalIndex] = useState(null) // index into data.saved for InspoModal
  const [uploadRecord, setUploadRecord] = useState(null) // inspo record for upload modal
  const [pipelineItem, setPipelineItem] = useState(null) // pipeline card detail modal

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
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 16px 0' }}>
          My Content
        </h1>
        {data?.quota && (
          <QuotaBar used={data.quota.used} target={data.quota.target} />
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        borderBottom: '1px solid rgba(0,0,0,0.04)',
        marginBottom: '24px',
        overflowX: 'auto',
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 12px',
              fontSize: '13px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#1a1a1a' : '#999',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #E88FAC' : '2px solid transparent',
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
                background: activeTab === tab.key ? '#E88FAC' : '#F0D0D8',
                color: activeTab === tab.key ? '#fff' : '#999',
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
        <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>
          Loading...
        </div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#ef4444' }}>
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
                        background: '#E88FAC',
                        color: '#fff',
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.uploaded.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="uploaded" />
          )}

          {activeTab === 'editing' && (
            data.editing.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.editing.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="editing" />
          )}

          {activeTab === 'scheduled' && (
            data.scheduled.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.scheduled.map((item) => (
                  <PipelineCard key={item.assetId} item={item} onClick={() => setPipelineItem(item)} />
                ))}
              </div>
            ) : <EmptyState tab="scheduled" />
          )}

          {activeTab === 'posted' && (
            data.posted.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
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
