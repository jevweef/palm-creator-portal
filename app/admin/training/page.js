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
  {
    value: 'Scenario / Fantasy',
    label: 'Scenario / Fantasy',
    color: '#a78bfa',
    desc: 'Text places the viewer into a specific situation or fantasy. The visual alone is generic — the text creates the whole concept.',
    examples: [
      '"POV: your wife canceled dinner so you call the girl next door"',
      '"When you want to be restrained and edged till you cry but you gotta act cool"',
      '"POV: your gym crush finally talks to you"',
    ],
  },
  {
    value: 'Controversy / Opinion',
    label: 'Controversy / Opinion',
    color: '#f87171',
    desc: 'Text makes a bold claim or hot take that people argue about in the comments. The video is just a pretty girl — the text is the engagement driver.',
    examples: [
      '"she is 10/10, but..."',
      '"Anything more than a handful is a waste"',
      '"Girls who lift > girls who don\'t"',
    ],
  },
  {
    value: 'Relationship / Conversation',
    label: 'Relationship / Conversation',
    color: '#f472b6',
    desc: 'Text is styled as a conversation — iMessage bubbles, DM screenshots, texts from "him," or back-and-forth dialogue. The format itself is part of the concept.',
    examples: [
      '"Him: You\'ve been running through my mind all day / Me: I\'m getting bored of that"',
      '"Texts you\'ll never receive" + screenshot',
      '"His last text vs what I sent back"',
    ],
  },
  {
    value: 'Visual Callout',
    label: 'Visual Callout',
    color: '#60a5fa',
    desc: 'Text directly references or amplifies what\'s happening on screen. The visual works alone, but the text adds a flirty or provocative spin to it.',
    examples: [
      '"I need a big boy" (girl on leg press)',
      '"Do I look like I eat salad?" (girl eating pizza)',
      '"This is what __ looks like at 5am"',
    ],
  },
  {
    value: 'Relatable / Lifestyle',
    label: 'Relatable / Lifestyle',
    color: '#4ade80',
    desc: 'Text is a relatable moment, routine caption, or lifestyle statement. Not provocative or scenario-driven — just a caption that makes viewers nod or tag a friend.',
    examples: [
      '"Things I do when I\'m home alone"',
      '"No one: / Me at 2am:"',
      '"Tell me you\'re a gym girl without telling me"',
    ],
  },
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
      <div style={{ color: '#999', padding: '60px', textAlign: 'center', fontSize: '14px' }}>
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
        <p style={{ color: '#666', fontSize: '16px', fontWeight: 500 }}>
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
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Text Training</h1>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
            Review on-screen text for AI training examples
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#22c55e' }}>{stats.approved} approved</span>
          <span style={{ fontSize: '12px', color: '#ef4444' }}>{stats.denied} denied</span>
          <span style={{ fontSize: '13px', color: '#666', background: 'var(--card-bg-solid)', border: '1px solid transparent', padding: '4px 12px', borderRadius: '8px' }}>
            {index + 1} / {queue.length}
          </span>
        </div>
      </div>

      {/* Main card */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: '0',
        background: 'var(--card-bg-solid)',
        borderRadius: '16px',
        border: '1px solid #e8dfe2',
        overflow: 'hidden',
        minHeight: '500px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
      }}>
        {/* Left: Thumbnail + play link */}
        <div style={{ background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ width: '100%', aspectRatio: '9/16', position: 'relative' }}>
            {record.thumbnail ? (
              <img src={record.thumbnail} alt={record.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
                No thumbnail
              </div>
            )}
            {/* Play button overlay — opens Dropbox video in new tab */}
            {(videoUrl || record.dbShareLink) && (
              <a
                href={record.dbShareLink || videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  textDecoration: 'none',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Right: Details */}
        <div style={{ padding: '0', display: 'flex', flexDirection: 'column', overflowY: 'auto', maxHeight: '600px' }}>

          {/* Action zone — always visible at top */}
          <div style={{ padding: '20px 28px', borderBottom: '1px solid transparent' }}>
            {/* Title + username + stats */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: 0, lineHeight: 1.4 }}>{record.title}</h2>
                {record.username && (
                  <p style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>@{record.username}</p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px', flexShrink: 0, marginTop: '2px' }}>
                {views && <span style={{ color: '#888' }}>👁 {views}</span>}
                {likes && <span style={{ color: '#E88FAC' }}>❤ {likes}</span>}
                {comments && <span style={{ color: '#6b9bd2' }}>💬 {comments}</span>}
              </div>
            </div>

            {/* On-Screen Text */}
            <div style={{
              background: 'rgba(232, 160, 160, 0.04)',
              border: '1px solid #f0d5dc',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '16px',
            }}>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#E88FAC', marginBottom: '6px', fontWeight: 600 }}>
                On-Screen Text
              </p>
              <p style={{ fontSize: '15px', color: '#333', lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>
                "{record.onScreenText}"
              </p>
            </div>

            {/* Helper criteria */}
            <div style={{
              background: '#f8f4f5',
              border: '1px solid #e8dfe2',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '11px',
              color: '#777',
              lineHeight: 1.5,
            }}>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>Approve</span> if an editor would need to come up with text like this for a raw clip.{' '}
              <span style={{ color: '#ef4444', fontWeight: 600 }}>Deny</span> if the text is inseparable from the full concept (creator recreates the whole package).
            </div>

            {/* Mode selector */}
            <div style={{ marginBottom: '14px' }}>
              <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '8px' }}>
                Text Mode <span style={{ color: '#bbb', fontWeight: 400 }}>(1-5)</span>
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {MODES.map((mode, i) => {
                  const isSelected = selectedMode === mode.value
                  return (
                    <button
                      key={mode.value}
                      onClick={() => setSelectedMode(mode.value)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: isSelected ? `1px solid ${mode.color}` : '1px solid transparent',
                        background: isSelected ? `${mode.color}15` : '#f8f8f8',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <span style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        background: isSelected ? mode.color : '#ddd',
                        color: isSelected ? '#fff' : '#999',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: isSelected ? mode.color : '#555', whiteSpace: 'nowrap' }}>
                        {mode.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Selected mode detail */}
              {selectedMode && (() => {
                const mode = MODES.find(m => m.value === selectedMode)
                if (!mode) return null
                return (
                  <div style={{
                    marginTop: '10px',
                    background: `${mode.color}08`,
                    border: `1px solid ${mode.color}30`,
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}>
                    <p style={{ fontSize: '12px', color: '#444', lineHeight: 1.5, margin: '0 0 8px' }}>
                      {mode.desc}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {mode.examples.map((ex, j) => (
                        <p key={j} style={{ fontSize: '11px', color: '#888', margin: 0, fontStyle: 'italic' }}>
                          {ex}
                        </p>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleApprove}
                disabled={saving || !selectedMode}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  background: selectedMode ? '#22c55e' : '#e8e8e8',
                  color: selectedMode ? '#fff' : '#aaa',
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
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid #e8dfe2',
                  background: 'var(--card-bg-solid)',
                  color: '#ef4444',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: saving ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                Deny <span style={{ fontSize: '11px', color: '#ccc', fontWeight: 400 }}>(D)</span>
              </button>
            </div>

            {/* Keyboard hint */}
            <p style={{ fontSize: '10px', color: '#bbb', margin: '8px 0 0', textAlign: 'center' }}>
              ← → navigate &nbsp;|&nbsp; 1-5 select mode &nbsp;|&nbsp; D deny
            </p>
          </div>

          {/* Reference material — scrollable below */}
          <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Tags */}
            {record.tags.length > 0 && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '8px' }}>Tags</p>
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
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '6px' }}>Inspo Direction</p>
                <p style={{ fontSize: '13px', color: '#444', lineHeight: 1.5, margin: 0 }}>{inspoDirection}</p>
              </div>
            )}

            {/* What Matters Most */}
            {whatMattersMost && (
              <div>
                <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '6px' }}>What Matters Most</p>
                <p style={{ fontSize: '13px', color: '#444', lineHeight: 1.5, margin: 0 }}>{whatMattersMost}</p>
              </div>
            )}
          </div>
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
