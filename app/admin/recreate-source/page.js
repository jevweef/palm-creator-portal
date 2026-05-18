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
    'one or two clothing items dropped on the BARE porcelain tile floor, off the rug',
    'a small folded stack of laundry sitting directly on the bare tile floor away from the rug',
    'a pair of shoes kicked off on the bare tile near the left wall and a top draped over the nightstand',
    'a towel and a tote bag tipped over on the bare porcelain floor between the rug and the camera',
    'a single yoga mat unrolled flat on the bare porcelain floor (NOT on the rug), with two yoga blocks, a folded towel and a water bottle next to it',
    'a duffel/gym bag open on the bare tile floor with a couple of clothes spilling out onto the tile',
    'a couple of clothing pieces strewn across the bare floor and one trailing onto the rug, like clothes were tried on',
  ],
  // Right at the camera — so close it is only partly in frame.
  foreground: [
    'an item in the immediate foreground so close to the camera it is partially cropped — only the top of a laundry basket visible at the bottom edge',
    'the corner of a tote bag or duffel intruding into the very foreground, cut off by the bottom of the frame',
    'a stack of folded clothes right at the camera in the foreground, only the top of the pile in frame',
    'a pair of shoes and a dropped sweater in the extreme foreground, partially out of frame at the bottom',
  ],
  // The shag rug is transient surface — it gets walked on.
  rug: [
    'the shag rug pile pushed around and a little uneven, with faint footprint impressions, clearly walked on (same rug, same size and place)',
    'one corner of the shag rug slightly flipped/folded over from being walked on (same rug, same size and place)',
    'the rug pile raked in soft directional lines like it was just walked across (same rug, same size and place)',
  ],
  // Vines re-drape after watering / being nudged.
  plants: [
    'the trailing vine plants on the left hanging and draping noticeably differently, a few tendrils repositioned as if just watered and nudged (same plants, same pots, same spots)',
    'the long pothos vines swept to one side and a little longer/looser than before, like they were tidied after watering (same plants, same pots, same spots)',
  ],
  // Clutter that lives AWAY from the bed/nightstand zone — foreground
  // near the camera, by the sliding doors/windows, against the dresser
  // or mirror, in a back corner. Split by how often it's realistically
  // there: everyday churn vs. occasional (trips, hauls, deliveries).
  elsewhere_everyday: [
    'a worn jacket and a couple of clothing items draped over the foot of the bed and onto the floor',
    'a hoodie and a t-shirt dropped on the floor near the foot of the bed',
    'a pair of sneakers and some sandals kicked off in the foreground close to the camera',
    'a bath towel dropped on the floor and a gym towel draped over the mirror',
    'a tote bag and a small purse set down on the floor by the dresser',
    'a backpack slumped against the wall in the foreground with a jacket beside it',
    'a couple of water bottles and a coffee mug left on top of the dresser',
    'a half-full laundry basket on the floor in a back corner',
    'a folded pile of clean laundry on the floor by the dresser waiting to be put away',
    'a cluster of skincare and makeup bottles spread across the top of the dresser',
    'a small stack of books and a magazine on the floor near the nightstand',
    'a hair straightener and a hair dryer with their cords out on the dresser',
    'earbuds, a charging cable and sunglasses left on top of the dresser',
    'keys, a wallet and sunglasses dropped on the dresser like a pocket dump',
    'a reusable grocery bag with a couple of items left on the floor by the doors',
    'a robe and a sweatshirt draped over the leaning mirror',
    'a rolled yoga mat propped against the wall by the windows with small dumbbells beside it',
    'scattered clothes across the foreground floor closer to the camera reaching onto the rug',
  ],
  elsewhere_occasional: [
    'an open carry-on suitcase on the floor half-packed with folded clothes, like a trip is coming up',
    'a weekender duffel and a tote standing by the sliding doors like just back from travelling',
    'two or three cardboard delivery boxes stacked by the windows, one open with packaging spilling out',
    'a few clothing-store shopping bags from a recent haul left on the floor near the doors',
    'a standing clothing rack with a few hung outfits and a garment bag against the side wall',
    'a folded ring light and a tripod leaning in the corner near the windows',
    'a beach bag, a sun hat and flip-flops dropped by the windows like just back from outside',
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
  // [text, weight] — heavily favor low, warm, "light pouring in"
  // through the floor-to-ceiling windows. Harsh noon / overcast /
  // full night are kept for variety but rare.
  time_light: [
    ['warm golden-hour sunrise light pouring low through the floor-to-ceiling windows, long soft rays raking across the floor, rug and bed, soft warm glow', 5],
    ['warm golden-hour sunset light flooding in low through the floor-to-ceiling windows, long warm rays stretched across the floor and bed, soft orange sky outside', 5],
    ['warm late-afternoon sun coming in low and golden through the windows, light pooling across the rug and floor', 4],
    ['soft warm early-morning sun just risen, gentle low light streaming through the glass across the room', 4],
    ['soft glowing late-morning sun, bright but warm, light spilling across the floor', 2],
    ['bright sunny midday light through the windows', 1],
    ['hazy bright afternoon light, soft and warm', 1],
    ['blue-hour dusk outside with the warm bedside lamp just switched on', 1],
    ['flat grey overcast daylight, soft and even, no harsh sun', 1],
    ['nighttime — dark outside with distant city lights, warm bedside lamp glow', 1],
  ],
}
const pick = (a) => a[Math.floor(Math.random() * a.length)]
// Weighted pick over [text, weight] tuples → returns the text.
const pickWeighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [t, w] of pairs) { if ((r -= w) <= 0) return t }
  return pairs[0][0]
}
// Additive clutter only. The earlier drift (bed grew, rug vanished)
// came from restyling FURNITURE across 5 axes — not from adding
// objects. Adding everyday items in a few zones is low-risk as long
// as the furniture/rug/walls/view stay locked (buildPrompt enforces
// the hard constraints). A shuffle touches 1–3 zones (biased to 2)
// so rooms read genuinely lived-in, with mess spread around the room
// — foreground, windows, corners — not just bed/nightstand/rug.
const STATE_AXES = ['bed', 'floor', 'foreground', 'bed_items', 'nightstand', 'elsewhere', 'rug', 'plants']
// 'elsewhere' is mostly everyday churn; ~1 in 5 brings in an occasional
// trip/haul/delivery moment so luggage etc. shows up but not daily.
const pickAxis = (ax) => ax === 'elsewhere'
  ? pick(Math.random() < 0.22 ? AXES.elsewhere_occasional : AXES.elsewhere_everyday)
  : pick(AXES[ax])
