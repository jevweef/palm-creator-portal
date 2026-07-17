'use client'

import { useEffect, useMemo, useState } from 'react'

// Link-in-bio admin. List of creator link pages + an editor. The public page
// lives at /l/<slug>. Gated links are cloaked through /l/<slug>/go/<id> so
// Instagram's link scraper never sees the OnlyFans URL in HTML.
const BLANK = () => ({
  id: null,
  slug: '',
  creatorId: '',
  displayName: '',
  handle: '',
  verified: false,
  avatarUrl: '',
  coverImageUrl: '',
  bio: '',
  customDomain: '',
  published: false,
  theme: 'Dark',
  links: [],
})

const PLATFORMS = ['OnlyFans', 'Instagram', 'TikTok', 'Twitter', 'Threads', 'Snapchat', 'YouTube', 'Patreon', 'Spotify', 'Twitch', 'Kick', 'Discord', 'Telegram', 'Fanvue', 'Amazon', 'link']

export default function LinkPagesAdmin() {
  const [pages, setPages] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [pulling, setPulling] = useState(false)
  const [domainState, setDomainState] = useState(null) // {checking, available, price, period, message}

  const load = () => {
    setLoading(true)
    fetch('/api/admin/link-pages')
      .then((r) => r.json())
      .then((d) => {
        setPages(d.pages || [])
        setCreators(d.creators || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const creatorName = useMemo(() => {
    const m = {}
    creators.forEach((c) => { m[c.id] = c.name })
    return m
  }, [creators])

  const startNew = () => { setEditing(BLANK()); setMsg(''); setDomainState(null) }
  const startEdit = (p) => { setEditing({ ...BLANK(), ...p, links: (p.links || []).map((l) => ({ ...l })) }); setMsg(''); setDomainState(null) }

  const setField = (k, v) => setEditing((e) => ({ ...e, [k]: v }))

  const addLink = () => setEditing((e) => ({ ...e, links: [...e.links, { id: null, label: '', url: '', platform: 'link', gated: false }] }))
  const setLink = (i, k, v) => setEditing((e) => {
    const links = e.links.map((l, j) => (j === i ? { ...l, [k]: v } : l))
    return { ...e, links }
  })
  const removeLink = (i) => setEditing((e) => ({ ...e, links: e.links.filter((_, j) => j !== i) }))
  const moveLink = (i, dir) => setEditing((e) => {
    const links = [...e.links]
    const j = i + dir
    if (j < 0 || j >= links.length) return e
    ;[links[i], links[j]] = [links[j], links[i]]
    return { ...e, links }
  })

  const pullSocials = async () => {
    if (!editing?.creatorId) { setMsg('Pick a creator first to pull their socials.'); return }
    setPulling(true)
    try {
      const r = await fetch(`/api/admin/link-pages?socials=${encodeURIComponent(editing.creatorId)}`)
      const d = await r.json()
      const existing = new Set(editing.links.map((l) => (l.url || '').trim().toLowerCase()))
      const fresh = (d.socials || [])
        .filter((s) => s.url && !existing.has(s.url.trim().toLowerCase()))
        .map((s) => ({
          id: null,
          label: s.label || s.platform,
          url: s.url,
          platform: s.platform || 'link',
          // OnlyFans/Fanvue links get gated by default (the whole point).
          gated: /onlyfans|fanvue/i.test(`${s.platform} ${s.url}`),
        }))
      if (!fresh.length) { setMsg('No new socials found for this creator.'); return }
      setEditing((e) => ({ ...e, links: [...e.links, ...fresh] }))
      setMsg(`Added ${fresh.length} social link${fresh.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setMsg('Could not pull socials.')
    } finally {
      setPulling(false)
    }
  }

  const checkDomain = async () => {
    const d = (editing?.customDomain || '').trim()
    if (!d) return
    setDomainState({ checking: true })
    try {
      const r = await fetch(`/api/admin/link-pages/domain-check?domain=${encodeURIComponent(d)}`)
      const j = await r.json()
      setDomainState({ checking: false, ...j })
    } catch (err) {
      setDomainState({ checking: false, error: 'Check failed' })
    }
  }

  const save = async () => {
    if (!editing.slug || !/^[a-z0-9-]+$/i.test(editing.slug)) { setMsg('Slug is required — letters, numbers, dashes only.'); return }
    setSaving(true)
    setMsg('')
    try {
      const r = await fetch('/api/admin/link-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const d = await r.json()
      if (!r.ok) { setMsg(d.error || 'Save failed'); return }
      setMsg('Saved.')
      setEditing((e) => ({ ...e, id: d.id }))
      load()
    } catch (err) {
      setMsg('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Multi-Link</h1>
        <button onClick={startNew} style={btnPrimary}>+ New page</button>
      </div>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        Link-in-bio pages for creators. Public URL: <code>/l/&lt;slug&gt;</code>. Gated links (OnlyFans) are cloaked so Instagram&apos;s scraper can&apos;t read the destination.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: editing ? '260px 1fr' : '1fr', gap: 20, alignItems: 'start' }}>
        {/* List */}
        <div style={{ border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 12, overflow: 'hidden' }}>
          <div style={sectionHead}>Pages ({pages.length})</div>
          {loading ? (
            <div style={{ padding: 16, color: 'var(--foreground-muted)', fontSize: 13 }}>Loading…</div>
          ) : pages.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--foreground-muted)', fontSize: 13 }}>No pages yet. Create one.</div>
          ) : (
            pages.map((p) => (
              <button
                key={p.id}
                onClick={() => startEdit(p)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '10px 14px', border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)',
                  background: editing?.id === p.id ? 'rgba(232,160,160,0.08)' : 'transparent',
                  color: 'var(--foreground)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {p.displayName || p.slug}
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: p.published ? 'rgba(80,200,120,0.15)' : 'rgba(255,255,255,0.08)', color: p.published ? '#54d488' : '#999' }}>
                    {p.published ? 'LIVE' : 'DRAFT'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 2 }}>
                  /l/{p.slug}{p.creatorId ? ` · ${creatorName[p.creatorId] || ''}` : ''}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Editor */}
        {editing && (
          <div style={{ border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                {editing.id ? 'Edit page' : 'New page'}
              </h2>
              {editing.slug && (
                <a href={`/l/${editing.slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--palm-pink)' }}>
                  View /l/{editing.slug} ↗
                </a>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Slug (URL)">
                <input value={editing.slug} onChange={(e) => setField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="julia" style={input} />
              </Field>
              <Field label="Creator">
                <select value={editing.creatorId} onChange={(e) => setField('creatorId', e.target.value)} style={input}>
                  <option value="">— none —</option>
                  {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Display name">
                <input value={editing.displayName} onChange={(e) => setField('displayName', e.target.value)} placeholder="Julia" style={input} />
              </Field>
              <Field label="Handle (shown under name)">
                <input value={editing.handle} onChange={(e) => setField('handle', e.target.value)} placeholder="@juliafilippo" style={input} />
              </Field>
              <Field label="Cover photo — the big hero image (Dropbox raw or image URL)" wide>
                <input value={editing.coverImageUrl} onChange={(e) => setField('coverImageUrl', e.target.value)} placeholder="https://…/hero.jpg" style={input} />
              </Field>
              <Field label="Theme">
                <select value={editing.theme} onChange={(e) => setField('theme', e.target.value)} style={input}>
                  <option value="Dark">Dark</option>
                  <option value="Light">Light</option>
                </select>
              </Field>
              <Field label="Verified badge">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--foreground)', height: 36 }}>
                  <input type="checkbox" checked={!!editing.verified} onChange={(e) => setField('verified', e.target.checked)} /> Show blue check
                </label>
              </Field>
              <Field label="Fallback avatar (used if no cover photo)" wide>
                <input value={editing.avatarUrl} onChange={(e) => setField('avatarUrl', e.target.value)} placeholder="https://…/avatar.jpg" style={input} />
              </Field>
              <Field label="Bio" wide>
                <textarea value={editing.bio} onChange={(e) => setField('bio', e.target.value)} rows={2} placeholder="Short intro line" style={{ ...input, resize: 'vertical' }} />
              </Field>
            </div>

            {/* Links */}
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>Links</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={pullSocials} disabled={pulling} style={btnGhost}>{pulling ? 'Pulling…' : 'Pull socials'}</button>
                  <button onClick={addLink} style={btnGhost}>+ Add link</button>
                </div>
              </div>
              {editing.links.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--foreground-muted)', padding: '8px 0' }}>No links yet. Add one, or pull the creator&apos;s socials.</div>
              )}
              {editing.links.map((l, i) => (
                <div key={i} style={{ marginBottom: 10, padding: 8, borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
                    <select value={l.platform} onChange={(e) => setLink(i, 'platform', e.target.value)} style={{ ...input, padding: '7px 8px' }}>
                      {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input value={l.label} onChange={(e) => setLink(i, 'label', e.target.value)} placeholder="Button label" style={{ ...input, padding: '7px 8px' }} />
                    <input value={l.url} onChange={(e) => setLink(i, 'url', e.target.value)} placeholder="https://…" style={{ ...input, padding: '7px 8px' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label title="Cloak this link from scrapers" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: l.gated ? 'var(--palm-pink)' : 'var(--foreground-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={!!l.gated} onChange={(e) => setLink(i, 'gated', e.target.checked)} /> Gate
                      </label>
                      <button onClick={() => moveLink(i, -1)} style={iconBtn} title="Move up">↑</button>
                      <button onClick={() => moveLink(i, 1)} style={iconBtn} title="Move down">↓</button>
                      <button onClick={() => removeLink(i)} style={{ ...iconBtn, color: '#e88' }} title="Remove">✕</button>
                    </div>
                  </div>
                  <input value={l.image || ''} onChange={(e) => setLink(i, 'image', e.target.value)} placeholder="Optional photo URL — makes this a full-bleed image tile (great for the gated 'More of me')" style={{ ...input, padding: '6px 8px', marginTop: 6, fontSize: 12 }} />
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 4 }}>
                <strong style={{ color: 'var(--palm-pink)' }}>Gate</strong> = cloaked. The button points to our domain; the real URL is fetched only after a &quot;checking you&apos;re human&quot; screen, so scrapers never see it. Use it for OnlyFans.
              </div>
            </div>

            {/* Custom domain */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)', marginBottom: 8 }}>Custom domain (optional)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={editing.customDomain} onChange={(e) => setField('customDomain', e.target.value)} placeholder="juliafilippo.vip" style={{ ...input, maxWidth: 320 }} />
                <button onClick={checkDomain} disabled={domainState?.checking} style={btnGhost}>{domainState?.checking ? 'Checking…' : 'Check availability'}</button>
              </div>
              {domainState && !domainState.checking && (
                <div style={{ fontSize: 12, marginTop: 8 }}>
                  {domainState.configured === false ? (
                    <span style={{ color: '#e0a94a' }}>{domainState.message}</span>
                  ) : domainState.error ? (
                    <span style={{ color: '#e88' }}>{domainState.error}</span>
                  ) : domainState.available ? (
                    <span style={{ color: '#54d488' }}>
                      ✓ {domainState.domain} is available{domainState.price != null ? ` — $${domainState.price}/${domainState.period || 'yr'}` : ''}
                    </span>
                  ) : (
                    <span style={{ color: '#e88' }}>✕ {domainState.domain} is taken</span>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginTop: 6 }}>
                v1 serves every page at <code>/l/&lt;slug&gt;</code>. Pointing the custom domain at the page is a follow-up (add it in Vercel + host-based routing).
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 22, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--foreground)', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!editing.published} onChange={(e) => setField('published', e.target.checked)} /> Published (live)
              </label>
              <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save page'}</button>
              {msg && <span style={{ fontSize: 12, color: msg === 'Saved.' ? '#54d488' : '#e0a94a' }}>{msg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, wide, children }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : 'auto' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      {children}
    </div>
  )
}

const input = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)',
  color: 'var(--foreground)', fontSize: 13, boxSizing: 'border-box',
}
const sectionHead = { padding: '10px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-muted)', background: 'rgba(255,255,255,0.02)' }
const btnPrimary = { padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--palm-pink, #E88FAC)', color: '#1a0e12', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--foreground)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const iconBtn = { width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer', padding: 0 }
