'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const MAX_DURATION = 600 // 10 minutes in seconds

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Convert an AudioBuffer to a WAV Blob (mono, 16-bit PCM)
function audioBufferToWav(audioBuffer) {
  // Downmix to mono
  const numChannels = 1
  const sampleRate = audioBuffer.sampleRate
  const samples = audioBuffer.getChannelData(0)

  // Convert float32 to int16
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }

  const byteLength = int16.length * 2
  const buffer = new ArrayBuffer(44 + byteLength)
  const view = new DataView(buffer)

  // WAV header
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + byteLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)          // chunk size
  view.setUint16(20, 1, true)           // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true) // byte rate
  view.setUint16(32, numChannels * 2, true) // block align
  view.setUint16(34, 16, true)          // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, byteLength, true)

  // Write PCM samples
  const output = new Int16Array(buffer, 44)
  output.set(int16)

  return new Blob([buffer], { type: 'audio/wav' })
}

export default function StepVoiceMemo({ hqId, onComplete }) {
  // Recording state
  const [recState, setRecState] = useState('idle') // idle | recording | recorded | uploading | done
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [confirmed, setConfirmed] = useState(false)

  // Upload state
  const [uploadProgress, setUploadProgress] = useState(null)
  const [error, setError] = useState(null)

  // Already uploaded state (for refresh)
  const [existingMemo, setExistingMemo] = useState(null)
  const [loading, setLoading] = useState(true)

  // Refs
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const canvasRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const audioRef = useRef(null)
  const playbackAnimRef = useRef(null)
  const playbackAnalyserRef = useRef(null)
  const playbackCanvasRef = useRef(null)

  // File upload refs
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

  // Draw live waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, width, height)

      ctx.lineWidth = 2
      ctx.strokeStyle = '#E88FAC'
      ctx.beginPath()

      const sliceWidth = width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * height) / 2

        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)

        x += sliceWidth
      }

      ctx.lineTo(width, height / 2)
      ctx.stroke()
    }

    draw()
  }, [])

  // Start recording
  const startRecording = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Set up analyser for waveform
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      // Determine best mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const rawBlob = new Blob(chunksRef.current, { type: recorder.mimeType })

        // Convert to WAV for universal playback
        try {
          const arrayBuf = await rawBlob.arrayBuffer()
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
          const decoded = await audioCtx.decodeAudioData(arrayBuf)
          const wavBlob = audioBufferToWav(decoded)
          setAudioBlob(wavBlob)
          setAudioUrl(URL.createObjectURL(wavBlob))
          audioCtx.close()
        } catch (err) {
          // Fallback to raw blob if conversion fails
          console.warn('WAV conversion failed, using raw format:', err)
          setAudioBlob(rawBlob)
          setAudioUrl(URL.createObjectURL(rawBlob))
        }

        setRecState('recorded')

        // Clean up stream
        stream.getTracks().forEach(t => t.stop())
      }

      mediaRecorderRef.current = recorder
      recorder.start(500) // collect chunks every 500ms

      // Start timer
      startTimeRef.current = Date.now()
      setDuration(0)
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000
        setDuration(elapsed)
        if (elapsed >= MAX_DURATION) {
          stopRecording()
        }
      }, 100)

      setRecState('recording')
      // Start waveform after a tick to let canvas mount
      setTimeout(() => drawWaveform(), 50)
    } catch (err) {
      console.error('Microphone error:', err)
      setError('Could not access microphone. Please allow microphone access and try again.')
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
  }

  // Re-record
  const reRecord = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setDuration(0)
    setRecState('idle')
  }

  // Upload recording
  const uploadRecording = async () => {
    if (!audioBlob || !hqId) return
    setRecState('uploading')
    setUploadProgress('Uploading...')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('hqId', hqId)

      // Determine extension from mime type
      const mime = audioBlob.type
      const ext = mime.includes('wav') ? 'wav' : mime.includes('mp4') ? 'm4a' : 'webm'
      formData.append('audio', audioBlob, `voice-memo.${ext}`)

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
      setRecState('recorded')
      setUploadProgress(null)
    }
  }

  // Upload a file (drag/drop or browse)
  const handleFileUpload = async (file) => {
    if (!file || !hqId) return
    const validTypes = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg', 'audio/webm', 'video/mp4']
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|m4a|wav|ogg|webm|mp4)$/i)) {
      setError('Please upload an audio file (MP3, M4A, WAV, OGG, or WEBM)')
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (playbackAnimRef.current) cancelAnimationFrame(playbackAnimRef.current)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  if (loading) {
    return <div style={{ color: '#999', fontSize: '14px', padding: '20px' }}>Loading...</div>
  }

  // Already uploaded/skipped/confirmed
  const isSkipped = existingMemo?.voiceMemoStatus === 'Skipped'
  if (recState === 'done') {
    return (
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
          Voice Memo
        </h2>
        <p style={{ fontSize: '13px', color: '#999', marginBottom: '24px' }}>
          {isSkipped
            ? 'You skipped this step. Your manager will follow up if needed.'
            : confirmed
              ? 'You confirmed your voice memo was already sent.'
              : 'Your voice memo has been saved!'}
        </p>

        <div style={{
          background: isSkipped ? '#FFF8E1' : '#E8F5E9',
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
          <div style={{ fontSize: '14px', fontWeight: 600, color: isSkipped ? '#F57F17' : '#2E7D32' }}>
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
            background: '#E88FAC',
            color: '#fff',
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
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Voice Memo
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '24px', lineHeight: '1.5' }}>
        Record a voice memo telling us about yourself — your personality, how you talk to fans,
        what makes you unique. Talk naturally, like you&apos;re explaining yourself to a friend.
        2-5 minutes is perfect.
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

      {/* Recorder section */}
      <div style={{
        background: recState === 'recording' ? '#1a1a1a' : '#fff',
        border: recState === 'recording' ? 'none' : '1px solid #e0e0e0',
        borderRadius: '16px',
        padding: '28px',
        marginBottom: '20px',
        transition: 'background 0.3s, border 0.3s',
      }}>
        {/* IDLE STATE */}
        {recState === 'idle' && (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={startRecording}
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: '#E88FAC',
                border: '4px solid #FFF0F3',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
                transition: 'transform 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </button>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a1a1a' }}>
              Tap to record
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
              Max {MAX_DURATION / 60} minutes
            </div>
          </div>
        )}

        {/* RECORDING STATE */}
        {recState === 'recording' && (
          <div>
            {/* Waveform canvas */}
            <canvas
              ref={canvasRef}
              width={700}
              height={80}
              style={{
                width: '100%',
                height: '80px',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Timer + recording indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: '#E88FAC',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '20px', fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(duration)}
                </span>
              </div>

              {/* Stop button */}
              <button
                onClick={stopRecording}
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: '#E88FAC',
                  border: '3px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Stop square icon */}
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '3px',
                  background: '#fff',
                }} />
              </button>
            </div>
          </div>
        )}

        {/* RECORDED STATE — playback preview */}
        {recState === 'recorded' && audioUrl && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                style={{ width: '100%', height: '40px' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '13px', color: '#999' }}>
                {formatTime(duration)} recorded
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={reRecord}
                  style={{
                    padding: '8px 16px',
                    background: '#f5f5f5',
                    color: '#666',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Re-record
                </button>
                <button
                  onClick={uploadRecording}
                  style={{
                    padding: '8px 20px',
                    background: '#E88FAC',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save Recording
                </button>
              </div>
            </div>
          </div>
        )}

        {/* UPLOADING STATE */}
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
            <div style={{ fontSize: '14px', color: '#666' }}>
              {uploadProgress || 'Uploading...'}
            </div>
          </div>
        )}
      </div>

      {/* OR divider */}
      {recState === 'idle' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <div style={{ flex: 1, height: '1px', background: '#e0e0e0' }} />
            <span style={{ fontSize: '12px', color: '#999', fontWeight: 500 }}>OR UPLOAD A FILE</span>
            <div style={{ flex: 1, height: '1px', background: '#e0e0e0' }} />
          </div>

          {/* File upload */}
          <div
            style={{
              background: '#fff',
              border: '2px dashed #e0e0e0',
              borderRadius: '12px',
              padding: '24px',
              textAlign: 'center',
              cursor: 'pointer',
              marginBottom: '20px',
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#E88FAC' }}
            onDragLeave={e => { e.currentTarget.style.borderColor = '#e0e0e0' }}
            onDrop={e => {
              e.preventDefault()
              e.currentTarget.style.borderColor = '#e0e0e0'
              if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0])
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.m4a,.wav,.ogg,.webm,.mp4"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]) }}
            />
            <div style={{ fontSize: '14px', color: '#999', marginBottom: '6px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#999"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
            </div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Drop an audio file or <span style={{ color: '#E88FAC', fontWeight: 500 }}>browse</span>
            </div>
            <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
              MP3, M4A, WAV, OGG, WEBM
            </div>
          </div>

          {/* OR already sent */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <div style={{ flex: 1, height: '1px', background: '#e0e0e0' }} />
            <span style={{ fontSize: '12px', color: '#999', fontWeight: 500 }}>OR</span>
            <div style={{ flex: 1, height: '1px', background: '#e0e0e0' }} />
          </div>

          <div style={{
            background: confirmed ? '#E8F5E9' : '#FFF8E1',
            border: '1px solid',
            borderColor: confirmed ? '#A5D6A7' : '#FFE082',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                style={{ marginTop: '3px', accentColor: '#E88FAC' }}
              />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
                  I already sent my voice memo to my manager
                </div>
                <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.4' }}>
                  Only check this if you have <strong>already sent</strong> the recording via text, email, or
                  another channel.
                </div>
              </div>
            </label>
          </div>

          {confirmed && (
            <button
              onClick={async () => {
                const formData = new FormData()
                formData.append('hqId', hqId)
                formData.append('confirmed', 'true')
                await fetch('/api/onboarding/voice-memo', { method: 'POST', body: formData })
                setRecState('done')
                onComplete()
              }}
              style={{
                padding: '10px 32px',
                background: '#E88FAC',
                color: '#fff',
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
                  color: '#999',
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
        </>
      )}

      {/* CSS animations */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