function shuffleScenarios(n) {
  const seen = new Set()
  const out = []
  let guard = 0
  // Per-run tag so names never collide across separate shuffle runs.
  const runTag = Date.now().toString(36).slice(-4)
  while (out.length < n && guard++ < n * 20) {
    const r = Math.random()
    const zoneCount = r < 0.12 ? 1 : r < 0.5 ? 2 : 3
    const pool = [...STATE_AXES]
    const chosen = []
    for (let k = 0; k < zoneCount && pool.length; k++) {
      const ax = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
      chosen.push([ax, pickAxis(ax)])
    }
    // Always change the time of day, weighted toward warm "light
    // pouring in" (sunrise/sunset/low golden).
    const light = pickWeighted(AXES.time_light)
    const sig = chosen.map(([a, c]) => `${a}:${c}`).sort().join('||') + `|${light || 'same'}`
    if (seen.has(sig)) continue
    seen.add(sig)
    const details = chosen.map(([, c]) => c).join('; ')
    const lockTail = 'Stage these details spread across the WHOLE scene (bare floor, '
      + 'foreground, against the left wall — not clustered by the bed). Furniture, '
      + 'architecture, walls, windows, the outside view and the rug\'s size/position '
      + 'stay exactly as in the original; the rug pile and plant vines may look '
      + 'naturally disturbed. No added furniture.'
    const change = light
      ? `the room has these lived-in details: ${details}; and the lighting is ${light}. ${lockTail}`
      : `the room has these lived-in details: ${details}. The lighting stays the same as the original. ${lockTail}`
    out.push({ name: `Shuffle ${runTag}-${out.length + 1}`, change })
  }
  return out
}

