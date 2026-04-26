'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return String(n)
}

function shortcode(url) {
  const m = url?.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

const GRADE_COLORS = {
  'A+': 'var(--palm-pink)', A: 'var(--palm-pink)', 'A-': 'var(--palm-pink)',
  'B+': '#7DD3A4', B: '#7DD3A4', 'B-': '#7DD3A4',
  'C+': '#E8C878', C: '#E8C878', 'C-': '#E8C878',
  D: '#E87878', F: '#E87878',
}

export default function AdminReview() {
  const [queue, setQueue] = useState([])
  const [creators, setCreators] = useState([])
  const [existingHandles, setExistingHandles] = useState(new Set())
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  // Per-record state
  const [selectedCreators, setSelectedCreators] = useState(new Set())
  const [reviewerNotes, setReviewerNotes] = useState('')

  // Voice recording
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const recognitionRef = useRef(null)
  const timerRef = useRef(null)

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, cRes, sRes] = await Promise.all([
        fetch('/api/admin/review'),
        fetch('/api/admin/review?action=creators'),
        fetch('/api/admin/review?action=sources'),
      ])
      const [qData, cData, sData] = await Promise.all([qRes.json(), cRes.json(), sRes.json()])
      setQueue(qData.queue || [])
      setCreators(cData.creators || [])
      setExistingHandles(new Set(sData.handles || []))
      setIndex(0)
    } catch (err) {
      showToast('Failed to load queue', true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Reset per-record state when index changes
  useEffect(() => {
    setSelectedCreators(new Set())
    setReviewerNotes('')
    setTranscript('')
    stopRecording()
  }, [index])

  // Auto-open reel in new tab when record changes
  useEffect(() => {
    if (!queue[index]?.url) return
    const sc = shortcode(queue[index].url)
    if (!sc) return
    const key = `opened_${sc}`
    if (!sessionStorage.getItem(key)) {
      window.open(`https://www.instagram.com/reel/${sc}/`, 'inspo_reel_viewer', 'width=450,height=850,left=50,top=50')
      sessionStorage.setItem(key, '1')
    }
  }, [index, queue])

  function stopRecording() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    clearInterval(timerRef.current)
    setIsRecording(false)
    setElapsed(0)
  }

  function toggleRecording() {
    if (isRecording) {
      stopRecording()
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      showToast('Speech recognition not supported in this browser', true)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    let full = ''

    recognition.onstart = () => {
      setIsRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    }

    recognition.onresult = (event) => {
      let interim = ''
      let finalChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript
        else interim += event.results[i][0].transcript
      }
      if (finalChunk) full += (full ? ' ' : '') + finalChunk.trim()
      setTranscript(full + (interim ? ' ' + interim : ''))
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return
      stopRecording()
      showToast(`Mic error: ${e.error}`, true)
    }

    recognition.onend = () => {
      clearInterval(timerRef.current)
      setIsRecording(false)
      setElapsed(0)
      if (full) setReviewerNotes(full.trim())
    }

    recognition.start()
  }

  async function approve(rating) {
    const record = queue[index]
    if (!record) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: record.id,
          rating,
          creatorIds: [...selectedCreators],
          reviewerNotes: reviewerNotes || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setQueue(q => q.filter((_, i) => i !== index))
      setIndex(i => Math.min(i, queue.length - 2))
      setSelectedCreators(new Set())
      setReviewerNotes('')
      setTranscript('')
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord() {
    const record = queue[index]
    if (!record) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/review', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: record.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setQueue(q => q.filter((_, i) => i !== index))
      setIndex(i => Math.min(i, queue.length - 2))
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setSaving(false)
    }
  }

  async function addToSources(handle) {
    try {
      const res = await fetch('/api/admin/review/add-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (data.alreadyExists) {
        showToast(`@${handle} already in sources`)
      } else {
        setExistingHandles(s => new Set([...s, handle.toLowerCase()]))
        showToast(`@${handle} added to Inspo Sources`)
      }
    } catch (err) {
      showToast(err.message, true)
    }
  }

  function toggleCreator(id) {
    setSelectedCreators(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px' }}>Loading review queue...</div>
  }

  if (queue.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '20px', color: '#7DD3A4', fontWeight: 700, marginBottom: '8px' }}>✓ Queue empty</div>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '13px', marginBottom: '20px' }}>Nothing left to review.</div>
        <button onClick={fetchAll} style={{ padding: '8px 20px', background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          Refresh Queue
        </button>
      </div>
    )
  }

  const record = queue[index] || queue[0]
  const sc = shortcode(record.url)
  const handleLower = (record.username || '').toLowerCase().replace(/^@/, '')
  const handleNotInSources = handleLower && !existingHandles.has(handleLower)

  return (
    <div style={{ maxWidth: '760px' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 999,
          padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? 'rgba(232, 120, 120, 0.06)' : 'rgba(125, 211, 164, 0.06)',
          color: toast.error ? '#E87878' : '#7DD3A4',
          border: `1px solid ${toast.error ? 'rgba(232, 120, 120, 0.2)' : 'rgba(125, 211, 164, 0.2)'}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
            Review Queue
          </h1>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
            {index + 1} of {queue.length} remaining
          </div>
        </div>
        <button
          onClick={fetchAll}
          style={{ padding: '6px 14px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '12px', cursor: 'pointer' }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: '3px', background: 'rgba(255,255,255,0.04)', borderRadius: '2px', marginBottom: '20px' }}>
        <div style={{ height: '100%', background: 'var(--palm-pink)', borderRadius: '2px', width: `${((index) / queue.length) * 100}%`, transition: 'width 0.3s' }} />
      </div>

      {/* Record card */}
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '20px', marginBottom: '16px' }}>
        {/* Identity row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)' }}>
              {record.username ? `@${record.username}` : record.title || 'Untitled'}
            </div>
            {record.caption && (
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '3px', maxWidth: '500px' }}>
                {record.caption.slice(0, 120)}{record.caption.length > 120 ? '...' : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
            {record.grade && (
              <span style={{ fontSize: '12px', fontWeight: 700, color: GRADE_COLORS[record.grade] || 'var(--foreground)', background: 'rgba(232, 160, 160, 0.04)', padding: '2px 8px', borderRadius: '4px', border: '1px solid transparent' }}>
                {record.grade}
              </span>
            )}
            {sc && (
              <button
                onClick={() => window.open(`https://www.instagram.com/reel/${sc}/`, 'inspo_reel_viewer', 'width=450,height=850,left=50,top=50')}
                style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              >
                Open Reel ↗
              </button>
            )}
            {record.url && (
              <button
                onClick={() => window.open(`/admin/inspo?tab=recreate&url=${encodeURIComponent(record.url)}`, '_blank')}
                title="Recreate this reel with one of our creators using AI"
                style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--palm-pink)', border: '1px solid var(--palm-pink)', borderRadius: '6px', cursor: 'pointer' }}
              >
                ✨ Create AI
              </button>
            )}
          </div>
        </div>

        {/* Stats — only show if we have data */}
        {(record.views || record.likes || record.comments) && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
            {[['Views', record.views], ['Likes', record.likes], ['Comments', record.comments]].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(240, 236, 232, 0.85)' }}>{formatNum(val)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Data Source badge */}
        {record.dataSource && (
          <span style={{
            fontSize: '10px', padding: '2px 8px', borderRadius: '3px', fontWeight: 600,
            background: record.dataSource === 'IG Export' ? 'rgba(232, 160, 160, 0.06)' : 'rgba(125, 211, 164, 0.06)',
            color: record.dataSource === 'IG Export' ? 'var(--palm-pink)' : '#7DD3A4',
            border: `1px solid ${record.dataSource === 'IG Export' ? '#E88FAC44' : 'rgba(125, 211, 164, 0.2)'}`,
          }}>
            {record.dataSource}
          </span>
        )}
      </div>

      {/* Thumbnail (if no embed) */}
      {record.thumbnail && !record.dbRaw && (
        <div style={{ marginBottom: '16px', borderRadius: '8px', overflow: 'hidden', maxHeight: '200px' }}>
          <img src={record.thumbnail} alt="" style={{ width: '100%', objectFit: 'cover', maxHeight: '200px' }} />
        </div>
      )}

      {/* Add to sources button */}
      {handleNotInSources && (
        <button
          onClick={() => addToSources(record.username)}
          style={{ marginBottom: '16px', padding: '6px 14px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', color: 'var(--palm-pink)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'block' }}
        >
          + Add @{record.username} to Inspo Sources
        </button>
      )}

      {/* Voice note */}
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Reviewer Notes
        </div>
        <button
          onClick={toggleRecording}
          style={{
            width: '100%',
            padding: '10px',
            background: isRecording ? 'rgba(232, 120, 120, 0.06)' : 'rgba(232, 160, 160, 0.06)',
            border: `1px solid ${isRecording ? 'rgba(232, 120, 120, 0.2)' : 'transparent'}`,
            borderRadius: '6px',
            color: isRecording ? '#E87878' : '#888',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: '8px',
            animation: isRecording ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}
        >
          {isRecording ? `⏹ Stop Recording · ${elapsed}s` : '🎙 Record Note'}
        </button>
        <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.6 } }`}</style>

        {transcript && !reviewerNotes && (
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', fontStyle: 'italic', marginBottom: '8px', padding: '8px', background: 'var(--background)', borderRadius: '6px' }}>
            {transcript}
          </div>
        )}

        <textarea
          value={reviewerNotes}
          onChange={e => setReviewerNotes(e.target.value)}
          placeholder="Notes will appear here after recording, or type directly..."
          rows={3}
          style={{ width: '100%', background: 'var(--background)', border: '1px solid transparent', borderRadius: '6px', color: 'rgba(240, 236, 232, 0.85)', fontSize: '13px', padding: '8px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Creator pills */}
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Assign to Creators
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {creators.map(c => {
            const selected = selectedCreators.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggleCreator(c.id)}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background: selected ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
                  color: selected ? 'rgba(255,255,255,0.08)' : '#888',
                  border: `1px solid ${selected ? 'var(--palm-pink)' : 'transparent'}`,
                  borderRadius: '20px',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {c.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Rating + approve */}
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Rate & Approve → sets Ready for Analysis
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
            <button
              key={n}
              onClick={() => approve(n)}
              disabled={saving}
              style={{
                width: '44px', height: '44px',
                background: n >= 8 ? 'rgba(125, 211, 164, 0.06)' : n >= 5 ? 'rgba(232, 160, 160, 0.06)' : 'rgba(232, 160, 160, 0.06)',
                color: n >= 8 ? '#7DD3A4' : n >= 5 ? 'var(--palm-pink)' : '#999',
                border: `1px solid ${n >= 8 ? 'rgba(125, 211, 164, 0.2)' : n >= 5 ? '#E88FAC44' : 'transparent'}`,
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.5 : 1,
              }}
            >
              {n}
            </button>
          ))}
          <button
            onClick={deleteRecord}
            disabled={saving}
            style={{
              width: '44px', height: '44px',
              background: 'rgba(232, 120, 120, 0.06)',
              color: '#E87878',
              border: '1px solid #FECACA',
              borderRadius: '6px',
              fontSize: '16px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
              marginLeft: '8px',
            }}
          >
            🗑
          </button>
        </div>

        {/* Skip nav */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={() => setIndex(i => Math.max(0, i - 1))}
            disabled={index === 0}
            style={{ padding: '6px 14px', background: 'rgba(232, 160, 160, 0.04)', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '12px', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.4 : 1, transition: '0.3s cubic-bezier(0, 0, 0.5, 1)' }}
          >
            ← Prev
          </button>
          <button
            onClick={() => setIndex(i => Math.min(queue.length - 1, i + 1))}
            disabled={index >= queue.length - 1}
            style={{ padding: '6px 14px', background: 'rgba(232, 160, 160, 0.04)', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '12px', cursor: index >= queue.length - 1 ? 'not-allowed' : 'pointer', opacity: index >= queue.length - 1 ? 0.4 : 1, transition: '0.3s cubic-bezier(0, 0, 0.5, 1)' }}
          >
            Skip →
          </button>
        </div>
      </div>
    </div>
  )
}
