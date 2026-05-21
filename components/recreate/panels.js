'use client'

// Shared Recreate panels — used by /admin/recreate-source (admin power
// view) AND /ai-editor/recreate (scoped editor view). The panels are
// self-contained and identical in both surfaces; admin pages that need
// their own modals must import { uiConfirm, uiPrompt, uiAlert, ModalHost }
// from here so they share the SAME singleton listener list as the
// extracted panels (single ModalHost instance per page).

import { useEffect, useState, useCallback } from 'react'
import { buildStreamPosterUrl } from '@/lib/cfStreamUrl'

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
    if (!subjectFile) { setMsg('⚠️ Upload the TJP image-to-image photo (step 5).'); return }
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

  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const lbl = { fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }

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
        <div style={lbl}>1 · Creator</div>
        <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}>
          {creators.length === 0 && <option>No creators with AI refs</option>}
          {creators.map(c => <option key={c.id} value={c.id}>{c.name} — {c.face}F·{c.front}Fr·{c.back}B</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 8 }}>
          {sel ? (
            myRooms.length === 0
              ? `⚠️ ${sel.name} has no saved rooms yet — an admin needs to create one in the Rooms tab before you can generate scenes for her.`
              : `${sel.name} has ${myRooms.length} room${myRooms.length === 1 ? '' : 's'} on file (${myRooms.map(r => r.framing || '?').join(', ')}). The portal will auto-pick the one whose framing matches your uploaded photo.`
          ) : 'Pick a creator to see her saved rooms.'}
        </div>
      </div>

      <div style={card}>
        <div style={lbl}>2 · Pick the inspo reel this scene goes with</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          {reel?.id
            ? <>Selected: <span style={{ color: '#e8b878' }}>@{reel.handle || reel.reelId}</span>. Click another to change.</>
            : <>{availableReels.length} reels available for {sel?.name || 'this creator'} (already-produced ones are hidden). Click one to mark it as this scene's source.</>}
        </div>
        <div id="tour-stageb-reels" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
          {availableReels.map(r => {
            const isSel = reel?.id === r.id
            const bd = { borderRadius: 6, cursor: 'pointer', width: '100%', aspectRatio: '9/16', objectFit: 'cover', border: isSel ? '3px solid var(--palm-pink)' : '1px solid rgba(255,255,255,0.1)' }
            const onPick = () => setReel(r)
            return r.streamUid
              ? <img key={r.id} src={buildStreamPosterUrl(r.streamUid, { width: 240, fit: 'crop' })} alt="" loading="lazy" onClick={onPick} style={bd} />
              : r.thumbnail
                ? <img key={r.id} src={r.thumbnail} alt="" loading="lazy" onClick={onPick} style={bd} />
                : <video key={r.id} src={`${String(r.video || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')}#t=0.1`} muted preload="metadata" playsInline onClick={onPick} style={bd} />
          })}
        </div>
      </div>

      <div style={card}>
        <div style={lbl}>3 · Raw screenshot (optional, for organization)</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 8 }}>
          The screenshot you grabbed from the inspo reel in TJP, before any other editing. Kept on the project record so you can find it later.
        </div>
        <input type="file" accept="image/*" onChange={e => setRawScreenshotFile(e.target.files?.[0] || null)}
          style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
        {rawScreenshotFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <img src={URL.createObjectURL(rawScreenshotFile)} alt="" style={{ width: 56, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 6, background: '#000' }} />
            <span style={{ fontSize: 12, color: '#6AC68A' }}>✓ {rawScreenshotFile.name}</span>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={lbl}>4 · Upscaled screenshot (optional, for organization)</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 8 }}>
          The TJP-upscaled version of that screenshot. Also just for organization — useful if you want to re-use it later for a different scene.
        </div>
        <input type="file" accept="image/*" onChange={e => setUpscaledScreenshotFile(e.target.files?.[0] || null)}
          style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
        {upscaledScreenshotFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <img src={URL.createObjectURL(upscaledScreenshotFile)} alt="" style={{ width: 56, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 6, background: '#000' }} />
            <span style={{ fontSize: 12, color: '#6AC68A' }}>✓ {upscaledScreenshotFile.name}</span>
          </div>
        )}
      </div>

      <div id="tour-stageb-subject" style={{ ...card, border: '1px solid rgba(232,168,120,0.35)' }}>
        <div style={{ ...lbl, color: '#e8b878' }}>5 · TJP image-to-image output (required)</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 8 }}>
          The TJP photo of your creator in the reel&apos;s pose &amp; outfit (still in the reel&apos;s original environment). The portal keeps her exactly as-is and just swaps the background to her saved room.
        </div>
        <input type="file" accept="image/*" onChange={e => setSubjectFile(e.target.files?.[0] || null)}
          style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
        {subjectFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <img src={URL.createObjectURL(subjectFile)} alt="" style={{ width: 70, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 6, background: '#000' }} />
            <span style={{ fontSize: 12, color: '#6AC68A' }}>✓ {subjectFile.name}</span>
          </div>
        )}
      </div>

      <div id="tour-stageb-generate" style={card}>
        <div style={lbl}>6 · Generate the scene</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 10 }}>
          Swaps {sel?.name || 'the creator'}&apos;s background for her saved room and relights her to match. Takes ~3–6 minutes — you can navigate away, the result lands in Scenes below when it&apos;s done.
        </div>
        <button onClick={generate} disabled={busy} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: busy ? 'rgba(232,168,120,0.3)' : '#e8a878', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Working…' : '🪄 Generate scene'}
        </button>
        {msg && <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 12 }}>{msg}</div>}
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
