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

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { uiConfirm } from './panels'

export default function PhotosPanel() {
  // Sub-tab lives in the URL as ?sub= so refreshes (and Vercel preview
  // links shared with the team) keep the editor on the same view.
  // The parent /admin/recreate-source page already owns ?tab=photos —
  // we add a second param without disturbing it.
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const subParam = sp.get('sub')
  const validSubs = new Set(['accounts', 'library', 'outfits', 'outfit-picker'])
  const tab = validSubs.has(subParam) ? subParam : 'accounts'
  const setTab = (next) => {
    const params = new URLSearchParams(sp.toString())
    if (next === 'accounts') params.delete('sub')
    else params.set('sub', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }
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
            { k: 'outfits', label: '👗 Outfit Library' },
            { k: 'outfit-picker', label: 'Outfit Picker' },
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
        : tab === 'outfits' ? <LibrarySection outfitsOnly />
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

function LibrarySection({ outfitsOnly = false }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  // View mode persisted in URL (?view=grid|expanded). Grid = one card
  // per post (carousels collapse to their cover). Expanded = every
  // carousel image as its own card (original behavior).
  // Outfit Library is grid-only — every card is already a hand-picked
  // single outfit image, so the carousel-grouped expanded view is
  // noise. Other views default to expanded but respect ?view=.
  const viewMode = outfitsOnly
    ? 'grid'
    : (sp.get('view') === 'grid' ? 'grid' : 'expanded')
  const setViewMode = (next) => {
    const params = new URLSearchParams(sp.toString())
    if (next === 'expanded') params.delete('view'); else params.set('view', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }
  // Post the modal is showing (or null when closed).
  const [openPostUrl, setOpenPostUrl] = useState(null)

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

  // Flag one image in a post as THE outfit choice; siblings get
  // Outfit Reviewed=true so the post drops out of the Outfit Picker
  // queue. Optimistic — if the request fails, reload to put things
  // back. Same endpoint the Outfit Picker tab uses.
  const pickOutfit = async (p) => {
    const snap = photos
    setPhotos(prev => prev.map(x => x.postUrl === p.postUrl
      ? { ...x, outfitReviewed: true, isOutfit: x.id === p.id }
      : x))
    try {
      const r = await fetch('/api/admin/photos/library/outfit-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postUrl: p.postUrl, pickedId: p.id }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`)
    } catch (e) { setPhotos(snap); alert(`Pick failed: ${e.message}`) }
  }
  const dismissOutfit = async (postUrl) => {
    const snap = photos
    setPhotos(prev => prev.map(x => x.postUrl === postUrl
      ? { ...x, outfitReviewed: true, isOutfit: false }
      : x))
    try {
      const r = await fetch('/api/admin/photos/library/outfit-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postUrl, dismiss: true }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`)
    } catch (e) { setPhotos(snap); alert(`Dismiss failed: ${e.message}`) }
  }

  // Re-fetch HD bytes for an already-imported photo. The feed scrape
  // shipped ~480px candidates (~50KB JPEGs); get_media_data returns
  // 1080w (~150-200KB). Overwrites Dropbox + CF Images in place.
  const upgradeHd = async (p) => {
    setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, _upgradingHd: true } : x))
    try {
      const r = await fetch('/api/admin/photos/upgrade-hd', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: p.id }),
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`)
      // CF Images URL stays stable when the id is the same; bump a
      // cache-buster so the <img> reloads. Setting state with the new
      // cdnUrl + a query param forces the browser to refetch.
      const bust = `?v=${Date.now()}`
      setPhotos(prev => prev.map(x => x.id === p.id ? {
        ...x,
        _upgradingHd: false,
        cdnUrl: d.cdnUrl || x.cdnUrl,
        image: (d.cdnUrl || x.cdnUrl || x.image) + bust,
        _hdUpgraded: true, // surface a tiny ✓ pill so the editor knows it worked
      } : x))
      return { ok: true }
    } catch (e) {
      setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, _upgradingHd: false } : x))
      return { ok: false, error: e.message }
    }
  }

  // Pinterest-style bulk upload. Drag-and-drop a folder of saved Pins
  // into the dropzone and they all flow into the Outfit Library at
  // once — pre-flagged Is Outfit so they bypass the curation step.
  // Files go to /Palm Ops/Photos/Pinterest/ on Dropbox + CF Images,
  // metadata to the Photos table with Source Type=Pinterest.
  //
  // Chunked client-side because Vercel caps serverless request bodies
  // at 4.5 MB. We bucket files into groups whose combined size stays
  // under ~3.5 MB (margin for multipart overhead), then POST each
  // chunk sequentially.
  const [pinDrop, setPinDrop] = useState({ uploading: false, msg: '' })
  const uploadPinterest = useCallback(async (files) => {
    if (!files?.length) return
    // Build chunks. A single file > 3.5 MB still gets its own chunk
    // (we report a warning if it ends up failing because Vercel rejects
    // it on size — those should be downscaled before upload).
    const MAX_CHUNK_BYTES = 3.5 * 1024 * 1024
    const chunks = []
    let current = [], currentSize = 0
    for (const f of files) {
      const sz = f.size || 0
      if (current.length > 0 && currentSize + sz > MAX_CHUNK_BYTES) {
        chunks.push(current); current = []; currentSize = 0
      }
      current.push(f); currentSize += sz
    }
    if (current.length > 0) chunks.push(current)

    setPinDrop({ uploading: true, msg: `Uploading ${files.length} in ${chunks.length} batch${chunks.length === 1 ? '' : 'es'}…` })
    let totalCreated = 0, totalFailed = 0
    const allFailures = []
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        setPinDrop({ uploading: true, msg: `⏳ Batch ${i + 1}/${chunks.length} (${chunk.length} files, ${(chunk.reduce((s, f) => s + (f.size || 0), 0) / 1024 / 1024).toFixed(1)} MB)…` })
        const form = new FormData()
        for (const f of chunk) form.append('files', f)
        const r = await fetch('/api/admin/photos/upload-pinterest', { method: 'POST', body: form })
        const text = await r.text()
        let d = null
        try { d = JSON.parse(text) } catch {
          // 413 / 504 return HTML, not JSON. Surface it as-is so the
          // editor sees the actual cause (e.g. PAYLOAD_TOO_LARGE).
          throw new Error(`Batch ${i + 1}: HTTP ${r.status} returned non-JSON. ${text.slice(0, 160)}`)
        }
        if (!r.ok || d.error) throw new Error(`Batch ${i + 1}: ${d.error || `HTTP ${r.status}`}`)
        totalCreated += d.created || 0
        totalFailed += d.failed || 0
        if (Array.isArray(d.failures)) allFailures.push(...d.failures)
      }
      const summary = `✓ Added ${totalCreated}${totalFailed ? ` · ${totalFailed} failed (${allFailures.slice(0, 3).map(f => f.reason).join(', ')}${allFailures.length > 3 ? '…' : ''})` : ''}`
      setPinDrop({ uploading: false, msg: summary })
      load()
    } catch (e) {
      setPinDrop({ uploading: false, msg: `❌ ${e.message}. ${totalCreated > 0 ? `${totalCreated} uploaded before the failure.` : ''}` })
      if (totalCreated > 0) load()
    }
  }, [load])

  // Bulk upgrade: walk the currently-filtered list with bounded
  // concurrency so we don't drown RapidAPI / Dropbox. Each photo runs
  // through the same per-row upgradeHd path, so the card flips ⏳ → ✓
  // HD live as the batch progresses. Stops cleanly if the editor
  // navigates away or cancels.
  const [bulkHd, setBulkHd] = useState({ running: false, done: 0, failed: 0, total: 0, cancel: false })
  const upgradeAllVisibleHd = async (visiblePhotos) => {
    if (!visiblePhotos?.length) return
    const ok = await uiConfirm(`Re-fetch HD bytes for ${visiblePhotos.length} photo${visiblePhotos.length === 1 ? '' : 's'}? Each one calls RapidAPI + Dropbox + Cloudflare Images. Runs in the background — feel free to keep working while it churns.`, { okLabel: 'Upgrade all' })
    if (!ok) return
    const queue = [...visiblePhotos]
    const total = queue.length
    setBulkHd({ running: true, done: 0, failed: 0, total, cancel: false })
    const CONCURRENCY = 3 // Dropbox 429s above this, RapidAPI is fine either way
    let done = 0, failed = 0
    let cancelled = false
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length && !cancelled) {
        // Read fresh cancel flag each loop iteration via the closure of
        // setBulkHd (callback form ensures latest state).
        setBulkHd(s => { if (s.cancel) cancelled = true; return s })
        if (cancelled) break
        const next = queue.shift()
        if (!next) break
        const r = await upgradeHd(next)
        if (r?.ok) done++; else failed++
        setBulkHd(s => ({ ...s, done, failed }))
      }
    })
    await Promise.all(workers)
    setBulkHd(s => ({ ...s, running: false }))
  }

  // Toggle the lock state on a flatlay. Locked rows refuse re-runs at
  // the server (409) so a stray N/W/G click can't blow away a result
  // the editor wants to keep.
  const toggleFlatlayLock = async (p) => {
    const next = !p.flatlayLocked
    setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, flatlayLocked: next } : x))
    try {
      const r = await fetch('/api/admin/photos/library', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, fields: { 'Flatlay Locked': next } }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      // Roll back on failure.
      setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, flatlayLocked: !next } : x))
      alert(`Lock toggle failed: ${e.message}`)
    }
  }

  // Generate a product-flatlay version. `model` picks between WaveSpeed's
  // Nano Banana (default), Wan 2.7, and GPT-Image-2 — each gives a
  // different style/quality tradeoff and the editor wants to compare.
  // Server stores per-model bytes on Dropbox + CF (path/id include the
  // model key) but only the latest run wins the `Flatlay CDN URL` field.
  const generateFlatlay = async (p, model = 'nano') => {
    // Defensive client-side block — server already returns 409 when
    // locked, but we save the trip by checking here too.
    if (p.flatlayLocked) {
      alert('This flatlay is locked. Click 🔒 to unlock before re-generating.')
      return
    }
    setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, flatlayStatus: 'Generating' } : x))
    try {
      const r = await fetch('/api/admin/photos/flatlay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: p.id, model }),
      })
      const d = await r.json()
      // Coerce error to a human-readable string so we don't alert
      // "[object Object]" when the server passes through a WaveSpeed
      // object error.
      if (!r.ok || d.error) {
        const errStr = typeof d.error === 'string' ? d.error
          : d.error?.message ? d.error.message
          : d.error ? JSON.stringify(d.error)
          : `HTTP ${r.status}`
        throw new Error(errStr)
      }
      setPhotos(prev => prev.map(x => x.id === p.id ? {
        ...x,
        flatlayStatus: 'Done',
        flatlayCdnUrl: d.flatlayCdnUrl || '',
        flatlayDropboxPath: d.flatlayDropboxPath || '',
        flatlayModel: model,
      } : x))
    } catch (e) {
      setPhotos(prev => prev.map(x => x.id === p.id ? { ...x, flatlayStatus: 'Failed' } : x))
      alert(`Flatlay (${model}) failed: ${e.message}`)
    }
  }

  const filtered = photos.filter(p => {
    if (outfitsOnly && !p.isOutfit) return false
    // Hide Pinterest uploads from the regular Library — they have no
    // post URL / no carousel siblings so they'd just show as
    // standalone single-image groups, cluttering the IG carousel view.
    // The Outfit Library is where they belong.
    if (!outfitsOnly && p.sourceType === 'Pinterest') return false
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
      {outfitsOnly && (
        // Pinterest dropzone — only the Outfit Library surfaces it
        // since Pinterest uploads are pre-flagged outfit-and-reviewed.
        // Big visible target so editors can drag from Finder; click
        // also fires the native file picker as a fallback.
        <PinterestDropzone onFiles={uploadPinterest} pinDrop={pinDrop} />
      )}
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
        {!outfitsOnly && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { k: 'grid', label: '▦ Grid', title: 'One card per post — click to open all carousel images' },
              { k: 'expanded', label: '☷ Expanded', title: 'Every carousel image visible inline' },
            ].map(v => (
              <button key={v.k} onClick={() => setViewMode(v.k)} title={v.title}
                style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5,
                  background: viewMode === v.k ? 'rgba(120,180,232,0.16)' : 'rgba(255,255,255,0.04)',
                  color: viewMode === v.k ? '#8FB4F0' : 'var(--foreground-muted)',
                  border: `1px solid ${viewMode === v.k ? 'rgba(120,180,232,0.4)' : 'rgba(255,255,255,0.12)'}`,
                  cursor: 'pointer' }}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>
          {viewMode === 'grid' ? `${groups.length} posts` : `${filtered.length} / ${photos.length}`}
        </div>
        {!bulkHd.running ? (
          <button onClick={() => upgradeAllVisibleHd(photos)} disabled={photos.length === 0}
            title={`Re-fetch HD bytes (1080w) for ALL ${photos.length} photo${photos.length === 1 ? '' : 's'} in the library, regardless of the filter. Runs in parallel — uses the same per-row upgrade route.`}
            style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 5, background: photos.length === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(120,180,232,0.16)', color: photos.length === 0 ? 'var(--foreground-muted)' : '#8FB4F0', border: `1px solid ${photos.length === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(120,180,232,0.35)'}`, cursor: photos.length === 0 ? 'default' : 'pointer' }}>
            ↑ Upgrade all to HD ({photos.length})
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#8FB4F0' }}>⏳ {bulkHd.done + bulkHd.failed} / {bulkHd.total}{bulkHd.failed ? ` · ${bulkHd.failed} failed` : ''}</span>
            <button onClick={() => setBulkHd(s => ({ ...s, cancel: true }))}
              title="Cancel the bulk upgrade after the in-flight ones finish"
              style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(232,120,120,0.12)', color: '#E87878', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 5, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>Loading library…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
          {photos.length === 0 ? 'No photos in library yet. Switch to Accounts and Browse some IG handles.' : 'No photos match the filter.'}
        </div>
      ) : viewMode === 'grid' ? (
        // One card per post (cover image only). Click opens a modal
        // with every carousel image + the same per-image actions the
        // expanded view exposes inline.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
          {groups.map(group => {
            const cover = group.items[0]
            if (!cover) return null
            const total = cover.carouselTotal || group.items.length
            const isCarousel = group.items.length > 1 || total > 1
            const sc = cover.status === 'Approved' ? '#6AC68A' : cover.status === 'Rejected' ? '#E87878' : '#e8b878'
            // All cards open the modal — that's where the flatlay
            // generation (📦N/W/G), dual-view comparison, lock toggle,
            // and per-image downloads live. Even single-image posts
            // (Pinterest uploads, IG singles) get the modal so the
            // editor can run flatlays on them.
            return (
              <div key={group.postUrl}
                onClick={() => setOpenPostUrl(group.postUrl)}
                style={{ position: 'relative', border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)', cursor: 'pointer' }}>
                {cover.image
                  ? <img src={cover.image} alt="" loading="lazy"
                      onError={(e) => { if (cover.imageFallback && e.currentTarget.src !== cover.imageFallback) e.currentTarget.src = cover.imageFallback }}
                      style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', aspectRatio: '4/5', background: '#000' }} />}
                {isCarousel && (
                  <div style={{ position: 'absolute', top: 6, right: 6, padding: '3px 7px', borderRadius: 4, background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 10, fontWeight: 700 }}>📚 {group.items.length}/{total}</div>
                )}
                {/* Top-left delete pill — visible without opening the
                    modal. stopPropagation so the card click (which
                    opens the modal) doesn't fire underneath. */}
                <button onClick={(e) => { e.stopPropagation(); removePhoto(cover) }}
                  title="Delete this photo (removes Dropbox file + Cloudflare variant too)"
                  style={{
                    position: 'absolute', top: 6, left: 6,
                    padding: '4px 8px', borderRadius: 4,
                    background: 'rgba(232,120,120,0.85)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.18)',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}>
                  🗑
                </button>
                <div style={{ padding: '7px 9px', fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#8FB4F0' }}>@{cover.handle}</span>
                  <span style={{ color: sc, fontWeight: 700, fontSize: 10 }}>{cover.status}</span>
                </div>
              </div>
            )
          })}
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
                  {group.items.map(p => (
                    <PhotoCard key={p.id} p={p} setStatus={setStatus} removePhoto={removePhoto} generateFlatlay={generateFlatlay} upgradeHd={upgradeHd} toggleFlatlayLock={toggleFlatlayLock} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Post modal — only used in grid view. Opens when a card is
          clicked, shows every image from the post with the same
          per-image actions as the expanded view. */}
      {openPostUrl && (() => {
        const group = groups.find(g => g.postUrl === openPostUrl)
        if (!group) return null
        const cover = group.items[0] || {}
        const total = cover.carouselTotal || group.items.length
        const isCarousel = group.items.length > 1 || total > 1
        return (
          <div onClick={() => setOpenPostUrl(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: 'min(1600px, 96vw)', maxHeight: '94vh', background: 'var(--card-bg-solid, #16161c)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--foreground-muted)' }}>
                  <span style={{ fontSize: 15 }}>{isCarousel ? '📚' : '🖼️'}</span>
                  <span>{isCarousel ? <><b style={{ color: 'var(--foreground)' }}>{group.items.length}</b> / {total} images</> : 'single image'}</span>
                  <span>·</span>
                  <a href={`https://instagram.com/${cover.handle}`} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>@{cover.handle}</a>
                  <span>·</span>
                  <a href={openPostUrl} target="_blank" rel="noreferrer" style={{ color: '#8FB4F0', textDecoration: 'none' }}>↗ post</a>
                  {group.items.some(p => p.outfitReviewed) && (
                    <>
                      <span>·</span>
                      <span style={{ color: group.items.some(p => p.isOutfit) ? '#6AC68A' : 'var(--foreground-muted)' }}>
                        {group.items.some(p => p.isOutfit) ? '👗 outfit picked' : '✕ no outfit'}
                      </span>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <a href={`/api/admin/photos/download-zip?postUrl=${encodeURIComponent(openPostUrl)}`}
                    title="Download all images in this post as a .zip"
                    style={{ background: 'rgba(120,180,232,0.14)', color: '#8FB4F0', border: '1px solid rgba(120,180,232,0.3)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}>
                    ⬇ Download .zip
                  </a>
                  {!group.items.some(p => p.outfitReviewed) && (
                    <button onClick={() => dismissOutfit(openPostUrl)}
                      title="Mark this post as having no usable outfit (drops it from the Outfit Picker queue without flagging an outfit)"
                      style={{ background: 'rgba(232,120,120,0.12)', color: '#E87878', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      ✕ No outfit
                    </button>
                  )}
                  <button onClick={() => setOpenPostUrl(null)}
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px' }}>
                {/* Layout depends on context:
                    • Outfit Library → dualView cards (original + flatlay
                      side-by-side), so cards need ~520px each
                    • Regular Library → single-image cards with the
                      flatlay toggle; narrower, fit more per row
                    1-item carousels center as a single big card either
                    way so we don't waste modal real estate. */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: group.items.length === 1
                    ? `minmax(0, ${outfitsOnly ? 900 : 600}px)`
                    : `repeat(auto-fit, minmax(${outfitsOnly ? 520 : 280}px, 1fr))`,
                  justifyContent: group.items.length === 1 ? 'center' : 'stretch',
                  gap: 16,
                }}>
                  {group.items.map(p => (
                    <PhotoCard key={p.id} p={p} setStatus={setStatus} removePhoto={removePhoto} pickOutfit={pickOutfit} generateFlatlay={generateFlatlay} upgradeHd={upgradeHd} toggleFlatlayLock={toggleFlatlayLock} dualView={outfitsOnly} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// Shared card used by both the expanded view and the grid-view modal so
// the per-image actions stay identical. pickOutfit + generateFlatlay
// are optional — passed only from the post modal so the inline expanded
// view stays uncluttered (use the Outfit Picker tab + flatlay icons there).
//
// dualView: when true (the post modal), render original + flatlay
// side-by-side instead of one with a toggle. The grid view stays as
// toggle-style because each row needs the compact footprint.
function PhotoCard({ p, setStatus, removePhoto, pickOutfit, generateFlatlay, upgradeHd, toggleFlatlayLock, dualView = false }) {
  const sc = p.status === 'Approved' ? '#6AC68A' : p.status === 'Rejected' ? '#E87878' : '#e8b878'
  // Flatlay button is only meaningful on outfit-flagged rows (the whole
  // feature is about analyzing the clothes the subject is wearing).
  // Status flow: None → Generating → Done | Failed.
  const fl = p.flatlayStatus || 'None'
  const flatlayReady = fl === 'Done' && !!p.flatlayCdnUrl
  const [showFlatlay, setShowFlatlay] = useState(false)
  // Side-by-side when dualView is on AND a flatlay actually exists —
  // otherwise we fall through to the regular single-image render so the
  // card doesn't show a wasted empty pane when generation hasn't
  // happened yet.
  const showDual = dualView && flatlayReady
  return (
    <div style={{ position: 'relative', border: `1px solid ${p.flatlayLocked ? '#6AC68A' : p.isOutfit ? '#6AC68A' : `${sc}40`}`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
      {showDual ? (
        // Two-pane layout — original on the left, AI flatlay on the right.
        // Each pane gets its own label + ⬇ overlay so the editor can
        // download exactly the version they want without leaving the modal.
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ position: 'relative', background: '#000' }}>
            <img src={p.image} alt="" loading="lazy"
              onError={(e) => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
              style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', bottom: 6, left: 6, padding: '3px 7px', borderRadius: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, fontWeight: 700 }}>📷 original</div>
            <a href={originalDownloadHref(p)} download={originalDownloadName(p)}
              title="Download original" style={paneDownloadBtn}>⬇</a>
          </div>
          <div style={{ position: 'relative', background: '#fff' }}>
            <img src={p.flatlayCdnUrl} alt="" loading="lazy"
              style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', bottom: 6, left: 6, padding: '3px 7px', borderRadius: 4, background: 'rgba(232,168,120,0.92)', color: '#1a0a0a', fontSize: 10, fontWeight: 800 }}>
              📦 flatlay{p.flatlayModel ? ` · ${p.flatlayModel.toUpperCase()}` : ''}
            </div>
            <a href={flatlayDownloadHref(p)} download={flatlayDownloadName(p)}
              title="Download flatlay" style={paneDownloadBtn}>⬇</a>
            {p.flatlayLocked && (
              <div style={{ position: 'absolute', top: 6, left: 6, padding: '3px 7px', borderRadius: 4, background: 'rgba(106,198,138,0.92)', color: '#0a1a10', fontSize: 10, fontWeight: 800 }}>🔒 LOCKED</div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* In modal context (dualView=true) the image fits to height
              with object-fit: contain so a tall Pinterest portrait
              doesn't push the action buttons off-screen. In grid
              context, keep the 4/5 cover-crop tile look. */}
          {p.image
            ? <img src={(showFlatlay && p.flatlayCdnUrl) ? p.flatlayCdnUrl : p.image} alt="" loading="lazy"
                onError={(e) => { if (p.imageFallback && e.currentTarget.src !== p.imageFallback) e.currentTarget.src = p.imageFallback }}
                style={dualView
                  ? { width: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block', margin: '0 auto', background: showFlatlay ? '#fff' : '#000' }
                  : { width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block', background: showFlatlay ? '#fff' : '#000' }} />
            : <div style={{ width: '100%', aspectRatio: '4/5', background: '#000' }} />}
          {flatlayReady && (
            <button onClick={() => setShowFlatlay(v => !v)}
              title={showFlatlay ? 'Switch to original photo' : `Switch to AI flatlay${p.flatlayModel ? ` (${p.flatlayModel.toUpperCase()})` : ''}`}
              style={{ position: 'absolute', top: 6, right: 6, padding: '3px 7px', borderRadius: 4, background: 'rgba(0,0,0,0.7)', color: showFlatlay ? '#e8a878' : '#fff', fontSize: 10, fontWeight: 700, border: '1px solid rgba(255,255,255,0.18)', cursor: 'pointer' }}>
              {showFlatlay ? '📷 original' : `📦 flatlay${p.flatlayModel ? ` · ${p.flatlayModel.toUpperCase()}` : ''}`}
            </button>
          )}
        </>
      )}
      {p.isOutfit && (
        <div style={{ position: 'absolute', top: 6, left: 6, padding: '3px 7px', borderRadius: 4, background: 'rgba(106,198,138,0.85)', color: '#0a1a10', fontSize: 10, fontWeight: 800, zIndex: 2 }}>👗 OUTFIT</div>
      )}
      {fl === 'Generating' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', color: '#e8a878', fontSize: 12, fontWeight: 700, pointerEvents: 'none', zIndex: 3 }}>
          ⏳ generating flatlay…
        </div>
      )}
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
          {pickOutfit && !p.isOutfit && (
            <button onClick={() => pickOutfit(p)} title="Pick as the outfit for this post (flags sibling images as reviewed)"
              style={iconBtn('#e8a878')}>👗</button>
          )}
          {generateFlatlay && p.isOutfit && fl !== 'Generating' && (
            // Three side-by-side icons let the editor try each model
            // and pick the best result — N (Nano-Banana, default fast/cheap),
            // W (Wan 2.7), G (GPT-Image-2). The latest run wins.
            // Locked → buttons disabled until 🔒 is toggled off.
            <>
              <button onClick={() => generateFlatlay(p, 'nano')} disabled={p.flatlayLocked}
                title={p.flatlayLocked ? 'Unlock the flatlay (🔒 button) before re-generating' : 'Generate flatlay with Nano-Banana 2 (default — fast, cheap)'}
                style={{ ...iconBtn('#e8a878'), opacity: p.flatlayLocked ? 0.35 : 1, cursor: p.flatlayLocked ? 'not-allowed' : 'pointer' }}>📦N</button>
              <button onClick={() => generateFlatlay(p, 'wan')} disabled={p.flatlayLocked}
                title={p.flatlayLocked ? 'Unlock first' : 'Generate flatlay with Wan 2.7 image-edit-pro'}
                style={{ ...iconBtn('#e8a878'), opacity: p.flatlayLocked ? 0.35 : 1, cursor: p.flatlayLocked ? 'not-allowed' : 'pointer' }}>📦W</button>
              <button onClick={() => generateFlatlay(p, 'gpt')} disabled={p.flatlayLocked}
                title={p.flatlayLocked ? 'Unlock first' : 'Generate flatlay with GPT-Image-2 (slowest, often most accurate)'}
                style={{ ...iconBtn('#e8a878'), opacity: p.flatlayLocked ? 0.35 : 1, cursor: p.flatlayLocked ? 'not-allowed' : 'pointer' }}>📦G</button>
            </>
          )}
          {toggleFlatlayLock && flatlayReady && (
            <button onClick={() => toggleFlatlayLock(p)}
              title={p.flatlayLocked ? 'Unlock so N/W/G can re-generate' : 'Lock this flatlay so re-runs can\'t overwrite it'}
              style={iconBtn(p.flatlayLocked ? '#6AC68A' : '#888')}>
              {p.flatlayLocked ? '🔒' : '🔓'}
            </button>
          )}
          {upgradeHd && (
            <button onClick={() => upgradeHd(p)} disabled={p._upgradingHd}
              title="Re-fetch the high-res version from Instagram (1080w instead of the ~480w feed thumbnail) and replace the Dropbox + CDN copy."
              style={iconBtn(p._hdUpgraded ? '#6AC68A' : '#8FB4F0')}>
              {p._upgradingHd ? '⏳' : p._hdUpgraded ? '✓ HD' : '↑ HD'}
            </button>
          )}
          {/* Direct download — context-aware. In single-view mode with
              the flatlay toggle active, this saves the flatlay; otherwise
              it saves the original. In dual-view mode the per-pane ⬇
              buttons handle it (this row stays but acts as a duplicate
              for the original). Routes through our Dropbox proxy so the
              file lands with a clean filename + correct MIME, sidestepping
              cross-origin download-attr restrictions on CDN URLs. */}
          {(p.dropboxPath || p.flatlayDropboxPath || p.image) && (() => {
            const wantFlatlay = (showFlatlay || showDual) && flatlayReady && p.flatlayDropboxPath
            const href = wantFlatlay ? flatlayDownloadHref(p) : originalDownloadHref(p)
            const name = wantFlatlay ? flatlayDownloadName(p) : originalDownloadName(p)
            return (
              <a href={href} download={name}
                title={wantFlatlay ? 'Download the AI flatlay' : 'Download the original (HD from Dropbox)'}
                style={{ ...iconBtn('#e8a878'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                ⬇
              </a>
            )
          })()}
          {/* Open the file's Dropbox preview page — useful when you
              want to see the full bytes, share with someone outside
              the portal, or grab the file path. */}
          {p.dropbox && (
            <a href={p.dropbox} target="_blank" rel="noreferrer"
              title="Open in Dropbox"
              style={{ ...iconBtn('#8FB4F0'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              📁
            </a>
          )}
          {p.postUrl && (
            <a href={p.postUrl} target="_blank" rel="noreferrer"
              title="Open the source Instagram post"
              style={{ ...iconBtn('#8FB4F0'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>↗</a>
          )}
        </div>
        {/* Delete on its own row, full-width, red — was a faint gray 🗑
            tucked in the action wrap; users missed it (especially on
            Pinterest cards where there's no other red affordance). */}
        <button onClick={() => removePhoto(p)}
          title="Delete this photo from the library (also removes the Dropbox file + Cloudflare Images variant)"
          style={{
            width: '100%', marginTop: 8, padding: '6px 8px',
            fontSize: 11, fontWeight: 700,
            background: 'rgba(232,120,120,0.12)', color: '#E87878',
            border: '1px solid rgba(232,120,120,0.3)', borderRadius: 5,
            cursor: 'pointer',
          }}>
          🗑 Delete
        </button>
      </div>
    </div>
  )
}

function iconBtn(color) {
  return {
    padding: '3px 8px', fontSize: 10, fontWeight: 700,
    background: `${color}20`, color, border: 'none', borderRadius: 4, cursor: 'pointer',
  }
}

// Drag-and-drop zone for the Outfit Library. Accepts image files,
// hands them to `onFiles` which posts them as multipart to the
// /upload-pinterest route. Plain click triggers a hidden file input
// for editors who don't want to drag.
function PinterestDropzone({ onFiles, pinDrop }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)
  const handleFiles = (fileList) => {
    if (!fileList) return
    const files = [...fileList].filter(f => f.type?.startsWith('image/'))
    if (files.length) onFiles(files)
  }
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files) }}
      style={{
        marginBottom: 14, padding: '18px 16px', borderRadius: 10,
        border: `2px dashed ${over ? '#e8a878' : 'rgba(255,255,255,0.18)'}`,
        background: over ? 'rgba(232,168,120,0.08)' : 'rgba(255,255,255,0.02)',
        cursor: pinDrop.uploading ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 14, transition: 'all 0.15s',
      }}>
      <div style={{ fontSize: 24 }}>📌</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
          {pinDrop.uploading ? '⏳ Uploading…' : 'Drop outfit images here (saved Pins, screenshots, anything)'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 2 }}>
          {pinDrop.msg
            ? pinDrop.msg
            : 'Each file lands in the Outfit Library pre-flagged 👗 OUTFIT. Up to 50 per upload. Tagged Pinterest so they stay out of the IG carousel Library.'}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: 'none' }} />
    </div>
  )
}

// Floating ⬇ pill rendered over each pane in the dual-view modal.
// Bottom-right keeps it clear of the label (bottom-left) and the
// 🔒 badge (top-left).
const paneDownloadBtn = {
  position: 'absolute', bottom: 6, right: 6,
  padding: '4px 9px', borderRadius: 4,
  background: 'rgba(0,0,0,0.7)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
  fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'none',
}

// Build sensible filenames from the post metadata so the user's
// download folder doesn't fill up with dropbox-shared-link gibberish.
function postCodeFor(p) {
  return String(p.postUrl || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] || 'post'
}
function originalDownloadName(p) {
  return `${p.handle || 'photo'}_${postCodeFor(p)}_${String(p.carouselIndex || 1).padStart(2, '0')}.jpg`
}
function flatlayDownloadName(p) {
  const model = p.flatlayModel ? `_${p.flatlayModel}` : ''
  return `${p.handle || 'photo'}_${postCodeFor(p)}_${String(p.carouselIndex || 1).padStart(2, '0')}_flatlay${model}.jpg`
}
// Originals route through Dropbox proxy with ?download= so the file
// saves with our intended filename (instead of the raw Dropbox name)
// and the browser doesn't get confused by application/json MIME on
// the shared link.
function originalDownloadHref(p) {
  if (p.dropboxPath) {
    return `/api/admin/photos/image?path=${encodeURIComponent(p.dropboxPath)}&download=${encodeURIComponent(originalDownloadName(p))}`
  }
  // Legacy rows with no Dropbox Path — fall back to the shared link.
  return p.dropbox ? String(p.dropbox).replace('dl=0', 'dl=1').replace('?raw=1', '?dl=1') : (p.image || '')
}
// Flatlays: route through the same proxy with the flatlay Dropbox path
// so cross-origin restrictions on imagedelivery.net don't block the
// download-attribute behavior. CDN URL is passed as ?fallback= so
// older rows whose Dropbox upload silently failed still produce a
// real file instead of a broken-link icon.
function flatlayDownloadHref(p) {
  const dl = encodeURIComponent(flatlayDownloadName(p))
  const fallback = p.flatlayCdnUrl ? `&fallback=${encodeURIComponent(p.flatlayCdnUrl)}` : ''
  if (p.flatlayDropboxPath) {
    return `/api/admin/photos/image?path=${encodeURIComponent(p.flatlayDropboxPath)}&download=${dl}${fallback}`
  }
  // No Dropbox path at all — route the CDN URL through the proxy with
  // an empty path so the fallback branch kicks in and we still set
  // Content-Disposition. We use a sentinel path that exists nowhere
  // so the lookup misses immediately.
  if (p.flatlayCdnUrl) {
    return `/api/admin/photos/image?path=/Palm%20Ops/__no_local__&download=${dl}${fallback}`
  }
  return ''
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
      <EnlargeModal enlarged={enlarged} photos={photos} setEnlarged={setEnlarged} submitReview={submitReview} />
    </div>
  )
}

// Enlarge modal lives in its own component so the keydown listener
// can mount/unmount cleanly with `enlarged`. Arrow keys walk through
// the carousel siblings (same Source Post URL, sorted by Carousel
// Index); Escape closes. Visible chevrons exist only when the post
// has more than one image.
function EnlargeModal({ enlarged, photos, setEnlarged, submitReview }) {
  const siblings = enlarged
    ? photos
        .filter(p => p.postUrl === enlarged.postUrl)
        .sort((a, b) => (a.carouselIndex || 1) - (b.carouselIndex || 1))
    : []
  const idx = enlarged ? siblings.findIndex(p => p.id === enlarged.id) : -1
  const prev = idx > 0 ? siblings[idx - 1] : null
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null

  useEffect(() => {
    if (!enlarged) return
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); setEnlarged(prev) }
      else if (e.key === 'ArrowRight' && next) { e.preventDefault(); setEnlarged(next) }
      else if (e.key === 'Escape') { setEnlarged(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enlarged, prev, next, setEnlarged])

  if (!enlarged) return null
  const navBtn = (side) => ({
    position: 'absolute', top: '50%', [side]: 16, transform: 'translateY(-50%)',
    width: 48, height: 48, borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
    fontSize: 22, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  })
  return (
    <div onClick={() => setEnlarged(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {prev && (
        <button onClick={(e) => { e.stopPropagation(); setEnlarged(prev) }} title="Previous (←)" style={navBtn('left')}>‹</button>
      )}
      {next && (
        <button onClick={(e) => { e.stopPropagation(); setEnlarged(next) }} title="Next (→)" style={navBtn('right')}>›</button>
      )}
      <div onClick={e => e.stopPropagation()}
        style={{ maxWidth: 'min(900px, 95vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <img src={enlarged.imageFull || enlarged.image} alt=""
          onError={(e) => { if (enlarged.imageFallback && e.currentTarget.src !== enlarged.imageFallback) e.currentTarget.src = enlarged.imageFallback }}
          style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 10, background: '#000' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#bbb' }}>
          <a href={`https://instagram.com/${enlarged.handle}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#8FB4F0', textDecoration: 'none' }}>@{enlarged.handle}</a>
          {siblings.length > 1 && <span>· image {idx + 1} / {siblings.length} · ← → to navigate</span>}
          <a href={enlarged.postUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#8FB4F0', textDecoration: 'none' }}>↗ post</a>
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
