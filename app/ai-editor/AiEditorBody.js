'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { buildStreamIframeUrl, buildStreamPosterUrl } from '@/lib/cfStreamUrl'
import { ModalHost, uiConfirm, StageBPanel } from '@/components/recreate/panels'
import { GuidedTour, TourTriggerButton } from '@/components/recreate/tour'
import CarouselUploadSection from '@/app/ai-editor/CarouselUploadSection'
import CarouselReferenceLibrary from '@/app/ai-editor/CarouselReferenceLibrary'
import NewProjectModal from '@/app/ai-editor/NewProjectModal'
import FreelanceSubmitModal from '@/app/ai-editor/FreelanceSubmitModal'
import BulkSubmitModal from '@/app/ai-editor/BulkSubmitModal'
import { LibrarySection as OutfitLibrarySection } from '@/components/recreate/PhotosPanel'

// Steps for the AI Recreate Pool tour. Targets are CSS selectors —
// missing elements degrade to a center modal (so a step about Needs
// Revision still shows even when there are no revisions on screen).
const POOL_TOUR_STEPS = [
  {
    placement: 'center',
    title: 'Welcome — here\'s the workflow',
    body: `The page is organized into tabs:

Projects — your in-flight work, revisions to handle, and the + New Project button. This is home base.
Inspo Board — the pool of available source reels for the picked creator. Start a project from here.
Bedroom Scene — only appears when you have an active project. It's the portal step inside the Bedroom workflow.

Two ways to ship AI content for a reel:

• Bedroom Content — the full in-portal flow. Frame grab → image-to-image in TJP → upload TJP photo → portal generates the scene → outfit/motion in TJP → upload finished video back.
• Direct Upload — you already produced the AI videos elsewhere (TJP, custom edit, anywhere). Drop multiple finished files; each becomes its own review item, all linked back to the source reel.

I'll walk through each step.`,
  },
  {
    target: '#tour-creator-picker',
    placement: 'bottom',
    title: 'Step 1 — Pick the creator',
    body: `Everything on the page filters to whoever is selected — projects, available reels, revisions queue. Switch creators to see the page re-flow. The creator picker stays visible while you scroll.`,
  },
  {
    target: '#tour-projects',
    placement: 'top',
    title: 'Step 2 — Projects tab (home base)',
    body: `Each card is one (creator, reel) pair you've committed to.

Status badges tell you what's next:
• Started — you started the project; do TJP work, then Continue to upload the photo
• Generating — portal is rendering your variation (3–6 min, just wait)
• Pending — variation is done, click ✓ to approve
• Approved — ready! Click ZIP for TJP outfit + motion
• Failed — variation didn't render; click to retry

The + New Project button at the top of this tab opens the unified modal: pick a reel from the Library or upload a brand-new one from your computer, then choose Bedroom Content or Direct Upload.`,
  },
  {
    placement: 'center',
    title: 'Step 3 — Inspo Board tab',
    body: `Switch to the Inspo Board tab to browse available source reels for the picked creator.

Each card has two actions:
• ↓ Raw — downloads the reel bytes AND starts a Started project for it
• ✨ New Project — opens the New Project modal preselected with this reel; choose Bedroom Content or Direct Upload inside the modal

You can also multi-select reels (checkbox on each card) and Download N as ZIP — that starts N projects in one go. Use ↑ Upload inspo to add a brand-new reel to the pool from your computer.`,
  },
  {
    placement: 'center',
    title: 'Step 4 — Bedroom Content workflow',
    body: `Choose Bedroom Content in the New Project modal when you want the portal to inject the creator into a saved bedroom scene.

The flow:
1. Project lands on the Projects tab in Started state
2. Do TJP image-to-image to get a photo of the creator in this reel's pose & outfit
3. Click Continue on the project card → the Bedroom Scene tab opens with the project loaded
4. Upload your TJP photo → portal generates the variation
5. Approve → ZIP for TJP → outfit transfer + motion control in TJP
6. Come back and upload the finished video back to the project (via ✨ New Project → Direct Upload on the same reel, or by adding it to the project from there)`,
  },
  {
    placement: 'center',
    title: 'Step 5 — Direct Upload workflow',
    body: `Choose Direct Upload in the New Project modal when you already have finished AI videos for a reel (produced however — TJP, custom edits, freelance work, whatever).

Drop one or many files. Each becomes its own review item, all linked back to the same source reel. Thumbnails auto-extract from the first frame. Files upload directly to Dropbox in parallel and get mirrored to Cloudflare Stream automatically for admin review.

No naming convention required — just pick your files and submit.`,
  },
  {
    target: '#tour-revisions',
    placement: 'bottom',
    title: 'Step 6 — Handle any rejections',
    body: `If admin rejects something, the video appears at the top of the Projects tab with their feedback + screenshots.

Three ways to handle it:
• Re-upload revised — small tweak (re-edit, drop a new mp4)
• Re-do Variation — start over from a fresh Bedroom Scene
• Discard — when the rejected version is dead

(Section only appears when there's something to revise.)`,
  },
  {
    placement: 'center',
    title: 'Step 7 — Quick mental model',
    body: `Mental shortcuts:

• Pick a creator → everything filters to them
• Inspo Board → pick a source reel → ✨ New Project
• Bedroom Content path → TJP → portal variation → TJP outfit → upload back
• Direct Upload path → drop files → done
• Approved items land in admin For Review; rejected ones show up in your Revisions

Hit ⓘ Help any time to replay this walkthrough.`,
  },
]


