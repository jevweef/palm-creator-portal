'use client'

import { useState, useEffect, useCallback } from 'react'
import InspoCard from '@/components/InspoCard'

function formatTime(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    const now = new Date()
    const diffH = Math.round((now - d) / 3600000)
    if (diffH < 1) return 'Just now'
    if (diffH < 24) return `${diffH}h ago`
    if (diffH < 48) return 'Yesterday'
    return `${Math.round(diffH / 24)}d ago`
  } catch { return ts }
}

function StatusPill({ status }) {
  const colors = {
    Processing: { bg: '#fef3c7', text: '#f59e0b', border: '#fde68a' },
    Complete: { bg: '#dcfce7', text: '#22c55e', border: '#bbf7d0' },
    Error: { bg: '#FEF2F2', text: '#ef4444', border: '#FECACA' },
  }
  const c = colors[status] || { bg: '#FFF0F3', text: '#999', border: '#E8C4CC' }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 600,
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border}`,
    }}>
      {status || '—'}
    </span>
  )
}

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return String(n)
}

function shortcode(url) {
  const m = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : url
}

const GRADE_COLORS = {
  'A+': '#E88FAC', A: '#E88FAC', 'A-': '#E88FAC',
  'B+': '#22c55e', B: '#22c55e', 'B-': '#22c55e',
  'C+': '#f59e0b', C: '#f59e0b', 'C-': '#f59e0b',
  D: '#ef4444', F: '#ef4444',
}

function ReelsModal({ source, sources, allCreators, onClose, onNavigate, onCreatorsChange }) {
  const [reels, setReels] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState({})
  const [editMode, setEditMode] = useState(false)
  const [assignedCreators, setAssignedCreators] = useState(source.palmCreators || [])
  const [savingCreators, setSavingCreators] = useState(false)

  const currentIdx = sources.findIndex(s => s.id === source.id)

  useEffect(() => {
    setAssignedCreators(source.palmCreators || [])
  }, [source.id])

  const toggleCreator = async (creatorId) => {
    const current = assignedCreators
    const next = current.includes(creatorId)
      ? current.filter(id => id !== creatorId)
      : [...current, creatorId]
    setAssignedCreators(next)
    setSavingCreators(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Plain string array — REST API, not Airtable.js SDK
        body: JSON.stringify({ id: source.id, fields: { 'Palm Creators': next } }),
      })
      onCreatorsChange(source.id, next)
    } catch {
      setAssignedCreators(current) // revert
    } finally {
      setSavingCreators(false)
    }
  }

  useEffect(() => {
    setReels(null)
    setLoading(true)
    setEditMode(false)
    fetch(`/api/admin/sources/reels?handle=${encodeURIComponent(source.handle)}`)
      .then(r => r.json())
      .then(d => setReels(d.reels || []))
      .catch(() => setReels([]))
      .finally(() => setLoading(false))
  }, [source.handle])

  const toggleHidden = async (reel) => {
    const newHidden = !reel.hidden
    setToggling(t => ({ ...t, [reel.id]: true }))
    setReels(prev => prev.map(r => r.id === reel.id ? { ...r, hidden: newHidden } : r))
    try {
      await fetch('/api/admin/sources/reels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: reel.id, hidden: newHidden }),
      })
    } catch {
      // revert on error
      setReels(prev => prev.map(r => r.id === reel.id ? { ...r, hidden: !newHidden } : r))
    } finally {
      setToggling(t => ({ ...t, [reel.id]: false }))
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '60px', overflowY: 'auto', paddingBottom: '60px' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', width: '1100px', maxWidth: '95vw', padding: '24px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>@{source.handle}</div>
              <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                {loading ? 'Loading...' : `${reels?.length || 0} reels on inspo board`}
                {sources.length > 1 && <span style={{ color: '#3f3f46', marginLeft: '8px' }}>{currentIdx + 1} / {sources.length}</span>}
              </div>
            </div>
            {/* Prev / Next with handle labels */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => currentIdx > 0 && onNavigate(sources[currentIdx - 1])}
                disabled={currentIdx <= 0}
                style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: currentIdx <= 0 ? '#3f3f46' : '#999', fontSize: '12px', cursor: currentIdx <= 0 ? 'default' : 'pointer', padding: '4px 10px', lineHeight: 1.5, whiteSpace: 'nowrap' }}
              >{currentIdx > 0 ? `‹ @${sources[currentIdx - 1].handle}` : '‹'}</button>
              <button
                onClick={() => currentIdx < sources.length - 1 && onNavigate(sources[currentIdx + 1])}
                disabled={currentIdx >= sources.length - 1}
                style={{ background: 'none', border: '1px solid #E8C4CC', borderRadius: '6px', color: currentIdx >= sources.length - 1 ? '#3f3f46' : '#999', fontSize: '12px', cursor: currentIdx >= sources.length - 1 ? 'default' : 'pointer', padding: '4px 10px', lineHeight: 1.5, whiteSpace: 'nowrap' }}
              >{currentIdx < sources.length - 1 ? `@${sources[currentIdx + 1].handle} ›` : '›'}</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setEditMode(m => !m)}
              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: editMode ? '#450a0a' : 'none', color: editMode ? '#fca5a5' : '#999', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: 'pointer' }}
            >{editMode ? '✕ Done removing' : 'Remove reels'}</button>
            <a
              href={`https://instagram.com/${source.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E8C4CC', borderRadius: '6px', textDecoration: 'none' }}
            >
              Open Profile ↗
            </a>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Creator Assignment */}
        {allCreators.length > 0 && (
          <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#FFF5F7', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Assigned to creators {savingCreators && <span style={{ color: '#3f3f46' }}>saving...</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {allCreators.map(c => {
                const assigned = assignedCreators.includes(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCreator(c.id)}
                    disabled={savingCreators}
                    style={{
                      padding: '4px 10px', fontSize: '12px', fontWeight: 600,
                      borderRadius: '20px', cursor: 'pointer', border: 'none',
                      background: assigned ? '#FFF0F3' : '#ffffff',
                      color: assigned ? '#E88FAC' : '#666',
                      outline: assigned ? '1px solid #E88FAC' : '1px solid #E8C4CC',
                      transition: 'all 0.15s',
                    }}
                  >
                    {c.aka || c.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px' }}>Loading...</div>
        ) : reels?.length === 0 ? (
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px' }}>No inspo board reels for this account yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            {reels.map(reel => (
              <div key={reel.id} style={{ opacity: reel.hidden ? 0.5 : 1, transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', borderRadius: '12px', overflow: 'hidden' }}>
                <InspoCard
                  record={reel}
                  grade={reel.grade}
                  onClick={() => window.open(reel.dbShareLink || reel.contentLink, '_blank')}
                />
                {editMode && (
                  <button
                    onClick={() => toggleHidden(reel)}
                    disabled={toggling[reel.id]}
                    style={{
                      width: '100%', padding: '10px',
                      fontSize: '12px', fontWeight: 700,
                      border: 'none', cursor: 'pointer',
                      background: reel.hidden ? '#14532d' : '#450a0a',
                      color: reel.hidden ? '#4ade80' : '#fca5a5',
                      opacity: toggling[reel.id] ? 0.5 : 1,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {reel.hidden ? '↩ Add back' : '✕ Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const COST_PER_REEL = 0.0084

function RescrapeModal({ source, newLimit, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false)
  const oldLimit = source.apifyLimit || 100
  const estCost = (newLimit * COST_PER_REEL).toFixed(2)

  const confirm = async () => {
    setSaving(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id, fields: { 'Apify Limit': newLimit } }),
      })
      await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: [source.handle], force: true }),
      })
      onConfirm(newLimit)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px',
        padding: '24px', width: '380px',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
          Update & Re-scrape @{source.handle}?
        </h3>
        <p style={{ fontSize: '13px', color: '#a3a3a3', marginBottom: '16px', lineHeight: 1.5 }}>
          Limit: <span style={{ color: '#999' }}>{oldLimit}</span> → <span style={{ color: '#E88FAC', fontWeight: 600 }}>{newLimit}</span> reels
        </p>

        <div style={{ background: '#FFFBEB', border: '1px solid #fde68a', borderRadius: '10px', padding: '20px', marginBottom: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#f59e0b', marginBottom: '4px' }}>~${estCost}</div>
          <div style={{ fontSize: '12px', color: '#a3a3a3' }}>Estimated Apify cost for {newLimit} reels</div>
          <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '8px' }}>Duplicates auto-skipped (free)</div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ ...btnStyle, background: '#E8C4CC' }}>Cancel</button>
          <button onClick={confirm} disabled={saving} style={{ ...btnStyle, background: '#E88FAC', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Scraping...' : 'Update & Scrape'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EnableModal({ source, onClose, onConfirm, onAddToBatch, batchCount }) {
  const [lookback, setLookback] = useState(source.lookbackDays || 180)
  const [limit, setLimit] = useState(source.apifyLimit || 100)
  const [saving, setSaving] = useState(false)

  const estCost = (limit * COST_PER_REEL).toFixed(2)

  const doEnable = async (scrapeNow) => {
    setSaving(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          fields: { Enabled: true, 'Lookback Days': lookback, 'Apify Limit': limit },
        }),
      })

      if (scrapeNow) {
        await fetch('/api/admin/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handles: [source.handle], force: true }),
        })
      }

      onConfirm({ lookbackDays: lookback, apifyLimit: limit, scraping: scrapeNow })
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addToBatch = async () => {
    setSaving(true)
    try {
      await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          fields: { Enabled: true, 'Lookback Days': lookback, 'Apify Limit': limit },
        }),
      })
      onAddToBatch({ ...source, lookbackDays: lookback, apifyLimit: limit })
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px',
          padding: '24px', width: '400px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>Enable @{source.handle}?</h3>
        <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px', lineHeight: 1.4 }}>
          Adjust scrape settings, then scrape now or add to batch.
        </p>

        <label style={labelStyle}>Lookback Days</label>
        <input type="text" inputMode="numeric" value={lookback} onChange={e => setLookback(parseInt(e.target.value.replace(/\D/g, '')) || '')} onBlur={e => { if (!e.target.value) setLookback(180) }} style={inputStyle} />
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>How far back to scrape reels (from today)</div>

        <label style={labelStyle}>Max Reels to Scrape</label>
        <input type="text" inputMode="numeric" value={limit} onChange={e => setLimit(parseInt(e.target.value.replace(/\D/g, '')) || '')} onBlur={e => { if (!e.target.value) setLimit(15) }} style={inputStyle} />
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>Limits the number of reels Apify will return</div>

        <div style={{ background: '#FFFBEB', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px', marginTop: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#f59e0b' }}>~${estCost}</div>
          <div style={{ fontSize: '11px', color: '#a3a3a3', marginTop: '2px' }}>Est. Apify cost for {limit} reels</div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...btnStyle, background: '#E8C4CC' }}>Cancel</button>
          <button
            onClick={addToBatch}
            disabled={saving}
            style={{ ...btnStyle, background: '#FFF0F3', border: '1px solid #E88FAC', color: '#E88FAC', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? '...' : `Add to Batch${batchCount > 0 ? ` (${batchCount})` : ''}`}
          </button>
          <button
            onClick={() => doEnable(true)}
            disabled={saving}
            style={{ ...btnStyle, background: '#E88FAC', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Enable & Scrape'}
          </button>
        </div>
      </div>
    </div>
  )
}

function parseHandles(text, existingHandles, deadHandles) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const urlMatch = line.match(/instagram\.com\/([A-Za-z0-9._]+)/)
      if (urlMatch) return urlMatch[1].toLowerCase()
      return line.replace(/^@/, '').replace(/\/$/, '').toLowerCase()
    })
    .filter((h, i, arr) => h && arr.indexOf(h) === i)
    .map(h => ({ handle: h, creators: [], exists: existingHandles.has(h), dead: deadHandles.has(h), markedDead: false }))
}