// Modest tripod moves only — big moves drift hard. Each describes
// where the tripod goes and how it re-aims so the room stays framed.
// These are CANDIDATE angle bases: generate, eyeball, then promote
// the good one into its own locked Room.
// Composition-TARGET framing: name what sits dead-center, then the
// tripod move that achieves it. The model controls rotation far
// better from "center X" than from "rotate N degrees".
// TIGHT, distinct compositions — the model keeps snapping back to the
// wide full-room view, so each of these is a close shot on one subject
// that physically cannot look like the original establishing frame.
const ANGLES = [
  'TIGHT shot into the CORNER where the two floor-to-ceiling glass walls meet: step the tripod CLOSE to the windows and aim straight into that corner so it runs floor-to-ceiling up the dead-center, both glass walls splaying out to fill the left and right of the frame. The bed is mostly out of frame (only its foot may clip an edge). Close, NOT a wide room view.',
  'TIGHT shot on the leaning MIRROR: move close and aim at the mirror so it stands nearly floor-to-ceiling in the dead-center of the frame, the headboard wall and macramé wall-hanging beside it. The windows only just clip one edge. Close, NOT a wide room view.',
  'TIGHT shot on the DRESSER: move toward the dresser and aim straight at it so it fills the lower-center of the frame with the ocean view directly behind it through the glass. The bed only intrudes a little from the far edge. Close, NOT a wide room view.',
  'DOWN-THE-BED axis from the FOOT of the bed aimed straight at the headboard: the bed runs directly away from the camera up the center to the centered headboard and macramé above it, roughly symmetrical, windows only at the right edge. A completely different camera axis.',
  'ALONG THE GLASS: stand right at the window wall and aim lengthwise back toward the headboard end of the room, the glass wall raking down one side in steep perspective, the room compressed front-to-back. A long lengthwise shot, not the standard cross-room view.',
  'HIGH and looking DOWN at about 30° over the rug and bed — much more floor and rug, the ceiling barely visible. A clearly different camera pitch from the original eye-level shot.',
]
function angleScenarios(n) {
  const idx = [...ANGLES.keys()].sort(() => Math.random() - 0.5).slice(0, n)
  const runTag = Date.now().toString(36).slice(-4)
  return idx.map((i, k) => ({ name: `Angle ${runTag}-${k + 1}`, change: ANGLES[i], mode: 'angle' }))
}

