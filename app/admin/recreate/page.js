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
  // Two slots: start (subject far) → end (subject close). End is optional;
  // if provided, it becomes Kling's tail_image and gives Wan a second
  // identity anchor for when the face fills more of the frame.
  const [frames, setFrames] = useState({ start: null, end: null })
  const [scrubberOpen, setScrubberOpen] = useState({ start: false, end: false })
  const [framesSaving, setFramesSaving] = useState({ start: false, end: false })
  const [frameErrors, setFrameErrors] = useState({ start: '', end: '' })
  // Backward-compat alias — most downstream logic still uses sourceFrame for start.
  const sourceFrame = frames.start
  const setSourceFrame = (v) => setFrames(prev => ({ ...prev, start: typeof v === 'function' ? v(prev.start) : v }))
  const showScrubber = scrubberOpen.start
  const setShowScrubber = (v) => setScrubberOpen(prev => ({ ...prev, start: typeof v === 'function' ? v(prev.start) : v }))
  const [allCreators, setAllCreators] = useState([])
  const [selectedCreator, setSelectedCreator] = useState(initialCreatorId)
  const [klingPrompt, setKlingPrompt] = useState('')

  const handleExtractVideoContext = async ({ force = false } = {}) => {
    if (!lookup?.dbRawLink) return
    if (!force && videoContext) return
    setVideoContextLoading(true); setVideoContextError('')
    try {
      const res = await fetch('/api/admin/recreate/extract-video-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: lookup.dbRawLink, inspoRecordId: lookup.id }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = null }
      if (!res.ok) {
        throw new Error(data?.error || (text ? text.slice(0, 300) : `Server ${res.status}`))
      }
      if (!data?.videoContext) throw new Error('No videoContext in response')
      setVideoContext(data.videoContext)
      // Always overwrite Step 6 with the fresh motion prompt — re-analyze
      // wouldn't be useful if it didn't actually update what's downstream.
      if (data.motionPrompt && data.motionNegative) {
        setMotionPrompt({ positive: data.motionPrompt, negative: data.motionNegative })
      }
    } catch (e) { setVideoContextError(e.message) }
    finally { setVideoContextLoading(false) }
  }

  // Scene prompts — one per slot (start/end). Each frame has its own
  // pose/framing/scale so prompts must differ; notes are shared (constants).
  const [scenePrompts, setScenePrompts] = useState({
    start: { positive: '', negative: '', shotType: '' },
    end: { positive: '', negative: '', shotType: '' },
  })
  const [extractingScene, setExtractingScene] = useState(false)
  const [sceneError, setSceneError] = useState('')
  // Backward-compat alias for downstream code paths
  const scenePrompt = scenePrompts.start
  const setScenePrompt = (updater) => setScenePrompts(prev => ({
    ...prev,
    start: typeof updater === 'function' ? updater(prev.start) : updater,
  }))
  // Per-frame admin notes injected into Sonnet. Mostly overlap (room
  // constants) but each frame has its own quirks (hair direction, body angle,
  // gaze) so the user can edit either independently.
  const [notesBySlot, setNotesBySlot] = useState({ start: '', end: '' })
  // Backward-compat alias for downstream paths that still talk "userNotes"
  const userNotes = notesBySlot.start
  const setUserNotes = (v) => setNotesBySlot(prev => ({ ...prev, start: typeof v === 'function' ? v(prev.start) : v }))

  // Video context — Gemini watches the full reel and writes a beat-by-beat
  // summary that gets injected into Sonnet's per-frame extraction. Helps
  // Sonnet identify things you can't see in a single still (e.g. underwear
  // used as a hair tie). Auto-runs once per reel and caches to Airtable.
  const [videoContext, setVideoContext] = useState('')
  const [videoContextLoading, setVideoContextLoading] = useState(false)
  const [videoContextError, setVideoContextError] = useState('')
  // Toggle for sending source frame as image[0] to anchor exact composition.
  // On by default — locks the scene/lighting/pose to the picked frame so
  // Wan only swaps identity instead of regenerating from prompt alone.
  const [preserveScene, setPreserveScene] = useState(true)

  const persistFrame = async ({ slot = 'start', frameDataUrl, sourceUrl }) => {
    setFrameErrors(prev => ({ ...prev, [slot]: '' }))
    // Optimistic update — show immediately while we upload
    setFrames(prev => ({ ...prev, [slot]: frameDataUrl || sourceUrl }))
    if (!lookup?.id) return
    setFramesSaving(prev => ({ ...prev, [slot]: true }))
    try {
      const res = await fetch('/api/admin/recreate/save-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frameDataUrl: frameDataUrl || undefined,
          sourceUrl: sourceUrl || undefined,
          inspoRecordId: lookup.id,
          shortcode,
          slot,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setFrames(prev => ({ ...prev, [slot]: data.url }))
    } catch (e) {
      setFrameErrors(prev => ({ ...prev, [slot]: `Saved in memory only — Dropbox save failed: ${e.message}` }))
    } finally {
      setFramesSaving(prev => ({ ...prev, [slot]: false }))
    }
  }

  const clearFrame = async (slot = 'start') => {
    setFrames(prev => ({ ...prev, [slot]: null }))
    setScrubberOpen(prev => ({ ...prev, [slot]: false }))
    setFrameErrors(prev => ({ ...prev, [slot]: '' }))
    if (!lookup?.id || !shortcode) return
    try {
      await fetch('/api/admin/recreate/save-frame', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspoRecordId: lookup.id, shortcode, slot }),
      })
    } catch (e) { console.warn('[recreate] frame clear failed:', e.message) }
  }

  const extractForSlot = async (slot) => {
    const frame = frames[slot]
    if (!frame) return null
    const body = frame.startsWith('data:') ? { frameDataUrl: frame } : { frameUrl: frame }
    if (lookup?.id) body.inspoRecordId = lookup.id
    const slotNotes = notesBySlot[slot]
    if (slotNotes?.trim()) body.userNotes = slotNotes
    body.slot = slot
    if (videoContext?.trim()) body.videoContext = videoContext
    const res = await fetch('/api/admin/recreate/extract-scene-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = null }
    if (!res.ok) {
      if (!data) {
        throw new Error(text
          ? `Server error (${res.status}): ${text.slice(0, 300)}`
          : `Server returned no body (${res.status}) for ${slot} frame. Likely a function timeout — try again.`)
      }
      const detail = data.raw ? ` — raw: ${typeof data.raw === 'string' ? data.raw.slice(0, 300) : JSON.stringify(data.raw).slice(0, 300)}` : ''
      throw new Error(`[${slot}] ` + (data.error || 'Extraction failed') + detail)
    }
    if (!data) throw new Error(`[${slot}] Unexpected response shape (no JSON body)`)
    return data
  }

  const handleExtractScene = async () => {
    if (!frames.start) { setSceneError('Pick a start frame in Step 2 first.'); return }
    setExtractingScene(true); setSceneError('')
    try {
      const slots = frames.end ? ['start', 'end'] : ['start']
      const results = await Promise.all(slots.map(s => extractForSlot(s).then(r => ({ slot: s, data: r }))))
      setScenePrompts(prev => {
        const next = { ...prev }
        for (const { slot, data } of results) {
          next[slot] = {
            positive: data.positivePrompt,
            negative: data.negativePrompt,
            shotType: data.shotType,
          }
        }
        return next
      })
      // Update notes per slot — each frame gets its own auto-drafted set
      setNotesBySlot(prev => {
        const next = { ...prev }
        for (const { slot, data } of results) {
          if (data?.reelSpecificNotes) next[slot] = data.reelSpecificNotes
        }
        return next
      })
    } catch (e) { setSceneError(e.message) }
    finally { setExtractingScene(false) }
  }

  // Swap creator into each frame via Wan 2.7 image-edit. Per-slot state so
  // start + end can run in parallel for Kling's start/tail bookends.
  const EMPTY_SLOT = { taskId: null, result: null, error: '', running: false, meta: null }
  const [swapState, setSwapState] = useState({ start: { ...EMPTY_SLOT }, end: { ...EMPTY_SLOT } })
  const updateSlot = (slot, patch) => setSwapState(prev => ({ ...prev, [slot]: { ...prev[slot], ...patch } }))
  // Aliases used by existing UI surface area
  const swapTaskId = swapState.start.taskId
  const swapResult = swapState.start.result
  const swapError = swapState.start.error
  const swapping = swapState.start.running
  const swapMeta = swapState.start.meta

  // shortcode needs to be available before any effect that depends on it
  const shortcode = useMemo(() => shortcodeFromUrl(reelUrl), [reelUrl])

  const submitSlotSwap = async (slot, frameUrl) => {
    const slotPrompt = scenePrompts[slot]
    if (!slotPrompt.positive) {
      updateSlot(slot, { error: `No scene prompt for ${slot} frame yet. Run Step 3 first.` })
      return
    }
    updateSlot(slot, { running: true, error: '', result: null, taskId: null, meta: null })
    try {
      const body = {
        creatorId: selectedCreator,
        shotType: slotPrompt.shotType || (slot === 'end' ? 'close-up' : 'front'),
        shortcode: shortcode ? `${shortcode}-${slot}` : undefined,
        positivePrompt: slotPrompt.positive,
        preserveScene: !!preserveScene,
        ...(frameUrl.startsWith('data:') ? { frameDataUrl: frameUrl } : { frameUrl }),
      }
      const res = await fetch('/api/admin/recreate/swap-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Swap submit failed')
      updateSlot(slot, { taskId: data.taskId, meta: { pose: data.pose, referenceCount: data.referenceCount, referenceFilenames: data.referenceFilenames || [] } })
    } catch (e) {
      updateSlot(slot, { error: e.message, running: false })
    }
  }

  const handleSwap = async () => {
    if (!frames.start) { updateSlot('start', { error: 'Pick a start frame in Step 2 first.' }); return }
    if (!selectedCreator) { updateSlot('start', { error: 'Pick a creator in Step 4 first.' }); return }
    if (!scenePrompts.start.positive) { updateSlot('start', { error: 'Run Step 3 to extract the scene prompt first.' }); return }
    if (frames.end && !scenePrompts.end.positive) { updateSlot('end', { error: 'No end-frame prompt yet — re-run Step 3 to extract for both.' }); return }
    const slots = frames.end ? ['start', 'end'] : ['start']
    await Promise.all(slots.map(s => submitSlotSwap(s, frames[s])))
  }

  // Rehydrate latest Wan swap per slot from Dropbox so a refresh doesn't
  // erase the previous run. Each slot has its own folder ({shortcode}, {shortcode}-end).
  useEffect(() => {
    if (!selectedCreator || !shortcode) return
    let cancelled = false
    const fetchSlot = (slot, slotShortcode) =>
      fetch(`/api/admin/recreate/last-swap?creatorId=${encodeURIComponent(selectedCreator)}&shortcode=${encodeURIComponent(slotShortcode)}`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return
          if (d?.output?.url) {
            setSwapState(prev => prev[slot].result
              ? prev
              : { ...prev, [slot]: { ...prev[slot], result: { url: d.output.url, filename: d.output.filename } } })
          }
        })
        .catch(() => {})
    fetchSlot('start', shortcode)
    fetchSlot('end', `${shortcode}-end`)
    return () => { cancelled = true }
  }, [selectedCreator, shortcode])

  // Motion prompt extraction (Gemini on the inspo video)
  const [motionPrompt, setMotionPrompt] = useState({ positive: '', negative: '' })
  const [extractingMotion, setExtractingMotion] = useState(false)
  const [motionError, setMotionError] = useState('')

  // Step 7 — Kling V3.0 Pro image-to-video, with original-audio mux post-process
  const [animateState, setAnimateState] = useState({
    taskId: null,
    result: null,        // { url, filename, muxed, muxNote }
    error: '',
    running: false,
    duration: 10,        // 5 or 10
    audioOffset: 0,      // seconds to skip at start of inspo audio
  })

  // Critique (Gemini analysis of the animated output)
  const [critique, setCritique] = useState(null)  // { overall, topIssues, whatWorked, recommendedFix }
  const [critiqueLoading, setCritiqueLoading] = useState(false)
  const [critiqueError, setCritiqueError] = useState('')
  const handleCritique = async () => {
    if (!animateState.result?.url) return
    setCritiqueLoading(true); setCritiqueError(''); setCritique(null)
    try {
      const res = await fetch('/api/admin/recreate/critique-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: animateState.result.url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Critique failed')
      setCritique(data.critique)
    } catch (e) { setCritiqueError(e.message) }
    finally { setCritiqueLoading(false) }
  }

  // Inspo duration (in seconds) — read client-side from video metadata so
  // we can smart-default Kling duration and warn about audio truncation.
  const [inspoDuration, setInspoDuration] = useState(null)
  useEffect(() => {
    if (!lookup?.dbRawLink) { setInspoDuration(null); return }
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.crossOrigin = 'anonymous'
    let cancelled = false
    const onLoaded = () => {
      if (cancelled) return
      const dur = v.duration
      if (Number.isFinite(dur)) {
        setInspoDuration(dur)
        // Smart default: ceil to next integer so we never truncate, capped at 15.
        const def = Math.min(15, Math.max(1, Math.ceil(dur)))
        setAnimateState(s => ({ ...s, duration: def }))
      }
    }
    v.addEventListener('loadedmetadata', onLoaded)
    v.src = `/api/admin/video-proxy?url=${encodeURIComponent(rawDropboxUrl(lookup.dbRawLink))}`
    return () => {
      cancelled = true
      v.removeEventListener('loadedmetadata', onLoaded)
      v.src = ''
    }
  }, [lookup?.dbRawLink])

  const handleAnimate = async () => {
    const startSwap = swapState.start.result?.url
    const endSwap = swapState.end.result?.url
    if (!startSwap) {
      setAnimateState(s => ({ ...s, error: 'No start-frame swap yet. Run Step 5 first.' })); return
    }
    if (!motionPrompt.positive) {
      setAnimateState(s => ({ ...s, error: 'No motion prompt. Run Step 6 first.' })); return
    }
    setAnimateState(s => ({ ...s, running: true, error: '', result: null, taskId: null }))
    try {
      const res = await fetch('/api/admin/recreate/animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: selectedCreator,
          shortcode,
          startUrl: startSwap,
          endUrl: endSwap || undefined,
          motionPrompt: motionPrompt.positive,
          motionNegative: motionPrompt.negative,
          duration: animateState.duration,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Animate submit failed')
      setAnimateState(s => ({ ...s, taskId: data.taskId, usedElementId: data.usedElementId || null }))
    } catch (e) {
      setAnimateState(s => ({ ...s, error: e.message, running: false }))
    }
  }

  // Poll animate status — when complete, server muxes audio + uploads
  useEffect(() => {
    if (!animateState.taskId) return
    let cancelled = false
    const startedAt = Date.now()
    const MAX_MS = 8 * 60 * 1000  // Kling can take a few minutes for 10s clips
    const poll = async () => {
      try {
        if (Date.now() - startedAt > MAX_MS) {
          setAnimateState(s => ({ ...s, error: 'Timed out after 8 min', taskId: null, running: false }))
          return
        }
        const res = await fetch('/api/admin/recreate/animate-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: animateState.taskId,
            creatorId: selectedCreator,
            shortcode: shortcode || undefined,
            inspoVideoUrl: lookup?.dbRawLink || undefined,
            audioOffset: animateState.audioOffset,
          }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setAnimateState(s => ({ ...s, error: data.error || `Poll failed (${res.status})`, taskId: null, running: false }))
          return
        }
        if (data.status === 'completed') {
          setAnimateState(s => ({
            ...s,
            result: { url: data.outputUrl, filename: data.filename, muxed: data.muxed, muxNote: data.muxNote },
            taskId: null,
            running: false,
          }))
        } else if (data.status === 'failed') {
          setAnimateState(s => ({ ...s, error: data.error || 'Animation failed', taskId: null, running: false }))
        } else {
          setTimeout(poll, 5000)
        }
      } catch (e) {
        if (cancelled) return
        setAnimateState(s => ({ ...s, error: e.message, taskId: null, running: false }))
      }
    }
    poll()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateState.taskId, selectedCreator, shortcode, lookup?.dbRawLink])

  // Step 6 Regenerate now goes through the same merged endpoint as Step 2.5
  // — single source of truth, Gemini 3.1 Pro, with cameraMotion enum +
  // canonical phrase override. The legacy extract-motion-prompt was on
  // gemini-2.5-flash and missed subtle dolly motion.
  const handleExtractMotion = async () => {
    if (!lookup?.dbRawLink) {
      setMotionError('No video URL found for this reel — needs to be in the Inspiration pipeline.')
      return
    }
    setExtractingMotion(true); setMotionError('')
    try {
      await handleExtractVideoContext({ force: true })
    } catch (e) { setMotionError(e.message) }
    finally { setExtractingMotion(false) }
  }

  // Poll swap status — one effect per slot, keyed on its taskId
  const useSlotPoll = (slot) => {
    const taskId = swapState[slot].taskId
    useEffect(() => {
      if (!taskId) return
      let cancelled = false
      const startedAt = Date.now()
      const MAX_MS = 5 * 60 * 1000
      const slotShortcode = shortcode ? (slot === 'end' ? `${shortcode}-end` : shortcode) : undefined
      const poll = async () => {
        try {
          if (Date.now() - startedAt > MAX_MS) {
            updateSlot(slot, { error: 'Timed out after 5 min — WaveSpeed may be overloaded', taskId: null, running: false })
            return
          }
          const res = await fetch('/api/admin/recreate/swap-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, creatorId: selectedCreator, shortcode: slotShortcode }),
          })
          const data = await res.json()
          if (cancelled) return
          if (!res.ok) {
            updateSlot(slot, { error: data.error || `Poll failed (${res.status})`, taskId: null, running: false })
            return
          }
          if (data.status === 'completed') {
            updateSlot(slot, { result: { url: data.outputUrl, filename: data.filename }, taskId: null, running: false })
          } else if (data.status === 'failed') {
            updateSlot(slot, { error: data.error || 'Generation failed', taskId: null, running: false })
          } else {
            setTimeout(poll, 4000)
          }
        } catch (e) {
          if (cancelled) return
          updateSlot(slot, { error: e.message, taskId: null, running: false })
        }
      }
      poll()
      return () => { cancelled = true }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskId, selectedCreator, shortcode])
  }
  useSlotPoll('start')
  useSlotPoll('end')

  useEffect(() => {
    fetch('/api/admin/palm-creators').then(r => r.json()).then(d => setAllCreators(d.creators || [])).catch(() => {})
  }, [])

  // Auto-trigger Gemini video context once we have a video URL and nothing
  // cached yet. Runs in background; Sonnet extraction will use whatever
  // context exists at the moment of its call.
  useEffect(() => {
    if (!lookup?.dbRawLink) return
    if (videoContext) return
    if (videoContextLoading) return
    handleExtractVideoContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup?.dbRawLink, videoContext])

  useEffect(() => {
    if (!shortcode) { setLookup(null); return }
    let cancelled = false
    setLookupLoading(true)
    setFrames({ start: null, end: null })
    setScrubberOpen({ start: false, end: false })
    setFrameErrors({ start: '', end: '' })
    setSwapState({ start: { ...EMPTY_SLOT }, end: { ...EMPTY_SLOT } })
    setVideoContext('')
    setVideoContextError('')
    fetch(`/api/admin/recreate/lookup?shortcode=${encodeURIComponent(shortcode)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setLookup(d)
        if (d?.klingPrompt) setKlingPrompt(d.klingPrompt)
        // Hydrate cached prompts so the page doesn't have to re-run paid APIs
        setScenePrompts({
          start: {
            positive: d?.recreateScenePrompt || '',
            negative: d?.recreateSceneNegative || '',
            shotType: d?.recreateShotType || '',
          },
          end: {
            positive: d?.recreateEndScenePrompt || '',
            negative: d?.recreateEndSceneNegative || '',
            shotType: d?.recreateEndShotType || '',
          },
        })
        if (d?.recreateMotionPrompt) {
          setMotionPrompt({
            positive: d.recreateMotionPrompt,
            negative: d.recreateMotionNegative || '',
          })
        }
        setNotesBySlot({
          start: d?.recreateNotes || '',
          end: d?.recreateEndNotes || '',
        })
        setVideoContext(d?.recreateVideoContext || '')
        if (d?.recreateSourceFrameUrl || d?.recreateEndFrameUrl) {
          setFrames({
            start: d.recreateSourceFrameUrl || null,
            end: d.recreateEndFrameUrl || null,
          })
        }
      })
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
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
            <span>Shortcode: <code style={{ color: 'var(--palm-pink)' }}>{shortcode}</code></span>
            {lookupLoading && <span>Looking up in pipeline…</span>}
            {!lookupLoading && lookup?.error && <span style={{ color: '#E87878' }}>Lookup error: {lookup.error}</span>}
            {!lookupLoading && lookup?.source && <span style={{ color: '#7DD3A4' }}>✓ Found {lookup.title ? `"${lookup.title}"` : ''} in {lookup.source}</span>}
            {!lookupLoading && lookup && !lookup.source && !lookup.error && <span style={{ color: '#FFC864' }}>Not in pipeline — manual upload available below</span>}
            {!lookupLoading && lookup?.duration != null && (
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                background: lookup.duration > 15 ? 'rgba(255, 200, 100, 0.1)' : 'rgba(125, 211, 164, 0.08)',
                color: lookup.duration > 15 ? '#FFC864' : '#7DD3A4',
                border: `1px solid ${lookup.duration > 15 ? 'rgba(255, 200, 100, 0.25)' : 'rgba(125, 211, 164, 0.2)'}`,
              }}>
                {lookup.duration.toFixed(1)}s
                {lookup.duration > 15 && ` · Kling caps at 15s, you'll lose ${(lookup.duration - 15).toFixed(1)}s of audio`}
              </span>
            )}
          </div>
        )}
      </StepCard>

      {/* Step 2 — Source Frames (start + optional end for Kling tail_image) */}
      <StepCard n={2} title="Source Frames">
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
          Pick a <strong>start</strong> frame (subject far) and optionally an <strong>end</strong> frame (subject close).
          The end frame becomes Kling&apos;s <code>tail_image</code> in Step 7 and gives Wan a second high-fidelity face anchor for when she walks toward camera.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          {['start', 'end'].map(slot => {
            const frame = frames[slot]
            const slotSaving = framesSaving[slot]
            const slotError = frameErrors[slot]
            const slotScrubber = scrubberOpen[slot]
            const showAnalysisThumb = slot === 'start' && lookup?.thumbnail && !slotScrubber
            const slotLabel = slot === 'start' ? 'Start frame' : 'End frame (optional)'
            const slotHint = slot === 'start'
              ? 'Subject is at their starting distance from camera.'
              : 'Subject closer to camera — face fills more of frame. Used as Kling tail_image.'
            return (
              <div key={slot} style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: slot === 'start' ? 'var(--palm-pink)' : 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                  {slotLabel}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginBottom: '10px', lineHeight: 1.4 }}>
                  {slotHint}
                </div>
                {frame ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={frame} alt={`${slot} frame`} style={{ width: '100%', maxWidth: '160px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
                    <div style={{ fontSize: '12px', color: '#7DD3A4', fontWeight: 600 }}>
                      {slotSaving ? '⏳ Saving…' : '✓ Loaded'}
                    </div>
                    {slotError && <div style={{ fontSize: '10px', color: '#FFC864' }}>⚠ {slotError}</div>}
                    <button
                      onClick={() => clearFrame(slot)}
                      style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' }}
                    >
                      Pick another
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {showAnalysisThumb && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={lookup.thumbnail} alt="Pipeline thumbnail" style={{ width: '100%', maxWidth: '160px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block', opacity: 0.8 }} />
                        <button
                          onClick={() => persistFrame({ slot, sourceUrl: lookup.thumbnail })}
                          style={{ padding: '8px 12px', fontSize: '11px', fontWeight: 700, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' }}
                        >
                          Use analysis frame
                        </button>
                      </>
                    )}
                    {lookup?.dbRawLink && !slotScrubber && (
                      <button
                        onClick={() => setScrubberOpen(prev => ({ ...prev, [slot]: true }))}
                        style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' }}
                      >
                        Scrub video
                      </button>
                    )}
                    {lookup?.dbRawLink && slotScrubber && (
                      <FrameCapture videoUrl={lookup.dbRawLink} onCapture={dataUrl => persistFrame({ slot, frameDataUrl: dataUrl })} />
                    )}
                    {(!lookup || (!lookup.thumbnail && !lookup.dbRawLink)) && (
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => {
                          const file = e.target.files?.[0]; if (!file) return
                          const reader = new FileReader()
                          reader.onload = ev => persistFrame({ slot, frameDataUrl: ev.target.result })
                          reader.readAsDataURL(file)
                        }}
                        style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}
                      />
                    )}
                    {!showAnalysisThumb && !lookup?.dbRawLink && lookup && (
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => {
                          const file = e.target.files?.[0]; if (!file) return
                          const reader = new FileReader()
                          reader.onload = ev => persistFrame({ slot, frameDataUrl: ev.target.result })
                          reader.readAsDataURL(file)
                        }}
                        style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </StepCard>

      {/* Step 2.5 — Video context (Gemini watches the full reel, gives Sonnet
          cross-frame context like "she uses underwear as a hair tie at 0:06"
          that Sonnet can't infer from a single still). Auto-runs on lookup. */}
      <div style={{ background: 'var(--card-bg-solid)', borderRadius: '18px', padding: '14px 18px', marginBottom: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '16px' }}>🎬</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)' }}>
                Video context
                {videoContextLoading && <span style={{ marginLeft: '8px', fontSize: '10px', color: '#FFC864', fontWeight: 600 }}>⏳ Gemini analyzing…</span>}
                {!videoContextLoading && videoContext && <span style={{ marginLeft: '8px', fontSize: '10px', color: '#7DD3A4', fontWeight: 600 }}>✓ ready</span>}
                {!videoContextLoading && !videoContext && !lookup?.dbRawLink && <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--foreground-subtle)', fontWeight: 600 }}>no video</span>}
                {!videoContextLoading && !videoContext && lookup?.dbRawLink && !videoContextError && <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--foreground-subtle)', fontWeight: 600 }}>queued</span>}
                {videoContextError && <span style={{ marginLeft: '8px', fontSize: '10px', color: '#E87878', fontWeight: 600 }}>error</span>}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', lineHeight: 1.4 }}>
                Gemini watches the full reel and gives Sonnet cross-frame context (action timing, props that span frames). Auto-feeds into Step 3.
              </div>
            </div>
          </div>
          {lookup?.dbRawLink && (
            <button
              onClick={() => handleExtractVideoContext({ force: true })}
              disabled={videoContextLoading}
              style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: videoContextLoading ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {videoContext ? '🔄 Re-analyze' : '▶ Run now'}
            </button>
          )}
        </div>
        {videoContextError && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid rgba(232,120,120,0.2)', borderRadius: '6px', padding: '6px 10px' }}>
            {videoContextError}
          </div>
        )}
        {videoContext && (
          <details style={{ marginTop: '10px' }}>
            <summary style={{ fontSize: '10px', color: 'var(--foreground-muted)', cursor: 'pointer', userSelect: 'none' }}>View context</summary>
            <textarea
              value={videoContext}
              onChange={e => setVideoContext(e.target.value)}
              rows={Math.min(12, Math.max(4, videoContext.split('\n').length))}
              style={{ marginTop: '6px', width: '100%', padding: '8px', fontSize: '10px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
            />
          </details>
        )}
      </div>

      {/* Step 3 — Extract scene prompt with Claude Sonnet (per-frame) */}
      <StepCard n={3} title="Extract Scene Prompt (Claude Sonnet)" status={scenePrompts.start.positive ? null : 'auto'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          Sonnet looks at each frame and returns a scene-only prompt (clothing, setting, action, framing, lighting — no character traits)
          plus a strong negative prompt. Both notes and prompts are <strong>per-frame</strong> because pose/framing/expression differ. Sonnet auto-drafts the notes; the video context above feeds in for cross-frame disambiguation.
        </div>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
            Reel-specific notes (per frame)
          </div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', fontStyle: 'italic', marginBottom: '8px' }}>
            Each frame gets its own notes since per-frame quirks (hair direction, body angle, gaze) differ even though room constants overlap. Leave empty → Sonnet drafts from the frame. Edit + re-extract to override.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: frames.end ? '1fr 1fr' : '1fr', gap: '10px' }}>
            {['start', 'end'].filter(s => s === 'start' || frames.end).map(slot => (
              <div key={slot}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: slot === 'start' ? 'var(--palm-pink)' : 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {slot === 'start' ? 'Start frame notes' : 'End frame notes'}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--foreground-subtle)', fontStyle: 'italic' }}>
                    {notesBySlot[slot] ? 'literal' : 'auto-draft'}
                  </div>
                </div>
                <textarea
                  value={notesBySlot[slot]}
                  onChange={e => setNotesBySlot(prev => ({ ...prev, [slot]: e.target.value }))}
                  placeholder="(Sonnet drafts on Extract — or pre-fill to override.)"
                  rows={5}
                  style={{ width: '100%', padding: '8px', fontSize: '10px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
                />
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleExtractScene}
          disabled={extractingScene || !frames.start}
          style={{
            padding: '8px 14px', fontSize: '12px', fontWeight: 700,
            background: !frames.start ? 'rgba(232, 160, 160, 0.06)' : (extractingScene ? 'rgba(232,160,160,0.3)' : 'var(--palm-pink)'),
            color: !frames.start ? 'var(--foreground-subtle)' : '#060606',
            border: 'none', borderRadius: '6px',
            cursor: extractingScene ? 'wait' : (!frames.start ? 'not-allowed' : 'pointer'),
          }}
        >
          {extractingScene
            ? '⏳ Sonnet analyzing…'
            : frames.end ? '✨ Extract for both frames' : '✨ Extract scene prompt'}
        </button>
        {sceneError && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
            {sceneError}
          </div>
        )}

        {(scenePrompts.start.positive || scenePrompts.end.positive) && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: frames.end ? '1fr 1fr' : '1fr', gap: '12px' }}>
            {['start', 'end'].filter(s => s === 'start' || frames.end).map(slot => {
              const p = scenePrompts[slot]
              return (
                <div key={slot} style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: slot === 'start' ? 'var(--palm-pink)' : 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {slot === 'start' ? 'Start prompt' : 'End prompt'}
                    </div>
                    {p.shotType && (
                      <div style={{ fontSize: '9px', color: 'var(--foreground-subtle)', fontFamily: 'monospace' }}>
                        {p.shotType} refs
                      </div>
                    )}
                  </div>
                  {!p.positive ? (
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
                      {extractingScene ? 'Generating…' : 'Not yet extracted.'}
                    </div>
                  ) : (
                    <>
                      <div>
                        <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Positive</div>
                        <textarea
                          value={p.positive}
                          onChange={e => setScenePrompts(prev => ({ ...prev, [slot]: { ...prev[slot], positive: e.target.value } }))}
                          rows={6}
                          style={{ width: '100%', padding: '6px', fontSize: '10px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>Negative</div>
                        <textarea
                          value={p.negative}
                          onChange={e => setScenePrompts(prev => ({ ...prev, [slot]: { ...prev[slot], negative: e.target.value } }))}
                          rows={4}
                          style={{ width: '100%', padding: '6px', fontSize: '10px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )
            })}
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
          Sends {creator ? <strong style={{ color: 'var(--foreground)' }}>{creator.aka || creator.name}&apos;s</strong> : 'the creator\'s'} reference input photos
          (auto-picked: <strong style={{ color: 'var(--foreground)' }}>{scenePrompt.shotType ? (scenePrompt.shotType === 'close-up' ? 'Close Up Face' : scenePrompt.shotType === 'back' ? 'Back View' : 'Front View') : 'pending Step 3'}</strong>)
          + the scene prompt to Wan 2.7.
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '12px', padding: '10px', background: preserveScene ? 'rgba(125, 211, 164, 0.06)' : 'rgba(0,0,0,0.15)', border: `1px solid ${preserveScene ? 'rgba(125, 211, 164, 0.25)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '6px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={preserveScene}
            onChange={e => setPreserveScene(e.target.checked)}
            style={{ marginTop: '2px', accentColor: 'var(--palm-pink)' }}
          />
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>Preserve original scene composition</div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px', lineHeight: 1.4 }}>
              Sends the source frame as the FIRST input image so Wan must match the actual scene, lighting, camera tilt, pose, and small imperfections. Identity comes from the creator&apos;s 8 reference photos. Best for tight composition match. Off = Wan generates from prompt alone (more freedom, more drift).
            </div>
          </div>
        </label>

        {(() => {
          const anyRunning = swapState.start.running || swapState.end.running
          const disabled = anyRunning || !frames.start || !selectedCreator || !scenePrompt.positive
          const label = anyRunning
            ? '⏳ Wan 2.7 generating…'
            : frames.end
              ? '✨ Generate (start + end in parallel)'
              : '✨ Generate creator-swapped image'
          return (
            <button
              onClick={handleSwap}
              disabled={disabled}
              style={{
                padding: '8px 14px', fontSize: '12px', fontWeight: 700,
                background: disabled && !anyRunning ? 'rgba(232, 160, 160, 0.06)' : (anyRunning ? 'rgba(232,160,160,0.3)' : 'var(--palm-pink)'),
                color: disabled && !anyRunning ? 'var(--foreground-subtle)' : '#060606',
                border: 'none', borderRadius: '6px',
                cursor: anyRunning ? 'wait' : (disabled ? 'not-allowed' : 'pointer'),
              }}
            >{label}</button>
          )
        })()}

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
        {/* Per-slot result tiles */}
        {(swapState.start.error || swapState.end.error || swapState.start.result || swapState.end.result || swapState.start.meta || swapState.end.meta) && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: frames.end ? '1fr 1fr' : '1fr', gap: '12px' }}>
            {['start', 'end'].filter(s => s === 'start' || frames.end).map(slot => {
              const s = swapState[slot]
              return (
                <div key={slot} style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: slot === 'start' ? 'var(--palm-pink)' : 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    {slot === 'start' ? 'Start frame swap' : 'End frame swap'}
                  </div>
                  {s.meta && (
                    <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', fontFamily: 'monospace', marginBottom: '6px' }}>
                      {s.meta.referenceCount} × {s.meta.pose} refs
                    </div>
                  )}
                  {s.error && (
                    <div style={{ fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid rgba(232,120,120,0.2)', borderRadius: '6px', padding: '6px 10px', marginBottom: '6px' }}>
                      {s.error}
                    </div>
                  )}
                  {s.running && !s.result && (
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>⏳ Generating…</div>
                  )}
                  {s.result && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.result.url} alt={`${slot} swap`} style={{ width: '100%', maxWidth: '180px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block', cursor: 'zoom-in' }} onClick={() => window.open(s.result.url, '_blank')} />
                      <div style={{ fontSize: '11px', color: '#7DD3A4', fontWeight: 600 }}>✓ Saved</div>
                      <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{s.result.filename}</div>
                      <button
                        onClick={() => submitSlotSwap(slot, frames[slot])}
                        disabled={s.running}
                        style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: s.running ? 'wait' : 'pointer' }}
                      >
                        {s.running ? '…' : '🔄 Regenerate'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </StepCard>

      {/* Step 6 — Motion prompt (auto-filled by the same Gemini call as Step 2.5) */}
      <StepCard n={6} title="Motion Prompt (Gemini)" status={motionPrompt.positive ? 'auto-filled' : 'pending'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          {motionPrompt.positive
            ? <>Auto-filled from the same Gemini call that produced Step 2.5 — one paid run produces video context, motion prompt, and negative. Edit below if you want to override before Step 7, or use 🔄 Regenerate to re-run Gemini.</>
            : <>Will auto-fill when Gemini finishes analyzing the video in Step 2.5. If it doesn&apos;t fill, click below to extract motion only.</>
          }
        </div>
        {!motionPrompt.positive && (
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
        )}
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Motion (positive) prompt
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>Camera motion override:</label>
                  <select
                    onChange={e => {
                      const choice = e.target.value
                      if (!choice) return
                      const PHRASES = {
                        locked: 'Static camera, no movement',
                        dolly_back: 'Camera slowly dollies backward, smooth pull-back motion',
                        dolly_forward: 'Camera slowly dollies forward, smooth push-in motion',
                        pan_left: 'Slow pan left, smooth horizontal camera move',
                        pan_right: 'Slow pan right, smooth horizontal camera move',
                        slider: 'Smooth slider move with gentle parallax',
                        handheld_drift: 'Subtle hand-held drift, natural micro-movements',
                      }
                      // Order matters — longer patterns must match before shorter ones
                      // so "Tripod static shot of" doesn't get partially stripped to "Tripod".
                      const STRIP = [
                        /tripod[\s-]?(mounted|static)?[\s,]*shot of\s*/gi,
                        /static shot of\s*/gi,
                        /handheld shot of\s*/gi,
                        /selfie shot of\s*/gi,
                        /static camera[,\s]+no movement[,\s]*/gi,
                        /no camera movement[,\s]*/gi,
                        /camera fixed on tripod[^,.]*[,\s]*/gi,
                        /tripod[\s-]?mounted[^,.]*[,\s]*/gi,
                        /^tripod[,.\s]+/gi,
                        /camera (slowly )?dollies (backward|forward|in|out|back)[^.,]*[,\s]*/gi,
                        /smooth pull-back motion[,\s]*/gi,
                        /smooth push-in motion[,\s]*/gi,
                        /slow pan (left|right)[^.,]*[,\s]*/gi,
                        /smooth horizontal camera move[,\s]*/gi,
                        /smooth slider move[^.]*[,\s]*/gi,
                        /gentle parallax[,\s]*/gi,
                        /(subtle )?hand-?held (drift|movement)[^,.]*[,\s]*/gi,
                        /natural micro-movements[,\s]*/gi,
                      ]
                      const phrase = PHRASES[choice]
                      setMotionPrompt(s => {
                        let next = s.positive
                        for (const re of STRIP) next = next.replace(re, '')
                        // Aggressive cleanup — collapse multiple commas/periods/spaces
                        next = next.replace(/[.,]\s*[.,]+/g, ',')         // ". ," or ", ," → ","
                          .replace(/,\s*,/g, ',')
                          .replace(/\s+/g, ' ')
                          .replace(/^[\s,.]+/, '')                        // leading punctuation
                          .replace(/\s+([.,])/g, '$1')                    // " ." → "."
                          .trim()
                        // Insert before "no phone visible / no cuts" if present, else append
                        if (/no phone visible|no cuts/i.test(next)) {
                          next = next.replace(/(no phone visible|no cuts)/i, `${phrase}, $1`)
                        } else {
                          next = `${phrase}. ${next}`
                        }
                        return { ...s, positive: next }
                      })
                      e.target.value = ''  // reset so picking same option twice works
                    }}
                    defaultValue=""
                    style={{ padding: '3px 6px', fontSize: '10px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: 'var(--foreground)' }}
                  >
                    <option value="">Pick to swap…</option>
                    <option value="locked">Locked (static)</option>
                    <option value="dolly_back">Dolly back</option>
                    <option value="dolly_forward">Dolly forward</option>
                    <option value="pan_left">Pan left</option>
                    <option value="pan_right">Pan right</option>
                    <option value="slider">Slider / parallax</option>
                    <option value="handheld_drift">Handheld drift</option>
                  </select>
                </div>
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

      {/* Step 7 — Animate in Kling V3.0 Pro (with original-audio mux) */}
      <StepCard n={7} title="Animate in Kling V3.0 Pro" status={animateState.result ? null : 'auto'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
          Sends Step 5&apos;s start swap as Kling&apos;s <code>image</code>{swapState.end.result?.url ? ', the end swap as ' : ''}{swapState.end.result?.url && <code>tail_image</code>}, plus the Step 6 motion prompt.
          Then muxes the inspo&apos;s original audio onto the silent Kling output (Kling&apos;s built-in sound is unreliable for trending music).
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Duration</label>
            <select
              value={animateState.duration}
              onChange={e => setAnimateState(s => ({ ...s, duration: Number(e.target.value) }))}
              disabled={animateState.running}
              style={{ padding: '4px 8px', fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: 'var(--foreground)' }}
            >
              {Array.from({ length: 15 }, (_, i) => i + 1).map(s => (
                <option key={s} value={s}>{s}s</option>
              ))}
            </select>
            {inspoDuration != null && (
              <span style={{ fontSize: '10px', color: inspoDuration > 15 ? '#FFC864' : 'var(--foreground-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                inspo: {inspoDuration.toFixed(1)}s
                {inspoDuration > 15 && ` (audio truncates at 15s — losing ${(inspoDuration - 15).toFixed(1)}s)`}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
            <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>Audio offset</label>
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={animateState.audioOffset}
              onChange={e => setAnimateState(s => ({ ...s, audioOffset: Number(e.target.value) }))}
              disabled={animateState.running}
              style={{ flex: 1, accentColor: 'var(--palm-pink)' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontVariantNumeric: 'tabular-nums', minWidth: '36px', textAlign: 'right' }}>
              {animateState.audioOffset.toFixed(1)}s
            </span>
          </div>
        </div>

        <button
          onClick={handleAnimate}
          disabled={animateState.running || !swapState.start.result?.url || !motionPrompt.positive}
          style={{
            padding: '8px 14px', fontSize: '12px', fontWeight: 700,
            background: (!swapState.start.result?.url || !motionPrompt.positive) ? 'rgba(232, 160, 160, 0.06)' : (animateState.running ? 'rgba(232,160,160,0.3)' : 'var(--palm-pink)'),
            color: (!swapState.start.result?.url || !motionPrompt.positive) ? 'var(--foreground-subtle)' : '#060606',
            border: 'none', borderRadius: '6px',
            cursor: animateState.running ? 'wait' : ((!swapState.start.result?.url || !motionPrompt.positive) ? 'not-allowed' : 'pointer'),
          }}
        >
          {animateState.running
            ? '⏳ Kling generating + muxing audio… (~2-5 min)'
            : (swapState.end.result?.url ? '🎬 Animate (start → end)' : '🎬 Animate')}
        </button>

        {animateState.usedElementId && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#7DD3A4' }}>
            ✓ Using registered Kling Element <span style={{ fontFamily: 'monospace', color: 'var(--foreground-muted)' }}>{animateState.usedElementId}</span> — identity locked from creator&apos;s 12 reference angles
          </div>
        )}
        {animateState.taskId && !animateState.usedElementId && animateState.running && (
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#FFC864' }}>
            ⚠ No Kling Element registered for this creator — running with start-frame identity only. Register one on the AI Super Clone tab for tighter face consistency.
          </div>
        )}

        {animateState.error && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
            {animateState.error}
          </div>
        )}

        {animateState.result && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              Result · saved to Dropbox
              {animateState.result.muxed === false && (
                <span style={{ marginLeft: '8px', fontSize: '9px', color: '#FFC864', textTransform: 'none', fontWeight: 700 }}>(silent — mux fallback)</span>
              )}
            </div>
            <video
              src={animateState.result.url}
              controls
              autoPlay
              loop
              style={{ width: '100%', maxWidth: '360px', borderRadius: '12px', display: 'block', background: 'rgba(0,0,0,0.4)' }}
            />
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontFamily: 'monospace', marginTop: '6px', wordBreak: 'break-all' }}>
              {animateState.result.filename}
            </div>
            {animateState.result.muxNote && (
              <div style={{ marginTop: '6px', fontSize: '10px', color: '#FFC864' }}>⚠ {animateState.result.muxNote}</div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={handleAnimate}
                disabled={animateState.running}
                style={{ padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}
              >
                {animateState.running ? '…' : '🔄 Regenerate'}
              </button>
              <button
                onClick={handleCritique}
                disabled={critiqueLoading}
                style={{ padding: '4px 10px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: critiqueLoading ? 'wait' : 'pointer' }}
              >
                {critiqueLoading ? '⏳ Analyzing…' : '🔍 Critique with Gemini'}
              </button>
            </div>
            {critiqueError && (
              <div style={{ marginTop: '8px', fontSize: '10px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid rgba(232,120,120,0.2)', borderRadius: '6px', padding: '6px 10px' }}>
                {critiqueError}
              </div>
            )}
            {critique && (
              <div style={{ marginTop: '10px', background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: 'var(--foreground)', lineHeight: 1.5 }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--palm-pink)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall: </span>
                  {critique.overall}
                </div>
                {critique.topIssues?.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: '#E87878', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Top issues</div>
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                      {critique.topIssues.map((issue, i) => <li key={i} style={{ marginBottom: '3px' }}>{issue}</li>)}
                    </ul>
                  </div>
                )}
                {critique.whatWorked?.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: '#7DD3A4', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>What worked</div>
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                      {critique.whatWorked.map((s, i) => <li key={i} style={{ marginBottom: '3px' }}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {critique.recommendedFix && (
                  <div>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#FFC864', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Try next: </span>
                    {critique.recommendedFix}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </StepCard>

      {/* Step 8 — Save to creator library (placeholder) */}
      <StepCard n={8} title="Save to Creator Library" status="tbd">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
          Will attach the final muxed video to the creator&apos;s asset library and link it back to the originating Inspiration record.
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
