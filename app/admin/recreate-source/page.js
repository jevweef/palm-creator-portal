'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import AISuperClonePanel from '../creators/AISuperClonePanel'
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
  const tabParam = sp.get('tab')
  const tab = tabParam === 'rooms' ? 'rooms' : tabParam === 'stageb' ? 'stageb' : tabParam === 'avatar' ? 'avatar' : 'library'
  const setTab = (k) => {
    const params = new URLSearchParams(sp.toString())
    if (k === 'library') params.delete('tab'); else params.set('tab', k)
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
  if (tab === 'avatar') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <TabBar tab={tab} setTab={setTab} />
        <CreatorAvatarPanel />
      </div>
    )
  }
  if (tab === 'stageb') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <TabBar tab={tab} setTab={setTab} />
        <StageBPanel />
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
      {t('avatar', 'Creator Avatar')}
      {t('stageb', 'Stage B')}
    </div>
  )
}

// Built-in variation recipes — each is a small additive change clause.
const RECIPES = [
  { name: 'Clean / midday', change: 'the room is spotless and freshly tidied, bed neatly made with smooth bedding, nothing on the floor, bright clean midday light' },
  { name: 'Lightly lived-in', change: 'gently lived-in — bed loosely made, a throw casually bunched, a phone and a glass of water on the nightstand, a cardigan on the corner of the bed' },
  { name: 'Messy', change: 'the bed is unmade with the duvet pulled back and pillows tossed, a small pile of clothes and a hoodie on the floor near the bed' },
  { name: 'Super messy', change: 'genuinely messy — women\'s clothes scattered on the bed and floor, an overflowing laundry basket, a towel tossed down, cups on the nightstand, white Nike Air Force 1 sneakers and strappy heels kicked off' },
  { name: 'Clothes on floor', change: 'a casual pile of clothes and one hoodie on the floor near the foot of the bed and a tote bag leaning against the dresser, light realistic amount' },
  { name: 'Golden hour', change: 'warm golden-hour sunset light through the windows with long soft shadows and an orange-pink sky' },
  { name: 'Early morning', change: 'soft cool early-morning light, dim and calm, lamps off, bed slept-in and unmade' },
  { name: 'Night / lamps', change: 'nighttime — dark outside with distant lights through the windows, the warm bedside lamp and fairy lights on, a lit candle' },
  { name: 'Overcast', change: 'flat soft grey overcast daylight, cozy and moody, no harsh sun' },
  { name: 'Packing day', change: 'an open suitcase on the bed half-packed with folded women\'s clothes, a couple of outfits laid beside it, Birkenstock sandals and white sneakers by the suitcase, bright afternoon light' },
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
    'one or two pieces of women\'s clothing — a sundress and a crop top — tossed in a crumpled heap on the BARE porcelain tile floor near the side, off the rug (not laid flat)',
    'a small folded stack of women\'s laundry (leggings, tops, a cardigan) sitting directly on the bare tile floor away from the rug',
'a pair of strappy tan stiletto heels kicked off on the bare tile near the left wall and a women\'s knit top tossed over the foot of the bed',
    'a towel and a women\'s handbag tipped over on the bare porcelain floor between the rug and the camera',
    'a single yoga mat unrolled along the FAR RIGHT side parallel to the glass windows (off the rug, NOT in the center where someone would stand), with two yoga blocks, a folded towel and a water bottle beside it',
    'a women\'s gym bag open on the bare tile floor with workout clothes and a sports bra spilling out onto the tile',
    'a few women\'s outfits tossed in crumpled piles toward the side of the bare floor, one trailing onto the rug, like she was trying clothes on (not spread flat, center clear)',
  ],
  // Right at the camera — so close it is only partly in frame.
  // Near-camera but ALWAYS shoved into the lower-LEFT or lower-RIGHT
  // corner — the dead-center bottom stays clear (a person stands there).
  foreground: [
    'a small woven tote or handbag in the lower-LEFT corner of the frame, close to the camera and partially cropped by the edge (center stays clear)',
    'the corner of a women\'s tote or handbag intruding from the far RIGHT edge of the foreground, cut off by the side of the frame (center stays clear)',
    'a pair of clean white Nike Air Force 1 women\'s sneakers kicked off into the lower-LEFT corner near the side wall, close to camera (center stays clear)',
    'a crumpled cardigan tossed in the lower-RIGHT corner of the frame, partially out of frame at the side (center stays clear)',
  ],
  // The linen tote that sits by the nightstand in the base is a
  // personal item, NOT fixed — it moves around or leaves the room.
  tote: [
    'the linen tote bag is gone entirely — taken out of the room (not by the nightstand, not anywhere)',
    'the linen tote bag moved to the foot of the bed instead of by the nightstand',
    'the linen tote bag set down on the floor by the sliding doors instead of by the nightstand',
    'the linen tote bag tossed onto the bed instead of by the nightstand',
    'the linen tote bag hung over the corner of the leaning mirror instead of by the nightstand',
    'the linen tote bag slumped on the floor near the dresser instead of by the nightstand',
    'the linen tote bag still by the nightstand but tipped over / sitting differently than before',
  ],
  // The throw blanket is bedding (transient) — it does not always
  // look the same. Same blanket (same knit/color), arranged differently.
  throw: [
    'the same knit throw blanket folded lengthwise and laid neatly across the foot of the bed',
    'the same knit throw blanket draped over the far/back corner of the bed, trailing a little',
    'the same knit throw blanket bunched casually at the near corner of the bed',
    'the same knit throw blanket pulled across most of the bed like a second blanket, softly rumpled',
    'the same knit throw blanket half slid off the side of the bed, one end pooling on the rug',
    'the same knit throw blanket loosely twisted and tossed toward the head of the bed',
    'no throw blanket on the bed (it has been put away) — bed just has its duvet and pillows',
  ],
  // The shag rug is transient surface — it gets walked on.
  rug: [
    'the shag rug pile pushed around and a little uneven, with faint footprint impressions, clearly walked on (rug stays flat on the floor, same size and place)',
    'the shag rug pile a little matted and ruffled in places like it was walked across (rug stays flat on the floor, same size and place)',
    'the rug pile raked in soft directional lines like it was just walked across (rug stays flat on the floor, same size and place)',
  ],
  // Vines re-drape after watering / being nudged.
  // Subtle only — same plant/pot/spot, just the loose vines fall a
  // little differently (watered/nudged). Never dramatic.
  plants: [
    'the trailing vines hang slightly differently — a few strands fallen forward as if just watered (same plant, same pot, same spot)',
    'the long pothos vines swept gently to one side, a touch looser than before (same plant, same pot, same spot)',
    'a couple of vine tendrils nudged back behind the mirror, the rest draping a little differently (same plant, same pot, same spot)',
    'the vines a little longer and looser, one strand curled differently near the bottom (same plant, same pot, same spot)',
    'the hanging vines tucked slightly tidier, gathered a bit more toward the wall (same plant, same pot, same spot)',
  ],
  // Clutter that lives AWAY from the bed/nightstand zone — foreground
  // near the camera, by the sliding doors/windows, against the dresser
  // or mirror, in a back corner. Split by how often it's realistically
  // there: everyday churn vs. occasional (trips, hauls, deliveries).
  elsewhere_everyday: [
    'a women\'s cardigan and a couple of tops draped over the foot of the bed and onto the floor',
    'a cropped hoodie and a women\'s tank top dropped on the floor near the foot of the bed',
    'a pair of Adidas Samba sneakers and tan Birkenstock Arizona sandals kicked off to the side close to the camera',
    'a bath towel dropped on the floor and a workout towel draped over the mirror',
    'a women\'s tote bag and a small purse set down on the floor by the dresser',
    'a women\'s mini backpack slumped against the wall in the foreground with a denim jacket beside it',
    'a pair of tan UGG mini platform boots and white New Balance 530 sneakers lined up against the side wall',
    'pink Hoka running shoes kicked off by the dresser with a scrunchie and a water bottle beside them',
    'a couple of water bottles and a coffee mug left on top of the dresser',
    'a modern woven rattan laundry basket with a few women\'s clothes in it, tucked in a back corner against the wall (never in the foreground)',
    'a folded pile of clean women\'s laundry on the floor by the dresser waiting to be put away',
    'a cluster of skincare and makeup bottles spread across the top of the dresser',
    'a small stack of books and a magazine on the floor near the nightstand',
    'a hair straightener and a hair dryer with their cords out on the dresser',
    'earbuds, a charging cable and a scrunchie left on top of the dresser',
    'a phone, lip gloss and sunglasses dropped on the dresser',
    'a women\'s shopping tote with a couple of items left on the floor by the doors',
    'a silk robe and an oversized sweater draped over the leaning mirror',
    'a rolled yoga mat propped against the wall by the windows with light dumbbells beside it',
    'scattered women\'s outfits across the foreground floor closer to the camera reaching onto the rug',
  ],
  elsewhere_occasional: [
    'an open carry-on suitcase on the floor half-packed with folded women\'s clothes, like a trip is coming up',
    'a women\'s weekender bag and a tote standing by the sliding doors like just back from travelling',
    'two or three cardboard delivery boxes stacked by the windows, one open with tissue paper and a clothing order spilling out',
    'a few clothing-store and boutique shopping bags from a recent haul left on the floor near the doors',
    'a standing clothing rack with a few hung dresses and outfits and a garment bag against the side wall',
    'a folded ring light and a tripod leaning in the corner near the windows',
    'a straw beach bag, a sun hat and tan leather slide sandals dropped by the windows like just back from outside',
  ],
  bed_items: [
    'nothing on the bed',
    'a knit throw blanket bunched at the foot of the bed',
    'a small stack of folded women\'s laundry on the bed',
    'a couple of women\'s tops and a dress tossed on the bed',
    'a towel laid across the end of the bed',
    'an open half-packed suitcase with women\'s clothes on the bed',
    'a couple of pillows pushed off to one side',
  ],
  // Additive — these get ADDED to whatever is already on the
  // nightstand by default (lamp, candle, etc. stay).
  nightstand: [
    'a glass of water added beside the lamp on the nightstand (its existing items stay)',
    'a phone and a glass of water added to the nightstand (its existing items stay)',
    'a mug and a couple of skincare bottles added to the nightstand (its existing items stay)',
    'a charging cable and earbuds added to the nightstand (its existing items stay)',
    'a book and reading glasses added to the nightstand (its existing items stay)',
    'a few hair ties, a scrunchie and lip balm added to the nightstand (its existing items stay)',
    'a water bottle added to the nightstand (its existing items stay)',
    'a small ring dish with jewelry added to the nightstand (its existing items stay)',
    'a folded top draped over the edge of the nightstand, its existing items still on top',
  ],
  // DISTINCT times — one per variation per run (drawn from a shuffled
  // bag so a batch spreads across the day, never clumps). Sun direction
  // anchored to the room: glass wall on the RIGHT/back; mirror, plant
  // and dresser on the RIGHT by the windows; straight-in view = 12 o'clock.
  time_light: [
    'early sunrise — warm low sun entering from the RIGHT through the right-side window, raking low across the RIGHT side of the porcelain floor and the right edge of the rug, long soft shadows stretching LEFT, gentle golden glow',
    'late-morning — bright warm sun from the upper RIGHT, even light filling the whole room, medium shadows',
    'harsh high-noon — strong bright sun almost straight overhead through the back/center windows, hard-edged short shadows directly under the furniture, crisp high-contrast daylight (NOT soft, NOT low side light)',
    'soft bright midday — high sun through the back/center windows (12 o\'clock), gentle short shadows, clean even daylight pooling in the CENTER of the floor',
    'hazy warm afternoon light, soft and diffused, mild shadows',
    'warm late-afternoon sun, lower and from the RIGHT, golden light pooling across the dresser side and the right half of the rug, long shadows leaning LEFT',
    'golden-hour sunset — warm low sun pouring DIRECTLY through the right-side window from about the 4–5 o\'clock direction, lighting up the standing mirror, the trailing plant and the wood dresser, long warm shadows stretched across the room to the LEFT, soft orange sky',
    'blue-hour dusk — dim cool blue light outside, the warm bedside lamp just switched on, soft pools of warm lamp light',
    'flat grey overcast daylight, soft and even, no sun direction, no harsh shadows',
    'nighttime — dark outside, distant city lights through the glass, the warm bedside lamp and a candle on, PLUS a ring light positioned behind the camera casting soft even frontal light into the room; because it is dark out the floor-to-ceiling glass acts like a mirror — show ONE subtle circular ring-light reflection in the dark window glass only, where the angle would naturally catch it. Do NOT put a ring-light reflection in the standing mirror or anywhere else',
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
const STATE_AXES = ['bed', 'floor', 'foreground', 'bed_items', 'nightstand', 'elsewhere', 'rug', 'plants', 'throw', 'tote']
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
  // Distinct time-of-day per variation: shuffle the full set and walk
  // it so a run spreads across sunrise→night instead of clumping.
  const lightBag = [...AXES.time_light].sort(() => Math.random() - 0.5)
  while (out.length < n && guard++ < n * 20) {
    const r = Math.random()
    const zoneCount = r < 0.12 ? 1 : r < 0.5 ? 2 : 3
    const pool = [...STATE_AXES]
    const chosen = []
    for (let k = 0; k < zoneCount && pool.length; k++) {
      const ax = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
      chosen.push([ax, pickAxis(ax)])
    }
    // Always change the time of day — distinct per variation in the run.
    const light = lightBag[out.length % lightBag.length]
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

// Upload a Stage B input (pose screenshot blob / extra ref file)
// straight to Dropbox; returns the Dropbox path.
async function stageBUpload(blob, kind) {
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

function CreatorAvatarPanel() {
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  useEffect(() => {
    fetch('/api/admin/recreate-rooms').then(r => r.json()).then(d => {
      setCreators(d.creators || [])
      if (d.creators?.[0]) setCreatorId(d.creators[0].id)
    }).catch(() => {})
  }, [])
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Creator Avatar — AI Super Clone</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 16 }}>
        Set up the creator&apos;s reference photos here once. These supply identity for Stage B and the recreate pipeline.
      </p>
      <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
        style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
        {creators.length === 0 && <option>No TJP creators</option>}
        {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {creatorId && <AISuperClonePanel creatorId={creatorId} />}
    </div>
  )
}

function StageBPanel() {
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
  const [extraFiles, setExtraFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [creators, setCreators] = useState([])

  useEffect(() => {
    fetch('/api/admin/recreate-rooms/stage-b/creators').then(r => r.json()).then(d => {
      setCreators(d.creators || [])
      if (d.creators?.[0]) setCreatorId(d.creators[0].id)
    }).catch(() => {})
    fetch('/api/admin/recreate-rooms').then(r => r.json()).then(d => {
      setData({ creators: d.creators || [], rooms: d.rooms || [], variations: d.variations || [] })
    }).catch(() => {})
    fetch('/api/admin/recreate-sources').then(r => r.json()).then(d => setReels(d.reels || [])).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadOutputs = useCallback(() => {
    if (!creatorId) { setOutputs([]); return }
    fetch(`/api/admin/recreate-rooms/stage-b/outputs?creatorId=${creatorId}`)
      .then(r => r.json()).then(d => setOutputs(d.outputs || [])).catch(() => {})
  }, [creatorId])

  useEffect(() => { loadOutputs() }, [loadOutputs])

  const setOutputStatus = async (o, status) => {
    let reason
    if (status === 'Rejected') {
      reason = window.prompt('Why is this rejected? (kept as a tuning signal)') || ''
    }
    await fetch('/api/admin/recreate-rooms/stage-b/outputs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: o.id, status, reason }),
    }).catch(() => {})
    loadOutputs()
  }
  const deleteOutput = async (o) => {
    if (!window.confirm('Delete this Stage B output record?')) return
    await fetch(`/api/admin/recreate-rooms/stage-b/outputs?id=${o.id}`, { method: 'DELETE' }).catch(() => {})
    loadOutputs()
  }

  // Real video length from CF Stream so the scrub slider spans exactly the
  // clip (not a hardcoded 30s). Same source as the Post Prep picker.
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
  // Rooms ARE per-creator (the creator's virtual bedroom).
  const myRooms = data.rooms.filter(r => r.creatorId === creatorId)

  const generate = async () => {
    if (!creatorId) { setMsg('Pick a creator first.'); return }
    if (!reel?.streamUid) { setMsg('Pick a reel (with Stream video) and capture a frame first.'); return }
    if (!captured) { setMsg('Scrub to the pose and click “Capture this frame”.'); return }
    setBusy(true); setStageBOut(null); setMsg('⏳ Uploading any extra refs…')
    try {
      const refPaths = []
      for (const f of extraFiles) refPaths.push(await stageBUpload(f, 'ref'))
      setMsg('⏳ Stage B — classifying the shot, picking the matching room, compositing… ~2–3 min, leave this tab open.')
      const d = await fetch('/api/admin/recreate-rooms/stage-b', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, poseStreamUid: reel.streamUid, poseTime, refDropboxPaths: refPaths, reelRecordId: reel.id }),
      }).then(r => r.json())
      if (d.ok) {
        setStageBOut({ url: d.out, dropbox: d.dropbox, room: d.room, roomFraming: d.roomFraming, screenshotFraming: d.screenshotFraming })
        setMsg(`✅ Done — screenshot read as ${d.screenshotFraming}, matched to "${d.room}" [${d.roomFraming}]. Saved to Stage B Outputs below.`)
        loadOutputs()
      } else setMsg(`❌ ${d.error || 'failed'}`)
    } catch (e) { setMsg(`❌ ${e.message || e}`) }
    setBusy(false)
  }

  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const lbl = { fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>Stage B — Creator into Room</h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 16 }}>
