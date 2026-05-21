'use client'

// Photos tab on /admin/recreate-source — manages the cheap-scrape
// photo library that feeds outfit fan-out + future inspiration recreate.
//
// Two sections:
//   Accounts — IG handles to scrape from (add / remove / enable / Browse)
//   Library  — every imported photo, filterable, with status toggles
//
// Browse Photos opens a modal that calls RapidAPI's get_ig_user_posts,
// explodes carousels into individual image thumbnails, lets the admin
// click to mark, then imports the marked ones to Dropbox + Airtable.

import { useEffect, useState, useCallback } from 'react'
import { uiConfirm } from './panels'

export default function PhotosPanel() {
  const [tab, setTab] = useState('accounts') // 'accounts' | 'library' | 'outfit-picker'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Photos</h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 4 }}>Scrape IG photo posts (single + carousels) from accounts you trust. Feeds outfit swaps + future inspiration recreate.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { k: 'accounts', label: 'Accounts' },
            { k: 'library', label: 'Library' },
            { k: 'outfit-picker', label: '👗 Outfit Picker' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              style={{
                padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                background: tab === t.k ? 'rgba(232,168,120,0.18)' : 'rgba(255,255,255,0.04)',
                color: tab === t.k ? '#e8b878' : 'var(--foreground-muted)',
                border: `1px solid ${tab === t.k ? 'rgba(232,168,120,0.45)' : 'rgba(255,255,255,0.12)'}`,
                cursor: 'pointer',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'accounts' ? <AccountsSection />
        : tab === 'library' ? <LibrarySection />
        : <OutfitPickerSection />}
    </div>
  )
}

// ─── Accounts ────────────────────────────────────────────────────────────────

function AccountsSection() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [newHandles, setNewHandles] = useState('')
  const [adding, setAdding] = useState(false)
  const [browseAccount, setBrowseAccount] = useState(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/photos/accounts')
      const d = await r.json()
      if (d.ok) setAccounts(d.accounts || [])
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const addHandles = async () => {
    if (!newHandles.trim()) return
    setAdding(true); setMsg('')
    try {
      const r = await fetch('/api/admin/photos/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: newHandles }),
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setMsg(`Added ${d.added?.length || 0}${d.skipped?.length ? `, ${d.skipped.length} already existed` : ''}`)
      setNewHandles('')
      load()
    } catch (e) { setMsg(`❌ ${e.message}`) } finally { setAdding(false) }
  }

  const toggleEnabled = async (a) => {
    try {
      await fetch('/api/admin/photos/accounts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, fields: { Enabled: !a.enabled } }),
      })
      setAccounts(prev => prev.map(p => p.id === a.id ? { ...p, enabled: !a.enabled } : p))
    } catch (e) { setMsg(e.message) }
  }

  const removeAccount = async (a) => {
    if (!(await uiConfirm(`Remove @${a.handle} from photo accounts?`, { danger: true, okLabel: 'Remove' }))) return
    try {
      await fetch(`/api/admin/photos/accounts?id=${a.id}`, { method: 'DELETE' })
      setAccounts(prev => prev.filter(p => p.id !== a.id))
    } catch (e) { setMsg(e.message) }
  }

  return (
    <div>
      {/* Add handles */}
      <div style={{ padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Add IG handles</div>
        <textarea value={newHandles} onChange={e => setNewHandles(e.target.value)} placeholder="latinamamiisabella, another.handle — comma or newline separated"
          rows={3}
          style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 12 }}>
          <span style={{ fontSize: 12, color: msg.startsWith('❌') ? '#E87878' : 'var(--foreground-muted)' }}>{msg}</span>
          <button onClick={addHandles} disabled={adding || !newHandles.trim()}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, background: adding ? 'rgba(232,168,120,0.18)' : 'var(--palm-pink, #e8a878)', color: '#1a0a0a', border: 'none', borderRadius: 6, cursor: adding ? 'default' : 'pointer' }}>
            {adding ? '⏳ Adding…' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Accounts list */}
      {loading ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>No photo accounts yet — add some above.</div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
          {accounts.map((a, i) => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 140px 100px 160px', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)', opacity: a.enabled ? 1 : 0.55 }}>
              <input type="checkbox" checked={a.enabled} onChange={() => toggleEnabled(a)} style={{ cursor: 'pointer' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a href={`https://instagram.com/${a.handle}`} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', textDecoration: 'none' }}>@{a.handle}</a>
                <a href={`https://instagram.com/${a.handle}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#8FB4F0', textDecoration: 'none' }}>↗</a>
              </div>
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
                {a.lastScrapedAt ? `${a.lastPhotosScraped || 0} imported · ${formatRel(a.lastScrapedAt)}` : 'Never scraped'}
              </div>
              <div style={{ fontSize: 11, color: a.accountStatus === 'Active' ? '#6AC68A' : a.accountStatus === 'Banned' ? '#E87878' : '#888' }}>{a.accountStatus}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => setBrowseAccount(a)}
                  style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(120,180,232,0.12)', color: '#8FB4F0', border: '1px solid rgba(120,180,232,0.25)', borderRadius: 5, cursor: 'pointer' }}>
                  👁 Browse
                </button>
                <button onClick={() => removeAccount(a)}
                  style={{ padding: '5px 10px', fontSize: 11, background: 'none', color: '#888', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer' }}>
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {browseAccount && (
        <BrowsePhotosModal
          account={browseAccount}
          onClose={() => setBrowseAccount(null)}
          onImported={(count) => {
            setAccounts(prev => prev.map(p => p.id === browseAccount.id
              ? { ...p, lastPhotosScraped: (p.lastPhotosScraped || 0) + count, lastScrapedAt: new Date().toISOString() }
              : p))
          }}
        />
      )}
    </div>
  )
}

// ─── Library ────────────────────────────────────────────────────────────────

function LibrarySection() {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/photos/library')
      const d = await r.json()
      if (d.ok) setPhotos(d.photos || [])
    } catch {} finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const setStatus = async (p, status) => {
    try {
      await fetch('/api/admin/photos/library', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, fields: { Status: status } }),
      })
      setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, status } : x))
    } catch {}
  }

  const removePhoto = async (p) => {
    if (!(await uiConfirm('Remove this photo from the library?', { danger: true, okLabel: 'Remove' }))) return
    try {
      await fetch(`/api/admin/photos/library?id=${p.id}`, { method: 'DELETE' })
      setPhotos(prev => prev.filter(x => x.id !== p.id))
    } catch {}
  }

  const filtered = photos.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (!filter) return true
    const q = filter.toLowerCase()
    return (p.handle || '').toLowerCase().includes(q) || (p.caption || '').toLowerCase().includes(q)
  })

  // Group by Source Post URL so carousel siblings sit together — when
  // you want to recreate a whole carousel (vs cherry-picking outfit
  // shots) you can see every image from the same post at a glance.
  // Singles render as 1-image groups and look the same as standalone
  // cards. Groups sort newest-first by their first member's createdTime.
  const groups = (() => {
    const byPost = new Map()
    for (const p of filtered) {
      const key = p.postUrl || p.id
      if (!byPost.has(key)) byPost.set(key, [])
      byPost.get(key).push(p)
    }
    for (const list of byPost.values()) list.sort((a, b) => (a.carouselIndex || 1) - (b.carouselIndex || 1))
    return [...byPost.entries()]
      .map(([postUrl, items]) => ({ postUrl, items, newest: items[0]?.createdTime || '' }))
      .sort((a, b) => (b.newest || '').localeCompare(a.newest || ''))
  })()

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by handle or caption…"
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', background: 'rgba(0,0,0,0.35)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'Approved', 'Pending', 'Rejected'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                background: statusFilter === s ? 'rgba(232,168,120,0.18)' : 'rgba(255,255,255,0.04)',
                color: statusFilter === s ? '#e8b878' : 'var(--foreground-muted)',
                border: `1px solid ${statusFilter === s ? 'rgba(232,168,120,0.45)' : 'rgba(255,255,255,0.12)'}`,
                cursor: 'pointer' }}>
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>{filtered.length} / {photos.length}</div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>Loading library…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
          {photos.length === 0 ? 'No photos in library yet. Switch to Accounts and Browse some IG handles.' : 'No photos match the filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(group => {
            const isCarousel = group.items.length > 1 || (group.items[0]?.carouselTotal || 1) > 1
            const total = group.items[0]?.carouselTotal || group.items.length
            const handle = group.items[0]?.handle || ''
            return (
              <div key={group.postUrl} style={isCarousel ? { padding: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 } : {}}>
                {isCarousel && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--foreground-muted)' }}>
                    <span style={{ fontSize: 14 }}>📚</span>
                    <span><b style={{ color: 'var(--foreground)' }}>{group.items.length}</b> / {total} images</span>
                    <span>·</span>
                    <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>@{handle}</a>
                    <span>·</span>
                    <a href={group.postUrl} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>↗ post</a>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  {group.items.map(p => {
                    const sc = p.status === 'Approved' ? '#6AC68A' : p.status === 'Rejected' ? '#E87878' : '#e8b878'
                    return (
                      <div key={p.id} style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                        {p.image
                          ? <img src={p.image} alt="" loading="lazy"
                              onError={(e) => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                              style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                          : <div style={{ width: '100%', aspectRatio: '4/5', background: '#000' }} />}
                        <div style={{ padding: 8, fontSize: 11 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <a href={`https://instagram.com/${p.handle}`} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>@{p.handle}</a>
                            <span style={{ color: sc, fontWeight: 700, fontSize: 10 }}>{p.status}</span>
                          </div>
                          {p.carouselTotal > 1 && (
                            <div style={{ fontSize: 10, color: 'var(--foreground-muted)', marginTop: 2 }}>🎞 {p.carouselIndex}/{p.carouselTotal}</div>
                          )}
                          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                            {p.status !== 'Approved' && <button onClick={() => setStatus(p, 'Approved')} style={iconBtn('#6AC68A')}>✓</button>}
                            {p.status !== 'Rejected' && <button onClick={() => setStatus(p, 'Rejected')} style={iconBtn('#E87878')}>✕</button>}
                            <a href={p.postUrl} target="_blank" rel="noreferrer" style={{ ...iconBtn('#8FB4F0'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>↗</a>
                            <button onClick={() => removePhoto(p)} style={{ padding: '3px 7px', fontSize: 10, background: 'none', color: '#888', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, cursor: 'pointer' }}>🗑</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function iconBtn(color) {
  return {
    padding: '3px 8px', fontSize: 10, fontWeight: 700,
    background: `${color}20`, color, border: 'none', borderRadius: 4, cursor: 'pointer',
  }
}

// ─── Browse Photos modal ────────────────────────────────────────────────────

function BrowsePhotosModal({ account, onClose, onImported }) {
  const [loading, setLoading] = useState(true)
  const [images, setImages] = useState([])
  const [postsSeen, setPostsSeen] = useState(0)
  const [debug, setDebug] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [cachedAt, setCachedAt] = useState(null) // ISO string returned by the server
  const [fromCache, setFromCache] = useState(false) // server tells us if this was a cache hit
  const [refreshing, setRefreshing] = useState(false)

  // Cache now lives on the Photo Accounts row's Scrape Cache field,
  // so it persists across modal closes, page navigations, browsers,
  // and devices. RapidAPI only gets called when there's no cache yet
  // or the editor clicks Refresh (?refresh=1). Selection still uses
  // localStorage since it's per-editor working state, not shared data.
  const SEL_KEY = `photos-preview-selection-${account.handle}`

  const load = useCallback(async ({ forceRefresh = false } = {}) => {
    setRefreshing(true); setError('')
    try {
      const params = new URLSearchParams({ handle: account.handle, limit: '80' })
      if (account.id) params.set('accountId', account.id)
      if (forceRefresh) params.set('refresh', '1')
      const r = await fetch(`/api/admin/photos/preview?${params.toString()}`)
      const text = await r.text()
      let d = null
      try { d = JSON.parse(text) } catch {
        throw new Error(`HTTP ${r.status} returned non-JSON (likely a server timeout). ${text.slice(0, 160)}`)
      }
      if (d.error) { setError(d.error); setImages([]); setPostsSeen(0); setDebug(null); return }
      setImages(d.images || [])
      setPostsSeen(d.postsSeen || 0)
      setDebug(d._debug || null)
      setCachedAt(d.cachedAt || null)
      setFromCache(!!d.fromCache)
      // Surface cache-write failures so we know when the persisted
      // cache silently didn't save — otherwise next open re-pays RapidAPI.
      if (d.cacheWriteError) setError(`Scrape returned ${d.images?.length || 0} images but cache write failed: ${d.cacheWriteError}. The result is still usable, but the next open will re-scrape (cost).`)
    } catch (e) { setError(e.message) } finally { setRefreshing(false); setLoading(false) }
  }, [account.handle, account.id])

  // Initial fetch — server decides whether to hit RapidAPI or its own cache.
  useEffect(() => {
    setLoading(true); setError('')
    load({ forceRefresh: false })
  }, [load])

  // Restore prior selection for this handle on mount.
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(SEL_KEY) : null
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setSelected(new Set(arr))
      }
    } catch {}
  }, [SEL_KEY])

  // Persist the selection set whenever it changes.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      if (selected.size === 0) localStorage.removeItem(SEL_KEY)
      else localStorage.setItem(SEL_KEY, JSON.stringify([...selected]))
    } catch {}
  }, [selected, SEL_KEY])

  const keyOf = (img) => `${img.code}|${img.carouselIndex}`
  const toggle = (img) => {
    setSelected(prev => {
      const next = new Set(prev)
      const k = keyOf(img)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }
  const selectable = images.filter(i => !i.alreadyImported)
  const allSelected = selectable.length > 0 && selectable.every(i => selected.has(keyOf(i)))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(selectable.map(keyOf)))
  }

  // Server caps each request at 50 images so the Dropbox upload loop
  // stays under Vercel's 120s function timeout. We batch on the client
  // so the user can mark hundreds in one Browse pass without worrying
  // about the limit — chunks fire sequentially, progress streams to
  // the footer, each chunk's images flip to "imported" the moment it
  // returns so the grid greys them out incrementally.
  const CHUNK_SIZE = 50
  const doImport = async () => {
    if (selected.size === 0) return
    setImporting(true); setImportMsg('')
    // Dedupe before chunking — older caches written by the buggy
    // exploder may surface the same (code, carouselIndex) multiple
    // times in `images`, and `images.filter(selected)` returns every
    // duplicate. Keep only the first occurrence per key.
    const seenPick = new Set()
    const picked = []
    for (const i of images) {
      if (!selected.has(keyOf(i))) continue
      const k = keyOf(i)
      if (seenPick.has(k)) continue
      seenPick.add(k)
      picked.push(i)
    }
    const chunks = []
    for (let i = 0; i < picked.length; i += CHUNK_SIZE) chunks.push(picked.slice(i, i + CHUNK_SIZE))
    let totalCreated = 0, totalDupes = 0, totalFailed = 0
    let importedSoFar = new Set()
    let allFailures = [] // [{code, carouselIndex, reason}]
    try {
      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        setImportMsg(`⏳ Importing batch ${c + 1}/${chunks.length} (${chunk.length} images)…`)
        const r = await fetch('/api/admin/photos/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle: account.handle, images: chunk }),
        })
        // Read as text first so a Vercel timeout / 5xx HTML page
        // surfaces as a real error instead of a cryptic JSON parse
        // failure ("Unexpected token 'A', 'An error o'...").
        const text = await r.text()
        let d = null
        try { d = JSON.parse(text) } catch {
          throw new Error(`Batch ${c + 1}/${chunks.length}: HTTP ${r.status} returned non-JSON (likely a server timeout). ${text.slice(0, 160)}`)
        }
        if (d.error) throw new Error(`Batch ${c + 1}/${chunks.length}: ${d.error}`)
        totalCreated += (d.created || 0)
        totalDupes += (d.duplicates || 0)
        totalFailed += (d.failed || 0)
        if (Array.isArray(d.failures)) allFailures = allFailures.concat(d.failures)
        // Mark this chunk's images as imported immediately so the UI
        // reflects partial progress even if a later chunk fails.
        // BUT skip the ones the server reported as failed — keep them
        // in the selection so the editor can retry just those.
        const failedKeysInChunk = new Set(
          (d.failures || []).map(f => `${f.code}|${f.carouselIndex || 1}`)
        )
        for (const img of chunk) {
          if (!failedKeysInChunk.has(keyOf(img))) importedSoFar.add(keyOf(img))
        }
        setImages(prev => prev.map(i => importedSoFar.has(keyOf(i)) ? { ...i, alreadyImported: true } : i))
      }
      // Build a one-line summary of failure reasons grouped + counted
      // so the editor sees "5 URL expired, 3 fetch error" rather than
      // just a number.
      const reasonCounts = allFailures.reduce((acc, f) => {
        // Strip the HTTP code + " — Refresh…" suffix so similar reasons
        // collapse into one bucket. e.g. "URL expired (HTTP 410) — Refresh
        // the scrape" + "URL expired (HTTP 403)" both bucket to "URL expired".
        const key = (f.reason || 'unknown').replace(/\s*\(.*$/, '').replace(/\s*—.*$/, '').trim()
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
      const reasonSummary = Object.entries(reasonCounts).map(([k, v]) => `${v} ${k}`).join(', ')
      const failHint = totalFailed > 0
        ? allFailures.some(f => /expired/i.test(f.reason)) ? ' — try ↻ Refresh then Import again (URLs go stale after ~24h)' : ''
        : ''
      setImportMsg(`✓ Imported ${totalCreated}${totalDupes ? ` (${totalDupes} dup)` : ''}${totalFailed ? ` · ${totalFailed} failed: ${reasonSummary}${failHint}` : '.'}`)
      onImported?.(totalCreated)
      // Clear selection of anything that successfully imported
      setSelected(prev => {
        const next = new Set(prev)
        for (const k of importedSoFar) next.delete(k)
        return next
      })
    } catch (e) {
      setImportMsg(`❌ ${e.message}. Imported ${totalCreated} before failure — selection preserved; click Import again to retry the rest.`)
      // Drop already-imported keys from the selection so a retry only
      // hits what's left.
      setSelected(prev => {
        const next = new Set(prev)
        for (const k of importedSoFar) next.delete(k)
        return next
      })
    } finally { setImporting(false) }
  }

  const newCount = images.filter(i => !i.alreadyImported).length
  const dupCount = images.filter(i => i.alreadyImported).length
  // Belt-and-suspenders: if the stored Handle was a URL (older row
  // added before normalization), display just the username so the
  // header doesn't render as "@https://www.instagram.com/...".
  const displayHandle = String(account.handle || '')
    .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^instagram\.com\//i, '')
    .split(/[\/?#]/)[0].replace(/^@/, '').toLowerCase()

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(1100px, 95vw)', maxHeight: '92vh', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>👁 Browse @{displayHandle}</div>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>
              {loading ? 'Loading thumbnails…' : (error ? <span style={{ color: '#E87878' }}>{error}</span> : (
                <>{images.length} images (carousels exploded) · <span style={{ color: '#7DD3A4' }}>{newCount} new</span>{dupCount ? ` · ${dupCount} already imported` : ''} · {selected.size} marked{cachedAt ? <> · <span style={{ color: fromCache ? '#888' : '#7DD3A4' }}>{fromCache ? 'cached ' : 'fresh '}{formatRel(cachedAt)}</span></> : null}</>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => load({ forceRefresh: true })} disabled={refreshing}
              title="Pull a fresh scrape from RapidAPI (costs a few cents). Otherwise we read from the Airtable cache — no RapidAPI charge."
              style={{ background: 'rgba(255,255,255,0.06)', color: refreshing ? 'var(--foreground-muted)' : 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: refreshing ? 'default' : 'pointer' }}>
              {refreshing ? '⏳ Refreshing…' : '↻ Refresh'}
            </button>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>✕</button>
          </div>
        </div>
        {!loading && !error && images.length > 0 && (
          <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <button onClick={toggleAll} style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, cursor: 'pointer' }}>
              {allSelected ? 'Clear selection' : `Select all ${newCount} new`}
            </button>
            <div style={{ color: 'var(--foreground-muted)', flex: 1 }}>Carousel images show a 🎞 N/M badge. Click to mark/unmark. Already-imported are dimmed.</div>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
          {loading && <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>⏳ Fetching from RapidAPI…</div>}
          {!loading && !error && images.length === 0 && (
            <div style={{ color: 'var(--foreground-muted)', fontSize: 13, lineHeight: 1.5 }}>
              {postsSeen > 0
                ? <>RapidAPI returned {postsSeen} post{postsSeen === 1 ? '' : 's'} but none were photos — this account may only post reels.</>
                : <>RapidAPI returned no posts. The handle may be wrong, the account may be private, or this list of accounts is empty. Try opening <a href={`https://instagram.com/${displayHandle}`} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0' }}>@{displayHandle}</a> on Instagram to confirm.</>}
              {debug && (
                <pre style={{ marginTop: 12, padding: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 6, fontSize: 11, color: 'var(--foreground-muted)', overflow: 'auto', maxHeight: 240 }}>{JSON.stringify(debug, null, 2)}</pre>
              )}
            </div>
          )}
          {!loading && images.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {images.map(img => {
                const k = keyOf(img)
                const isSel = selected.has(k)
                const isDupe = img.alreadyImported
                return (
                  <div key={k} onClick={() => !isDupe && toggle(img)}
                    style={{
                      position: 'relative',
                      border: isSel ? '3px solid var(--palm-pink, #e8a878)' : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8, overflow: 'hidden',
                      cursor: isDupe ? 'default' : 'pointer',
                      opacity: isDupe ? 0.35 : 1,
                    }}>
                    {img.thumbnail
                      ? <img src={img.thumbnail} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block', background: '#000' }} />
                      : <div style={{ width: '100%', aspectRatio: '4/5', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#666', fontSize: 11 }}>no thumb</div>}
                    {isSel && (
                      <div style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', background: 'var(--palm-pink, #e8a878)', color: '#1a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>✓</div>
                    )}
                    {isDupe && (
                      <div style={{ position: 'absolute', top: 5, left: 5, padding: '2px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.7)', color: '#7DD3A4', fontSize: 9, fontWeight: 700 }}>IMPORTED</div>
                    )}
                    {img.carouselTotal > 1 && (
                      <div style={{ position: 'absolute', bottom: 5, right: 5, padding: '2px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 9, fontWeight: 700 }}>🎞 {img.carouselIndex}/{img.carouselTotal}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', flex: 1 }}>
            {importMsg || (
              <>Mark any number — large selections auto-batch into chunks of 50. Each image downloads at full-res to Dropbox + Airtable.</>
            )}
          </div>
          <button onClick={doImport} disabled={selected.size === 0 || importing}
            style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, background: selected.size === 0 || importing ? 'rgba(232,168,120,0.18)' : 'var(--palm-pink, #e8a878)', color: selected.size === 0 || importing ? 'rgba(255,255,255,0.4)' : '#1a0a0a', border: 'none', borderRadius: 6, cursor: selected.size === 0 || importing ? 'not-allowed' : 'pointer' }}>
            {importing ? '⏳ Importing…' : (
              selected.size > 50
                ? `Import ${selected.size} (${Math.ceil(selected.size / 50)} batches)`
                : `Import ${selected.size}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Outfit Picker ──────────────────────────────────────────────────────────
//
// Curation workflow. The Library view shows every imported photo as a
// carousel-grouped grid (useful for recreating whole posts). This view
// flips that intent — it's for picking ONE image per post as "the
// outfit," or dismissing the post entirely. The point is to build a
// lean outfit-source pool for the upcoming fan-out feature where every
// outfit gets applied to every scene.
//
// Behaviour:
//   • Shows only posts where NO image has Outfit Reviewed = true
//   • Carousels render thumbnails side by side, click to pick
//   • Single-image posts let you confirm with one click
//   • "✕ No outfit" button on each group dismisses the whole post
//   • Click any thumbnail to open the enlarge modal (closer look)
//   • After pick OR dismiss, the post fades and drops out of the queue
//
// The picked image gets Is Outfit=true. Every image in a reviewed
// post (picked or dismissed) gets Outfit Reviewed=true so it won't
// reappear here. The regular Library view still shows everything.
function OutfitPickerSection() {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyPost, setBusyPost] = useState(null) // postUrl currently mid-action
  const [enlarged, setEnlarged] = useState(null) // photo object opened in modal

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/photos/library')
      const d = await r.json()
      if (d.ok) setPhotos(d.photos || [])
    } catch {} finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Group by post URL → only keep groups where NO image has been
  // reviewed yet (so a previously-reviewed post stays out of the queue
  // even if a new sibling image got added later).
  const groups = (() => {
    const byPost = new Map()
    for (const p of photos) {
      const key = p.postUrl || p.id
      if (!byPost.has(key)) byPost.set(key, [])
      byPost.get(key).push(p)
    }
    const out = []
    for (const [postUrl, items] of byPost) {
      if (items.some(i => i.outfitReviewed)) continue
      items.sort((a, b) => (a.carouselIndex || 1) - (b.carouselIndex || 1))
      out.push({ postUrl, items, newest: items[0]?.createdTime || '' })
    }
    return out.sort((a, b) => (b.newest || '').localeCompare(a.newest || ''))
  })()

  const submitReview = async (postUrl, opts) => {
    setBusyPost(postUrl)
    // Optimistic: hide the post immediately. If the request fails,
    // reload to put it back.
    const snapshot = photos
    setPhotos(prev => prev.map(p => p.postUrl === postUrl
      ? { ...p, outfitReviewed: true, isOutfit: p.id === opts.pickedId }
      : p))
    try {
      const r = await fetch('/api/admin/photos/library/outfit-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postUrl, ...opts }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`)
    } catch (e) {
      // Roll back to the pre-action photos.
      setPhotos(snapshot)
      alert(`Review failed: ${e.message}`)
    } finally { setBusyPost(null) }
  }

  const queueCount = groups.length
  const totalReviewed = photos.reduce((n, p) => n + (p.outfitReviewed ? 1 : 0), 0)
  const totalPicked = photos.reduce((n, p) => n + (p.isOutfit ? 1 : 0), 0)

  return (
    <div>
      <div style={{ padding: 12, background: 'rgba(232,168,120,0.06)', border: '1px solid rgba(232,168,120,0.2)', borderRadius: 10, marginBottom: 16, fontSize: 13, color: 'var(--foreground)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <b>👗 Outfit Picker</b> — for each post, choose the best outfit image OR dismiss if no outfit is usable. The pick gets flagged <span style={{ color: '#6AC68A' }}>Is Outfit</span> so the fan-out picker draws only those.
          </div>
          <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
            <b style={{ color: '#e8b878' }}>{queueCount}</b> posts left · <b style={{ color: '#6AC68A' }}>{totalPicked}</b> outfits picked · {totalReviewed} reviewed
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
          {photos.length === 0
            ? 'No photos in library yet. Switch to Accounts and Browse some IG handles to import images.'
            : 'Queue empty — every imported post has been reviewed. Import more photos to keep going, or go to Library to see your full outfit pool.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groups.map(group => {
            const isBusy = busyPost === group.postUrl
            const handle = group.items[0]?.handle || ''
            const isCarousel = group.items.length > 1 || (group.items[0]?.carouselTotal || 1) > 1
            const total = group.items[0]?.carouselTotal || group.items.length
            return (
              <div key={group.postUrl}
                style={{
                  padding: 14, borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  opacity: isBusy ? 0.4 : 1,
                  transition: 'opacity 0.3s',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--foreground-muted)' }}>
                    <span style={{ fontSize: 14 }}>{isCarousel ? '📚' : '🖼️'}</span>
                    <span>{isCarousel ? `${group.items.length} / ${total} images` : 'single image'}</span>
                    <span>·</span>
                    <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>@{handle}</a>
                    <span>·</span>
                    <a href={group.postUrl} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>↗ post</a>
                  </div>
                  <button onClick={() => submitReview(group.postUrl, { dismiss: true })} disabled={isBusy}
                    style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'rgba(232,120,120,0.12)', color: '#E87878', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 5, cursor: isBusy ? 'default' : 'pointer' }}>
                    ✕ No outfit in this post
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isCarousel ? 'repeat(auto-fill, minmax(140px, 1fr))' : 'repeat(auto-fill, minmax(180px, 220px))', gap: 10 }}>
                  {group.items.map(p => (
                    <div key={p.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {p.image
                        ? <img src={p.image} alt="" loading="lazy" onClick={() => setEnlarged(p)}
                            onError={(e) => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                            style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                        : <div style={{ width: '100%', aspectRatio: '4/5', background: '#000' }} />}
                      <button onClick={() => submitReview(group.postUrl, { pickedId: p.id })} disabled={isBusy}
                        title="Mark this image as the outfit choice for this post"
                        style={{ width: '100%', padding: '7px 10px', fontSize: 11, fontWeight: 700, background: 'rgba(106,198,138,0.18)', color: '#6AC68A', border: 'none', borderTop: '1px solid rgba(106,198,138,0.25)', cursor: isBusy ? 'default' : 'pointer' }}>
                        ✓ Pick as outfit
                      </button>
                      {p.carouselTotal > 1 && (
                        <div style={{ position: 'absolute', top: 5, left: 5, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, fontWeight: 700 }}>{p.carouselIndex}/{p.carouselTotal}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Click-to-enlarge image modal */}
      {enlarged && (
        <div onClick={() => setEnlarged(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ maxWidth: 'min(900px, 95vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <img src={enlarged.imageFull || enlarged.image} alt=""
              onError={(e) => { if (enlarged.imageFallback && e.currentTarget.src !== enlarged.imageFallback) e.currentTarget.src = enlarged.imageFallback }}
              style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 10, background: '#000' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#bbb' }}>
              <a href={`https://instagram.com/${enlarged.handle}`} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>@{enlarged.handle}</a>
              {enlarged.carouselTotal > 1 && <span>· image {enlarged.carouselIndex} / {enlarged.carouselTotal}</span>}
              <a href={enlarged.postUrl} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>↗ post</a>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { submitReview(enlarged.postUrl, { pickedId: enlarged.id }); setEnlarged(null) }}
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, background: 'rgba(106,198,138,0.22)', color: '#6AC68A', border: '1px solid rgba(106,198,138,0.4)', borderRadius: 6, cursor: 'pointer' }}>
                ✓ Pick this as the outfit
              </button>
              <button onClick={() => setEnlarged(null)}
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatRel(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
