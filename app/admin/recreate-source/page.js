'use client'

import { useEffect, useState, useCallback } from 'react'

const STATUS_COLORS = { Queued: '#888', Scraping: '#E8C36A', Ready: '#6AC68A', Error: '#E87878' }

function LibraryReel({ reel, onRemove }) {
  // Show the Dropbox video itself (first frame via #t media fragment) so
  // every card previews with no click. IG thumbnails often fail to
  // attach for age-restricted reels, so we don't depend on them — the
  // thumbnail, when present, is just a fast-painting poster.
  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '9/16' }}>
      {reel.video ? (
        <video
          src={`${reel.video}#t=0.1`}
          poster={reel.thumbnail || undefined}
          preload="metadata"
          muted
          playsInline
          controls
          style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: 11 }}>no video</div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.7)', padding: '1px 6px', borderRadius: 4, fontSize: 10, color: '#ddd' }}>@{reel.handle}</div>
      <button
        onClick={() => onRemove(reel)}
        title="Remove from library (deletes the Dropbox file)"
        style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.65)', color: '#E87878', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: '22px', padding: 0 }}
      >×</button>
      {reel.producedForCount > 0 && (
        <div style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(106,198,138,0.85)', padding: '1px 6px', borderRadius: 4, fontSize: 9, color: '#0a1a0f', fontWeight: 700 }}>
          produced ×{reel.producedForCount}
        </div>
      )}
    </div>
  )
}

export default function RecreateLibraryPage() {
  const [sources, setSources] = useState([])
  const [reels, setReels] = useState([])
  const [handles, setHandles] = useState('')
  const [maxReels, setMaxReels] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/recreate-sources')
      const data = await res.json()
      if (res.ok) { setSources(data.sources || []); setReels(data.reels || []) }
      else setMsg(data.error || 'Failed to load')
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!sources.some(s => s.status === 'Scraping')) return
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [sources, load])

  const addHandles = async () => {
    if (!handles.trim()) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/admin/recreate-sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles, maxReels: maxReels ? Number(maxReels) : undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg(`Added ${data.created?.length || 0} (max ${data.maxReels}/account)${data.skipped?.length ? `, skipped ${data.skipped.length}` : ''}`)
        setHandles(''); load()
      } else setMsg(data.error || 'Failed')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const scrapeQueued = async () => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/admin/recreate-scrape', { method: 'POST' })
      const data = await res.json()
      setMsg(res.ok ? `Started ${data.started?.length || 0} scrape(s)` : (data.error || 'Failed'))
      load()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const removeReel = async (reel) => {
    if (!confirm(`Remove ${reel.reelId} from the library? This deletes the Dropbox file.`)) return
    setReels(prev => prev.filter(r => r.id !== reel.id))
    try { await fetch(`/api/admin/recreate-sources?reelId=${reel.id}`, { method: 'DELETE' }) }
    catch (e) { setMsg(e.message); load() }
  }

  const removeSource = async (id) => {
    if (!confirm('Remove this account from the library?')) return
    try { await fetch(`/api/admin/recreate-sources?id=${id}`, { method: 'DELETE' }); load() }
    catch (e) { setMsg(e.message) }
  }

  const queuedCount = sources.filter(s => s.status === 'Queued').length
  const shownReels = filter ? reels.filter(r => r.handle.toLowerCase().includes(filter.toLowerCase())) : reels

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>AI Recreate Library</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 20 }}>
        One global pool. Add accounts → scrape → reels land here for every AI editor. They&apos;re filtered per-creator only by what&apos;s already been produced.
      </p>

      {/* Add accounts */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <label style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instagram handles</label>
          <textarea value={handles} onChange={e => setHandles(e.target.value)} rows={2}
            placeholder="latinamamiisabella, anotheraccount — one per line or comma-separated"
            style={{ width: '100%', marginTop: 6, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>
        <div style={{ width: 110 }}>
          <label style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max reels</label>
          <input type="number" value={maxReels} onChange={e => setMaxReels(e.target.value)} placeholder="50" min={1} max={500}
            style={{ width: '100%', marginTop: 6, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 13 }} />
        </div>
        <button onClick={addHandles} disabled={busy || !handles.trim()}
          style={{ marginTop: 22, padding: '9px 18px', background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy || !handles.trim() ? 0.5 : 1 }}>
          Add
        </button>
      </div>

      {/* Account strip */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {sources.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, fontSize: 12 }}>
            <span style={{ color: 'var(--foreground)' }}>@{s.handle}</span>
            <span style={{ color: STATUS_COLORS[s.status] || '#888', fontWeight: 700, fontSize: 10 }}>{s.status}</span>
            <span style={{ color: 'var(--foreground-muted)', fontSize: 10 }}>{s.reelsStored}/{s.reelsFound || s.maxReels || '—'}</span>
            <button onClick={() => removeSource(s.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 13, padding: 0 }}>×</button>
          </div>
        ))}
        {sources.length === 0 && !loading && <span style={{ color: '#666', fontSize: 12 }}>No accounts yet.</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by handle…"
          style={{ padding: '7px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, width: 220 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>{shownReels.length} reels in library</span>
          <button onClick={scrapeQueued} disabled={busy || queuedCount === 0}
            style={{ padding: '8px 16px', background: queuedCount ? 'rgba(106,198,138,0.15)' : 'transparent', color: queuedCount ? '#6AC68A' : '#666', border: `1px solid ${queuedCount ? 'rgba(106,198,138,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: queuedCount && !busy ? 'pointer' : 'default' }}>
            Scrape {queuedCount} Queued →
          </button>
        </div>
      </div>

      {msg && <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>{msg}</div>}

      {loading ? (
        <div style={{ padding: 50, textAlign: 'center', color: '#666', fontSize: 13 }}>Loading…</div>
      ) : shownReels.length === 0 ? (
        <div style={{ padding: 50, textAlign: 'center', color: '#666', fontSize: 13 }}>No reels yet — add accounts and Scrape Queued.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {shownReels.map(r => <LibraryReel key={r.id} reel={r} onRemove={removeReel} />)}
        </div>
      )}
    </div>
  )
}