function ReelCard({ reel, creatorId, selected, onToggle, onUploaded, autoOpen, onProjectStarted, onNewProject }) {
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
          // Use the token route's resolved slug — it may have allocated a
          // fresh "_O{nn}" variant to avoid overwriting an existing upload.
          slug: tok.slug || slug,
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
          {/* ✨ New Project is now the single workflow entry for this reel.
              Opens NewProjectModal preselected — offers Bedroom Content (the
              old Create Scene flow) or Direct Upload (the old Upload AI flow,
              now multi-file with auto-thumbs). Removed the old per-card
              Create Scene + Upload AI buttons (2026-05-27) — they did the
              same things but bypassed the explicit project-creation step. */}
          <button
            onClick={() => onNewProject?.(reel)}
            style={{
              flex: '2 1 160px', textAlign: 'center', padding: '6px 0', fontSize: 12, fontWeight: 700,
              color: 'var(--palm-pink)', background: 'rgba(232,160,160,0.10)',
              border: '1px solid rgba(232,160,160,0.30)', borderRadius: 5, cursor: 'pointer',
            }}
            title="Start a project for this reel — choose Bedroom Content or Direct Upload inside the modal"
          >✨ New Project</button>
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

// Editor-perspective state derived from the raw scene status + uploadedAt
// + adminReviewStatus. The raw "Approved" badge means the bedroom-scene
// variation was approved, NOT that the project is done — that misled
// editors who thought "Approved = shipped." This derived step describes
// what the editor (or admin) needs to do next.
//
// Custom Edit variations (`s.source === 'custom-edit'`) skip the
// Bedroom-only states (Started / Generating / Pending / Failed) — there
// is no portal render to wait for. They're always uploaded, so the only
// states are "awaiting admin," "complete," or "admin-rejected."
function sceneStep(s) {
  if (s?.source === 'custom-edit') {
    if (s.adminReviewStatus === 'Approved') return 'complete'
    if (s.adminReviewStatus === 'Needs Revision' || s.adminReviewStatus === 'Rejected') return 'admin-rejected'
    return 'awaiting-admin'
  }
  // Freelance projects skip the entire bedroom-scene state machine — no
  // portal render, no pose pick. Only states: project claimed (waiting
  // on the editor to upload finished reels), uploaded (admin reviewing),
  // approved (done), or rejected (revision needed).
  if (s.workflowType === 'Freelance') {
    if (!s.uploadedAt) return 'freelance-upload-pending'
    if (s.adminReviewStatus === 'Approved') return 'complete'
    if (s.adminReviewStatus === 'Rejected' || s.adminReviewStatus === 'Needs Revision') return 'admin-rejected'
    return 'awaiting-admin'
  }
  if (s.status === 'Started')    return 'tjp-photo'
  if (s.status === 'Generating') return 'rendering'
  if (s.status === 'Pending')    return 'approve-scene'
  if (s.status === 'Failed')     return 'failed'
  if (s.status === 'Rejected')   return 'rejected'
  if (s.status === 'Approved') {
    if (!s.uploadedAt) return 'tjp-motion'
    if (s.adminReviewStatus === 'Approved') return 'complete'
    if (s.adminReviewStatus === 'Rejected' || s.adminReviewStatus === 'Needs Revision') return 'admin-rejected'
    return 'awaiting-admin'
  }
  return 'unknown'
}

// Short label per workflow type — drives the pill badges on cards and
// inside carousel slide indicators. Mixed groups show both pills.
// Freelance is a Stage B record (source='bedroom') with Workflow Type
// flipped — uses its own label/color so editors don't see "Bedroom" on
// a card that's actually skipping the bedroom flow.
const WORKFLOW_LABEL = { bedroom: 'Bedroom', 'custom-edit': 'Custom Edit', freelance: 'Freelance' }
const WORKFLOW_COLOR = { bedroom: '#7DD3A4', 'custom-edit': '#C8A8FF', freelance: '#E8A0A0' }

const STEP_LABEL = {
  'freelance-upload-pending': 'Ready — upload final reels',
  'tjp-photo':      'Need TJP photo',
  'rendering':      'Rendering scene',
  'approve-scene':  'Approve scene',
  'tjp-motion':     'Do TJP outfit/motion → upload',
  'awaiting-admin': 'Submitted — awaiting admin',
  'admin-rejected': 'Rejected — see Revisions',
  'rejected':       'Variation rejected',
  'failed':         'Failed — retry',
  'complete':       'Done ✓',
  'unknown':        '—',
}

const STEP_COLOR = {
  'freelance-upload-pending': '#C8A8FF',
  'tjp-photo':      '#aaa',
  'rendering':      '#8fb4f0',
  'approve-scene':  '#e8b878',
  'tjp-motion':     '#e8b878',
  'awaiting-admin': '#C8A8FF',
  'admin-rejected': '#E87878',
  'rejected':       '#E87878',
  'failed':         '#E87878',
  'complete':       '#6AC68A',
  'unknown':        '#888',
}

// Priority order — most-urgent step at the top of a group dictates the
// card's headline. "Done" sits at the bottom so any in-flight work
// outranks completion when scenes are mixed. Freelance-upload-pending
// sits with tjp-photo (both = "editor's turn, do the next step").
const STEP_PRIORITY = ['failed', 'admin-rejected', 'tjp-photo', 'freelance-upload-pending', 'approve-scene', 'tjp-motion', 'rendering', 'awaiting-admin', 'rejected', 'complete', 'unknown']

function MyProjectsSection({ projects, creatorId, akaName, onChange, onNewProject }) {
  // Don't early-return when there are zero projects — we still want the
  // "+ New Project" button visible. Render an empty-state below instead.
  const hasProjects = !!projects?.length

  // Group projects by reel record ID. A few really old rows may not have
  // a reel reference — keep those bucketed under their own project ID so
  // they don't all collide into one anonymous group.
  const allGroups = (() => {
    const byReel = new Map()
    for (const p of (projects || [])) {
      const key = p.reel?.id || `__noReel_${p.id}`
      if (!byReel.has(key)) byReel.set(key, { reelKey: key, reel: p.reel || null, scenes: [] })
      byReel.get(key).scenes.push(p)
    }
    for (const g of byReel.values()) {
      g.counts = g.scenes.reduce((m, s) => { m[s.status] = (m[s.status] || 0) + 1; return m }, {})
      // Derived editor-perspective top step (drives the card label + color).
      const sceneSteps = g.scenes.map(sceneStep)
      g.topStep = STEP_PRIORITY.find(step => sceneSteps.includes(step)) || 'unknown'
      // A group is "completed" only when every scene reads as Done.
      g.editorState = sceneSteps.length > 0 && sceneSteps.every(s => s === 'complete') ? 'completed' : 'in-progress'
      g.newest = g.scenes.reduce((t, s) => (s.createdTime || '') > t ? (s.createdTime || '') : t, '')
    }
    return [...byReel.values()].sort((a, b) => {
      const pa = STEP_PRIORITY.indexOf(a.topStep)
      const pb = STEP_PRIORITY.indexOf(b.topStep)
      if (pa !== pb) return pa - pb
      return (b.newest || '').localeCompare(a.newest || '')
    })
  })()

  // Filter: In Progress (default) vs Completed. Anything that still
  // needs editor or admin action lives in In Progress.
  const [editorFilter, setEditorFilter] = useState('in-progress')
  const inProgressCount = allGroups.filter(g => g.editorState === 'in-progress').length
  const completedCount  = allGroups.filter(g => g.editorState === 'completed').length
  const groups = allGroups.filter(g => g.editorState === editorFilter)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>Projects</div>
          {/* In Progress / Completed toggle — replaces the old wall-of-text
              status summary. Counts come from the derived editorState. */}
          {hasProjects && (
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'in-progress', label: 'In Progress', count: inProgressCount },
                { key: 'completed',   label: 'Completed',   count: completedCount },
              ].map(f => (
                <button key={f.key}
                  onClick={() => setEditorFilter(f.key)}
                  style={{
                    padding: '5px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
                    background: editorFilter === f.key ? 'rgba(232,160,160,0.10)' : 'rgba(255,255,255,0.03)',
                    color: editorFilter === f.key ? 'var(--palm-pink)' : '#aaa',
                    border: `1px solid ${editorFilter === f.key ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 999, cursor: 'pointer',
                  }}>
                  {f.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{f.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* + New Project — top-level entry to the New Project Modal with
            no preselected reel (opens the library picker inside the modal). */}
        {onNewProject && (
          <button
            onClick={() => onNewProject()}
            style={{
              padding: '7px 14px', fontSize: 12, fontWeight: 700,
              color: '#fff', background: 'var(--palm-pink)',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              flexShrink: 0,
            }}
            title="Start a new project — pick a reel from the library or upload one">
            + New Project
          </button>
        )}
      </div>
      {hasProjects ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {groups.map(g => <ReelProjectCard key={g.reelKey} group={g} creatorId={creatorId} akaName={akaName} onChange={onChange} />)}
        </div>
      ) : (
        <div style={{
          padding: 28, textAlign: 'center', fontSize: 12, color: 'var(--foreground-muted)',
          border: '1px dashed rgba(255,255,255,0.10)', borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
        }}>
          No projects yet for this creator. Click <strong>+ New Project</strong> above to start one.
        </div>
      )}
    </div>
  )
}

// One card per reel. Shows a thumbnail carousel (source reel + each
// variation's submitted/scene thumbnail), the derived editor step
// label, and a CTA into the workflow.
//
// Freelance vs Bedroom: derived from the scenes' workflowType. Freelance
// cards swap the "Continue → upload TJP photo" link for an "↑ Upload
// final reels" button that opens the FreelanceSubmitModal — no portal
// scene step, no TJP image-to-image.
function ReelProjectCard({ group, creatorId, onChange, akaName }) {
  const { reel, scenes, counts, topStep } = group
  const stepLabel = STEP_LABEL[topStep] || topStep
  const sc = STEP_COLOR[topStep] || '#888'

  // Workflow composition for this card. Drives the pill badge(s) and
  // the gating on the Discard button + CTA. A "mixed" card has both
  // Bedroom and Custom Edit variations under the same source reel.
  const bedroomScenes = scenes.filter(s => s.source !== 'custom-edit')
  const customScenes = scenes.filter(s => s.source === 'custom-edit')
  const hasBedroom = bedroomScenes.length > 0
  const hasCustom = customScenes.length > 0
  const customOnly = hasCustom && !hasBedroom

  // Group-level workflow type. Stage B Outputs (bedroomScenes here)
  // carry the Workflow Type field; Custom Edit variations don't have
  // one. Find the first scene that does. Default to Bedroom for older
  // records that predate the field.
  const groupWorkflowType = scenes.find(s => s.workflowType)?.workflowType || 'Bedroom'
  const isFreelance = groupWorkflowType === 'Freelance'

  // The Freelance submit modal — drag-drop final reels, confirm,
  // upload. Holds the Stage B record id so the upload route can stamp
  // Uploaded At on it via the existing slug bridge.
  const [showFreelanceSubmit, setShowFreelanceSubmit] = useState(false)
  const freelanceTarget = scenes.find(s => s.workflowType === 'Freelance') || scenes[0]

  // Carousel slides: [source reel, ...each variation]. Variation prefers
  // its uploadedThumbnail (the actual submitted video) over the scene
  // image so editors see what they shipped, not the bedroom-scene
  // generation that preceded it.
  const sourceThumb = (reel?.streamUid && buildStreamPosterUrl(reel.streamUid, { width: 240, fit: 'crop' }))
    || reel?.thumbnail || null
  const slides = [
    { kind: 'source', src: sourceThumb, label: 'Source reel', step: null, source: null },
    ...scenes.map(s => ({
      kind: 'variation',
      src: s.uploadedThumbnail || s.image || null,
      label: s.slug || `Variation ${s.index ?? ''}`.trim(),
      step: sceneStep(s),
      uploaded: !!s.uploadedAt,
      source: s.source || 'bedroom',
    })),
  ]
  const [slideIdx, setSlideIdx] = useState(0)
  const slide = slides[Math.min(slideIdx, slides.length - 1)] || slides[0]
  const prev = () => setSlideIdx(i => (i - 1 + slides.length) % slides.length)
  const next = () => setSlideIdx(i => (i + 1) % slides.length)

  // Custom-only cards don't have a Bedroom Scene page to open — there
  // are no Stage B Outputs backing them. CTA becomes a link to the
  // source reel. Bedroom + Freelance cards have Stage B records and
  // keep the existing workflow CTA / Freelance upload modal.
  const openHref = customOnly
    ? (reel?.url || '#')
    : `/ai-editor?tab=create&creator=${creatorId}&reel=${reel?.id || ''}`
  const ctaLabel = customOnly
    ? (topStep === 'admin-rejected' ? 'See Revisions' : '↗ View source reel')
    : topStep === 'freelance-upload-pending' ? '↑ Upload final reels'
    : topStep === 'tjp-photo'      ? 'Continue → upload TJP photo'
    : topStep === 'rendering'      ? '⏳ Rendering…'
    : topStep === 'approve-scene'  ? 'Review variations'
    : topStep === 'tjp-motion'     ? 'Open workflow → upload'
    : topStep === 'awaiting-admin' ? (isFreelance ? '↑ Upload more reels' : 'View')
    : topStep === 'admin-rejected' ? 'See Revisions'
    : topStep === 'failed'         ? '↻ Retry'
    : topStep === 'rejected'       ? '↻ Retry / view'
    : topStep === 'complete'       ? (isFreelance ? '↑ Upload more reels' : 'View')
    : 'Open workflow'

  // Freelance cards bypass the workflow page entirely — the CTA opens
  // the submit modal in-place. Bedroom keeps its href navigation. Also
  // expose the upload modal from the "awaiting-admin" / "complete"
  // states so the editor can submit additional finals on the same reel.
  const freelanceCanUpload = isFreelance && (
    topStep === 'freelance-upload-pending' ||
    topStep === 'awaiting-admin' ||
    topStep === 'complete'
  )

  // Discard at the reel level wipes every Bedroom + Freelance scene
  // record under it. Custom Edit variations are Task records owned by
  // admin — editors can't delete those from this surface. So discard
  // only operates on Bedroom-backed scenes; on custom-only cards the
  // button isn't rendered at all.
  const discardReel = async () => {
    const hasApproved = (counts.Approved || 0) > 0
    const targetScenes = bedroomScenes
    if (targetScenes.length === 0) return
    const customNote = hasCustom
      ? ` (${customScenes.length} Custom Edit variation${customScenes.length === 1 ? '' : 's'} on this reel will stay — admin manages those.)`
      : ''
    const msg = hasApproved
      ? `This reel has ${counts.Approved} approved Bedroom variation${counts.Approved === 1 ? '' : 's'}. Discarding wipes ALL ${targetScenes.length} Bedroom variations for this reel — even the approved ones.${customNote} Continue?`
      : `Discard every Bedroom variation under this reel (${targetScenes.length} total)? The reel goes back to the pool so you (or someone else) can re-start it.${customNote}`
    if (!(await uiConfirm(msg, { danger: true, okLabel: 'Discard reel' }))) return
    try {
      await Promise.all(targetScenes.map(s =>
        fetch(`/api/admin/recreate-rooms/stage-b/outputs?id=${s.id}`, { method: 'DELETE' })
      ))
      onChange?.()
    } catch {}
  }

  return (
    <div style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
      <div style={{ position: 'relative', aspectRatio: '9/16', background: '#000' }}>
        {/* Render every slide stacked so they all start loading in parallel
            at card mount — clicking the arrows just toggles opacity, no
            fresh fetch. Without this the user sees a blank flash every
            time they click next because src-swap on a single <img>
            triggers a brand-new load. */}
        {slides.map((s, i) => s.src ? (
          <img key={i} src={s.src} alt="" loading={i === 0 ? 'eager' : 'lazy'}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'cover',
              opacity: i === slideIdx ? 1 : 0,
              transition: 'opacity 0.12s ease',
              pointerEvents: 'none',
            }} />
        ) : null)}
        {!slide.src && (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: sc }}>no thumb</div>
        )}
        {/* Carousel arrows — only shown when there's more than one slide. */}
        {slides.length > 1 && (
          <>
            <button onClick={prev} aria-label="Previous"
              style={{ position: 'absolute', top: '50%', left: 6, transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            <button onClick={next} aria-label="Next"
              style={{ position: 'absolute', top: '50%', right: 6, transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
              {slides.map((_, i) => (
                <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: i === slideIdx ? '#fff' : 'rgba(255,255,255,0.4)' }} />
              ))}
            </div>
          </>
        )}
        {/* Variation count + workflow badge on the top-left. Mixed
            groups show both workflow pills so the editor immediately
            sees that this reel has Bedroom AND Custom Edit work. */}
        <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
          <div style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.7)', borderRadius: 4 }}>
            {scenes.length} variation{scenes.length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {hasBedroom && (
              isFreelance ? (
                <span style={{ padding: '2px 6px', fontSize: 9, fontWeight: 700, color: '#2a0a0a', background: WORKFLOW_COLOR.freelance, borderRadius: 3, letterSpacing: '0.02em' }}>{WORKFLOW_LABEL.freelance}</span>
              ) : (
                <span style={{ padding: '2px 6px', fontSize: 9, fontWeight: 700, color: '#0a1a10', background: WORKFLOW_COLOR.bedroom, borderRadius: 3, letterSpacing: '0.02em' }}>{WORKFLOW_LABEL.bedroom}</span>
              )
            )}
            {hasCustom && (
              <span style={{ padding: '2px 6px', fontSize: 9, fontWeight: 700, color: '#1a0a2a', background: WORKFLOW_COLOR['custom-edit'], borderRadius: 3, letterSpacing: '0.02em' }}>{WORKFLOW_LABEL['custom-edit']}</span>
            )}
          </div>
        </div>
        {/* What slide am I on — source reel vs a specific variation —
            with the variation's per-step status surfaced inline so the
            editor sees "Awaiting admin" / "✓ Approved" / "Rejected" per
            slide without expanding anything. */}
        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, maxWidth: 160 }}>
          <div style={{ padding: '2px 6px', fontSize: 9, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.7)', borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
            {slide.kind === 'source' ? 'Source reel' : (slide.uploaded ? '✓ ' : '') + slide.label}
          </div>
          {slide.kind === 'variation' && slide.step && (
            <div style={{ padding: '2px 6px', fontSize: 9, fontWeight: 700, background: `${STEP_COLOR[slide.step] || '#888'}33`, color: STEP_COLOR[slide.step] || '#888', border: `1px solid ${STEP_COLOR[slide.step] || '#888'}66`, borderRadius: 3, whiteSpace: 'nowrap' }}>
              {STEP_LABEL[slide.step] || slide.step}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: 10, fontSize: 11 }}>
        {/* Step pill — derived from real editor-step, not the misleading
            raw Status. Replaces the old "Approved" badge that confused
            editors into thinking the project was done. */}
        <div style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${sc}22`, color: sc, marginBottom: 6 }}>
          {stepLabel}
        </div>
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
        {freelanceCanUpload ? (
          <button onClick={() => setShowFreelanceSubmit(true)}
            style={{ display: 'block', width: '100%', marginTop: 8, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: `${sc}28`, color: sc, borderRadius: 5, border: 'none', cursor: 'pointer' }}>
            {ctaLabel}
          </button>
        ) : (
          <a href={openHref}
            target={customOnly ? '_blank' : undefined}
            rel={customOnly ? 'noreferrer' : undefined}
            style={{ display: 'block', marginTop: 8, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: `${sc}28`, color: sc, borderRadius: 5, textDecoration: 'none' }}>
            {ctaLabel}
          </a>
        )}
        {/* Discard reel — only renders for cards that have Bedroom or
            Freelance scenes backing them (i.e. Stage B Output records).
            Custom-only cards have nothing the editor is allowed to
            delete from this surface (admin owns the Task records). */}
        {hasBedroom && (
          <button onClick={discardReel}
            style={{ width: '100%', marginTop: 6, padding: '4px 0', fontSize: 10, color: '#888', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, cursor: 'pointer' }}>
            🗑 Discard reel{hasCustom ? ' (Bedroom only)' : ''}
          </button>
        )}
      </div>
      {showFreelanceSubmit && (
        <FreelanceSubmitModal
          reel={reel}
          creatorId={creatorId}
          akaName={akaName}
          slug={freelanceTarget?.slug || ''}
          onClose={() => setShowFreelanceSubmit(false)}
          onDone={() => { setShowFreelanceSubmit(false); onChange?.() }}
        />
      )}
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
  const [showVideo, setShowVideo] = useState(false)
  const fileRef = useRef(null)

  // The rejected AI reel, playable: prefer CF Stream, fall back to Dropbox raw.
  const rawDropbox = rev.dropboxLink ? String(rev.dropboxLink).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''
  const canPlay = !!(rev.streamUid || rawDropbox)

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
        {(rev.thumbnail || canPlay) && (
          <button
            onClick={() => canPlay && setShowVideo(true)}
            title={canPlay ? 'Play the rejected video' : ''}
            style={{ position: 'relative', width: 56, aspectRatio: '9/16', flexShrink: 0, padding: 0, border: 'none', borderRadius: 5, overflow: 'hidden', background: '#000', cursor: canPlay ? 'pointer' : 'default' }}>
            {rev.thumbnail
              ? <img src={rev.thumbnail} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%' }} />}
            {canPlay && (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, textShadow: '0 1px 4px rgba(0,0,0,0.7)', background: 'rgba(0,0,0,0.15)' }}>▶</span>
            )}
          </button>
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
↻ Re-do Variation
          </a>
        )}
      </div>
      <button onClick={async () => {
        if (!(await uiConfirm(`Discard this rejected task? The Dropbox file stays (archive). Use this when you're starting fresh with a new variation — otherwise just re-upload.`, { danger: true, okLabel: 'Discard' }))) return
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
🗑 Discard (starting a new variation from scratch)
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

      {/* Play the rejected video so the editor can see exactly what was sent back. */}
      {showVideo && canPlay && (
        <div onClick={() => setShowVideo(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(420px, 92vw)', aspectRatio: '9/16', maxHeight: '92vh', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
            {rev.streamUid ? (
              <iframe src={buildStreamIframeUrl(rev.streamUid, { autoplay: true })} allow="autoplay; fullscreen" allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none' }} title="rejected reel" />
            ) : (
              <video src={rawDropbox} controls autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
            )}
            <button onClick={() => setShowVideo(false)}
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', fontSize: 20, lineHeight: 1, width: 32, height: 32, borderRadius: 16, cursor: 'pointer' }}>×</button>
          </div>
        </div>
      )}
    </div>
  )
}


export default function AiEditorBody({ embedded = false } = {}) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlCreator = sp.get('creator') || ''
  const urlUpload = sp.get('upload') || ''
  const urlReel = sp.get('reel') || undefined
  const urlProject = sp.get('project') || undefined
  // Role gate — used to hide tabs an AI editor shouldn't see (e.g.
  // Carousel Upload while that workflow is still being iterated on).
  const { user } = useUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  // Inner tab — URL-backed when standalone at /ai-editor; held in React state
  // when `embedded` inside the admin shell (/admin/recreate-source?tab=workflow),
  // because the outer admin page already owns `?tab=` for its setup/workflow/
  // strategy strip and writing to it would yank that strip back to default.
  const tabParam = embedded ? null : sp.get('tab')
  // Internal tab keys kept as-is to preserve URL bookmarks ('workspace',
  // 'create', 'carousel'), but the user-facing labels are now Projects /
  // Bedroom Scene / Carousel respectively. New 'inspo' tab owns the
  // Fresh Inspo grid that used to live inside Workspace.
  const [localTab, setLocalTab] = useState('workspace')
  const urlTab = tabParam === 'create' ? 'create' : tabParam === 'carousel' ? 'carousel' : tabParam === 'inspo' ? 'inspo' : tabParam === 'outfits' ? 'outfits' : 'workspace'
  const tab = embedded ? localTab : urlTab
  const setTab = (k, extra = {}) => {
    if (embedded) {
      setLocalTab(k)
      // Sibling query params (creator/upload/reel/project) still flow through
      // the URL — those don't collide with the outer admin tab strip.
      if (Object.keys(extra).length > 0) {
        const params = new URLSearchParams(sp.toString())
        for (const [key, val] of Object.entries(extra)) {
          if (val == null) params.delete(key)
          else params.set(key, val)
        }
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }
      return
    }
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
  // Inspo board source filter (added 2026-05-27 per owner). Lets the AI
  // editor narrow the fresh-inspo grid to just admin-added reels or just
  // editor-uploaded reels. Default 'all' preserves prior behavior.
  const [reelSourceFilter, setReelSourceFilter] = useState('all') // 'all' | 'admin' | 'editor'
  // Reel-id → random sort key. Empty = default order (newest first
  // from the API). Click 🎲 Randomize to repopulate with fresh
  // Math.random() per visible reel; sort renders them in that order.
  // Reels not in the map (e.g. new arrivals after a randomize) get
  // a default key of -1 so they show first.
  const [reelRandomMap, setReelRandomMap] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revisions, setRevisions] = useState([])
  const [projects, setProjects] = useState([])
  // New Project Modal — Phase A1. Holds the preselected reel when an
  // editor clicks "✨ New Project" on a ReelCard. Phase A2 will also
  // allow opening the modal with no preselect (global "+ New Project"
  // button + library picker inside).
  const [newProjectReel, setNewProjectReel] = useState(null)
  // Bulk Submit modal — front-and-center "drop a batch of finished AI reels
  // for a creator" flow (standalone, not tied to a source pool reel).
  const [bulkSubmitOpen, setBulkSubmitOpen] = useState(false)
  // "Upload inspo" modal state — editor drops a local video file
  // (mp4/mov/webm), we direct-upload to Dropbox + create a Recreate
  // Reel record so the file appears in the Fresh Inspo grid. NOT an
  // IG URL flow — admins still drive IG scraping via /admin/recreate-
  // source; the editor uploads their own local files.
  // Carousel-tab: shared linked-project ID between Reference Library
  // (start project → auto-link) and Upload Section (Link-to-project
  // dropdown). Lifted here so a successful Start Project pre-selects
  // the project in the upload form.
  const [carouselLinkedProjectId, setCarouselLinkedProjectId] = useState('')
  const [uploadInspoOpen, setUploadInspoOpen] = useState(false)
  // Multi-file Upload Inspo: editor can drop / pick N video files at once
  // and each one creates its own Recreate Reel record in parallel. The
  // statuses map (file.name → { status, message }) drives the inline
  // progress list — same pattern the New Project modal uses for Direct
  // Upload, just pointed at the local-reel finalize endpoint instead of
  // the project-scoped upload finalize.
  const [uploadInspoFiles, setUploadInspoFiles] = useState([])
  const [uploadInspoStatuses, setUploadInspoStatuses] = useState({})
  const [uploadInspoCaption, setUploadInspoCaption] = useState('')
  const [uploadInspoDragOver, setUploadInspoDragOver] = useState(false)
  const [uploadInspoBusy, setUploadInspoBusy] = useState(false)
  const [uploadInspoError, setUploadInspoError] = useState('')
  const [uploadInspoMsg, setUploadInspoMsg] = useState('')
  const uploadInspoFileRef = useRef(null)

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

  // Editor uploads ONE OR MORE local video files → each runs the 3-step
  // direct-to-Dropbox flow (token → PUT bytes → finalize) in parallel.
  // Each file becomes its own Recreate Reel record (Status='Available',
  // Added Via='Editor Upload'). Stream mirror fires on the finalize
  // endpoint so playback uses Cloudflare's CDN poster + iframe player
  // within ~30s; downloads still pull the raw Dropbox file.
  const acceptUploadInspoFiles = (files) => {
    if (!files || files.length === 0) return
    const arr = Array.from(files).filter(f => f.type?.startsWith('video/'))
    if (arr.length === 0) { setUploadInspoError('Need video files (mp4, mov, webm)'); return }
    setUploadInspoError('')
    // Append to existing selection (drag in a few, then drag in a few more)
    // de-duped by name+size so the same drop doesn't queue dupes.
    setUploadInspoFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}|${f.size}`))
      const merged = [...prev]
      for (const f of arr) {
        const key = `${f.name}|${f.size}`
        if (!seen.has(key)) { seen.add(key); merged.push(f) }
      }
      return merged
    })
  }

  // Per-file uploader — captures statuses in the shared map so the modal
  // can render an inline status row per file as work progresses.
  const uploadOneInspoFile = async (file, caption) => {
    const setStatus = (s) => setUploadInspoStatuses(prev => ({ ...prev, [file.name]: s }))
    try {
      setStatus({ status: 'token', message: 'Requesting Dropbox token…' })
      const tokRes = await fetch('/api/ai-editor/upload-local-reel/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      })
      const tok = await tokRes.json()
      if (!tokRes.ok) throw new Error(tok.error || 'Could not get upload token')

      setStatus({ status: 'dropbox', message: `Uploading ${(file.size / (1024*1024)).toFixed(1)} MB to Dropbox…` })
      const dbxRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: tok.path, mode: 'overwrite', mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: await file.arrayBuffer(),
      })
      if (!dbxRes.ok) throw new Error(`Dropbox upload failed (${dbxRes.status})`)

      setStatus({ status: 'finalize', message: 'Creating reel record…' })
      const finRes = await fetch('/api/ai-editor/upload-local-reel/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxPath: tok.path, shortid: tok.shortid, caption: caption || '' }),
      })
      const fin = await finRes.json()
      if (!finRes.ok) throw new Error(fin.error || 'Finalize failed')
      setStatus({ status: 'done', message: `✓ Added · ${fin.reelId}` })
      return { ok: true, reelId: fin.reelId }
    } catch (e) {
      setStatus({ status: 'error', message: e.message })
      return { ok: false, error: e.message }
    }
  }

  const submitUploadInspo = async () => {
    if (uploadInspoFiles.length === 0) { setUploadInspoError('Pick at least one video file first'); return }
    setUploadInspoBusy(true); setUploadInspoError(''); setUploadInspoMsg('')
    // Seed the statuses map so every row shows "Queued…" from the start,
    // not just the in-flight ones. Otherwise long files look broken.
    const init = {}
    for (const f of uploadInspoFiles) init[f.name] = { status: 'queued', message: 'Queued…' }
    setUploadInspoStatuses(init)

    // Run all uploads in parallel. Each call updates the statuses map
    // independently — there's no batch endpoint, the local-reel finalize
    // is single-file. Concurrent uploads here mirror what the New Project
    // modal does in its Direct Upload stage.
    const results = await Promise.all(uploadInspoFiles.map(f => uploadOneInspoFile(f, uploadInspoCaption)))
    const failed = results.filter(r => !r.ok).length
    const success = results.length - failed
    setUploadInspoBusy(false)

    if (failed === 0) {
      setUploadInspoMsg(`✓ Added ${success} reel${success === 1 ? '' : 's'} to the pool`)
      // Brief delay so the editor sees the ✓ row states before the modal
      // closes — feels less abrupt than snapping shut immediately.
      setTimeout(() => {
        setUploadInspoOpen(false)
        setUploadInspoFiles([])
        setUploadInspoStatuses({})
        setUploadInspoCaption('')
        loadReels(creatorId)
      }, 1500)
    } else {
      setUploadInspoError(`${failed} of ${results.length} failed — see per-file status above`)
      // Refresh anyway so the successful ones appear in the grid.
      loadReels(creatorId)
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
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', padding: '0 clamp(12px, 4vw, 32px) clamp(16px, 4vw, 32px)' }}>
      {/* Sticky header + tab bar — creator picker stays visible on scroll
          so the editor never loses track of who they're editing for.
          `top: 49px` sits below the global Palm Header (which is itself
          sticky at top:0, zIndex:40, ~49px tall — matches the page
          wrapper's `calc(100vh - 49px)` minHeight calc above). */}
      <div style={{ position: 'sticky', top: 49, zIndex: 20, background: 'var(--background)', paddingTop: 'clamp(16px, 4vw, 32px)', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)' }}>AI Recreate</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Front-and-center: drop a batch of finished AI reels for a
              creator, straight to admin review. Standalone flow — no source
              reel or project needed. */}
          <button
            onClick={() => setBulkSubmitOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', boxShadow: '0 2px 10px rgba(232,143,172,0.35)' }}>
            ↑ Submit finished reels
          </button>
          <TourTriggerButton storageKey="ai-editor-pool-v7" label="ⓘ Help" />
          <select
            id="tour-creator-picker"
            value={creatorId}
            onChange={e => {
              // Persist the picked creator in the URL so a refresh keeps
              // the selection. setTab handles param merging — passing the
              // current tab keeps us on whichever tab the user is viewing.
              const next = e.target.value
              setCreatorId(next)
              setTab(tab, { creator: next || null })
            }}
            style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}
          >
            {creators.length === 0 && <option>No TJP creators</option>}
            {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Tab bar — both workflow stages on one page so Continue doesn't
          feel like navigating to a different surface. */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('workspace')}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'workspace' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'workspace' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
          Projects{revisions.length > 0 ? <span style={{ marginLeft: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700, background: '#E87878', color: '#1a0a0a', borderRadius: 8 }}>{revisions.length}</span> : projectsForBadge > 0 ? <span style={{ marginLeft: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700, background: 'rgba(232,184,120,0.5)', color: '#1a0a0a', borderRadius: 8 }}>{projectsForBadge}</span> : null}
        </button>
        <button onClick={() => setTab('inspo')}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'inspo' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'inspo' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
          Inspo Board
        </button>
        {/* Bedroom Scene is no longer a discoverable cold-start tab — it
            only shows when the user has an active project (so Continue
            jumps there) or they're already viewing it from a direct link.
            New cold-starts route through ✨ New Project → Bedroom Content. */}
        {(projectsForBadge > 0 || tab === 'create') && (
          <button onClick={() => setTab('create')}
            style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'create' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'create' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
            Bedroom Scene
          </button>
        )}
        {/* Outfit Library — embedded inline as a tab so AI editors
            (who can't see /admin/*) get the same view admins do at
            /admin/recreate-source?tab=outfits. Same LibrarySection
            component, outfitsOnly={true}. */}
        <button onClick={() => setTab('outfits')}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'outfits' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'outfits' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
          Outfit Library
        </button>
        {/* Carousels — the scraped-IG-carousel Reference Library + upload.
            Admin only (clutter for editors); content below is isAdmin-gated too. */}
        {isAdmin && (
          <button onClick={() => setTab('carousel')}
            style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, color: tab === 'carousel' ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none', borderBottom: tab === 'carousel' ? '2px solid var(--palm-pink)' : '2px solid transparent', cursor: 'pointer', marginBottom: -1 }}>
            Carousels
          </button>
        )}
      </div>
      </div>
      {/* /sticky header+tabs */}

      {tab === 'carousel' && isAdmin && (() => {
        // Shared between Reference Library + Upload section so Start
        // Project can auto-link the new project into the upload form
        // and auto-scroll the editor to it. Plain function-scope vars
        // need to live on the AiEditorPage component above; declared
        // there as `carouselLinkedProjectId` / setter.
        return (
          <>
            <CarouselReferenceLibrary
              creatorId={creatorId}
              creatorName={creators?.find(c => c.id === creatorId)?.name || ''}
              onProjectStarted={(projectId) => {
                setCarouselLinkedProjectId(projectId)
                // Smooth-scroll to the upload section after the badge update
                // settles. The upload section root has id="carousel-upload-anchor".
                setTimeout(() => {
                  document.getElementById('carousel-upload-anchor')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 100)
              }}
            />
            <CarouselUploadSection
              creatorId={creatorId}
              creators={creators}
              linkedProjectId={carouselLinkedProjectId}
              onLinkedProjectIdChange={setCarouselLinkedProjectId}
            />
          </>
        )
      })()}

      {tab === 'create' && (
        <>
          <StageBPanel initialCreatorId={creatorId} initialReelRecordId={urlReel} initialProjectId={urlProject} />
          <ModalHost />
        </>
      )}

      {/* Outfit Library — same component admins see at
          /admin/recreate-source?tab=outfits, embedded inline so AI
          editors (who can't reach /admin/*) get the same surface. */}
      {tab === 'outfits' && (
        <>
          <OutfitLibrarySection outfitsOnly />
          <ModalHost />
        </>
      )}
      {tab === 'workspace' && (
      <>
      {/* Projects tab — revisions + in-flight projects (Fresh Inspo
          grid lives in the separate Inspo Board tab below). */}
      <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: -6, marginBottom: 14 }}>
        Your in-flight projects. Start a new one from <strong>+ New Project</strong> below or from the <strong>Inspo Board</strong> tab.
      </p>

      {revisions.length > 0 && (
        <div id="tour-revisions">
          <RevisionsSection revisions={revisions} creatorId={creatorId} onResubmitted={() => loadRevisions(creatorId)} />
        </div>
      )}

      <div id="tour-projects">
        <MyProjectsSection
          projects={projects}
          creatorId={creatorId}
          akaName={creators?.find(c => c.id === creatorId)?.name || ''}
          onChange={() => loadProjects(creatorId)}
          onNewProject={() => setNewProjectReel({ __pickFromLibrary: true })}
        />
      </div>
      </>
      )}

      {/* Bulk Submit — standalone finished-reels drop for a creator. */}
      {bulkSubmitOpen && (
        <BulkSubmitModal
          creators={creators}
          initialCreatorId={creatorId}
          onClose={() => setBulkSubmitOpen(false)}
          onDone={() => { setBulkSubmitOpen(false); if (creatorId) loadProjects(creatorId) }}
        />
      )}

      {/* Batch upload + New Project modals + Upload Inspo modal are
          always rendered (gated by their own open-state) so they work
          from either tab. */}
      {newProjectReel && (
        <NewProjectModal
          creatorId={creatorId}
          preselectedReel={newProjectReel.__pickFromLibrary ? null : newProjectReel}
          availableReels={reels}
          projectReelIds={new Set(projects.map(p => p.reel?.id).filter(Boolean))}
          onClose={() => setNewProjectReel(null)}
          // Single callback for both workflow types. /start already ran
          // server-side by this point — placeholder Stage B records exist
          // for every selected reel. Refresh the lists so the new cards
          // show up. For single-reel Bedroom, navigateReelId is set so
          // the operator lands on Create Scene where the actual workflow
          // lives (matches the legacy ↓ Raw behavior). Freelance and
          // multi-reel batches stay on /ai-editor; the upload step
          // happens from the project card.
          onStarted={({ workflowType, navigateReelId }) => {
            loadReels(creatorId)
            loadProjects(creatorId)
            loadRevisions(creatorId)
            if (workflowType === 'Bedroom' && navigateReelId) {
              router.push(`/ai-editor/recreate?tab=stageb&creator=${creatorId}&reel=${navigateReelId}`)
            }
          }}
        />
      )}

      {tab === 'inspo' && (
      <>
      <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: -6, marginBottom: 14 }}>
        Available source reels for this creator. Click <strong>✨ New Project</strong> on a card to start work, or upload your own from <strong>↑ Upload inspo</strong>.
      </p>

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
          in the Projects tab instead of cluttering the "fresh inspo" grid.
          After in-flight removal, apply the source filter (all / admin /
          editor uploads) — kept separate from creator filter (which is
          the top-of-page picker). */}
      {(() => {
        const projectReelIds = new Set(projects.map(p => p.reel?.id).filter(Boolean))
        const allFresh = reels.filter(r => !projectReelIds.has(r.id))
        const filteredBySource = reelSourceFilter === 'all'
          ? allFresh
          : reelSourceFilter === 'editor'
            ? allFresh.filter(r => r.addedVia === 'Editor Upload')
            : allFresh.filter(r => r.addedVia !== 'Editor Upload')
        // If user clicked 🎲 Randomize, sort by random map keys (stable
        // until next click). Otherwise leave the API's default order.
        const isRandomized = Object.keys(reelRandomMap).length > 0
        const freshReels = isRandomized
          ? [...filteredBySource].sort((a, b) => (reelRandomMap[a.id] ?? -1) - (reelRandomMap[b.id] ?? -1))
          : filteredBySource
        const adminCount = allFresh.filter(r => r.addedVia !== 'Editor Upload').length
        const editorCount = allFresh.filter(r => r.addedVia === 'Editor Upload').length
        if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#666', fontSize: 13 }}>Loading…</div>
        if (allFresh.length === 0) return (
          <div style={{ padding: 60, textAlign: 'center', color: '#666', fontSize: 13 }}>
            {projects.length > 0
              ? 'No more fresh inspo for this creator — every available reel is already a project above.'
              : 'No available reels for this creator. An admin queues + scrapes accounts in AI Source.'}
          </div>
        )
        const FILTER_CHIPS = [
          { key: 'all',    label: 'All',            count: allFresh.length, title: 'Show every available reel for this creator' },
          { key: 'admin',  label: 'Admin added',    count: adminCount,      title: 'Reels scraped or uploaded by an admin' },
          { key: 'editor', label: 'Editor uploads', count: editorCount,     title: 'Reels uploaded by an AI editor via the Upload inspo button' },
        ]
        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Fresh inspo · {freshReels.length}{reelSourceFilter !== 'all' && allFresh.length !== freshReels.length ? <span style={{ textTransform: 'none', marginLeft: 6, color: 'var(--foreground-subtle)' }}>of {allFresh.length}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {FILTER_CHIPS.map(c => {
                  const disabled = c.count === 0 && c.key !== 'all'
                  return (
                    <button
                      key={c.key}
                      onClick={() => setReelSourceFilter(c.key)}
                      disabled={disabled}
                      title={c.title}
                      style={{
                        padding: '5px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
                        background: reelSourceFilter === c.key ? 'rgba(232,160,160,0.10)' : 'rgba(255,255,255,0.03)',
                        color: reelSourceFilter === c.key ? 'var(--palm-pink)' : (disabled ? '#555' : '#aaa'),
                        border: `1px solid ${reelSourceFilter === c.key ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 999,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >
                      {c.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{c.count}</span>
                    </button>
                  )
                })}
                {uploadInspoMsg && (
                  <span style={{ fontSize: 11, color: '#6AC68A', marginLeft: 4 }}>{uploadInspoMsg}</span>
                )}
                {/* 🎲 Randomize — reshuffles the currently-filtered reels.
                    Click again to re-randomize. Editors were seeing the
                    same reels at the top every time; this gives the pool
                    a fresh look on demand without changing the underlying
                    data. */}
                <button
                  onClick={() => {
                    const next = {}
                    for (const r of filteredBySource) next[r.id] = Math.random()
                    setReelRandomMap(next)
                  }}
                  title={isRandomized ? 'Reshuffle the visible reels again' : 'Shuffle the visible reels into a random order'}
                  style={{ padding: '6px 12px', background: isRandomized ? 'rgba(232,160,160,0.15)' : 'rgba(255,255,255,0.04)', color: isRandomized ? 'var(--palm-pink)' : '#aaa', border: `1px solid ${isRandomized ? 'rgba(232,160,160,0.35)' : 'rgba(255,255,255,0.10)'}`, borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginLeft: 4 }}>
                  🎲 {isRandomized ? 'Reshuffle' : 'Randomize'}
                </button>
                {isRandomized && (
                  <button
                    onClick={() => setReelRandomMap({})}
                    title="Restore the default newest-first order"
                    style={{ padding: '6px 10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                    Reset order
                  </button>
                )}
                <button onClick={() => { setUploadInspoOpen(true); setUploadInspoError(''); setUploadInspoMsg('') }}
                  title="Paste an Instagram reel URL — we scrape just that reel and add it to your pool."
                  style={{ padding: '6px 12px', background: 'rgba(200,168,255,0.10)', color: '#C8A8FF', border: '1px solid rgba(200,168,255,0.35)', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginLeft: 4 }}>
                  ↑ Upload inspo
                </button>
              </div>
            </div>
            {freshReels.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
                No {reelSourceFilter === 'editor' ? 'editor-uploaded' : 'admin-added'} reels for this creator yet.
                {' '}<button onClick={() => setReelSourceFilter('all')} style={{ background: 'none', border: 'none', color: 'var(--palm-pink)', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>Show all</button>.
              </div>
            ) : (
              <div id="tour-reel-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
                {freshReels.map(r => (
                  <ReelCard key={r.id} reel={r} creatorId={creatorId} selected={selected.has(r.id)} onToggle={toggle} onUploaded={onUploaded} autoOpen={r.id === urlUpload} onProjectStarted={() => loadProjects(creatorId)} onNewProject={setNewProjectReel} />
                ))}
              </div>
            )}
          </>
        )
      })()}
      </>
      )}

      {/* Editor's Upload Inspo modal — local video file drop, direct-
          to-Dropbox upload, new Recreate Reel record lands in the
          global pool tagged Added Via='Editor Upload'. */}
      {uploadInspoOpen && (
        <div onClick={() => !uploadInspoBusy && setUploadInspoOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(620px, 95vw)', maxHeight: '90vh', overflow: 'auto', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>↑ Upload inspo from your machine</div>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 4, lineHeight: 1.4 }}>
                Drop one or more video files (mp4, mov, webm). Each one becomes its own reel in the AI Inspo Library — uploads run in parallel so you can drop a batch and watch them all finish.
              </div>
            </div>

            <div
              onClick={() => !uploadInspoBusy && uploadInspoFileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); if (!uploadInspoBusy) setUploadInspoDragOver(true) }}
              onDragLeave={() => setUploadInspoDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setUploadInspoDragOver(false)
                if (uploadInspoBusy) return
                acceptUploadInspoFiles(e.dataTransfer?.files)
              }}
              style={{
                padding: uploadInspoFiles.length ? '14px 16px' : '28px 16px',
                borderRadius: 10,
                border: `2px dashed ${uploadInspoDragOver ? '#6AC68A' : uploadInspoFiles.length ? 'rgba(106,198,138,0.55)' : 'rgba(255,255,255,0.18)'}`,
                background: uploadInspoDragOver ? 'rgba(106,198,138,0.10)' : uploadInspoFiles.length ? 'rgba(106,198,138,0.06)' : 'rgba(255,255,255,0.02)',
                cursor: uploadInspoBusy ? 'wait' : 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s',
              }}>
              {uploadInspoFiles.length > 0 ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6AC68A', marginBottom: 4 }}>
                    🎬 {uploadInspoFiles.length} file{uploadInspoFiles.length === 1 ? '' : 's'} selected
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                    {uploadInspoBusy ? 'Uploading…' : 'Click or drop more to add'}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>🎬</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>Drop videos here</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>or click to pick one or many from Finder</div>
                </div>
              )}
            </div>
            <input ref={uploadInspoFileRef} type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              multiple
              onChange={(e) => acceptUploadInspoFiles(e.target.files)}
              style={{ display: 'none' }} />

            {/* Inline per-file rows — shows up as soon as the editor picks
                files, then updates live during upload. Mirrors the New
                Project modal's Direct Upload progress UI for consistency. */}
            {uploadInspoFiles.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 280, overflowY: 'auto' }}>
                {uploadInspoFiles.map(f => {
                  const s = uploadInspoStatuses[f.name] || { status: 'pending', message: `${(f.size / (1024*1024)).toFixed(1)} MB` }
                  const done = s.status === 'done'
                  const failed = s.status === 'error'
                  const inflight = ['token', 'dropbox', 'finalize'].includes(s.status)
                  return (
                    <li key={f.name} style={{
                      padding: '7px 10px', borderRadius: 6,
                      background: done ? 'rgba(106,198,138,0.07)' : failed ? 'rgba(232,120,120,0.07)' : inflight ? 'rgba(120,180,232,0.06)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${done ? 'rgba(106,198,138,0.30)' : failed ? 'rgba(232,120,120,0.30)' : inflight ? 'rgba(120,180,232,0.25)' : 'rgba(255,255,255,0.06)'}`,
                      fontSize: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--foreground)' }}>{f.name}</span>
                        <span style={{ color: done ? '#6AC68A' : failed ? '#E87878' : inflight ? '#8FB4F0' : 'var(--foreground-muted)', flexShrink: 0, fontWeight: 700 }}>
                          {done ? '✓' : failed ? '⨯' : inflight ? '…' : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: failed ? '#E87878' : 'var(--foreground-subtle)', marginTop: 2 }}>{s.message}</div>
                    </li>
                  )
                })}
              </ul>
            )}

            <input
              type="text"
              value={uploadInspoCaption}
              onChange={e => setUploadInspoCaption(e.target.value)}
              placeholder="Caption / note (optional) — applies to every reel in this batch"
              disabled={uploadInspoBusy}
              maxLength={500}
              style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }}
            />

            {uploadInspoError && (
              <div style={{ padding: '8px 10px', background: 'rgba(232,120,120,0.12)', color: '#E87878', borderRadius: 5, fontSize: 12 }}>{uploadInspoError}</div>
            )}
            {uploadInspoMsg && !uploadInspoError && (
              <div style={{ padding: '8px 10px', background: 'rgba(106,198,138,0.10)', color: '#6AC68A', borderRadius: 5, fontSize: 12 }}>{uploadInspoMsg}</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              {/* Clear / Cancel — clear-only when files queued + idle, cancel always closes the modal */}
              <div style={{ display: 'flex', gap: 6 }}>
                {uploadInspoFiles.length > 0 && !uploadInspoBusy && (
                  <button onClick={() => { setUploadInspoFiles([]); setUploadInspoStatuses({}); setUploadInspoError('') }}
                    style={{ padding: '6px 10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                    Clear all
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setUploadInspoOpen(false)} disabled={uploadInspoBusy}
                  style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: uploadInspoBusy ? 'wait' : 'pointer' }}>
                  {uploadInspoBusy ? 'Working…' : 'Cancel'}
                </button>
                <button onClick={submitUploadInspo} disabled={uploadInspoBusy || uploadInspoFiles.length === 0}
                  style={{ padding: '8px 16px', background: uploadInspoBusy ? 'rgba(200,168,255,0.10)' : uploadInspoFiles.length === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(200,168,255,0.25)', color: uploadInspoFiles.length === 0 ? 'var(--foreground-muted)' : '#C8A8FF', border: `1px solid ${uploadInspoFiles.length === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(200,168,255,0.45)'}`, borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: uploadInspoBusy || uploadInspoFiles.length === 0 ? 'not-allowed' : 'pointer' }}>
                  {uploadInspoBusy ? '⏳ Uploading…' : `↑ Add ${uploadInspoFiles.length || ''} to pool`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ModalHost />
      <GuidedTour steps={POOL_TOUR_STEPS} storageKey="ai-editor-pool-v7" />
    </div>
  )
}
