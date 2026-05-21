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
  const [tab, setTab] = useState('accounts') // 'accounts' | 'library'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Photos</h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 4 }}>Scrape IG photo posts (single + carousels) from accounts you trust. Feeds outfit swaps + future inspiration recreate.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { k: 'accounts', label: 'Accounts' },
            { k: 'library', label: 'Library' },
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
      {tab === 'accounts' ? <AccountsSection /> : <LibrarySection />}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {filtered.map(p => {
            const sc = p.status === 'Approved' ? '#6AC68A' : p.status === 'Rejected' ? '#E87878' : '#e8b878'
            return (
              <div key={p.id} style={{ border: `1px solid ${sc}40`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                {p.image
                  ? <img src={p.image} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
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

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    fetch(`/api/admin/photos/preview?handle=${encodeURIComponent(account.handle)}&limit=30`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) { setError(d.error); setImages([]); setPostsSeen(0); setDebug(null); return }
        setImages(d.images || [])
        setPostsSeen(d.postsSeen || 0)
        setDebug(d._debug || null)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [account.handle])

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

  const doImport = async () => {
    if (selected.size === 0) return
    setImporting(true); setImportMsg('')
    try {
      const picked = images.filter(i => selected.has(keyOf(i)))
      const r = await fetch('/api/admin/photos/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: account.handle, images: picked }),
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setImportMsg(`Imported ${d.created} image${d.created === 1 ? '' : 's'}${d.duplicates ? ` (${d.duplicates} dup)` : ''}${d.failed ? ` (${d.failed} failed)` : ''}.`)
      onImported?.(d.created || 0)
      // Mark imported so subsequent clicks don't re-add
      setImages(prev => prev.map(i => selected.has(keyOf(i)) ? { ...i, alreadyImported: true } : i))
      setSelected(new Set())
    } catch (e) { setImportMsg(`❌ ${e.message}`) } finally { setImporting(false) }
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
                <>{images.length} images (carousels exploded) · <span style={{ color: '#7DD3A4' }}>{newCount} new</span>{dupCount ? ` · ${dupCount} already imported` : ''} · {selected.size} marked</>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 14, cursor: 'pointer' }}>✕</button>
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
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', flex: 1 }}>{importMsg || 'Mark the images you want, then Import. Each downloads at full-res to Dropbox + Airtable.'}</div>
          <button onClick={doImport} disabled={selected.size === 0 || importing}
            style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, background: selected.size === 0 || importing ? 'rgba(232,168,120,0.18)' : 'var(--palm-pink, #e8a878)', color: selected.size === 0 || importing ? 'rgba(255,255,255,0.4)' : '#1a0a0a', border: 'none', borderRadius: 6, cursor: selected.size === 0 || importing ? 'not-allowed' : 'pointer' }}>
            {importing ? '⏳ Importing…' : `Import ${selected.size}`}
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
