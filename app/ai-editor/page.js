'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { buildStreamIframeUrl, buildStreamPosterUrl } from '@/lib/cfStreamUrl'

function ReelCard({ reel, creatorId, selected, onToggle, onUploaded, autoOpen }) {
  const [showPlayer, setShowPlayer] = useState(false)
  const [showUpload, setShowUpload] = useState(!!autoOpen)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const videoFileRef = useRef(null)
  const thumbFileRef = useRef(null)

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })

  const submitUpload = async () => {
    const vf = videoFileRef.current?.files?.[0]
    const tf = thumbFileRef.current?.files?.[0]
    if (!vf) { setErr('Pick the AI reel file'); return }
    if (!tf) { setErr('Pick the thumbnail'); return }
    setUploading(true); setErr('')
    try {
      // 1. Mint a Dropbox token + target path for this reel
      const tokRes = await fetch('/api/ai-editor/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelRecordId: reel.id }),
      })
      const tok = await tokRes.json()
      if (!tokRes.ok) throw new Error(tok.error || 'Could not get upload token')

      // 2. Upload the AI reel straight to Dropbox (skips the serverless
      //    body limit — reels are too big for a JSON round-trip)
      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({
            path: tok.path,
            mode: 'overwrite',
            mute: true,
          }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: await vf.arrayBuffer(),
      })
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed (${dbxRes.status})`)

      // 3. Finalize — creates Asset + Task, marks the pool reel Produced
      const thumbnailBase64 = await fileToBase64(tf)
      const res = await fetch('/api/ai-editor/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reelRecordId: reel.id,
          creatorId,
          dropboxPath: tok.path,
          thumbnailBase64,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Finalize failed')
      onUploaded(reel.id)
    } catch (e) {
      setErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div id={`reel-${reel.id}`} style={{ border: autoOpen ? '2px solid #6AC68A' : selected ? '1px solid var(--palm-pink)' : '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', background: autoOpen ? 'rgba(106,198,138,0.06)' : 'rgba(255,255,255,0.02)' }}>
      <div style={{ position: 'relative', aspectRatio: '9/16', background: '#000' }}>
        {showPlayer && reel.streamUid ? (
          <iframe
            src={buildStreamIframeUrl(reel.streamUid, { autoplay: true, muted: false, loop: true, controls: true })}
            allow="autoplay; fullscreen"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : showPlayer && reel.video ? (
          <video
            src={reel.video}
            autoPlay
            controls
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
          />
        ) : (reel.streamUid || reel.video) ? (
          <div onClick={() => setShowPlayer(true)} style={{ width: '100%', height: '100%', cursor: 'pointer' }}>
            {reel.streamUid ? (
              <img src={buildStreamPosterUrl(reel.streamUid, { width: 480, fit: 'crop' })} alt="" loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : reel.thumbnail ? (
              <img src={reel.thumbnail} alt="" loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <video src={`${reel.video}#t=0.1`} muted preload="metadata" playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000', pointerEvents: 'none' }} />
            )}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, paddingLeft: 3 }}>▶</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: 12 }}>processing…</div>
        )}
        <label style={{ position: 'absolute', top: 8, left: 8 }} onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={() => onToggle(reel.id)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </label>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>@{reel.handle}</span>
          <span>{reel.views ? `${reel.views.toLocaleString()} views` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              if (!reel.video) return
              // Hand the browser Dropbox's direct-download URL (dl=1).
              // Do NOT fetch()+blob — that's a cross-origin request to
              // dropbox.com with no CORS headers, so it throws and the
              // download silently never happens. dl=1 makes Dropbox serve
              // the file with an attachment disposition, browser saves it.
              const dl = String(reel.video).replace(/([?&])raw=1/, '$1dl=1')
              window.open(dl, '_blank', 'noopener')
            }}
            style={{ flex: '1 1 80px', textAlign: 'center', padding: '6px 0', fontSize: 12, color: 'var(--foreground)', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer' }}
            title="Download the raw inspo reel — take it straight to TJP"
          >↓ Raw</button>
          <a
            href={`/ai-editor/recreate?tab=stageb&creator=${creatorId}&reel=${reel.id}`}
            style={{ flex: '1 1 80px', textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#e8b878', background: 'rgba(232,184,120,0.1)', border: '1px solid rgba(232,184,120,0.3)', borderRadius: 5, cursor: 'pointer', textDecoration: 'none' }}
            title="Composite this creator into a room matching this reel's pose"
          >🎨 Stage B</a>
          <button
            onClick={() => setShowUpload(v => !v)}
            style={{ flex: '1 1 80px', padding: '6px 0', fontSize: 12, color: '#6AC68A', background: 'rgba(106,198,138,0.1)', border: '1px solid rgba(106,198,138,0.3)', borderRadius: 5, cursor: 'pointer' }}
            title="Upload the finished AI motion video"
          >↑ Upload AI</button>
        </div>
        {showUpload && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(0,0,0,0.25)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginBottom: 4 }}>AI reel (mp4)</div>
            <input ref={videoFileRef} type="file" accept="video/*" style={{ fontSize: 11, color: 'var(--foreground-muted)', width: '100%' }} />
            <div style={{ fontSize: 10, color: 'var(--foreground-muted)', margin: '8px 0 4px' }}>Thumbnail (jpg/png)</div>
            <input ref={thumbFileRef} type="file" accept="image/*" style={{ fontSize: 11, color: 'var(--foreground-muted)', width: '100%' }} />
            {err && <div style={{ fontSize: 11, color: '#E87878', marginTop: 6 }}>{err}</div>}
            <button
              onClick={submitUpload}
              disabled={uploading}
              style={{ width: '100%', marginTop: 10, padding: '7px 0', fontSize: 12, fontWeight: 700, color: '#1a0a0a', background: 'var(--palm-pink)', border: 'none', borderRadius: 5, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
            >{uploading ? 'Uploading…' : 'Submit to Review'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AiEditorPage() {
  const sp = useSearchParams()
  const urlCreator = sp.get('creator') || ''
  const urlUpload = sp.get('upload') || ''
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [reels, setReels] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const loadCreators = useCallback(async () => {
    const res = await fetch('/api/ai-editor/pool')
    const data = await res.json()
    if (res.ok) {
      setCreators(data.creators || [])
      const match = urlCreator && data.creators?.some(c => c.id === urlCreator) ? urlCreator : null
      if (match) setCreatorId(match)
      else if (data.creators?.[0]) setCreatorId(data.creators[0].id)
    }
    setLoading(false)
  }, [urlCreator])

  const loadReels = useCallback(async (cid) => {
    if (!cid) return
    setLoading(true)
    const res = await fetch(`/api/ai-editor/pool?creatorId=${cid}`)
    const data = await res.json()
    if (res.ok) setReels(data.reels || [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => { loadCreators() }, [loadCreators])
  useEffect(() => { if (creatorId) loadReels(creatorId) }, [creatorId, loadReels])

  // When arriving with ?upload=<reelId>, scroll to that reel once loaded.
  useEffect(() => {
    if (!urlUpload || loading) return
    if (!reels.some(r => r.id === urlUpload)) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`reel-${urlUpload}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [urlUpload, reels, loading])

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const downloadSelected = async () => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      const r = await fetch('/api/ai-editor/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reelIds: [...selected] }) })
      if (r.ok) {
        const blob = await r.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `recreate-pool-${new Date().toISOString().slice(0, 10)}.zip`
        a.click()
      }
    } finally { setBusy(false) }
  }

  const onUploaded = (reelRecordId) => {
    setReels(prev => prev.filter(r => r.id !== reelRecordId))
    setSelected(prev => { const n = new Set(prev); n.delete(reelRecordId); return n })
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 32px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)' }}>AI Recreate Pool</h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 2 }}>
            Download source reels → recreate in TJP → upload the AI version + thumbnail back for review.
          </p>
          <a href="/ai-editor/recreate" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: 'var(--palm-pink)', textDecoration: 'underline' }}>
            → Stage B & Outfit Swap
          </a>
        </div>
        <select
          value={creatorId}
          onChange={e => setCreatorId(e.target.value)}
          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}
        >
          {creators.length === 0 && <option>No TJP creators</option>}
          {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(232,160,160,0.1)', border: '1px solid rgba(232,160,160,0.3)', borderRadius: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--foreground)' }}>{selected.size} selected</span>
          <button onClick={downloadSelected} disabled={busy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#1a0a0a', background: 'var(--palm-pink)', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            {busy ? 'Zipping…' : `Download ${selected.size} as ZIP`}
          </button>
          <button onClick={() => setSelected(new Set())} style={{ padding: '6px 10px', fontSize: 12, color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#666', fontSize: 13 }}>Loading…</div>
      ) : reels.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#666', fontSize: 13 }}>
          No available reels for this creator. An admin queues + scrapes accounts in AI Source.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
          {reels.map(r => (
            <ReelCard key={r.id} reel={r} creatorId={creatorId} selected={selected.has(r.id)} onToggle={toggle} onUploaded={onUploaded} autoOpen={r.id === urlUpload} />
          ))}
        </div>
      )}
    </div>
  )
}
