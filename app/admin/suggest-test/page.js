'use client'

import { useState, useEffect, useMemo } from 'react'

const MODES = [
  { value: 'Scenario / Fantasy', color: '#a78bfa' },
  { value: 'Controversy / Opinion', color: '#f87171' },
  { value: 'Relationship / Conversation', color: '#f472b6' },
  { value: 'Visual Callout', color: '#60a5fa' },
  { value: 'Relatable / Lifestyle', color: '#4ade80' },
  { value: 'Mood / Reflective', color: '#22d3ee' },
]

export default function SuggestTestPage() {
  const [reels, setReels] = useState([])
  const [search, setSearch] = useState('')
  const [selectedReel, setSelectedReel] = useState(null)
  const [customThumb, setCustomThumb] = useState('')
  const [mode, setMode] = useState('Scenario / Fantasy')
  const [loading, setLoading] = useState(false)
  const [reelsLoading, setReelsLoading] = useState(true)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/admin/inspiration-picker')
      .then(r => r.json())
      .then(d => setReels(d.records || []))
      .finally(() => setReelsLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return reels.slice(0, 40)
    const q = search.toLowerCase()
    return reels.filter(r =>
      r.username.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.onScreenText.toLowerCase().includes(q)
    ).slice(0, 40)
  }, [reels, search])

  const activeThumb = customThumb || selectedReel?.thumbnail || null

  async function generate() {
    if (!activeThumb) {
      setError('Pick a reel or paste a thumbnail URL first')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/editor/suggest-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thumbnailUrl: activeThumb,
          mode,
          count: 5,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed')
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Text Suggestion — Sandbox</h1>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
          Pick any inspo reel (or paste a thumbnail URL), select a mode, and see what the AI suggests for on-screen text.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* LEFT: Reel picker + controls */}
        <div>
          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '8px', fontWeight: 600 }}>1. Pick a reel</p>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by @username, title, or text..."
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '13px',
                background: '#fff',
                color: '#333',
                marginBottom: '10px',
              }}
            />
            <div style={{
              maxHeight: '280px',
              overflowY: 'auto',
              border: '1px solid #eee',
              borderRadius: '10px',
              background: '#fff',
              padding: '6px',
            }}>
              {reelsLoading && <p style={{ padding: '16px', color: '#999', fontSize: '13px', textAlign: 'center' }}>Loading reels…</p>}
              {!reelsLoading && filtered.length === 0 && <p style={{ padding: '16px', color: '#999', fontSize: '13px', textAlign: 'center' }}>No matches</p>}
              {!reelsLoading && filtered.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setSelectedReel(r); setCustomThumb('') }}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    background: selectedReel?.id === r.id ? '#FFF0F3' : 'transparent',
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    marginBottom: '2px',
                    alignItems: 'center',
                  }}
                >
                  <img src={r.thumbnail} alt="" style={{ width: '34px', height: '60px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0, background: '#000' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{r.username} · {r.title}</div>
                    {r.onScreenText && (
                      <div style={{ fontSize: '11px', color: '#888', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{r.onScreenText}"</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: '10px' }}>
              <input
                type="text"
                value={customThumb}
                onChange={e => { setCustomThumb(e.target.value); setSelectedReel(null) }}
                placeholder="...or paste a thumbnail image URL"
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  fontSize: '12px',
                  background: '#fff',
                  color: '#555',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '8px', fontWeight: 600 }}>2. Pick a mode</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {MODES.map(m => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: mode === m.value ? `1px solid ${m.color}` : '1px solid #ddd',
                    background: mode === m.value ? `${m.color}18` : '#fff',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: mode === m.value ? m.color : '#555',
                    cursor: 'pointer',
                  }}
                >
                  {m.value}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generate}
            disabled={loading || !activeThumb}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '10px',
              border: 'none',
              background: !activeThumb ? '#e8e8e8' : 'var(--palm-pink)',
              color: !activeThumb ? '#aaa' : '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading || !activeThumb ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Generating…' : 'Generate suggestions'}
          </button>

          {error && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '12px' }}>
              {error}
            </div>
          )}
        </div>

        {/* RIGHT: Target preview + suggestions */}
        <div>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '8px', fontWeight: 600 }}>Target clip</p>
          <div style={{ display: 'flex', gap: '14px', marginBottom: '18px' }}>
            <div style={{ width: '120px', aspectRatio: '9/16', background: '#000', borderRadius: '10px', overflow: 'hidden', flexShrink: 0 }}>
              {activeThumb ? (
                <img src={activeThumb} alt="target" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '11px' }}>
                  No target
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {selectedReel && (
                <>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#222' }}>@{selectedReel.username}</div>
                  <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{selectedReel.title}</div>
                  {selectedReel.onScreenText && (
                    <div style={{ marginTop: '10px', padding: '8px 12px', background: '#f8f8f8', borderRadius: '8px', fontSize: '12px', color: '#444', fontStyle: 'italic' }}>
                      Actual text: "{selectedReel.onScreenText}"
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#999', marginBottom: '8px', fontWeight: 600 }}>
            AI Suggestions {result ? `(${result.trainingExampleCount} examples used)` : ''}
          </p>
          {!result && !loading && (
            <div style={{ padding: '40px 20px', border: '1px dashed #ddd', borderRadius: '10px', textAlign: 'center', color: '#bbb', fontSize: '13px' }}>
              Suggestions will appear here
            </div>
          )}
          {loading && (
            <div style={{ padding: '40px 20px', border: '1px dashed #ddd', borderRadius: '10px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
              Thinking…
            </div>
          )}
          {result?.suggestions?.map((s, i) => (
            <div key={i} style={{
              padding: '12px 16px',
              background: '#fff',
              border: '1px solid #eee',
              borderRadius: '10px',
              marginBottom: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}>
              <div style={{ fontSize: '14px', color: '#222', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'pre-line' }}>
                "{s.text}"
              </div>
              {s.reasoning && (
                <div style={{ fontSize: '11px', color: '#888', marginTop: '6px', fontStyle: 'italic' }}>
                  {s.reasoning}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
