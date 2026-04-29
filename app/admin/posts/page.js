'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { cdnUrlAtSize } from '@/lib/cdnImage'
import { buildStreamIframeUrl } from '@/lib/cfStreamUrl'

const PLATFORMS = ['Instagram Reel', 'Instagram Story', 'TikTok', 'YouTube Shorts', 'X', 'OFTV']
const STATUS_COLORS = {
  'Prepping': '#ca8a04',
  'Sending': '#f59e0b',
  'Sent to Telegram': '#78B4E8',
  'Send Failed': '#ef4444',
  'Ready to Post': '#7DD3A4',
  'Posted': 'var(--palm-pink)',
  'Archived': '#999',
}

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

function isVideo(url) {
  return /\.(mp4|mov|avi|webm|mkv)/i.test(url || '')
}

// HEIC/HEIF don't render in Chrome or Firefox (only Safari does). Server-side
// decode via Vercel was unreliable, so we decode in the browser via heic2any
// (libheif WASM). Bytes are fetched through our existing CORS proxy because
// Dropbox shared links don't send Access-Control-Allow-Origin headers.
function isHeic(url) {
  return /\.(heic|heif)(\?|$)/i.test(url || '')
}

// In-memory cache keyed by Dropbox URL → object URL of decoded JPEG blob.
// Survives picker open/close so re-opening doesn't re-decode the same photos.
const heicBlobCache = new Map()

// Decode a single HEIC URL → blob URL. Reuses cached result if already decoded.
async function decodeHeic(url) {
  if (heicBlobCache.has(url)) return heicBlobCache.get(url)
  const proxied = `/api/admin/video-proxy?url=${encodeURIComponent(rawDropboxUrl(url))}`
  const res = await fetch(proxied)
  if (!res.ok) throw new Error(`proxy ${res.status}`)
  const heicBlob = await res.blob()
  // Dynamic import — only loads heic2any (~80KB gz) when a HEIC is actually shown
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: heicBlob, toType: 'image/jpeg', quality: 0.6 })
  const finalBlob = Array.isArray(out) ? out[0] : out
  const objectUrl = URL.createObjectURL(finalBlob)
  heicBlobCache.set(url, objectUrl)
  return objectUrl
}

function HeicImage({ src, alt, style, onClick }) {
  const [blobUrl, setBlobUrl] = useState(() => heicBlobCache.get(src) || null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (heicBlobCache.has(src)) {
      setBlobUrl(heicBlobCache.get(src))
      return
    }
    let cancelled = false
    decodeHeic(src)
      .then(u => { if (!cancelled) setBlobUrl(u) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [src])

  if (error) {
    return (
      <div onClick={onClick} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.15)', color: 'var(--foreground-muted)', fontSize: '10px', fontWeight: 600 }}>
        HEIC
      </div>
    )
  }
  if (!blobUrl) {
    return (
      <div onClick={onClick} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.05)', color: 'var(--foreground-muted)', fontSize: '10px' }}>
        ...
      </div>
    )
  }
  return <img src={blobUrl} alt={alt} style={style} onClick={onClick} />
}

// Convert UTC ISO string to ET local datetime string for <input type="datetime-local">
function utcToETLocal(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = type => parts.find(p => p.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

// Convert ET local datetime string (from datetime-local input) to UTC ISO
function etLocalToUTC(localStr) {
  if (!localStr) return ''
  const [datePart, timePart] = localStr.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, min] = timePart.split(':').map(Number)
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12))
  const etHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hour12: false,
    }).format(noonUTC)
  )
  const offset = 12 - etHourAtNoon // 4 for EDT, 5 for EST
  return new Date(Date.UTC(year, month - 1, day, hour + offset, min)).toISOString()
}

// Format a UTC ISO string as "Day · Mon D · Morning/Evening" in ET
function formatScheduledLabel(isoStr) {
  if (!isoStr) return null
  const d = new Date(isoStr)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = type => parts.find(p => p.type === type)?.value || ''
  const etHour = parseInt(get('hour'))
  const slot = etHour < 15 ? 'Morning' : 'Evening'
  return `${get('weekday')} · ${get('month')} ${get('day')} · ${slot}`
}

