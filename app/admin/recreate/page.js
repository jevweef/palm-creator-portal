'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

const NANO_BANANA_URL = 'https://wavespeed.ai/models/google/nano-banana-2/edit'
const KLING_URL = 'https://wavespeed.ai/models/kwaivgi/kling-video-o3-pro/image-to-video'

const EXTRACT_PROMPT = `extract the exact image prompt, keep everything the same, dont describe the girl's shape or hair or facial features, include settings like "Raw image, shot on iphone, 4K, hyper realistic."`

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

// Inline frame picker: scrub a Dropbox-hosted reel video and capture a frame
// purely client-side via canvas. No upload — the captured data URL is shown
// and can be downloaded for use in ChatGPT/Grok in Step 3.
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
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      onCapture(dataUrl)
    } catch (e) {
      setError(e.message)
    }
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
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
          Scrub to the frame you want and capture it. Defaults to the first frame.
        </div>
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

export default function RecreatePage() {
  const searchParams = useSearchParams()
  const initialUrl = searchParams.get('url') || ''

  const [reelUrl, setReelUrl] = useState(initialUrl)
  const [lookup, setLookup] = useState(null) // { source, dbRawLink, thumbnail, ... }
  const [lookupLoading, setLookupLoading] = useState(false)
  const [capturedFrame, setCapturedFrame] = useState(null) // data URL or attachment URL
  const [extractedPrompt, setExtractedPrompt] = useState('')
  const [allCreators, setAllCreators] = useState([])
  const [selectedCreator, setSelectedCreator] = useState('')

  useEffect(() => {
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(d => setAllCreators(d.creators || []))
      .catch(() => {})
  }, [])

  const shortcode = useMemo(() => shortcodeFromUrl(reelUrl), [reelUrl])

  // Auto-lookup whenever the reel URL changes to a valid shortcode
  useEffect(() => {
    if (!shortcode) { setLookup(null); return }
    let cancelled = false
    setLookupLoading(true)
    fetch(`/api/admin/recreate/lookup?shortcode=${encodeURIComponent(shortcode)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setLookup(d) })
      .catch(() => { if (!cancelled) setLookup(null) })
      .finally(() => { if (!cancelled) setLookupLoading(false) })
    return () => { cancelled = true }
  }, [shortcode])

  const creator = useMemo(() => allCreators.find(c => c.id === selectedCreator), [allCreators, selectedCreator])

  const mergedPrompt = useMemo(() => {
    if (!extractedPrompt) return ''
    if (!creator) return extractedPrompt
    const identityHeader = `Subject: ${creator.aka || creator.name || 'creator'} — keep face, hair, body, and styling consistent with reference image.`
    return `${identityHeader}\n\n${extractedPrompt}`
  }, [extractedPrompt, creator])

  const downloadCapturedFrame = () => {
    if (!capturedFrame) return
    const a = document.createElement('a')
    a.href = capturedFrame
    a.download = `inspo_frame_${shortcode || 'reel'}.jpg`
    a.click()
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)' }}>AI Recreate</div>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
          Take an inspo reel and recreate it with one of our creators using AI. Work in progress — bones first.
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
            {!lookupLoading && lookup?.source && <span style={{ marginLeft: '12px', color: '#7DD3A4' }}>✓ Found in {lookup.source}</span>}
            {!lookupLoading && lookup && !lookup.source && !lookup.error && <span style={{ marginLeft: '12px', color: '#FFC864' }}>Not in pipeline — manual upload available below</span>}
          </div>
        )}
        {!shortcode && (
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            Paste an Instagram reel URL to begin. Currently scoped to simple short videos with no camera motion.
          </div>
        )}
      </StepCard>

      {/* Step 2 — Frame Capture */}
      <StepCard n={2} title="Capture the First Frame">
        {/* Already captured — show preview + actions */}
        {capturedFrame && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedFrame} alt="Captured frame" style={{ width: '180px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', color: '#7DD3A4', fontWeight: 600 }}>✓ Frame captured</div>
                <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Download it and upload to ChatGPT/Grok in Step 3.</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={downloadCapturedFrame} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>↓ Download</button>
                  <button onClick={() => setCapturedFrame(null)} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer' }}>Try another</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No capture yet — show frame picker if we have a video, else fallback options */}
        {!capturedFrame && lookup?.dbRawLink && (
          <FrameCapture videoUrl={lookup.dbRawLink} onCapture={setCapturedFrame} />
        )}

        {!capturedFrame && lookup && !lookup.dbRawLink && lookup.thumbnail && (
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lookup.thumbnail} alt="Existing thumbnail" style={{ width: '180px', aspectRatio: '9/16', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                Video file isn&apos;t saved for this record, but we have the thumbnail from the analysis pipeline. Use it as the screenshot:
              </div>
              <button
                onClick={() => setCapturedFrame(lookup.thumbnail)}
                style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', border: 'none', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start' }}
              >
                Use this thumbnail
              </button>
            </div>
          </div>
        )}

        {!capturedFrame && (!lookup || (!lookup.dbRawLink && !lookup.thumbnail)) && (
          <div>
            <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
              {lookup === null && shortcode ? 'Looking up…' : 'No saved video found. Upload a screenshot manually:'}
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = ev => setCapturedFrame(ev.target.result)
                reader.readAsDataURL(file)
              }}
              style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}
            />
          </div>
        )}
      </StepCard>

      {/* Step 3 — Extract Generic Prompt */}
      <StepCard n={3} title="Extract Generic Prompt in ChatGPT or Grok">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          Open ChatGPT or Grok, upload the frame from Step 2, and paste this prompt:
        </div>
        <div style={{
          background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px',
          fontSize: '12px', fontFamily: 'monospace', color: 'var(--foreground)',
          marginBottom: '10px', whiteSpace: 'pre-wrap', lineHeight: 1.5,
        }}>{EXTRACT_PROMPT}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <CopyBtn text={EXTRACT_PROMPT} label="Copy prompt" />
          <a href="https://chat.openai.com/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <button style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--palm-pink)', border: '1px solid var(--palm-pink)', borderRadius: '6px', cursor: 'pointer' }}>Open ChatGPT ↗</button>
          </a>
          <a href="https://grok.com/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <button style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--palm-pink)', border: '1px solid var(--palm-pink)', borderRadius: '6px', cursor: 'pointer' }}>Open Grok ↗</button>
          </a>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '10px', fontStyle: 'italic' }}>
          Why no shape / hair / facial features? So the prompt stays generic and we can swap in our creator&apos;s identity in Step 4.
        </div>
      </StepCard>

      {/* Step 4 — Paste Extracted Prompt + Pick Creator */}
      <StepCard n={4} title="Paste Extracted Prompt & Pick Creator">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          Paste what ChatGPT / Grok returned, then pick the creator we&apos;re recreating this for.
        </div>
        <textarea
          placeholder="Paste the extracted image prompt here..."
          value={extractedPrompt}
          onChange={e => setExtractedPrompt(e.target.value)}
          rows={6}
          style={{
            width: '100%', padding: '10px', fontSize: '12px',
            background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px', color: 'var(--foreground)', fontFamily: 'monospace',
            resize: 'vertical', marginBottom: '12px',
          }}
        />
        <select
          value={selectedCreator}
          onChange={e => setSelectedCreator(e.target.value)}
          style={{
            width: '100%', padding: '8px 12px', fontSize: '13px',
            background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px', color: 'var(--foreground)',
          }}
        >
          <option value="">— Select creator —</option>
          {allCreators.map(c => (
            <option key={c.id} value={c.id}>{c.aka || c.name}</option>
          ))}
        </select>
      </StepCard>

      {/* Step 5 — Merged Prompt for Nano Banana 2 */}
      <StepCard n={5} title="Generate Image in Nano Banana 2" status={mergedPrompt ? null : 'waiting'}>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          Copy the merged prompt below, open Nano Banana 2, upload your creator&apos;s reference image, and paste this prompt.
        </div>
        <div style={{
          background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px',
          fontSize: '12px', fontFamily: 'monospace', color: 'var(--foreground)',
          marginBottom: '10px', whiteSpace: 'pre-wrap', lineHeight: 1.5,
          minHeight: '60px',
        }}>{mergedPrompt || <span style={{ color: 'var(--foreground-muted)', fontStyle: 'italic' }}>Complete steps 3 and 4 to generate the merged prompt.</span>}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <CopyBtn text={mergedPrompt} label="Copy merged prompt" />
          <a href={NANO_BANANA_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <button style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--palm-pink)', border: '1px solid var(--palm-pink)', borderRadius: '6px', cursor: 'pointer' }}>Open Nano Banana 2 ↗</button>
          </a>
        </div>
      </StepCard>

      {/* Step 6 — Animate in Kling O3 Pro */}
      <StepCard n={6} title="Animate in Kling O3 Pro" status="bones">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          Once the still image looks right, take it to Kling O3 Pro to animate. Process for matching the original reel&apos;s motion / talking is still being figured out.
        </div>
        <a href={KLING_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <button style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--palm-pink)', border: '1px solid var(--palm-pink)', borderRadius: '6px', cursor: 'pointer' }}>Open Kling O3 Pro ↗</button>
        </a>
      </StepCard>

      {/* Step 7 — Final Output */}
      <StepCard n={7} title="Save Final Output" status="tbd">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
          Will eventually attach the final video to the creator&apos;s asset library and the originating inspo reel record.
        </div>
      </StepCard>

      {/* Open Questions */}
      <div style={{
        background: 'rgba(255, 200, 100, 0.04)',
        border: '1px solid rgba(255, 200, 100, 0.15)',
        borderRadius: '12px', padding: '16px', marginTop: '24px',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#FFC864', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Open questions
        </div>
        <ul style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
          <li>One screenshot vs multiple frames?</li>
          <li>Does this work for reels with camera motion or just static shots?</li>
          <li>How do we transfer the action / pose / talking of the original onto our creator?</li>
          <li>How do we keep continuity if the reel has multiple scenes or cuts?</li>
        </ul>
      </div>
    </div>
  )
}
