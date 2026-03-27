'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState, useCallback } from 'react'
import { tagStyle } from '@/lib/tagStyle'
import QuotaBar from '@/components/QuotaBar'

const TABS = [
  { key: 'saved', label: 'Saved' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'editing', label: 'Editing' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'posted', label: 'Posted' },
]

const STATUS_COLORS = {
  Uploaded: { bg: '#1e3a5f', color: '#60a5fa' },
  'In Editing': { bg: '#3f3412', color: '#facc15' },
  'In Review': { bg: '#3f2412', color: '#fb923c' },
  Scheduled: { bg: '#2d1f4e', color: '#a78bfa' },
  Posted: { bg: '#14372a', color: '#4ade80' },
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

function formatNum(n) {
  if (!n || n < 0) return null
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function SavedCard({ record, onUpload }) {
  const { inspoDirection } = parseNotes(record.notes)
  const views = formatNum(record.views)

  return (
    <div style={{
      background: '#111',
      border: '1px solid #222',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {record.thumbnail && (
        <div style={{ position: 'relative', aspectRatio: '9/16', background: '#000' }}>
          <img
            src={record.thumbnail}
            alt={record.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {views && (
            <span style={{
              position: 'absolute', bottom: '8px', left: '8px',
              fontSize: '11px', color: '#fff', background: 'rgba(0,0,0,0.7)',
              padding: '2px 8px', borderRadius: '4px',
            }}>
              {views} views
            </span>
          )}
        </div>
      )}
      <div style={{ padding: '14px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', margin: 0, lineHeight: 1.3 }}>
          {record.title}
        </h3>
        {record.username && (
          <p style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>@{record.username}</p>
        )}
        {inspoDirection && (
          <p style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '8px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {inspoDirection}
          </p>
        )}
        {record.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '10px' }}>
            {record.tags.slice(0, 3).map((tag) => (
              <span key={tag} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', ...tagStyle(tag) }}>
                {tag}
              </span>
            ))}
            {record.tags.length > 3 && (
              <span style={{ fontSize: '10px', color: '#52525b' }}>+{record.tags.length - 3}</span>
            )}
          </div>
        )}
        <button
          onClick={() => onUpload(record)}
          style={{
            marginTop: '12px',
            width: '100%',
            padding: '8px',
            background: '#a855f7',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Upload Clips
        </button>
      </div>
    </div>
  )
}

function PipelineCard({ item }) {
  const statusStyle = STATUS_COLORS[item.pipelineStatus] || STATUS_COLORS.Uploaded

  return (
    <div style={{
      background: '#111',
      border: '1px solid #222',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {item.inspoThumbnail && (
        <div style={{ aspectRatio: '9/16', background: '#000' }}>
          <img
            src={item.inspoThumbnail}
            alt={item.inspoTitle}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}
      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', margin: 0, lineHeight: 1.3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <p style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>@{item.inspoUsername}</p>
        )}
        {item.creatorNotes && (
          <p style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '8px', lineHeight: 1.4, fontStyle: 'italic' }}>
            "{item.creatorNotes}"
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

function EmptyState({ tab }) {
  const messages = {
    saved: 'No saved inspo yet. Browse the Inspo Board to save reels you want to recreate.',
    uploaded: 'No uploaded clips yet. Save some inspo and upload your filmed clips.',
    editing: 'Nothing in editing right now.',
    scheduled: 'No content scheduled yet.',
    posted: 'No posted content yet.',
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#52525b' }}>
      <p style={{ fontSize: '14px' }}>{messages[tab]}</p>
    </div>
  )
}

export default function MyContentPage() {
  const { user } = useUser()
  const [activeTab, setActiveTab] = useState('saved')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploadRecord, setUploadRecord] = useState(null) // inspo record for upload modal

  const creatorOpsId = user?.publicMetadata?.airtableOpsId || 'recBELsdb0C6fRBSm'

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

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }} className="px-4 md:px-8 py-6">
      {/* Page header + quota */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', margin: '0 0 16px 0' }}>
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
        borderBottom: '1px solid #222',
        marginBottom: '24px',
        overflowX: 'auto',
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#fff' : '#71717a',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #a855f7' : '2px solid transparent',
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
                background: activeTab === tab.key ? '#a855f7' : '#222',
                color: activeTab === tab.key ? '#fff' : '#71717a',
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
        <div style={{ textAlign: 'center', padding: '60px', color: '#52525b' }}>
          Loading...
        </div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#ef4444' }}>
          Failed to load content pipeline
        </div>
      ) : (
        <>
          {activeTab === 'saved' && (
            data.saved.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.saved.map((record) => (
                  <SavedCard
                    key={record.id}
                    record={record}
                    onUpload={(r) => setUploadRecord(r)}
                  />
                ))}
              </div>
            ) : <EmptyState tab="saved" />
          )}

          {activeTab === 'uploaded' && (
            data.uploaded.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.uploaded.map((item) => (
                  <PipelineCard key={item.assetId} item={item} />
                ))}
              </div>
            ) : <EmptyState tab="uploaded" />
          )}

          {activeTab === 'editing' && (
            data.editing.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.editing.map((item) => (
                  <PipelineCard key={item.assetId} item={item} />
                ))}
              </div>
            ) : <EmptyState tab="editing" />
          )}

          {activeTab === 'scheduled' && (
            data.scheduled.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.scheduled.map((item) => (
                  <PipelineCard key={item.assetId} item={item} />
                ))}
              </div>
            ) : <EmptyState tab="scheduled" />
          )}

          {activeTab === 'posted' && (
            data.posted.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {data.posted.map((item) => (
                  <PipelineCard key={item.assetId} item={item} />
                ))}
              </div>
            ) : <EmptyState tab="posted" />
          )}
        </>
      )}

      {/* Upload modal placeholder — will be built next */}
      {uploadRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setUploadRecord(null)}
        >
          <div style={{
            background: '#111',
            border: '1px solid #222',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '500px',
            width: '90%',
            textAlign: 'center',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#fff', margin: '0 0 8px 0' }}>
              Upload Clips
            </h2>
            <p style={{ fontSize: '13px', color: '#71717a', margin: '0 0 16px 0' }}>
              for "{uploadRecord.title}"
            </p>
            <p style={{ fontSize: '13px', color: '#52525b' }}>
              Upload flow coming soon — Dropbox integration in progress
            </p>
            <button
              onClick={() => setUploadRecord(null)}
              style={{
                marginTop: '20px',
                padding: '8px 24px',
                background: '#222',
                color: '#d4d4d8',
                border: '1px solid #333',
                borderRadius: '8px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