function TelegramModal({ post, onClose, onSent }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const editedFileLink = post.asset?.editedFileLink || ''
  const scheduledDate = formatScheduledLabel(post.scheduledDate)
  const fullCaption = [post.caption, post.hashtags, scheduledDate ? `📅 ${scheduledDate}` : null].filter(Boolean).join('\n\n')
  const videoRawUrl = rawDropboxUrl(editedFileLink)
  const thumbRawUrl = post.thumbnailUrl ? rawDropboxUrl(post.thumbnailUrl) : ''

  const handleSend = async () => {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editedFileLink,
          threadId: post.creator?.telegramThreadId,
          caption: fullCaption.trim() || undefined,
          taskName: post.name,
          postId: post.id,
          thumbnailUrl: post.thumbnailUrl || undefined,
          assetId: post.asset?.id || undefined,
          // Save these fields to Airtable on send (in case user didn't explicitly Save first)
          rawCaption: post.caption || undefined,
          rawHashtags: post.hashtags || undefined,
          platform: post.platform?.length ? post.platform : undefined,
          scheduledDate: post.scheduledDate ? etLocalToUTC(post.scheduledDate) : undefined,
        }),
      })
      let data
      try {
        data = await res.json()
      } catch {
        throw new Error(res.status === 504 ? 'Request timed out — the file may be too large. Try again.' : `Server error (${res.status})`)
      }
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>Send to Telegram?</div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>{post.creator?.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        {!editedFileLink && (
          <div style={{ background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#E87878' }}>
            No edited file link on this post.
          </div>
        )}

        {/* Video + Thumbnail side by side. Prefers Cloudflare Stream iframe
            (autoplays muted/looped, instant from edge) over a Dropbox <video>
            that takes 5-10s to first frame. Stream's first segment is a
            sub-200ms fetch so the modal feels live the moment it opens. */}
        {editedFileLink && (
          <div style={{ display: 'grid', gridTemplateColumns: thumbRawUrl ? '1fr 1fr' : '1fr', gap: '8px' }}>
            <div style={{ background: 'rgba(232, 160, 160, 0.04)', borderRadius: '8px', overflow: 'hidden', aspectRatio: '9/16', border: '1px solid transparent' }}>
              {post.asset?.streamEditId ? (
                <iframe src={buildStreamIframeUrl(post.asset.streamEditId, { autoplay: true, muted: true, loop: true, controls: false })}
                  allow="autoplay" style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
              ) : (
                <video src={videoRawUrl} muted loop autoPlay playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              )}
            </div>
            {thumbRawUrl && (
              <div style={{ background: 'rgba(232, 160, 160, 0.04)', borderRadius: '8px', overflow: 'hidden', aspectRatio: '9/16', border: '1px solid transparent' }}>
                <img src={thumbRawUrl} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            )}
          </div>
        )}

        {/* Caption / hashtags / date */}
        <div style={{ background: 'var(--background)', border: '1px solid transparent', borderRadius: '8px', overflow: 'hidden' }}>
          {fullCaption ? (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{fullCaption}</div>
            </div>
          ) : (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>No caption, hashtags, or date set</div>
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: '12px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '8px 12px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', color: 'var(--foreground-muted)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !editedFileLink}
            style={{ flex: 2, padding: '10px', background: sending || !editedFileLink ? 'rgba(125, 211, 164, 0.06)' : 'rgba(125, 211, 164, 0.08)', border: `1px solid ${sending || !editedFileLink ? '#d1fae5' : 'rgba(125, 211, 164, 0.2)'}`, color: sending || !editedFileLink ? '#7DD3A4' : '#7DD3A4', borderRadius: '8px', cursor: sending || !editedFileLink ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
            {sending ? 'Sending...' : '✈ Confirm & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

const REEL_PLATFORMS = ['Instagram Reel', 'TikTok', 'YouTube Shorts']

const PHOTO_PAGE_SIZE = 12

function PhotoPickerModal({ creatorId, platforms, onSelect, onClose }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null) // photo being previewed
  const [page, setPage] = useState(0)
  const [sortNewest, setSortNewest] = useState(true)
  const isReel = (platforms || []).some(p => REEL_PLATFORMS.includes(p))

  useEffect(() => {
    fetch(`/api/admin/posts/photos?creatorId=${creatorId}&forReel=${isReel}`)
      .then(r => r.json())
      .then(d => { setPhotos(d.photos || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [creatorId, isReel])

  const handleUse = async (photo) => {
    // Don't mark as "Used As Reel Thumbnail" here — that happens at Send to Telegram.
    // Picking a photo in prep ≠ committing it. If the post is abandoned or the
    // thumbnail is swapped, the original photo should remain available in the picker.
    onSelect(photo.dropboxLink)
  }

  // Preview mode
  if (preview) {
    const isHeicPhoto = isHeic(preview.dropboxLink)
    const rawUrl = rawDropboxUrl(preview.dropboxLink)
    return (
      <div onClick={e => e.target === e.currentTarget && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => setPreview(null)}
              style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
              ← Back
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
          <div style={{ background: 'rgba(232, 160, 160, 0.04)', aspectRatio: '4/3', overflow: 'hidden' }}>
            {isHeicPhoto ? (
              <HeicImage src={preview.dropboxLink} alt={preview.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            ) : (
              <img src={cdnUrlAtSize(preview.cdnUrl, 1200) || rawUrl} alt={preview.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            )}
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setPreview(null)}
              style={{ flex: 1, padding: '10px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', color: 'var(--foreground-muted)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              Choose different
            </button>
            <button onClick={() => handleUse(preview)}
              style={{ flex: 2, padding: '10px', background: 'var(--palm-pink)', border: '1px solid var(--palm-pink-dark)', color: '#060606', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
              Use this photo
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Grid mode
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '100%', maxWidth: '640px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>Choose Thumbnail</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>
        <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
            <button onClick={() => { setSortNewest(true); setPage(0) }}
              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '6px', cursor: 'pointer', border: '1px solid transparent', background: sortNewest ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)', color: sortNewest ? '#060606' : 'var(--foreground-muted)' }}>
              Newest
            </button>
            <button onClick={() => { setSortNewest(false); setPage(0) }}
              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '6px', cursor: 'pointer', border: '1px solid transparent', background: !sortNewest ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)', color: !sortNewest ? '#060606' : 'var(--foreground-muted)' }}>
              Oldest
            </button>
          </div>
          {isReel && (
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '12px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', padding: '6px 10px' }}>
              Showing unused photos only — photos already used as reel thumbnails are hidden.
            </div>
          )}
          {loading && <div style={{ color: 'var(--foreground-muted)', textAlign: 'center', padding: '40px' }}>Loading photos...</div>}
          {!loading && photos.length === 0 && (
            <div style={{ color: 'var(--foreground-muted)', textAlign: 'center', padding: '40px', fontSize: '13px' }}>
              {isReel ? 'No unused photos left — all have been used as reel thumbnails.' : 'No photos in library for this creator.'}
            </div>
          )}
          {(() => {
            const sorted = sortNewest ? photos : [...photos].reverse()
            const totalPages = Math.ceil(sorted.length / PHOTO_PAGE_SIZE)
            const pagePhotos = sorted.slice(page * PHOTO_PAGE_SIZE, (page + 1) * PHOTO_PAGE_SIZE)
            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px' }}>
                  {pagePhotos.map(photo => {
                    const heic = isHeic(photo.dropboxLink)
                    const rawUrl = rawDropboxUrl(photo.dropboxLink)
                    const cellStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
                    return (
                      <div key={photo.id} onClick={() => setPreview(photo)}
                        style={{ aspectRatio: '1', overflow: 'hidden', borderRadius: '6px', border: '2px solid transparent', cursor: 'pointer', transition: 'border-color 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--palm-pink)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                        {heic ? (
                          <HeicImage src={photo.dropboxLink} alt={photo.name} style={cellStyle} />
                        ) : (
                          <img src={cdnUrlAtSize(photo.cdnUrl, 300) || rawUrl} alt={photo.name} loading="lazy" decoding="async" style={cellStyle} />
                        )}
                      </div>
                    )
                  })}
                </div>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                      style={{ padding: '6px 14px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', color: page === 0 ? '#3f3f46' : '#888', cursor: page === 0 ? 'default' : 'pointer', fontSize: '13px' }}>
                      ← Prev
                    </button>
                    <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{page + 1} / {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                      style={{ padding: '6px 14px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', color: page === totalPages - 1 ? '#3f3f46' : '#888', cursor: page === totalPages - 1 ? 'default' : 'pointer', fontSize: '13px' }}>
                      Next →
                    </button>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

function VideoFramePicker({ videoUrl, streamUid, postId, onCapture, onClose }) {
  const videoRef = useRef(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const [capturedUrl, setCapturedUrl] = useState(null)
  const [error, setError] = useState('')

  // Two playback modes, picked at mount based on whether the asset has been
  // mirrored to Cloudflare Stream:
  //   • Stream mode — preview is a CF poster image at the chosen timestamp.
  //     Scrubbing = single CDN image fetch per seek (snappy). Capture is
  //     the same JPEG fetched as a blob, no canvas / ffmpeg.
  //   • Dropbox mode (legacy fallback) — proxied <video> with canvas capture.
  //     Slow because every seek triggers a Range request through our proxy.
  const useStream = !!streamUid

  // Stream poster URL at the current scrub time. CF generates JPEGs on
  // demand at any timestamp; the URL is GET-cacheable so subsequent visits
  // to the same time are instant.
  const posterUrl = useStream
    ? `https://customer-s6evvwyakoxbda2u.cloudflarestream.com/${streamUid}/thumbnails/thumbnail.jpg?time=${currentTime.toFixed(2)}s&height=1920&fit=crop`
    : null

  // Dropbox-mode fallback only. Proxied for canvas CORS, ignored in Stream
  // mode (we don't load any video bytes — duration comes from CF API).
  const rawUrl = rawDropboxUrl(videoUrl)
  const proxiedUrl = `/api/admin/video-proxy?url=${encodeURIComponent(rawUrl)}`

  // In Stream mode, fetch duration once from CF API. In Dropbox mode the
  // <video onLoadedMetadata> handler below sets it.
  useEffect(() => {
    if (!useStream) return
    let cancelled = false
    fetch(`/api/admin/cf-stream/info?uid=${encodeURIComponent(streamUid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d?.duration) setDuration(d.duration)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [useStream, streamUid])

  const handleScrub = (e) => {
    const t = parseFloat(e.target.value)
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  // Grab the currently-displayed video frame via <canvas>. The browser has
  // already tonemapped HDR→SDR for display, so drawImage reads exactly what
  // the user sees while scrubbing. Works because the video is served through
  // our same-origin proxy with CORS headers — a direct Dropbox fetch would
  // leave the canvas tainted and block toBlob.
  const clientCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob null')), 'image/jpeg', 0.92)
      } catch (e) { reject(e) }
    })
  }

  const handleCapture = async () => {
    setCapturing(true)
    setError('')
    try {
      let blob = null

      // Stream mode: just fetch the same poster URL the user is looking at.
      // CF already generated the JPEG when they scrubbed there, so this is
      // typically a cache hit. Bigger/sharper variant for the actual save.
      if (useStream) {
        const captureUrl = `https://customer-s6evvwyakoxbda2u.cloudflarestream.com/${streamUid}/thumbnails/thumbnail.jpg?time=${currentTime.toFixed(2)}s&height=1920&fit=crop`
        const res = await fetch(captureUrl)
        if (!res.ok) throw new Error(`CF poster ${res.status}`)
        blob = await res.blob()
      } else {
        // Dropbox mode — client-side canvas first, server ffmpeg as fallback
        const promise = clientCapture()
        if (promise) {
          try { blob = await promise }
          catch (e) { console.warn('[Frame] client capture failed, trying server:', e.message) }
        }
        if (!blob) {
          const frameRes = await fetch('/api/admin/posts/thumbnail/frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl, timestamp: currentTime }),
          })
          const frameData = await frameRes.json()
          if (!frameRes.ok) throw new Error(frameData.error || 'Frame extraction failed')
          blob = new Blob([Uint8Array.from(atob(frameData.jpeg), c => c.charCodeAt(0))], { type: 'image/jpeg' })
        }
      }

      // Upload the JPEG to Dropbox via the existing thumbnail endpoint
      const form = new FormData()
      form.append('file', blob, `frame_${Date.now()}.jpg`)
      form.append('postId', postId)
      const uploadRes = await fetch('/api/admin/posts/thumbnail', { method: 'POST', body: form })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed')

      setCapturedUrl(uploadData.url)
    } catch (err) {
      setError(err.message)
    } finally {
      setCapturing(false)
    }
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  // Preview mode — frame captured, confirm or try again
  if (capturedUrl) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '100%', maxWidth: '380px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>Frame captured</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
          <div style={{ background: 'rgba(232, 160, 160, 0.04)', aspectRatio: '9/16', overflow: 'hidden' }}>
            <img src={rawDropboxUrl(capturedUrl)} alt="captured frame" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setCapturedUrl(null)}
              style={{ flex: 1, padding: '10px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', color: 'var(--foreground-muted)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              Try another
            </button>
            <button onClick={() => { onCapture(capturedUrl); onClose() }}
              style={{ flex: 2, padding: '10px', background: 'var(--palm-pink)', border: '1px solid var(--palm-pink-dark)', color: '#060606', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
              Use this frame
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Scrubber mode
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '100%', maxWidth: '380px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>Pick a frame</div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>Scrub to position — original file, no text overlays</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        {/* Preview pane — Stream mode renders an <img> at the chosen
            timestamp (each scrub = one CF CDN image fetch, snappy). Dropbox
            mode keeps the legacy <video> with proxied source for canvas
            capture. */}
        <div style={{ background: 'rgba(232, 160, 160, 0.04)', aspectRatio: '9/16', overflow: 'hidden', position: 'relative' }}>
          {useStream ? (
            <img
              src={posterUrl}
              alt={`frame at ${currentTime.toFixed(2)}s`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <video
              ref={videoRef}
              src={proxiedUrl}
              crossOrigin="anonymous"
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
              onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </div>

        {/* Scrubber + capture */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', minWidth: '32px', fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={handleScrub}
              style={{ flex: 1, accentColor: 'var(--palm-pink)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTime(duration)}</span>
          </div>

          {error && <div style={{ fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>{error}</div>}

          <button
            onClick={handleCapture}
            disabled={capturing || !duration}
            style={{ padding: '10px', background: capturing || !duration ? 'rgba(232, 160, 160, 0.06)' : 'var(--palm-pink)', border: `1px solid ${capturing || !duration ? 'transparent' : 'var(--palm-pink-dark)'}`, color: capturing || !duration ? 'var(--foreground-subtle)' : '#060606', borderRadius: '8px', cursor: capturing || !duration ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
            {capturing ? 'Capturing...' : '📸 Capture this frame'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Audio-on, controls modal — same pattern admin For Review uses. Click any
// PostCard video cell to open this. Prefers CF Stream iframe, falls back to
// a Dropbox <video> for assets that haven't been mirrored to Stream yet.
function PostVideoModal({ streamUid, url, onClose }) {
  const streamSrc = streamUid ? buildStreamIframeUrl(streamUid, { autoplay: true, controls: true }) : null
  const dropboxRaw = url ? rawDropboxUrl(url) : null
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ position: 'relative', maxHeight: '90vh', maxWidth: '420px', width: '100%', aspectRatio: '9/16' }}>
        {streamSrc ? (
          <iframe src={streamSrc} allow="autoplay; fullscreen" allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: '10px', background: '#000' }} />
        ) : dropboxRaw ? (
          <video src={dropboxRaw} controls autoPlay playsInline
            style={{ width: '100%', maxHeight: '90vh', borderRadius: '10px', display: 'block', background: '#000' }} />
        ) : null}
        <button onClick={onClose}
          style={{ position: 'absolute', top: '-14px', right: '-14px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '50%', width: '32px', height: '32px', color: 'var(--foreground)', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ×
        </button>
      </div>
    </div>
  )
}

function PostCard({ post, onRefresh, onSend }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(post.caption)
  const [hashtags, setHashtags] = useState(post.hashtags)
  const [platforms, setPlatforms] = useState(post.platform?.length ? post.platform : ['Instagram Reel'])
  const [scheduledDate, setScheduledDate] = useState(utcToETLocal(post.scheduledDate))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState(post.thumbnail?.[0]?.url || '')
  const [videoModal, setVideoModal] = useState(null)
  // Track the ORIGINAL URL that came from the saved Post record — so we can
  // detect whether the user actually changed the thumbnail this session, and
  // skip rewriting Airtable's own attachment URL back to itself (which corrupts
  // the attachment and causes the "broken image" after refresh).
  const [savedThumbnailUrl] = useState(post.thumbnail?.[0]?.url || '')
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [showFramePicker, setShowFramePicker] = useState(false)
  const [thumbUploading, setThumbUploading] = useState(false)
  const thumbFileRef = useRef(null)
  // Collapsed-by-default fields. Caption + thumbnail are the only things
  // routinely touched; platforms + hashtags only need to expand when actually
  // edited so they don't eat vertical space.
  const [showPlatforms, setShowPlatforms] = useState(false)
  const [showHashtags, setShowHashtags] = useState(false)
  const [showUploadOption, setShowUploadOption] = useState(false)

  const rawUrl = rawDropboxUrl(post.asset?.editedFileLink || '')
  const hasFile = !!post.asset?.editedFileLink
  // For frame picker: prefer original dropboxLink, fall back to editedFileLink
  const sourceVideoUrl = post.asset?.dropboxLink || post.asset?.editedFileLink || ''
  const canPickFrame = hasFile && isVideo(post.asset?.editedFileLink || '')

  const togglePlatform = (p) => {
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: post.id,
          fields: {
            'Caption': caption,
            'Hashtags': hashtags,
            'Platform': platforms,
            ...(scheduledDate ? { 'Scheduled Date': etLocalToUTC(scheduledDate) } : {}),
            // Only write Thumbnail field if the user actually picked a NEW thumbnail
            // this session. Re-sending an already-ingested Airtable attachment URL
            // back to Airtable breaks it (shows as a broken "thumb" icon after refresh).
            ...(thumbnailUrl && thumbnailUrl !== savedThumbnailUrl ? { 'Thumbnail': [{ url: rawDropboxUrl(thumbnailUrl) }] } : {}),
          },
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  // Send to Grid — save the in-progress edits (caption / hashtags / platform /
  // schedule / thumbnail) AND flip Status to 'Staged' in one PATCH so we don't
  // require a separate Save click. Without this, Send to Grid was only writing
  // Status and silently discarding any caption typed in the textarea.
  const [sendingToGrid, setSendingToGrid] = useState(false)
  const handleSendToGrid = async () => {
    if (sendingToGrid) return
    setSendingToGrid(true)
    try {
      const res = await fetch('/api/admin/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: post.id,
          fields: {
            'Caption': caption,
            'Hashtags': hashtags,
            'Platform': platforms,
            ...(scheduledDate ? { 'Scheduled Date': etLocalToUTC(scheduledDate) } : {}),
            ...(thumbnailUrl && thumbnailUrl !== savedThumbnailUrl ? { 'Thumbnail': [{ url: rawDropboxUrl(thumbnailUrl) }] } : {}),
            'Status': 'Staged',
          },
          typecast: true,
        }),
      })
      if (!res.ok) throw new Error('Failed to stage')
      if (onRefresh) await onRefresh()
    } catch (err) {
      console.error(err)
      setSendingToGrid(false)
    }
  }

  return (
    // Locked to 9:16 video height (300×533) so the card doesn't grow/shrink
    // when fields collapse-expand or the Save button shows up. The user said
    // "everything to be more sturdy" — a fixed height is the cheapest way.
    <div id={`post-card-${post.id}`} style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', overflow: 'hidden', display: 'flex', flexDirection: 'row', height: '533px' }}>

      {/* Left — video cell at 9:16. Prefers Cloudflare Stream iframe (cheap
          to mount, autoplays muted/looped from the edge) so the admin sees
          the edit looping silently in the grid. Click the cell to open the
          PostVideoModal with audio + controls — same affordance the For
          Review queue uses. iframe gets pointer-events:none so the click
          reaches the wrapping <button>. */}
      <div style={{ width: '300px', flexShrink: 0, background: 'rgba(232, 160, 160, 0.04)', position: 'relative', aspectRatio: '9/16' }}>
        {hasFile ? (
          isVideo(post.asset.editedFileLink) ? (
            <button
              onClick={() => {
                if (post.asset?.streamEditId) setVideoModal({ streamUid: post.asset.streamEditId })
                else if (post.asset?.editedFileLink) setVideoModal({ url: post.asset.editedFileLink })
              }}
              style={{ position: 'absolute', inset: 0, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer' }}
              title="Play with audio"
            >
              {post.asset?.streamEditId ? (
                <iframe src={buildStreamIframeUrl(post.asset.streamEditId, { autoplay: true, muted: true, loop: true, controls: false })}
                  allow="autoplay" loading="lazy"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} />
              ) : (thumbnailUrl || post.asset?.cdnUrl) ? (
                <>
                  <img src={thumbnailUrl || cdnUrlAtSize(post.asset?.cdnUrl, 600)} alt="" loading="lazy" decoding="async"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.45)', borderRadius: '50%', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <span style={{ color: 'rgba(255,255,255,0.95)', fontSize: '18px', marginLeft: '3px' }}>▶</span>
                  </div>
                </>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(232, 160, 160, 0.06), rgba(120, 180, 232, 0.04))', color: 'rgba(255,255,255,0.4)', fontSize: '32px' }}>▶</div>
              )}
            </button>
          ) : (
            <img src={cdnUrlAtSize(post.asset?.cdnUrl, 600) || rawUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'transparent', fontSize: '11px' }}>No file</div>
        )}
        <div style={{ position: 'absolute', bottom: '6px', left: '6px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: STATUS_COLORS[post.status] || '#999',
            background: 'rgba(0,0,0,0.4)', border: `1px solid ${STATUS_COLORS[post.status] || 'transparent'}40`,
            padding: '2px 7px', borderRadius: '20px' }}>
            {post.status}
          </div>
        </div>
      </div>

      {/* Right — all fields. Caption + Thumbnail are the routine work; the
          rest collapses behind summary chips so the card height stays sturdy
          and the bottom action row doesn't get squeezed. */}
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>
        {/* Header */}
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '1px' }}>{post.creator?.name}</div>
        </div>

        {/* Caption — promoted, the main thing typed on this card */}
        <div>
          <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Caption</div>
          <textarea value={caption} onChange={e => { setCaption(e.target.value); setEditing(true) }}
            placeholder="Add caption..." rows={4}
            style={{ width: '100%', background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '6px', color: 'rgba(240, 236, 232, 0.85)', fontSize: '12px', padding: '7px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', minHeight: '80px' }} />
        </div>

        {/* Thumbnail — the other thing routinely picked. Big swatch + two
            primary actions; upload-from-device tucked behind a small link. */}
        <div>
          <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Thumbnail</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            {thumbnailUrl ? (
              isHeic(thumbnailUrl) ? (
                <HeicImage
                  src={thumbnailUrl}
                  alt="thumbnail"
                  onClick={() => setShowPhotoPicker(true)}
                  style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: '1px solid transparent', flexShrink: 0, cursor: 'pointer' }}
                />
              ) : (
                <img
                  src={thumbnailUrl.includes('dropbox.com') ? rawDropboxUrl(thumbnailUrl) : thumbnailUrl}
                  alt="thumbnail"
                  style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: '1px solid transparent', flexShrink: 0, cursor: 'pointer' }}
                  onClick={() => setShowPhotoPicker(true)}
                />
              )
            ) : (
              <div style={{ width: '56px', height: '56px', borderRadius: '6px', flexShrink: 0, background: 'var(--background)', border: '1px dashed var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground-subtle)', fontSize: '18px' }}>—</div>
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
              <button onClick={() => setShowPhotoPicker(true)}
                style={{ width: '100%', padding: '6px 10px', background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer', textAlign: 'center' }}>
                {thumbnailUrl ? 'Change from library' : '+ Choose from library'}
              </button>
              {canPickFrame && (
                <button onClick={() => setShowFramePicker(true)}
                  style={{ width: '100%', padding: '6px 10px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', fontSize: '11px', color: 'var(--palm-pink)', cursor: 'pointer', textAlign: 'center' }}>
                  🎞 Pick from video
                </button>
              )}
              <input ref={thumbFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setThumbUploading(true)
                  try {
                    const form = new FormData()
                    form.append('file', file)
                    form.append('postId', post.id)
                    const res = await fetch('/api/admin/posts/thumbnail', { method: 'POST', body: form })
                    const data = await res.json()
                    if (data.url) setThumbnailUrl(data.url)
                  } catch (err) {
                    console.error('Thumbnail upload failed:', err)
                  } finally {
                    setThumbUploading(false)
                    e.target.value = ''
                  }
                }}
              />
              {showUploadOption ? (
                <button onClick={() => thumbFileRef.current?.click()} disabled={thumbUploading}
                  style={{ width: '100%', padding: '6px 10px', background: 'rgba(125, 211, 164, 0.08)', border: '1px solid transparent', borderRadius: '6px', fontSize: '11px', color: '#7DD3A4', cursor: 'pointer', textAlign: 'center', opacity: thumbUploading ? 0.6 : 1 }}>
                  {thumbUploading ? 'Uploading…' : '📁 Upload from device'}
                </button>
              ) : (
                <button onClick={() => setShowUploadOption(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', fontSize: '10px', cursor: 'pointer', padding: '2px 0', textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                  upload from device
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Platforms — collapsed by default. Summary chip shows current
            selection; click to expand the full toggle row. */}
        <div>
          {!showPlatforms ? (
            <button onClick={() => setShowPlatforms(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 10px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-subtle)' }}>Platforms</span>
                <span style={{ color: platforms.length ? 'var(--palm-pink)' : 'var(--foreground-subtle)' }}>
                  {platforms.length === 0 ? 'none' : platforms.length === 1 ? platforms[0] : `${platforms[0]} +${platforms.length - 1}`}
                </span>
              </span>
              <span style={{ color: 'var(--foreground-subtle)', fontSize: '10px' }}>edit ▾</span>
            </button>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Platforms</div>
                <button onClick={() => setShowPlatforms(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', fontSize: '10px', cursor: 'pointer', padding: 0 }}>
                  collapse ▴
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {PLATFORMS.map(p => (
                  <button key={p} onClick={() => togglePlatform(p)}
                    style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, border: '1px solid', cursor: 'pointer',
                      background: platforms.includes(p) ? 'rgba(232, 160, 160, 0.06)' : 'transparent',
                      color: platforms.includes(p) ? 'var(--palm-pink)' : '#3f3f46',
                      borderColor: platforms.includes(p) ? 'var(--palm-pink)' : 'transparent' }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Hashtags — collapsed by default. Summary shows count or "+ Add" */}
        <div>
          {!showHashtags ? (
            <button onClick={() => setShowHashtags(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 10px', background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-subtle)' }}>Hashtags</span>
                <span style={{ color: hashtags.trim() ? 'var(--palm-pink)' : 'var(--foreground-subtle)' }}>
                  {(() => {
                    const tags = hashtags.match(/#\w+/g) || []
                    if (!tags.length) return '+ add'
                    if (tags.length === 1) return tags[0]
                    return `${tags.length} tags`
                  })()}
                </span>
              </span>
              <span style={{ color: 'var(--foreground-subtle)', fontSize: '10px' }}>edit ▾</span>
            </button>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hashtags</div>
                <button onClick={() => setShowHashtags(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', fontSize: '10px', cursor: 'pointer', padding: 0 }}>
                  collapse ▴
                </button>
              </div>
              <textarea value={hashtags} onChange={e => { setHashtags(e.target.value); setEditing(true) }}
                placeholder="#hashtag1 #hashtag2..." rows={2}
                style={{ width: '100%', background: 'var(--card-bg-solid)', border: '1px solid transparent', borderRadius: '6px', color: 'var(--palm-pink)', fontSize: '12px', padding: '7px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
          )}
        </div>

        {videoModal && (
          <PostVideoModal
            streamUid={videoModal.streamUid}
            url={videoModal.url}
            onClose={() => setVideoModal(null)}
          />
        )}

        {showFramePicker && (
          <VideoFramePicker
            videoUrl={sourceVideoUrl}
            streamUid={post.asset?.streamRawId || null}
            postId={post.id}
            onCapture={(url) => {
              setThumbnailUrl(url)
              setEditing(false) // already saved to Airtable by the frame API
            }}
            onClose={() => setShowFramePicker(false)}
          />
        )}

        {showPhotoPicker && (
          <PhotoPickerModal
            creatorId={post.creator?.id}
            platforms={platforms}
            onSelect={async (url) => {
              // Airtable's attachment ingester needs a URL that returns the
              // actual image bytes. Dropbox ?dl=0 returns an HTML preview
              // page, so Airtable can't ingest it and the field stays empty —
              // which is why the thumbnail disappeared after refresh. Rewrite
              // to ?raw=1 so Dropbox serves the raw image.
              const rawUrl = rawDropboxUrl(url)
              setThumbnailUrl(rawUrl)
              setShowPhotoPicker(false)
              await fetch('/api/admin/posts', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postId: post.id, fields: { 'Thumbnail': [{ url: rawUrl }] } }),
              })
            }}
            onClose={() => setShowPhotoPicker(false)}
          />
        )}

        {/* Scheduled Date — single quiet line, displayed in Eastern Time */}
        {scheduledDate && (() => {
          const label = formatScheduledLabel(post.scheduledDate || etLocalToUTC(scheduledDate))
          return label ? (
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
              <span style={{ color: 'var(--foreground-subtle)' }}>Scheduled · </span>{label}
            </div>
          ) : null
        })()}

        {/* Actions — bigger touch targets, vertical stack so nothing gets
            squeezed when Save appears. Send to Grid is the primary action,
            View opens the edited file in a new tab as a quiet text link. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'auto' }}>
          {editing ? (
            <button onClick={handleSave} disabled={saving}
              style={{ width: '100%', padding: '9px', fontSize: '12px', fontWeight: 700, background: saving ? 'rgba(125, 211, 164, 0.06)' : 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid transparent', borderRadius: '8px', cursor: saving ? 'default' : 'pointer' }}>
              {saved ? 'Saved ✓' : saving ? 'Saving...' : 'Save'}
            </button>
          ) : null}
          {/* Send action lives in Grid Planner now — Post Prep just preps.
              Clicking stages the post (status → 'Staged'), which removes it
              from this list. It remains visible + draggable in Grid Planner. */}
          {post.status === 'Prepping' && hasFile && (
            <button
              onClick={handleSendToGrid}
              disabled={sendingToGrid}
              style={{ width: '100%', padding: '9px', fontSize: '12px', fontWeight: 700, textAlign: 'center',
                background: sendingToGrid ? 'rgba(232, 160, 160, 0.04)' : 'rgba(232, 160, 160, 0.06)',
                color: 'var(--palm-pink)',
                border: '1px solid rgba(232, 160, 160, 0.2)', borderRadius: '8px',
                cursor: sendingToGrid ? 'default' : 'pointer' }}
              title="Post is ready — stage it for Grid Planner and remove from prep list"
            >
              {sendingToGrid ? 'Sending…' : '▦ Send to Grid →'}
            </button>
          )}
          {post.telegramSentAt && (
            <div style={{ fontSize: '11px', color: '#78B4E8', background: 'rgba(120, 180, 232, 0.06)', border: '1px solid transparent', borderRadius: '6px', padding: '5px 10px', textAlign: 'center' }}>
              ✈ Sent {new Date(post.telegramSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
          {post.asset?.editedFileLink && (
            <a href={post.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '10px', color: 'var(--foreground-subtle)', textAlign: 'center', textDecoration: 'underline', textUnderlineOffset: '2px', padding: '2px 0' }}>
              View edit ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function LogHistoricalPostModal({ creators, onClose, onSaved }) {
  const [creatorId, setCreatorId] = useState('')
  const [postName, setPostName] = useState('')
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('morning')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!date) { setError('Date is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creatorId || null, postName, date, slot }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const inputStyle = { width: '100%', background: 'var(--background)', border: '1px solid transparent', borderRadius: '7px', padding: '8px 10px', fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
  const labelStyle = { fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px', display: 'block' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>Log Historical Post</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        <div>
          <label style={labelStyle}>Creator</label>
          <select value={creatorId} onChange={e => setCreatorId(e.target.value)} style={{ ...inputStyle, appearance: 'none' }}>
            <option value="">— Select creator —</option>
            {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Post Name (optional)</label>
          <input value={postName} onChange={e => setPostName(e.target.value)} placeholder="e.g. Gracie – Gym set" style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Post Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Slot</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['morning', 'evening'].map(s => (
              <button key={s} onClick={() => setSlot(s)}
                style={{ flex: 1, padding: '8px', fontSize: '12px', fontWeight: 700, borderRadius: '7px', cursor: 'pointer', textTransform: 'capitalize',
                  background: slot === s ? 'rgba(232, 160, 160, 0.06)' : 'var(--background)',
                  color: slot === s ? 'var(--palm-pink)' : '#999',
                  border: `1px solid ${slot === s ? 'var(--palm-pink)' : 'transparent'}` }}>
                {s === 'morning' ? '☀ Morning (~10am)' : '🌙 Evening (~7pm)'}
              </button>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: '12px', color: '#E87878' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', fontSize: '13px', fontWeight: 600, background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '8px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving || !date}
            style={{ flex: 2, padding: '10px', fontSize: '13px', fontWeight: 700, background: saving || !date ? 'rgba(255,255,255,0.08)' : 'rgba(125, 211, 164, 0.08)', color: saving || !date ? '#3f3f46' : '#7DD3A4', border: `1px solid ${saving || !date ? 'rgba(255,255,255,0.04)' : 'rgba(125, 211, 164, 0.2)'}`, borderRadius: '8px', cursor: saving || !date ? 'default' : 'pointer' }}>
            {saving ? 'Saving...' : 'Log Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Filter logic:
//   Needs Prep = Prepping AND missing thumbnail OR caption OR hashtags (default view)
//   Saved      = Prepping AND has thumbnail + caption + hashtags (ready to send from Grid Planner)
//   Sent to Telegram / Ready to Post = by Post Status
//   All        = no filter
const STATUS_FILTERS = ['Needs Prep', 'Saved', 'Sent to Telegram', 'Ready to Post', 'All']

function isFullyPrepped(p) {
  const hasThumb = (p.thumbnail?.length > 0) || !!p.thumbnailUrl
  const hasCaption = !!(p.caption && p.caption.trim())
  const hasHashtags = !!(p.hashtags && p.hashtags.trim())
  return hasThumb && hasCaption && hasHashtags
}

function matchesFilter(p, filter) {
  if (filter === 'All') return true
  if (filter === 'Needs Prep') return p.status === 'Prepping' && !isFullyPrepped(p)
  if (filter === 'Saved') return p.status === 'Prepping' && isFullyPrepped(p)
  return p.status === filter
}

export default function PostsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Post Prep shows ONLY prepping posts. No filter tabs — once a post is
  // ready, admin clicks "Send to Grid" to move it off the prep list into
  // the Grid Planner for scheduling + sending.
  const filter = 'Prepping'
  const [creatorFilter, setCreatorFilter] = useState('all')
  const [telegramModal, setTelegramModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [logModal, setLogModal] = useState(false)

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  // silent=true keeps the cards on screen during refetch instead of flashing
  // the "Loading…" placeholder + collapsing the grid. Used after Send to Grid
  // / Save / etc. so the user sees the affected card disappear in place
  // rather than the whole list jumping around.
  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch('/api/admin/posts')
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const json = await res.json()
      setData(json)
      return json
    } catch (err) {
      if (!silent) setError(err.message)
      return null
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Deep-link from Grid Planner: `?focusPost=recXXX` scrolls the matching
  // card into view and pulses a highlight ring around it. Lets the admin
  // jump straight from a grid cell into Post Prep with the right card open.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const focusId = params.get('focusPost')
    if (!focusId || !data) return
    // Wait one tick for cards to render
    const t = setTimeout(() => {
      const el = document.getElementById(`post-card-${focusId}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.style.boxShadow = '0 0 0 3px var(--palm-pink)'
      el.style.transition = 'box-shadow 0.4s ease'
      setTimeout(() => { el.style.boxShadow = '' }, 3000)
    }, 200)
    return () => clearTimeout(t)
  }, [data])
  // Silent variant for child callers — cards passed onRefresh trigger a
  // background refetch without the loading flash.
  const silentRefresh = useCallback(() => fetchData({ silent: true }), [fetchData])

  const posts = data?.posts || []
  const allPrepping = posts.filter(p => matchesFilter(p, filter))
  const filtered = creatorFilter === 'all'
    ? allPrepping
    : allPrepping.filter(p => p.creator?.id === creatorFilter)

  // Build creator dropdown options from whoever has prepping posts
  const creatorOptions = (() => {
    const m = new Map()
    for (const p of allPrepping) {
      if (p.creator?.id && !m.has(p.creator.id)) {
        m.set(p.creator.id, p.creator.name || '(unnamed)')
      }
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  })()

  return (
    <div style={{ color: 'var(--foreground)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}
            style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 500, background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid transparent', borderRadius: '7px', cursor: 'pointer', outline: 'none' }}>
            <option value="all">All creators</option>
            {creatorOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <button onClick={() => setLogModal(true)} style={{ background: 'rgba(125, 211, 164, 0.08)', border: '1px solid transparent', color: '#7DD3A4', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            + Log Historical Post
          </button>
          <button onClick={fetchData} style={{ background: 'none', border: '1px solid transparent', color: 'var(--foreground-muted)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            Refresh
          </button>
        </div>
      </div>

      {/* Header — Post Prep is prepping-only, no filter tabs */}
      <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '24px' }}>
        {filtered.length} post{filtered.length !== 1 && 's'} to prep
        {creatorFilter !== 'all' && allPrepping.length !== filtered.length && (
          <span> · filtered from {allPrepping.length}</span>
        )}
        {' '}· Use <span style={{ color: 'var(--palm-pink)', fontWeight: 600 }}>Send to Grid</span> when ready
      </div>

      {loading && <div style={{ color: 'var(--foreground-muted)', textAlign: 'center', padding: '60px' }}>Loading...</div>}
      {error && <div style={{ color: '#E87878', padding: '20px' }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ color: 'var(--foreground-muted)', textAlign: 'center', padding: '60px', fontSize: '14px' }}>
          No posts in this state yet. Approve an edit to create a post.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: '16px' }}>
        {filtered.map(post => (
          <PostCard key={post.id} post={post} onRefresh={silentRefresh} onSend={p => setTelegramModal(p)} />
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 300, padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.isError ? 'rgba(232, 120, 120, 0.06)' : 'rgba(125, 211, 164, 0.08)', color: toast.isError ? '#E87878' : '#7DD3A4',
          border: `1px solid ${toast.isError ? '#fecdd3' : 'rgba(125, 211, 164, 0.2)'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
          {toast.msg}
        </div>
      )}

      {telegramModal && (
        <TelegramModal
          post={telegramModal}
          onClose={() => setTelegramModal(null)}
          onSent={() => {
            showToast('Queued — sending in background ⏳', false)
            fetchData()
            // Poll every 4s for up to 3 min to watch the Post flip from
            // Sending → Sent to Telegram (or Send Failed). No UI lock-up —
            // the admin can start working on the next post immediately.
            let attempts = 0
            const poll = setInterval(async () => {
              attempts++
              if (attempts > 45) { clearInterval(poll); return }
              const latest = await fetchData()
              const thisPost = latest?.posts?.find(p => p.id === telegramModal.id)
              if (!thisPost || thisPost.status === 'Sending') return
              clearInterval(poll)
              if (thisPost.status === 'Sent to Telegram' || thisPost.status === 'Ready to Post') {
                showToast('Sent to Telegram ✓', false)
              } else if (thisPost.status === 'Send Failed') {
                showToast('Send failed — check Admin Notes on post', true)
              }
            }, 4000)
          }}
        />
      )}

      {logModal && (
        <LogHistoricalPostModal
          creators={data?.creators || []}
          onClose={() => setLogModal(false)}
          onSaved={() => { showToast('Historical post logged ✓'); fetchData() }}
        />
      )}
    </div>
  )
}
