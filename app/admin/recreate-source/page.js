'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { buildStreamIframeUrl, buildStreamPosterUrl } from '@/lib/cfStreamUrl'

const STATUS_COLORS = { Queued: '#888', Scraping: '#E8C36A', Ready: '#6AC68A', Error: '#E87878' }

function LibraryReel({ reel, onRemove }) {
  const [playing, setPlaying] = useState(false)
  // Prefer Cloudflare Stream: a CDN poster image loads instantly (fast to
  // sift), click plays the Stream player. Reels not yet mirrored fall
  // back to the Dropbox video first-frame.
  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '9/16' }}>
      {playing && reel.streamUid ? (
        <iframe
          src={buildStreamIframeUrl(reel.streamUid, { autoplay: true, muted: false, loop: true, controls: true })}
          allow="autoplay; fullscreen"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      ) : playing && reel.video ? (
        // User-gesture play → autoPlay WITHOUT muted, so it just plays
        // with sound. No reliance on the native overflow ⋮ menu.
        <video
          src={reel.video}
          autoPlay
          controls
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
        />
      ) : (reel.streamUid || reel.video) ? (
        <div onClick={() => setPlaying(true)} style={{ width: '100%', height: '100%', cursor: 'pointer' }}>
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
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, paddingLeft: 3 }}>▶</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: 11 }}>processing…</div>
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
  const [posterBusy, setPosterBusy] = useState(false)
  // Tab persists in the URL (?tab=rooms) so a refresh stays put.
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = sp.get('tab') === 'rooms' ? 'rooms' : 'library'
  const setTab = (k) => {
    const params = new URLSearchParams(sp.toString())
    if (k === 'rooms') params.set('tab', 'rooms'); else params.delete('tab')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

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

  // (Removed the auto-resume watchdog: it stacked concurrent force-
  // resumes → runaway duplicate runs. Re-scrape is manual; the callback
  // upsert makes a re-scrape idempotent so it can't dupe.)

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

  // Manual single re-scrape of one account (works for Ready/Error rows
  // too — `recordIds` selects regardless of status). Upsert dedup makes
  // this 100% safe to click: it resumes/fills gaps, never duplicates.
  const reScrape = async (s) => {
    setBusy(true); setMsg(`Re-scraping @${s.handle}…`)
    try {
      const res = await fetch('/api/admin/recreate-scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: [s.id] }),
      })
      const data = await res.json()
      setMsg(res.ok ? `Re-scrape started for @${s.handle}` : (data.error || 'Failed'))
      load()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const backfillPosters = async () => {
    setPosterBusy(true); setMsg('Optimizing (Cloudflare + posters)…')
    try {
      let guard = 0
      while (guard++ < 80) {
        const res = await fetch('/api/admin/recreate-backfill-posters', { method: 'POST' })
        const d = await res.json()
        if (!res.ok) { setMsg(d.error || 'Optimize failed'); break }
        setMsg(`Optimizing: ${d.remaining} reels remaining…`)
        if (d.done || d.remaining === 0) { setMsg('Library optimized — Cloudflare + posters done.'); break }
      }
      load()
    } catch (e) { setMsg(e.message) } finally { setPosterBusy(false) }
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

  if (tab === 'rooms') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <TabBar tab={tab} setTab={setTab} />
        <RoomsPanel />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <TabBar tab={tab} setTab={setTab} />
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
            {/* Live count of THIS handle's reels actually in the library —
                the source's per-run stored/found counter is stale and
                confusing (it reflects only the last run, pre-dedup). */}
            <span style={{ color: 'var(--foreground-muted)', fontSize: 10 }}>
              {reels.filter(r => (r.handle || '').toLowerCase() === (s.handle || '').toLowerCase()).length} in library
            </span>
            {s.status !== 'Scraping' && (
              <button onClick={() => reScrape(s)} disabled={busy} title="Re-scrape this account (safe — upsert dedup, never duplicates)"
                style={{ background: 'rgba(106,198,138,0.12)', border: '1px solid rgba(106,198,138,0.35)', color: '#6AC68A', cursor: busy ? 'default' : 'pointer', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                ↻ Re-scrape
              </button>
            )}
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
          <button onClick={backfillPosters} disabled={posterBusy}
            style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.05)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: posterBusy ? 'default' : 'pointer' }}>
            {posterBusy ? 'Optimizing…' : 'Optimize (Cloudflare)'}
          </button>
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

// ─── Rooms tab ────────────────────────────────────────────────────────────

function TabBar({ tab, setTab }) {
  const t = (k, label) => (
    <button onClick={() => setTab(k)} style={{
      padding: '6px 16px', fontSize: 13, fontWeight: tab === k ? 700 : 500,
      color: tab === k ? '#1a0a0a' : 'var(--foreground-muted)',
      background: tab === k ? 'var(--palm-pink)' : 'transparent',
      border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, cursor: 'pointer',
    }}>{label}</button>
  )
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
      {t('library', 'Reel Library')}
      {t('rooms', 'Rooms')}
    </div>
  )
}

// Built-in variation recipes — each is a small additive change clause.
const RECIPES = [
  { name: 'Clean / midday', change: 'the room is spotless and freshly tidied, bed neatly made with smooth bedding, nothing on the floor, bright clean midday light' },
  { name: 'Lightly lived-in', change: 'gently lived-in — bed loosely made, a throw casually bunched, a phone and a glass of water on the nightstand, a cardigan on the corner of the bed' },
  { name: 'Messy', change: 'the bed is unmade with the duvet pulled back and pillows tossed, a small pile of clothes and a hoodie on the floor near the bed' },
  { name: 'Super messy', change: 'genuinely messy — clothes scattered on the bed and floor, an overflowing laundry basket, a towel tossed down, cups on the nightstand, shoes kicked off' },
  { name: 'Clothes on floor', change: 'a casual pile of clothes and one hoodie on the floor near the foot of the bed and a tote bag leaning against the dresser, light realistic amount' },
  { name: 'Golden hour', change: 'warm golden-hour sunset light through the windows with long soft shadows and an orange-pink sky' },
  { name: 'Early morning', change: 'soft cool early-morning light, dim and calm, lamps off, bed slept-in and unmade' },
  { name: 'Night / lamps', change: 'nighttime — dark outside with distant lights through the windows, the warm bedside lamp and fairy lights on, a lit candle' },
  { name: 'Overcast', change: 'flat soft grey overcast daylight, cozy and moody, no harsh sun' },
  { name: 'Packing day', change: 'an open suitcase on the bed half-packed with folded clothes, a couple of outfits laid beside it, shoes on the rug, bright afternoon light' },
]

// Independent everyday-life axes. A "shuffle" picks one option per axis
// and composes them into one believable scenario — so cleanliness,
// clutter, time of day, nightstand etc. vary independently (messy bed +
// clean floor, made bed + clothes everywhere, etc.).
const AXES = {
  bed: [
    'the bed neatly made and crisp',
    'the bed loosely made, slightly rumpled',
    'the bed half-made — one side pulled up, the other still turned down',
    'the bed unmade with the duvet pulled back and a pillow askew',
    'the bed messy — sheets and blanket twisted, pillows tossed around',
    'the comforter dragged halfway off onto the floor, bed clearly slept in',
  ],
  floor: [
    'the floor completely clear',
    'one or two clothing items dropped on the floor',
    'a small pile of clothes and a hoodie on the floor',
    'a pair of shoes kicked off near the bed',
    'a towel dropped on the floor and a tote bag',
    'a rolled-out yoga mat on the floor',
    'a duffel/gym bag sitting on the floor',
    'a lot of clothes scattered across the floor, genuinely messy',
  ],
  bed_items: [
    'nothing on the bed',
    'a knit throw blanket bunched at the foot of the bed',
    'a small stack of folded laundry on the bed',
    'a couple of worn clothing items tossed on the bed',
    'a towel laid across the end of the bed',
    'an open half-packed suitcase on the bed',
    'a couple of pillows pushed off to one side',
  ],
  nightstand: [
    'the nightstand clear apart from its usual lamp',
    'a glass of water beside the lamp on the nightstand',
    'a phone and a glass of water on the nightstand',
    'a mug and a couple of skincare bottles on the nightstand',
    'a candle and a charging cable on the nightstand',
    'a book and reading glasses on the nightstand',
    'a few hair ties, a scrunchie and lip balm on the nightstand',
    'a water bottle and wireless earbuds on the nightstand',
    'a small ring dish with jewelry on the nightstand',
  ],
  time_light: [
    'bright sunny midday light through the windows',
    'harsh high-noon sun with strong defined shadows',
    'soft sunny late-morning light',
    'hazy bright afternoon light',
    'warm late-afternoon light coming in low',
    'warm golden-hour sunset light with long soft shadows and an orange sky',
    'soft cool early-morning light, calm and dim',
    'flat grey overcast daylight, soft and even, no harsh sun',
    'blue-hour dusk outside with the warm bedside lamp just switched on',
    'nighttime — dark outside with distant city lights, warm bedside lamp glow',
  ],
}
const pick = (a) => a[Math.floor(Math.random() * a.length)]
function shuffleScenarios(n) {
  const seen = new Set()
  const out = []
  let guard = 0
  while (out.length < n && guard++ < n * 12) {
    const c = {
      bed: pick(AXES.bed), floor: pick(AXES.floor), bed_items: pick(AXES.bed_items),
      nightstand: pick(AXES.nightstand), time_light: pick(AXES.time_light),
    }
    const sig = Object.values(c).join('|')
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push({
      name: `Shuffle ${out.length + 1}`,
      change: `an ordinary everyday state of the same room: ${c.bed}; ${c.floor}; ${c.bed_items}; ${c.nightstand}; ${c.time_light}. Natural and realistic, like a random real day — not staged.`,
    })
  }
  return out
}

// Downscale + JPEG re-encode a File → base64 (keeps payload under the
// serverless body limit, same as the room-create path).
function downscaleImage(file, MAX = 1536) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onerror = rej
    fr.onload = () => {
      const img = new Image()
      img.onerror = rej
      img.onload = () => {
        let { width: w, height: h } = img
        if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s) }
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        res(c.toDataURL('image/jpeg', 0.9).split(',')[1])
      }
      img.src = fr.result
    }
    fr.readAsDataURL(file)
  })
}

