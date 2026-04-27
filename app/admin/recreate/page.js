'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

const NANO_BANANA_URL = 'https://wavespeed.ai/models/google/nano-banana-2/edit'
const KLING_URL = 'https://wavespeed.ai/models/kwaivgi/kling-video-o3-pro/image-to-video'

function shortcodeFromUrl(url) {
  const m = url?.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        if (!text) return
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      style={{
        padding: '6px 12px', fontSize: '12px', fontWeight: 600,
        background: copied ? '#7DD3A4' : 'var(--palm-pink)',
        color: '#060606', border: 'none', borderRadius: '6px',
        cursor: text ? 'pointer' : 'not-allowed', opacity: text ? 1 : 0.4,
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

function StepCard({ n, title, status, children }) {
  return (
    <div style={{
      background: 'var(--card-bg-solid)',
      borderRadius: '18px', padding: '20px', marginBottom: '16px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '50%',
          background: 'var(--palm-pink)', color: '#060606',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: 700, flexShrink: 0,
        }}>{n}</div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)' }}>{title}</div>
        {status && (
          <span style={{
            fontSize: '10px', padding: '2px 8px', borderRadius: '3px', fontWeight: 600,
            background: 'rgba(255, 200, 100, 0.08)', color: '#FFC864',
            border: '1px solid rgba(255, 200, 100, 0.2)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>{status}</span>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}

function FrameCapture({ videoUrl, onCapture }) {
  const videoRef = useRef(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [error, setError] = useState('')
  const proxiedUrl = `/api/admin/video-proxy?url=${encodeURIComponent(rawDropboxUrl(videoUrl))}`

  const handleScrub = (e) => {
    const t = parseFloat(e.target.value)
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  const handleCapture = () => {
    setError('')
    const video = videoRef.current
    if (!video || !video.videoWidth) { setError('Video not ready'); return }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    try { onCapture(canvas.toDataURL('image/jpeg', 0.92)) }
    catch (e) { setError(e.message) }
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      <div style={{ width: '180px', aspectRatio: '9/16', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
        <video
          ref={videoRef}
          src={proxiedUrl}
          crossOrigin="anonymous"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
          onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
          onError={() => setError('Failed to load video')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', minWidth: '32px', fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.05}
            value={currentTime}
            onChange={handleScrub}
            style={{ flex: 1, accentColor: 'var(--palm-pink)', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTime(duration)}</span>
        </div>
        {error && <div style={{ fontSize: '11px', color: '#E87878' }}>{error}</div>}
        <button
          onClick={handleCapture}
          disabled={!duration}
          style={{ padding: '10px', background: !duration ? 'rgba(232, 160, 160, 0.06)' : 'var(--palm-pink)', border: 'none', color: !duration ? 'var(--foreground-subtle)' : '#060606', borderRadius: '8px', cursor: !duration ? 'default' : 'pointer', fontSize: '13px', fontWeight: 700 }}
        >
          📸 Capture this frame
        </button>
      </div>
    </div>
  )
}

// ChatGPT prompt template that turns existing inspo analysis into a Kling-formatted action prompt.
// Until the analysis pipeline auto-generates these, the user pastes this into ChatGPT with the frame.
function buildKlingChatGPTPrompt({ notes, onScreenText, tags, filmFormat, title }) {
  const tagsLine = (tags || []).join(', ')
  const filmLine = (filmFormat || []).join(', ')
  return `Convert this video analysis into a Kling V3.0 4K image-to-video prompt.

Format requirements (one paragraph, copy-paste ready):
- Start with camera framing: "Selfie shot of...", "Mirror selfie of...", "Static shot of...", etc.
- Describe the subject as an "american girl" — keep generic, NO shape/hair/face/body details
- Describe the literal action happening on screen, beat by beat
- If she speaks, include the exact spoken quote: she said "..."
- End with motion descriptors: "Realistic lip sync, subtle hand-held movement, natural movements"
- Add constraints when relevant: "no phone visible" if hand frames a selfie, "no cuts", etc.
- Add voice direction at the end: "american accent"
- No cinematic language. No fantasy words. No camera-direction jargon. No body-shape descriptors.

Video analysis:
Title: ${title || '(none)'}
Tags: ${tagsLine || '(none)'}
Film Format: ${filmLine || '(none)'}
On-Screen Text: ${onScreenText || '(none)'}

Inspo direction + what matters most:
${notes || '(none)'}

The reference image is attached. Output ONE Kling V3.0 4K image-to-video prompt only.`
}

export default function RecreatePage() {
  const searchParams = useSearchParams()
  const initialUrl = searchParams.get('url') || ''
  const initialCreatorId = searchParams.get('creatorId') || ''

  const [reelUrl, setReelUrl] = useState(initialUrl)
  const [lookup, setLookup] = useState(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [sourceFrame, setSourceFrame] = useState(null) // data URL or attachment URL
  const [showScrubber, setShowScrubber] = useState(false)
  const [allCreators, setAllCreators] = useState([])
  const [selectedCreator, setSelectedCreator] = useState(initialCreatorId)
  const [klingPrompt, setKlingPrompt] = useState('')

  // Scene prompt extraction (Claude Sonnet vision on the source frame)
  const [scenePrompt, setScenePrompt] = useState({ positive: '', negative: '', shotType: '' })
  const [extractingScene, setExtractingScene] = useState(false)
  const [sceneError, setSceneError] = useState('')

  const handleExtractScene = async () => {
    if (!sourceFrame) { setSceneError('Pick a frame in Step 2 first.'); return }
    setExtractingScene(true); setSceneError('')
    try {
      const body = sourceFrame.startsWith('data:')
        ? { frameDataUrl: sourceFrame }
        : { frameUrl: sourceFrame }
      const res = await fetch('/api/admin/recreate/extract-scene-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.raw ? ` — raw: ${typeof data.raw === 'string' ? data.raw.slice(0, 300) : JSON.stringify(data.raw).slice(0, 300)}` : ''
        throw new Error((data.error || 'Extraction failed') + detail)
      }
      setScenePrompt({
        positive: data.positivePrompt,
        negative: data.negativePrompt,
        shotType: data.shotType,
      })
    } catch (e) { setSceneError(e.message) }
    finally { setExtractingScene(false) }
  }

  // Swap creator into the frame via Wan 2.7 image-edit
  const [swapTaskId, setSwapTaskId] = useState(null)
  const [swapResult, setSwapResult] = useState(null) // { url, filename }
  const [swapError, setSwapError] = useState('')
  const [swapping, setSwapping] = useState(false)
  const [swapMeta, setSwapMeta] = useState(null) // { pose, referenceCount }

  // shortcode needs to be available before any effect that depends on it
  const shortcode = useMemo(() => shortcodeFromUrl(reelUrl), [reelUrl])

  const handleSwap = async () => {
    if (!sourceFrame) { setSwapError('Pick a frame in Step 2 first.'); return }
    if (!selectedCreator) { setSwapError('Pick a creator in Step 4 first.'); return }
    if (!scenePrompt.positive) { setSwapError('Run Step 3 to extract the scene prompt first.'); return }
    setSwapping(true); setSwapError(''); setSwapResult(null); setSwapTaskId(null); setSwapMeta(null)
    try {
      const body = {
        creatorId: selectedCreator,
        shotType: scenePrompt.shotType,
        shortcode: shortcode || undefined,
        positivePrompt: scenePrompt.positive,
        ...(sourceFrame.startsWith('data:') ? { frameDataUrl: sourceFrame } : { frameUrl: sourceFrame }),
      }
      const res = await fetch('/api/admin/recreate/swap-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Swap submit failed')
      setSwapTaskId(data.taskId)
      setSwapMeta({ pose: data.pose, referenceCount: data.referenceCount, referenceFilenames: data.referenceFilenames || [] })
    } catch (e) { setSwapError(e.message); setSwapping(false) }
  }

  // Motion prompt extraction (Gemini on the inspo video)
  const [motionPrompt, setMotionPrompt] = useState({ positive: '', negative: '' })
  const [extractingMotion, setExtractingMotion] = useState(false)
  const [motionError, setMotionError] = useState('')

  const handleExtractMotion = async () => {
    if (!lookup?.dbRawLink) {
      setMotionError('No video URL found for this reel — needs to be in the Inspiration pipeline.')
      return
    }
    setExtractingMotion(true); setMotionError('')
    try {
      const res = await fetch('/api/admin/recreate/extract-motion-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: lookup.dbRawLink }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Motion extraction failed')
      setMotionPrompt({ positive: data.positivePrompt, negative: data.negativePrompt })
    } catch (e) { setMotionError(e.message) }
    finally { setExtractingMotion(false) }
  }

  // Poll swap status
  useEffect(() => {
    if (!swapTaskId) return
    let cancelled = false
    const startedAt = Date.now()
    const MAX_MS = 5 * 60 * 1000
    const poll = async () => {
      try {
        if (Date.now() - startedAt > MAX_MS) {
          setSwapError('Timed out after 5 min — WaveSpeed may be overloaded')
          setSwapTaskId(null); setSwapping(false); return
        }
        const res = await fetch('/api/admin/recreate/swap-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: swapTaskId, creatorId: selectedCreator, shortcode: shortcode || undefined }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setSwapError(data.error || `Poll failed (${res.status})`)
          setSwapTaskId(null); setSwapping(false); return
        }
        if (data.status === 'completed') {
          setSwapResult({ url: data.outputUrl, filename: data.filename })
          setSwapTaskId(null); setSwapping(false)
        } else if (data.status === 'failed') {
          setSwapError(data.error || 'Generation failed')
          setSwapTaskId(null); setSwapping(false)
        } else {
          setTimeout(poll, 4000)
        }
      } catch (e) {
        if (cancelled) return
        setSwapError(e.message)
        setSwapTaskId(null); setSwapping(false)
      }
    }
    poll()
    return () => { cancelled = true }
  }, [swapTaskId, selectedCreator, shortcode])

  useEffect(() => {
    fetch('/api/admin/palm-creators').then(r => r.json()).then(d => setAllCreators(d.creators || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!shortcode) { setLookup(null); return }
    let cancelled = false
    setLookupLoading(true)
    setSourceFrame(null)
    setShowScrubber(false)
    fetch(`/api/admin/recreate/lookup?shortcode=${encodeURIComponent(shortcode)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setLookup(d); if (d?.klingPrompt) setKlingPrompt(d.klingPrompt) } })
      .catch(() => { if (!cancelled) setLookup(null) })
      .finally(() => { if (!cancelled) setLookupLoading(false) })
    return () => { cancelled = true }
  }, [shortcode])

  const creator = useMemo(() => allCreators.find(c => c.id === selectedCreator), [allCreators, selectedCreator])

  const chatgptPrompt = useMemo(() => {
    if (!lookup) return ''
    return buildKlingChatGPTPrompt({
      notes: lookup.notes,
      onScreenText: lookup.onScreenText,
      tags: lookup.tags,
      filmFormat: lookup.filmFormat,
      title: lookup.title,
    })
  }, [lookup])

  const downloadFrame = () => {
    if (!sourceFrame) return
    const a = document.createElement('a')
    a.href = sourceFrame
    a.download = `inspo_frame_${shortcode || 'reel'}.jpg`
    a.click()
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)' }}>AI Recreate</div>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
          Inspo reel → Nano Banana 2 (creator-swap on the frame) → Kling V3.0 4K (animate). Work in progress.
        </div>
      </div>

      {/* Step 1 — Inspo Reel */}
      <StepCard n={1} title="Inspo Reel">
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            placeholder="https://www.instagram.com/reel/..."
            value={reelUrl}
            onChange={e => setReelUrl(e.target.value)}
            style={{
              flex: 1, padding: '8px 12px', fontSize: '13px',
              background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '6px', color: 'var(--foreground)',
            }}
          />
          {shortcode && (
            <button
              onClick={() => window.open(`https://www.instagram.com/reel/${shortcode}/`, 'inspo_reel_viewer', 'width=450,height=850')}
              style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
            >Open Reel ↗</button>
          )}
        </div>
        {shortcode && (
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            Shortcode: <code style={{ color: 'var(--palm-pink)' }}>{shortcode}</code>
            {lookupLoading && <span style={{ marginLeft: '12px' }}>Looking up in pipeline…</span>}
            {!lookupLoading && lookup?.error && <span style={{ marginLeft: '12px', color: '#E87878' }}>Lookup error: {lookup.error}</span>}
            {!lookupLoading && lookup?.source && <span style={{ marginLeft: '12px', color: '#7DD3A4' }}>✓ Found {lookup.title ? `"${lookup.title}"` : ''} in {lookup.source}</span>}
            {!lookupLoading && lookup && !lookup.source && !lookup.error && <span style={{ marginLeft: '12px', color: '#FFC864' }}>Not in pipeline — manual upload available below</span>}
          </div>
        )}
      </StepCard>

      {/* Step 2 — Source Frame */}
      <StepCard n={2} title="Source Frame">
        {sourceFrame ? (
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceFrame} alt="Source frame" style={{ width: '180px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '13px', color: '#7DD3A4', fontWeight: 600 }}>✓ Frame loaded</div>
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Held in memory and passed to the downstream steps automatically.</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => { setSourceFrame(null); setShowScrubber(false) }} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer' }}>Pick another</button>
                <button onClick={downloadFrame} title="Optional: download a copy" style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-subtle)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', cursor: 'pointer' }}>↓ JPEG</button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Default: existing analysis thumbnail */}
            {lookup?.thumbnail && !showScrubber && (
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '12px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lookup.thumbnail} alt="Pipeline thumbnail" style={{ width: '180px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>Frame from analysis</div>
                  <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>This is the frame the inspo pipeline already pulled. Most of the time this is the one you want.</div>
                  <button
                    onClick={() => setSourceFrame(lookup.thumbnail)}
                    style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 700, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' }}
                  >
                    Use this frame
                  </button>
                  {lookup.dbRawLink && (
                    <button
                      onClick={() => setShowScrubber(true)}
                      style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' }}
                    >
                      Pick a different frame from the video
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Scrubber: only when user opts in */}
            {lookup?.dbRawLink && showScrubber && (
              <FrameCapture videoUrl={lookup.dbRawLink} onCapture={setSourceFrame} />
            )}

            {/* Fallback: manual upload */}
            {(!lookup || (!lookup.thumbnail && !lookup.dbRawLink)) && (
              <div>
                <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
                  {lookup === null && shortcode ? 'Looking up…' : 'No saved frame for this reel. Upload a screenshot manually:'}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => {
                    const file = e.target.files?.[0]; if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => setSourceFrame(ev.target.result)
                    reader.readAsDataURL(file)
                  }}
                  style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}
                />
              </div>
            )}
          </div>
        )}
      </StepCard>

      {/* Step 3 — Extract scene prompt with Claude Sonnet */}
      <StepCard n={3} title="Extract Scene Prompt (Claude Sonnet)" status={scenePrompt.positive ? null : 'auto'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          Sonnet looks at the frame from Step 2 and returns a scene-only prompt
          (clothing, setting, action, framing, lighting, vibe — no character traits)
          plus a strong negative prompt and the shot type for picking the right
          reference photos.
        </div>
        <button
          onClick={handleExtractScene}
          disabled={extractingScene || !sourceFrame}
          style={{
            padding: '8px 14px', fontSize: '12px', fontWeight: 700,
            background: !sourceFrame ? 'rgba(232, 160, 160, 0.06)' : (extractingScene ? 'rgba(232,160,160,0.3)' : 'var(--palm-pink)'),
            color: !sourceFrame ? 'var(--foreground-subtle)' : '#060606',
            border: 'none', borderRadius: '6px',
            cursor: extractingScene ? 'wait' : (!sourceFrame ? 'not-allowed' : 'pointer'),
          }}
        >
          {extractingScene ? '⏳ Sonnet analyzing…' : '✨ Extract scene prompt'}
        </button>
        {sceneError && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
            {sceneError}
          </div>
        )}
        {scenePrompt.positive && (
          <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Shot type · <span style={{ color: 'var(--palm-pink)', textTransform: 'none' }}>{scenePrompt.shotType}</span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', fontStyle: 'italic' }}>
                Will use the {scenePrompt.shotType === 'close-up' ? 'Close Up Face' : scenePrompt.shotType === 'back' ? 'Back View' : 'Front View'} input photos for the swap in Step 5.
              </div>
            </div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Positive prompt
              </div>
              <textarea
                value={scenePrompt.positive}
                onChange={e => setScenePrompt(s => ({ ...s, positive: e.target.value }))}
                rows={6}
                style={{ width: '100%', padding: '8px', fontSize: '11px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Negative prompt
              </div>
              <textarea
                value={scenePrompt.negative}
                onChange={e => setScenePrompt(s => ({ ...s, negative: e.target.value }))}
                rows={4}
                style={{ width: '100%', padding: '8px', fontSize: '11px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
              />
            </div>
            <button
              onClick={handleExtractScene}
              disabled={extractingScene}
              style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
            >
              {extractingScene ? '…' : '🔄 Regenerate'}
            </button>
          </div>
        )}
      </StepCard>

      {/* Step 4 — Pick Creator (filtered to AI-enabled only) */}
      <StepCard n={4} title="Pick Creator" status={creator && initialCreatorId ? null : null}>
        {(() => {
          // Only AI-enabled creators are valid for this workflow
          const aiEnabled = allCreators.filter(c => c.aiConversionsEnabled)
          if (initialCreatorId && creator?.aiConversionsEnabled) {
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>
                    {creator.aka || creator.name}
                  </span>
                  <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid rgba(125, 211, 164, 0.2)' }}>
                    AUTO-SELECTED
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '6px', fontStyle: 'italic' }}>
                  Picked from your &quot;view as&quot; selection on the Inspo Board.
                </div>
                <button
                  onClick={() => setSelectedCreator('')}
                  style={{ marginTop: '8px', padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Change creator
                </button>
              </div>
            )
          }
          return (
            <>
              <select
                value={selectedCreator}
                onChange={e => setSelectedCreator(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', fontSize: '13px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)' }}
              >
                <option value="">— Select creator —</option>
                {aiEnabled.map(c => (
                  <option key={c.id} value={c.id}>{c.aka || c.name}</option>
                ))}
              </select>
              {aiEnabled.length === 0 && (
                <div style={{ fontSize: '11px', color: '#FFC864', marginTop: '8px', fontStyle: 'italic' }}>
                  No creators have AI Conversions enabled. Toggle one on in Admin → Creators → DNA → AI Super Clone.
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '8px', fontStyle: 'italic' }}>
                Only AI-enabled creators shown. Step 5 auto-pulls their saved reference input photos based on the shot type from Step 3.
              </div>
            </>
          )
        })()}
      </StepCard>

      {/* Step 5 — Swap Creator into the Frame via Wan 2.7 (API) */}
      <StepCard n={5} title="Swap Creator into the Frame (Wan 2.7)" status={swapResult ? null : 'auto'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          Sends only {creator ? <strong style={{ color: 'var(--foreground)' }}>{creator.aka || creator.name}&apos;s</strong> : 'the creator\'s'} reference input photos
          (auto-picked: <strong style={{ color: 'var(--foreground)' }}>{scenePrompt.shotType ? (scenePrompt.shotType === 'close-up' ? 'Close Up Face' : scenePrompt.shotType === 'back' ? 'Back View' : 'Front View') : 'pending Step 3'}</strong>)
          + the scene prompt to Wan 2.7. The source frame stays with Sonnet — never sent to Wan.
        </div>
        <button
          onClick={handleSwap}
          disabled={swapping || !sourceFrame || !selectedCreator || !scenePrompt.positive}
          style={{
            padding: '8px 14px', fontSize: '12px', fontWeight: 700,
            background: (!sourceFrame || !selectedCreator || !scenePrompt.positive) ? 'rgba(232, 160, 160, 0.06)' : (swapping ? 'rgba(232,160,160,0.3)' : 'var(--palm-pink)'),
            color: (!sourceFrame || !selectedCreator || !scenePrompt.positive) ? 'var(--foreground-subtle)' : '#060606',
            border: 'none', borderRadius: '6px',
            cursor: swapping ? 'wait' : ((!sourceFrame || !selectedCreator || !scenePrompt.positive) ? 'not-allowed' : 'pointer'),
          }}
        >
          {swapping ? '⏳ Wan 2.7 generating… (~30-60s)' : '✨ Generate creator-swapped image'}
        </button>
        {swapMeta && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--foreground-muted)' }}>
            <div style={{ fontStyle: 'italic', marginBottom: '4px' }}>
              Using {swapMeta.referenceCount} {swapMeta.pose} reference photos:
            </div>
            {swapMeta.referenceFilenames?.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '18px', fontFamily: 'monospace', fontSize: '10px', color: 'var(--foreground-subtle)', lineHeight: 1.6 }}>
                {swapMeta.referenceFilenames.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
          </div>
        )}

        {scenePrompt.positive && (
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--foreground-muted)' }}>
            <label>Override shot type:</label>
            <select
              value={scenePrompt.shotType}
              onChange={e => setScenePrompt(s => ({ ...s, shotType: e.target.value }))}
              style={{ padding: '3px 8px', fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: 'var(--foreground)' }}
            >
              <option value="close-up">close-up → Close Up Face inputs</option>
              <option value="front">front → Front View inputs</option>
              <option value="back">back → Back View inputs</option>
            </select>
          </div>
        )}
        {swapError && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
            {swapError}
          </div>
        )}
        {swapResult && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              Result · saved to Dropbox
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={swapResult.url} alt="Swapped" style={{ width: '180px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block', cursor: 'zoom-in' }} onClick={() => window.open(swapResult.url, '_blank')} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '12px', color: '#7DD3A4', fontWeight: 600 }}>✓ Saved</div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{swapResult.filename}</div>
                <button
                  onClick={handleSwap}
                  disabled={swapping}
                  style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {swapping ? '…' : '🔄 Regenerate'}
                </button>
              </div>
            </div>
          </div>
        )}
      </StepCard>

      {/* Step 6 — Extract motion prompt via Gemini */}
      <StepCard n={6} title="Extract Motion Prompt (Gemini)" status={motionPrompt.positive ? null : 'auto'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          Gemini watches the original reel and returns a Kling V3.0–formatted motion prompt
          (camera framing, action beat-by-beat, exact spoken quote if any, motion descriptors)
          plus a strong negative prompt.
        </div>
        <button
          onClick={handleExtractMotion}
          disabled={extractingMotion || !lookup?.dbRawLink}
          style={{
            padding: '8px 14px', fontSize: '12px', fontWeight: 700,
            background: !lookup?.dbRawLink ? 'rgba(232, 160, 160, 0.06)' : (extractingMotion ? 'rgba(232,160,160,0.3)' : 'var(--palm-pink)'),
            color: !lookup?.dbRawLink ? 'var(--foreground-subtle)' : '#060606',
            border: 'none', borderRadius: '6px',
            cursor: extractingMotion ? 'wait' : (!lookup?.dbRawLink ? 'not-allowed' : 'pointer'),
          }}
        >
          {extractingMotion ? '⏳ Gemini analyzing video…' : '✨ Extract motion prompt'}
        </button>
        {!lookup?.dbRawLink && shortcode && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
            This reel needs to be in the Inspiration pipeline (with a Dropbox-hosted video) for Gemini to analyze it.
          </div>
        )}
        {motionError && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
            {motionError}
          </div>
        )}
        {motionPrompt.positive && (
          <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Motion (positive) prompt
              </div>
              <textarea
                value={motionPrompt.positive}
                onChange={e => setMotionPrompt(s => ({ ...s, positive: e.target.value }))}
                rows={6}
                style={{ width: '100%', padding: '8px', fontSize: '11px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Negative prompt
              </div>
              <textarea
                value={motionPrompt.negative}
                onChange={e => setMotionPrompt(s => ({ ...s, negative: e.target.value }))}
                rows={4}
                style={{ width: '100%', padding: '8px', fontSize: '11px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
              />
            </div>
            <button
              onClick={handleExtractMotion}
              disabled={extractingMotion}
              style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
            >
              {extractingMotion ? '…' : '🔄 Regenerate'}
            </button>
          </div>
        )}
      </StepCard>

      {/* Step 6 — Animate in Kling */}
      <StepCard n={7} title="Animate in Kling V3.0 4K">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
          Upload the Nano Banana 2 output (the creator-swapped image), paste the Kling prompt from Step 5, and generate.
        </div>
        <a href={KLING_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <button style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Open Kling ↗</button>
        </a>
      </StepCard>

      {/* Step 7 — Final */}
      <StepCard n={8} title="Save Final Output" status="tbd">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
          Will eventually attach the final video to the creator&apos;s asset library and the originating inspo reel record.
        </div>
      </StepCard>

      {/* TODO callout */}
      <div style={{ background: 'rgba(255, 200, 100, 0.04)', border: '1px solid rgba(255, 200, 100, 0.15)', borderRadius: '12px', padding: '16px', marginTop: '24px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFC864', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Next on the roadmap
        </div>
        <ul style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
          <li>Bake Kling V3.0 prompt generation into the inspo analysis pipeline (test_inspo.py) so every new reel gets one auto-saved to the <code>Kling Prompt</code> field. Step 5 will then be a one-click copy.</li>
          <li>Backfill old records on demand (~600 to redo, expensive — only if the manual flow shows it&apos;s worth it).</li>
          <li>Open question: does the analysis frame work for talking-head reels, or do we need a frame where lips are clearly open?</li>
        </ul>
      </div>
    </div>
  )
}
