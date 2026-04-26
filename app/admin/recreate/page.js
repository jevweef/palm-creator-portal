'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

const NANO_BANANA_URL = 'https://wavespeed.ai/models/google/nano-banana-2/edit'
const KLING_URL = 'https://wavespeed.ai/models/kwaivgi/kling-video-o3-pro/image-to-video'

const EXTRACT_PROMPT = `extract the exact image prompt, keep everything the same, dont describe the girl's shape or hair or facial features, include settings like "Raw image, shot on iphone, 4K, hyper realistic."`

function shortcodeFromUrl(url) {
  const m = url?.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
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

export default function RecreatePage() {
  const searchParams = useSearchParams()
  const initialUrl = searchParams.get('url') || ''

  const [reelUrl, setReelUrl] = useState(initialUrl)
  const [screenshotFile, setScreenshotFile] = useState(null)
  const [screenshotPreview, setScreenshotPreview] = useState(null)
  const [extractedPrompt, setExtractedPrompt] = useState('')
  const [allCreators, setAllCreators] = useState([])
  const [selectedCreator, setSelectedCreator] = useState('')

  useEffect(() => {
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(d => setAllCreators(d.creators || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!screenshotFile) { setScreenshotPreview(null); return }
    const url = URL.createObjectURL(screenshotFile)
    setScreenshotPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [screenshotFile])

  const shortcode = useMemo(() => shortcodeFromUrl(reelUrl), [reelUrl])
  const creator = useMemo(() => allCreators.find(c => c.id === selectedCreator), [allCreators, selectedCreator])

  const mergedPrompt = useMemo(() => {
    if (!extractedPrompt) return ''
    if (!creator) return extractedPrompt
    const identityHeader = `Subject: ${creator.aka || creator.name || 'creator'} — keep face, hair, body, and styling consistent with reference image.`
    return `${identityHeader}\n\n${extractedPrompt}`
  }, [extractedPrompt, creator])

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
        {shortcode ? (
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            Shortcode: <code style={{ color: 'var(--palm-pink)' }}>{shortcode}</code>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            Paste an Instagram reel URL to begin. Currently scoped to simple short videos with no camera motion.
          </div>
        )}
      </StepCard>

      {/* Step 2 — Screenshot First Frame */}
      <StepCard n={2} title="Screenshot the First Frame">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
          Open the reel, screenshot the first frame, and upload it here. We&apos;ll feed this into ChatGPT or Grok in the next step.
        </div>
        <input
          type="file"
          accept="image/*"
          onChange={e => setScreenshotFile(e.target.files?.[0] || null)}
          style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}
        />
        {screenshotPreview && (
          <div style={{ marginTop: '12px', maxWidth: '300px', borderRadius: '8px', overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshotPreview} alt="First frame" style={{ width: '100%', display: 'block' }} />
          </div>
        )}
      </StepCard>

      {/* Step 3 — Extract Generic Prompt */}
      <StepCard n={3} title="Extract Generic Prompt in ChatGPT or Grok">
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          Open ChatGPT or Grok, upload the screenshot from Step 2, and paste this prompt:
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
