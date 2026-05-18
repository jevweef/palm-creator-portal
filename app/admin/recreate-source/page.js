'use client'

import { useEffect, useState, useCallback } from 'react'

const STATUS_COLORS = {
  Queued: '#888',
  Scraping: '#E8C36A',
  Ready: '#6AC68A',
  Error: '#E87878',
}

export default function RecreateSourcePage() {
  const [sources, setSources] = useState([])
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [handles, setHandles] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/recreate-sources')
      const data = await res.json()
      if (res.ok) {
        setSources(data.sources || [])
        setCreators(data.creators || [])
        if (!creatorId && data.creators?.[0]) setCreatorId(data.creators[0].id)
      } else {
        setMsg(data.error || 'Failed to load')
      }
    } catch (e) {
      setMsg(e.message)
    } finally {
      setLoading(false)
    }
  }, [creatorId])

  useEffect(() => { load() }, [load])

  // Poll while anything is mid-scrape so status + counts update live.
  useEffect(() => {
    const anyScraping = sources.some(s => s.status === 'Scraping')
    if (!anyScraping) return
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [sources, load])

  const addHandles = async () => {
    if (!creatorId || !handles.trim()) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/admin/recreate-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, handles }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg(`Added ${data.created?.length || 0}${data.skipped?.length ? `, skipped ${data.skipped.length}` : ''}`)
        setHandles('')
        load()
      } else setMsg(data.error || 'Failed')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const scrapeQueued = async () => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/admin/recreate-scrape', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMsg(`Started ${data.started?.length || 0} scrape(s)`)
        load()
      } else setMsg(data.error || 'Failed')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const removeSource = async (id) => {
    if (!confirm('Remove this source?')) return
    try {
      await fetch(`/api/admin/recreate-sources?id=${id}`, { method: 'DELETE' })
      load()
    } catch (e) { setMsg(e.message) }
  }

  const queuedCount = sources.filter(s => s.status === 'Queued').length

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>
        AI Recreate — Source Accounts
      </h1>
      <p style={{ color: 'var(--foreground-muted)', fontSize: 13, marginBottom: 24 }}>
        Queue Instagram accounts to scrape <strong>all reels</strong> into a creator&apos;s TJP recreation pool.
        Files persist to Dropbox; the AI editor downloads from their view.
      </p>

      {creators.length === 0 && !loading && (
        <div style={{ padding: 14, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.3)', borderRadius: 8, color: '#E8A0A0', fontSize: 13, marginBottom: 20 }}>
          No TJP-enabled creators. Toggle <strong>TJP Enabled</strong> on a creator in Palm Creators first.
        </div>
      )}

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 18, marginBottom: 26 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <label style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Creator</label>
            <select
              value={creatorId}
              onChange={e => setCreatorId(e.target.value)}
              style={{ width: '100%', marginTop: 6, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 13 }}
            >
              {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={{ fontSize: 11, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instagram handles</label>
            <textarea
              value={handles}
              onChange={e => setHandles(e.target.value)}
              placeholder="latinamamiisabella, anotheraccount&#10;one per line or comma-separated"
              rows={2}
              style={{ width: '100%', marginTop: 6, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>
          <button
            onClick={addHandles}
            disabled={busy || !creatorId || !handles.trim()}
            style={{ marginTop: 22, padding: '9px 18px', background: 'var(--palm-pink)', color: '#1a0a0a', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy || !handles.trim() ? 0.5 : 1 }}
          >
            Add to Queue
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--foreground-muted)' }}>
          {sources.length} account{sources.length === 1 ? '' : 's'} · {queuedCount} queued
        </div>
        <button
          onClick={scrapeQueued}
          disabled={busy || queuedCount === 0}
          style={{ padding: '8px 16px', background: queuedCount ? 'rgba(106,198,138,0.15)' : 'transparent', color: queuedCount ? '#6AC68A' : '#666', border: `1px solid ${queuedCount ? 'rgba(106,198,138,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: queuedCount && !busy ? 'pointer' : 'default' }}
        >
          Scrape {queuedCount} Queued →
        </button>
      </div>

      {msg && <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 12 }}>{msg}</div>}

      <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#666', fontSize: 13 }}>Loading…</div>
        ) : sources.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#666', fontSize: 13 }}>No accounts queued yet.</div>
        ) : sources.map((s, i) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>@{s.handle}</div>
              <div style={{ color: 'var(--foreground-muted)', fontSize: 11 }}>{s.creatorName}</div>
            </div>
            <div style={{ width: 120, color: 'var(--foreground-muted)', fontSize: 12 }}>
              {s.reelsStored}/{s.reelsFound || '—'} stored
            </div>
            <div style={{ width: 90 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[s.status] || '#888' }}>{s.status}</span>
            </div>
            <button
              onClick={() => removeSource(s.id)}
              title="Remove"
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16, padding: 4 }}
            >×</button>
          </div>
        ))}
      </div>
    </div>
  )
}
