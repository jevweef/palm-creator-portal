'use client'

// Shared Recreate panels — used by /admin/recreate-source (admin power
// view) AND /ai-editor/recreate (scoped editor view). The panels are
// self-contained and identical in both surfaces; admin pages that need
// their own modals must import { uiConfirm, uiPrompt, uiAlert, ModalHost }
// from here so they share the SAME singleton listener list as the
// extracted panels (single ModalHost instance per page).

import { useEffect, useState, useCallback } from 'react'
import { buildStreamPosterUrl, buildStreamIframeUrl } from '@/lib/cfStreamUrl'

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
      const r = st.resolve; _modalState = null; setSt(null)
      r(st.kind === 'confirm' ? false : st.kind === 'prompt' ? null : undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st])
  if (!st) return null

  const finish = (result) => { const r = st.resolve; _modalState = null; setSt(null); r(result) }
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
  const [data, setData] = useState({ creators: [], rooms: [], variations: [] })
  const [reels, setReels] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [reel, setReel] = useState(null)
  const [stageBOut, setStageBOut] = useState(null)
  const [outputs, setOutputs] = useState([])
  const [subjectFile, setSubjectFile] = useState(null)
  const [rawScreenshotFile, setRawScreenshotFile] = useState(null)
  const [upscaledScreenshotFile, setUpscaledScreenshotFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [project, setProject] = useState(null) // Existing Started project when continuing
  const [showReelGrid, setShowReelGrid] = useState(false) // Hidden when a reel is already selected
  const [showOptionalUploads, setShowOptionalUploads] = useState(false) // Raw + upscaled, archival only
  const [reelPlaying, setReelPlaying] = useState(false) // Click-to-play the selected reel inline

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

  // Continuing a Started project: load the record (so we know its slug)
  // and pre-pick the reel from its Source Reel field, regardless of
  // whether the pool-loaded reels list contains it (the reel might be
  // hidden from the pool because it's already a project).
  useEffect(() => {
    if (!initialProjectId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/admin/recreate-rooms/stage-b/outputs?creatorId=${initialCreatorId || ''}`)
        if (!r.ok) return
        const d = await r.json()
        if (cancelled) return
        const match = (d.outputs || []).find(o => o.id === initialProjectId)
        if (match) {
          setProject(match)
          if (match.reel && !reel) setReel(match.reel)
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [initialProjectId, initialCreatorId, reel])

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
  const deleteOutput = async (o) => {
    if (!(await uiConfirm('Delete this scene?', { danger: true, okLabel: 'Delete' }))) return
    await fetch(`/api/admin/recreate-rooms/stage-b/outputs?id=${o.id}`, { method: 'DELETE' }).catch(() => {})
    loadOutputs()
  }



  const sel = creators.find(c => c.id === creatorId)
  const myRooms = data.rooms.filter(r => r.creatorId === creatorId)
  // Match the pool's filter: only show reels that haven't already been
  // produced for this creator. Keeps Stage B aligned with the upload
  // flow — no inspo shows up twice once an editor has run it through.
  const availableReels = creatorId
    ? reels.filter(r => !(r.producedFor || []).includes(creatorId))
    : reels

  const generate = async () => {
    if (!creatorId) { setMsg('⚠️ Pick a creator first (step 1).'); return }
    if (!reel?.id) { setMsg('⚠️ Pick the inspo reel this scene goes with (step 2).'); return }
    if (!subjectFile) { setMsg('⚠️ Upload the TJP image-to-image photo (step 3).'); return }
    setBusy(true); setStageBOut(null); setMsg('⏳ Uploading your files…')
    try {
      // Upload the TJP photo (required input to generation) plus the
      // optional organizational artifacts. The route attaches all three
      // to the new record so the editor can find them later by project.
      const subjectDropboxPath = await stageBUpload(subjectFile, 'subject')
      const rawScreenshotPath = rawScreenshotFile ? await stageBUpload(rawScreenshotFile, 'raw_screenshot') : null
      const upscaledScreenshotPath = upscaledScreenshotFile ? await stageBUpload(upscaledScreenshotFile, 'upscaled_screenshot') : null
      setMsg('⏳ Creating the scene — the AI is swapping her background to her saved room. This takes 3–6 minutes; you can navigate away and the result will appear in Scenes below.')
      const res = await fetch('/api/admin/recreate-rooms/stage-b', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          reelRecordId: reel.id,
          subjectDropboxPath,
          rawScreenshotPath,
          upscaledScreenshotPath,
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
        setMsg(`✅ Scene submitted. The portal read your photo as ${d.screenshotFraming} framing and picked her "${d.room}" [${d.roomFraming}] room. Rendering — check the Scenes section below in a few minutes.`)
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

  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, marginBottom: 14 }
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
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Create Scene — put your creator in her room</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 14 }}>
        Pick the inspo reel + upload the TJP image-to-image photo of your creator in that reel&apos;s pose &amp; outfit. The portal swaps the background to her saved room. From there, take the scene back to TJP for outfit transfer + motion control, then bring the finished video to the <a href="/ai-editor" style={{ color: 'var(--palm-pink)' }}>AI Recreate Pool</a> for review.
      </p>

      {project && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(232,184,120,0.12)', border: '1px solid rgba(232,184,120,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--foreground)' }}>
          📌 Continuing project <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#e8b878', fontWeight: 700 }}>{project.slug}</span>
          {project.reel && <> · reel <a href={project.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>@{project.reel.handle || project.reel.reelId}</a></>}
          {project.status && project.status !== 'Started' && <> · status: <span style={{ fontWeight: 700 }}>{project.status}</span></>}
        </div>
      )}

      <div id="tour-stageb-creator" style={card}>
        {stepHead(1, 'Creator')}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 20, alignItems: 'center' }}>
          <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
            style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, fontSize: 14, fontWeight: 500, width: '100%' }}>
            {creators.length === 0 && <option>No creators with AI refs</option>}
            {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
            {sel ? (
              myRooms.length === 0
                ? <>⚠️ <b>{sel.name}</b> has no saved rooms yet — an admin needs to create one in the Rooms tab before you can generate scenes for her.</>
                : <>🏠 <b>{sel.name}</b> has <b>{myRooms.length} room{myRooms.length === 1 ? '' : 's'}</b> on file ({myRooms.map(r => r.framing || '?').join(', ')}). The portal auto-picks the one whose framing matches your uploaded photo.</>
            ) : 'Pick a creator to see her saved rooms.'}
          </div>
        </div>
      </div>

      <div style={card}>
        {stepHead(2, 'Inspo reel this scene goes with')}
        {reel?.id && !showReelGrid ? (
          // Selected reel = the page's main piece of media. Vertical
          // 9:16 video on the left, click to play inline (Stream embed
          // when available, raw Dropbox video otherwise). Handle +
          // actions to the right, Change reel as a subtle corner action.
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: 20, alignItems: 'stretch' }}>
            <div style={{ position: 'relative', aspectRatio: '9/16', borderRadius: 10, overflow: 'hidden', background: '#000', border: '2px solid var(--palm-pink)', boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}>
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
                      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, paddingLeft: 4 }}>▶</div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 13 }}>No preview</div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0, gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Inspo source</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#e8b878', marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{reel.handle || reel.reelId}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {reel.url && (
                    <a href={reel.url} target="_blank" rel="noreferrer"
                      style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#8fb4f0', background: 'rgba(120,160,232,0.12)', border: '1px solid rgba(120,160,232,0.25)', borderRadius: 6, textDecoration: 'none' }}>↗ Open on Instagram</a>
                  )}
                  {reel.video && (
                    <a href={String(reel.video).replace(/([?&])raw=1/, '$1dl=1')} target="_blank" rel="noopener"
                      style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#8fb4f0', background: 'rgba(120,160,232,0.12)', border: '1px solid rgba(120,160,232,0.25)', borderRadius: 6, textDecoration: 'none' }}>↓ Re-download mp4</a>
                  )}
                </div>
              </div>
              <button onClick={() => setShowReelGrid(true)}
                style={{ alignSelf: 'flex-start', padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, cursor: 'pointer' }}>
                Change reel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#888' }}>
                {availableReels.length} reels available for {sel?.name || 'this creator'} (already-produced ones are hidden). Click one to mark it as this scene&apos;s source.
              </div>
              {reel?.id && (
                <button onClick={() => setShowReelGrid(false)}
                  style={{ padding: '4px 8px', fontSize: 11, background: 'none', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, cursor: 'pointer' }}>
                  Done picking
                </button>
              )}
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

      {/* Inline guidance: what to do off-portal between steps 2 and 5.
          Most of the "Create Scene" work actually happens in TJP — this
          tells the editor exactly what to do before coming back here. */}
      {reel?.id && (
        <div style={{ ...card, background: 'rgba(120,160,232,0.06)', border: '1px solid rgba(120,160,232,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 20 }}>🎬</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#8fb4f0' }}>Now do this in TJP (off-site)</div>
          </div>
          {/* Steps in a 5-column grid on wide screens, collapsing as the
              viewport narrows — feels like a recipe / progress strip
              rather than a long vertical column. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {[
              { n: 1, label: 'Download the reel', text: <>Use the <span style={{ color: '#8fb4f0', whiteSpace: 'nowrap' }}>↓ Re-download mp4</span> button and bring it into TJP.</> },
              { n: 2, label: 'Screenshot the pose', text: <>Take a screenshot of the pose you want to recreate.</> },
              { n: 3, label: 'Upscale', text: <>Upscale that screenshot in TJP.</> },
              { n: 4, label: 'Image-to-image', text: <>Run <b>Apex Transfer → image-to-image</b> with the upscaled screenshot + your creator. TJP gives you 4 variations.</> },
              { n: 5, label: 'Upload best', text: <>Pick the best of the 4, download it, upload below in <b>step 3</b>.</> },
            ].map(s => (
              <div key={s.n} style={{ padding: 12, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(120,160,232,0.12)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(120,160,232,0.25)', color: '#8fb4f0', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{s.n}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#8fb4f0' }}>{s.label}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--foreground)', lineHeight: 1.45 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optional uploads — collapsed by default. Editor doesn't usually
          care about archival; hiding them keeps the page short. */}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setShowOptionalUploads(s => !s)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', fontSize: 12, color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer' }}>
          <span style={{ fontSize: 14 }}>{showOptionalUploads ? '−' : '+'}</span>
          Optionally archive the TJP raw + upscaled screenshots
          {rawScreenshotFile && <span style={{ color: '#6AC68A' }}>· raw ✓</span>}
          {upscaledScreenshotFile && <span style={{ color: '#6AC68A' }}>· upscaled ✓</span>}
        </button>
        {showOptionalUploads && (
          <div style={{ ...card, marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {[
                { label: 'Raw screenshot', file: rawScreenshotFile, set: setRawScreenshotFile },
                { label: 'Upscaled screenshot', file: upscaledScreenshotFile, set: setUpscaledScreenshotFile },
              ].map(slot => (
                <label key={slot.label} style={{ display: 'block', cursor: 'pointer' }}>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{slot.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'rgba(0,0,0,0.25)', border: `1px dashed rgba(255,255,255,${slot.file ? '0.16' : '0.1'})`, borderRadius: 6 }}>
                    {slot.file ? (
                      <>
                        <img src={URL.createObjectURL(slot.file)} alt="" style={{ width: 44, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 4, background: '#000' }} />
                        <span style={{ fontSize: 11, color: '#6AC68A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>✓ {slot.file.name}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>Click to choose a file</span>
                    )}
                    <input type="file" accept="image/*" onChange={e => slot.set(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* TJP photo upload — the only required thing on this page.
          Treated as a proper drop zone instead of a tiny file input so
          it reads as the main action visually. */}
      <div id="tour-stageb-subject" style={{ ...card, border: '1px solid rgba(232,168,120,0.4)', padding: 20 }}>
        {stepHead(3, 'TJP image-to-image output', 'The TJP photo of your creator in the reel\'s pose & outfit (still in the reel\'s environment). The portal swaps the background to her saved room.', '#e8b878')}

        <label
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(232,168,120,0.14)' }}
          onDragLeave={e => { e.currentTarget.style.background = subjectFile ? 'rgba(106,198,138,0.06)' : 'rgba(232,168,120,0.05)' }}
          onDrop={e => {
            e.preventDefault()
            e.currentTarget.style.background = subjectFile ? 'rgba(106,198,138,0.06)' : 'rgba(232,168,120,0.05)'
            const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'))
            if (f) setSubjectFile(f)
          }}
          style={{
            display: 'block',
            border: `2px dashed rgba(232,168,120,${subjectFile ? '0.3' : '0.45'})`,
            borderRadius: 12,
            padding: subjectFile ? 20 : 0,
            minHeight: subjectFile ? undefined : 280,
            background: subjectFile ? 'rgba(106,198,138,0.06)' : 'rgba(232,168,120,0.05)',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}>
          <input type="file" accept="image/*" onChange={e => setSubjectFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
          {subjectFile ? (
            // Filled state: big 9:16 preview on the left so editor can
            // verify the right photo's loaded, status + replace hint
            // stacks to the right.
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: 20, alignItems: 'stretch' }}>
              <img src={URL.createObjectURL(subjectFile)} alt=""
                style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 10, background: '#000', boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#6AC68A', color: '#1a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800 }}>✓</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#6AC68A' }}>Ready to generate</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--foreground-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subjectFile.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>{Math.round((subjectFile.size || 0) / 1024)} KB</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--foreground-muted)', padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 6 }}>
                  Click anywhere on this card or drag a new file here to replace.
                </div>
              </div>
            </div>
          ) : (
            // Empty state: full-size drop target, centered icon/text.
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📤</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>Drop the TJP photo here</div>
              <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 6 }}>or click anywhere on this card to browse</div>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 18, padding: '6px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 5, maxWidth: 360 }}>
                jpg or png · the creator&apos;s likeness should already be in the photo (TJP image-to-image output)
              </div>
            </div>
          )}
        </label>
      </div>

      <div id="tour-stageb-generate" style={{ ...card, padding: 20 }}>
        {stepHead(4, 'Generate the scene', `Swaps ${sel?.name || 'the creator'}'s background for her saved room and relights her to match. Takes ~3–6 minutes — you can navigate away, the result lands in Scenes below when it's done.`)}
        <button onClick={generate} disabled={busy || !subjectFile}
          style={{
            display: 'block',
            width: '100%',
            padding: '14px 24px',
            fontSize: 15,
            fontWeight: 700,
            background: busy ? 'rgba(232,168,120,0.3)' : !subjectFile ? 'rgba(232,168,120,0.2)' : 'linear-gradient(135deg, #e8a878 0%, #e8b878 100%)',
            color: !subjectFile && !busy ? 'rgba(26,10,10,0.5)' : '#1a0a0a',
            border: 'none',
            borderRadius: 10,
            cursor: (busy || !subjectFile) ? 'default' : 'pointer',
            boxShadow: subjectFile && !busy ? '0 4px 16px rgba(232,168,120,0.25)' : 'none',
            transition: 'all 0.15s ease',
          }}>
          {busy ? '⏳ Working…' : subjectFile ? '🪄 Generate scene' : '🪄 Generate scene — upload the TJP photo first'}
        </button>
        {msg && <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 14, padding: 12, background: 'rgba(0,0,0,0.25)', borderRadius: 6, borderLeft: '3px solid rgba(232,168,120,0.4)' }}>{msg}</div>}
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

      {outputs.length > 0 && (
        <div style={{ ...card, marginTop: 16 }} id="stageb-outputs">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={lbl}>Scenes — {sel?.name} ({outputs.length})</div>
            {(() => {
              const approvedCount = outputs.filter(o => o.status === 'Approved').length
              if (!approvedCount) return null
              return (
                <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip-all?creatorId=${creatorId}`}
                  style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'rgba(232,168,120,0.18)', color: '#e8b878', border: '1px solid rgba(232,168,120,0.25)', borderRadius: 5, textDecoration: 'none' }}>
                  ⬇ Download all approved (1 mega-ZIP)
                </a>
              )
            })()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {outputs.map(o => {
              const sc = o.status === 'Approved' ? '#6AC68A' : o.status === 'Rejected' ? '#E87878' : o.status === 'Failed' ? '#E87878' : o.status === 'Generating' ? '#8fb4f0' : '#e8b878'
              const placeholder = o.status === 'Generating' ? '⏳ rendering…' : o.status === 'Failed' ? '✕ failed' : '…'
              return (
                <div key={o.id} style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                  {o.image
                    ? <img src={o.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: sc, textAlign: 'center', padding: 8 }}>{placeholder}</div>}
                  <div style={{ padding: 8, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#ddd', fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>{o.slug || `${sel?.name} · Reel ${o.index ?? '?'}`}</span>
                      <span style={{ color: sc, fontWeight: 700 }}>{o.status}</span>
                    </div>
                    <div style={{ color: 'var(--foreground-muted)', margin: '2px 0' }}>{o.room || '—'}{o.roomFraming ? ` [${o.roomFraming}]` : ''} · framing {o.screenshotFraming || '?'}</div>
                    {o.reel && <a href={o.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>↗ source reel @{o.reel.handle || o.reel.reelId}</a>}

                    {/* Bundle Outfits coming in next commit (outfit library). */}
                    {o.status === 'Approved' && (
                      <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip?id=${o.id}`}
                        style={{ display: 'block', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(232,168,120,0.18)', color: '#e8b878', borderRadius: 5, textDecoration: 'none' }}>⬇ ZIP for TJP (still + reel)</a>
                    )}
                    {o.status === 'Approved' && o.reel?.id && (
                      <a href={`/ai-editor?creator=${creatorId}&upload=${o.reel.id}`}
                        style={{ display: 'block', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(106,198,138,0.16)', color: '#6AC68A', borderRadius: 5, textDecoration: 'none' }}>↑ Upload finished video(s)</a>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {o.status !== 'Approved' && <button onClick={() => setOutputStatus(o, 'Approved')} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 700, background: 'rgba(106,198,138,0.18)', color: '#6AC68A', border: 'none', borderRadius: 5, cursor: 'pointer' }}>✓</button>}
                      {o.status !== 'Rejected' && <button onClick={() => setOutputStatus(o, 'Rejected')} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 700, background: 'rgba(232,120,120,0.16)', color: '#E87878', border: 'none', borderRadius: 5, cursor: 'pointer' }}>✕</button>}
                      <a href={o.dropbox || o.image || '#'} target="_blank" rel="noreferrer" style={{ padding: '4px 8px', fontSize: 11, background: 'rgba(120,160,232,0.16)', color: '#8fb4f0', borderRadius: 5, textDecoration: 'none' }}>↗</a>
                      <button onClick={() => deleteOutput(o)} style={{ padding: '4px 8px', fontSize: 11, background: 'none', color: '#888', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer' }}>🗑</button>
                    </div>
                    {o.rejectReason && <div style={{ marginTop: 4, color: '#E87878', fontStyle: 'italic' }}>{o.rejectReason}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
