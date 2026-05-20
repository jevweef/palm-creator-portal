'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { buildStreamIframeUrl, buildStreamPosterUrl } from '@/lib/cfStreamUrl'
import { ModalHost, uiConfirm } from '@/components/recreate/panels'
import { GuidedTour, TourTriggerButton } from '@/components/recreate/tour'

// Steps for the AI Recreate Pool tour. Targets are CSS selectors —
// missing elements degrade to a center modal (so a step about Needs
// Revision still shows even when there are no revisions on screen).
const POOL_TOUR_STEPS = [
  {
    placement: 'center',
    title: '👋 Welcome',
    body: `This page is your home base for making AI content in bulk. Here's the workflow in plain English:

1. Pick an inspo reel you like → click "Create Scene". The system places your creator into her room, posed exactly like the reel.
2. Pick a few outfits to pair with that scene.
3. Download a ZIP with the scene, the reel, and the outfit photos.
4. Do the motion + outfit work in TJP (off-site).
5. Come back here and drop the finished videos into Batch Upload.

Let's walk through where each button lives.`,
  },
  {
    target: '#tour-creator-picker',
    placement: 'bottom',
    title: 'Pick a creator first',
    body: `Everything below is filtered to whichever creator is selected here — the reels you can use, your upload queue, anything admin wants you to revise.`,
  },
  {
    target: '#tour-batch-upload',
    placement: 'bottom',
    title: '📦 Batch Upload',
    body: `When you come back from TJP with a bunch of finished motion videos, drop them all here at once.

The filename of each video tells the system which scene + outfit it belongs to (e.g. Amelia_R042_S01_O03.mp4). The system auto-creates a thumbnail from the first frame.`,
  },
  {
    target: '#tour-revisions',
    placement: 'bottom',
    title: '⚠️ Needs Revision',
    body: `If admin sees something they don't like, the video shows up here with their feedback + screenshots.

Three ways to handle it:
• ↑ Re-upload revised — small tweak (re-edit in TJP, drop the new mp4 here)
• 🎨 Re-do Scene — start over from a fresh scene
• 🗑 Discard — pair with "Re-do Scene" if the rejected version is dead`,
  },
  {
    target: '#tour-reel-grid',
    placement: 'top',
    title: 'The reel pool',
    body: `Each card is one inspo reel available for this creator (anything she's already used is hidden).

Three actions on each card:
• ↓ Raw — download just the reel and skip the scene step
• 🎨 Create Scene — put your creator into her room with this reel's pose (recommended path)
• ↑ Upload AI — for one-off finished uploads (Batch Upload is better when you have several)`,
  },
  {
    placement: 'center',
    title: '🎯 Suggested first session',
    body: `1. Pick a creator from the dropdown.
2. Click 🎨 Create Scene on 5–10 inspo reels you like. You'll land on the Create Scene page where you scrub each reel to the exact pose, then generate.
3. Approve the good scenes → click 👗 Fan out outfits on each to pair them with outfit photos.
4. ⬇ Download all (1 ZIP) — gives you everything TJP needs.
5. Do the motion + outfit work in TJP.
6. Come back, 📦 Batch Upload the finished videos.

Click "? Guide" any time to replay this. The Create Scene page has its own tour too.`,
  },
]


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
    // Slug-named files (Aka_R042_S01_O03.mp4) inherit the canonical
    // identifier so this single-upload path matches batch behavior.
    const slugMatch = (vf.name || '').match(/^([A-Za-z]+_R\d{1,4}_S\d{1,3}(?:_O\d{1,3})?)/)
    const slug = slugMatch ? slugMatch[1] : null
    setUploading(true); setErr('')
    try {
      // 1. Mint a Dropbox token + target path for this reel
      const tokRes = await fetch('/api/ai-editor/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelRecordId: reel.id, slug }),
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
          slug,
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
            title="Put this creator in her room with this reel's pose"
          >🎨 Create Scene</a>
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

// ─── Needs Revision section (closes the rejection loop for AI editors) ───
function RevisionsSection({ revisions, creatorId, onResubmitted }) {
  return (
    <div style={{ marginBottom: 24, padding: 16, border: '1px solid rgba(232,120,120,0.35)', borderRadius: 10, background: 'rgba(232,120,120,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#E87878' }}>
          {revisions.length} revision{revisions.length === 1 ? '' : 's'} needed
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {revisions.map(rev => (
          <RevisionCard key={rev.taskId} rev={rev} creatorId={creatorId} onResubmitted={onResubmitted} />
        ))}
      </div>
    </div>
  )
}

function RevisionCard({ rev, creatorId, onResubmitted }) {
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
  const extractFirstFrame = (file) => new Promise((res, rej) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = URL.createObjectURL(file)
    video.muted = true
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, video.duration / 4)
    }
    video.onseeked = () => {
      const c = document.createElement('canvas')
      c.width = video.videoWidth
      c.height = video.videoHeight
      c.getContext('2d').drawImage(video, 0, 0)
      res(c.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    video.onerror = rej
  })

  const submitResubmit = async () => {
    const vf = fileRef.current?.files?.[0]
    if (!vf) { setErr('Pick the revised video'); return }
    setUploading(true); setErr('')
    try {
      const tokRes = await fetch('/api/ai-editor/upload-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelRecordId: rev.stageBParent?.reelRecordId || rev.taskId }),
      })
      const tok = await tokRes.json()
      if (!tokRes.ok) throw new Error(tok.error || 'token failed')
      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: tok.path, mode: 'overwrite', mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: await vf.arrayBuffer(),
      })
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed (${dbxRes.status})`)

      let thumbnailBase64
      try { thumbnailBase64 = await extractFirstFrame(vf) } catch { /* optional */ }
      const r = await fetch('/api/ai-editor/resubmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: rev.taskId, dropboxPath: tok.path, thumbnailBase64 }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'resubmit failed')
      onResubmitted()
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {rev.thumbnail && (
          <img src={rev.thumbnail} alt="" loading="lazy"
            style={{ width: 56, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 5, background: '#000' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontWeight: 700, color: '#E87878', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rev.slug || rev.name}
          </div>
          {rev.referenceReelUrl && (
            <a href={rev.referenceReelUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#8fb4f0', textDecoration: 'none' }}>↗ original inspo reel</a>
          )}
        </div>
      </div>

      {rev.adminFeedback && (
        <div style={{ marginTop: 10, padding: 8, background: 'rgba(0,0,0,0.4)', borderLeft: '2px solid #E87878', borderRadius: 4, fontSize: 12, color: '#ddd', whiteSpace: 'pre-wrap' }}>
          {rev.adminFeedback}
        </div>
      )}

      {rev.adminScreenshots?.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 4, marginTop: 8 }}>
          {rev.adminScreenshots.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="" style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)' }} />
            </a>
          ))}
        </div>
      )}

      {rev.revisionHistory?.length > 1 && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--foreground-muted)' }}>
          ↻ Round {rev.revisionHistory.length} of revisions on this asset
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setShowUpload(v => !v)}
          style={{ flex: '1 1 120px', padding: '7px 0', fontSize: 12, fontWeight: 700, color: '#6AC68A', background: 'rgba(106,198,138,0.12)', border: '1px solid rgba(106,198,138,0.3)', borderRadius: 5, cursor: 'pointer' }}>
          ↑ Re-upload revised
        </button>
        {rev.stageBParent && (
          <a href={`/ai-editor/recreate?tab=stageb&creator=${rev.stageBParent.creatorId || creatorId}&reel=${rev.stageBParent.reelRecordId}`}
            style={{ flex: '1 1 120px', textAlign: 'center', padding: '7px 0', fontSize: 12, fontWeight: 700, color: '#e8b878', background: 'rgba(232,184,120,0.12)', border: '1px solid rgba(232,184,120,0.3)', borderRadius: 5, textDecoration: 'none' }}>
            🎨 Re-do Scene
          </a>
        )}
      </div>
      <button onClick={async () => {
        if (!(await uiConfirm(`Discard this rejected task? The Dropbox file stays (archive). Use this when you're starting fresh with a new scene — otherwise just re-upload.`, { danger: true, okLabel: 'Discard' }))) return
        try {
          const r = await fetch('/api/ai-editor/discard', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: rev.taskId }),
          })
          if (!r.ok) throw new Error((await r.json()).error || 'discard failed')
          onResubmitted()
        } catch (e) { setErr(e.message) }
      }}
        style={{ width: '100%', marginTop: 6, padding: '6px 0', fontSize: 11, color: '#888', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer' }}>
        🗑 Discard (starting a new scene from scratch)
      </button>

      {showUpload && (
        <div style={{ marginTop: 10, padding: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 4 }}>Revised video (mp4) — thumbnail auto-generated from the first frame</div>
          <input ref={fileRef} type="file" accept="video/*" style={{ fontSize: 11, color: 'var(--foreground-muted)', width: '100%' }} />
          {err && <div style={{ fontSize: 11, color: '#E87878', marginTop: 6 }}>{err}</div>}
          <button onClick={submitResubmit} disabled={uploading}
            style={{ width: '100%', marginTop: 8, padding: '7px 0', fontSize: 12, fontWeight: 700, color: '#1a0a0a', background: 'var(--palm-pink)', border: 'none', borderRadius: 5, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.5 : 1 }}>
            {uploading ? 'Uploading…' : 'Submit revised → Pending Review'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Batch upload — drag N finished videos at once ─────────────────────────
function BatchUploadModal({ creatorId, onClose, onDone }) {
  const [files, setFiles] = useState([])
  const [progress, setProgress] = useState({}) // name -> { status: 'pending'|'resolving'|'uploading'|'done'|'error', error? }
  const [resolvedSlugs, setResolvedSlugs] = useState({}) // name -> { ok, reelRecordId, creatorId, slug, error }
  const [running, setRunning] = useState(false)

  const onDrop = (e) => { e.preventDefault(); setFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('video/'))) }
  const onPick = (e) => setFiles([...e.target.files].filter(f => f.type.startsWith('video/')))

  // Resolve every slug in one round-trip so the editor sees up front
  // which files match a real Stage B Output and which are mystery files.
  useEffect(() => {
    if (!files.length) { setResolvedSlugs({}); return }
    const slugs = files.map(f => f.name)
    fetch('/api/ai-editor/slug-lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    })
      .then(r => r.json())
      .then(d => {
        const byName = {}
        d.results?.forEach((r, i) => { byName[files[i].name] = r })
        setResolvedSlugs(byName)
      })
      .catch(() => {})
  }, [files])

  const extractFirstFrame = (file) => new Promise((res, rej) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = URL.createObjectURL(file)
    video.muted = true
    video.onloadeddata = () => { video.currentTime = Math.min(0.1, video.duration / 4) }
    video.onseeked = () => {
      const c = document.createElement('canvas')
      c.width = video.videoWidth
      c.height = video.videoHeight
      c.getContext('2d').drawImage(video, 0, 0)
      res(c.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    video.onerror = rej
  })

  const runBatch = async () => {
    setRunning(true)
    // Concurrency of 3 — Dropbox uploads in parallel work fine but we
    // don't want to slam the API at 50-wide for a single editor.
    const queue = files.filter(f => resolvedSlugs[f.name]?.ok)
    const CONC = 3
    let idx = 0
    const next = async () => {
      const f = queue[idx++]
      if (!f) return
      const meta = resolvedSlugs[f.name]
      setProgress(p => ({ ...p, [f.name]: { status: 'uploading' } }))
      try {
        // Slug threaded into upload-token so each variant lands at a
        // unique Dropbox path — without this, every outfit variant of
        // the same reel would overwrite the same file.
        const tokRes = await fetch('/api/ai-editor/upload-token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reelRecordId: meta.reelRecordId, slug: meta.slug }),
        })
        const tok = await tokRes.json()
        if (!tokRes.ok) throw new Error(tok.error || 'token failed')
        const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tok.accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: tok.path, mode: 'overwrite', mute: true }),
            'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
            'Content-Type': 'application/octet-stream',
          },
          body: await f.arrayBuffer(),
        })
        if (!dbxRes.ok) throw new Error(`Dropbox ${dbxRes.status}`)
        let thumb
        try { thumb = await extractFirstFrame(f) } catch {}
        const r = await fetch('/api/ai-editor/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reelRecordId: meta.reelRecordId,
            creatorId: meta.creatorId || creatorId,
            dropboxPath: tok.path,
            thumbnailBase64: thumb,
            slug: meta.slug,
          }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'upload failed')
        setProgress(p => ({ ...p, [f.name]: { status: 'done' } }))
      } catch (e) {
        setProgress(p => ({ ...p, [f.name]: { status: 'error', error: e.message } }))
      }
      await next()
    }
    await Promise.all(Array.from({ length: CONC }, next))
    setRunning(false)
    setTimeout(onDone, 1500)
  }

  const ok = files.filter(f => resolvedSlugs[f.name]?.ok).length
  const bad = files.length - ok

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(640px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: '#16161c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>📦 Batch upload finished videos</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 14 }}>
          Drop N finished AI motion videos at once. Filenames should match the scene + outfit name (e.g. <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#e8b878' }}>Amelia_R042_S01_O03.mp4</span>) so each file lands on its parent scene. Thumbnails are auto-generated from the first frame.
        </div>

        <div onDrop={onDrop} onDragOver={e => e.preventDefault()}
          style={{ border: '2px dashed rgba(255,255,255,0.2)', borderRadius: 10, padding: 24, textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginBottom: 8 }}>Drop video files here</div>
          <label style={{ display: 'inline-block', padding: '8px 16px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 6, cursor: 'pointer' }}>
            …or pick files
            <input type="file" accept="video/*" multiple onChange={onPick} style={{ display: 'none' }} />
          </label>
        </div>

        {files.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 8 }}>
              {files.length} file{files.length === 1 ? '' : 's'} · <span style={{ color: '#6AC68A' }}>{ok} matched</span>{bad > 0 && <>, <span style={{ color: '#E87878' }}>{bad} unmatched</span></>}
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6 }}>
              {files.map(f => {
                const meta = resolvedSlugs[f.name]
                const p = progress[f.name]
                const matched = meta?.ok
                const color = p?.status === 'done' ? '#6AC68A' : p?.status === 'error' || !matched ? '#E87878' : p?.status === 'uploading' ? '#8fb4f0' : '#aaa'
                return (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--foreground-muted)' }}>
                        {matched ? `→ slug ${meta.slug}${meta.outfit ? ' · ' + meta.outfit : ''}` : (meta?.error || 'parsing…')}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
                      {p?.status === 'done' ? '✓' : p?.status === 'error' ? `✕ ${p.error}` : p?.status === 'uploading' ? '⏳' : matched ? 'ready' : 'skip'}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose}
            style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, cursor: 'pointer' }}>Close</button>
          <button onClick={runBatch} disabled={running || ok === 0}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: (running || ok === 0) ? 'rgba(232,160,160,0.4)' : 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: (running || ok === 0) ? 'default' : 'pointer' }}>
            {running ? 'Uploading…' : `Upload ${ok} matched video${ok === 1 ? '' : 's'}`}
          </button>
        </div>
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
  const [revisions, setRevisions] = useState([])
  const [batchOpen, setBatchOpen] = useState(false)

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

  const loadRevisions = useCallback(async (cid) => {
    if (!cid) { setRevisions([]); return }
    try {
      const r = await fetch(`/api/ai-editor/revisions?creatorId=${cid}`)
      const d = await r.json()
      if (r.ok) setRevisions(d.revisions || [])
    } catch {}
  }, [])

  useEffect(() => { loadCreators() }, [loadCreators])
  useEffect(() => { if (creatorId) { loadReels(creatorId); loadRevisions(creatorId) } }, [creatorId, loadReels, loadRevisions])

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
            → Create Scene & Outfit Swap
          </a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TourTriggerButton storageKey="ai-editor-pool-v2" label="? Guide" />
          <button id="tour-batch-upload" onClick={() => setBatchOpen(true)}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            📦 Batch Upload
          </button>
          <select
            id="tour-creator-picker"
            value={creatorId}
            onChange={e => setCreatorId(e.target.value)}
            style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}
          >
            {creators.length === 0 && <option>No TJP creators</option>}
            {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {revisions.length > 0 && (
        <div id="tour-revisions">
          <RevisionsSection revisions={revisions} creatorId={creatorId} onResubmitted={() => loadRevisions(creatorId)} />
        </div>
      )}

      {batchOpen && (
        <BatchUploadModal creatorId={creatorId} onClose={() => setBatchOpen(false)} onDone={() => { setBatchOpen(false); loadReels(creatorId) }} />
      )}

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
        <div id="tour-reel-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
          {reels.map(r => (
            <ReelCard key={r.id} reel={r} creatorId={creatorId} selected={selected.has(r.id)} onToggle={toggle} onUploaded={onUploaded} autoOpen={r.id === urlUpload} />
          ))}
        </div>
      )}
      <ModalHost />
      <GuidedTour steps={POOL_TOUR_STEPS} storageKey="ai-editor-pool-v2" />
    </div>
  )
}
