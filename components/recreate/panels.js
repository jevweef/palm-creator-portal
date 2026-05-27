'use client'

// Shared Recreate panels — used by /admin/recreate-source (admin power
// view) AND /ai-editor/recreate (scoped editor view). The panels are
// self-contained and identical in both surfaces; admin pages that need
// their own modals must import { uiConfirm, uiPrompt, uiAlert, ModalHost }
// from here so they share the SAME singleton listener list as the
// extracted panels (single ModalHost instance per page).

import { useEffect, useState, useCallback } from 'react'
import { buildStreamPosterUrl, buildStreamIframeUrl } from '@/lib/cfStreamUrl'
import SceneUploadModal from './SceneUploadModal'

// Mobile breakpoint detection — inline styles can't use media queries
// so any layout that needs to collapse on phone screens reads this hook.
// Tracks the viewport width via matchMedia and re-renders on change.
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener?.('change', apply) || mq.addListener?.(apply)
    return () => mq.removeEventListener?.('change', apply) || mq.removeListener?.(apply)
  }, [breakpoint])
  return isMobile
}

// ─── Styled modal system (singleton; replaces native confirm/prompt/alert) ──
let _modalListeners = []
let _modalState = null
function _emitModal() { _modalListeners.forEach(fn => fn(_modalState)) }
export function uiConfirm(message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => { _modalState = { kind: 'confirm', message, okLabel, cancelLabel, danger, resolve }; _emitModal() })
}
export function uiPrompt(message, { placeholder = '', defaultValue = '', okLabel = 'Submit' } = {}) {
  return new Promise(resolve => { _modalState = { kind: 'prompt', message, placeholder, defaultValue, okLabel, resolve }; _emitModal() })
}
export function uiAlert(message, { okLabel = 'OK' } = {}) {
  return new Promise(resolve => { _modalState = { kind: 'alert', message, okLabel, resolve }; _emitModal() })
}

export function ModalHost() {
  const [st, setSt] = useState(_modalState)
  const [val, setVal] = useState('')
  useEffect(() => {
    const fn = s => { setSt(s); setVal(s?.defaultValue || '') }
    _modalListeners.push(fn)
    return () => { _modalListeners = _modalListeners.filter(x => x !== fn) }
  }, [])
  useEffect(() => {
    if (!st) return
    const onKey = e => {
      if (e.key !== 'Escape') return
      const r = st.resolve; _modalState = null; _emitModal()
      r(st.kind === 'confirm' ? false : st.kind === 'prompt' ? null : undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st])
  if (!st) return null

  // Broadcast the cleared state to ALL mounted ModalHosts via the
  // listener list — otherwise if more than one host is mounted (e.g.
  // page-level + panel-level) only the clicked host clears, and the
  // others keep rendering the modal until clicked through again.
  const finish = (result) => { const r = st.resolve; _modalState = null; _emitModal(); r(result) }
  const cancelVal = st.kind === 'confirm' ? false : st.kind === 'prompt' ? null : undefined
  const okColor = st.danger ? '#E87878' : 'var(--palm-pink, #e8a878)'

  return (
    <div onClick={() => finish(cancelVal)}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(460px, 94vw)', background: '#16161c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--foreground, #eee)', whiteSpace: 'pre-wrap' }}>{st.message}</div>
        {st.kind === 'prompt' && (
          <textarea autoFocus value={val} onChange={e => setVal(e.target.value)} rows={4} placeholder={st.placeholder}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(val) }}
            style={{ width: '100%', marginTop: 14, padding: '10px 12px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground, #eee)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          {st.kind !== 'alert' && (
            <button onClick={() => finish(cancelVal)}
              style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground, #eee)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, cursor: 'pointer' }}>
              {st.cancelLabel || 'Cancel'}
            </button>
          )}
          <button autoFocus={st.kind !== 'prompt'}
            onClick={() => finish(st.kind === 'confirm' ? true : st.kind === 'prompt' ? val : undefined)}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: okColor, color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            {st.okLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Upload a Stage B input (pose screenshot blob / extra ref file)
// straight to Dropbox; returns the Dropbox path.
export async function stageBUpload(blob, kind) {
  const tok = await fetch('/api/admin/recreate-rooms/stage-b/upload-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  }).then(r => r.json())
  if (!tok.path) throw new Error(tok.error || 'upload token failed')
  const up = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tok.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: tok.path, mode: 'overwrite', mute: true }),
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: tok.rootNamespaceId }),
      'Content-Type': 'application/octet-stream',
    },
    body: await blob.arrayBuffer(),
  })
  if (!up.ok) throw new Error(`Dropbox upload failed (${up.status})`)
  return tok.path
}


