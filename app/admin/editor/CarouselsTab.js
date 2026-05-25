'use client'
import { useEffect, useMemo, useState } from 'react'

// Carousels tab — assemble carousel posts from Photos table records and push
// them to the Ready-to-Go queue. UI fetches photos linked to the selected
// creator, lets admin multi-select 1-10 in order, optionally caption, and
// submit. POST /api/admin/posts/carousel mirrors each selected Photo into a
// new Asset record (Asset Type=Photo) and creates one Post per creator with
// Type=Carousel, Status=Ready to Go.
//
// Filter pills map to Photos.Source Type singleSelect values.
const SOURCE_FILTERS = [
  { key: 'all', label: 'All', match: null },
  { key: 'ai', label: 'AI Generated', match: 'AI Generated' },
  { key: 'creator', label: 'Creator Upload', match: 'Creator Upload' },
  { key: 'instagram', label: 'Scraped IG', match: 'Instagram' },
  { key: 'pinterest', label: 'Pinterest', match: 'Pinterest' },
]

export default function CarouselsTab({ showToast }) {
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState(null)
  const [photos, setPhotos] = useState([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [tray, setTray] = useState([])
  const [caption, setCaption] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/admin/grid-planner')
      .then(r => r.json())
      .then(d => {
        const list = (d.creators || []).filter(c => c.id)
        setCreators(list)
        if (!creatorId && list.length) setCreatorId(list[0].id)
      })
      .catch(e => showToast?.(`Couldn't load creators: ${e.message}`, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!creatorId) return
    setLoadingPhotos(true)
    fetch('/api/admin/photos/library')
      .then(r => r.json())
      .then(d => {
        const all = d.photos || []
        // Photos linked to this creator. Scraped IG photos may not have a
        // Creator link (they link to Source Handle, not our creator) — they
        // pass through the "Scraped IG" filter only when chosen explicitly.
        const ours = all.filter(p => (p.creatorIds || []).includes(creatorId))
        const scrapedShared = all.filter(p => p.sourceType === 'Instagram' && !(p.creatorIds || []).length)
        setPhotos([...ours, ...scrapedShared])
        setTray([])
      })
      .catch(e => showToast?.(`Couldn't load photos: ${e.message}`, true))
      .finally(() => setLoadingPhotos(false))
  }, [creatorId, showToast])

  const visible = useMemo(() => {
    let view = photos
    const f = SOURCE_FILTERS.find(s => s.key === sourceFilter)
    if (f?.match) view = view.filter(p => p.sourceType === f.match)
    if (searchQ) {
      const q = searchQ.toLowerCase()
      view = view.filter(p =>
        (p.handle || '').toLowerCase().includes(q) ||
        (p.caption || '').toLowerCase().includes(q)
      )
    }
    return view
  }, [photos, sourceFilter, searchQ])

  const trayIds = useMemo(() => new Set(tray.map(p => p.id)), [tray])

  function addToTray(p) {
    if (tray.length >= 10) { showToast?.('Max 10 slides per carousel', true); return }
    if (trayIds.has(p.id)) return
    setTray([...tray, p])
  }

  function removeFromTray(id) {
    setTray(tray.filter(p => p.id !== id))
  }

  function moveTray(idx, dir) {
    const target = idx + dir
    if (target < 0 || target >= tray.length) return
    const next = [...tray]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setTray(next)
  }

  async function submit() {
    if (!creatorId) { showToast?.('Pick a creator', true); return }
    if (!tray.length) { showToast?.('Add at least one photo', true); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/posts/carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorIds: [creatorId],
          photoIds: tray.map(p => p.id),
          caption: caption.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const count = data.posts?.length || 1
      showToast?.(`Carousel queued (${count} post${count === 1 ? '' : 's'})`)
      setTray([])
      setCaption('')
    } catch (err) {
      showToast?.(`Submit failed: ${err.message}`, true)
    } finally {
      setSubmitting(false)
    }
  }

  const creatorOptions = useMemo(() =>
    creators
      .map(c => ({ id: c.id, name: c.aka || c.name || c.id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [creators]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: '#999' }}>Creator</label>
        <select
          value={creatorId || ''}
          onChange={e => setCreatorId(e.target.value || null)}
          style={{
            padding: '6px 10px', fontSize: 13, background: 'rgba(255,255,255,0.04)',
            color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            minWidth: 200,
          }}
        >
          {!creatorOptions.length && <option value="">Loading…</option>}
          {creatorOptions.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search caption or handle…"
          style={{
            padding: '6px 10px', fontSize: 13, background: 'rgba(255,255,255,0.04)',
            color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            minWidth: 240, flex: '0 1 280px',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SOURCE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setSourceFilter(f.key)}
            style={{
              padding: '5px 11px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
              background: sourceFilter === f.key ? 'rgba(232, 160, 160, 0.1)' : 'rgba(255,255,255,0.03)',
              color: sourceFilter === f.key ? 'var(--palm-pink)' : '#aaa',
              border: `1px solid ${sourceFilter === f.key ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 999, cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 20, alignItems: 'flex-start' }}>
        <div>
          {loadingPhotos && <div style={{ color: '#888', fontSize: 13, padding: 12 }}>Loading photos…</div>}
          {!loadingPhotos && !visible.length && (
            <div style={{ color: '#888', fontSize: 13, padding: 12 }}>
              No photos match this filter. Try a different source or creator.
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8,
          }}>
            {visible.map(p => {
              const selected = trayIds.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => addToTray(p)}
                  disabled={selected}
                  title={p.caption || p.handle || ''}
                  style={{
                    position: 'relative', aspectRatio: '1 / 1', overflow: 'hidden',
                    background: '#111', border: `2px solid ${selected ? 'var(--palm-pink)' : 'transparent'}`,
                    borderRadius: 6, cursor: selected ? 'default' : 'pointer', padding: 0,
                  }}
                >
                  {p.image && (
                    <img
                      src={p.image}
                      onError={e => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )}
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(0,0,0,0.65)', color: '#ddd',
                  }}>
                    {p.sourceType}
                  </div>
                  {selected && (
                    <div style={{
                      position: 'absolute', inset: 0, background: 'rgba(232,160,160,0.25)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 24, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                    }}>✓</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{
          position: 'sticky', top: 12, alignSelf: 'flex-start',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Carousel</strong>
            <span style={{ fontSize: 12, color: '#888' }}>{tray.length}/10</span>
          </div>

          {!tray.length && (
            <div style={{ color: '#777', fontSize: 12, padding: '12px 4px' }}>
              Click photos on the left to add them. Max 10 slides.
            </div>
          )}

          {tray.map((p, idx) => (
            <div key={p.id} style={{
              display: 'flex', gap: 8, alignItems: 'center',
              padding: 6, background: 'rgba(255,255,255,0.02)', borderRadius: 4,
            }}>
              <div style={{ fontSize: 11, color: '#888', width: 16, textAlign: 'center' }}>{idx + 1}</div>
              {p.image && (
                <img
                  src={p.image}
                  onError={e => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.caption?.slice(0, 30) || p.handle || p.sourceType}
              </div>
              <button
                onClick={() => moveTray(idx, -1)}
                disabled={idx === 0}
                style={{ background: 'none', border: 'none', color: idx === 0 ? '#444' : '#aaa', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 14, padding: '0 4px' }}
                title="Move up"
              >↑</button>
              <button
                onClick={() => moveTray(idx, 1)}
                disabled={idx === tray.length - 1}
                style={{ background: 'none', border: 'none', color: idx === tray.length - 1 ? '#444' : '#aaa', cursor: idx === tray.length - 1 ? 'default' : 'pointer', fontSize: 14, padding: '0 4px' }}
                title="Move down"
              >↓</button>
              <button
                onClick={() => removeFromTray(p.id)}
                style={{ background: 'none', border: 'none', color: '#E87878', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                title="Remove"
              >×</button>
            </div>
          ))}

          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            rows={3}
            style={{
              padding: '8px 10px', fontSize: 12, background: 'rgba(255,255,255,0.04)',
              color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
              resize: 'vertical', minHeight: 60, fontFamily: 'inherit',
            }}
          />

          <button
            onClick={submit}
            disabled={submitting || !tray.length || !creatorId}
            style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              background: submitting || !tray.length ? 'rgba(255,255,255,0.04)' : 'var(--palm-pink)',
              color: submitting || !tray.length ? '#666' : '#1a1a1a',
              border: 'none', borderRadius: 6,
              cursor: submitting || !tray.length ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit to Queue'}
          </button>
        </div>
      </div>
    </div>
  )
}
