'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { buildStreamIframeUrl, buildStreamPosterUrl } from '@/lib/cfStreamUrl'
import { ModalHost, uiConfirm, StageBPanel } from '@/components/recreate/panels'
import { GuidedTour, TourTriggerButton } from '@/components/recreate/tour'

// Steps for the AI Recreate Pool tour. Targets are CSS selectors —
// missing elements degrade to a center modal (so a step about Needs
// Revision still shows even when there are no revisions on screen).
const POOL_TOUR_STEPS = [
  {
    placement: 'center',
    title: '👋 Welcome — here\'s the workflow',
    body: `The page has two tabs:

📚 Workspace — pick reels, manage in-flight projects, batch upload finished videos, handle revisions.
🎨 Create Scene — the one-step portal generation that happens partway through a project (swap creator's background to her saved room).

The full loop:

1. Pick the creator.
2. Pick inspo reels — downloading one (↓ Raw, or multi-select Download as ZIP) starts a project for that creator + reel pair. You'll see project cards in Workspace.
3. Do TJP image-to-image to get a photo of your creator in each reel's pose & outfit.
4. Click Continue on a project card → switches to Create Scene tab with the project loaded → upload the TJP photo → generate.
5. Approve the scene → ⬇ ZIP for TJP → outfit transfer + motion control in TJP.
6. Come back, 📦 Batch Upload the finished videos in Workspace.

I'll highlight each piece — hit Next to step through.`,
  },
  {
    target: '#tour-creator-picker',
    placement: 'bottom',
    title: 'Step 1 — Pick the creator',
    body: `Everything below filters to whoever is selected — your in-flight projects, the available reels, your revisions queue. Try switching it to see how the page re-flows.`,
  },
  {
    target: '#tour-reel-grid',
    placement: 'top',
    title: 'Step 2 — Pick + download reels (= start projects)',
    body: `Each card is one inspo reel available for this creator.

Three actions on each card:
• ↓ Raw — downloads the reel AND starts a project for it. The project appears in My Projects above.
• 🎨 Create Scene — same effect, but jumps you straight to the Create Scene page (skip if you haven't done TJP work yet).
• ↑ Upload AI — for one-off finished uploads (Batch Upload below is better when you have several).

You can also multi-select reels (checkbox on each card) and Download N as ZIP — that starts N projects at once.`,
  },
  {
    target: '#tour-projects',
    placement: 'top',
    title: 'Step 3 — My Projects (in-flight work)',
    body: `Each project card is one (creator, reel) pair you've committed to.

The status badge tells you what's next:
• Started — you downloaded the reel; do the TJP image-to-image work, then click Continue to upload the photo
• Generating — portal is rendering your scene (3–6 min, just wait)
• Pending — scene is done, click ✓ to approve
• Approved — ready! Click ⬇ ZIP for TJP and do the outfit/motion work
• Failed — scene didn't render; click to retry

Discard a Started project (🗑) if you change your mind — the reel goes back to the pool below.`,
  },
  {
    target: '#tour-batch-upload',
    placement: 'bottom',
    title: 'Step 4 — Batch Upload (after TJP)',
    body: `When you come back from TJP with finished motion videos, click 📦 Batch Upload and drop them all in at once.

The filename of each video (e.g. Amelia_R042_S01.mp4) tells the portal which project it belongs to — that's the slug each project card shows. Thumbnails auto-extract from the first frame.`,
  },
  {
    target: '#tour-revisions',
    placement: 'bottom',
    title: 'Step 5 — Handle any rejections',
    body: `If admin doesn't like something, the video appears at the top of this page with their feedback + screenshots.

Three ways to handle it:
• ↑ Re-upload revised — small tweak (re-edit in TJP, drop a new mp4)
• 🎨 Re-do Scene — start over from a fresh scene
• 🗑 Discard — when the rejected version is dead

(Section only appears when there's something to revise.)`,
  },
  {
    placement: 'center',
    title: '🎯 Ready to start',
    body: `Quick mental model:

• Download = "I'm working on this." → Project card appears.
• Continue → upload TJP photo → Portal generates the scene.
• Approve → ZIP → TJP outfit + motion.
• Batch Upload → admin review → grid.

Hit "? Guide" any time to replay this tour.`,
  },
]