function BulkAddSourcesModal({ onClose, onAdd, allCreators, existingHandles, deadHandles }) {
  const [step, setStep] = useState(1)
  const [rawText, setRawText] = useState('')
  const [parsed, setParsed] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [saving, setSaving] = useState(false)

  const goToTag = () => {
    const items = parseHandles(rawText, existingHandles, deadHandles)
    if (items.length === 0) return
    setParsed(items)
    const firstNew = items.findIndex(i => !i.exists && !i.dead)
    if (firstNew === -1) { setStep(3); return }
    setCurrentIdx(firstNew)
    setStep(2)
  }

  const toggleCreator = (id) => {
    setParsed(prev => prev.map((item, i) =>
      i === currentIdx
        ? { ...item, creators: item.creators.includes(id) ? item.creators.filter(x => x !== id) : [...item.creators, id] }
        : item
    ))
  }

  const markDead = () => {
    setParsed(prev => prev.map((item, i) => i === currentIdx ? { ...item, markedDead: true, creators: [] } : item))
    const nextNew = parsed.findIndex((item, i) => i > currentIdx && !item.exists && !item.dead && !item.markedDead)
    if (nextNew === -1) { setStep(3); return }
    setCurrentIdx(nextNew)
  }

  const nextHandle = () => {
    const nextNew = parsed.findIndex((item, i) => i > currentIdx && !item.exists && !item.dead && !item.markedDead)
    if (nextNew === -1) { setStep(3); return }
    setCurrentIdx(nextNew)
  }

  const submit = async () => {
    const toCreate = parsed.filter(p => !p.exists && !p.dead)
    if (toCreate.length === 0 && deadCount === 0) { onClose(); return }
    setSaving(true)
    try {
      const allToCreate = [
        ...toCreate.filter(p => !p.markedDead).map(p => ({ handle: p.handle, palmCreators: p.creators })),
        ...parsed.filter(p => p.markedDead).map(p => ({ handle: p.handle, accountStatus: 'Dead' })),
      ]
      if (allToCreate.length === 0) { onClose(); return }
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: allToCreate }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onAdd()
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const newCount = parsed.filter(p => !p.exists && !p.dead).length
  const deadCount = parsed.filter(p => p.markedDead).length
  const current = parsed[currentIdx]

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#ffffff', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px',
        padding: '24px', width: '460px', maxHeight: '85vh', overflow: 'auto',
      }}>
        {step === 1 && (<>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>Add Sources</h3>
          <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>Paste Instagram handles or URLs, one per line</p>
          <textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            placeholder={"@username\nhttps://instagram.com/username\nusername"}
            autoFocus
            rows={8}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.6 }}
          />
          {rawText.trim() && (() => {
            const preview = parseHandles(rawText, existingHandles, deadHandles)
            const newCount = preview.filter(p => !p.exists && !p.dead).length
            const existCount = preview.filter(p => p.exists).length
            const deadCount = preview.filter(p => p.dead).length
            return (
              <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                {newCount} new
                {existCount > 0 && <> · {existCount} already exist</>}
                {deadCount > 0 && <> · <span style={{ color: '#ef4444' }}>{deadCount} dead (auto-skipped)</span></>}
              </div>
            )
          })()}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ ...btnStyle, background: '#E8C4CC' }}>Cancel</button>
            <button onClick={goToTag} disabled={!rawText.trim()} style={{ ...btnStyle, background: '#E88FAC', opacity: !rawText.trim() ? 0.5 : 1 }}>
              Next — Tag Creators
            </button>
          </div>
        </>)}

        {step === 2 && current && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: 0 }}>
                @{current.handle}
              </h3>
              <a
                href={`https://instagram.com/${current.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '3px 10px', fontSize: '11px', fontWeight: 600,
                  background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E8C4CC',
                  borderRadius: '6px', textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >
                View IG ↗
              </a>
            </div>
            <span style={{ fontSize: '12px', color: '#999' }}>
              {parsed.filter(p => !p.exists).indexOf(current) + 1} of {newCount}
            </span>
          </div>

          {allCreators?.length > 0 && (
            <>
              <label style={labelStyle}>Assign to Creator (optional)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                {allCreators.map(c => {
                  const selected = current.creators.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCreator(c.id)}
                      style={{
                        padding: '4px 10px', fontSize: '12px', fontWeight: 600,
                        borderRadius: '20px', cursor: 'pointer', border: 'none',
                        background: selected ? '#FFF0F3' : '#ffffff',
                        color: selected ? '#E88FAC' : '#666',
                        outline: selected ? '1px solid #E88FAC' : '1px solid #E8C4CC',
                      }}
                    >
                      {c.aka || c.name}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'space-between' }}>
            <button onClick={markDead} style={{ ...btnStyle, background: '#FEF2F2', color: '#ef4444', border: '1px solid #FECACA', fontSize: '11px' }}>
              Dead Account
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={nextHandle} style={{ ...btnStyle, background: '#E8C4CC' }}>Skip</button>
              <button onClick={nextHandle} style={{ ...btnStyle, background: '#E88FAC' }}>
                {parsed.filter((p, i) => i > currentIdx && !p.exists && !p.dead && !p.markedDead).length > 0 ? 'Next' : 'Review'}
              </button>
            </div>
          </div>
        </>)}

        {step === 3 && (<>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
            Add {newCount - deadCount} Source{newCount - deadCount !== 1 ? 's' : ''}
            {deadCount > 0 && <span style={{ color: '#ef4444', fontSize: '13px', fontWeight: 500 }}> + {deadCount} dead</span>}
          </h3>
          <p style={{ fontSize: '11px', color: '#999', marginBottom: '12px' }}>
            {deadCount > 0 && 'Dead accounts will be logged and hidden from the sources list.'}
          </p>
          <div style={{ maxHeight: '300px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {parsed.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: '8px',
                background: item.markedDead ? '#FEF2F2' : item.dead ? '#f5f5f5' : item.exists ? '#f5f5f5' : '#FFF5F7',
                opacity: item.exists || item.dead ? 0.5 : 1,
              }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: item.markedDead ? '#ef4444' : '#1a1a1a' }}>
                  @{item.handle}
                  {item.exists && <span style={{ color: '#999', fontSize: '11px', marginLeft: '8px' }}>already exists</span>}
                  {item.dead && <span style={{ color: '#ef4444', fontSize: '11px', marginLeft: '8px' }}>dead account</span>}
                  {item.markedDead && <span style={{ fontSize: '11px', marginLeft: '8px' }}>will be logged as dead</span>}
                </span>
                {!item.exists && !item.dead && !item.markedDead && item.creators.length > 0 && (
                  <span style={{ fontSize: '11px', color: '#E88FAC' }}>
                    {item.creators.length} creator{item.creators.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={() => setStep(1)} style={{ ...btnStyle, background: '#E8C4CC' }}>Back</button>
            <button onClick={submit} disabled={saving || newCount === 0} style={{ ...btnStyle, background: '#E88FAC', opacity: saving || newCount === 0 ? 0.5 : 1 }}>
              {saving ? 'Adding...' : `Add All ${newCount} Sources`}
            </button>
          </div>
        </>)}
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: '11px', color: '#999', fontWeight: 600, marginBottom: '4px', marginTop: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle = { width: '100%', padding: '8px 12px', background: '#FFF5F7', border: '1px solid #E8C4CC', borderRadius: '6px', color: '#1a1a1a', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }
const btnStyle = { padding: '8px 16px', border: 'none', borderRadius: '6px', color: '#1a1a1a', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }

export default function AdminSources() {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [scraping, setScraping] = useState({}) // { sourceId: true }
  const [reelsSource, setReelsSource] = useState(null) // source for reels modal
  const [enableSource, setEnableSource] = useState(null) // source for enable confirmation modal
  const [rescrapeSource, setRescrapeSource] = useState(null) // { source, newLimit }
  const [batch, setBatch] = useState([]) // queued sources for batch scrape
  const [batchScraping, setBatchScraping] = useState(false)
  const [allCreators, setAllCreators] = useState([])
  const [activeFilters, setActiveFilters] = useState(new Set(['all']))
  const [showScrapeAll, setShowScrapeAll] = useState(false)

  useEffect(() => {
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(d => setAllCreators(d.creators || []))
      .catch(() => {})
  }, [])

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sources')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setSources(data.sources || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSources() }, [fetchSources])

  // Auto-refresh while any source is Processing
  useEffect(() => {
    const hasProcessing = sources.some(s => s.pipelineStatus === 'Processing')
    if (!hasProcessing) return
    const interval = setInterval(() => {
      fetchSources()
    }, 15000) // poll every 15 seconds
    return () => clearInterval(interval)
  }, [sources, fetchSources])

  const toggleEnabled = async (source) => {
    if (!source.enabled) {
      // Enabling — show confirmation modal
      setEnableSource(source)
      return
    }
    // Disabling — no confirmation needed
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: false } : s))
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id, fields: { Enabled: false } }),
      })
      if (!res.ok) throw new Error('Toggle failed')
    } catch (err) {
      setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: true } : s))
      console.error(err)
    }
  }

  const handleEnableConfirm = ({ lookbackDays, apifyLimit, scraping: startedScrape }) => {
    setSources(prev => prev.map(s => s.id === enableSource.id ? {
      ...s, enabled: true, lookbackDays, apifyLimit,
      ...(startedScrape ? { pipelineStatus: 'Processing' } : {}),
    } : s))
    setEnableSource(null)
  }

  const handleAddToBatch = (source) => {
    setBatch(prev => {
      if (prev.find(s => s.id === source.id)) return prev
      return [...prev, source]
    })
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: true, lookbackDays: source.lookbackDays, apifyLimit: source.apifyLimit } : s))
    setEnableSource(null)
  }

  const scrapeBatch = async () => {
    if (batch.length === 0) return
    setBatchScraping(true)
    const handles = batch.map(s => s.handle)
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles, force: true }),
      })
      if (!res.ok) throw new Error('Batch scrape failed')
      setSources(prev => prev.map(s => handles.includes(s.handle) ? { ...s, pipelineStatus: 'Processing' } : s))
      setBatch([])
    } catch (err) {
      alert(err.message)
    } finally {
      setBatchScraping(false)
    }
  }

  const scrapeOne = async (source) => {
    setScraping(prev => ({ ...prev, [source.id]: true }))
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles: [source.handle], force: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scrape failed')
      setSources(prev => prev.map(s => s.id === source.id ? { ...s, pipelineStatus: 'Processing' } : s))
    } catch (err) {
      alert(err.message)
    } finally {
      setScraping(prev => ({ ...prev, [source.id]: false }))
    }
  }

  const toggleFilter = (filter) => {
    setActiveFilters(prev => {
      if (filter === 'all') return new Set(['all'])
      if (filter === 'dead') return prev.has('dead') ? new Set(['all']) : new Set(['dead'])
      const next = new Set(prev)
      next.delete('all')
      next.delete('dead')
      if (filter === 'enabled') next.delete('disabled')
      if (filter === 'disabled') next.delete('enabled')
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      if (next.size === 0) return new Set(['all'])
      return next
    })
  }

  // Live sources = everything except Dead
  const liveSources = sources.filter(s => s.accountStatus !== 'Dead')

  const filteredSources = activeFilters.has('dead')
    ? sources.filter(s => s.accountStatus === 'Dead')
    : activeFilters.has('all')
      ? liveSources
      : liveSources.filter(s => {
          if (activeFilters.has('unscraped') && s.lastScrapedAt) return false
          if (activeFilters.has('18+') && !s.ageRestricted) return false
          if (activeFilters.has('enabled') && !s.enabled) return false
          if (activeFilters.has('disabled') && s.enabled) return false
          return true
        })

  const filterCounts = {
    all: liveSources.length,
    unscraped: liveSources.filter(s => !s.lastScrapedAt).length,
    '18+': liveSources.filter(s => s.ageRestricted).length,
    enabled: liveSources.filter(s => s.enabled).length,
    disabled: liveSources.filter(s => !s.enabled).length,
    dead: sources.filter(s => s.accountStatus === 'Dead').length,
  }

  const existingHandles = new Set(sources.map(s => s.handle.toLowerCase()))
  const deadHandles = new Set(sources.filter(s => s.accountStatus === 'Dead').map(s => s.handle.toLowerCase()))

  const scrapeAllVisible = async () => {
    const handles = filteredSources.filter(s => s.enabled).map(s => s.handle)
    if (handles.length === 0) return
    setBatchScraping(true)
    try {
      const res = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handles, force: true }),
      })
      if (!res.ok) throw new Error('Scrape failed')
      setSources(prev => prev.map(s => handles.includes(s.handle) ? { ...s, pipelineStatus: 'Processing' } : s))
    } catch (err) {
      alert(err.message)
    } finally {
      setBatchScraping(false)
      setShowScrapeAll(false)
    }
  }

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px' }}>Loading sources...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>Inspo Sources</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!activeFilters.has('all') && filteredSources.length > 0 && (
            <button onClick={() => setShowScrapeAll(true)} disabled={batchScraping} style={{ ...btnStyle, background: '#FFF0F3', color: '#E88FAC', border: '1px solid #E88FAC', opacity: batchScraping ? 0.6 : 1 }}>
              {batchScraping ? 'Scraping...' : `Scrape All Visible (${filteredSources.filter(s => s.enabled).length})`}
            </button>
          )}
          <button onClick={() => setShowAdd(true)} style={{ ...btnStyle, background: '#E88FAC' }}>+ Add Sources</button>
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['all', 'unscraped', '18+', 'enabled', 'disabled', 'dead'].map(filter => {
          const active = activeFilters.has(filter)
          const count = filterCounts[filter]
          if (filter !== 'all' && count === 0) return null
          return (
            <button
              key={filter}
              onClick={() => toggleFilter(filter)}
              style={{
                padding: '5px 14px', fontSize: '12px', fontWeight: 600,
                borderRadius: '20px', cursor: 'pointer', border: 'none',
                background: active ? '#FFF0F3' : '#ffffff',
                color: active ? '#E88FAC' : '#999',
                outline: active ? '1.5px solid #E88FAC' : '1px solid #E8C4CC',
                transition: 'all 0.15s',
              }}
            >
              {filter === 'all' ? 'All' : filter === 'unscraped' ? 'Unscraped' : filter === '18+' ? '18+' : filter === 'enabled' ? 'Enabled' : filter === 'disabled' ? 'Disabled' : 'Dead'}
              <span style={{ marginLeft: '4px', fontSize: '11px', opacity: 0.7 }}>({count})</span>
            </button>
          )
        })}
      </div>

      <div style={{
        background: '#ffffff',
        border: 'none',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        borderRadius: '18px',
        overflow: 'hidden',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 100px 70px 60px 80px 100px 70px 60px 80px 90px',
          padding: '10px 16px',
          borderBottom: '1px solid rgba(0,0,0,0.04)',
          fontSize: '11px',
          fontWeight: 600,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          gap: '8px',
        }}>
          <div></div>
          <div>Handle</div>
          <div style={{ textAlign: 'right', paddingRight: '16px' }}>Followers</div>
          <div style={{ textAlign: 'right' }}>Days</div>
          <div style={{ textAlign: 'right' }}>Limit</div>
          <div>Status</div>
          <div>Last Scraped</div>
          <div style={{ textAlign: 'right' }}>Scraped</div>
          <div style={{ textAlign: 'right' }}>Added</div>
          <div>Date Added</div>
          <div></div>
        </div>

        {/* Table rows */}
        {filteredSources.map(source => (
          <div
            key={source.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr 100px 70px 60px 80px 100px 70px 60px 80px 90px',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(0,0,0,0.04)',
              alignItems: 'center',
              fontSize: '13px',
              gap: '8px',
              opacity: source.enabled ? 1 : 0.5,
            }}
          >
            {/* Toggle */}
            <div>
              <button
                onClick={() => toggleEnabled(source)}
                style={{
                  width: '32px', height: '18px', borderRadius: '9px',
                  background: source.enabled ? '#E88FAC' : '#E8C4CC',
                  border: 'none', cursor: 'pointer', position: 'relative',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  background: '#fff', position: 'absolute', top: '2px',
                  left: source.enabled ? '16px' : '2px',
                  transition: 'left 0.2s',
                }} />
              </button>
            </div>

            {/* Handle */}
            <div
              style={{ color: '#1a1a1a', fontWeight: 500, cursor: 'pointer' }}
              onClick={() => setReelsSource(source)}
              onMouseEnter={e => e.currentTarget.style.color = '#E88FAC'}
              onMouseLeave={e => e.currentTarget.style.color = '#1a1a1a'}
            >
              @{source.handle}
              {source.ageRestricted && (
                <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: 700, color: '#ef4444', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '3px', padding: '1px 4px', verticalAlign: 'middle' }}>18+</span>
              )}
              {source.addedBy && (
                <span style={{ marginLeft: '8px', fontSize: '9px', fontWeight: 500, color: '#999', verticalAlign: 'middle' }}>by {source.addedBy}</span>
              )}
            </div>

            {/* Followers */}
            <div style={{ color: '#4a4a4a', textAlign: 'right', paddingRight: '16px' }}>
              {source.followerCount ? (
                source.followerCount >= 1000000
                  ? <>{(source.followerCount / 1000000).toFixed(1)}<span style={{ color: '#E88FAC', fontWeight: 600 }}>M</span></>
                  : <>{(source.followerCount / 1000).toFixed(0)}<span style={{ color: '#999', fontWeight: 600 }}>K</span></>
              ) : '—'}
            </div>

            {/* Lookback Days — inline editable */}
            <div style={{ textAlign: 'right' }}>
              <input
                type="text"
                inputMode="numeric"
                value={source.lookbackDays || 180}
                onChange={e => {
                  const val = parseInt(e.target.value.replace(/\D/g, '')) || ''
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, lookbackDays: val } : s))
                }}
                onBlur={e => {
                  const val = parseInt(e.target.value) || 180
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, lookbackDays: val } : s))
                  fetch('/api/admin/sources', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: source.id, fields: { 'Lookback Days': val } }),
                  })
                }}
                style={{ width: '100%', padding: '2px 4px', background: 'transparent', border: '1px solid transparent', borderRadius: '4px', color: '#999', fontSize: '12px', textAlign: 'right', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = '#E8C4CC'}
                onBlurCapture={e => e.target.style.borderColor = 'transparent'}
              />
            </div>

            {/* Apify Limit — inline editable, triggers rescrape modal on change */}
            <div style={{ textAlign: 'right' }}>
              <input
                type="text"
                inputMode="numeric"
                value={source._editingLimit != null ? source._editingLimit : (source.apifyLimit || 100)}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '')
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, _editingLimit: val } : s))
                }}
                onBlur={e => {
                  const newVal = parseInt(e.target.value) || 100
                  setSources(prev => prev.map(s => s.id === source.id ? { ...s, _editingLimit: undefined, apifyLimit: newVal } : s))
                  if (newVal !== (source.apifyLimit || 100)) {
                    fetch('/api/admin/sources', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: source.id, fields: { 'Apify Limit': newVal } }),
                    })
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur()
                }}
                style={{ width: '100%', padding: '2px 4px', background: 'transparent', border: '1px solid transparent', borderRadius: '4px', color: '#999', fontSize: '12px', textAlign: 'right', outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => e.target.style.borderColor = '#E8C4CC'}
                onBlurCapture={e => e.target.style.borderColor = 'transparent'}
              />
            </div>

            {/* Status */}
            <div><StatusPill status={source.pipelineStatus} /></div>

            {/* Last Scraped */}
            <div style={{ color: '#999' }}>{formatTime(source.lastScrapedAt)}</div>

            {/* Scraped */}
            <div style={{ color: '#4a4a4a', textAlign: 'right' }}>{source.reelsScraped || '—'}</div>

            {/* Added */}
            <div style={{ color: '#4a4a4a', textAlign: 'right' }}>{source.sourceReelsAdded || '—'}</div>

            {/* Date Added */}
            <div style={{ color: '#999', fontSize: '11px' }}>{source.dateAdded ? formatTime(source.dateAdded + 'T12:00:00') : '—'}</div>

            {/* Scrape button */}
            <div>
              <button
                onClick={() => scrapeOne(source)}
                disabled={scraping[source.id] || !source.enabled}
                style={{
                  padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                  background: scraping[source.id] ? '#E8C4CC' : '#FFF0F3',
                  color: scraping[source.id] ? '#555' : '#E88FAC',
                  border: '1px solid #E8C4CC', borderRadius: '4px',
                  cursor: scraping[source.id] || !source.enabled ? 'not-allowed' : 'pointer',
                }}
              >
                {scraping[source.id] ? '...' : (source.lastScrapedAt ? 'Rescrape' : 'Scrape')}
              </button>
            </div>
          </div>
        ))}

        {sources.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
            No sources configured. Add one to get started.
          </div>
        )}
      </div>

      {showAdd && <BulkAddSourcesModal onClose={() => setShowAdd(false)} onAdd={fetchSources} allCreators={allCreators} existingHandles={existingHandles} deadHandles={deadHandles} />}
      {reelsSource && <ReelsModal source={reelsSource} sources={filteredSources} allCreators={allCreators} onClose={() => setReelsSource(null)} onNavigate={setReelsSource} onCreatorsChange={(sourceId, ids) => setSources(prev => prev.map(s => s.id === sourceId ? { ...s, palmCreators: ids } : s))} />}

      {/* Scrape All Visible confirmation */}
      {showScrapeAll && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowScrapeAll(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '24px', width: '420px', maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>Scrape All Visible?</h3>
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>
              {filteredSources.filter(s => s.enabled).length} enabled source{filteredSources.filter(s => s.enabled).length !== 1 ? 's' : ''} will be scraped
            </p>
            <div style={{ maxHeight: '200px', overflow: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {filteredSources.filter(s => s.enabled).map(s => (
                <div key={s.id} style={{ fontSize: '12px', color: '#4a4a4a', padding: '4px 8px', background: '#FFF5F7', borderRadius: '6px' }}>
                  @{s.handle} <span style={{ color: '#999' }}>({s.apifyLimit || 100} reels)</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#FFFBEB', border: '1px solid #fde68a', borderRadius: '10px', padding: '16px', marginBottom: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: 800, color: '#f59e0b' }}>
                ~${filteredSources.filter(s => s.enabled).reduce((sum, s) => sum + (s.apifyLimit || 100) * COST_PER_REEL, 0).toFixed(2)}
              </div>
              <div style={{ fontSize: '11px', color: '#a3a3a3', marginTop: '2px' }}>Estimated Apify cost</div>
              <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '6px' }}>Duplicates auto-skipped (free)</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowScrapeAll(false)} style={{ ...btnStyle, background: '#E8C4CC' }}>Cancel</button>
              <button onClick={scrapeAllVisible} disabled={batchScraping} style={{ ...btnStyle, background: '#E88FAC', opacity: batchScraping ? 0.6 : 1 }}>
                {batchScraping ? 'Scraping...' : 'Scrape All'}
              </button>
            </div>
          </div>
        </div>
      )}
      {enableSource && <EnableModal source={enableSource} onClose={() => setEnableSource(null)} onConfirm={handleEnableConfirm} onAddToBatch={handleAddToBatch} batchCount={batch.length} />}
      {rescrapeSource && (
        <RescrapeModal
          source={rescrapeSource.source}
          newLimit={rescrapeSource.newLimit}
          onClose={() => {
            setRescrapeSource(null)
          }}
          onConfirm={(newLimit) => {
            setSources(prev => prev.map(s => s.id === rescrapeSource.source.id ? { ...s, apifyLimit: newLimit, pipelineStatus: 'Processing' } : s))
            setRescrapeSource(null)
          }}
        />
      )}

      {/* Floating batch bar */}
      {batch.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          background: 'linear-gradient(to top, #ffffff 80%, transparent)',
          padding: '16px 24px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
        }}>
          <div style={{
            background: '#FFF0F3', border: '1px solid #E88FAC', borderRadius: '12px',
            padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '16px',
            boxShadow: '0 -4px 20px rgba(167, 139, 250, 0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#E88FAC' }}>{batch.length}</span>
              <span style={{ fontSize: '13px', color: '#4a4a4a' }}>
                {batch.length === 1 ? 'creator' : 'creators'} queued
              </span>
              <span style={{ fontSize: '12px', color: '#999' }}>
                ({batch.map(s => `@${s.handle}`).join(', ')})
              </span>
            </div>
            <div style={{ width: '1px', height: '20px', background: '#E8C4CC' }} />
            <div style={{ fontSize: '13px', color: '#f59e0b', fontWeight: 600 }}>
              ~${batch.reduce((sum, s) => sum + (s.apifyLimit || 100) * COST_PER_REEL, 0).toFixed(2)}
            </div>
            <button
              onClick={() => setBatch([])}
              style={{ ...btnStyle, background: '#E8C4CC', fontSize: '12px', padding: '6px 12px' }}
            >
              Clear
            </button>
            <button
              onClick={scrapeBatch}
              disabled={batchScraping}
              style={{ ...btnStyle, background: '#E88FAC', fontSize: '13px', padding: '8px 20px', opacity: batchScraping ? 0.6 : 1 }}
            >
              {batchScraping ? 'Scraping...' : `Scrape All (${batch.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