// Upload the FULL-RES file straight to Dropbox (no downscale, no
// serverless body limit) via a minted token; returns the Dropbox path.
async function dropboxUploadBase(file, roomName) {
  const tok = await fetch('/api/admin/recreate-rooms/upload-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName }),
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
    body: await file.arrayBuffer(),
  })
  if (!up.ok) throw new Error(`Dropbox upload failed (${up.status})`)
  return tok.path
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
  const [modalIdx, setModalIdx] = useState(-1)
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
  const refineBase = async () => {
    const instruction = prompt('Describe the precise fix for THIS locked angle\'s base image (camera & room stay the same).\n\ne.g. "Remove the string/fairy lights and any glowing bokeh dots — there are no lights here; keep the wall, plant and everything else exactly the same. No text."')
    if (instruction === null) return
    if (!instruction.trim()) { alert('No instruction entered — nothing to refine.'); return }
    setBusy(true); setMsg('⏳ Refining the locked base image… ~1–2 min, leave this tab open. Popup when done.')
    try {
      const d = await fetch('/api/admin/recreate-rooms/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: room.id, instruction: instruction.trim() }),
      }).then(r => r.json())
      if (d.ok) {
        setMsg('✅ Base image refined — re-analyze the lock list if the change was significant.')
        alert('Base image refined. If the change was significant, click Re-analyze (Sonnet) to refresh the lock list.')
      } else {
        setMsg(`❌ Refine failed: ${d.error || 'unknown error'}`)
        alert(`Refine failed: ${d.error || 'unknown error'}`)
      }
    } catch (e) {
      setMsg(`❌ Refine error: ${e.message || e}`)
      alert(`Refine error: ${e.message || e}`)
    }
    setBusy(false); refresh()
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
  const doAngleShuffle = async () => {
    // Edits now run in parallel, so all 6 finish in ~one edit's time
    // (well under the 300s route cap). 6 = the full angle set.
    const n = Math.min(Math.max(1, Number(shuffleN) || 6), 6)
    const recipes = angleScenarios(n)
    setBusy(true); setMsg(`Generating ${recipes.length} angle candidates… (camera moves drift — keep the good ones)`)
    const d = await fetch('/api/admin/recreate-rooms/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, recipes }),
    }).then(r => r.json())
    setMsg(d.ok ? `Made ${d.made?.length || 0} angle candidate(s) — review, then “Save as angle” on a good one` : (d.error || 'failed'))
    setBusy(false); refresh()
  }
  const promoteAngle = async (v) => {
    if (!confirm('Save this image as its own locked room (a new angle for this creator)? Sonnet will auto-write its lock list.')) return
    setBusy(true); setMsg('Creating new angle room…')
    const d = await fetch('/api/admin/recreate-rooms/promote-angle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variationId: v.id }),
    }).then(r => r.json())
    if (!d.ok) { setMsg(d.error || 'failed'); setBusy(false); return }
    setMsg(`Created “${d.name}” — analyzing lock list…`)
    try {
      await fetch('/api/admin/recreate-rooms/analyze-lock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: d.roomId }),
      })
    } catch {}
    setMsg(`“${d.name}” ready — shuffle clutter off it like any room.`)
    setBusy(false); refresh()
  }
  const replaceBase = async (f) => {
    if (!f) return
    setBusy(true); setMsg('Replacing base image…')
    try {
      setMsg('Uploading full-res to Dropbox…')
      const baseDropboxPath = await dropboxUploadBase(f, room.name)
      const d = await api('PATCH', { roomId: room.id, action: 'replaceImage', baseDropboxPath })
      setMsg(d.ok ? 'Base image replaced (full-res master in Dropbox) — re-analyze + re-lock it.' : (d.error || 'failed'))
    } catch (e) { setMsg(`Error: ${e.message || e}`) }
    setBusy(false); refresh()
  }
  const backfillMasters = async () => {
    setBusy(true); setMsg('Backfilling missing Dropbox masters…')
    const d = await fetch('/api/admin/recreate-rooms/variation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id }),
    }).then(r => r.json())
    setMsg(d.ok ? `Backfilled ${d.fixed}${d.skipped ? `, ${d.skipped} skipped` : ''}` : (d.error || 'failed'))
    setBusy(false); refresh()
  }
  const renumberMasters = async () => {
    if (!confirm('Organize this room\'s Dropbox files: move the base image into its own /{room}/_base/ folder and rename variations to Variation 01, 02, … (relinks Airtable). Safe to re-run.')) return
    setBusy(true); setMsg('Organizing Dropbox files…')
    const d = await fetch('/api/admin/recreate-rooms/variation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: room.id, action: 'renumber' }),
    }).then(r => r.json())
    setMsg(d.ok ? `Organized — ${d.renamed} variation(s)${d.baseMoved ? ' + base moved to its own folder' : ''}${d.skipped ? `, ${d.skipped} skipped` : ''}` : (d.error || 'failed'))
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
  const refineVar = async (v) => {
    const instruction = prompt('Describe the precise change(s) to make to THIS image (camera & room stay the same).\n\ne.g. "Make the left wall continue flat with no indent or recess; add a hanging trailing pothos plant on the left that matches the one on the right; add a small cute illustrated poster on the left wall with no text."')
    if (instruction === null) return
    if (!instruction.trim()) { alert('No instruction entered — nothing to refine.'); return }
    setBusy(true); setMsg('⏳ Refining image… ~1–2 min, leave this tab open. You\'ll get a popup when it\'s done.')
    try {
      const d = await fetch('/api/admin/recreate-rooms/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variationId: v.id, instruction: instruction.trim() }),
      }).then(r => r.json())
      if (d.ok) {
        setMsg('✅ Refined — new version added in the gallery below.')
        alert('Refine complete — the new version is in the gallery (look for a "… refined" card).')
      } else {
        setMsg(`❌ Refine failed: ${d.error || 'unknown error'}`)
        alert(`Refine failed: ${d.error || 'unknown error'}`)
      }
    } catch (e) {
      setMsg(`❌ Refine error: ${e.message || e}`)
      alert(`Refine error: ${e.message || e}`)
    }
    setBusy(false); refresh()
  }
  const downloadVar = (v) => { if (v?.dropbox || v?.image) window.open(v.dropbox || v.image, '_blank', 'noopener') }
  const approveAndDownload = async (v) => {
    downloadVar(v)
    await fetch(`/api/admin/recreate-rooms/variation?id=${v.id}&status=Approved`, { method: 'PATCH' })
    setModalIdx(-1)
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
            <button onClick={refineBase} disabled={busy} title="Edit this locked base image (fix/remove things, same camera)"
              style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(168,120,232,0.14)', color: '#b48ff0', border: '1px solid rgba(168,120,232,0.35)', borderRadius: 5, cursor: 'pointer' }}>✏️ Refine base</button>
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
            Generate variations — random lived-in mixes: bed state, clutter on the floor, nightstand, plus bags/boxes/clothes spread around the room (foreground, windows, corners) and time of day &amp; light. The room stays locked.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <button onClick={doShuffle} disabled={busy} style={{ padding: '9px 20px', fontSize: 13, fontWeight: 700, background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Working…' : '🎲 Shuffle & generate'}
            </button>
            <button onClick={doAngleShuffle} disabled={busy} title="Generate alternate camera angles of this room. Pick a faithful one and Save as angle." style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: '1px solid rgba(120,160,232,0.4)', borderRadius: 6, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              📐 Angle shuffle
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

          {variations.some(v => !v.dropbox) && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--foreground-muted)' }}>
              {variations.filter(v => !v.dropbox).length} variation(s) have no Dropbox master.{' '}
              <button onClick={backfillMasters} disabled={busy} style={{ fontSize: 11, fontWeight: 600, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Working…' : '↑ Backfill to Dropbox'}
              </button>
            </div>
          )}

          {(variations.some(v => v.dropbox) || room.baseImage) && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--foreground-muted)' }}>
              <button onClick={renumberMasters} disabled={busy} style={{ fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, padding: '4px 10px', cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Working…' : '🗂 Organize Dropbox files'}
              </button>{' '}
              base → /{`{room}`}/_base/, variations → Variation 01, 02, …
            </div>
          )}

          {variations.length > 0 && (() => {
            const indexed = variations.map((v, i) => [v, i])
            const isAngle = ([v]) => /^Angle\b/i.test(v.recipe || '')
            const angleItems = indexed.filter(isAngle)
            const varItems = indexed.filter(x => !isAngle(x))
            const hdr = { fontSize: 11, fontWeight: 700, color: 'var(--foreground)', margin: '14px 0 6px', letterSpacing: 0.2 }
            const sub = { fontWeight: 400, color: 'var(--foreground-muted)' }
            const renderCard = ([v, i]) => (
              <div key={v.id} style={{ border: `1px solid ${v.status === 'Approved' ? 'rgba(106,198,138,0.5)' : v.status === 'Rejected' ? 'rgba(232,120,120,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, overflow: 'hidden' }}>
                {v.image && <img src={v.image} alt="" loading="lazy" onClick={() => setModalIdx(i)} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', cursor: 'zoom-in' }} />}
                <div style={{ fontSize: 10, color: 'var(--foreground-muted)', padding: '4px 6px' }}>{v.recipe} · {v.status}</div>
                <div style={{ display: 'flex', gap: 2, padding: '0 4px 4px' }}>
                  <button onClick={() => setVar(v.id, 'Approved')} title="Approve" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'rgba(106,198,138,0.15)', color: '#6AC68A', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓</button>
                  <button onClick={() => setVar(v.id, 'Rejected')} title="Reject" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'rgba(232,120,120,0.12)', color: '#E87878', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
                  <button onClick={() => refineVar(v)} disabled={busy} title="Refine this image (fix/add specific things, same camera)" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'rgba(168,120,232,0.14)', color: '#b48ff0', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✏️</button>
                  <a href={v.dropbox || v.image || '#'} target="_blank" rel="noopener noreferrer" title={v.dropbox ? 'Download full-res master (Dropbox)' : 'Open image'} style={{ flex: 1, textAlign: 'center', fontSize: 11, padding: '3px 0', background: 'rgba(120,160,232,0.12)', color: '#8fb4f0', borderRadius: 4, textDecoration: 'none' }}>⬇</a>
                  <button onClick={() => delVar(v.id)} title="Delete" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'none', color: '#666', border: 'none', borderRadius: 4, cursor: 'pointer' }}>🗑</button>
                </div>
              </div>
            )
            const grid = (items) => (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                {items.map(renderCard)}
              </div>
            )
            return (
              <>
                {angleItems.length > 0 && (
                  <div>
                    <div style={hdr}>📐 Angle candidates ({angleItems.length}) <span style={sub}>— pick a faithful one, then “Save as angle” to make it its own room</span></div>
                    {grid(angleItems)}
                  </div>
                )}
                {varItems.length > 0 && (
                  <div>
                    <div style={hdr}>🎲 Variations ({varItems.length}) <span style={sub}>— clutter & time off the locked base</span></div>
                    {grid(varItems)}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {modalIdx >= 0 && variations[modalIdx] && (() => {
        const v = variations[modalIdx]
        const go = (d) => setModalIdx(m => Math.min(Math.max(0, m + d), variations.length - 1))
        return (
          <div onClick={() => setModalIdx(-1)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxHeight: '100%' }}>
              <img src={v.image} alt="" style={{ maxHeight: '74vh', maxWidth: '90vw', objectFit: 'contain', borderRadius: 8 }} />
              <div style={{ fontSize: 12, color: '#bbb' }}>{v.recipe} · {v.status} · {modalIdx + 1}/{variations.length}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => go(-1)} disabled={modalIdx === 0} style={{ padding: '8px 12px', fontSize: 13, background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>‹</button>
                <button onClick={() => approveAndDownload(v)} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: '#6AC68A', color: '#0a1a0f', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✓ Approve &amp; download</button>
                <button onClick={() => downloadVar(v)} style={{ padding: '8px 14px', fontSize: 13, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>⬇ Download</button>
                <button onClick={() => refineVar(v)} disabled={busy} title="Fix/add specific things on this exact image (same camera)" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'rgba(168,120,232,0.14)', color: '#b48ff0', border: '1px solid rgba(168,120,232,0.35)', borderRadius: 6, cursor: 'pointer' }}>✏️ Refine</button>
                <button onClick={async () => { await promoteAngle(v); setModalIdx(-1) }} title="Make this image its own locked room (a new angle for this creator)" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'rgba(168,120,232,0.18)', color: '#b48ff0', border: '1px solid rgba(168,120,232,0.4)', borderRadius: 6, cursor: 'pointer' }}>📐 Save as angle</button>
                <button onClick={async () => { await setVar(v.id, 'Rejected'); setModalIdx(-1) }} style={{ padding: '8px 14px', fontSize: 13, background: 'rgba(232,120,120,0.15)', color: '#E87878', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✕ Reject</button>
                <button onClick={async () => { await delVar(v.id); setModalIdx(-1) }} style={{ padding: '8px 12px', fontSize: 13, background: 'none', color: '#888', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer' }}>🗑</button>
                <button onClick={() => go(1)} disabled={modalIdx >= variations.length - 1} style={{ padding: '8px 12px', fontSize: 13, background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>›</button>
                <button onClick={() => setModalIdx(-1)} style={{ padding: '8px 12px', fontSize: 13, background: 'none', color: '#888', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Close ✕</button>
              </div>
            </div>
          </div>
        )
      })()}
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
        setBusy(true); setMsg('Uploading full-res to Dropbox…')
        body.baseDropboxPath = await dropboxUploadBase(file, form.name)
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

  // Main room first (no "— Angle N"), then angles in numeric order.
  const angleNum = (n) => {
    const m = String(n || '').match(/Angle\s*(\d+)/i)
    return m ? parseInt(m[1], 10) : 0
  }
  const rooms = (data.rooms || [])
    .filter(r => r.creatorId === creatorId)
    .sort((a, b) => angleNum(a.name) - angleNum(b.name) || String(a.name).localeCompare(String(b.name)))
  const varsByRoom = {}
  for (const v of data.variations || []) (varsByRoom[v.roomId] = varsByRoom[v.roomId] || []).push(v)

  const organizeAll = async () => {
    if (!confirm(`Organize Dropbox files for ALL ${rooms.length} rooms of this creator?\n\nMoves each room's base into its own /{room}/_base/ folder and renumbers variations. Relinks Airtable. Safe to re-run.`)) return
    setBusy(true)
    let done = 0
    const errs = []
    for (const r of rooms) {
      setMsg(`Organizing ${done + 1}/${rooms.length}: ${r.name}…`)
      try {
        const d = await fetch('/api/admin/recreate-rooms/variation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: r.id, action: 'renumber' }),
        }).then(x => x.json())
        if (d?.baseError) errs.push(`${r.name}: ${d.baseError}`)
      } catch (e) { errs.push(`${r.name}: ${e.message || e}`) }
      done++
    }
    setMsg(errs.length
      ? `Organized ${done}, but base move failed on ${errs.length}: ${errs.join(' | ')}`
      : `✅ Organized ${done} room(s) — every base is now in its own /{room}/_base/ folder.`)
    setBusy(false); load()
  }

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
        : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <button onClick={organizeAll} disabled={busy} title="Move every room's base into its own _base folder + renumber variations"
                style={{ fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '6px 12px', cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Working…' : `🗂 Organize ALL ${rooms.length} rooms`}
              </button>
            </div>
            {msg && <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 10 }}>{msg}</div>}
            {rooms.map(r => <RoomCard key={r.id} room={r} variations={varsByRoom[r.id] || []} refresh={load} />)}
          </>
        )}
    </div>
  )
}