export function StageBPanel({ initialCreatorId, initialReelRecordId, initialProjectId } = {}) {
  const isMobile = useIsMobile() // collapse 4-quarter top row + 2-col detail modal into a stack on phones
  const [data, setData] = useState({ creators: [], rooms: [], variations: [] })
  const [reels, setReels] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [reel, setReel] = useState(null)
  const [stageBOut, setStageBOut] = useState(null)
  const [outputs, setOutputs] = useState([])
  // Each upload slot tracks: { name, url (for preview), path (Dropbox,
  // for Generate), uploading }. Path is the source of truth — once set,
  // Generate sends it and the work survives refresh because we
  // eager-attached to the Airtable record (see /stage-b/attach).
  const [subjectSlot, setSubjectSlot] = useState({ name: '', url: '', path: '', uploading: false })
  const [rawSlot, setRawSlot] = useState({ name: '', url: '', path: '', uploading: false })
  const [upscaledSlot, setUpscaledSlot] = useState({ name: '', url: '', path: '', uploading: false })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [project, setProject] = useState(null) // Existing Started project when continuing
  const [showReelGrid, setShowReelGrid] = useState(false) // Hidden when a reel is already selected
  const [showOptionalUploads, setShowOptionalUploads] = useState(false) // Raw + upscaled, archival only
  const [reelPlaying, setReelPlaying] = useState(false) // Click-to-play the selected reel inline
  const [model, setModel] = useState('wan') // 'wan' | 'nano' | 'gpt' — Wan tends to zoom out, alternatives may respect framing better
  const [count, setCount] = useState(1) // 1 | 2 | 4 — fan-out N variations into DIFFERENT rooms in parallel
  // Output aspect ratio. 9:16 = reel/story, 4:5 = IG feed post,
  // 3:4 = portrait crop, 1:1 = square. Editor picks per generation.
  const [aspect, setAspect] = useState('9:16')
  const [selectedOutput, setSelectedOutput] = useState(null) // Click-to-expand detail modal for a Stage B Output card
  const [armedDeleteId, setArmedDeleteId] = useState(null) // Two-click confirm for 🗑 — avoids a full-screen modal far from the button
  const [uploadingScene, setUploadingScene] = useState(null) // Scene-scoped upload modal — opens in-place instead of routing back to /ai-editor
  // Outfits attached to the current reel. Drives the upcoming fan-out
  // step (every selected outfit × every approved Stage B scene). Stored
  // server-side on the Recreate Reels row, hydrated to photo metadata
  // here so the strip can render thumbnails without a second join.
  const [reelOutfits, setReelOutfits] = useState([])
  const [outfitPickerOpen, setOutfitPickerOpen] = useState(false)

  const [creators, setCreators] = useState([])

  useEffect(() => {
    fetch('/api/admin/recreate-rooms/stage-b/creators').then(r => r.json()).then(d => {
      setCreators(d.creators || [])
      // Deep-link from the pool: prefer the URL-provided creator if it
      // exists in the Stage B list, else fall back to the first creator.
      const match = initialCreatorId && d.creators?.some(c => c.id === initialCreatorId) ? initialCreatorId : null
      if (match) setCreatorId(match)
      else if (d.creators?.[0]) setCreatorId(d.creators[0].id)
    }).catch(() => {})
    fetch('/api/admin/recreate-rooms').then(r => r.json()).then(d => {
      setData({ creators: d.creators || [], rooms: d.rooms || [], variations: d.variations || [] })
    }).catch(() => {})
    fetch('/api/admin/recreate-sources').then(r => r.json()).then(d => setReels(d.reels || [])).catch(() => {})
  }, [initialCreatorId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link from the pool: when the URL names a specific reel and it
  // shows up in the loaded list, preselect it so the editor can move
  // straight to step 3 (upload TJP photo).
  useEffect(() => {
    if (!initialReelRecordId || !reels.length) return
    const m = reels.find(r => r.id === initialReelRecordId)
    if (m && !reel) setReel(m)
  }, [initialReelRecordId, reels, reel])

  // Reel grid is expanded by default ONLY when no reel is selected.
  // Once a reel exists (whether from URL, project, or click) we collapse
  // the grid into the compact selected-reel preview.
  useEffect(() => {
    if (reel?.id) setShowReelGrid(false)
    setReelPlaying(false) // stop playback when reel changes
  }, [reel?.id])

  // Pull the Selected Outfits attached to the active reel. Re-runs when
  // the reel changes; clears the list on no-reel so leftover thumbnails
  // don't bleed across reel switches.
  useEffect(() => {
    if (!reel?.id) { setReelOutfits([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/admin/recreate-rooms/stage-b/reel-outfits?reelId=${reel.id}`)
        const d = await r.json()
        if (!cancelled && d?.ok) setReelOutfits(d.outfits || [])
      } catch {}
    })()
    return () => { cancelled = true }
  }, [reel?.id])

  // Two write paths on the same field: bulk PUT (picker modal closes
  // with the full set) and inline POST (× on a strip thumbnail). Both
  // return the freshly-hydrated outfit list so we can drop client-side
  // merge logic.
  const setReelOutfitIds = async (outfitIds) => {
    if (!reel?.id) return
    try {
      const r = await fetch('/api/admin/recreate-rooms/stage-b/reel-outfits', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelId: reel.id, outfitIds }),
      })
      const d = await r.json()
      if (d?.ok) setReelOutfits(d.outfits || [])
    } catch {}
  }
  const removeReelOutfit = async (id) => {
    if (!reel?.id) return
    const snap = reelOutfits
    setReelOutfits(prev => prev.filter(o => o.id !== id)) // optimistic
    try {
      const r = await fetch('/api/admin/recreate-rooms/stage-b/reel-outfits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelId: reel.id, removeId: id }),
      })
      const d = await r.json()
      if (d?.ok) setReelOutfits(d.outfits || [])
      else setReelOutfits(snap)
    } catch { setReelOutfits(snap) }
  }

  // Continuing a Started project: load the record (so we know its slug)
  // and pre-pick the reel from its Source Reel field, regardless of
  // whether the pool-loaded reels list contains it (the reel might be
  // hidden from the pool because it's already a project).
  useEffect(() => {
    // Need at least one of project or reel to know what to restore.
    if (!initialProjectId && !initialReelRecordId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/admin/recreate-rooms/stage-b/outputs?creatorId=${initialCreatorId || ''}`)
        if (!r.ok) return
        const d = await r.json()
        if (cancelled) return
        const outputs = d.outputs || []
        // Primary lookup: exact record id from the URL. Falls back to
        // ANY sibling under the same reel that still has TJP Output
        // Path set — this rescues the panel when the editor deleted
        // the original project, AND covers the new "open reel from My
        // Projects" deep link which lands with no specific project ID
        // (we want to re-hydrate the TJP slot from any existing scene
        // under the same reel so Generate doesn't ask the editor to
        // re-upload work that's already saved).
        let match = initialProjectId ? outputs.find(o => o.id === initialProjectId) : null
        if (!match && initialReelRecordId) {
          match = outputs.find(o => o.reel?.id === initialReelRecordId && o.uploads?.tjpOutput)
        }
        if (match) {
          setProject(match)
          if (match.reel && !reel) setReel(match.reel)
          // Restore eager-uploaded artifacts from the record so the
          // editor's file slots stay populated across page refreshes.
          if (match.uploads?.tjpOutput) setSubjectSlot({ name: match.uploads.tjpOutput.filename || 'tjp-output.jpg', url: match.uploads.tjpOutput.url || '', path: match.uploads.tjpOutput.path || '', uploading: false })
          if (match.uploads?.rawScreenshot) setRawSlot({ name: match.uploads.rawScreenshot.filename || 'raw.jpg', url: match.uploads.rawScreenshot.url || '', path: match.uploads.rawScreenshot.path || '', uploading: false })
          if (match.uploads?.upscaledScreenshot) setUpscaledSlot({ name: match.uploads.upscaledScreenshot.filename || 'upscaled.jpg', url: match.uploads.upscaledScreenshot.url || '', path: match.uploads.upscaledScreenshot.path || '', uploading: false })
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [initialProjectId, initialCreatorId, initialReelRecordId, reel])

  const loadOutputs = useCallback(async () => {
    if (!creatorId) { setOutputs([]); return }
    try { await fetch('/api/admin/recreate-rooms/stage-b/resolve', { method: 'POST' }) } catch {}
    try {
      const d = await fetch(`/api/admin/recreate-rooms/stage-b/outputs?creatorId=${creatorId}`).then(r => r.json())
      setOutputs(d.outputs || [])
    } catch {}
  }, [creatorId])

  useEffect(() => { loadOutputs() }, [loadOutputs])

  const anyGenerating = outputs.some(o => o.status === 'Generating')
  useEffect(() => {
    if (!anyGenerating) return
    const t = setInterval(() => { loadOutputs() }, 25000)
    return () => clearInterval(t)
  }, [anyGenerating, loadOutputs])

  const setOutputStatus = async (o, status) => {
    let reason
    if (status === 'Rejected') {
      reason = (await uiPrompt('Why is this rejected? (kept as a tuning signal)', { placeholder: 'reason…' })) || ''
    }
    await fetch('/api/admin/recreate-rooms/stage-b/outputs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: o.id, status, reason }),
    }).catch(() => {})
    loadOutputs()
  }
  // Delete = quick "reject + delete" with no reason prompt. The two-
  // click confirm pattern (armedDeleteId) replaces the full-screen
  // uiConfirm modal so the confirm UI peels off the button itself,
  // not a far-away dialog. The reject PATCH right before the DELETE
  // leaves a "this was rejected" record in Airtable's revision history
  // before the record itself is removed — preserves the signal for the
  // editor who explicitly asked to combine the two actions.
  const deleteOutput = async (o) => {
    // Swallowing errors silently used to mask a real auth mismatch —
    // ai_editor clicked Sure and nothing happened because DELETE was
    // admin-only. Now we surface non-OK responses so the editor knows
    // whether the action actually landed.
    try {
      const r1 = await fetch('/api/admin/recreate-rooms/stage-b/outputs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: o.id, status: 'Rejected', reason: '' }),
      })
      if (!r1.ok) console.warn(`[deleteOutput] PATCH reject failed: ${r1.status}`)
      const r2 = await fetch(`/api/admin/recreate-rooms/stage-b/outputs?id=${o.id}`, { method: 'DELETE' })
      if (!r2.ok) {
        const text = await r2.text().catch(() => '')
        alert(`Delete failed: HTTP ${r2.status} ${text.slice(0, 120)}`)
        return
      }
    } catch (e) {
      alert(`Delete failed: ${e.message}`)
      return
    }
    setArmedDeleteId(null)
    loadOutputs()
  }
  // Auto-disarm the delete button after a short window if the user
  // doesn't follow through. Without this the button stays "armed"
  // forever and a stray click later could nuke something.
  useEffect(() => {
    if (!armedDeleteId) return
    const t = setTimeout(() => setArmedDeleteId(null), 2500)
    return () => clearTimeout(t)
  }, [armedDeleteId])

  // Arrow-key navigation when the detail modal is open. ← / → flip
  // between visible scene cards (Started placeholders are hidden so
  // we filter to the same set the gallery shows). Esc is already
  // handled by ModalHost-style click-outside; we don't fight it here.
  useEffect(() => {
    if (!selectedOutput) return
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Avoid stealing arrow keys from inputs/textareas (e.g. a
      // rejection prompt opened from inside the modal).
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // Same filter as the gallery: hide Started, and when a reel is
      // selected, scope to that reel's scenes only — otherwise the
      // arrows leak the editor into a different project's gallery.
      const visible = outputs.filter(o => {
        if (o.status === 'Started') return false
        if (reel?.id && o.reel?.id !== reel.id) return false
        return true
      })
      const i = visible.findIndex(o => o.id === selectedOutput.id)
      if (i < 0) return
      const next = e.key === 'ArrowRight' ? visible[i + 1] : visible[i - 1]
      if (next) { e.preventDefault(); setSelectedOutput(next) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedOutput, outputs, reel?.id])



  const sel = creators.find(c => c.id === creatorId)
  const myRooms = data.rooms.filter(r => r.creatorId === creatorId)
  // Match the pool's filter: only show reels that haven't already been
  // produced for this creator. Keeps Stage B aligned with the upload
  // flow — no inspo shows up twice once an editor has run it through.
  const availableReels = creatorId
    ? reels.filter(r => !(r.producedFor || []).includes(creatorId))
    : reels

  // Eager-upload a file the moment the editor picks it: ship to
  // Dropbox, then PATCH the Airtable record (via /attach) so the slot
  // survives a page refresh. Returns the resolved path so callers can
  // optimistically update state. Falls back to a non-persisted upload
  // when there's no project yet (rare — new-scene-without-download
  // path). The route then uploads at Generate time as before.
  const pickFile = async (file, kind, setSlot) => {
    if (!file) { setSlot({ name: '', url: '', path: '', uploading: false }); return }
    const localUrl = URL.createObjectURL(file)
    setSlot({ name: file.name, url: localUrl, path: '', uploading: true })
    try {
      const path = await stageBUpload(file, kind)
      // Make sure we have a Stage B Output record to attach this upload
      // to. If the editor entered Create Scene without going through the
      // Workspace download step, no Started placeholder exists yet — and
      // without one, the /attach call has nothing to write to and the
      // upload disappears on refresh. Create a Started record on-demand
      // here, mirror it into URL state so a refresh re-finds it.
      let pid = project?.id
      if (!pid && creatorId && reel?.id) {
        try {
          const r = await fetch('/api/admin/recreate-rooms/stage-b/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creatorId, reelRecordIds: [reel.id] }),
          })
          const d = await r.json()
          const rec = d.created?.[0] || d.skipped?.[0]
          pid = rec?.recordId || rec?.existingRecordId || null
          if (pid) {
            setProject({ id: pid })
            if (typeof window !== 'undefined') {
              const u = new URL(window.location.href)
              u.searchParams.set('project', pid)
              window.history.replaceState(null, '', u.toString())
            }
          }
        } catch (e) { console.warn('[panel] auto-start project failed:', e?.message) }
      }
      if (pid) {
        // Eager-attach to the Airtable record so refreshing won't lose
        // this upload. The path field on the record persists.
        try {
          await fetch('/api/admin/recreate-rooms/stage-b/attach', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: pid, kind, dropboxPath: path }),
          })
        } catch (e) { console.warn('[panel] eager attach failed:', e?.message) }
      }
      setSlot({ name: file.name, url: localUrl, path, uploading: false })
    } catch (e) {
      setSlot({ name: file.name, url: localUrl, path: '', uploading: false })
      setMsg(`❌ Upload failed: ${e?.message || String(e)}`)
    }
  }

  const generate = async () => {
    if (!creatorId) { setMsg('⚠️ Pick a creator first (step 1).'); return }
    if (!reel?.id) { setMsg('⚠️ Pick the inspo reel this scene goes with (step 2).'); return }
    if (!subjectSlot.path && !subjectSlot.url) { setMsg('⚠️ Upload the TJP image-to-image photo (step 3).'); return }
    if (subjectSlot.uploading || rawSlot.uploading || upscaledSlot.uploading) { setMsg('⏳ Wait for uploads to finish first.'); return }
    setBusy(true); setStageBOut(null); setMsg('⏳ Submitting…')
    try {
      setMsg('⏳ Creating the scene — the AI is swapping her background to her saved room. This takes 3–6 minutes; you can navigate away and the result will appear in Scenes below.')
      const res = await fetch('/api/admin/recreate-rooms/stage-b', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          reelRecordId: reel.id,
          subjectDropboxPath: subjectSlot.path || undefined, // route falls back to record's path
          rawScreenshotPath: rawSlot.path || undefined,
          upscaledScreenshotPath: upscaledSlot.path || undefined,
          model,
          aspect, // 1:1 | 3:4 | 4:5 | 9:16 — picker in this panel
          count, // server fans out N parallel jobs, each into a different room variation
          // If we came from a Started project card, reuse its record
          // so the slug + Reel # assigned at download time persist.
          ...(project?.id ? { projectId: project.id } : {}),
        }),
      })
      const raw = await res.text()
      let d
      try { d = JSON.parse(raw) } catch { d = null }
      const asStr = (v) => typeof v === 'string' ? v
        : v && typeof v === 'object' ? (v.message || v.error || JSON.stringify(v))
        : String(v)
      if (d && d.ok && d.generating) {
        setStageBOut(null)
        // Multi-variation summary if the server fanned out
        if (Array.isArray(d.variations) && d.variations.length > 1) {
          const rooms = d.variations.map(v => `${v.room}${v.timeOfDay && v.timeOfDay !== 'Unknown' ? ` (${v.timeOfDay})` : ''}`).join(', ')
          setMsg(`✅ ${d.variations.length} scenes submitted in parallel — ${rooms}. Read as ${d.screenshotFraming} framing. Check Scenes below in a few minutes.`)
        } else {
          const tod = d.timeOfDay && d.timeOfDay !== 'Unknown' ? ` (${d.timeOfDay})` : ''
          setMsg(`✅ Scene submitted. The portal read your photo as ${d.screenshotFraming} framing and picked her "${d.room}"${tod} [${d.roomFraming}] room. Rendering — check the Scenes section below in a few minutes.`)
        }
        loadOutputs()
        setTimeout(() => document.getElementById('stageb-outputs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
      } else if (d && d.ok) {
        setStageBOut({ url: d.out, dropbox: d.dropbox, room: d.room, roomFraming: d.roomFraming, screenshotFraming: d.screenshotFraming })
        setMsg(`✅ Scene done. Read as ${d.screenshotFraming} framing, placed in her "${d.room}" [${d.roomFraming}] room. Saved to Scenes below.`)
        loadOutputs()
      } else if (d) {
        setMsg(`❌ ${asStr(d.error) || `HTTP ${res.status}`}`)
      } else {
        setMsg(`❌ HTTP ${res.status} — ${raw.slice(0, 300) || 'no response body'}`)
      }
    } catch (e) { setMsg(`❌ ${e?.message || String(e)}`) }
    setBusy(false)
  }

  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: isMobile ? 12 : 18, marginBottom: 14 }
  const lbl = { fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }
  // Numbered step header — circle + title. Replaces the small uppercase
  // "N · TITLE" labels. Optional `subtitle` shows the short description
  // inline so each card has a clear top heading.
  const stepHead = (n, title, subtitle = null, color = 'var(--palm-pink, #e8a0a0)') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: subtitle ? 4 : 14 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: color, color: '#1a0a0a', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{n}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
    </div>
  )

  return (
    <div>
      {/* Compact header: title + project chip on one row, blurb tucked
          under as a single line. Saves ~80px of vertical space. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Create Scene — put your creator in her room</h1>
        {project && (
          <div style={{ padding: '5px 10px', background: 'rgba(232,184,120,0.12)', border: '1px solid rgba(232,184,120,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--foreground)', whiteSpace: 'nowrap' }}>
            📌 <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#e8b878', fontWeight: 700 }}>{project.slug}</span>
            {project.reel && <> · <a href={project.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>@{project.reel.handle || project.reel.reelId}</a></>}
            {project.status && project.status !== 'Started' && <> · {project.status}</>}
          </div>
        )}
      </div>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 12, margin: '0 0 12px 0', lineHeight: 1.4 }}>
        Drop the TJP image-to-image photo · portal swaps the background to her saved room · take the scene back to TJP for outfit transfer + motion, then upload finished video to the <a href="/ai-editor" style={{ color: 'var(--palm-pink)' }}>AI Recreate Pool</a>.
      </p>

      {/* Merged Project panel — 4 cols when a reel is picked:
          [reel] [TJP off-site steps] [drop zone] [Generate].
          Whole flow fits in one row; no need for huge sections to
          just upload a file. */}
      <div id="tour-stageb-creator" style={card}>
        {reel?.id && !showReelGrid ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))', gap: 16, alignItems: 'stretch' }}>
            {/* Reel column: preview on top, handle + action buttons
                below. Acts as the "scene source" anchor. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <div id="tour-stageb-reels" style={{ position: 'relative', width: '100%', aspectRatio: '9/16', borderRadius: 12, overflow: 'hidden', background: '#000', border: '2px solid var(--palm-pink)', boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}>
                {reelPlaying && reel.streamUid ? (
                  <iframe
                    src={buildStreamIframeUrl(reel.streamUid, { autoplay: true, muted: false, loop: true, controls: true })}
                    allow="autoplay; fullscreen" allowFullScreen
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : reelPlaying && reel.video ? (
                  <video src={reel.video} autoPlay controls playsInline loop
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (reel.streamUid || reel.thumbnail) ? (
                  <div onClick={() => setReelPlaying(true)} style={{ width: '100%', height: '100%', cursor: (reel.streamUid || reel.video) ? 'pointer' : 'default' }}>
                    <img src={(reel.streamUid && buildStreamPosterUrl(reel.streamUid, { width: 480, fit: 'crop' })) || reel.thumbnail}
                      alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {(reel.streamUid || reel.video) && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, paddingLeft: 4 }}>▶</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 13 }}>No preview</div>
                )}
              </div>
              {/* Handle + actions strip below the reel. Compact. */}
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e8b878', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{reel.handle || reel.reelId}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {reel.url && (
                  <a href={reel.url} target="_blank" rel="noreferrer"
                    style={{ padding: '5px 9px', fontSize: 11, fontWeight: 600, color: '#8fb4f0', background: 'rgba(120,160,232,0.12)', border: '1px solid rgba(120,160,232,0.25)', borderRadius: 5, textDecoration: 'none' }}>↗ IG</a>
                )}
                {reel.video && (
                  <a href={String(reel.video).replace(/([?&])raw=1/, '$1dl=1')} target="_blank" rel="noopener"
                    style={{ padding: '5px 9px', fontSize: 11, fontWeight: 600, color: '#8fb4f0', background: 'rgba(120,160,232,0.12)', border: '1px solid rgba(120,160,232,0.25)', borderRadius: 5, textDecoration: 'none' }}>↓ Re-download</a>
                )}
                <button onClick={() => setShowReelGrid(true)}
                  style={{ padding: '5px 9px', fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, cursor: 'pointer' }}>
                  Change reel
                </button>
              </div>
              {/* Free creator-pick UI only when there's no project. With
                  a project locked, the creator was already chosen on the
                  workspace tab — no need to re-ask. */}
              {!project && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Creator</div>
                  <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
                    style={{ padding: '7px 10px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 12, width: '100%' }}>
                    {creators.length === 0 && <option>No creators with AI refs</option>}
                    {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {sel && myRooms.length === 0 && (
                <div style={{ fontSize: 11, color: '#e8b878' }}>⚠️ No saved rooms — admin needs to add one first.</div>
              )}
            </div>

            {/* TJP off-site steps — what to do between picking the reel
                and dropping the result in step 3. Lettered so they
                don't collide with the portal's step 3 / step 4. Sized
                up so the content actually fills the column height set
                by the portrait reel preview. */}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: 18, background: 'rgba(120,160,232,0.06)', border: '1px solid rgba(120,160,232,0.2)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                <div style={{ fontSize: 28 }}>🎬</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#8fb4f0' }}>Now do this in TJP</div>
                  <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 2 }}>Off-portal — result → step 3.</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, justifyContent: 'space-between' }}>
                {[
                  { n: 'a', label: 'Re-download → Frame Extractor', text: <>Click <span style={{ color: '#8fb4f0', whiteSpace: 'nowrap' }}>↓ Re-download</span>, then drop the mp4 straight into TJP&apos;s <b>Frame Extractor</b> (under Tools). Scrub to the pose, <b>Capture Frame</b>.</> },
                  { n: 'b', label: 'Apex Upscale', text: <>Right in the Frame Extractor panel, click <b>Upscale</b> — the captured frame loads into Apex Upscale. Click <b>Upscale</b> again to run it.</> },
                  { n: 'c', label: 'Apex Transfer → Image-to-Image', text: <>The upscaled image lands in your <b>Studio</b> queue. Open <b>Apex Image-to-Image</b>, drag the upscaled frame onto your creator — the prompt should auto-fill (if not, refresh + drag again). Set <b>Quality 50</b> and <b>Creative Variance ~30</b>, then <b>Generate</b>. 4 variations come back.</> },
                  { n: 'd', label: 'Upload best → step 3', text: <>Pick the best of the 4 variations, download it, then upload it into <span style={{ color: '#e8b878', fontWeight: 700 }}>step 3 →</span> on this page.</> },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(120,160,232,0.25)', color: '#8fb4f0', fontSize: 15, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{s.n}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#8fb4f0', marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 14, color: 'var(--foreground)', lineHeight: 1.5 }}>{s.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Visual hand-off to step 3 — anchored to the bottom of
                  the TJP guidance column, pointing physically toward
                  the next column. So the editor's eye lands on the
                  drop zone the moment they finish step d. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 14, padding: '8px 12px', background: 'rgba(232,168,120,0.08)', border: '1px dashed rgba(232,168,120,0.35)', borderRadius: 8, color: '#e8b878', fontSize: 13, fontWeight: 700 }}>
                <span>Upload best to step 3</span>
                <span style={{ fontSize: 18 }}>→</span>
              </div>
            </div>

            {/* Step 3: TJP photo drop zone — compact column inside the
                top row. No more full-width hero; just a file target. */}
            <div id="tour-stageb-subject" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: 14, background: 'rgba(232,168,120,0.05)', border: '1px solid rgba(232,168,120,0.3)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e8b878', color: '#1a0a0a', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>3</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>TJP output</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 1 }}>Drop photo · auto-saves.</div>
                </div>
              </div>
              <label
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(232,168,120,0.14)' }}
                onDragLeave={e => { e.currentTarget.style.background = subjectSlot.url ? 'rgba(106,198,138,0.06)' : 'rgba(232,168,120,0.05)' }}
                onDrop={e => {
                  e.preventDefault()
                  e.currentTarget.style.background = subjectSlot.url ? 'rgba(106,198,138,0.06)' : 'rgba(232,168,120,0.05)'
                  const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'))
                  if (f) pickFile(f, 'subject', setSubjectSlot)
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  minHeight: 180,
                  border: `2px dashed rgba(232,168,120,${subjectSlot.url ? '0.3' : '0.45'})`,
                  borderRadius: 8,
                  padding: 12,
                  background: subjectSlot.url ? 'rgba(106,198,138,0.06)' : 'rgba(232,168,120,0.05)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}>
                <input type="file" accept="image/*" onChange={e => pickFile(e.target.files?.[0] || null, 'subject', setSubjectSlot)} style={{ display: 'none' }} />
                {subjectSlot.url ? (
                  <>
                    <img src={subjectSlot.url} alt=""
                      style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 8, background: '#000', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                      {subjectSlot.uploading ? (
                        <>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#8fb4f0', color: '#1a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>⏳</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#8fb4f0' }}>Uploading…</div>
                        </>
                      ) : subjectSlot.path ? (
                        <>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#6AC68A', color: '#1a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>✓</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#6AC68A' }}>Saved</div>
                        </>
                      ) : (
                        <>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#e8b878', color: '#1a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>!</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#e8b878' }}>Not saved</div>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 6 }}>Click to replace</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 6 }}>📤</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>Drop TJP photo</div>
                    <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 2 }}>or click to browse</div>
                  </>
                )}
              </label>
            </div>

            {/* Step 4: Generate — AI swap. Last column. */}
            <div id="tour-stageb-generate" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: 14, background: 'rgba(232,168,120,0.05)', border: '1px solid rgba(232,168,120,0.25)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e8a878', color: '#1a0a0a', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>4</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>Generate scene</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 1 }}>AI swap · ~3–6 min.</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 10, lineHeight: 1.45 }}>
                Swaps {sel?.name || 'her'} background for her saved room and relights her to match.
              </div>
              {/* Model picker — Wan tends to zoom the subject out, Nano /
                  GPT-Image-2 are worth trying when framing matters. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Model</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { v: 'wan', label: 'Wan 2.7' },
                    { v: 'nano', label: 'Nano' },
                    { v: 'gpt', label: 'GPT' },
                  ].map(m => (
                    <button key={m.v} onClick={() => setModel(m.v)}
                      style={{
                        flex: 1,
                        padding: '5px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        background: model === m.v ? 'rgba(232,168,120,0.25)' : 'rgba(255,255,255,0.04)',
                        color: model === m.v ? '#e8b878' : 'var(--foreground-muted)',
                        border: `1px solid ${model === m.v ? 'rgba(232,168,120,0.45)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}>{m.label}</button>
                  ))}
                </div>
              </div>
              {/* Aspect ratio — 9:16 reels, 4:5 feed posts, 3:4 portrait,
                  1:1 square. Default 9:16 because that's what most
                  scenes target. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Aspect</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['1:1', '3:4', '4:5', '9:16'].map(a => (
                    <button key={a} onClick={() => setAspect(a)}
                      style={{
                        flex: 1,
                        padding: '5px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        background: aspect === a ? 'rgba(232,168,120,0.25)' : 'rgba(255,255,255,0.04)',
                        color: aspect === a ? '#e8b878' : 'var(--foreground-muted)',
                        border: `1px solid ${aspect === a ? 'rgba(232,168,120,0.45)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}>{a}</button>
                  ))}
                </div>
              </div>
              {/* Variations — fan out N parallel jobs, each into a
                  different randomly-picked room variation. Useful for
                  A/B'ing rooms or grabbing several attempts at once. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Variations</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 4].map(n => (
                    <button key={n} onClick={() => setCount(n)}
                      style={{
                        flex: 1,
                        padding: '5px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        background: count === n ? 'rgba(232,168,120,0.25)' : 'rgba(255,255,255,0.04)',
                        color: count === n ? '#e8b878' : 'var(--foreground-muted)',
                        border: `1px solid ${count === n ? 'rgba(232,168,120,0.45)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}>{n}×</button>
                  ))}
                </div>
              </div>
              {(() => {
                const hasSubject = !!(subjectSlot.path || subjectSlot.url)
                const ready = hasSubject && !subjectSlot.uploading
                return (
                  <button onClick={generate} disabled={busy || !ready}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '12px 16px',
                      fontSize: 13,
                      fontWeight: 700,
                      background: busy ? 'rgba(232,168,120,0.3)' : !ready ? 'rgba(232,168,120,0.18)' : 'linear-gradient(135deg, #e8a878 0%, #e8b878 100%)',
                      color: !ready && !busy ? 'rgba(255,255,255,0.4)' : '#1a0a0a',
                      border: 'none',
                      borderRadius: 8,
                      cursor: (busy || !ready) ? 'default' : 'pointer',
                      boxShadow: ready && !busy ? '0 4px 16px rgba(232,168,120,0.3)' : 'none',
                      transition: 'all 0.15s ease',
                    }}>
                    {busy ? '⏳ Working…' : subjectSlot.uploading ? '⏳ Uploading…' : ready ? (count > 1 ? `🪄 Generate ${count}×` : '🪄 Generate') : 'Upload first →'}
                  </button>
                )
              })()}
              {msg && <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 10, padding: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 5, borderLeft: '3px solid rgba(232,168,120,0.4)' }}>{msg}</div>}
            </div>
          </div>
        ) : (
          <>
            {/* No reel selected (or Change reel clicked) — show creator
                selector + the grid. Once a reel is picked we flip to
                the merged panel above. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Creator</div>
                <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
                  style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13, fontWeight: 500 }}>
                  {creators.length === 0 && <option>No creators with AI refs</option>}
                  {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {reel?.id && (
                <button onClick={() => setShowReelGrid(false)}
                  style={{ padding: '6px 12px', fontSize: 11, background: 'none', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, cursor: 'pointer' }}>
                  Done picking
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
              {availableReels.length} reels available for {sel?.name || 'this creator'} (already-produced ones are hidden). Click one to mark it as this scene&apos;s source.
            </div>
            <div id="tour-stageb-reels" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {availableReels.map(r => {
                const isSel = reel?.id === r.id
                const bd = { borderRadius: 6, cursor: 'pointer', width: '100%', aspectRatio: '9/16', objectFit: 'cover', border: isSel ? '3px solid var(--palm-pink)' : '1px solid rgba(255,255,255,0.1)' }
                const onPick = () => { setReel(r); setShowReelGrid(false) }
                return r.streamUid
                  ? <img key={r.id} src={buildStreamPosterUrl(r.streamUid, { width: 240, fit: 'crop' })} alt="" loading="lazy" onClick={onPick} style={bd} />
                  : r.thumbnail
                    ? <img key={r.id} src={r.thumbnail} alt="" loading="lazy" onClick={onPick} style={bd} />
                    : <video key={r.id} src={`${String(r.video || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')}#t=0.1`} muted preload="metadata" playsInline onClick={onPick} style={bd} />
              })}
            </div>
          </>
        )}
      </div>

      {/* Optional uploads — collapsed by default. Editor doesn't usually
          care about archival; hiding them keeps the page short. */}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setShowOptionalUploads(s => !s)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 12, color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer' }}>
          <span style={{ fontSize: 14 }}>{showOptionalUploads ? '−' : '+'}</span>
          Optionally archive the TJP raw + upscaled screenshots
          {rawSlot.path && <span style={{ color: '#6AC68A' }}>· raw ✓</span>}
          {upscaledSlot.path && <span style={{ color: '#6AC68A' }}>· upscaled ✓</span>}
        </button>
        {showOptionalUploads && (
          <div style={{ ...card, marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {[
                { label: 'Raw screenshot', slot: rawSlot, set: setRawSlot, kind: 'raw_screenshot' },
                { label: 'Upscaled screenshot', slot: upscaledSlot, set: setUpscaledSlot, kind: 'upscaled_screenshot' },
              ].map(o => (
                <label key={o.label} style={{ display: 'block', cursor: 'pointer' }}>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{o.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'rgba(0,0,0,0.25)', border: `1px dashed rgba(255,255,255,${o.slot.url ? '0.16' : '0.1'})`, borderRadius: 6 }}>
                    {o.slot.url ? (
                      <>
                        <img src={o.slot.url} alt="" style={{ width: 44, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 4, background: '#000' }} />
                        <span style={{ fontSize: 11, color: o.slot.uploading ? '#8fb4f0' : '#6AC68A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {o.slot.uploading ? `⏳ ${o.slot.name}` : `✓ ${o.slot.name}`}
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>Click to choose a file</span>
                    )}
                    <input type="file" accept="image/*" onChange={e => pickFile(e.target.files?.[0] || null, o.kind, o.set)} style={{ display: 'none' }} />
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {stageBOut && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={lbl}>Result — {sel?.name} in {stageBOut.room} [{stageBOut.roomFraming}] · framing read as {stageBOut.screenshotFraming}</div>
          <img src={stageBOut.url} alt="Scene result"
            style={{ width: 'min(360px, 90vw)', aspectRatio: '9/16', objectFit: 'contain', borderRadius: 10, background: '#000', display: 'block' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <a href={stageBOut.dropbox || stageBOut.url} target="_blank" rel="noreferrer"
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: 'none', borderRadius: 6, textDecoration: 'none' }}>↗ Open full size</a>
          </div>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 10 }}>Saved as Pending in Scenes below. Approve it (✓) to enable the TJP download button.</div>
        </div>
      )}

      {/* Outfits panel — only relevant once a reel is selected. The
          actual outfit fan-out generation lands as a separate step;
          this section is the "connection" piece (pick + persist). */}
      {reel?.id && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>
                👗 Outfits for this reel <span style={{ color: 'var(--foreground-muted)', fontWeight: 500 }}>({reelOutfits.length})</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 4 }}>
                Pick outfits from the library. Every selected outfit will fan out across every approved scene under this reel (N outfits × M scenes).
              </div>
            </div>
            <button onClick={() => setOutfitPickerOpen(true)}
              style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, background: 'rgba(232,168,120,0.18)', color: '#e8b878', border: '1px solid rgba(232,168,120,0.3)', borderRadius: 6, cursor: 'pointer' }}>
              + Pick outfits
            </button>
          </div>
          {reelOutfits.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 8, textAlign: 'center' }}>
              No outfits attached yet. Click <b>+ Pick outfits</b> to choose from the outfit library (📷 Photos → 👗 Outfit Picker is where you build that pool).
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
              {reelOutfits.map(o => (
                <div key={o.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(106,198,138,0.4)', background: 'rgba(0,0,0,0.3)' }}>
                  {o.image
                    ? <img src={o.image} alt="" loading="lazy"
                        onError={(e) => { if (o.imageFallback && e.currentTarget.src !== o.imageFallback) e.currentTarget.src = o.imageFallback }}
                        style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', aspectRatio: '4/5', background: '#000' }} />}
                  <button onClick={() => removeReelOutfit(o.id)}
                    title="Remove from this reel"
                    style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', color: '#E87878', border: '1px solid rgba(232,120,120,0.3)', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    ✕
                  </button>
                  <div style={{ padding: 6, fontSize: 10, color: '#8FB4F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    @{o.handle}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {outputs.length > 0 && (() => {
        // Filter scenes down to:
        //   1. Hide Started placeholders — those are reels waiting on
        //      Generate, not real scenes. They live in My Projects.
        //   2. When a reel is selected, scope the gallery to ONLY that
        //      reel's scenes. The user expected the workflow to show
        //      the active project's gallery, not every scene for the
        //      whole creator (which was leaking R002 into R003).
        const scenes = outputs.filter(o => {
          if (o.status === 'Started') return false
          if (reel?.id && o.reel?.id !== reel.id) return false
          return true
        })
        if (scenes.length === 0) return null
        const generating = scenes.filter(o => o.status === 'Generating').length
        const pending = scenes.filter(o => o.status === 'Pending').length
        const approved = scenes.filter(o => o.status === 'Approved').length
        const rejected = scenes.filter(o => o.status === 'Rejected').length
        const uploaded = scenes.filter(o => o.uploadedAt).length
        // "Project complete" = every Approved scene under this reel has
        // a finished video uploaded. Rejected scenes don't count toward
        // the denominator (they're explicitly out of the pipeline).
        // Only signal when we're scoped to a single reel.
        const approvedScenes = scenes.filter(o => o.status === 'Approved')
        const allApprovedUploaded = !!reel?.id && approvedScenes.length > 0 && approvedScenes.every(o => o.uploadedAt)
        return (
        <div style={{ ...card, marginTop: 16 }} id="stageb-outputs">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>
                {reel?.id ? `Scenes for this reel` : `All scenes for ${sel?.name}`}
                <span style={{ color: 'var(--foreground-muted)', fontWeight: 500 }}> ({scenes.length})</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 4 }}>
                Every Generate click creates a new card. Status flows <span style={{ color: '#8fb4f0' }}>Generating</span> → <span style={{ color: '#e8b878' }}>Pending</span> → <span style={{ color: '#6AC68A' }}>Approved</span> or <span style={{ color: '#E87878' }}>Rejected</span>. Started reels you haven&apos;t generated on yet are over in <b>Workspace → My Projects</b>.
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 11, color: 'var(--foreground-muted)' }}>
                {generating > 0 && <span><b style={{ color: '#8fb4f0' }}>{generating}</b> Generating</span>}
                {pending > 0 && <span><b style={{ color: '#e8b878' }}>{pending}</b> Pending review</span>}
                {approved > 0 && <span><b style={{ color: '#6AC68A' }}>{approved}</b> Approved</span>}
                {rejected > 0 && <span><b style={{ color: '#E87878' }}>{rejected}</b> Rejected</span>}
                {uploaded > 0 && <span><b style={{ color: '#6AC68A' }}>{uploaded}</b> ✓ Uploaded</span>}
              </div>
              {allApprovedUploaded && (
                // Big green banner when every approved scene in this
                // reel has a finished video uploaded. The editor's
                // signal that the project is done — admin review takes
                // over from here.
                <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(106,198,138,0.14)', border: '1px solid rgba(106,198,138,0.4)', borderRadius: 8, color: '#6AC68A', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🎉</span>
                  Project complete — all {approvedScenes.length} approved scene{approvedScenes.length === 1 ? '' : 's'} uploaded.
                  <span style={{ fontWeight: 500, color: 'var(--foreground-muted)', marginLeft: 4 }}>Admin can now review.</span>
                </div>
              )}
            </div>
            {/* Reel-scoped flat stills ZIP — the common case, since the
                editor is usually in a single project (one reel). No
                video, no approval gate, no per-slug folders. Falls back
                to the cross-reel approved-only mega-ZIP when there's
                no reel context (e.g., admin viewing all of Amelia). */}
            {scenes.length > 0 && reel?.id ? (
              <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip-stills?creatorId=${creatorId}&reelId=${reel.id}`}
                title={reelOutfits.length > 0
                  ? `Stills + ${reelOutfits.length} outfit reference photo${reelOutfits.length === 1 ? '' : 's'} in an outfits/ subfolder`
                  : 'Stills only — attach outfits above to include them in the ZIP'}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'rgba(232,168,120,0.18)', color: '#e8b878', border: '1px solid rgba(232,168,120,0.25)', borderRadius: 5, textDecoration: 'none' }}>
                ⬇ Download ZIP: {scenes.length} still{scenes.length === 1 ? '' : 's'}{reelOutfits.length > 0 ? ` + ${reelOutfits.length} outfit${reelOutfits.length === 1 ? '' : 's'}` : ''}
              </a>
            ) : approved > 0 ? (
              <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip-all?creatorId=${creatorId}`}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'rgba(232,168,120,0.18)', color: '#e8b878', border: '1px solid rgba(232,168,120,0.25)', borderRadius: 5, textDecoration: 'none' }}>
                ⬇ Download all approved (1 mega-ZIP)
              </a>
            ) : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {scenes.map(o => {
              const sc = o.status === 'Approved' ? '#6AC68A' : o.status === 'Rejected' ? '#E87878' : o.status === 'Failed' ? '#E87878' : o.status === 'Generating' ? '#8fb4f0' : '#e8b878'
              const placeholder = o.status === 'Generating' ? '⏳ rendering…' : o.status === 'Failed' ? '✕ failed' : '…'
              // While the project is re-Generating, hide any stale image
              // from a prior run — otherwise the card shows the old
              // (possibly bad) result with "Generating" stamped on it.
              const showImage = !!o.image && o.status !== 'Generating' && o.status !== 'Started'
              // The Dropbox shared link forces a direct download when we
              // swap dl=0 → dl=1; raw=1 streams inline. Use dl=1 for the
              // download button, raw=1 for the inline image source.
              const dlUrl = o.dropbox ? String(o.dropbox).replace('dl=0', 'dl=1').replace('raw=1', 'dl=1') : null
              return (
                // Solid green border + tint when uploaded — at-a-glance
                // "this one is done" signal across the row.
                <div key={o.id} style={{ position: 'relative', border: `${o.uploadedAt ? '2' : '1'}px solid ${o.uploadedAt ? 'rgba(106,198,138,0.7)' : sc + '40'}`, borderRadius: 8, overflow: 'hidden', background: o.uploadedAt ? 'rgba(106,198,138,0.06)' : 'rgba(0,0,0,0.25)' }}>
                  {showImage
                    ? <img src={o.uploadedThumbnail || o.image} alt="" loading="lazy" onClick={() => setSelectedOutput(o)}
                        style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                        title={o.uploadedThumbnail ? 'Uploaded video thumbnail' : 'Bedroom scene generation'} />
                    : <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: sc, textAlign: 'center', padding: 8 }}>{placeholder}</div>}
                  {o.uploadedAt && (
                    // Corner badge overlaid on the image so it's
                    // visible without reading the action row.
                    <div style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 4, background: 'rgba(106,198,138,0.92)', color: '#0a1a10', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}>
                      ✓ UPLOADED
                    </div>
                  )}
                  <div style={{ padding: 8, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#ddd', fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.slug || `${sel?.name} · Reel ${o.index ?? '?'}`}</span>
                      <span style={{ color: sc, fontWeight: 700 }}>{o.status}</span>
                    </div>
                    <div style={{ color: 'var(--foreground-muted)', margin: '2px 0' }}>{o.room || '—'}{o.roomFraming ? ` [${o.roomFraming}]` : ''}{o.timeOfDay ? ` · ${o.timeOfDay}` : ''}</div>
                    {o.reel && <a href={o.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>↗ source reel @{o.reel.handle || o.reel.reelId}</a>}

                    {/* Direct download — available for any card that has
                        an image (Pending / Approved / Rejected). The TJP
                        editor wants the still even before approval. */}
                    {dlUrl && showImage && (
                      <a href={dlUrl} download
                        style={{ display: 'block', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(232,168,120,0.18)', color: '#e8b878', borderRadius: 5, textDecoration: 'none' }}>⬇ Download still</a>
                    )}
                    {o.status === 'Approved' && (
                      <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip?id=${o.id}`}
                        style={{ display: 'block', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(232,168,120,0.18)', color: '#e8b878', borderRadius: 5, textDecoration: 'none' }}>⬇ ZIP for TJP (still + reel)</a>
                    )}
                    {o.status === 'Approved' && o.reel?.id && (
                      // Opens an inline modal scoped to this scene
                      // (creates Asset + Task via the same /upload
                      // route, just without navigating away from the
                      // workflow). After upload, button flips to a
                      // ✓ Uploaded badge with a "Re-upload" affordance.
                      o.uploadedAt ? (
                        <button onClick={() => setUploadingScene(o)}
                          title={`Uploaded ${new Date(o.uploadedAt).toLocaleString()} — click to re-upload`}
                          style={{ display: 'block', width: '100%', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(106,198,138,0.22)', color: '#6AC68A', border: '1px solid rgba(106,198,138,0.5)', borderRadius: 5, cursor: 'pointer' }}>
                          ✓ Uploaded
                        </button>
                      ) : (
                        <button onClick={() => setUploadingScene(o)}
                          style={{ display: 'block', width: '100%', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(106,198,138,0.16)', color: '#6AC68A', borderRadius: 5, border: 'none', cursor: 'pointer' }}>
                          ↑ Upload finished video
                        </button>
                      )
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {o.status !== 'Approved' && <button onClick={() => setOutputStatus(o, 'Approved')} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 700, background: 'rgba(106,198,138,0.18)', color: '#6AC68A', border: 'none', borderRadius: 5, cursor: 'pointer' }}>✓</button>}
                      {o.status !== 'Rejected' && <button onClick={() => setOutputStatus(o, 'Rejected')} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 700, background: 'rgba(232,120,120,0.16)', color: '#E87878', border: 'none', borderRadius: 5, cursor: 'pointer' }}>✕</button>}
                      <a href={o.dropbox || o.image || '#'} target="_blank" rel="noreferrer" style={{ padding: '4px 8px', fontSize: 11, background: 'rgba(120,160,232,0.16)', color: '#8fb4f0', borderRadius: 5, textDecoration: 'none' }}>↗</a>
                      <button
                        onClick={() => armedDeleteId === o.id ? deleteOutput(o) : setArmedDeleteId(o.id)}
                        style={{
                          padding: '4px 8px',
                          fontSize: 11,
                          fontWeight: armedDeleteId === o.id ? 700 : 400,
                          background: armedDeleteId === o.id ? 'rgba(232,120,120,0.22)' : 'none',
                          color: armedDeleteId === o.id ? '#E87878' : '#888',
                          border: `1px solid ${armedDeleteId === o.id ? 'rgba(232,120,120,0.45)' : 'rgba(255,255,255,0.15)'}`,
                          borderRadius: 5,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}>
                        {armedDeleteId === o.id ? 'Sure?' : '🗑'}
                      </button>
                    </div>
                    {o.rejectReason && <div style={{ marginTop: 4, color: '#E87878', fontStyle: 'italic' }}>{o.rejectReason}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )
      })()}

      {/* Scene-scoped upload modal — replaces the old "redirect to
          /ai-editor and auto-open the upload form" flow. Editor stays
          in the workflow; modal closes on success. */}
      {uploadingScene && (
        <SceneUploadModal
          scene={uploadingScene}
          creatorId={creatorId}
          onClose={() => setUploadingScene(null)}
          onSuccess={() => { setUploadingScene(null); loadOutputs() }}
        />
      )}

      {/* Click-to-expand detail modal for a Scene card. Big preview +
          metadata + actions in one place. Click outside or ✕ to close. */}
      {selectedOutput && (() => {
        const o = selectedOutput
        const sc = o.status === 'Approved' ? '#6AC68A' : o.status === 'Rejected' ? '#E87878' : o.status === 'Failed' ? '#E87878' : o.status === 'Generating' ? '#8fb4f0' : '#e8b878'
        const dlUrl = o.dropbox ? String(o.dropbox).replace('dl=0', 'dl=1').replace('raw=1', 'dl=1') : null
        // Compute neighbors in the visible scene set so the chevrons +
        // arrow keys agree on what "prev/next" means. Mirror the
        // gallery's scope: Started hidden, and reel-scoped when a reel
        // is selected (don't leak into another project's scenes).
        const visible = outputs.filter(o2 => {
          if (o2.status === 'Started') return false
          if (reel?.id && o2.reel?.id !== reel.id) return false
          return true
        })
        const idx = visible.findIndex(o2 => o2.id === o.id)
        const prev = idx > 0 ? visible[idx - 1] : null
        const next = idx >= 0 && idx < visible.length - 1 ? visible[idx + 1] : null
        const chevronStyle = (enabled) => ({
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: enabled ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.25)',
          color: enabled ? '#fff' : 'rgba(255,255,255,0.3)',
          border: '1px solid rgba(255,255,255,0.18)',
          fontSize: 20,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: enabled ? 'pointer' : 'default',
          zIndex: 1,
          transition: 'background 0.15s ease',
        })
        return (
          <div onClick={() => setSelectedOutput(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 2800, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <button onClick={e => { e.stopPropagation(); if (prev) setSelectedOutput(prev) }}
              disabled={!prev}
              style={{ ...chevronStyle(!!prev), left: 12 }}
              aria-label="Previous scene">‹</button>
            <button onClick={e => { e.stopPropagation(); if (next) setSelectedOutput(next) }}
              disabled={!next}
              style={{ ...chevronStyle(!!next), right: 12 }}
              aria-label="Next scene">›</button>
            <div onClick={e => e.stopPropagation()}
              style={{ position: 'relative', width: 'min(960px, 95vw)', maxHeight: '92vh', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(280px, 420px) 1fr', gap: 20, background: '#16161c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.55)', overflow: 'auto' }}>
              {o.image
                ? <img src={o.image} alt="" style={{ width: '100%', maxHeight: isMobile ? '50vh' : 'none', aspectRatio: isMobile ? 'auto' : '9/16', objectFit: 'contain', borderRadius: 10, background: '#000', display: 'block', alignSelf: 'start' }} />
                : <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', color: sc, background: '#000', borderRadius: 10 }}>{o.status}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.slug || `${sel?.name} · Reel ${o.index ?? '?'}`}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: sc }}>{o.status}</span>
                      {visible.length > 1 && idx >= 0 && (
                        <span style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>{idx + 1} / {visible.length} · ← →</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setSelectedOutput(null)}
                    style={{ padding: '4px 10px', fontSize: 16, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 12, lineHeight: 1.6 }}>
                  <div><b style={{ color: 'var(--foreground)' }}>Room:</b> {o.room || '—'}{o.roomFraming ? ` [${o.roomFraming}]` : ''}</div>
                  {o.timeOfDay && <div><b style={{ color: 'var(--foreground)' }}>Time of day:</b> {o.timeOfDay}</div>}
                  <div><b style={{ color: 'var(--foreground)' }}>Subject framing:</b> {o.screenshotFraming || '?'}</div>
                  {o.reel && (
                    <div><b style={{ color: 'var(--foreground)' }}>Source reel:</b> <a href={o.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>@{o.reel.handle || o.reel.reelId}</a></div>
                  )}
                  {o.rejectReason && (
                    <div style={{ marginTop: 8, padding: 8, background: 'rgba(232,120,120,0.1)', borderRadius: 6, color: '#E87878', fontStyle: 'italic' }}>Rejection: {o.rejectReason}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                  {dlUrl && o.image && (
                    <a href={dlUrl} download
                      style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, textAlign: 'center', background: 'linear-gradient(135deg, #e8a878 0%, #e8b878 100%)', color: '#1a0a0a', borderRadius: 8, textDecoration: 'none' }}>⬇ Download still</a>
                  )}
                  {o.image && (
                    <button onClick={async () => {
                      try {
                        const r = await fetch('/api/admin/recreate-rooms/stage-b/outputs/flip', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: o.id }),
                        })
                        if (!r.ok) throw new Error(`${r.status}`)
                        await loadOutputs()
                        // Reload the selected output from the refreshed list so the
                        // modal preview swaps to the flipped image without re-clicking.
                        const fresh = (await fetch(`/api/admin/recreate-rooms/stage-b/outputs?creatorId=${creatorId}`).then(r => r.json())).outputs?.find(x => x.id === o.id)
                        if (fresh) setSelectedOutput(fresh)
                      } catch (e) { setMsg(`❌ Flip failed: ${e?.message || String(e)}`) }
                    }}
                      style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, textAlign: 'center', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, cursor: 'pointer' }}>↔ Flip horizontally</button>
                  )}
                  {o.status === 'Approved' && (
                    <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip?id=${o.id}`}
                      style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, textAlign: 'center', background: 'rgba(232,168,120,0.18)', color: '#e8b878', border: '1px solid rgba(232,168,120,0.25)', borderRadius: 8, textDecoration: 'none' }}>⬇ ZIP for TJP (still + reel)</a>
                  )}
                  {o.dropbox && (
                    <a href={o.dropbox} target="_blank" rel="noreferrer"
                      style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, textAlign: 'center', background: 'rgba(120,160,232,0.12)', color: '#8fb4f0', border: '1px solid rgba(120,160,232,0.25)', borderRadius: 8, textDecoration: 'none' }}>↗ Open in Dropbox</a>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {o.status !== 'Approved' && (
                    <button onClick={async () => { await setOutputStatus(o, 'Approved'); setSelectedOutput(null) }}
                      style={{ flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: 700, background: 'rgba(106,198,138,0.18)', color: '#6AC68A', border: '1px solid rgba(106,198,138,0.3)', borderRadius: 6, cursor: 'pointer' }}>✓ Approve</button>
                  )}
                  {o.status !== 'Rejected' && (
                    <button onClick={async () => { await setOutputStatus(o, 'Rejected'); setSelectedOutput(null) }}
                      style={{ flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: 700, background: 'rgba(232,120,120,0.16)', color: '#E87878', border: '1px solid rgba(232,120,120,0.3)', borderRadius: 6, cursor: 'pointer' }}>✕ Reject</button>
                  )}
                  <button
                    onClick={async () => {
                      if (armedDeleteId === o.id) { await deleteOutput(o); setSelectedOutput(null) }
                      else { setArmedDeleteId(o.id) }
                    }}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      fontWeight: armedDeleteId === o.id ? 700 : 600,
                      background: armedDeleteId === o.id ? 'rgba(232,120,120,0.22)' : 'none',
                      color: armedDeleteId === o.id ? '#E87878' : '#888',
                      border: `1px solid ${armedDeleteId === o.id ? 'rgba(232,120,120,0.45)' : 'rgba(255,255,255,0.15)'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}>
                    {armedDeleteId === o.id ? 'Click again to confirm' : '🗑 Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {outfitPickerOpen && reel?.id && (
        <OutfitPickerModal
          currentIds={reelOutfits.map(o => o.id)}
          onClose={() => setOutfitPickerOpen(false)}
          onSave={async (ids) => { await setReelOutfitIds(ids); setOutfitPickerOpen(false) }}
        />
      )}
    </div>
  )
}

// Outfit picker — pulls the curated outfit pool (Photos with Is Outfit
// = true) and lets the editor multi-select. Selection state stays
// modal-local until Save fires; closing without saving discards.
function OutfitPickerModal({ currentIds, onClose, onSave }) {
  const [pool, setPool] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(new Set(currentIds || []))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/admin/photos/library?outfitsOnly=1')
        const d = await r.json()
        if (!cancelled && d?.ok) setPool(d.photos || [])
      } catch {} finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const filtered = pool.filter(p => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (p.handle || '').toLowerCase().includes(q) || (p.caption || '').toLowerCase().includes(q)
  })

  const save = async () => {
    setSaving(true)
    try {
      // Preserve a sensible ordering: anything already attached keeps
      // its prior slot (editor's prior pick-order), new picks append.
      const order = [...currentIds.filter(id => selected.has(id)), ...[...selected].filter(id => !currentIds.includes(id))]
      await onSave(order)
    } finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(1100px, 95vw)', maxHeight: '92vh', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>👗 Pick outfits for this reel</div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>
              {loading ? 'Loading outfit pool…' : <>{pool.length} outfit{pool.length === 1 ? '' : 's'} available · <b style={{ color: '#6AC68A' }}>{selected.size}</b> selected</>}
            </div>
          </div>
          <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by handle…"
            style={{ flex: 1, minWidth: 180, padding: '8px 12px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13 }} />
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
          {loading ? (
            <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>⏳ Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
              {pool.length === 0
                ? 'No outfits in the pool yet. Go to Photos → Outfit Picker to flag images as outfits first.'
                : 'No outfits match the filter.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {filtered.map(p => {
                const isSel = selected.has(p.id)
                // Prefer the AI flatlay over the contextual photo for
                // picker thumbnails — the picker exists to communicate
                // "which outfit", and the clean product shot reads more
                // clearly than someone wearing it on a couch.
                const flatlayReady = !!p.flatlayCdnUrl && (p.flatlayStatus === 'Done')
                const displayImage = flatlayReady ? p.flatlayCdnUrl : p.image
                const fallback = flatlayReady ? (p.image || p.imageFallback) : p.imageFallback
                return (
                  <div key={p.id} onClick={() => toggle(p.id)}
                    style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                      border: isSel ? '3px solid #6AC68A' : '1px solid rgba(255,255,255,0.1)' }}>
                    {displayImage
                      ? <img src={displayImage} alt="" loading="lazy"
                          onError={(e) => { if (fallback && e.currentTarget.src !== fallback) e.currentTarget.src = fallback }}
                          style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block', background: flatlayReady ? '#fff' : '#000' }} />
                      : <div style={{ width: '100%', aspectRatio: '4/5', background: '#000' }} />}
                    {isSel && (
                      <div style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: '50%', background: '#6AC68A', color: '#0a1a10', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>✓</div>
                    )}
                    {flatlayReady && (
                      <div style={{ position: 'absolute', top: 5, left: 5, padding: '2px 5px', borderRadius: 3, background: 'rgba(232,168,120,0.85)', color: '#1a0a0a', fontSize: 9, fontWeight: 800 }}>📦 FLATLAY</div>
                    )}
                    <div style={{ padding: '6px 8px', fontSize: 11, background: 'rgba(0,0,0,0.55)', color: '#8FB4F0', position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                      @{p.handle}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
            Click to mark/unmark. Save replaces the reel&apos;s outfit list.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: saving ? 'rgba(106,198,138,0.18)' : '#6AC68A', color: saving ? 'rgba(255,255,255,0.4)' : '#0a1a10', border: 'none', borderRadius: 6, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? '⏳ Saving…' : `Save ${selected.size} outfit${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
