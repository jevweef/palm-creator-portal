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
      {cardThumb && (
        <div style={{ aspectRatio: '9/16', background: '#000' }}>
          <img
            src={cardThumb}
            alt={item.inspoTitle}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}
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

function PipelineDetailModal({ item, onClose }) {
  const clipUrl = item.dropboxLink ? rawDropboxUrl(item.dropboxLink) : ''
  const inspoUrl = item.inspoDbShareLink ? rawDropboxUrl(item.inspoDbShareLink) : ''
  const statusStyle = STATUS_COLORS[item.pipelineStatus] || STATUS_COLORS.Uploaded

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        padding: '24px',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '900px',
        maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              <p style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>@{item.inspoUsername}</p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', fontSize: '22px', cursor: 'pointer', lineHeight: 1, flexShrink: 0, marginLeft: '16px' }}>×</button>
        </div>

        {/* Two-column video comparison */}
        <div style={{ padding: '24px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {/* My Clip */}
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#E88FAC', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              My Clip
            </div>
            {clipUrl ? (
              <video
                src={clipUrl}
                controls
                playsInline
                style={{ width: '100%', maxHeight: '500px', borderRadius: '12px', background: '#000', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ aspectRatio: '9/16', background: '#f5f5f5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' }}>
                No clip available
              </div>
            )}
          </div>

          {/* Inspo Reference */}
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Inspo Reference
            </div>
            {inspoUrl ? (
              <video
                src={inspoUrl}
                controls
                playsInline
                style={{ width: '100%', maxHeight: '500px', borderRadius: '12px', background: '#000', objectFit: 'contain' }}
              />
            ) : item.inspoThumbnail ? (
              <img src={item.inspoThumbnail} alt="" style={{ width: '100%', maxHeight: '500px', borderRadius: '12px', objectFit: 'contain' }} />
            ) : (
              <div style={{ aspectRatio: '9/16', background: '#f5f5f5', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' }}>
                No inspo linked
              </div>
            )}
          </div>
        </div>

        {/* Details section */}
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {item.creatorNotes && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Your Notes</div>
              <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, fontStyle: 'italic', margin: 0 }}>&quot;{item.creatorNotes}&quot;</p>
            </div>
          )}
          {item.inspoNotes && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Inspo Direction</div>
              <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, margin: 0 }}>{item.inspoNotes}</p>
            </div>
          )}
          {item.inspoTags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {item.inspoTags.map((tag) => (
                <span key={tag} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '9999px', ...tagStyle(tag) }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
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
