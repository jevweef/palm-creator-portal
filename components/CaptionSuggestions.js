'use client'

import { useState } from 'react'

const CAPTION_MODES = [
  { value: 'Scenario / Fantasy', label: 'Scenario', color: '#a78bfa' },
  { value: 'Controversy / Opinion', label: 'Controversy', color: '#f87171' },
  { value: 'Relationship / Conversation', label: 'Relationship', color: '#f472b6' },
  { value: 'Visual Callout', label: 'Visual Callout', color: '#60a5fa' },
  { value: 'Relatable / Lifestyle', label: 'Relatable', color: '#4ade80' },
  { value: 'Mood / Reflective', label: 'Mood', color: '#22d3ee' },
]

/**
 * Shared caption suggestion UI.
 * - thumbnailUrl: frame to analyze
 * - creatorId: optional, passed to API for DNA context
 * - onPick: optional callback (text) => void. When provided, each suggestion shows a "Use" button that calls this with the text. When absent, each suggestion has a "copy" button instead.
 * - compact: smaller collapsed state (icon-only trigger)
 */
export default function CaptionSuggestions({ thumbnailUrl, creatorId, onPick, compact = false }) {
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState(null)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [error, setError] = useState('')
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [pickedIdx, setPickedIdx] = useState(null)

  async function generate(selectedMode) {
    setMode(selectedMode)
    setLoading(true)
    setError('')
    setSuggestions(null)
    try {
      const res = await fetch('/api/editor/suggest-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thumbnailUrl, mode: selectedMode, creatorId, count: 5 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSuggestions(data.suggestions || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function copyText(text, idx) {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  function pickText(text, idx) {
    onPick?.(text)
    setPickedIdx(idx)
    setTimeout(() => setPickedIdx(null), 1500)
  }

  if (!thumbnailUrl) return null

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          padding: compact ? '4px 8px' : '8px 12px',
          fontSize: compact ? '11px' : '12px',
          fontWeight: 600,
          background: 'rgba(167, 139, 250, 0.08)',
          color: '#a78bfa',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          borderRadius: '6px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        ✨ Suggest on-screen text
      </button>
    )
  }

  return (
    <div style={{
      background: 'var(--background)',
      border: '1px solid rgba(167, 139, 250, 0.2)',
      borderRadius: '8px',
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          ✨ Caption Suggestions
        </div>
        <button
          onClick={() => { setExpanded(false); setSuggestions(null); setMode(null); setError('') }}
          style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '16px', cursor: 'pointer', padding: 0, lineHeight: 1 }}
        >×</button>
      </div>

      {/* Mode pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {CAPTION_MODES.map(m => (
          <button
            key={m.value}
            onClick={() => generate(m.value)}
            disabled={loading}
            style={{
              padding: '4px 10px', fontSize: '11px', fontWeight: 500,
              background: mode === m.value ? `${m.color}25` : 'transparent',
              color: mode === m.value ? m.color : 'var(--foreground-muted)',
              border: `1px solid ${mode === m.value ? m.color : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading && mode !== m.value ? 0.4 : 1,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
          Thinking…
        </div>
      )}

      {error && (
        <div style={{ fontSize: '11px', color: '#f87171' }}>{error}</div>
      )}

      {suggestions && suggestions.length === 0 && !loading && (
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>No suggestions returned.</div>
      )}

      {suggestions?.map((s, i) => (
        <div key={i} style={{
          background: 'var(--card-bg-solid)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '6px',
          padding: '8px 10px',
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, fontSize: '12px', color: 'var(--foreground)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'pre-line' }}>
              "{s.text}"
            </div>
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              {onPick && (
                <button
                  onClick={() => pickText(s.text, i)}
                  style={{
                    padding: '3px 8px', fontSize: '10px', fontWeight: 600,
                    background: pickedIdx === i ? '#a78bfa' : 'rgba(167, 139, 250, 0.15)',
                    color: pickedIdx === i ? '#fff' : '#a78bfa',
                    border: 'none', borderRadius: '4px', cursor: 'pointer',
                  }}
                >
                  {pickedIdx === i ? '✓ used' : 'use'}
                </button>
              )}
              <button
                onClick={() => copyText(s.text, i)}
                style={{
                  padding: '3px 8px', fontSize: '10px', fontWeight: 600,
                  background: copiedIdx === i ? '#4ade80' : 'rgba(255,255,255,0.06)',
                  color: copiedIdx === i ? '#000' : 'var(--foreground-muted)',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                {copiedIdx === i ? '✓' : 'copy'}
              </button>
            </div>
          </div>
          {s.reasoning && (
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '4px', fontStyle: 'italic' }}>
              {s.reasoning}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