function ReelCard({ reel, creatorId, selected, onToggle, onUploaded, autoOpen, onProjectStarted }) {
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
              // Downloading the raw reel = committing to working on it.
              // Fire-and-forget a /start so a project card appears on
              // the pool page immediately; even if Dropbox download
              // fails the project record is already on file.
              fetch('/api/admin/recreate-rooms/stage-b/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creatorId, reelRecordIds: [reel.id] }),
              }).then(() => onProjectStarted?.()).catch(() => {})
              // Hand the browser Dropbox's direct-download URL (dl=1).
              // Do NOT fetch()+blob — that's a cross-origin request to
              // dropbox.com with no CORS headers, so it throws and the
              // download silently never happens. dl=1 makes Dropbox serve
              // the file with an attachment disposition, browser saves it.
              const dl = String(reel.video).replace(/([?&])raw=1/, '$1dl=1')
              window.open(dl, '_blank', 'noopener')
            }}
            style={{ flex: '1 1 80px', textAlign: 'center', padding: '6px 0', fontSize: 12, color: 'var(--foreground)', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer' }}
            title="Download the raw inspo reel + start a project for it"
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

// ─── My Projects (in-flight reels for the current creator) ────────────────
// One card per reel, not per scene — every Generate click in the workflow
// creates a new scene record for the same (creator, reel) project, so
// showing scene-cards here was noisy (the same reel surfaced as 5+ tiles).
// The reel card summarizes scene counts by status; clicking opens the
// workflow where the full scene gallery lives at the bottom.
function MyProjectsSection({ projects, creatorId, onChange }) {
  if (!projects?.length) return null

  // Group projects by reel record ID. A few really old rows may not have
  // a reel reference — keep those bucketed under their own project ID so
  // they don't all collide into one anonymous group.
  const groups = (() => {
    const byReel = new Map()
    for (const p of projects) {
      const key = p.reel?.id || `__noReel_${p.id}`
      if (!byReel.has(key)) byReel.set(key, { reelKey: key, reel: p.reel || null, scenes: [] })
      byReel.get(key).scenes.push(p)
    }
    // Per-group status priority — most-urgent action wins so the editor
    // sees at a glance what each reel needs next.
    const order = { Failed: 0, Pending: 1, Started: 2, Generating: 3, Approved: 4, Rejected: 5 }
    for (const g of byReel.values()) {
      g.counts = g.scenes.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m }, {})
      g.topStatus = g.scenes.reduce((best, s) => {
        const a = order[s.status] ?? 99, b = order[best?.status] ?? 99
        return a < b ? s : best
      }, g.scenes[0]).status
      g.newest = g.scenes.reduce((t, s) => (s.createdTime || '') > t ? (s.createdTime || '') : t, '')
    }
    // Sort the *reels* by their top status (same priority as before) so
    // "needs TJP work" rises to the front.
    return [...byReel.values()].sort((a, b) => {
      const oa = order[a.topStatus] ?? 99
      const ob = order[b.topStatus] ?? 99
      if (oa !== ob) return oa - ob
      return (a.newest || '').localeCompare(b.newest || '')
    })
  })()

  // Aggregated counts across every scene under every reel, just for
  // the header summary (matches what the section showed before).
  const totalCounts = projects.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m }, {})

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>My Projects</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
          {groups.length} reel{groups.length === 1 ? '' : 's'} · {projects.length} scene{projects.length === 1 ? '' : 's'}
          {totalCounts.Started ? ` · ${totalCounts.Started} need TJP work` : ''}
          {totalCounts.Generating ? ` · ${totalCounts.Generating} rendering` : ''}
          {totalCounts.Pending ? ` · ${totalCounts.Pending} awaiting your ✓` : ''}
          {totalCounts.Approved ? ` · ${totalCounts.Approved} ready for TJP outfit/motion` : ''}
          {totalCounts.Failed ? ` · ${totalCounts.Failed} failed` : ''}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {groups.map(g => <ReelProjectCard key={g.reelKey} group={g} creatorId={creatorId} onChange={onChange} />)}
      </div>
    </div>
  )
}