Pick the creator and screenshot a reel for the pose &amp; outfit. The system reads the screenshot&apos;s framing, auto-picks the creator&apos;s best-matching room angle, and composites them in with their on-file AI Super Clone refs (face + front + back + optional uploads). Wan 2.7 — room stays untouched. Motion control happens off-site (TJP).
      </p>

      <div style={card}>
        <div style={lbl}>1 · Creator</div>
        <select value={creatorId} onChange={e => setCreatorId(e.target.value)}
          style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, fontSize: 13 }}>
          {creators.length === 0 && <option>No creators with AI refs</option>}
          {creators.map(c => <option key={c.id} value={c.id}>{c.name} — {c.face}F·{c.front}Fr·{c.back}B</option>)}
        </select>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 8 }}>
          {sel ? `Identity: ${sel.face} face + ${sel.front} front + ${sel.back} back ${sel.approved ? 'approved AI Super Clone refs' : 'raw AI Ref Inputs (not yet approved — approve them in Creator Avatar for best results)'}, plus any extra uploads.` : 'Any creator with AI Super Clone refs on file.'}
        </div>
      </div>

      <div style={card}>
        <div style={lbl}>2 · Location — auto-picked from the creator&apos;s rooms</div>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
          The system reads the screenshot&apos;s framing and auto-picks {sel?.name || 'this creator'}&apos;s room angle that best matches (full-body → Wide, cropped → Tight), then a random approved variation of it. No manual pick.
        </div>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 8 }}>
          {myRooms.length === 0
            ? `⚠️ ${sel?.name || 'This creator'} has no rooms yet — create & approve at least one in the Rooms tab first.`
            : <>Rooms on file: {myRooms.map(r => `${r.name} [${r.framing || 'unclassified'}]`).join(' · ')}</>}
        </div>
      </div>

      <div style={card}>
        <div style={lbl}>3 · Pose &amp; outfit — pick a reel, scrub to the pose, capture</div>
        {captured && reel?.streamUid && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: 10, background: 'rgba(106,198,138,0.1)', border: '1px solid rgba(106,198,138,0.35)', borderRadius: 8 }}>
            <img src={buildStreamPosterUrl(reel.streamUid, { time: `${Math.max(0.1, poseTime)}s`, width: 160, fit: 'crop' })} alt=""
              style={{ width: 70, aspectRatio: '9/16', objectFit: 'cover', borderRadius: 6 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6AC68A' }}>✓ Pose captured @ {poseTime.toFixed(1)}s</div>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>Click any reel below to re-pick.</div>
            </div>
            <button onClick={() => setPoseModalOpen(true)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Re-scrub</button>
          </div>
        )}
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Click a reel to open it full-size and scrub to the exact pose.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 480, overflowY: 'auto' }}>
          {reels.map(r => {
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
        <div style={lbl}>4 · Optional — extra identity reference images for this run</div>
        <input type="file" accept="image/*" multiple onChange={e => setExtraFiles([...e.target.files])}
          style={{ fontSize: 12, color: 'var(--foreground-muted)' }} />
        {extraFiles.length > 0 && <span style={{ fontSize: 12, color: '#6AC68A', marginLeft: 8 }}>{extraFiles.length} added</span>}
      </div>

      <button onClick={generate} disabled={busy} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700, background: busy ? 'rgba(232,168,120,0.3)' : '#e8a878', color: '#1a0a0a', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Working…' : '👤 Generate — insert creator'}
      </button>
      {msg && <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 12 }}>{msg}</div>}

      {stageBOut && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={lbl}>Result — {sel?.name} in {stageBOut.room} [{stageBOut.roomFraming}] · shot read as {stageBOut.screenshotFraming}</div>
          <img src={stageBOut.url} alt="Stage B result"
            style={{ width: 'min(360px, 90vw)', aspectRatio: '9/16', objectFit: 'contain', borderRadius: 10, background: '#000', display: 'block' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <a href={stageBOut.dropbox || stageBOut.url} target="_blank" rel="noreferrer"
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: 'none', borderRadius: 6, textDecoration: 'none' }}>↗ Open full size</a>
            <span style={{ fontSize: 12, color: 'var(--foreground-muted)', alignSelf: 'center' }}>Saved as Pending in Stage B Outputs below.</span>
          </div>
        </div>
      )}

      {outputs.length > 0 && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={lbl}>Stage B Outputs — {sel?.name} ({outputs.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {outputs.map(o => {
              const sc = o.status === 'Approved' ? '#6AC68A' : o.status === 'Rejected' ? '#E87878' : '#e8b878'
              return (
                <div key={o.id} style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                  {o.image
                    ? <img src={o.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#888' }}>transcoding…</div>}
                  <div style={{ padding: 8, fontSize: 11 }}>
                    <div style={{ color: sc, fontWeight: 700 }}>{o.status}</div>
                    <div style={{ color: 'var(--foreground-muted)', margin: '2px 0' }}>{o.room || '—'}{o.roomFraming ? ` [${o.roomFraming}]` : ''} · shot {o.screenshotFraming || '?'}</div>
                    {o.reel && <a href={o.reel.url} target="_blank" rel="noreferrer" style={{ color: '#8fb4f0', textDecoration: 'none' }}>↗ reel @{o.reel.handle || o.reel.reelId}</a>}
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
  const [showRejected, setShowRejected] = useState(false)
  const [msg, setMsg] = useState('')

  // Arrow keys navigate the lightbox; Escape closes it.
  useEffect(() => {
    if (modalIdx < 0) return
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setModalIdx(m => Math.min(m + 1, variations.length - 1))
      else if (e.key === 'ArrowLeft') setModalIdx(m => Math.max(m - 1, 0))
      else if (e.key === 'Escape') setModalIdx(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalIdx, variations.length])

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
  // Reject keeps the generation (no delete) + records WHY for tuning.
  const rejectVar = async (id) => {
    const reason = prompt('Why is this rejected? (saved as tuning feedback — the image is kept, not deleted)\n\ne.g. "ring light reflected in mirror", "rug flipped up", "clothes on dresser folded", "creator body distorted"')
    if (reason === null) return
    await fetch(`/api/admin/recreate-rooms/variation?id=${id}&status=Rejected`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    })
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
                  <button onClick={() => rejectVar(v.id)} title="Reject + say why (kept for tuning)" style={{ flex: 1, fontSize: 11, padding: '3px 0', background: 'rgba(232,120,120,0.12)', color: '#E87878', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
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
            // Within a section, group by status: Approved → Pending → Rejected.
            const subHdr = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, margin: '10px 0 6px' }
            const byStatus = (items) => {
              const groups = [
                ['Approved', '#6AC68A', items.filter(([v]) => v.status === 'Approved')],
                ['Pending', '#caa84a', items.filter(([v]) => !v.status || v.status === 'Pending')],
                ['Rejected', '#E87878', items.filter(([v]) => v.status === 'Rejected')],
              ]
              return groups.filter(([, , g]) => g.length > 0).map(([label, color, g]) => {
                const collapsible = label === 'Rejected'
                const open = !collapsible || showRejected
                return (
                  <div key={label}>
                    <div
                      onClick={collapsible ? () => setShowRejected(s => !s) : undefined}
                      style={{ ...subHdr, color, cursor: collapsible ? 'pointer' : 'default', userSelect: 'none' }}>
                      {collapsible ? (open ? '▾ ' : '▸ ') : ''}{label} ({g.length}){collapsible && !open ? ' — click to show' : ''}
                    </div>
                    {open && grid(g)}
                  </div>
                )
              })
            }
            return (
              <>
                {angleItems.length > 0 && (
                  <div>
                    <div style={hdr}>📐 Angle candidates ({angleItems.length}) <span style={sub}>— pick a faithful one, then “Save as angle” to make it its own room</span></div>
                    {byStatus(angleItems)}
                  </div>
                )}
                {varItems.length > 0 && (
                  <div>
                    <div style={hdr}>🎲 Variations ({varItems.length}) <span style={sub}>— clutter & time off the locked base</span></div>
                    {byStatus(varItems)}
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
                <button onClick={() => approveAndDownload(v)} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: '#6AC68A', color: '#0a1a0f', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✓ Approve</button>
                <button onClick={async () => { await rejectVar(v.id); setModalIdx(-1) }} title="Reject and record why (kept for tuning, not deleted)" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, background: 'rgba(232,120,120,0.18)', color: '#E87878', border: '1px solid rgba(232,120,120,0.4)', borderRadius: 6, cursor: 'pointer' }}>✕ Reject</button>
                <button onClick={() => downloadVar(v)} style={{ padding: '8px 14px', fontSize: 13, background: 'rgba(120,160,232,0.18)', color: '#8fb4f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>⬇ Download</button>
                <button onClick={() => refineVar(v)} disabled={busy} title="Fix/add specific things on this exact image (same camera)" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'rgba(168,120,232,0.14)', color: '#b48ff0', border: '1px solid rgba(168,120,232,0.35)', borderRadius: 6, cursor: 'pointer' }}>✏️ Refine</button>
                {/^Angle\b/i.test(v.recipe || '') && (
                  <button onClick={async () => { await promoteAngle(v); setModalIdx(-1) }} title="Make this image its own locked room (a new angle for this creator)" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'rgba(168,120,232,0.18)', color: '#b48ff0', border: '1px solid rgba(168,120,232,0.4)', borderRadius: 6, cursor: 'pointer' }}>📐 Save as angle</button>
                )}
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
