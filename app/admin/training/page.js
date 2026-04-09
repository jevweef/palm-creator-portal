'use client'

import { useState, useEffect, useCallback } from 'react'
import { tagStyle } from '@/lib/tagStyle'

function formatNum(n) {
  if (!n || n < 0) return null
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function parseNotes(notes) {
  if (!notes) return { inspoDirection: '', whatMattersMost: '' }
  const inspoMatch = notes.match(/Inspo direction:\n?([\s\S]*?)(?=What matters most:|$)/i)
  const wmmMatch = notes.match(/What matters most:\n?([\s\S]*?)$/i)
  return {
    inspoDirection: inspoMatch ? inspoMatch[1].trim() : '',
    whatMattersMost: wmmMatch ? wmmMatch[1].trim() : '',
  }
}

const MODES = [
  { value: 'Scenario / Fantasy', label: 'Scenario / Fantasy', color: '#a78bfa', desc: 'POV captions, viewer-perspective narrative' },
  { value: 'Controversy / Opinion', label: 'Controversy / Opinion', color: '#f87171', desc: 'Provocative claims that spark debate' },
  { value: 'Relationship / Conversation', label: 'Relationship / Conversation', color: '#f472b6', desc: 'iMessage texts, DM screenshots, dialogue' },
  { value: 'Visual Callout', label: 'Visual Callout', color: '#60a5fa', desc: 'Text directly references what\'s on screen' },
  { value: 'Relatable / Lifestyle', label: 'Relatable / Lifestyle', color: '#4ade80', desc: 'Routine captions, relatable moments' },
]

export default function TextTrainingPage() {
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedMode, setSelectedMode] = useState(null)
  const [toast, setToast] = useState(null)
  const [stats, setStats] = useState({ approved: 0, denied: 0 })

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 2500)
  }

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/text-training')
      const data = await res.json()
      setQueue(data.records || [])
      setIndex(0)
    } catch {
      showToast('Failed to load queue', true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchQueue() }, [fetchQueue])

  // Reset mode when index changes
  useEffect(() => { setSelectedMode(null) }, [index])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (saving) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (index < queue.length - 1) setIndex(i => i + 1)
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (index > 0) setIndex(i => i - 1)
      }
      // Number keys 1-5 for mode selection
      const num = parseInt(e.key)
      if (num >= 1 && num <= 5) {
        setSelectedMode(MODES[num - 1].value)
      }
      // D for deny
      if (e.key === 'd' || e.key === 'D') {
        handleDeny()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [index, queue.length, saving])

  const record = queue[index]

  async function handleApprove() {
    if (!selectedMode) {
      showToast('Pick a mode first', true)
      return
    }
    if (!record) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/text-training', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: record.id, approved: true, mode: selectedMode }),
      })
      if (!res.ok) throw new Error('Failed')
      setStats(s => ({ ...s, approved: s.approved + 1 }))
      setQueue(q => q.filter((_, i) => i !== index))
      if (index >= queue.length - 1) setIndex(Math.max(0, index - 1))
      setSelectedMode(null)
      showToast('Approved')
    } catch {
      showToast('Failed to save', true)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeny() {
    if (!record || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/text-training', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: record.id, approved: false }),
      })
      if (!res.ok) throw new Error('Failed')
      setStats(s => ({ ...s, denied: s.denied + 1 }))
      setQueue(q => q.filter((_, i) => i !== index))
      if (index >= queue.length - 1) setIndex(Math.max(0, index - 1))
      setSelectedMode(null)
      showToast('Denied')
    } catch {
      showToast('Failed to save', true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ color: '#71717a', padding: '60px', textAlign: 'center', fontSize: '14px' }}>
        Loading text training queue...
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div style={{ padding: '60px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {stats.approved + stats.denied > 0 ? '🎉' : '📭'}
        </div>
        <p style={{ color: '#a1a1aa', fontSize: '16px', fontWeight: 500 }}>
          {stats.approved + stats.denied > 0
            ? `All done! ${stats.approved} approved, ${stats.denied} denied this session.`
            : 'No reels with on-screen text to review.'}
        </p>
      </div>
    )
  }

  const videoUrl = record.dbRawLink || (record.dbShareLink
    ? record.dbShareLink.replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
    : null)
  const embedHtml = record.dbEmbedCode
    ? record.dbEmbedCode.replace('<video ', '<video autoplay muted loop ')
    : null
  const { inspoDirection, whatMattersMost } = parseNotes(record.notes)
  const views = formatNum(record.views)
  const likes = formatNum(record.likes)
  const comments = formatNum(record.comments)

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>Text Training</h1>
          <p style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>
            Review on-screen text for AI training examples
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#4ade80' }}>{stats.approved} approved</span>
          <span style={{ fontSize: '12px', color: '#f87171' }}>{stats.denied} denied</span>
          <span style={{ fontSize: '13px', color: '#a1a1aa', background: '#1a1a2e', padding: '4px 12px', borderRadius: '8px' }}>
            {index + 1} / {queue.length}
          </span>
        </div>
      </div>

      {/* Main card */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: '0',
        background: '#111',
        borderRadius: '16px',
        border: '1px solid #222',
        overflow: 'hidden',
        minHeight: '500px',
      }}>
        {/* Left: Video */}
        <div style={{ background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', aspectRatio: '9/16' }}>
            {embedHtml ? (
              <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: embedHtml }} />
            ) : videoUrl ? (
              <video
                key={record.id}
                src={videoUrl}
                controls
                autoPlay
                muted
                loop
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : record.thumbnail ? (
              <img src={record.thumbnail} alt={record.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
                No video
              </div>
            )}
          </div>
        </div>

        {/* Right: Details */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', maxHeight: '600px' }}>
          {/* Title + username */}
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#fff', margin: 0, lineHeight: 1.4 }}>{record.title}</h2>
            {record.username && (
              <p style={{ fontSize: '12px', color: '#71717a', marginTop: '4px' }}>@{record.username}</p>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
            {views && <span style={{ color: '#a1a1aa' }}>👁 {views}</span>}
            {likes && <span style={{ color: '#f87171' }}>❤ {likes}</span>}
            {comments && <span style={{ color: '#60a5fa' }}>💬 {comments}</span>}
          </div>

          {/* On-Screen Text — the star of the show */}
          <div style={{
            background: '#1a1a2e',
            border: '1px solid #2a2a4a',
            borderRadius: '12px',
            padding: '16px 20px',
          }}>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#a78bfa', marginBottom: '8px', fontWeight: 600 }}>
              On-Screen Text
            </p>
            <p style={{ fontSize: '15px', color: '#e4e4e7', lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>
              "{record.onScreenText}"
            </p>
          </div>

          {/* Tags */}
          {record.tags.length > 0 && (
            <div>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#52525b', marginBottom: '8px' }}>Tags</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {record.tags.map(tag => (
                  <span key={tag} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '9999px', ...tagStyle(tag) }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Inspo Direction */}
          {inspoDirection && (
            <div>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#52525b', marginBottom: '6px' }}>Inspo Direction</p>
              <p style={{ fontSize: '13px', color: '#d4d4d8', lineHeight: 1.5, margin: 0 }}>{inspoDirection}</p>
            </div>
          )}

          {/* What Matters Most */}
          {whatMattersMost && (
            <div>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#52525b', marginBottom: '6px' }}>What Matters Most</p>
              <p style={{ fontSize: '13px', color: '#d4d4d8', lineHeight: 1.5, margin: 0 }}>{whatMattersMost}</p>
            </div>
          )}

          {/* Mode selector */}
          <div>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#52525b', marginBottom: '10px' }}>
              Text Mode <span style={{ color: '#3f3f46', fontWeight: 400 }}>(press 1-5)</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {MODES.map((mode, i) => {
                const isSelected = selectedMode === mode.value
                return (
                  <button
                    key={mode.value}
                    onClick={() => setSelectedMode(mode.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: isSelected ? `1px solid ${mode.color}` : '1px solid #222',
                      background: isSelected ? `${mode.color}15` : '#0a0a0a',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: isSelected ? mode.color : '#222',
                      color: isSelected ? '#000' : '#555',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>
                      {i + 1}
                    </span>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: isSelected ? mode.color : '#a1a1aa' }}>
                        {mode.label}
                      </span>
                      <span style={{ fontSize: '11px', color: '#52525b', marginLeft: '8px' }}>
                        {mode.desc}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              onClick={handleApprove}
              disabled={saving || !selectedMode}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                background: selectedMode ? '#4ade80' : '#1a2e1a',
                color: selectedMode ? '#000' : '#4a6a4a',
                fontSize: '14px',
                fontWeight: 600,
                cursor: selectedMode ? 'pointer' : 'not-allowed',
                opacity: saving ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              Approve
            </button>
            <button
              onClick={handleDeny}
              disabled={saving}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '10px',
                border: '1px solid #333',
                background: '#1a1a1a',
                color: '#f87171',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: saving ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              Deny <span style={{ fontSize: '11px', color: '#555', fontWeight: 400 }}>(D)</span>
            </button>
          </div>

          {/* Keyboard hint */}
          <p style={{ fontSize: '11px', color: '#333', margin: 0, textAlign: 'center' }}>
            ← → navigate &nbsp;|&nbsp; 1-5 select mode &nbsp;|&nbsp; D deny
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: toast.error ? '#7f1d1d' : '#14532d',
          color: toast.error ? '#fca5a5' : '#86efac',
          padding: '10px 20px',
          borderRadius: '10px',
          fontSize: '13px',
          fontWeight: 500,
          zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
