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

export function OutfitSwapPanel() {
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [outfits, setOutfits] = useState([])
  const [pickedId, setPickedId] = useState('')
  const [freeText, setFreeText] = useState('')
  const [model, setModel] = useState('wan')
  const [file, setFile] = useState(null)
  const [srcPreview, setSrcPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [outputs, setOutputs] = useState([])

  useEffect(() => {
    fetch('/api/admin/recreate-rooms/outfit-swap').then(r => r.json())
      .then(d => setOutfits(d.outfits || [])).catch(() => {})
    fetch('/api/admin/recreate-rooms/stage-b/creators').then(r => r.json()).then(d => {
      setCreators(d.creators || [])
      if (d.creators?.[0]) setCreatorId(d.creators[0].id)
    }).catch(() => {})
  }, [])

  const loadOutputs = useCallback(async () => {
    if (!creatorId) { setOutputs([]); return }
    try { await fetch('/api/admin/recreate-rooms/outfit-swap/resolve', { method: 'POST' }) } catch {}
    try {
      const d = await fetch(`/api/admin/recreate-rooms/outfit-swap?creatorId=${creatorId}`).then(r => r.json())
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

  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const lbl = { fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }

  const onFile = (f) => { setFile(f || null); setSrcPreview(f ? URL.createObjectURL(f) : '') }
  const sel = creators.find(c => c.id === creatorId)

  const setOutputStatus = async (o, status) => {
    let reason
    if (status === 'Rejected') {
      reason = (await uiPrompt('Why is this rejected? (kept as a tuning signal)', { placeholder: 'reason…' })) || ''
    }
    await fetch('/api/admin/recreate-rooms/outfit-swap', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: o.id, status, reason }),
    }).catch(() => {})
    loadOutputs()
  }
  const deleteOutput = async (o) => {
    if (!(await uiConfirm('Delete this outfit swap record?', { danger: true, okLabel: 'Delete' }))) return
    await fetch(`/api/admin/recreate-rooms/outfit-swap?id=${o.id}`, { method: 'DELETE' }).catch(() => {})
    loadOutputs()
  }

  const generate = async () => {
    const outfit = (freeText.trim()) || (outfits.find(o => o.id === pickedId)?.prompt || '')
    if (!file) { setMsg('Upload the upscaled screen-grab first.'); return }
    if (!outfit) { setMsg('Pick an outfit or type your own.'); return }
    setBusy(true); setMsg('⏳ Uploading image…')
    try {
      const path = await stageBUpload(file, 'outfit')
      setMsg('⏳ Submitting…')
      const sub = await fetch('/api/admin/recreate-rooms/outfit-swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDropboxPath: path, outfit, model, creatorId: creatorId || undefined }),
      }).then(r => r.json())
      if (!sub.ok) { setMsg(`❌ ${sub.error || 'submit failed'}`); setBusy(false); return }
      setMsg('✅ Submitted — rendering on WaveSpeed (~1–3 min). The result appears below automatically; no need to wait on this screen.')
      loadOutputs()
      setTimeout(() => document.getElementById('outfit-outputs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
    } catch (e) { setMsg(`❌ ${e?.message || String(e)}`) }
    setBusy(false)
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Outfit Swap</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 16 }}>
        Changes ONLY the clothing on a photo — pose, framing and background stay. Use it when an inspo reel has the right pose but the wrong outfit. Upload an upscaled screen-grab, pick (or type) an outfit, generate, then take the result to TJP for the creator likeness swap.
      </p>

      <div style={card}>
        <div style={lbl}>1 · Creator (so the output ends up in the right gallery)</div>
        <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13, minWidth: 240 }}>
          <option value="">— pick creator —</option>
          {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={card}>
        <div style={lbl}>2 · Upscaled screen-grab</div>
        <input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0] || null)}
          style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
        {srcPreview && <img src={srcPreview} alt="" style={{ display: 'block', marginTop: 10, width: 'min(220px,45vw)', borderRadius: 8 }} />}
      </div>

      <div style={card}>
        <div style={lbl}>3 · Outfit (pick from the closet, or type your own — keep it short)</div>
        <select value={pickedId} onChange={e => { setPickedId(e.target.value); setFreeText('') }}
          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13, minWidth: 240 }}>
          <option value="">— choose an outfit —</option>
          {outfits.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: '10px 0 4px' }}>or type a custom outfit (short — long prompts move the pose):</div>
        <textarea value={freeText} onChange={e => { setFreeText(e.target.value); if (e.target.value) setPickedId('') }} rows={2}
          placeholder="e.g. a fitted black tank top and denim cut-off shorts"
          style={{ width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>

      <div style={card}>
        <div style={lbl}>4 · Generate</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>Model:</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}>
            <option value="wan">Wan 2.7 image-edit-pro (recommended)</option>
            <option value="nano">Nano-Banana 2 (⚠ may hit content filter)</option>
            <option value="gpt">GPT-Image-2 (experimental)</option>
          </select>
          <button onClick={generate} disabled={busy} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: busy ? 'rgba(232,168,120,0.3)' : '#e8a878', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Working…' : '👗 Swap outfit'}
          </button>
        </div>
        {msg && <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 12 }}>{msg}</div>}
      </div>

      {outputs.length > 0 && (
        <div style={card} id="outfit-outputs">
          <div style={lbl}>Outfit swap outputs — {sel?.name || 'creator'} ({outputs.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {outputs.map(o => {
              const sc = o.status === 'Approved' ? '#6AC68A' : o.status === 'Rejected' ? '#E87878' : o.status === 'Failed' ? '#E87878' : o.status === 'Generating' ? '#8fb4f0' : '#e8b878'
              const placeholder = o.status === 'Generating' ? '⏳ rendering on WaveSpeed…' : o.status === 'Failed' ? '✕ failed' : '…'
              return (
                <div key={o.id} style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                  {o.image
                    ? <img src={o.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: sc, textAlign: 'center', padding: 8 }}>{placeholder}</div>}
                  <div style={{ padding: 8, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#ddd', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.outfit || 'Outfit'}</span>
                      <span style={{ color: sc, fontWeight: 700 }}>{o.status}</span>
                    </div>
                    <div style={{ color: 'var(--foreground-muted)', margin: '2px 0' }}>{o.model || 'wan'}</div>
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

export function StageBPanel({ initialCreatorId, initialReelRecordId } = {}) {
  const [data, setData] = useState({ creators: [], rooms: [], variations: [] })
  const [reels, setReels] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [reel, setReel] = useState(null)
  const [poseTime, setPoseTime] = useState(0)
  const [captured, setCaptured] = useState(false)
  const [poseModalOpen, setPoseModalOpen] = useState(false)
  const [poseDuration, setPoseDuration] = useState(0)
  const [stageBOut, setStageBOut] = useState(null)
  const [outputs, setOutputs] = useState([])
  const [genModel, setGenModel] = useState('wan')
  const [extraFiles, setExtraFiles] = useState([])
  const [subjectFile, setSubjectFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [showExtras, setShowExtras] = useState(false)
  const [mode, setMode] = useState('standard') // 'standard' | 'subject'
  const [fanOutFor, setFanOutFor] = useState(null) // Stage B Output id when modal is open
  const [closet, setCloset] = useState([])
  const [pickedOutfits, setPickedOutfits] = useState(new Set())
  const [customOutfits, setCustomOutfits] = useState('')

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
    fetch('/api/admin/recreate-rooms/outfit-swap').then(r => r.json()).then(d => setCloset(d.outfits || [])).catch(() => {})
  }, [initialCreatorId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link from the pool: when the URL names a specific reel and it
  // shows up in the loaded list, preselect it and open the pose modal
  // immediately. One click from the pool to the scrubber.
  useEffect(() => {
    if (!initialReelRecordId || !reels.length) return
    const m = reels.find(r => r.id === initialReelRecordId)
    if (m && !reel) {
      setReel(m)
      setPoseTime(0)
      setCaptured(false)
      if (m.streamUid) setPoseModalOpen(true)
    }
  }, [initialReelRecordId, reels, reel])

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
    if (!(await uiConfirm('Delete this Stage B output record?', { danger: true, okLabel: 'Delete' }))) return
    await fetch(`/api/admin/recreate-rooms/stage-b/outputs?id=${o.id}`, { method: 'DELETE' }).catch(() => {})
    loadOutputs()
  }

  // Fan out N outfit variants from a single Stage B still. Each picked
  // outfit becomes its own Outfit Swap job, linked back to the parent
  // so the bulk ZIP can bundle them automatically.
  const submitFanOut = async () => {
    const closetPicks = closet.filter(o => pickedOutfits.has(o.id)).map(o => o.prompt)
    const customLines = customOutfits.split('\n').map(s => s.trim()).filter(Boolean)
    const outfits = [...closetPicks, ...customLines]
    if (!outfits.length) { await uiAlert('Pick at least one outfit (or type a custom one).'); return }
    if (!fanOutFor) return
    setBusy(true)
    try {
      // Sequential POSTs so each one gets a clean Variant # (the slug
      // helper counts existing siblings — running them in parallel
      // would race and double-assign).
      for (const outfit of outfits) {
        await fetch('/api/admin/recreate-rooms/outfit-swap', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageBOutputId: fanOutFor, outfit, model: 'wan' }),
        }).catch(() => {})
      }
      setMsg(`✅ Queued ${outfits.length} outfit variant${outfits.length === 1 ? '' : 's'} — they'll appear on the card as they finish (~1–3 min each).`)
      setFanOutFor(null)
      setPickedOutfits(new Set())
      setCustomOutfits('')
      loadOutputs()
    } catch (e) { await uiAlert(`Fan-out failed: ${e?.message || String(e)}`) }
    setBusy(false)
  }

  useEffect(() => {
    setPoseDuration(0)
    if (!reel?.streamUid) return
    let cancelled = false
    fetch(`/api/admin/cf-stream/info?uid=${encodeURIComponent(reel.streamUid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.duration) setPoseDuration(d.duration) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [reel])

  useEffect(() => {
    if (!poseModalOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setPoseModalOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poseModalOpen])

  const sel = creators.find(c => c.id === creatorId)
  const myRooms = data.rooms.filter(r => r.creatorId === creatorId)
  // Match the pool's filter: only show reels that haven't already been
  // produced for this creator. Keeps Stage B aligned with the upload
  // flow — no inspo shows up twice once an editor has run it through.
  const availableReels = creatorId
    ? reels.filter(r => !(r.producedFor || []).includes(creatorId))
    : reels

  const generate = async () => {
    if (!creatorId) { setMsg('Pick a creator first.'); return }
    const subjectMode = mode === 'subject'
    if (subjectMode) {
      if (!subjectFile) { setMsg('Upload the finished subject photo first.'); return }
    } else {
      if (!reel?.streamUid) { setMsg('Pick a reel (with Stream video) and capture a frame first.'); return }
      if (!captured) { setMsg('Scrub to the pose and click "Capture this frame".'); return }
    }
    setBusy(true); setStageBOut(null); setMsg('⏳ Uploading…')
    try {
      const refPaths = []
      for (const f of extraFiles) refPaths.push(await stageBUpload(f, 'ref'))
      let subjectDropboxPath
      if (subjectMode) {
        setMsg('⏳ Uploading subject photo…')
        subjectDropboxPath = await stageBUpload(subjectFile, 'subject')
      }
      setMsg(subjectMode
        ? '⏳ Stage B — placing the subject into the room… appears below when done.'
        : '⏳ Stage B — compositing the creator into the room… appears below when done.')
      const res = await fetch('/api/admin/recreate-rooms/stage-b', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, poseStreamUid: reel?.streamUid, poseTime, refDropboxPaths: refPaths, reelRecordId: reel?.id, model: genModel, subjectDropboxPath }),
      })
      const raw = await res.text()
      let d
      try { d = JSON.parse(raw) } catch { d = null }
      const asStr = (v) => typeof v === 'string' ? v
        : v && typeof v === 'object' ? (v.message || v.error || JSON.stringify(v))
        : String(v)
      if (d && d.ok && d.generating) {
        setStageBOut(null)
        setMsg(`✅ Submitted — screenshot read as ${d.screenshotFraming}, matched to "${d.room}" [${d.roomFraming}]. Rendering on WaveSpeed (~3–6 min). It'll appear in Stage B Outputs below automatically — no need to wait on this screen.`)
        loadOutputs()
        setTimeout(() => document.getElementById('stageb-outputs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
      } else if (d && d.ok) {
        setStageBOut({ url: d.out, dropbox: d.dropbox, room: d.room, roomFraming: d.roomFraming, screenshotFraming: d.screenshotFraming, compare: d.compare || null })
        setMsg(`✅ Done — screenshot read as ${d.screenshotFraming}, matched to "${d.room}" [${d.roomFraming}]. Saved to Stage B Outputs.`)
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
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Stage B — Creator into Room</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 14 }}>
        Composites your creator into their virtual room, with the pose &amp; outfit from an inspo reel — using their on-file AI Super Clone refs. Take the still ZIP to TJP for motion control, then bring the final video back to <a href="/ai-editor" style={{ color: 'var(--palm-pink)' }}>AI Recreate Pool</a> to send for review.
      </p>

      <div style={card}>
        <div style={lbl}>1 · Creator</div>
        <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}>
          {creators.length === 0 && <option>No creators with AI refs</option>}
          {creators.map(c => <option key={c.id} value={c.id}>{c.name} — {c.face}F·{c.front}Fr·{c.back}B</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 8 }}>
          {sel ? `${sel.face} face + ${sel.front} front + ${sel.back} back ${sel.approved ? 'approved AI Super Clone refs' : 'raw AI Ref Inputs (approve in Creator Avatar for best results)'}. Room auto-picked: ${myRooms.length === 0 ? `⚠️ no rooms yet — create one in the Rooms tab first` : `${myRooms.length} on file (${myRooms.map(r => r.framing || '?').join(', ')})`}.` : 'Any creator with AI Super Clone refs on file.'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, padding: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => setMode('standard')}
          style={{ flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 600, background: mode === 'standard' ? 'var(--palm-pink)' : 'transparent', color: mode === 'standard' ? '#1a0a0a' : 'var(--foreground-muted)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Standard — start from an inspo reel
        </button>
        <button onClick={() => setMode('subject')}
          style={{ flex: 1, padding: '9px 12px', fontSize: 13, fontWeight: 600, background: mode === 'subject' ? '#e8b878' : 'transparent', color: mode === 'subject' ? '#1a0a0a' : 'var(--foreground-muted)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Subject — already have a TJP photo
        </button>
      </div>

      {mode === 'standard' ? (
        <>
          <div style={card}>
            <div style={lbl}>2 · Pose &amp; outfit — pick a reel, scrub to the pose, capture</div>
            {captured && reel?.streamUid && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: 10, background: 'rgba(106,198,138,0.1)', border: '1px solid rgba(106,198,138,0.35)', borderRadius: 8 }}>
                <img src={buildStreamPosterUrl(reel.streamUid, { time: `${Math.max(0.1, poseTime)}s`, width: 160, fit: 'crop' })} alt=""
                  style={{ width: 70, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 6 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6AC68A' }}>✓ Pose captured @ {poseTime.toFixed(1)}s</div>
                  <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>Scroll down to Generate, or click any reel below to re-pick.</div>
                </div>
                <button onClick={() => setPoseModalOpen(true)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Re-scrub</button>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#888' }}>{availableReels.length} reels available for {sel?.name || 'this creator'} (already-produced ones are hidden). Click to scrub.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
              {availableReels.map(r => {
                const isSel = reel?.id === r.id
                const bd = { borderRadius: 6, cursor: 'pointer', width: '100%', aspectRatio: '9/16', objectFit: 'cover', border: isSel ? '3px solid var(--palm-pink)' : '1px solid rgba(255,255,255,0.1)' }
                const onPick = () => { setReel(r); setPoseTime(0); setCaptured(false); if (r.streamUid) setPoseModalOpen(true) }
                return r.streamUid
                  ? <img key={r.id} src={buildStreamPosterUrl(r.streamUid, { width: 240, fit: 'crop' })} alt="" loading="lazy" onClick={onPick} style={bd} />
                  : r.thumbnail
                    ? <img key={r.id} src={r.thumbnail} alt="" loading="lazy" onClick={onPick} style={bd} />
                    : <video key={r.id} src={`${String(r.video || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')}#t=0.1`} muted preload="metadata" playsInline onClick={onPick} style={bd} />
              })}
            </div>
          </div>

          <div style={card}>
            <button onClick={() => setShowExtras(s => !s)}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
              {showExtras ? '− Hide' : '+ Add'} extra identity reference images for this run (optional)
            </button>
            {showExtras && (
              <div style={{ marginTop: 10 }}>
                <input type="file" accept="image/*" multiple onChange={e => setExtraFiles([...e.target.files])}
                  style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
                {extraFiles.length > 0 && <span style={{ fontSize: 12, color: '#6AC68A', marginLeft: 8 }}>{extraFiles.length} added</span>}
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ ...card, borderStyle: 'dashed', borderColor: 'rgba(232,168,120,0.35)' }}>
          <div style={{ ...lbl, color: '#e8b878' }}>2 · Subject photo (already correct identity + pose + outfit)</div>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 8 }}>
            Stage B keeps this person exactly as they are and only swaps the background to the creator&apos;s room.
          </div>
          <input type="file" accept="image/*" onChange={e => setSubjectFile(e.target.files?.[0] || null)}
            style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
          {subjectFile && <span style={{ fontSize: 12, color: '#e8b878', marginLeft: 8 }}>{subjectFile.name}</span>}
        </div>
      )}

      <div style={card}>
        <div style={lbl}>{mode === 'subject' ? '3 · Generate (subject mode)' : '3 · Generate'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>Model:</label>
          <select value={genModel} onChange={e => setGenModel(e.target.value)}
            style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}>
            <option value="wan">Wan 2.7 image-edit-pro (recommended)</option>
            <option value="nano">Nano-Banana 2 (⚠ may hit content filter)</option>
            <option value="gpt">GPT-Image-2 (experimental)</option>
          </select>
          <button onClick={generate} disabled={busy} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: busy ? 'rgba(232,168,120,0.3)' : '#e8a878', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Working…' : '👤 Generate — insert creator'}
          </button>
        </div>
        {msg && <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 12 }}>{msg}</div>}
      </div>

      {stageBOut && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={lbl}>Result — {sel?.name} in {stageBOut.room} [{stageBOut.roomFraming}] · shot read as {stageBOut.screenshotFraming}</div>
          {stageBOut.compare ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[stageBOut.compare.a, stageBOut.compare.b].map((c, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? '#e8b878' : '#6AC68A' }}>{String.fromCharCode(65 + i)} · {c.label}</div>
                  <img src={c.url} alt={c.label}
                    style={{ width: 'min(340px, 44vw)', aspectRatio: '9/16', objectFit: 'contain', borderRadius: 10, background: '#000', display: 'block' }} />
                  <a href={c.dropbox || c.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: '#8fb4f0', textDecoration: 'none' }}>↗ Open full size</a>
                </div>
              ))}
            </div>
          ) : (
            <>
              <img src={stageBOut.url} alt="Stage B result"
                style={{ width: 'min(360px, 90vw)', aspectRatio: '9/16', objectFit: 'contain', borderRadius: 10, background: '#000', display: 'block' }} />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <a href={stageBOut.dropbox || stageBOut.url} target="_blank" rel="noreferrer"
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: 'none', borderRadius: 6, textDecoration: 'none' }}>↗ Open full size</a>
              </div>
            </>
          )}
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 10 }}>{stageBOut.compare ? 'Both A & B saved as Pending in Stage B Outputs below (tagged 1pass / 2pass).' : 'Saved as Pending in Stage B Outputs below.'}</div>
        </div>
      )}

      {outputs.length > 0 && (
        <div style={{ ...card, marginTop: 16 }} id="stageb-outputs">
          <div style={lbl}>Stage B Outputs — {sel?.name} ({outputs.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {outputs.map(o => {
              const sc = o.status === 'Approved' ? '#6AC68A' : o.status === 'Rejected' ? '#E87878' : o.status === 'Failed' ? '#E87878' : o.status === 'Generating' ? '#8fb4f0' : '#e8b878'
              const placeholder = o.status === 'Generating' ? '⏳ rendering on WaveSpeed…' : o.status === 'Failed' ? '✕ failed' : '…'
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
                    <div style={{ color: 'var(--foreground-muted)', margin: '2px 0' }}>{o.room || '—'}{o.roomFraming ? ` [${o.roomFraming}]` : ''} · shot {o.screenshotFraming || '?'}</div>
                    {o.reel && <a href={o.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>↗ source reel @{o.reel.handle || o.reel.reelId}</a>}

                    {/* Outfit variant strip — shows what's fanned out so far */}
                    {o.variants && o.variants.length > 0 && (
                      <div style={{ marginTop: 6, padding: 6, background: 'rgba(0,0,0,0.25)', borderRadius: 5 }}>
                        <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginBottom: 4 }}>{o.variants.length} outfit variant{o.variants.length === 1 ? '' : 's'}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 3 }}>
                          {o.variants.map(v => {
                            const vc = v.status === 'Approved' ? '#6AC68A' : v.status === 'Rejected' ? '#E87878' : v.status === 'Failed' ? '#E87878' : v.status === 'Generating' ? '#8fb4f0' : '#e8b878'
                            return (
                              <a key={v.id} href={v.dropbox || v.image || '#'} target="_blank" rel="noreferrer" title={`${v.slug || ('O' + v.variantNum)} — ${v.outfit} — ${v.status}`}
                                style={{ display: 'block', position: 'relative', aspectRatio: '9/16', borderRadius: 3, border: `1px solid ${vc}66`, background: '#000', overflow: 'hidden', textDecoration: 'none' }}>
                                {v.image
                                  ? <img src={v.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: vc }}>{v.status === 'Generating' ? '⏳' : v.status === 'Failed' ? '✕' : '…'}</div>}
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Fan-out & ZIP — only meaningful once the still itself has rendered */}
                    {(o.status === 'Pending' || o.status === 'Approved') && (
                      <button onClick={() => { setFanOutFor(o.id); setPickedOutfits(new Set()); setCustomOutfits('') }}
                        style={{ display: 'block', width: '100%', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(232,184,120,0.16)', color: '#e8b878', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                        👗 Fan out outfits
                      </button>
                    )}
                    {o.status === 'Approved' && (
                      <a href={`/api/admin/recreate-rooms/stage-b/outputs/zip?id=${o.id}`}
                        style={{ display: 'block', marginTop: 6, padding: '6px 8px', fontSize: 11, fontWeight: 700, textAlign: 'center', background: 'rgba(232,168,120,0.18)', color: '#e8b878', borderRadius: 5, textDecoration: 'none' }}>⬇ Bulk ZIP for TJP{o.variants?.length ? ` (still + reel + ${o.variants.filter(v => v.status !== 'Rejected' && v.status !== 'Failed' && v.status !== 'Generating').length} outfits)` : ' (still + reel)'}</a>
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

      {fanOutFor && (
        <div onClick={() => setFanOutFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 94vw)', maxHeight: '90vh', overflow: 'auto', background: '#16161c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Fan out outfits</div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 14 }}>
              For <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: '#e8b878' }}>{outputs.find(o => o.id === fanOutFor)?.slug || 'this still'}</span> — each pick becomes one Outfit Swap job (~1–3 min each on WaveSpeed). They&apos;ll show up on the card as they finish.
            </div>

            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>From the Outfit Closet ({pickedOutfits.size} selected)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6, maxHeight: 240, overflowY: 'auto', padding: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>
              {closet.length === 0 && <div style={{ fontSize: 11, color: '#666', padding: 8 }}>No outfit presets yet — add some in the Outfit Closet (admin Rooms tab).</div>}
              {closet.map(o => {
                const picked = pickedOutfits.has(o.id)
                return (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: picked ? 'rgba(232,184,120,0.16)' : 'rgba(255,255,255,0.03)', border: `1px solid ${picked ? '#e8b878' : 'rgba(255,255,255,0.08)'}`, borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked} onChange={() => setPickedOutfits(s => { const n = new Set(s); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n })} />
                    <span style={{ color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                  </label>
                )
              })}
            </div>

            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 14, marginBottom: 6 }}>Or type custom outfits — one per line</div>
            <textarea value={customOutfits} onChange={e => setCustomOutfits(e.target.value)} rows={3}
              placeholder={"a fitted black tank top and denim cut-off shorts\nan emerald-green silk slip dress"}
              style={{ width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button onClick={() => setFanOutFor(null)}
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.07)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitFanOut} disabled={busy}
                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700, background: busy ? 'rgba(232,184,120,0.4)' : '#e8b878', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Submitting…' : `Generate ${pickedOutfits.size + customOutfits.split('\n').map(s => s.trim()).filter(Boolean).length} variants`}
              </button>
            </div>
          </div>
        </div>
      )}

      {poseModalOpen && reel?.streamUid && (
        <div onClick={() => setPoseModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: 'min(440px, 92vw)' }}>
            <div style={{ fontSize: 13, color: '#bbb', alignSelf: 'flex-start' }}>Scrub to the exact pose &amp; outfit — this is the frame fed to the model.</div>
            <img src={buildStreamPosterUrl(reel.streamUid, { time: `${Math.max(0.1, poseTime)}s`, width: 720, fit: 'crop' })} alt=""
              style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 10, background: '#000' }} />
            <input type="range" min={0} max={poseDuration ? poseDuration.toFixed(2) : 30} step={0.05} value={Math.min(poseTime, poseDuration || 30)}
              onChange={e => { setPoseTime(Number(e.target.value)); setCaptured(false) }}
              style={{ width: '100%' }} />
            <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600 }}>Frame @ {poseTime.toFixed(1)}s{poseDuration ? ` / ${poseDuration.toFixed(1)}s` : ''}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setCaptured(true); setPoseModalOpen(false); setMsg(`Pose captured @ ${poseTime.toFixed(1)}s`) }}
                style={{ padding: '10px 22px', fontSize: 14, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: 'pointer' }}>📸 Capture this frame</button>
              <button onClick={() => setPoseModalOpen(false)} style={{ padding: '10px 16px', fontSize: 13, background: 'none', color: '#888', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, cursor: 'pointer' }}>Close ✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
