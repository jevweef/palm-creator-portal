'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import Link from 'next/link'
import CaptionSuggestions from '@/components/CaptionSuggestions'

// ─── Lazy-loaded Creator DNA Modal ────────────────────────────────────────────

function CreatorDnaModal({ creatorId, creatorName, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/editor/creator/${creatorId}/dna`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [creatorId])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '560px',
        maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)' }}>{creatorName}</div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>Creator DNA</div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
            cursor: 'pointer', fontSize: '14px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
        <div style={{ padding: '20px 28px 28px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--foreground-muted)', padding: '20px', fontSize: '13px' }}>Loading...</div>
          ) : !data ? (
            <div style={{ textAlign: 'center', color: 'var(--foreground-muted)', padding: '20px', fontSize: '13px' }}>No profile data</div>
          ) : (
            <>
              {data.profileSummary && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Profile</div>
                  <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: '1.6' }}>{data.profileSummary}</div>
                </div>
              )}
              {data.contentDirectionNotes && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Content Direction</div>
                  <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: '1.6' }}>{data.contentDirectionNotes}</div>
                </div>
              )}
              {data.dosDonts && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Do / Don't</div>
                  <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: '1.7', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: 'var(--card-bg-solid)', borderRadius: '10px', padding: '10px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>{data.dosDonts}</div>
                </div>
              )}
              {data.topTags?.length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Top Tags</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {data.topTags.map(tw => (
                      <span key={tw.tag} style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: 'rgba(232, 160, 160, 0.05)', color: 'var(--palm-pink)', border: '1px solid transparent' }}>
                        {tw.tag} · {tw.weight}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Library helpers ───────────────────────────────────────────────────────────

export function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}
export function isVideo(url) { return !!url && /\.(mp4|mov|avi|webm|mkv)/i.test(url) }
export function isPhoto(url) { return !!url && /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i.test(url) }

export const LIB_PAGE_SIZE = 15

export function LibraryCard({ asset, onAssign, assigning, forcePhoto = false }) {
  const link = asset.dropboxLinks?.[0] || asset.dropboxLink || ''
  const rawUrl = rawDropboxUrl(link)
  const videoFile = !forcePhoto && isVideo(link)
  const photoFile = forcePhoto || isPhoto(link)

  return (
    <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', aspectRatio: videoFile ? '9/16' : '3/4', maxHeight: '320px', overflow: 'hidden', background: 'var(--background)' }}>
        {videoFile && rawUrl ? (
          <video src={rawUrl} autoPlay muted loop playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
        ) : photoFile && rawUrl ? (
          <img src={rawUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : asset.thumbnail ? (
          <img src={asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--card-border)', fontSize: '28px' }}>&#127916;</div>
        )}
        {asset.uploadWeek && (
          <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.75)', color: 'var(--foreground-muted)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>
            {asset.uploadWeek}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        {asset.name && (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</div>
        )}
        {asset.creatorNotes && (
          <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', lineHeight: 1.3 }}>{asset.creatorNotes}</div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{ textAlign: 'center', padding: '6px', fontSize: '11px', fontWeight: 600, background: 'rgba(232, 160, 160, 0.05)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '6px', textDecoration: 'none' }}>
              View ↗
            </a>
          )}
          <button onClick={() => onAssign(asset)} disabled={!!assigning}
            style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 700, background: assigning === asset.id ? 'rgba(232, 160, 160, 0.05)' : 'rgba(232, 160, 160, 0.05)', color: assigning === asset.id ? 'rgba(212, 160, 176, 0.3)' : 'var(--palm-pink)', border: '1px solid transparent', borderRadius: '6px', cursor: assigning ? 'default' : 'pointer', opacity: assigning && assigning !== asset.id ? 0.5 : 1 }}>
            {assigning === asset.id ? 'Starting…' : 'Start Edit'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LibPickerPaginator({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <button onClick={() => onChange(page - 1)} disabled={page <= 1}
        style={{ background: 'none', border: '1px solid transparent', borderRadius: '6px', color: page <= 1 ? 'var(--card-border)' : '#999', fontSize: '13px', cursor: page <= 1 ? 'default' : 'pointer', padding: '3px 10px' }}>‹</button>
      <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{page} / {totalPages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
        style={{ background: 'none', border: '1px solid transparent', borderRadius: '6px', color: page >= totalPages ? 'var(--card-border)' : '#999', fontSize: '13px', cursor: page >= totalPages ? 'default' : 'pointer', padding: '3px 10px' }}>›</button>
    </div>
  )
}

// ─── Slot label helper ─────────────────────────────────────────────────────────
// 11 AM ET = Morning Post, 7 PM ET = Evening Post (DST-aware)
function getETHour(isoDateString) {
  if (!isoDateString) return -1
  return parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(isoDateString)))
}

export function getSlotLabel(isoDateString) {
  if (!isoDateString) return ''
  const etHour = getETHour(isoDateString)
  if (etHour === 11) return 'Morning Post'
  if (etHour === 19) return 'Evening Post'
  return new Date(isoDateString).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: 'America/New_York' })
}

// ─── Quota dots ────────────────────────────────────────────────────────────────

export function QuotaDots({ slotColors, quota, done }) {
  const unlitColor = 'rgba(255,255,255,0.12)'
  const dividerColor = 'rgba(255,255,255,0.06)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
        {Array.from({ length: quota }).map((_, i) => {
          const raw = slotColors?.[i]
          const lit = raw && raw !== 'var(--card-border)'
          const color = lit ? raw : unlitColor
          const isNewDay = i > 0 && i % 2 === 0
          return (
            <div key={i} style={{ display: 'contents' }}>
              {isNewDay && <div style={{ width: '1px', height: '8px', background: dividerColor, flexShrink: 0 }} />}
              <div style={{
                width: '11px', height: '11px', borderRadius: '50%', flexShrink: 0,
                background: color,
                border: `1.5px solid ${color}`,
                transition: 'all 0.2s',
              }} />
            </div>
          )
        })}
      </div>
      <span style={{ fontSize: '12px', color: done >= quota ? '#7DD3A4' : 'var(--foreground-muted)', fontWeight: 500, flexShrink: 0 }}>
        {done}/{quota}
      </span>
    </div>
  )
}

// ─── Section label ─────────────────────────────────────────────────────────────

const SECTION = {
  needsRevision: { dot: '#E87878', label: 'Needs Revision' },
  queue:         { dot: 'var(--palm-pink)', label: 'Ready to Edit' },
  inProgress:    { dot: '#78B4E8', label: 'In Editing' },
  inReview:      { dot: '#7DD3A4', label: 'Sent for Review' },
}

export function SectionLabel({ type, count }) {
  const s = SECTION[type]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
      <span style={{ fontSize: '11px', fontWeight: 700, color: s.dot, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {s.label}
      </span>
      <span style={{ fontSize: '11px', color: 'var(--foreground-subtle)', fontWeight: 500 }}>({count})</span>
    </div>
  )
}

// ─── Upload / Submit Modal ─────────────────────────────────────────────────────

export function SubmitModal({ task, creatorName, creatorId, isRevision, onClose, onSubmit }) {
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
        body: JSON.stringify({ taskId: task.id, creatorId }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId, uploadFolder } = await tokenRes.json()
      const exportFolder = uploadFolder

      const titleSlug = (task.inspo.title || 'edit').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50)
      const creatorSlug = (creatorName || 'creator').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
      const suffix = isRevision ? 'REVISION' : 'EDITED'
      const fileName = `${titleSlug}_${creatorSlug}_${suffix}_${timestamp}.${ext}`

      setProgress(`Uploading ${fileName}...`)
      const buffer = await file.arrayBuffer()
      const filePath = `${exportFolder}/${fileName}`
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

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
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed: ${await dbxRes.text()}`)
      const result = await dbxRes.json()

      setProgress('Creating share link...')
      let sharedLink = ''
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: result.path_display }),
        })
        if (linkRes.ok) {
          sharedLink = (await linkRes.json()).url || ''
        } else if (linkRes.status === 409) {
          // Link already exists — fetch it
          const existRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: result.path_display, direct_only: true }),
          })
          if (existRes.ok) sharedLink = (await existRes.json()).links?.[0]?.url || ''
        }
      } catch {}
      if (!sharedLink) console.warn('[SubmitModal] Failed to create share link for', result.path_display)

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
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}
    >
      <div
        style={{ background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '16px', padding: '28px', width: '460px', maxWidth: '95vw' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--foreground)', margin: '0 0 4px' }}>
          {isRevision ? 'Upload Revision' : 'Submit Edit for Review'}
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '20px' }}>
          {task.inspo.title || task.name} · {creatorName}
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
          onDragOver={e => e.preventDefault()}
          style={{
            border: `2px dashed ${file ? '#7DD3A4' : 'var(--card-border)'}`, borderRadius: '10px',
            padding: '28px', textAlign: 'center', cursor: 'pointer',
            background: file ? 'rgba(125, 211, 164, 0.08)' : 'transparent',
          }}
        >
          {file ? (
            <>
              <div style={{ fontSize: '13px', color: '#7DD3A4', fontWeight: 600 }}>{file.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB · click to change
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Drop video here or click to browse</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '4px' }}>MP4, MOV</div>
            </>
          )}
          <input ref={fileRef} type="file" accept="video/*,.mp4,.mov" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
        </div>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes for reviewer (optional)"
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

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '9px 18px', border: 'none', borderRadius: '8px', color: 'var(--foreground)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', background: 'var(--card-border)' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!file || uploading}
            style={{
              padding: '9px 22px', border: 'none', borderRadius: '8px', color: 'var(--foreground)', fontSize: '13px', fontWeight: 600,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
              background: !file || uploading ? 'var(--card-border)' : isRevision ? '#E87878' : 'var(--palm-pink)',
              opacity: uploading ? 0.6 : 1,
            }}>
            {uploading ? 'Uploading...' : isRevision ? 'Submit Revision' : 'Submit for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Task card ─────────────────────────────────────────────────────────────────

export function TaskCard({ task, type, creatorName, onAction, updating }) {
  const [expanded, setExpanded] = useState(false)
  const borderColors = {
    needsRevision: '#f5c6c6',
    queue:         'var(--card-border)',
    inProgress:    'rgba(120, 180, 232, 0.2)',
    inReview:      'rgba(125, 211, 164, 0.2)',
  }

  return (
    <div style={{
      background: 'var(--background)', border: `1px solid ${borderColors[type]}`, borderRadius: '12px',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Thumbnail strip: inspo → creator clip */}
      <div style={{ display: 'flex', height: '155px', background: 'var(--background)' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.inspo.thumbnail ? (
            <img src={task.inspo.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--card-border)', fontSize: '11px' }}>No thumbnail</div>
          )}
          <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', color: 'var(--palm-pink)', fontWeight: 700, letterSpacing: '0.06em' }}>
            INSPO
          </div>
        </div>

        <div style={{ width: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--card-border)', fontSize: '13px', flexShrink: 0 }}>→</div>

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {task.asset.dropboxLink ? (
            <a href={task.asset.dropboxLinks?.[0] || task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', width: '100%', height: '100%', textDecoration: 'none' }}>
              {task.asset.thumbnail ? (
                <img src={task.asset.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(125, 211, 164, 0.08)', gap: '4px' }}>
                  <svg style={{ width: '24px', height: '24px', color: '#7DD3A4' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span style={{ fontSize: '10px', color: '#7DD3A4', fontWeight: 600 }}>Download</span>
                </div>
              )}
            </a>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--card-border)', fontSize: '11px' }}>No clip yet</div>
          )}
          <div style={{ position: 'absolute', bottom: '6px', left: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', color: '#7DD3A4', fontWeight: 700, letterSpacing: '0.06em' }}>
            CLIP
          </div>
          {task.asset.dropboxLinks?.length > 1 && (
            <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.8)', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', color: '#E8C878', fontWeight: 600 }}>
              {task.asset.dropboxLinks.length} clips
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.3 }}>
            {task.inspo.title || task.name || 'Untitled'}
          </div>
          {task.inspo.username && (
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>@{task.inspo.username}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {task.inspo.contentLink && (
            <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none', padding: '2px 8px', background: 'rgba(232, 160, 160, 0.05)', borderRadius: '4px', border: '1px solid transparent' }}>
              Original ↗
            </a>
          )}
          {task.asset.dropboxLinks?.length > 1
            ? task.asset.dropboxLinks.map((link, i) => (
                <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#7DD3A4', textDecoration: 'none', padding: '2px 8px', background: 'rgba(125, 211, 164, 0.08)', borderRadius: '4px', border: '1px solid transparent' }}>
                  Clip {i + 1} ↗
                </a>
              ))
            : task.asset.dropboxLink ? (
                <a href={task.asset.dropboxLink} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#7DD3A4', textDecoration: 'none', padding: '2px 8px', background: 'rgba(125, 211, 164, 0.08)', borderRadius: '4px', border: '1px solid transparent' }}>
                  Creator Clips ↗
                </a>
              ) : null
          }
        </div>

        {type === 'needsRevision' && task.adminFeedback && (
          <div style={{ background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '10px', color: '#E87878', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
              Feedback from reviewer
            </div>
            <div style={{ fontSize: '12px', color: '#E87878', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {task.adminFeedback}
            </div>
            {task.adminScreenshots?.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                {task.adminScreenshots.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', width: '56px', height: '56px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #fecaca', flexShrink: 0 }}>
                    <img src={url} alt={`Screenshot ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {(task.creatorNotes || task.asset.creatorNotes) && (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600, color: 'var(--foreground-subtle)' }}>Creator: </span>
            {task.creatorNotes || task.asset.creatorNotes}
          </div>
        )}

        {task.inspo.notes && (
          <button onClick={() => setExpanded(p => !p)}
            style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', fontSize: '11px', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
            {expanded ? '▾ Hide direction' : '▸ View direction'}
          </button>
        )}

        {expanded && (
          <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{task.inspo.notes}</div>
            {task.inspo.onScreenText && (
              <div style={{ fontSize: '11px', color: '#E8C878', background: 'rgba(232, 200, 120, 0.08)', border: '1px solid #fde68a', borderRadius: '4px', padding: '6px 8px' }}>
                "{task.inspo.onScreenText}"
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
          {type === 'queue' && (
            <button onClick={() => onAction('startEditing', task)} disabled={updating}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid transparent', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
              {updating ? 'Starting...' : 'Start Editing'}
            </button>
          )}
          {type === 'inProgress' && (
            <button onClick={() => onAction('submit', task)}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: 'rgba(232, 160, 160, 0.05)', color: 'var(--palm-pink)', border: '1px solid transparent', borderRadius: '8px', cursor: 'pointer' }}>
              Submit for Review
            </button>
          )}
          {type === 'needsRevision' && (
            <button onClick={() => onAction('revision', task)}
              style={{ width: '100%', padding: '9px', fontSize: '13px', fontWeight: 600, background: 'rgba(232, 120, 120, 0.06)', color: '#E87878', border: '1px solid #ef4444', borderRadius: '8px', cursor: 'pointer' }}>
              Upload Revision
            </button>
          )}
          {type === 'inReview' && (
            <div style={{ textAlign: 'center', padding: '9px', fontSize: '12px', color: '#7DD3A4', background: 'rgba(125, 211, 164, 0.08)', border: '1px solid transparent', borderRadius: '8px' }}>
              Submitted · Awaiting review
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Library Picker Modal (for empty slots) ────────────────────────────────────

function LibraryPickerModal({ creator, onClose, onRefresh, onTaskCreated }) {
  const [library, setLibrary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  const [err, setErr] = useState('')
  const [activeTab, setActiveTab] = useState('videos')
  const [page, setPage] = useState(1)
  const [sortOrder, setSortOrder] = useState('newest')

  useEffect(() => {
    fetch(`/api/editor/creator/${creator.id}`)
      .then(r => r.json())
      .then(d => { setLibrary(d.library || []); setLoading(false) })
      .catch(() => { setErr('Failed to load library'); setLoading(false) })
  }, [creator.id])

  const handleAssign = async (asset) => {
    setAssigning(asset.id)
    setErr('')
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, creatorId: creator.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (onTaskCreated) {
        onTaskCreated(data.taskId, asset)
      } else {
        await onRefresh()
        onClose()
      }
    } catch (e) {
      setErr(e.message)
      setAssigning(null)
    }
  }

  const sortedLibrary = library ? [...library].sort((a, b) => {
    const da = new Date(a.createdTime || a.createdAt || 0), db = new Date(b.createdTime || b.createdAt || 0)
    return sortOrder === 'newest' ? db - da : da - db
  }) : []
  const videos = sortedLibrary.filter(a => a.assetType === 'Video' || (!a.assetType && isVideo(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const photos = sortedLibrary.filter(a => a.assetType === 'Photo' || a.assetType === 'Image' || (!a.assetType && isPhoto(a.dropboxLinks?.[0] || a.dropboxLink || '')))
  const tabs = [
    { key: 'videos', label: 'Videos', count: videos.length },
    { key: 'photos', label: 'Photos', count: photos.length },
  ].filter(t => t.count > 0)
  const shown = activeTab === 'videos' ? videos : photos
  const totalPages = Math.ceil(shown.length / LIB_PAGE_SIZE)
  const paged = shown.slice((page - 1) * LIB_PAGE_SIZE, page * LIB_PAGE_SIZE)

  const switchTab = key => { setActiveTab(key); setPage(1) }

  return (
    <div className="lib-picker-overlay" style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Mobile overrides: tighter padding + 2-column grid on narrow viewports.
          Desktop behavior is unchanged (modal stays padded, grid flows wider). */}
      <style>{`
        @media (max-width: 640px) {
          .lib-picker-overlay { padding: 8px !important; }
          .lib-picker-header { padding: 12px 14px 10px !important; flex-wrap: wrap !important; gap: 8px !important; }
          .lib-picker-body { padding: 12px 12px !important; }
          .lib-picker-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; }
        }
      `}</style>
      <div style={{ background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '16px', width: '100%', maxWidth: '1100px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="lib-picker-header" style={{ padding: '20px 28px 16px', borderBottom: '1px solid transparent', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)' }}>Unreviewed Library</div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>{creator.name}</div>
          </div>
          {tabs.length > 1 && !loading && (
            <div style={{ display: 'flex', gap: '4px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '3px' }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => switchTab(t.key)}
                  style={{ padding: '4px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: activeTab === t.key ? 'rgba(232, 160, 160, 0.05)' : 'transparent',
                    color: activeTab === t.key ? 'rgba(240, 236, 232, 0.85)' : '#999' }}>
                  {t.label} <span style={{ color: activeTab === t.key ? '#999' : '#aaa', fontWeight: 400 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && (
            <div style={{ display: 'flex', gap: '4px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '3px' }}>
              {[{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }].map(s => (
                <button key={s.key} onClick={() => { setSortOrder(s.key); setPage(1) }}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: sortOrder === s.key ? 'rgba(232, 160, 160, 0.05)' : 'transparent',
                    color: sortOrder === s.key ? 'rgba(240, 236, 232, 0.85)' : '#999' }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {!loading && totalPages > 1 && (
            <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div className="lib-picker-body" style={{ overflowY: 'auto', padding: '20px 28px', flex: 1 }}>
          {loading && <div style={{ color: 'var(--foreground-muted)', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>Loading library…</div>}
          {err && <div style={{ color: '#E87878', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>{err}</div>}
          {!loading && !err && library?.length === 0 && (
            <div style={{ color: 'var(--foreground-subtle)', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>No unreviewed clips found for {creator.name}.</div>
          )}
          {!loading && paged.length > 0 && (
            <div className="lib-picker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
              {paged.map(asset => (
                <LibraryCard key={asset.id} asset={asset} onAssign={handleAssign} assigning={assigning} forcePhoto={activeTab === 'photos'} />
              ))}
            </div>
          )}
          {!loading && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
              <LibPickerPaginator page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Task Detail Modal ─────────────────────────────────────────────────────────

function MediaPanel({ label, link, rawUrl, fallbackThumb, accentColor = '#999' }) {
  const videoSrc = rawUrl && isVideo(link) ? rawUrl : null
  const photoSrc = rawUrl && isPhoto(link) ? rawUrl : null
  const [copied, setCopied] = useState(false)

  const filename = (() => {
    if (!link) return ''
    try {
      const pathname = new URL(link).pathname
      return decodeURIComponent(pathname.split('/').pop() || '')
    } catch { return '' }
  })()

  const copyFilename = async (e) => {
    e.preventDefault()
    if (!filename) return
    await navigator.clipboard.writeText(filename)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: 'var(--background)', aspectRatio: '9/16', flex: 1 }}>
        {videoSrc ? (
          <video src={videoSrc} autoPlay muted loop playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
        ) : photoSrc ? (
          <img src={photoSrc} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : fallbackThumb ? (
          <img src={fallbackThumb} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--card-border)', fontSize: '32px' }}>&#127916;</div>
        )}
      </div>
      {link && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <a href={link} target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, display: 'block', textAlign: 'center', padding: '7px', fontSize: '12px', fontWeight: 600, background: 'rgba(255,255,255,0.04)', color: accentColor, border: 'none', borderRadius: '7px', textDecoration: 'none' }}>
            Open ↗
          </a>
          {filename && (
            <button onClick={copyFilename}
              style={{ padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: copied ? 'rgba(125, 211, 164, 0.08)' : 'var(--background)', color: copied ? '#7DD3A4' : '#999', border: `1px solid ${copied ? 'rgba(125, 211, 164, 0.2)' : 'var(--card-border)'}`, borderRadius: '7px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
              {copied ? '✓' : 'Copy Name'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Shared track list for music sections ─────────────────────────────────────

function TrackList({ tracks, playingPreview, setPlayingPreview, downloading, handleDownload }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '500px', overflowY: 'auto' }}>
      {tracks.map((track, i) => (
        <div key={track.spotifyId || i}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
            borderRadius: '4px', background: i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'transparent', fontSize: '11px',
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
                style={{ padding: '2px 6px', fontSize: '10px', background: playingPreview === track.spotifyId ? '#A78BFA' : 'rgba(255,255,255,0.04)', color: playingPreview === track.spotifyId ? 'rgba(255,255,255,0.08)' : '#888', border: 'none', borderRadius: '3px', cursor: 'pointer', flexShrink: 0 }}>
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
  )
}

// ─── Music Section (identify + radio, used inside task detail modal) ─────────

function MusicSection({ creatorId, creatorName, videoUrl, inspoId, hasPlaylist }) {
  const [identifying, setIdentifying] = useState(false)
  const [identifiedSong, setIdentifiedSong] = useState(null)
  const [suggestions, setSuggestions] = useState(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [playingPreview, setPlayingPreview] = useState(null)
  const [error, setError] = useState('')
  const audioRef = useRef(null)
  const [musicTab, setMusicTab] = useState('creator') // 'creator' | 'top50' | 'billboard'
  const [top50, setTop50] = useState(null)
  const [loadingTop50, setLoadingTop50] = useState(false)
  const [billboard, setBillboard] = useState(null)
  const [loadingBillboard, setLoadingBillboard] = useState(false)
  const [usedSongIds, setUsedSongIds] = useState(new Set())
  const [collapsed, setCollapsed] = useState(false)

  // Fetch songs used by this creator in last 14 days
  useEffect(() => {
    if (!creatorId) return
    fetch(`/api/admin/music/usage?creatorId=${creatorId}`)
      .then(r => r.json())
      .then(d => { if (d.usedIds) setUsedSongIds(new Set(d.usedIds)) })
      .catch(() => {})
  }, [creatorId])

  const filterUsed = (tracks) => tracks?.filter(t => !t.spotifyId || !usedSongIds.has(t.spotifyId)) || []

  const fetchTop50 = async () => {
    if (top50) return
    setLoadingTop50(true)
    try {
      const res = await fetch('/api/admin/music/charts')
      const data = await res.json()
      if (res.ok) setTop50(data.tracks || [])
      else setError(data.error || 'Failed to load charts')
    } catch (e) { setError(e.message) }
    finally { setLoadingTop50(false) }
  }

  const fetchBillboard = async () => {
    if (billboard) return
    setLoadingBillboard(true)
    try {
      const res = await fetch('/api/admin/music/billboard')
      const data = await res.json()
      if (res.ok) setBillboard(data.tracks || [])
      else setError(data.error || 'Failed to load Billboard')
    } catch (e) { setError(e.message) }
    finally { setLoadingBillboard(false) }
  }

  async function handleIdentify() {
    if (!videoUrl) { setError('No video URL available'); return }
    setIdentifying(true)
    setError('')
    try {
      const res = await fetch('/api/admin/music/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspoId: inspoId || 'temp', videoUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Identification failed')
      if (data.match) {
        setIdentifiedSong(data.song)
      } else {
        setError('No song match found in this clip')
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
      const body = { creatorId }
      if (inspoId) body.inspoId = inspoId
      const res = await fetch('/api/admin/music/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          // Copy Spotify URL to clipboard so user can paste in spotdown
          if (data.links?.spotify) {
            await navigator.clipboard?.writeText(data.links.spotify).catch(() => {})
            setError('URL copied — paste in spotdown (Cmd+V)')
            setTimeout(() => setError(''), 4000)
          }
          window.open(data.links?.spotdown || 'https://spotdown.org', '_blank')
        }
      }
      // Log song as used for this creator (14-day cooldown)
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
    <div style={{ background: 'var(--card-bg-solid)', border: 'none', borderRadius: '12px', padding: '12px 14px' }}>
      <div
        onClick={() => {
          if (!collapsed && audioRef.current) { audioRef.current.pause(); setPlayingPreview(null) }
          setCollapsed(!collapsed)
        }}
        style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: collapsed ? 0 : '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
        <span>Music</span>
        <span style={{ fontSize: '12px', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </div>

      {!collapsed && (<>

      {/* Identify button */}
      {videoUrl && !identifiedSong && (
        <div style={{ marginBottom: '8px' }}>
          <button onClick={handleIdentify} disabled={identifying}
            style={{ width: '100%', padding: '8px 10px', fontSize: '11px', fontWeight: 600, background: identifying ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.04)', color: identifying ? 'var(--foreground-muted)' : 'var(--foreground)', border: 'none', borderRadius: '6px', cursor: identifying ? 'default' : 'pointer' }}>
            {identifying ? 'Identifying...' : 'Identify Song'}
          </button>
        </div>
      )}

      {/* Identified song */}
      {identifiedSong && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '6px 8px', background: 'var(--card-bg-solid)', borderRadius: '6px', border: '1px solid transparent' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>{identifiedSong.title}</div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{identifiedSong.artist}</div>
          </div>
          {identifiedSong.spotifyUrl && (
            <a href={identifiedSong.spotifyUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '10px', color: '#1DB954', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>
              Spotify ↗
            </a>
          )}
        </div>
      )}

      {/* Music tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: '10px' }}>
        {[
          { key: 'creator', label: `For ${creatorName?.split(' ')[0] || 'Creator'}`, onClick: () => { if (!suggestions && hasPlaylist) handleGetSuggestions() } },
          { key: 'top50', label: 'TikTok', onClick: fetchTop50 },
          { key: 'billboard', label: 'Billboard', onClick: fetchBillboard },
        ].map(tab => (
          <button key={tab.key} onClick={() => { setMusicTab(tab.key); tab.onClick() }}
            style={{ flex: 1, padding: '6px 6px', fontSize: '10px', fontWeight: musicTab === tab.key ? 600 : 400, letterSpacing: '0.04em', color: musicTab === tab.key ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: musicTab === tab.key ? '1px solid var(--palm-pink)' : '1px solid transparent', cursor: 'pointer', marginBottom: '-1px' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Creator suggestions tab */}
      {musicTab === 'creator' && (
        <>
          {!hasPlaylist ? (
            <div style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '6px' }}>No Music DNA playlist uploaded for this creator</div>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#A78BFA', background: 'rgba(167, 139, 250, 0.1)', padding: '4px 10px', borderRadius: '4px' }}>Need Playlist</span>
            </div>
          ) : !suggestions ? (
            <button onClick={handleGetSuggestions} disabled={loadingSuggestions}
              style={{ width: '100%', padding: '8px 10px', fontSize: '11px', fontWeight: 600, background: loadingSuggestions ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.04)', color: loadingSuggestions ? 'var(--foreground-muted)' : 'var(--foreground)', border: 'none', borderRadius: '6px', cursor: loadingSuggestions ? 'default' : 'pointer' }}>
              {loadingSuggestions ? 'Loading...' : 'Load Music Radio'}
            </button>
          ) : suggestions.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>No suggestions found.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                <button onClick={() => { setSuggestions(null); handleGetSuggestions() }} disabled={loadingSuggestions}
                  style={{ fontSize: '9px', color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', opacity: loadingSuggestions ? 0.5 : 1 }}>
                  {loadingSuggestions ? 'Loading...' : '↻ Refresh'}
                </button>
              </div>
              <TrackList tracks={filterUsed(suggestions)} playingPreview={playingPreview} setPlayingPreview={setPlayingPreview} downloading={downloading} handleDownload={handleDownload} />
            </>
          )}
        </>
      )}

      {/* TikTok tab */}
      {musicTab === 'top50' && (
        loadingTop50 ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', textAlign: 'center', padding: '12px' }}>Loading chart...</div>
        ) : top50 && top50.length > 0 ? (
          <TrackList tracks={filterUsed(top50)} playingPreview={playingPreview} setPlayingPreview={setPlayingPreview} downloading={downloading} handleDownload={handleDownload} />
        ) : top50 && top50.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>No chart data available.</div>
        ) : null
      )}

      {/* Billboard tab */}
      {musicTab === 'billboard' && (
        loadingBillboard ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', textAlign: 'center', padding: '12px' }}>Loading chart...</div>
        ) : billboard && billboard.length > 0 ? (
          <TrackList tracks={filterUsed(billboard)} playingPreview={playingPreview} setPlayingPreview={setPlayingPreview} downloading={downloading} handleDownload={handleDownload} />
        ) : billboard && billboard.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>No chart data available.</div>
        ) : null
      )}

      {error && <div style={{ fontSize: '11px', color: '#E87878', marginTop: '4px' }}>{error}</div>}

      </>)}
    </div>
  )
}

function TaskDetailModal({ slot, creator, onAction, onInspoClipStart, updating, onClose, onSaved, onRefresh }) {
  const task = slot.task || null
  const clip = slot.clip || null
  const isClip = slot.type === 'inspoClip'
  const [starting, setStarting] = useState(false)
  const [startErr, setStartErr] = useState('')

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const handleCancelEdit = async () => {
    setCancelling(true)
    try {
      const res = await fetch('/api/editor/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task?.id, assetId: task?.asset?.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onClose()
      onRefresh?.()
    } catch (err) {
      setCancelling(false)
      setConfirmCancel(false)
    }
  }

  // Editor submit tool state
  const [editorTab, setEditorTab] = useState('upload') // 'upload' | 'asis'
  const [uploadUrl, setUploadUrl] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef(null)

  const inspo = task?.inspo || clip?.inspo || {}
  const assetLink = task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || clip?.dropboxLink || ''
  const assetRawUrl = rawDropboxUrl(assetLink)
  const inspoLink = inspo.dbShareLink || inspo.contentLink || ''
  const inspoRawUrl = inspo.dbShareLink ? rawDropboxUrl(inspo.dbShareLink) : ''
  const editedLink = task?.asset?.editedFileLink || ''
  const editedRawUrl = rawDropboxUrl(editedLink)

  // Compute actual status badge from task data
  const adminStatus = task?.adminReviewStatus || ''
  const statusBadge = adminStatus === 'Approved'
    ? { label: 'Approved', color: '#7DD3A4', bg: 'rgba(125, 211, 164, 0.08)', border: 'rgba(125, 211, 164, 0.2)' }
    : adminStatus === 'Pending Review'
    ? { label: 'In Review', color: '#7DD3A4', bg: 'rgba(125, 211, 164, 0.08)', border: 'rgba(125, 211, 164, 0.2)' }
    : adminStatus === 'Needs Revision'
    ? { label: 'Needs Revision', color: '#E87878', bg: 'rgba(232, 120, 120, 0.06)', border: 'rgba(232, 120, 120, 0.2)' }
    : null

  const handleClipStart = async () => {
    setStarting(true)
    setStartErr('')
    try {
      await onInspoClipStart(clip)
      onClose()
    } catch (err) {
      setStartErr(err.message)
      setStarting(false)
    }
  }

  const handleFileUpload = async (file) => {
    if (!file) return
    setUploadProgress('Preparing upload...')
    setUploadError('')
    try {
      const tokenRes = await fetch('/api/editor-upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator?.id }),
      })
      if (!tokenRes.ok) throw new Error('Failed to get upload credentials')
      const { accessToken, rootNamespaceId, uploadFolder } = await tokenRes.json()

      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp4'
      const taskSlug = (task?.name || 'edit').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40)
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const fileName = `${taskSlug}_EDITED_${timestamp}.${ext}`
      const filePath = `${uploadFolder}/${fileName}`

      setUploadProgress(`Uploading ${fileName}...`)
      const buffer = await file.arrayBuffer()
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })

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
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed: ${await dbxRes.text()}`)
      const result = await dbxRes.json()

      setUploadProgress('Creating share link...')
      let sharedLink = ''
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Path-Root': pathRoot, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: result.path_display }),
        })
        if (linkRes.ok) sharedLink = (await linkRes.json()).url || ''
      } catch {}

      await handleSave(sharedLink || filePath)
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploadProgress('')
    }
  }

  const handleSave = async (url) => {
    if (!url) return
    setSaving(true)
    setSaveErr('')
    try {
      const res = await fetch('/api/editor/save-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: task?.asset?.id || null,
          taskId: task?.id || null,
          editedFileLink: url,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setSaved(true)
      setTimeout(() => {
        if (onSaved) onSaved(task)
        else onClose()
      }, 1200)
    } catch (err) {
      setSaveErr(err.message)
    } finally {
      setSaving(false)
    }
  }

  const title = inspo.title || task?.name || clip?.inspo?.title || 'Edit task'
  const username = inspo.username || ''
  const creatorNotes = task?.asset?.creatorNotes || clip?.creatorNotes || task?.creatorNotes || ''

  return (
    <div className="editor-task-modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '24px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Mobile-only modal overrides */}
      <style>{`
        @media (max-width: 768px) {
          .editor-task-modal-backdrop { padding: 0 !important; align-items: stretch !important; }
          .editor-task-modal-shell {
            max-width: 100% !important; max-height: 100vh !important;
            border-radius: 0 !important; height: 100vh !important;
          }
          .editor-task-modal-body { flex-direction: column !important; overflow-y: auto !important; }
          .editor-task-modal-left {
            width: 100% !important; border-right: none !important;
            border-bottom: 1px solid #F0D0D8 !important;
            padding: 12px !important;
            max-height: 45vh;
            flex-shrink: 0;
          }
          .editor-task-modal-right { padding: 14px !important; }
          .editor-task-modal-header { padding: 12px 14px !important; }
          .editor-task-modal-header > div:first-child > div:first-child > div:first-child { font-size: 14px !important; }
        }
      `}</style>
      <div className="editor-task-modal-shell" style={{ background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '16px', width: '100%', maxWidth: '1050px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header bar */}
        <div className="editor-task-modal-header" style={{ padding: '16px 24px', borderBottom: '1px solid transparent', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
              {creator?.name && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--palm-pink)', background: 'rgba(232, 160, 160, 0.05)', border: '1px solid transparent', borderRadius: '4px', padding: '2px 8px', flexShrink: 0 }}>
                  {creator.name}
                </span>
              )}
            </div>
            {username && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>@{username}</div>}
          </div>
          {statusBadge && (
            <span style={{ fontSize: '11px', fontWeight: 700, color: statusBadge.color, background: statusBadge.bg, border: `1px solid ${statusBadge.border}`, borderRadius: '4px', padding: '3px 10px', flexShrink: 0 }}>{statusBadge.label}</span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '22px', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Body — two columns */}
        <div className="editor-task-modal-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* LEFT — media panels */}
          <div className="editor-task-modal-left" style={{ width: '50%', padding: '20px', borderRight: '1px solid transparent', display: 'flex', gap: '12px', overflow: 'hidden' }}>
            {editedLink ? (
              <>
                <MediaPanel
                  label="Submitted Edit"
                  link={editedLink}
                  rawUrl={editedRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || ''}
                  accentColor="#E88FAC"
                />
                <MediaPanel
                  label="Raw Clip"
                  link={assetLink}
                  rawUrl={assetRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || clip?.thumbnail || ''}
                  accentColor="#999"
                />
              </>
            ) : (
              <>
                <MediaPanel
                  label={isClip ? 'Creator Upload' : 'Creator Clip'}
                  link={assetLink}
                  rawUrl={assetRawUrl}
                  fallbackThumb={task?.asset?.thumbnail || clip?.thumbnail || ''}
                  accentColor="#22c55e"
                />
                <MediaPanel
                  label="Inspo"
                  link={inspoLink}
                  rawUrl={inspoRawUrl}
                  fallbackThumb={inspo.thumbnail || ''}
                  accentColor="#E88FAC"
                />
              </>
            )}
          </div>

          {/* RIGHT — info + action */}
          <div className="editor-task-modal-right" style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>

            {/* Admin feedback */}
            {task?.adminFeedback && (
              <div style={{ background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#E87878', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>Admin Feedback</div>
                <div style={{ fontSize: '12px', color: '#E87878', lineHeight: 1.5 }}>{task.adminFeedback}</div>
              </div>
            )}

            {/* Admin screenshots */}
            {task?.adminScreenshots?.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Reference Screenshots</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {task.adminScreenshots.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', flexShrink: 0 }}>
                      <img src={url} alt={`Screenshot ${i + 1}`} style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Direction */}
            {inspo.notes && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Direction</div>
                <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: 1.6, background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '10px 12px', whiteSpace: 'pre-wrap' }}>
                  {inspo.notes}
                </div>
              </div>
            )}

            {/* On-screen text */}
            {inspo.onScreenText && (
              <div style={{ background: 'rgba(232, 200, 120, 0.08)', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#E8C878', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>On-Screen Text</div>
                <div style={{ fontSize: '12px', color: '#92400e' }}>"{inspo.onScreenText}"</div>
              </div>
            )}

            {/* Creator notes */}
            {creatorNotes && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Creator Notes</div>
                <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.5, background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '10px 12px' }}>
                  {creatorNotes}
                </div>
              </div>
            )}

            {/* Tags */}
            {inspo.tags?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {inspo.tags.map(tag => (
                  <span key={tag} style={{ fontSize: '11px', color: 'var(--foreground-muted)', background: 'var(--background)', border: '1px solid transparent', borderRadius: '4px', padding: '2px 8px' }}>{tag}</span>
                ))}
              </div>
            )}

            {/* Music section */}
            {creator?.id && (
              <MusicSection
                creatorId={creator.id}
                creatorName={creator.name}
                videoUrl={task?.asset?.dropboxLink || clip?.dropboxLink || ''}
                inspoId={task?.inspo?.id || null}
                hasPlaylist={creator.hasPlaylist}
              />
            )}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Action button */}
            {slot.type === 'toDo' && (
              <button onClick={() => onAction('startEditing', task)} disabled={updating}
                style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid transparent', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', opacity: updating ? 0.6 : 1 }}>
                {updating ? 'Starting...' : 'Start Editing →'}
              </button>
            )}
            {slot.type === 'inProgress' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* AI Caption Suggestions — brainstorm, copy to your editor of choice */}
                <CaptionSuggestions
                  thumbnailUrl={task?.asset?.thumbnail}
                  videoUrl={assetRawUrl}
                  creatorId={creator?.id}
                />

                {/* Tab switcher */}
                <div style={{ display: 'flex', background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '3px', gap: '3px' }}>
                  {['upload', 'asis'].map(tab => (
                    <button key={tab} onClick={() => setEditorTab(tab)}
                      style={{ flex: 1, padding: '7px', fontSize: '11px', fontWeight: 700, borderRadius: '6px', border: 'none', cursor: 'pointer', background: editorTab === tab ? 'rgba(232, 160, 160, 0.05)' : 'transparent', color: editorTab === tab ? 'rgba(255,255,255,0.08)' : '#999' }}>
                      {tab === 'upload' ? 'Upload' : 'Post As Is'}
                    </button>
                  ))}
                </div>

                {/* UPLOAD tab */}
                {editorTab === 'upload' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Drag-and-drop zone */}
                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setUploadFile(f) }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{ border: `2px dashed ${uploadFile ? 'var(--palm-pink)' : 'var(--card-border)'}`, borderRadius: '10px', padding: '20px', textAlign: 'center', cursor: 'pointer', background: 'var(--background)', transition: 'border-color 0.2s' }}
                    >
                      <input ref={fileInputRef} type="file" accept="video/*,.mov,.mp4,.m4v" style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) setUploadFile(f) }} />
                      {uploadFile ? (
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--palm-pink)' }}>{uploadFile.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>{(uploadFile.size / 1024 / 1024).toFixed(1)} MB — click to change</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: '24px', marginBottom: '6px' }}>⬆</div>
                          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>Drop video here or click to browse</div>
                          <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '4px' }}>MP4, MOV supported</div>
                        </div>
                      )}
                    </div>

                    {/* Or paste link */}
                    <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', textAlign: 'center' }}>— or paste a Dropbox link —</div>
                    <input type="url" value={uploadUrl} onChange={e => setUploadUrl(e.target.value)}
                      placeholder="https://www.dropbox.com/..."
                      style={{ width: '100%', background: 'var(--background)', border: '1px solid transparent', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: 'var(--foreground)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />

                    {uploadProgress && <div style={{ fontSize: '12px', color: 'var(--palm-pink)' }}>{uploadProgress}</div>}
                    {uploadError && <div style={{ fontSize: '12px', color: '#E87878' }}>{uploadError}</div>}
                    {saveErr && <div style={{ fontSize: '12px', color: '#E87878' }}>{saveErr}</div>}

                    <button
                      onClick={() => uploadFile ? handleFileUpload(uploadFile) : handleSave(uploadUrl)}
                      disabled={saving || saved || (!uploadFile && !uploadUrl.trim()) || !!uploadProgress}
                      style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: saved ? 'rgba(125, 211, 164, 0.08)' : 'rgba(232, 160, 160, 0.05)', color: saved ? '#7DD3A4' : 'var(--palm-pink)', border: `1px solid ${saved ? 'rgba(125, 211, 164, 0.2)' : 'var(--palm-pink)'}`, borderRadius: '8px', cursor: (saving || saved || (!uploadFile && !uploadUrl.trim()) || !!uploadProgress) ? 'not-allowed' : 'pointer', opacity: (!uploadFile && !uploadUrl.trim() && !saved) ? 0.5 : 1 }}>
                      {saved ? 'Saved ✓' : saving || uploadProgress ? 'Uploading...' : 'Save & Submit ↑'}
                    </button>
                  </div>
                )}

                {/* POST AS IS tab */}
                {editorTab === 'asis' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.5, background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', padding: '10px 12px' }}>
                      Sends the raw clip for review with no edits. Use this when the clip doesn't need a caption or any changes.
                    </div>
                    {saveErr && <div style={{ fontSize: '12px', color: '#E87878' }}>{saveErr}</div>}
                    <button
                      onClick={() => handleSave(task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || '')}
                      disabled={saving || saved}
                      style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: saved ? 'rgba(125, 211, 164, 0.08)' : 'var(--card-bg-solid)', color: saved ? '#7DD3A4' : '#999', border: `1px solid ${saved ? 'rgba(125, 211, 164, 0.2)' : 'var(--card-border)'}`, borderRadius: '8px', cursor: (saving || saved) ? 'not-allowed' : 'pointer' }}>
                      {saved ? 'Submitted ✓' : saving ? 'Submitting...' : 'Submit Raw Clip for Review ↑'}
                    </button>
                  </div>
                )}

              </div>
            )}
            {isClip && (
              <>
                <button onClick={handleClipStart} disabled={starting}
                  style={{ width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, background: 'rgba(232, 200, 120, 0.08)', color: '#E8C878', border: '1px solid #fde68a', borderRadius: '8px', cursor: starting ? 'not-allowed' : 'pointer', opacity: starting ? 0.6 : 1 }}>
                  {starting ? 'Starting...' : 'Start Edit →'}
                </button>
                {startErr && <div style={{ fontSize: '12px', color: '#E87878' }}>{startErr}</div>}
              </>
            )}

            {/* Remove from queue — for active tasks only */}
            {(slot.type === 'toDo' || slot.type === 'inProgress') && task?.id && (
              <div style={{ borderTop: '1px solid transparent', paddingTop: '12px', marginTop: '4px' }}>
                {!confirmCancel ? (
                  <button onClick={() => setConfirmCancel(true)}
                    style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '11px', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Remove from queue
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Remove this task and reset the clip?</span>
                    <button onClick={handleCancelEdit} disabled={cancelling}
                      style={{ fontSize: '11px', fontWeight: 700, color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecaca', borderRadius: '5px', padding: '3px 10px', cursor: cancelling ? 'default' : 'pointer' }}>
                      {cancelling ? 'Removing...' : 'Yes, remove'}
                    </button>
                    <button onClick={() => setConfirmCancel(false)}
                      style={{ fontSize: '11px', color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Today's Work slot components ─────────────────────────────────────────────

// Thumbnail for the left side of the slot card — 1:1 aspect ratio, fills card height
function SlotThumbnail({ slot }) {
  const task = slot.task
  const clip = slot.clip
  const size = '64px'
  const style = { width: size, height: size, borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }
  const cls = 'editor-slot-thumb'

  if (slot.type === 'empty') return null

  if (slot.type === 'done') {
    const editedUrl = task?.asset?.editedFileLink ? rawDropboxUrl(task.asset.editedFileLink) : ''
    const thumb = task?.asset?.thumbnail || task?.inspo?.thumbnail || ''
    if (editedUrl) return <video className={cls} src={editedUrl} muted playsInline style={{ ...style, opacity: 0.7 }} />
    if (thumb) return <img className={cls} src={thumb} alt="" style={{ ...style, opacity: 0.6 }} />
    return null
  }

  if (slot.type === 'inspoClip') {
    const thumb = clip?.thumbnail || clip?.inspo?.thumbnail || ''
    return thumb ? <img className={cls} src={thumb} alt="" style={style} /> : null
  }

  // toDo or inProgress
  const thumb = task?.inspo?.thumbnail || task?.asset?.thumbnail || ''
  const rawClipUrl = !thumb ? rawDropboxUrl(task?.asset?.dropboxLinks?.[0] || task?.asset?.dropboxLink || '') : ''
  if (thumb) return <img className={cls} src={thumb} alt="" style={{ ...style, ...(task?.adminReviewStatus === 'Needs Revision' ? { border: '1px solid #fecaca' } : {}) }} />
  if (rawClipUrl) return <video className={cls} src={rawClipUrl} muted playsInline style={style} />
  return null
}

// Text content for the right side of the slot card
function SlotText({ slot }) {
  const task = slot.task
  const clip = slot.clip

  if (slot.type === 'empty') {
    return <div style={{ fontSize: '12px', color: 'var(--card-border)' }}>+ Assign from library</div>
  }

  if (slot.type === 'done') {
    const title = task?.inspo?.title || task?.name || ''
    return (
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title || 'Edit task'}
      </div>
    )
  }

  if (slot.type === 'inspoClip') {
    const title = clip?.inspo?.title || clip?.name || ''
    const username = clip?.inspo?.username || ''
    return (
      <>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Creator clip'}</div>
        {username && <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>@{username}</div>}
      </>
    )
  }

  // toDo or inProgress
  const title = task?.inspo?.title || task?.name || ''
  const username = task?.inspo?.username || ''
  const isRevision = task?.adminReviewStatus === 'Needs Revision'
  return (
    <>
      <div style={{ fontSize: '13px', fontWeight: 600, color: isRevision ? '#E87878' : 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Edit task'}</div>
      {isRevision && task.adminFeedback && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.adminFeedback}</div>}
      {!isRevision && username && <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>@{username}</div>}
    </>
  )
}

function doneSlotStyle(task) {
  const s = task?.adminReviewStatus || ''
  if (task?.telegramSentAt) return {
    borderColor: 'transparent',
    bg: 'rgba(125, 211, 164, 0.06)',
    hoverBg: 'rgba(125, 211, 164, 0.1)',
    dotColor: '#7DD3A4',
    label: 'Sent ✈'
  }
  if (s === 'Approved') return {
    borderColor: 'transparent',
    bg: 'rgba(125, 211, 164, 0.06)',
    hoverBg: 'rgba(125, 211, 164, 0.1)',
    dotColor: '#7DD3A4',
    label: 'Approved ✓'
  }
  return {
    borderColor: 'transparent',
    bg: 'rgba(232, 200, 120, 0.06)',
    hoverBg: 'rgba(232, 200, 120, 0.1)',
    dotColor: '#E8C878',
    label: 'In Review'
  }
}

function CustomCalendar({ selectedDate, todayStr, onSelect, onClose, dateColors = {} }) {
  const initDate = new Date(selectedDate + 'T12:00:00')
  const [calYear, setCalYear] = useState(initDate.getFullYear())
  const [calMonth, setCalMonth] = useState(initDate.getMonth())

  const shiftMonth = (delta) => {
    let m = calMonth + delta, y = calYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setCalMonth(m); setCalYear(y)
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const navBtn = { background: 'none', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '14px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }
  const dotColors = { green: '#7DD3A4', yellow: '#E8C878', red: '#E87878' }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: '6px', background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '12px', padding: '14px', width: '228px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>{monthNames[calMonth]} {calYear}</span>
          <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, padding: '3px 0' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} />
            const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isSel = ds === selectedDate
            const isToday = ds === todayStr
            const color = dateColors[ds]
            return (
              <button key={i} onClick={() => { onSelect(ds); onClose() }}
                style={{ background: isSel ? 'var(--palm-pink)' : isToday ? 'rgba(232, 160, 160, 0.05)' : 'transparent', border: isToday && !isSel ? '1px solid transparent' : '1px solid transparent', borderRadius: '6px', color: isSel ? 'var(--foreground)' : isToday ? 'var(--palm-pink)' : '#888', fontSize: '12px', fontWeight: isSel || isToday ? 700 : 400, padding: '4px 0 2px', cursor: 'pointer', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                <span>{day}</span>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: color ? dotColors[color] : 'transparent', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid transparent' }}>
          <button onClick={() => { onSelect(todayStr); onClose() }}
            style={{ fontSize: '11px', fontWeight: 700, color: 'var(--palm-pink)', background: 'none', border: 'none', cursor: 'pointer' }}>Today</button>
        </div>
      </div>
    </>
  )
}

function VideoSlot({ slotLabel, slot, isNext, isLocked, isPastDay, creator, onAction, updating, onRefresh, onSlotClick }) {
  const isNeedsRevision = slot.type === 'inProgress' && slot.task?.adminReviewStatus === 'Needs Revision'
  // Past-day open slots are frozen — editor can't start an edit for a day that's already over.
  const isPastEmpty = isPastDay && slot.type === 'empty'
  const typeStyle = isNeedsRevision
    ? { borderColor: 'transparent', bg: 'rgba(232, 120, 120, 0.08)', hoverBg: 'rgba(232, 120, 120, 0.12)', dotColor: '#E87878', label: 'Needs Revision' }
    : slot.type === 'done'
    ? doneSlotStyle(slot.task)
    : (slot.type === 'toDo' && slot.task?.isInspoUpload)
    ? { borderColor: 'transparent', bg: 'rgba(232, 200, 120, 0.06)', hoverBg: 'rgba(232, 200, 120, 0.1)', dotColor: '#E8C878', label: 'Creator clip uploaded' }
    : isPastEmpty
    ? { borderColor: 'transparent', bg: 'var(--card-bg-solid)', hoverBg: 'var(--card-bg-solid)', dotColor: 'var(--foreground-subtle)', label: 'Slot missed' }
    : {
        inProgress: { borderColor: 'transparent', bg: 'rgba(120, 180, 232, 0.06)', hoverBg: 'rgba(120, 180, 232, 0.1)', dotColor: '#78B4E8', label: 'In editing' },
        toDo:       { borderColor: 'transparent', bg: 'var(--card-bg-solid)', hoverBg: 'var(--card-bg-elevated)', dotColor: 'var(--palm-pink)', label: 'Ready to edit' },
        inspoClip:  { borderColor: 'transparent', bg: 'rgba(232, 200, 120, 0.06)', hoverBg: 'rgba(232, 200, 120, 0.1)', dotColor: '#E8C878', label: 'Creator clip uploaded' },
        empty:      { borderColor: 'transparent', bg: 'var(--card-bg-solid)', hoverBg: 'var(--card-bg-elevated)', dotColor: 'var(--foreground-subtle)', label: 'Open slot' },
      }[slot.type] || { borderColor: 'transparent', bg: 'var(--card-bg-solid)', hoverBg: 'var(--card-bg-elevated)', dotColor: 'var(--foreground-subtle)', label: '' }

  const isDone = slot.type === 'done'
  const clickable = !isPastEmpty
  const opacity = isPastEmpty ? 0.45 : 1

  return (
    <div
      className="editor-slot-card"
      onClick={clickable ? () => onSlotClick(slot) : undefined}
      style={{ border: 'none', background: typeStyle.bg, borderRadius: '12px', padding: '14px 16px', minHeight: '90px', overflow: 'hidden', display: 'flex', gap: '12px', alignItems: 'center', cursor: clickable ? 'pointer' : 'not-allowed', transition: 'background 0.3s var(--ease-stripe)', opacity, boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.02)' }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.background = typeStyle.hoverBg }}
      onMouseLeave={e => { e.currentTarget.style.background = typeStyle.bg }}
    >
      <SlotThumbnail slot={slot} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div className="editor-slot-label-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: typeStyle.dotColor, flexShrink: 0 }} />
            <span style={{ fontSize: '10px', fontWeight: 700, color: typeStyle.dotColor, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
              {typeStyle.label}
            </span>
          </div>
          {slotLabel && (
            <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{slotLabel}</span>
          )}
        </div>
        <SlotText slot={slot} />
      </div>
    </div>
  )
}

// ─── Creator section ───────────────────────────────────────────────────────────

function CreatorSection({ creator, onRefresh }) {
  const [updating, setUpdating] = useState(null)
  const [submitModal, setSubmitModal] = useState(null)
  const [taskModal, setTaskModal] = useState(null)
  const [libraryModal, setLibraryModal] = useState(false)
  const [toast, setToast] = useState(null)
  const [dnaModal, setDnaModal] = useState(false)

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  const handleAction = async (type, task) => {
    if (type === 'startEditing') {
      setUpdating(task.id)
      try {
        const res = await fetch('/api/admin/editor', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, newStatus: 'In Progress' }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Update failed')
        showToast('Started editing')
        // Update task modal in-place to show In Progress state — set before refresh
        // so the modal stays open and shows the editing tools immediately
        setTaskModal({ type: 'inProgress', task: { ...task, status: 'In Progress' } })
        await onRefresh()
      } catch (err) {
        showToast(err.message, true)
      } finally {
        setUpdating(null)
      }
    } else if (type === 'submit') {
      setSubmitModal({ task, isRevision: false })
    } else if (type === 'revision') {
      setSubmitModal({ task, isRevision: true })
    }
  }

  const handleInspoClipStart = async (clip) => {
    const res = await fetch('/api/editor/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: clip.id, creatorId: creator.id }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed')
    onRefresh()
  }

  const handleSubmit = async (taskId, editedFileLink, editedFilePath, editorNotes) => {
    const isRevision = submitModal?.isRevision
    const res = await fetch('/api/admin/editor', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, newStatus: 'Done', editedFileLink, editedFilePath, editorNotes, isRevision }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Submit failed')
    const submittedTask = submitModal?.task
    setSubmitModal(null)
    showToast(isRevision ? 'Revision submitted' : 'Edit submitted for review')
    // Update task modal to show In Review state
    setTaskModal({ type: 'inReview', task: { ...submittedTask, status: 'Done', adminReviewStatus: 'Pending Review' } })
    await onRefresh()
  }

  const dailyQuota = creator.dailyQuota || 2
  const estNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const pad = n => String(n).padStart(2, '0')
  const estDs = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const todayDateStr = estDs(estNow)
  const [selectedDate, setSelectedDate] = useState(todayDateStr)
  const [showDatePicker, setShowDatePicker] = useState(false)

  const isToday = selectedDate === todayDateStr

  const shiftDate = (days) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const selectedDayLabel = (() => {
    const d = new Date(selectedDate + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  })()

  // Sort done tasks by when the editor actually completed them (earliest = Morning slot)
  const sortBySlot = arr => [...arr].sort((a, b) =>
    new Date(a.completedAt || 0) - new Date(b.completedAt || 0)
  )

  // Build per-date color map for calendar dots
  const dateColors = (() => {
    const colors = {}

    // Past dates: use completed task data (14-day window), grouped by completedAt date
    const byDate = {}
    for (const t of (creator.recentDone || [])) {
      const d = (t.completedAt || '').split('T')[0]
      if (!d) continue
      if (!byDate[d]) byDate[d] = []
      byDate[d].push(t)
    }
    for (const [date, tasks] of Object.entries(byDate)) {
      const allApproved = tasks.length >= dailyQuota && tasks.every(t => t.adminReviewStatus === 'Approved')
      colors[date] = allApproved ? 'green' : 'yellow'
    }
    // Today: factor in inProgress too
    const todayDone = creator.doneTodayList || []
    const todayIP = creator.inProgress || []
    if (todayDone.length >= dailyQuota) {
      colors[todayDateStr] = todayDone.every(t => t.adminReviewStatus === 'Approved') ? 'green' : 'yellow'
    } else if (todayDone.length > 0 || todayIP.length > 0) {
      colors[todayDateStr] = 'yellow'
    } else {
      colors[todayDateStr] = 'red'
    }
    // All dates: overlay post schedule data (past 60 days + future)
    // Task completion data (recentDone) takes precedence where it exists
    const postsByDate = creator.postsByDate || {}
    // Enumerate 60 days back + 60 days forward
    for (let i = -60; i <= 60; i++) {
      if (i === 0) continue // today handled above
      const d = new Date(todayDateStr + 'T12:00:00')
      d.setDate(d.getDate() + i)
      const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
      if (colors[ds]) continue // already set by recentDone task data
      const count = postsByDate[ds] || 0
      if (count >= dailyQuota) colors[ds] = 'green'
      else if (count > 0) colors[ds] = 'yellow'
      else if (i < 0) colors[ds] = 'red' // past date with no posts = missed
      else colors[ds] = 'red' // future date with no posts scheduled
    }
    return colors
  })()

  // Per-slot colors for quota dots: Sun morning, Sun evening, Mon morning, Mon evening...
  const slotColors = (() => {
    const statusColor = s => {
      if (s === 'Approved') return '#7DD3A4'
      if (s === 'Pending Review') return '#a3e635'
      if (s === 'Needs Revision') return '#E87878'
      return '#7DD3A4'
    }
    const sun = new Date(todayDateStr + 'T12:00:00')
    sun.setDate(sun.getDate() - sun.getDay())
    // Build queue items list (same as slot distribution)
    const dotQueueItems = [
      ...creator.inProgress.map(() => 'inProgress'),
      ...creator.queue.map(t => t.isInspoUpload ? 'inspoClip' : 'toDo'),
      ...(creator.inspoClips || []).map(() => 'inspoClip'),
    ]
    let queueIdx = 0 // tracks how many queue items have been consumed by previous days

    const colors = []
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(sun); dayDate.setDate(sun.getDate() + d)
      const ds = estDs(dayDate)
      const isDayToday = ds === todayDateStr
      const isFuture = ds > todayDateStr
      const isPast = ds < todayDateStr
      const doneTasks = sortBySlot((creator.recentDone || [])
        .filter(t => (t.etSlotDate || t.etCompletedDate) === ds))

      for (let s = 0; s < dailyQuota; s++) {
        if (s < doneTasks.length) {
          colors.push(statusColor(doneTasks[s].adminReviewStatus))
        } else if (isPast) {
          // Past day, unfilled slot = locked empty
          colors.push('var(--card-border)')
        } else {
          // Today or future: fill from queue
          if (queueIdx < dotQueueItems.length) {
            const type = dotQueueItems[queueIdx]
            queueIdx++
            if (type === 'inProgress') colors.push('#78B4E8')       // blue
            else if (type === 'inspoClip') colors.push('#E8C878')   // yellow/amber
            else colors.push('var(--palm-pink)')                              // pink (To Do)
          } else {
            colors.push('var(--card-border)') // empty
          }
        }
      }
    }
    return colors
  })()

  // Done tasks for selected date — pinned to their slot date (post scheduled date if approved,
  // otherwise completion date). These are locked in and don't move.
  const selectedDoneList = sortBySlot(
    isToday
      ? (creator.doneTodayList || [])
      : (creator.recentDone || []).filter(t => (t.etSlotDate || t.etCompletedDate) === selectedDate)
  )

  // Queue = active items not yet done. These float forward with time —
  // they always fill the next available slots starting from TODAY.
  // Past days never get queue items (past is locked).
  const queueItems = [
    ...creator.inProgress.map(t => ({ type: 'inProgress', task: t })),
    ...creator.queue.map(t => ({ type: 'toDo', task: t })),
    ...(creator.inspoClips || []).map(c => ({ type: 'inspoClip', clip: c })),
  ]

  const slots = []
  selectedDoneList.forEach(t => slots.push({ type: 'done', task: t }))

  // Only fill queue items into today and future days. Past = locked.
  const isFutureOrToday = selectedDate >= todayDateStr
  if (isFutureOrToday && queueItems.length > 0) {
    // Count how many queue items are consumed by each day from today to the selected date.
    // Each day's done tasks reduce that day's available queue slots.
    const todayD = new Date(todayDateStr + 'T12:00:00')
    const selD = new Date(selectedDate + 'T12:00:00')
    const daysAhead = Math.round((selD - todayD) / (1000 * 60 * 60 * 24))

    let skipCount = 0
    if (!isToday) {
      for (let d = 0; d < daysAhead; d++) {
        const iterDate = new Date(todayD)
        iterDate.setDate(iterDate.getDate() + d)
        const ds = `${iterDate.getFullYear()}-${String(iterDate.getMonth()+1).padStart(2,'0')}-${String(iterDate.getDate()).padStart(2,'0')}`
        // Count done tasks pinned to this day
        const doneOnDay = (creator.recentDone || []).filter(t => (t.etSlotDate || t.etCompletedDate) === ds).length
        const availOnDay = Math.max(0, dailyQuota - doneOnDay)
        skipCount += availOnDay
      }
    }

    const remaining = Math.max(0, dailyQuota - slots.length)
    queueItems.slice(skipCount, skipCount + remaining).forEach(item => slots.push(item))
  }

  while (slots.length < dailyQuota) slots.push({ type: 'empty' })

  const allDone = selectedDoneList.length >= dailyQuota

  return (
    <div style={{ background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '16px', height: '100%' }}>
      {/* Header */}
      <div className="editor-creator-header" style={{ padding: '18px 24px 14px', borderBottom: '1px solid transparent' }}>
        {/* Row 1: name + See More inline left, Weekly label top right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>{creator.name}</h2>
            <Link href={`/editor/${creator.id}`}
              style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid transparent', textDecoration: 'none', flexShrink: 0 }}>
              See More →
            </Link>
            {creator.hasProfile && (
              <button onClick={() => setDnaModal(true)}
                style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, background: 'rgba(232, 160, 160, 0.05)', color: 'var(--palm-pink)', border: '1px solid transparent', cursor: 'pointer', flexShrink: 0 }}>
                DNA
              </button>
            )}
          </div>
          <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0, paddingTop: '4px' }}>Weekly</span>
        </div>
        {/* Row 2: status pills — always has at least the 'needed' pill */}
        <div className="editor-creator-pills" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
          {creator.needsRevision.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(232, 120, 120, 0.08)', color: '#E87878', border: '1px solid transparent' }}>
              ⚠ {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''}
            </span>
          )}
          {creator.queue.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(232, 160, 160, 0.08)', color: 'var(--palm-pink)', border: '1px solid transparent' }}>
              {creator.queue.length} queued
            </span>
          )}
          {creator.inProgress.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(120, 180, 232, 0.08)', color: '#78B4E8', border: '1px solid transparent' }}>
              {creator.inProgress.length} editing
            </span>
          )}
          {creator.inReview.length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(232, 200, 120, 0.08)', color: '#E8C878', border: '1px solid transparent' }}>
              {creator.inReview.length} in review
            </span>
          )}
          {(creator.approved || []).length > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid transparent' }}>
              {creator.approved.length} approved
            </span>
          )}
          {(() => {
            const needed = Math.max(0, creator.quota - creator.doneToday)
            return needed > 0 ? (
              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--card-bg-solid)', color: 'var(--foreground-subtle)', border: '1px solid transparent' }}>
                {needed} open
              </span>
            ) : null
          })()}
        </div>
        {/* Row 2: quota dots full width */}
        <QuotaDots slotColors={slotColors} quota={creator.quota} done={creator.doneToday} />
      </div>

      {/* Daily Work Slots */}
      <div className="editor-creator-body" style={{ padding: '16px 24px' }}>
        {/* Date navigation */}
        <div className="editor-date-nav" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <button onClick={() => shiftDate(-1)}
            style={{ background: 'none', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '13px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>‹</button>
          <div style={{ position: 'relative', minWidth: '180px' }}>
            <button onClick={() => setShowDatePicker(p => !p)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: isToday ? 'var(--palm-pink)' : '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isToday ? 'Today · ' : ''}{selectedDayLabel}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)' }}>▾</span>
            </button>
            {showDatePicker && (
              <CustomCalendar
                selectedDate={selectedDate}
                todayStr={todayDateStr}
                onSelect={setSelectedDate}
                onClose={() => setShowDatePicker(false)}
                dateColors={dateColors}
              />
            )}
          </div>
          <button onClick={() => shiftDate(1)}
            style={{ background: 'none', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '13px', cursor: 'pointer', padding: '2px 8px', lineHeight: 1.4 }}>›</button>
          {!isToday && (
            <button onClick={() => setSelectedDate(todayDateStr)}
              style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', fontSize: '11px', cursor: 'pointer', padding: '0 4px' }}>Today</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '9px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Daily</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(() => {
            const slotNames = dailyQuota === 1 ? ['Morning'] :
              dailyQuota === 2 ? ['Morning', 'Evening'] :
              dailyQuota === 3 ? ['Morning', 'Afternoon', 'Evening'] :
              Array.from({ length: dailyQuota }, (_, i) => `Slot ${i + 1}`)
            const d = new Date(selectedDate + 'T12:00:00')
            const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`
            const nextActionableIndex = slots.findIndex(s => s.type !== 'done')
            const isPastDay = selectedDate < todayDateStr
            return slots.map((slot, i) => {
              const isNext = i === nextActionableIndex
              const isLocked = slot.type !== 'done' && !isNext
              // All slots use positional labels. Done tasks use the ET date they were
              // completed on (editor's work day), not the Post's scheduled date.
              let slotLabel
              if (slot.type === 'done') {
                // Use the ET calendar date of completion + position-based slot name
                const etDate = slot.task?.etSlotDate || slot.task?.etCompletedDate || selectedDate
                const [ey, em, ed] = etDate.split('-').map(Number)
                const completionDateLabel = `${em}/${ed}`
                slotLabel = `${completionDateLabel} / ${slotNames[i] || `Slot ${i + 1}`}`
              } else {
                slotLabel = `${dateLabel} / ${slotNames[i] || `Slot ${i + 1}`}`
              }
              return (
                <VideoSlot
                  key={i}
                  slotLabel={slotLabel}
                  slot={slot}
                  isNext={isNext}
                  isLocked={isLocked}
                  isPastDay={isPastDay}
                  creator={creator}
                  onAction={handleAction}
                  updating={updating}
                  onRefresh={onRefresh}
                  onSlotClick={slot => slot.type === 'empty' ? setLibraryModal(true) : setTaskModal(slot)}
                />
              )
            })
          })()}
        </div>
      </div>

      {taskModal && (
        <TaskDetailModal
          slot={taskModal}
          creator={creator}
          onAction={handleAction}
          onInspoClipStart={handleInspoClipStart}
          updating={updating}
          onClose={() => setTaskModal(null)}
          onRefresh={onRefresh}
          onSaved={async (task) => {
            setTaskModal({ type: 'inReview', task: { ...task, status: 'Done', adminReviewStatus: 'Pending Review' } })
            await onRefresh()
          }}
        />
      )}

      {libraryModal && (
        <LibraryPickerModal
          creator={creator}
          onClose={() => setLibraryModal(false)}
          onRefresh={onRefresh}
          onTaskCreated={async (taskId, asset) => {
            setLibraryModal(false)
            // Open task detail modal immediately in editing state (skip the "Start Editing" step)
            const newTask = {
              id: taskId,
              name: `Edit: ${asset.name || ''}`,
              status: 'In Progress',
              asset: {
                id: asset.id,
                dropboxLinks: asset.dropboxLinks || [],
                dropboxLink: asset.dropboxLink || '',
                thumbnail: asset.thumbnail || '',
                creatorNotes: asset.creatorNotes || '',
              },
            }
            setTaskModal({ type: 'inProgress', task: newTask })
            // Fire the status change to In Progress in the background
            try {
              await fetch('/api/admin/editor', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, newStatus: 'In Progress' }),
              })
              onRefresh()
            } catch {}
          }}
        />
      )}

      {submitModal && (
        <SubmitModal
          task={submitModal.task}
          creatorName={creator.name}
          creatorId={creator.id}
          isRevision={submitModal.isRevision}
          onClose={() => setSubmitModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {/* Creator DNA Modal */}
      {dnaModal && (
        <CreatorDnaModal creatorId={creator.id} creatorName={creator.name} onClose={() => setDnaModal(false)} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? 'rgba(232, 120, 120, 0.06)' : 'rgba(125, 211, 164, 0.08)',
          color: toast.error ? '#E87878' : '#7DD3A4',
          border: `1px solid ${toast.error ? 'rgba(232, 120, 120, 0.2)' : 'rgba(125, 211, 164, 0.2)'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ─── Buffer Overview strip ─────────────────────────────────────────────────────

function BufferCreatorCard({ creator }) {
  const bufferDays = creator.bufferDays ?? 0
  const approvedBuffer = creator.approvedBuffer ?? 0
  const pendingEdit = creator.queue.length + creator.inProgress.length + creator.needsRevision.length

  const isRed = bufferDays < 1
  const isYellow = bufferDays >= 1 && bufferDays < 2
  const isGreen = bufferDays >= 2

  const color = isGreen ? '#7DD3A4' : isYellow ? '#E8C878' : '#E87878'
  const bg = isGreen ? 'rgba(125, 211, 164, 0.06)' : isYellow ? 'rgba(232, 200, 120, 0.06)' : 'rgba(232, 120, 120, 0.06)'
  const border = isGreen ? 'rgba(125, 211, 164, 0.2)' : isYellow ? 'rgba(232, 200, 120, 0.2)' : 'rgba(232, 120, 120, 0.2)'
  const barBg = 'rgba(255, 255, 255, 0.05)'

  return (
    <div className="editor-buffer-card" style={{ background: bg, border: `1px solid ${border}`, borderRadius: '12px', padding: '16px 18px' }}>
      {/* Name + buffer days */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span className="editor-buffer-name" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>{creator.name}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span className="editor-buffer-days" style={{ fontSize: '22px', fontWeight: 800, color, lineHeight: 1 }}>{bufferDays}</span>
          <span style={{ fontSize: '11px', color, fontWeight: 600 }}>d runway</span>
        </div>
      </div>

      {/* Buffer bar */}
      <div style={{ height: '4px', background: 'var(--card-border)', borderRadius: '2px', marginBottom: '10px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: '2px', background: color,
          width: `${Math.min(100, (bufferDays / 7) * 100)}%`,
          transition: 'width 0.3s',
        }} />
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
        <span style={{ color: 'var(--foreground-muted)' }}>
          <span style={{ color: color, fontWeight: 600 }}>{approvedBuffer}</span> posts scheduled
        </span>
        {pendingEdit > 0 && (
          <span style={{ color: 'var(--foreground-muted)' }}>
            <span style={{ color: 'var(--palm-pink)', fontWeight: 600 }}>{pendingEdit}</span> to edit
          </span>
        )}
      </div>

      {/* Revision warning */}
      {creator.needsRevision.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#E87878', fontWeight: 600 }}>
          ⚠ {creator.needsRevision.length} revision{creator.needsRevision.length > 1 ? 's' : ''} needed
        </div>
      )}
    </div>
  )
}

function BufferOverview({ creators }) {
  const sorted = [...creators].sort((a, b) => (a.bufferDays ?? 0) - (b.bufferDays ?? 0))
  const redCount = creators.filter(c => (c.bufferDays ?? 0) < 1).length
  const allHealthy = redCount === 0 && creators.every(c => (c.bufferDays ?? 0) >= 2)

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '14px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Content Buffer
        </h2>
        {allHealthy ? (
          <span style={{ fontSize: '12px', color: '#7DD3A4', fontWeight: 600 }}>All creators healthy ✓</span>
        ) : redCount > 0 ? (
          <span style={{ fontSize: '12px', color: '#E87878', fontWeight: 600 }}>{redCount} creator{redCount > 1 ? 's' : ''} need content</span>
        ) : (
          <span style={{ fontSize: '12px', color: '#E8C878' }}>Some creators running low</span>
        )}
      </div>
      <div className="editor-dash-buffer-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
        {sorted.map(creator => (
          <BufferCreatorCard key={creator.id} creator={creator} />
        ))}
      </div>
    </div>
  )
}

// ─── Main exported component ───────────────────────────────────────────────────

export function EditorDashboardContent() {
  const { user } = useUser()
  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/editor/dashboard')
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`${res.status}: ${body}`)
      }
      const data = await res.json()
      setCreators(data.creators || [])
    } catch (err) {
      if (!silent) setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div style={{ color: 'var(--foreground-subtle)', fontSize: '14px', padding: '40px 0' }}>Loading editor dashboard...</div>
  }

  if (error) {
    return <div style={{ color: '#E87878', fontSize: '14px', padding: '40px 0' }}>{error}</div>
  }

  const totalRevisions = creators.reduce((sum, c) => sum + c.needsRevision.length, 0)
  const totalQueue = creators.reduce((sum, c) => sum + c.queue.length + c.inProgress.length, 0)

  return (
    <div>
      {/* Mobile-only overrides — desktop untouched */}
      <style>{`
        @media (max-width: 768px) {
          .editor-dash-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          .editor-dash-buffer-grid { grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
          .editor-creator-header { padding: 14px 16px 10px !important; }
          .editor-creator-header h2 { font-size: 16px !important; }
          .editor-creator-body { padding: 12px 14px !important; }
          .editor-creator-pills span,
          .editor-creator-pills button { font-size: 10px !important; padding: 3px 8px !important; }
          .editor-slot-card { padding: 10px 12px !important; min-height: 78px !important; gap: 10px !important; }
          .editor-slot-thumb { width: 52px !important; height: 52px !important; flex-shrink: 0; }
          .editor-slot-thumb img, .editor-slot-thumb video { width: 52px !important; height: 52px !important; }
          .editor-slot-label-row { flex-wrap: wrap !important; gap: 4px 8px !important; }
          .editor-date-nav { flex-wrap: wrap !important; gap: 6px !important; }
          .editor-date-nav > :last-child { margin-left: 0 !important; }
          .editor-buffer-card { padding: 12px 14px !important; }
          .editor-buffer-card > div:first-child { margin-bottom: 8px !important; }
          .editor-buffer-name { font-size: 13px !important; }
          .editor-buffer-days { font-size: 20px !important; }
          .editor-dash-header { flex-wrap: wrap; gap: 8px; }
        }
        @media (max-width: 420px) {
          .editor-dash-buffer-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="editor-dash-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
        <div>
          <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>{greeting}, </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)' }}>{firstName}</span>
        </div>
        <button onClick={fetchData}
          style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '6px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      <BufferOverview creators={creators} />

      {creators.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--foreground-subtle)', fontSize: '14px', background: 'var(--background)', borderRadius: '12px', border: '1px solid transparent' }}>
          No creators assigned — toggle Social Media Editing on a creator to assign them.
        </div>
      ) : (
        <div className="editor-dash-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {creators.map(creator => (
            <div key={creator.id} style={{ minWidth: 0 }}>
              <CreatorSection creator={creator} onRefresh={() => fetchData(true)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
