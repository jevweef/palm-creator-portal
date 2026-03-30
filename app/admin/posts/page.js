'use client'

import { useState, useEffect, useCallback } from 'react'

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
  const [caption, setCaption] = useState(post.caption || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const editedFileLink = post.asset?.editedFileLink || ''

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
          caption: caption.trim() || undefined,
          taskName: post.name,
          postId: post.id,
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
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '28px', width: '100%', maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#d4d4d8' }}>Send to Telegram</div>
            <div style={{ fontSize: '12px', color: '#52525b', marginTop: '2px' }}>{post.creator?.name} · {post.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        {editedFileLink ? (
          <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '8px', padding: '10px 14px' }}>
            <div style={{ fontSize: '10px', color: '#3f3f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>File</div>
            <a href={editedFileLink} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '12px', color: '#a78bfa', textDecoration: 'none', wordBreak: 'break-all' }}>
              {editedFileLink}
            </a>
          </div>
        ) : (
          <div style={{ background: '#1a0a0a', border: '1px solid #3d1515', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#ef4444' }}>
            No edited file link on this post.
          </div>
        )}

        <div>
          <div style={{ fontSize: '11px', color: '#52525b', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Caption <span style={{ color: '#3f3f46', fontWeight: 400, textTransform: 'none' }}>(optional)</span>
          </div>
          <textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="Add caption..."
            rows={5} style={{ width: '100%', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#d4d4d8', fontSize: '13px', padding: '10px 12px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
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

function PostCard({ post, onRefresh, onSend }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(post.caption)
  const [hashtags, setHashtags] = useState(post.hashtags)
  const [platforms, setPlatforms] = useState(post.platform?.length ? post.platform : ['Instagram Reel'])
  const [scheduledDate, setScheduledDate] = useState(post.scheduledDate ? post.scheduledDate.slice(0, 16) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState(post.thumbnail?.[0]?.url || '')
  const [uploading, setUploading] = useState(false)

  const rawUrl = rawDropboxUrl(post.asset?.editedFileLink || '')
  const hasFile = !!post.asset?.editedFileLink

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
      <div style={{ width: '200px', flexShrink: 0, background: '#080808', position: 'relative', aspectRatio: '9/16' }}>
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
            {thumbnailUrl && (
              <img src={rawDropboxUrl(thumbnailUrl)} alt="thumbnail"
                style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #2a2a2a', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', padding: '6px 10px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px', fontSize: '11px', color: '#71717a', cursor: 'pointer', textAlign: 'center' }}>
                {uploading ? 'Uploading...' : thumbnailUrl ? 'Replace thumbnail' : '+ Upload thumbnail'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setUploading(true)
                  try {
                    const form = new FormData()
                    form.append('file', file)
                    form.append('postId', post.id)
                    const res = await fetch('/api/admin/posts/thumbnail', { method: 'POST', body: form })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)
                    setThumbnailUrl(data.url)
                    setEditing(false)
                  } catch (err) {
                    console.error('Thumbnail upload failed:', err)
                  } finally {
                    setUploading(false)
                  }
                }} />
              </label>
            </div>
          </div>
        </div>

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
            <button onClick={() => onSend(post)} disabled={!hasFile}
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
  const [filter, setFilter] = useState('All')
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
