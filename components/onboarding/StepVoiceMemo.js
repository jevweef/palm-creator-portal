'use client'

import { useState, useEffect, useRef } from 'react'

export default function StepVoiceMemo({ hqId, onComplete }) {
  const [recState, setRecState] = useState('idle') // idle | uploading | done
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [existingMemo, setExistingMemo] = useState(null)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef(null)

  // Check if voice memo already exists
  useEffect(() => {
    if (!hqId) { setLoading(false); return }
    fetch(`/api/onboarding/voice-memo?hqId=${hqId}`)
      .then(r => r.json())
      .then(data => {
        if (data.hasVoiceMemo || data.voiceMemoStatus === 'Skipped' || data.voiceMemoStatus === 'Confirmed Sent') {
          setExistingMemo(data)
          setRecState('done')
          if (data.voiceMemoStatus === 'Confirmed Sent') setConfirmed(true)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [hqId])

  // Upload a file (drag/drop or browse)
  const handleFileUpload = async (file) => {
    if (!file || !hqId) return
    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav']
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav)$/i)) {
      setError('Please upload an MP3 or WAV file')
      return
    }

    setRecState('uploading')
    setUploadProgress('Uploading...')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('hqId', hqId)
      formData.append('audio', file, file.name)

      const res = await fetch('/api/onboarding/voice-memo', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        setRecState('done')
        setUploadProgress(null)
      } else {
        throw new Error(data.error || 'Upload failed')
      }
    } catch (err) {
      console.error('Upload error:', err)
      setError('Upload failed. Please try again.')
      setRecState('idle')
      setUploadProgress(null)
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--foreground-muted)', fontSize: '14px', padding: '20px' }}>Loading...</div>
  }

  // Already uploaded/skipped/confirmed
  const isSkipped = existingMemo?.voiceMemoStatus === 'Skipped'
  if (recState === 'done') {
    return (
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
          Voice Memo
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '24px' }}>
          {isSkipped
            ? 'You skipped this step. Your manager will follow up if needed.'
            : confirmed
              ? 'You confirmed your voice memo was already sent.'
              : 'Your voice memo has been saved!'}
        </p>

        <div style={{
          background: isSkipped ? 'rgba(232, 200, 120, 0.06)' : 'rgba(125, 211, 164, 0.08)',
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          marginBottom: '24px',
        }}>
          <div style={{ marginBottom: '8px' }}>
            {isSkipped ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="#F57F17"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="#2E7D32"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            )}
          </div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: isSkipped ? '#E8A878' : '#2E7D32' }}>
            {isSkipped ? 'Skipped — manager will follow up' : confirmed ? 'Voice memo confirmed' : 'Voice memo uploaded'}
          </div>
          {existingMemo?.voiceMemoFilename && (
            <div style={{ fontSize: '12px', color: '#66BB6A', marginTop: '4px' }}>
              {existingMemo.voiceMemoFilename}
            </div>
          )}
        </div>

        <button
          onClick={onComplete}
          style={{
            padding: '10px 32px',
            background: 'var(--palm-pink)',
            color: '#060606',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Continue
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
        Palm Creator Profile & Content Strategy Intake
      </h2>
      <p style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', marginBottom: '6px', lineHeight: '1.5' }}>
        This voice memo is used to build your personalized content strategy and creator DNA profile — it helps us understand your style, personality, and what kind of content fits you best.
      </p>
      <p style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', marginBottom: '16px', lineHeight: '1.5' }}>
        Just ramble for like 10–15 minutes. Don&apos;t overthink it at all.
      </p>

      <div style={{ fontSize: '13px', color: 'var(--palm-pink)', marginBottom: '6px', fontWeight: 600 }}>
        Your Day-to-Day
      </div>
      <ul style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.7', marginBottom: '16px', paddingLeft: '18px' }}>
        <li>What your normal week looks like (what you actually do day-to-day)</li>
        <li>What places you regularly go to (gym, coffee shops, nightlife, work, etc.)</li>
        <li>How often you go out, travel, or do anything social</li>
        <li>What you feel like you already have easy access to that could be used for content (locations, routines, hobbies, etc.)</li>
      </ul>

      <div style={{ fontSize: '13px', color: 'var(--palm-pink)', marginBottom: '6px', fontWeight: 600 }}>
        Your Filming Setup
      </div>
      <ul style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.7', marginBottom: '16px', paddingLeft: '18px' }}>
        <li>How you currently film content (random clips throughout the day vs batching vs full shoot days)</li>
        <li>How much time you realistically have each week to film</li>
        <li>What your living setup is like (apartment/house, lighting, space, etc.)</li>
        <li>Whether you have anyone who could film for you (friends, someone comfortable behind the camera)</li>
        <li>Whether you prefer filming alone or with someone else</li>
      </ul>

      <div style={{ fontSize: '13px', color: 'var(--palm-pink)', marginBottom: '6px', fontWeight: 600 }}>
        Your Persona & Vibe
      </div>
      <ul style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.7', marginBottom: '16px', paddingLeft: '18px' }}>
        <li>If you had to describe yourself as a &quot;type&quot; &mdash; girl next door, intimidating hot girl, cute and approachable, mysterious, chaotic, chill tomboy &mdash; what fits you?</li>
        <li>What do you want someone scrolling past your video to feel? (curiosity, attraction, jealousy, &quot;I need to follow her,&quot; intimidated, etc.)</li>
        <li>Do you lean more playful/teasing or more serious/seductive when you&apos;re on camera?</li>
        <li>What parts of your body or look do you feel most confident about?</li>
        <li>What kind of overall vibe you want your content to have (chill, outgoing, flirty, lifestyle, etc.)</li>
      </ul>

      <div style={{ fontSize: '13px', color: 'var(--palm-pink)', marginBottom: '6px', fontWeight: 600 }}>
        Content You Like
      </div>
      <ul style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.7', marginBottom: '16px', paddingLeft: '18px' }}>
        <li>What creators you like watching and what stands out about them</li>
        <li>When you see a reel and think &quot;that&apos;s so me&quot; &mdash; what is it about it? Can you describe a few you&apos;ve seen recently?</li>
        <li>What types of clips you&apos;ve already filmed before (even if they&apos;re random)</li>
        <li>What types of videos you&apos;d realistically be down to repeat every week (talking videos, GRWM, day in the life, going out, gym, etc.)</li>
        <li>Anything you think could turn into a repeatable series</li>
      </ul>

      <div style={{ fontSize: '13px', color: 'var(--palm-pink)', marginBottom: '6px', fontWeight: 600 }}>
        Comfort & Boundaries
      </div>
      <ul style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.7', marginBottom: '20px', paddingLeft: '18px' }}>
        <li>What scenarios would you be comfortable acting out? (e.g. &quot;POV: your neighbor comes over,&quot; roommate situations, gym crush, etc.)</li>
        <li>What would you absolutely NOT portray?</li>
        <li>Are you comfortable with opinion-bait captions that might get hate comments? (e.g. &quot;anything more than a handful is a waste&quot;)</li>
        <li>How do you feel about trending audio / lip sync content vs. original audio or no audio?</li>
        <li>What types of videos you would NOT want to do consistently</li>
        <li>We often add text/captions that are flirty, suggestive, and sometimes edgy to drive engagement &mdash; are you comfortable with that overall direction?</li>
        <li>Are there any hard boundaries we should not cross with captions or tone?</li>
        <li>Are you okay with us handling captions/creative without needing to approve each one, as long as we stay within your boundaries?</li>
      </ul>

      <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '24px', lineHeight: '1.5' }}>
        Doesn&apos;t need to be structured. Just talk through it casually.
      </p>

      {error && (
        <div style={{
          background: '#FFEBEE',
          color: '#C62828',
          padding: '10px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      {/* File upload */}
      <div
        style={{
          background: 'var(--card-bg-solid)',
          border: '2px dashed #e0e0e0',
          borderRadius: '12px',
          padding: '28px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '20px',
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--palm-pink)' }}
        onDragLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
        onDrop={e => {
          e.preventDefault()
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
          if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0])
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav"
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]) }}
        />
        <div style={{ fontSize: '14px', color: 'var(--foreground-muted)', marginBottom: '6px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#999"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
        </div>
        <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)' }}>
          Drop an audio file or <span style={{ color: 'var(--palm-pink)', fontWeight: 500 }}>browse</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
          MP3 or WAV
        </div>
      </div>

      {/* Uploading state */}
      {recState === 'uploading' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #f0f0f0',
            borderTop: '3px solid #E88FAC',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }} />
          <div style={{ fontSize: '14px', color: 'rgba(240, 236, 232, 0.75)' }}>
            {uploadProgress || 'Uploading...'}
          </div>
        </div>
      )}

      {/* Already sent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontWeight: 500 }}>OR</span>
        <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
      </div>

      <div style={{
        background: confirmed ? 'rgba(125, 211, 164, 0.08)' : 'rgba(232, 200, 120, 0.06)',
        border: '1px solid',
        borderColor: confirmed ? '#A5D6A7' : 'rgba(232, 200, 120, 0.2)',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '24px',
      }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            style={{ marginTop: '3px', accentColor: 'var(--palm-pink)' }}
          />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
              I already sent my voice memo to my manager
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.4' }}>
              Only check this if you have <strong>already sent</strong> the recording via text, email, or
              another channel.
            </div>
          </div>
        </label>
      </div>

      {confirmed && (
        <button
          onClick={async () => {
            try {
              const formData = new FormData()
              formData.append('hqId', hqId)
              formData.append('confirmed', 'true')
              const res = await fetch('/api/onboarding/voice-memo', { method: 'POST', body: formData })
              if (!res.ok) throw new Error('Failed to save')
              setRecState('done')
              onComplete()
            } catch (err) {
              console.error('Confirm error:', err)
              setError('Failed to save confirmation. Please try again.')
            }
          }}
          style={{
            padding: '10px 32px',
            background: 'var(--palm-pink)',
            color: '#060606',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Continue
        </button>
      )}

      {/* Skip option */}
      {!confirmed && (
        <div style={{ textAlign: 'center', marginTop: '8px' }}>
          <button
            onClick={async () => {
              const formData = new FormData()
              formData.append('hqId', hqId)
              formData.append('skipped', 'true')
              await fetch('/api/onboarding/voice-memo', { method: 'POST', body: formData })
              setRecState('done')
              onComplete()
            }}
            style={{
              padding: '8px 20px',
              background: 'transparent',
              color: 'var(--foreground-muted)',
              border: 'none',
              fontSize: '13px',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Skip for now
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