// One card per reel. Shows the reel thumbnail (not a scene thumbnail —
// the workflow already has a scene gallery), the count + status mix
// of scenes inside, and a single CTA that opens the workflow loaded
// to this reel so the editor can see/work on every scene at once.
function ReelProjectCard({ group, creatorId, onChange }) {
  const { reel, scenes, counts, topStatus } = group
  const statusColor = (s) =>
    s === 'Approved' ? '#6AC68A'
    : s === 'Rejected' || s === 'Failed' ? '#E87878'
    : s === 'Generating' ? '#8fb4f0'
    : s === 'Started' ? '#aaa'
    : '#e8b878' // Pending
  const sc = statusColor(topStatus)
  const thumb = (reel?.streamUid && buildStreamPosterUrl(reel.streamUid, { width: 240, fit: 'crop' }))
    || reel?.thumbnail
    || null
  // No ?project= — the workflow loads every scene for this reel into
  // the gallery, which is what the editor actually wants to see when
  // resuming work on a reel that already has scenes generated.
  const openHref = `/ai-editor?tab=create&creator=${creatorId}&reel=${reel?.id || ''}`
  const cta = topStatus === 'Started'    ? '🎨 Continue → upload TJP photo'
            : topStatus === 'Generating' ? '⏳ Rendering…'
            : topStatus === 'Pending'    ? '👁 Review scenes'
            : topStatus === 'Approved'   ? '🎬 Open workflow'
            : topStatus === 'Rejected'   ? '↻ Retry / view'
            : topStatus === 'Failed'     ? '↻ Retry'
            : 'Open workflow'

  // Discard at the reel level wipes every scene record under it. The
  // raw reel goes back to the pool. Approved scenes are protected —
  // confirm extra-loud if any exist so the editor doesn't blow away
  // hard-won renders by reflex.
  const discardReel = async () => {
    const hasApproved = (counts.Approved || 0) > 0
    const msg = hasApproved
      ? `This reel has ${counts.Approved} approved scene${counts.Approved === 1 ? '' : 's'}. Discarding wipes ALL ${scenes.length} scenes for this reel — even the approved ones. Continue?`
      : `Discard every scene under this reel (${scenes.length} total)? The reel goes back to the pool so you (or someone else) can re-start it.`
    if (!(await uiConfirm(msg, { danger: true, okLabel: 'Discard reel' }))) return
    try {
      await Promise.all(scenes.map(s =>
        fetch(`/api/admin/recreate-rooms/stage-b/outputs?id=${s.id}`, { method: 'DELETE' })
      ))
      onChange?.()
    } catch {}
  }

  return (
    <div style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
      <a href={openHref} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        <div style={{ position: 'relative', aspectRatio: '9/16', background: '#000' }}>
          {thumb
            ? <img src={thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: sc }}>no reel thumb</div>}
          {/* Scene-count badge — the headline number on a reel card. */}
          <div style={{ position: 'absolute', top: 6, left: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.7)', borderRadius: 4 }}>
            {scenes.length} scene{scenes.length === 1 ? '' : 's'}
          </div>
          <div style={{ position: 'absolute', top: 6, right: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700, color: '#0a0a0a', background: sc, borderRadius: 3 }}>
            {topStatus}
          </div>
        </div>
      </a>
      <div style={{ padding: 10, fontSize: 11 }}>
        {reel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href={reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ↗ @{reel.handle || reel.reelId}
            </a>
            {reel.video && (
              <a href={String(reel.video).replace(/([?&])raw=1/, '$1dl=1')} target="_blank" rel="noopener"
                title="Re-download the raw reel"
                style={{ fontSize: 10, color: 'var(--foreground-muted)', textDecoration: 'none' }}>↓ reel</a>
            )}
          </div>
        )}
        {/* Per-status mini-counts so the editor sees the full breakdown
            without opening the workflow (e.g. "2 ✓ · 1 ⏳ · 1 ✕"). */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 10 }}>
          {Object.entries(counts).map(([s, n]) => (
            <span key={s} style={{ padding: '2px 6px', borderRadius: 3, background: `${statusColor(s)}22`, color: statusColor(s), fontWeight: 700 }}>
              {n} {s.toLowerCase()}
            </span>
          ))}
        </div>
        <a href={openHref}
          style={{ display: 'block', marginTop: 8, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: `${sc}28`, color: sc, borderRadius: 5, textDecoration: 'none' }}>
          {cta}
        </a>
        <button onClick={discardReel}
          style={{ width: '100%', marginTop: 6, padding: '4px 0', fontSize: 10, color: '#888', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, cursor: 'pointer' }}>
          🗑 Discard reel
        </button>
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
          Drop N finished AI motion videos at once. Filenames should match the scene name (e.g. <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#e8b878' }}>Amelia_R042_S01.mp4</span>) so each file lands on its parent scene. Thumbnails are auto-generated from the first frame.
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
  const router = useRouter()
  const pathname = usePathname()
  const urlCreator = sp.get('creator') || ''
  const urlUpload = sp.get('upload') || ''
  const urlReel = sp.get('reel') || undefined
  const urlProject = sp.get('project') || undefined
  const tab = sp.get('tab') === 'create' ? 'create' : 'workspace'
  const setTab = (k, extra = {}) => {
    const params = new URLSearchParams(sp.toString())
    if (k === 'workspace') params.delete('tab')
    else params.set('tab', k)
    for (const [key, val] of Object.entries(extra)) {
      if (val == null) params.delete(key)
      else params.set(key, val)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [reels, setReels] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revisions, setRevisions] = useState([])
  const [projects, setProjects] = useState([])
  const [batchOpen, setBatchOpen] = useState(false)
  // "Upload inspo" modal state — editor pastes an IG reel URL right
  // from the pool view (vs. having to switch to /admin/recreate-source).
  // The reel lands in the same Recreate Reels table admins scrape into,
  // so it appears in this Fresh Inspo grid on the next reload.
  const [uploadInspoOpen, setUploadInspoOpen] = useState(false)
  const [uploadInspoUrl, setUploadInspoUrl] = useState('')
  const [uploadInspoBusy, setUploadInspoBusy] = useState(false)
  const [uploadInspoError, setUploadInspoError] = useState('')
  const [uploadInspoMsg, setUploadInspoMsg] = useState('')

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

  // Editor submits a single IG reel URL → scrape that reel directly →
  // reel lands in Recreate Reels (Status='Available'), shows up in this
  // creator's Fresh Inspo grid on the next loadReels(). Sync flow,
  // 20-60s. Reuses /api/admin/recreate-source/upload-inspo which is
  // already ai_editor-friendly.
  const submitUploadInspo = async () => {
    const url = uploadInspoUrl.trim()
    if (!url) { setUploadInspoError('Paste an Instagram reel URL first'); return }
    setUploadInspoBusy(true); setUploadInspoError(''); setUploadInspoMsg('')
    try {
      const res = await fetch('/api/admin/recreate-source/upload-inspo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagramUrl: url }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
      setUploadInspoOpen(false)
      setUploadInspoUrl('')
      setUploadInspoMsg(data.alreadyExisted
        ? `Reel was already in the library (@${data.handle || '?'} · ${data.shortcode})`
        : `Added @${data.handle || '?'} · ${data.shortcode} — pulling fresh inspo…`)
      // Refresh the pool so the new reel appears.
      loadReels(creatorId)
    } catch (e) {
      setUploadInspoError(e.message)
    } finally {
      setUploadInspoBusy(false)
    }
  }

  // In-flight projects (Stage B Outputs in any non-terminal state) for
  // the current creator. Each is a project card on the page; also used
  // to hide reels from the pool grid below (a reel that's already a
  // project doesn't need to appear as "fresh inspo to pick").
  const loadProjects = useCallback(async (cid) => {
    if (!cid) { setProjects([]); return }
    try {
      // The resolver finishes any Generating jobs that have completed
      // on WaveSpeed. Fire-and-forget; if it's slow, we'll still see
      // the updated state on the next reload.
      fetch('/api/admin/recreate-rooms/stage-b/resolve', { method: 'POST' }).catch(() => {})
      const r = await fetch(`/api/admin/recreate-rooms/stage-b/outputs?creatorId=${cid}`)
      const d = await r.json()
      if (r.ok) setProjects(d.outputs || [])
    } catch {}
  }, [])

  useEffect(() => { loadCreators() }, [loadCreators])
  useEffect(() => { if (creatorId) { loadReels(creatorId); loadRevisions(creatorId); loadProjects(creatorId) } }, [creatorId, loadReels, loadRevisions, loadProjects])

  // Background auto-poll for in-flight projects (Generating). Once
  // they're Pending/Approved/Failed/Rejected the loop stops.
  useEffect(() => {
    const anyGenerating = projects.some(p => p.status === 'Generating')
    if (!anyGenerating) return
    const t = setInterval(() => { loadProjects(creatorId) }, 25000)
    return () => clearInterval(t)
  }, [projects, creatorId, loadProjects])

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
      // Starting projects + zipping reels run in parallel — neither
      // depends on the other and the editor wants the ZIP fast.
      // /start is idempotent (skips reels that already have a project)
      // so re-clicking Download won't double-up.
      const reelIds = [...selected]
      fetch('/api/admin/recreate-rooms/stage-b/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, reelRecordIds: reelIds }),
      }).then(() => loadProjects(creatorId)).catch(() => {})

      const r = await fetch('/api/ai-editor/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reelIds }) })
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

  // Number of in-flight projects = the "Create Scene" tab badge.
  const projectsForBadge = projects.filter(p => p.status !== 'Approved' && p.status !== 'Rejected').length

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 32px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)' }}>AI Recreate</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TourTriggerButton storageKey="ai-editor-pool-v7" label="? Guide" />
          {tab === 'workspace' && (
            <button id="tour-batch-upload" onClick={() => setBatchOpen(true)}
              style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              📦 Batch Upload
            </button>
          )}
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

      {/* Tab bar — both workflow stages on one page so Continue doesn't
          feel like navigating to a different surface. */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('workspace')}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'workspace' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'workspace' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
          📚 Workspace{revisions.length > 0 ? <span style={{ marginLeft: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700, background: '#E87878', color: '#1a0a0a', borderRadius: 8 }}>{revisions.length}</span> : projectsForBadge > 0 ? <span style={{ marginLeft: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700, background: 'rgba(232,184,120,0.5)', color: '#1a0a0a', borderRadius: 8 }}>{projectsForBadge}</span> : null}
        </button>
        <button onClick={() => setTab('create')}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'create' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'create' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
          🎨 Create Scene
        </button>
      </div>

      {tab === 'create' && (
        <>
          <StageBPanel initialCreatorId={creatorId} initialReelRecordId={urlReel} initialProjectId={urlProject} />
          <ModalHost />
        </>
      )}
      {tab === 'workspace' && (
      <>
      {/* Workspace tab — pool reels + revisions + my projects + batch upload */}
      <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: -6, marginBottom: 14 }}>
        Pick an inspo reel → downloading it starts a project → finish in 🎨 Create Scene tab → outfit transfer + motion in TJP → 📦 Batch Upload here for review.
      </p>

      {revisions.length > 0 && (
        <div id="tour-revisions">
          <RevisionsSection revisions={revisions} creatorId={creatorId} onResubmitted={() => loadRevisions(creatorId)} />
        </div>
      )}

      <div id="tour-projects">
        <MyProjectsSection projects={projects} creatorId={creatorId} onChange={() => loadProjects(creatorId)} />
      </div>

      {batchOpen && (
        <BatchUploadModal creatorId={creatorId} onClose={() => setBatchOpen(false)} onDone={() => { setBatchOpen(false); loadReels(creatorId); loadProjects(creatorId) }} />
      )}

      {selected.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(232,160,160,0.1)', border: '1px solid rgba(232,160,160,0.3)', borderRadius: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--foreground)' }}>{selected.size} selected</span>
          <button onClick={downloadSelected} disabled={busy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#1a0a0a', background: 'var(--palm-pink)', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            {busy ? 'Starting projects + zipping…' : `Download ${selected.size} as ZIP & start project${selected.size === 1 ? '' : 's'}`}
          </button>
          <button onClick={() => setSelected(new Set())} style={{ padding: '6px 10px', fontSize: 12, color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      {/* Hide reels that already have a project in flight — those live
          in My Projects above instead of cluttering the "fresh inspo" grid. */}
      {(() => {
        const projectReelIds = new Set(projects.map(p => p.reel?.id).filter(Boolean))
        const freshReels = reels.filter(r => !projectReelIds.has(r.id))
        if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#666', fontSize: 13 }}>Loading…</div>
        if (freshReels.length === 0) return (
          <div style={{ padding: 60, textAlign: 'center', color: '#666', fontSize: 13 }}>
            {projects.length > 0
              ? 'No more fresh inspo for this creator — every available reel is already a project above.'
              : 'No available reels for this creator. An admin queues + scrapes accounts in AI Source.'}
          </div>
        )
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Fresh inspo · {freshReels.length}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {uploadInspoMsg && (
                  <span style={{ fontSize: 11, color: '#6AC68A' }}>{uploadInspoMsg}</span>
                )}
                <button onClick={() => { setUploadInspoOpen(true); setUploadInspoError(''); setUploadInspoMsg('') }}
                  title="Paste an Instagram reel URL — we scrape just that reel and add it to your pool."
                  style={{ padding: '6px 12px', background: 'rgba(200,168,255,0.10)', color: '#C8A8FF', border: '1px solid rgba(200,168,255,0.35)', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  ↑ Upload inspo
                </button>
              </div>
            </div>
            <div id="tour-reel-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
              {freshReels.map(r => (
                <ReelCard key={r.id} reel={r} creatorId={creatorId} selected={selected.has(r.id)} onToggle={toggle} onUploaded={onUploaded} autoOpen={r.id === urlUpload} onProjectStarted={() => loadProjects(creatorId)} />
              ))}
            </div>
          </>
        )
      })()}
      </>
      )}

      {/* Editor's Upload Inspo modal — sync single-URL Apify scrape.
          Reel lands in the global Recreate Reels table → next pool
          reload includes it in this creator's Fresh Inspo grid. */}
      {uploadInspoOpen && (
        <div onClick={() => !uploadInspoBusy && setUploadInspoOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(560px, 95vw)', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>↑ Upload inspo from Instagram URL</div>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 4, lineHeight: 1.4 }}>
                Paste a public Instagram reel link. We&apos;ll scrape just that reel and add it to your Fresh Inspo grid — no need to wait for an admin to add the account.
              </div>
            </div>
            <input
              type="url"
              value={uploadInspoUrl}
              onChange={e => setUploadInspoUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/DXXXXXXXXXX/"
              disabled={uploadInspoBusy}
              autoFocus
              style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}
              onKeyDown={e => { if (e.key === 'Enter' && !uploadInspoBusy) submitUploadInspo() }}
            />
            {uploadInspoError && (
              <div style={{ padding: '8px 10px', background: 'rgba(232,120,120,0.12)', color: '#E87878', borderRadius: 5, fontSize: 12 }}>{uploadInspoError}</div>
            )}
            {uploadInspoBusy && (
              <div style={{ padding: '8px 10px', background: 'rgba(120,180,232,0.10)', color: '#8FB4F0', borderRadius: 5, fontSize: 12 }}>
                Scraping via Apify… usually 20-60s for a single reel. Don&apos;t close this window.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setUploadInspoOpen(false)} disabled={uploadInspoBusy}
                style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: uploadInspoBusy ? 'wait' : 'pointer' }}>
                Cancel
              </button>
              <button onClick={submitUploadInspo} disabled={uploadInspoBusy || !uploadInspoUrl.trim()}
                style={{ padding: '8px 16px', background: uploadInspoBusy ? 'rgba(200,168,255,0.10)' : 'rgba(200,168,255,0.25)', color: '#C8A8FF', border: '1px solid rgba(200,168,255,0.45)', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: uploadInspoBusy ? 'wait' : 'pointer' }}>
                {uploadInspoBusy ? '⏳ Scraping…' : '↑ Add to pool'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ModalHost />
      <GuidedTour steps={POOL_TOUR_STEPS} storageKey="ai-editor-pool-v7" />
    </div>
  )
}