function RoomCard({ room, variations, refresh }) {
  const [lock, setLock] = useState(room.lockInventory)
  // Re-sync the textarea when the saved lock list changes (e.g. after
  // auto-analyze on create / a parent reload). useState only seeds once,
  // so without this the box keeps showing the stale initial value.
  useEffect(() => { setLock(room.lockInventory) }, [room.id, room.lockInventory])
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [custom, setCustom] = useState('')
  const [shuffleN, setShuffleN] = useState(6)
  const [msg, setMsg] = useState('')

  const api = async (method, body, qs = '') => {
    const r = await fetch(`/api/admin/recreate-rooms${qs}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return r.json()
  }

  const toggle = (n) => setPicked(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s })

  const doLock = async () => {
    setBusy(true); setMsg('Locking…')
    await api('PATCH', { roomId: room.id, action: 'lock', lockInventory: lock })
    setMsg(''); setBusy(false); refresh()
  }
  const regen = async () => {
    setBusy(true); setMsg('Regenerating base…')
    const d = await api('PATCH', { roomId: room.id, action: 'regenerate' })
    setMsg(d.ok ? '' : (d.error || 'failed')); setBusy(false); refresh()
  }
  const reAnalyze = async () => {
    setBusy(true); setMsg('Analyzing room with Sonnet…')
    const d = await fetch('/api/admin/recreate-rooms/analyze-lock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id }),
    }).then(r => r.json()).catch(() => ({}))
    if (d.ok) { setLock(d.lockList); setMsg('Lock list rebuilt from the image.') }
    else setMsg(d.error || 'analyze failed')
    setBusy(false)
  }
  const del = async () => {
    if (!confirm(`Delete room "${room.name}" and its variations?`)) return
    await api('DELETE', null, `?roomId=${room.id}`); refresh()
  }
  const generate = async () => {
    const recipes = RECIPES.filter(r => picked.has(r.name))
    if (custom.trim()) recipes.push({ name: 'Custom', change: custom.trim() })
    if (recipes.length === 0) { setMsg('Pick at least one recipe'); return }
    setBusy(true); setMsg(`Generating ${recipes.length}…`)
    const d = await fetch('/api/admin/recreate-rooms/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, recipes }),
    }).then(r => r.json())
    setMsg(d.ok ? `Made ${d.made?.length || 0}${d.failed?.length ? `, ${d.failed.length} failed` : ''}` : (d.error || 'failed'))
    setBusy(false); setPicked(new Set()); setCustom(''); refresh()
  }
  const doShuffle = async () => {
    const n = Math.min(Math.max(1, Number(shuffleN) || 6), 6)
    const recipes = shuffleScenarios(n)
    setBusy(true); setMsg(`Shuffling ${n} realistic variations…`)
    const d = await fetch('/api/admin/recreate-rooms/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, recipes }),
    }).then(r => r.json())
    setMsg(d.ok ? `Made ${d.made?.length || 0}${d.failed?.length ? `, ${d.failed.length} failed` : ''}` : (d.error || 'failed'))
    setBusy(false); refresh()
  }
  const replaceBase = async (f) => {
    if (!f) return
    setBusy(true); setMsg('Replacing base image…')
    try {
      const imageBase64 = await downscaleImage(f)
      const d = await api('PATCH', { roomId: room.id, action: 'replaceImage', imageBase64, imageType: 'image/jpeg' })
      setMsg(d.ok ? 'Base image replaced — re-analyze + re-lock it.' : (d.error || 'failed'))
    } catch (e) { setMsg(`Error: ${e.message || e}`) }
    setBusy(false); refresh()
  }
  const setVar = async (id, status) => {
    await fetch(`/api/admin/recreate-rooms/variation?id=${id}&status=${status}`, { method: 'PATCH' })
    refresh()
  }
  const delVar = async (id) => {
    await fetch(`/api/admin/recreate-rooms/variation?id=${id}`, { method: 'DELETE' })
    refresh()
  }

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 16, marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ width: 150, flexShrink: 0 }}>
          {room.baseImage
            ? <img src={room.baseImage} alt="" style={{ width: '100%', borderRadius: 8, aspectRatio: '9/16', objectFit: 'cover' }} />
            : <div style={{ width: '100%', aspectRatio: '9/16', background: '#000', borderRadius: 8 }} />}
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, color: room.status === 'Locked' ? '#6AC68A' : '#888' }}>{room.status}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ color: 'var(--foreground)', fontSize: 14 }}>{room.name} <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}>· {room.angle}</span></strong>
            <button onClick={del} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 4px' }}>Do-not-change lock list</div>
          <textarea value={lock} onChange={e => setLock(e.target.value)} rows={4}
            style={{ width: '100%', padding: 8, background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 11, fontFamily: 'inherit', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={reAnalyze} disabled={busy} title="Have Sonnet rewrite the lock list from this exact image"
              style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(120,160,232,0.12)', color: '#8fb4f0', border: '1px solid rgba(120,160,232,0.35)', borderRadius: 5, cursor: 'pointer' }}>✨ Re-analyze (Sonnet)</button>
            {room.basePrompt?.trim() && (
              <button onClick={regen} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, background: 'none', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer' }}>↻ Regenerate base</button>
            )}
            <label style={{ padding: '6px 12px', fontSize: 12, background: 'none', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, cursor: 'pointer' }}>
              ⤒ Replace image
              <input type="file" accept="image/*" onChange={e => replaceBase(e.target.files?.[0])} style={{ display: 'none' }} />
            </label>
            <button onClick={doLock} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 5, cursor: 'pointer' }}>{room.status === 'Locked' ? 'Save lock list' : 'Lock room'}</button>
          </div>
        </div>
      </div>

      {room.status === 'Locked' && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 8 }}>
            Generate variations — random realistic mixes of bed state, clothes, nightstand, time of day &amp; light. The room stays locked.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <button onClick={doShuffle} disabled={busy} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Working…' : '🎲 Shuffle & generate'}
            </button>
            <label style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
              count{' '}
              <input type="number" min={1} max={6} value={shuffleN} onChange={e => setShuffleN(e.target.value)}
                style={{ width: 48, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, fontSize: 12 }} />
              {' '}/ 6 per run
            </label>
            {msg && <span style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>{msg}</span>}
          </div>

          <details style={{ marginBottom: 4 }}>
            <summary style={{ fontSize: 11, color: 'var(--foreground-muted)', cursor: 'pointer' }}>or pick specific recipes / a custom change</summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {RECIPES.map(r => (
                <button key={r.name} onClick={() => toggle(r.name)} style={{
                  padding: '4px 10px', fontSize: 11, borderRadius: 14, cursor: 'pointer',
                  background: picked.has(r.name) ? 'rgba(106,198,138,0.18)' : 'rgba(255,255,255,0.04)',
                  color: picked.has(r.name) ? '#6AC68A' : 'var(--foreground-muted)',
                  border: `1px solid ${picked.has(r.name) ? 'rgba(106,198,138,0.4)' : 'rgba(255,255,255,0.1)'}`,
                }}>{r.name}</button>
              ))}
            </div>
            <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="+ custom change (optional)"
              style={{ width: '100%', marginTop: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12 }} />
            <button onClick={generate} disabled={busy} style={{ marginTop: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer' }}>
              {busy ? 'Working…' : `Generate selected ${picked.size + (custom.trim() ? 1 : 0) || ''}`}
            </button>
          </details>

          {variations.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginTop: 14 }}>
              {variations.map(v => (
                <div key={v.id} style={{ border: `1px solid ${v.status === 'Approved' ? 'rgba(106,198,138,0.5)' : v.status === 'Rejected' ? 'rgba(232,120,120,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, overflow: 'hidden' }}>
                  {v.image && <img src={v.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover' }} />}
                  <div style={{ fontSize: 10, color: 'var(--foreground-muted)', padding: '4px 6px' }}>{v.recipe} · {v.status}</div>
                  <div style={{ display: 'flex', gap: 2, padding: '0 4px 4px' }}>
                    <button onClick={() => setVar(v.id, 'Approved')} title="Approve" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'rgba(106,198,138,0.15)', color: '#6AC68A', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓</button>
                    <button onClick={() => setVar(v.id, 'Rejected')} title="Reject" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'rgba(232,120,120,0.12)', color: '#E87878', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
                    <a href={v.dropbox || v.image || '#'} target="_blank" rel="noopener noreferrer" title={v.dropbox ? 'Download full-res master (Dropbox)' : 'Open image'} style={{ flex: 1, textAlign: 'center', fontSize: 11, padding: '3px 0', background: 'rgba(120,160,232,0.12)', color: '#8fb4f0', borderRadius: 4, textDecoration: 'none' }}>⬇</a>
                    <button onClick={() => delVar(v.id)} title="Delete" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'none', color: '#666', border: 'none', borderRadius: 4, cursor: 'pointer' }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RoomsPanel() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [data, setData] = useState(null)
  // Selected creator persists in the URL (?creator=rec…) too.
  const creatorId = sp.get('creator') || ''
  const setCreatorId = (id) => {
    const params = new URLSearchParams(sp.toString())
    params.set('tab', 'rooms')
    if (id) params.set('creator', id); else params.delete('creator')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }
  const [form, setForm] = useState({ name: '', angle: 'Main', prompt: '' })
  const [mode, setMode] = useState('upload')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Downscale to <=1536px and re-encode JPEG before upload. A 4k base64
  // blows the serverless request-body limit (the upload silently never
  // reaches the API); the edit model doesn't need >1536px anyway.
  const fileToB64 = (f) => new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onerror = rej
    fr.onload = () => {
      const img = new Image()
      img.onerror = rej
      img.onload = () => {
        const MAX = 1536
        let { width: w, height: h } = img
        if (w > MAX || h > MAX) {
          const s = MAX / Math.max(w, h)
          w = Math.round(w * s); h = Math.round(h * s)
        }
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        res(c.toDataURL('image/jpeg', 0.9).split(',')[1])
      }
      img.src = fr.result
    }
    fr.readAsDataURL(f)
  })

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/recreate-rooms').then(r => r.json())
    setData(d)
    if (!creatorId && d.creators?.[0]) setCreatorId(d.creators[0].id)
  }, [creatorId])
  useEffect(() => { load() }, [load])

  const createRoom = async () => {
    if (!creatorId || !form.name.trim()) { setMsg('Creator and room name required'); return }
    let body = { creatorId, roomName: form.name, angle: form.angle }
    try {
      if (mode === 'upload') {
        if (!file) { setMsg('Choose an image to upload'); return }
        setBusy(true); setMsg('Processing image…')
        body.imageBase64 = await fileToB64(file)   // downscaled JPEG
        body.imageType = 'image/jpeg'
      } else {
        if (!form.prompt.trim()) { setMsg('Enter a base prompt'); return }
        setBusy(true); setMsg('Generating base room (~30s)…')
        body.basePrompt = form.prompt
      }
      const res = await fetch('/api/admin/recreate-rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      let d
      try { d = await res.json() } catch { d = { error: `HTTP ${res.status}` } }
      if (!res.ok || !d.ok) { setMsg(d.error || `Failed (HTTP ${res.status})`); return }
      setForm({ name: '', angle: 'Main', prompt: '' }); setFile(null)
      // Auto-analyze the new room with Sonnet → image-specific lock list.
      if (d.roomId) {
        setMsg('Base saved. Analyzing the room with Sonnet (~10s)…')
        const a = await fetch('/api/admin/recreate-rooms/analyze-lock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: d.roomId }),
        }).then(r => r.json()).catch(() => ({}))
        setMsg(a.ok ? 'Room analyzed — review the lock list & lock it below.' : 'Base saved — review & lock it below (auto lock-list unavailable).')
      } else {
        setMsg('Base saved — review & lock it below.')
      }
      load()
    } catch (e) {
      setMsg(`Error: ${e.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div style={{ padding: 40, color: '#666', fontSize: 13 }}>Loading…</div>

  const rooms = (data.rooms || []).filter(r => r.creatorId === creatorId)
  const varsByRoom = {}
  for (const v of data.variations || []) (varsByRoom[v.roomId] = varsByRoom[v.roomId] || []).push(v)

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Rooms</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 16 }}>
        Per-creator locked location plates. Generate a base room once, lock it, then batch realistic variations off that exact room.
      </p>

      <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
        style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        {(data.creators || []).length === 0 && <option>No TJP creators</option>}
        {(data.creators || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>New base room</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Room name (e.g. Amelia Bedroom)"
            style={{ flex: 1, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 13 }} />
          <input value={form.angle} onChange={e => setForm(f => ({ ...f, angle: e.target.value }))} placeholder="Angle" style={{ width: 110, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 13 }} />
        </div>
        {mode === 'upload' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-block', padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, cursor: 'pointer' }}>
                {file ? 'Change image' : 'Choose room image…'}
                <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: 12, color: file ? '#6AC68A' : 'var(--foreground-muted)' }}>
                {file ? file.name : 'No image selected'}
              </span>
            </div>
            <button onClick={() => setMode('prompt')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 0, marginTop: 8, color: 'var(--foreground-muted)', textDecoration: 'underline' }}>
              or generate the room from a text prompt instead
            </button>
          </>
        ) : (
          <>
            <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} rows={4}
              placeholder="Base room prompt (the locked location — paste your dialed-in bedroom prompt)"
              style={{ width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
            <button onClick={() => setMode('upload')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 0, marginTop: 6, color: 'var(--foreground-muted)', textDecoration: 'underline' }}>
              ← upload an image I already have instead
            </button>
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <button onClick={createRoom} disabled={busy || (mode === 'upload' && !file)} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, cursor: (busy || (mode === 'upload' && !file)) ? 'default' : 'pointer', opacity: (busy || (mode === 'upload' && !file)) ? 0.45 : 1 }}>
            {busy ? 'Working…' : mode === 'upload' ? 'Add room from image' : 'Generate base room'}
          </button>
        </div>
        {msg && <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 8 }}>{msg}</div>}
      </div>

      {rooms.length === 0
        ? <div style={{ padding: 30, textAlign: 'center', color: '#666', fontSize: 13 }}>No rooms for this creator yet.</div>
        : rooms.map(r => <RoomCard key={r.id} room={r} variations={varsByRoom[r.id] || []} refresh={load} />)}
    </div>
  )
}
