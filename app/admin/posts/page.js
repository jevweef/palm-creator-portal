'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const PLATFORMS = ['Instagram Reel', 'Instagram Story', 'TikTok', 'YouTube Shorts', 'X', 'OFTV']
const STATUS_COLORS = {
  'Prepping': '#ca8a04',
  'Sent to Telegram': '#3b82f6',
  'Ready to Post': '#22c55e',
  'Posted': '#a78bfa',
  'Archived': '#52525b',
}

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

function isVideo(url) {
  return /\.(mp4|mov|avi|webm|mkv)/i.test(url || '')
}

function TelegramModal({ post, onClose, onSent }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const editedFileLink = post.asset?.editedFileLink || ''
  const scheduledDate = post.scheduledDate
    ? new Date(post.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
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
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#d4d4d8' }}>Send to Telegram?</div>
            <div style={{ fontSize: '12px', color: '#52525b', marginTop: '2px' }}>{post.creator?.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        {!editedFileLink && (
          <div style={{ background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ef4444' }}>
            No edited file link on this post.
          </div>
        )}

        {/* Video + Thumbnail side by side */}
        {editedFileLink && (
          <div style={{ display: 'grid', gridTemplateColumns: thumbRawUrl ? '1fr 1fr' : '1fr', gap: '8px' }}>
            <div style={{ background: '#080808', borderRadius: '8px', overflow: 'hidden', aspectRatio: '9/16', border: '1px solid #1e1e1e' }}>
              <video src={videoRawUrl} muted loop autoPlay playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            {thumbRawUrl && (
              <div style={{ background: '#080808', borderRadius: '8px', overflow: 'hidden', aspectRatio: '9/16', border: '1px solid #1e1e1e' }}>
                <img src={thumbRawUrl} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            )}
          </div>
        )}

        {/* Caption / hashtags / date */}
        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '8px', overflow: 'hidden' }}>
          {fullCaption ? (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: '13px', color: '#d4d4d8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{fullCaption}</div>
            </div>
          ) : (
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: '12px', color: '#3f3f46', fontStyle: 'italic' }}>No caption, hashtags, or date set</div>
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: '12px', color: '#ef4444', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '8px 12px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#71717a', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !editedFileLink}
            style={{ flex: 2, padding: '10px', background: sending || !editedFileLink ? '#0d1a0d' : '#0f2d0f', border: `1px solid ${sending || !editedFileLink ? '#1a3d1a' : '#1a5c1a'}`, color: sending || !editedFileLink ? '#2d5c2d' : '#22c55e', borderRadius: '8px', cursor: sending || !editedFileLink ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
            {sending ? 'Sending...' : '✈ Confirm & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

const REEL_PLATFORMS = ['Instagram Reel', 'TikTok', 'YouTube Shorts']

function PhotoPickerModal({ creatorId, platforms, onSelect, onClose }) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null) // photo being previewed
  const isReel = (platforms || []).some(p => REEL_PLATFORMS.includes(p))

  useEffect(() => {
    fetch(`/api/admin/posts/photos?creatorId=${creatorId}&forReel=${isReel}`)
      .then(r => r.json())
      .then(d => { setPhotos(d.photos || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [creatorId, isReel])

  const handleUse = async (photo) => {
    if (isReel) {
      await fetch('/api/admin/posts/photos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: photo.id }),
      })
    }
    onSelect(photo.dropboxLink)
  }

  // Preview mode
  if (preview) {
    const rawUrl = rawDropboxUrl(preview.dropboxLink)
    return (
      <div onClick={e => e.target === e.currentTarget && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => setPreview(null)}
              style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
              ← Back
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
          <div style={{ background: '#080808', aspectRatio: '4/3', overflow: 'hidden' }}>
            <img src={rawUrl} alt={preview.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setPreview(null)}
              style={{ flex: 1, padding: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#71717a', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              Choose different
            </button>
            <button onClick={() => handleUse(preview)}
              style={{ flex: 2, padding: '10px', background: '#1a1a3e', border: '1px solid #4a4a9e', color: '#a78bfa', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#d4d4d8' }}>Choose Thumbnail</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>
        <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>
          {isReel && (
            <div style={{ fontSize: '11px', color: '#52525b', marginBottom: '12px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '6px 10px' }}>
              Showing unused photos only — photos already used as reel thumbnails are hidden.
            </div>
          )}
          {loading && <div style={{ color: '#3f3f46', textAlign: 'center', padding: '40px' }}>Loading photos...</div>}
          {!loading && photos.length === 0 && (
            <div style={{ color: '#3f3f46', textAlign: 'center', padding: '40px', fontSize: '13px' }}>
              {isReel ? 'No unused photos left — all have been used as reel thumbnails.' : 'No photos in library for this creator.'}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px' }}>
            {photos.map(photo => {
              const rawUrl = rawDropboxUrl(photo.dropboxLink)
              return (
                <div key={photo.id} onClick={() => setPreview(photo)}
                  style={{ aspectRatio: '1', overflow: 'hidden', borderRadius: '6px', border: '2px solid transparent', cursor: 'pointer', transition: 'border-color 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#a78bfa'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                  <img src={rawUrl} alt={photo.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function VideoFramePicker({ videoUrl, postId, onCapture, onClose }) {
  const videoRef = useRef(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const [capturedUrl, setCapturedUrl] = useState(null)
  const [error, setError] = useState('')

  const rawUrl = rawDropboxUrl(videoUrl)

  const handleScrub = (e) => {
    const t = parseFloat(e.target.value)
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  const handleCapture = async () => {
    setCapturing(true)
    setError('')
    try {
      // Step 1: extract the frame from the video server-side
      const frameRes = await fetch('/api/admin/posts/thumbnail/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, timestamp: currentTime }),
      })
      const frameData = await frameRes.json()
      if (!frameRes.ok) throw new Error(frameData.error || 'Frame extraction failed')

      // Step 2: upload the JPEG to Dropbox via the existing thumbnail endpoint
      const blob = new Blob([Uint8Array.from(atob(frameData.jpeg), c => c.charCodeAt(0))], { type: 'image/jpeg' })
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
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', width: '100%', maxWidth: '380px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#d4d4d8' }}>Frame captured</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
          <div style={{ background: '#080808', aspectRatio: '9/16', overflow: 'hidden' }}>
            <img src={rawDropboxUrl(capturedUrl)} alt="captured frame" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setCapturedUrl(null)}
              style={{ flex: 1, padding: '10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#71717a', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              Try another
            </button>
            <button onClick={() => { onCapture(capturedUrl); onClose() }}
              style={{ flex: 2, padding: '10px', background: '#1a1a3e', border: '1px solid #4a4a9e', color: '#a78bfa', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
              Use this frame
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Scrubber mode
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', width: '100%', maxWidth: '380px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#d4d4d8' }}>Pick a frame</div>
            <div style={{ fontSize: '11px', color: '#52525b', marginTop: '2px' }}>Scrub to position — original file, no text overlays</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        {/* Video preview */}
        <div style={{ background: '#080808', aspectRatio: '9/16', overflow: 'hidden' }}>
          <video
            ref={videoRef}
            src={rawUrl}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
            onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>

        {/* Scrubber + capture */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#71717a', minWidth: '32px', fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={handleScrub}
              style={{ flex: 1, accentColor: '#a78bfa', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '11px', color: '#52525b', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTime(duration)}</span>
          </div>

          {error && <div style={{ fontSize: '11px', color: '#ef4444', background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '6px', padding: '6px 10px' }}>{error}</div>}

          <button
            onClick={handleCapture}
            disabled={capturing || !duration}
            style={{ padding: '10px', background: capturing || !duration ? '#0d0d0d' : '#1a1a3e', border: '1px solid #4a4a9e', color: capturing || !duration ? '#3f3f46' : '#a78bfa', borderRadius: '8px', cursor: capturing || !duration ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}>
            {capturing ? 'Capturing...' : '📸 Capture this frame'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PostCard({ post, onRefresh, onSend }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(post.caption)
  const [hashtags, setHashtags] = useState(post.hashtags)
  const [platforms, setPlatforms] = useState(post.platform?.length ? post.platform : ['Instagram Reel'])
  const [scheduledDate, setScheduledDate] = useState(post.scheduledDate ? post.scheduledDate.slice(0, 16) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState(post.thumbnail?.[0]?.url || '')
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)
  const [showFramePicker, setShowFramePicker] = useState(false)

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
            ...(scheduledDate ? { 'Scheduled Date': new Date(scheduledDate).toISOString() } : {}),
            ...(thumbnailUrl ? { 'Thumbnail': [{ url: thumbnailUrl }] } : {}),
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

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>

      {/* Left — video at 9:16 */}
      <div style={{ width: '300px', flexShrink: 0, background: '#080808', position: 'relative', aspectRatio: '9/16' }}>
        {hasFile ? (
          isVideo(post.asset.editedFileLink) ? (
            <video src={rawUrl} autoPlay muted loop playsInline preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }}
              onClick={e => { e.currentTarget.muted = !e.currentTarget.muted }} />
          ) : (
            <img src={rawUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: '11px' }}>No file</div>
        )}
        <div style={{ position: 'absolute', bottom: '6px', left: '6px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: STATUS_COLORS[post.status] || '#71717a',
            background: 'rgba(0,0,0,0.8)', border: `1px solid ${STATUS_COLORS[post.status] || '#2a2a2a'}40`,
            padding: '2px 7px', borderRadius: '20px' }}>
            {post.status}
          </div>
        </div>
      </div>

      {/* Right — all fields */}
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' }}>
        {/* Header */}
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#d4d4d8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.name}</div>
          <div style={{ fontSize: '11px', color: '#52525b', marginTop: '1px' }}>{post.creator?.name}</div>
        </div>

        {/* Platforms */}
        <div>
          <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Platforms</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => togglePlatform(p)}
                style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, border: '1px solid', cursor: 'pointer',
                  background: platforms.includes(p) ? '#1a1a3e' : 'transparent',
                  color: platforms.includes(p) ? '#a78bfa' : '#3f3f46',
                  borderColor: platforms.includes(p) ? '#4a4a9e' : '#2a2a2a' }}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Caption */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Caption</div>
          <textarea value={caption} onChange={e => { setCaption(e.target.value); setEditing(true) }}
            placeholder="Add caption..." rows={3}
            style={{ width: '100%', background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', color: '#d4d4d8', fontSize: '12px', padding: '7px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        </div>

        {/* Hashtags */}
        <div>
          <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Hashtags</div>
          <textarea value={hashtags} onChange={e => { setHashtags(e.target.value); setEditing(true) }}
            placeholder="#hashtag1 #hashtag2..." rows={2}
            style={{ width: '100%', background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', color: '#a78bfa', fontSize: '12px', padding: '7px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        </div>

        {/* Thumbnail */}
        <div>
          <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Thumbnail</div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
            {thumbnailUrl ? (
              <img src={rawDropboxUrl(thumbnailUrl)} alt="thumbnail"
                style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #2a2a2a', flexShrink: 0, cursor: 'pointer' }}
                onClick={() => setShowPhotoPicker(true)} />
            ) : null}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <button onClick={() => setShowPhotoPicker(true)}
                style={{ width: '100%', padding: '5px 10px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', fontSize: '11px', color: '#71717a', cursor: 'pointer', textAlign: 'center' }}>
                {thumbnailUrl ? 'Change — from library' : '+ Choose from library'}
              </button>
              {canPickFrame && (
                <button onClick={() => setShowFramePicker(true)}
                  style={{ width: '100%', padding: '5px 10px', background: '#0d0d1a', border: '1px solid #1e1e3e', borderRadius: '6px', fontSize: '11px', color: '#7c7cb8', cursor: 'pointer', textAlign: 'center' }}>
                  🎞 Pick from video
                </button>
              )}
            </div>
          </div>
        </div>

        {showFramePicker && (
          <VideoFramePicker
            videoUrl={sourceVideoUrl}
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
              setThumbnailUrl(url)
              setShowPhotoPicker(false)
              await fetch('/api/admin/posts', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postId: post.id, fields: { 'Thumbnail': [{ url }] } }),
              })
            }}
            onClose={() => setShowPhotoPicker(false)}
          />
        )}

        {/* Scheduled Date */}
        <div>
          <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>Scheduled Date</div>
          <input type="datetime-local" value={scheduledDate} onChange={e => { setScheduledDate(e.target.value); setEditing(true) }}
            style={{ width: '100%', background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', color: '#d4d4d8', fontSize: '12px', padding: '6px 10px', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }} />
        </div>

        {post.telegramSentAt && (
          <div style={{ fontSize: '11px', color: '#3b82f6', background: '#0a1628', border: '1px solid #1a3d6a', borderRadius: '6px', padding: '5px 10px' }}>
            ✈ Sent {new Date(post.telegramSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
          {editing && (
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '7px', fontSize: '11px', fontWeight: 700, background: saving ? '#0a1a0a' : '#0f2d0f', color: saving ? '#2d5c2d' : '#22c55e', border: '1px solid #1a5c1a', borderRadius: '6px', cursor: saving ? 'default' : 'pointer' }}>
              {saved ? 'Saved ✓' : saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {post.status === 'Prepping' && (
            <button onClick={() => onSend({ ...post, caption, hashtags, platform: platforms, thumbnailUrl, scheduledDate })} disabled={!hasFile}
              style={{ flex: 1, padding: '7px', fontSize: '11px', fontWeight: 700,
                background: hasFile ? '#0d1a2e' : '#111', color: hasFile ? '#60a5fa' : '#2a2a2a',
                border: `1px solid ${hasFile ? '#1a3d6a' : '#1a1a1a'}`, borderRadius: '6px', cursor: hasFile ? 'pointer' : 'default' }}>
              ✈ Telegram
            </button>
          )}
          {post.asset?.editedFileLink && (
            <a href={post.asset.editedFileLink} target="_blank" rel="noopener noreferrer"
              style={{ padding: '7px 10px', fontSize: '11px', fontWeight: 600, background: '#1a1a1a', color: '#71717a', border: '1px solid #2a2a2a', borderRadius: '6px', textDecoration: 'none' }}>
              View ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

const STATUS_FILTERS = ['All', 'Prepping', 'Sent to Telegram', 'Ready to Post']

export default function PostsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('Prepping')
  const [telegramModal, setTelegramModal] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/posts')
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      setData(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const posts = data?.posts || []
  const filtered = filter === 'All' ? posts : posts.filter(p => p.status === filter)

  return (
    <div style={{ color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: '#d4d4d8' }}>Post Prep</h1>
          <div style={{ fontSize: '12px', color: '#52525b', marginTop: '4px' }}>
            {posts.length} post{posts.length !== 1 ? 's' : ''} in queue
          </div>
        </div>
        <button onClick={fetchData} style={{ background: 'none', border: '1px solid #2a2a2a', color: '#52525b', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '3px', marginBottom: '24px', width: 'fit-content' }}>
        {STATUS_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '5px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer',
              background: filter === f ? '#1e1e1e' : 'transparent',
              color: filter === f ? '#d4d4d8' : '#52525b' }}>
            {f}
            {f !== 'All' && (
              <span style={{ marginLeft: '6px', color: filter === f ? '#71717a' : '#3f3f46', fontWeight: 400 }}>
                {posts.filter(p => p.status === f).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: '#3f3f46', textAlign: 'center', padding: '60px' }}>Loading...</div>}
      {error && <div style={{ color: '#ef4444', padding: '20px' }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ color: '#3f3f46', textAlign: 'center', padding: '60px', fontSize: '14px' }}>
          No posts in this state yet. Approve an edit to create a post.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: '16px' }}>
        {filtered.map(post => (
          <PostCard key={post.id} post={post} onRefresh={fetchData} onSend={p => setTelegramModal(p)} />
        ))}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 300, padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.isError ? '#2d1515' : '#0a2e0a', color: toast.isError ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.isError ? '#5c2020' : '#1a5c1a'}`, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {telegramModal && (
        <TelegramModal
          post={telegramModal}
          onClose={() => setTelegramModal(null)}
          onSent={() => { showToast('Sent to Telegram ✓'); fetchData() }}
        />
      )}
    </div>
  )
}
