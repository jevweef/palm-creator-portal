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
  'A+': '#a78bfa', A: '#a78bfa', 'A-': '#a78bfa',
  'B+': '#22c55e', B: '#22c55e', 'B-': '#22c55e',
  'C+': '#f59e0b', C: '#f59e0b', 'C-': '#f59e0b',
  D: '#ef4444', F: '#ef4444',
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
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord() {
    const record = queue[index]
    if (!record) return
    if (!confirm('Reject this reel? It will be hidden from the queue.')) return
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
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px' }}>Loading review queue...</div>
  }

  if (queue.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '20px', color: '#22c55e', fontWeight: 700, marginBottom: '8px' }}>✓ Queue empty</div>
        <div style={{ color: '#71717a', fontSize: '13px', marginBottom: '20px' }}>Nothing left to review.</div>
        <button onClick={fetchAll} style={{ padding: '8px 20px', background: '#a78bfa', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
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
          background: toast.error ? '#2d1515' : '#152d15',
          color: toast.error ? '#ff8888' : '#88ff88',
          border: `1px solid ${toast.error ? '#5c2020' : '#205c20'}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>
            Review Queue
          </h1>
          <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>
            {index + 1} of {queue.length} remaining
          </div>
        </div>
        <button
          onClick={fetchAll}
          style={{ padding: '6px 14px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#a1a1aa', fontSize: '12px', cursor: 'pointer' }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: '3px', background: '#222', borderRadius: '2px', marginBottom: '20px' }}>
        <div style={{ height: '100%', background: '#a78bfa', borderRadius: '2px', width: `${((index) / queue.length) * 100}%`, transition: 'width 0.3s' }} />
      </div>

      {/* Record card */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
        {/* Identity row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
              {record.username ? `@${record.username}` : record.title || 'Untitled'}
            </div>
            {record.caption && (
              <div style={{ fontSize: '12px', color: '#71717a', marginTop: '3px', maxWidth: '500px' }}>
                {record.caption.slice(0, 120)}{record.caption.length > 120 ? '...' : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
            {record.grade && (
              <span style={{ fontSize: '12px', fontWeight: 700, color: GRADE_COLORS[record.grade] || '#fff', background: '#1a1a1a', padding: '2px 8px', borderRadius: '4px', border: '1px solid #333' }}>
                {record.grade}
              </span>
            )}
            {sc && (
              <a
                href={`https://instagram.com/reel/${sc}/`}
                target="inspo_reel_viewer"
                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, background: '#1a1a2e', color: '#a78bfa', border: '1px solid #333', borderRadius: '4px', textDecoration: 'none' }}
              >
                Open ↗
              </a>
            )}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
          {[['Views', record.views], ['Likes', record.likes], ['Comments', record.comments]].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#d4d4d8' }}>{formatNum(val)}</div>
            </div>
          ))}
        </div>

        {/* Data Source badge */}
        {record.dataSource && (
          <span style={{
            fontSize: '10px', padding: '2px 8px', borderRadius: '3px', fontWeight: 600,
            background: record.dataSource === 'IG Export' ? '#1a1a2e' : '#1a2e1a',
            color: record.dataSource === 'IG Export' ? '#a78bfa' : '#22c55e',
            border: `1px solid ${record.dataSource === 'IG Export' ? '#a78bfa44' : '#22c55e44'}`,
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
          style={{ marginBottom: '16px', padding: '6px 14px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#a78bfa', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'block' }}
        >
          + Add @{record.username} to Inspo Sources
        </button>
      )}

      {/* Voice note */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Reviewer Notes
        </div>
        <button
          onClick={toggleRecording}
          style={{
            width: '100%',
            padding: '10px',
            background: isRecording ? '#3d1515' : '#1a1a1a',
            border: `1px solid ${isRecording ? '#5c2020' : '#333'}`,
            borderRadius: '6px',
            color: isRecording ? '#ef4444' : '#a1a1aa',
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
          <div style={{ fontSize: '13px', color: '#71717a', fontStyle: 'italic', marginBottom: '8px', padding: '8px', background: '#0a0a0a', borderRadius: '6px' }}>
            {transcript}
          </div>
        )}

        <textarea
          value={reviewerNotes}
          onChange={e => setReviewerNotes(e.target.value)}
          placeholder="Notes will appear here after recording, or type directly..."
          rows={3}
          style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', borderRadius: '6px', color: '#d4d4d8', fontSize: '13px', padding: '8px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Creator pills */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
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
                  background: selected ? '#a78bfa' : '#1a1a1a',
                  color: selected ? '#fff' : '#a1a1aa',
                  border: `1px solid ${selected ? '#a78bfa' : '#333'}`,
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
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: '10px', padding: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
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
                background: n >= 8 ? '#1a2e1a' : n >= 5 ? '#1a1a2e' : '#1a1a1a',
                color: n >= 8 ? '#22c55e' : n >= 5 ? '#a78bfa' : '#71717a',
                border: `1px solid ${n >= 8 ? '#22c55e44' : n >= 5 ? '#a78bfa44' : '#333'}`,
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
              background: '#2d1515',
              color: '#ef4444',
              border: '1px solid #5c2020',
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
            style={{ padding: '6px 14px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#71717a', fontSize: '12px', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.4 : 1 }}
          >
            ← Prev
          </button>
          <button
            onClick={() => setIndex(i => Math.min(queue.length - 1, i + 1))}
            disabled={index >= queue.length - 1}
            style={{ padding: '6px 14px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#71717a', fontSize: '12px', cursor: index >= queue.length - 1 ? 'not-allowed' : 'pointer', opacity: index >= queue.length - 1 ? 0.4 : 1 }}
          >
            Skip →
          </button>
        </div>
      </div>
    </div>
  )
}
