'use client'

import { useState, useRef } from 'react'

export default function StepVoiceMemo({ onComplete }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleFile = (f) => {
    const validTypes = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg', 'audio/webm', 'video/mp4']
    if (f && (validTypes.includes(f.type) || f.name.match(/\.(mp3|m4a|wav|ogg|webm|mp4)$/i))) {
      setFile(f)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0])
  }

  const canContinue = uploaded || confirmed

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Voice Memo
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '24px', lineHeight: '1.5' }}>
        Record a voice memo telling us about yourself — your personality, how you talk to fans,
        what makes you unique. This is the most important part of your profile. Talk naturally,
        like you&apos;re explaining yourself to a friend.
      </p>

      {/* Upload option */}
      <div style={{
        background: '#fff',
        border: `2px dashed ${dragOver ? '#E88FAC' : '#e0e0e0'}`,
        borderRadius: '12px',
        padding: '32px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        marginBottom: '20px',
      }}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.m4a,.wav,.ogg,.webm,.mp4"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
        />

        {uploaded ? (
          <>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#43A047' }}>
              Voice memo uploaded!
            </div>
          </>
        ) : file ? (
          <>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>🎙️</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a1a1a', marginBottom: '4px' }}>
              {file.name}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '12px' }}>
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                // TODO: Phase 2 — actual Dropbox upload
                setUploading(true)
                setTimeout(() => {
                  setUploading(false)
                  setUploaded(true)
                }, 1500)
              }}
              disabled={uploading}
              style={{
                padding: '8px 24px',
                background: uploading ? '#F0D0D8' : '#E88FAC',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer',
              }}
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>🎙️</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a1a1a', marginBottom: '4px' }}>
              Drop your voice memo here
            </div>
            <div style={{ fontSize: '12px', color: '#999' }}>
              or click to browse — MP3, M4A, WAV, OGG
            </div>
          </>
        )}
      </div>

      {/* OR divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
        <div style={{ flex: 1, height: '1px', background: '#e0e0e0' }} />
        <span style={{ fontSize: '12px', color: '#999', fontWeight: 500 }}>OR</span>
        <div style={{ flex: 1, height: '1px', background: '#e0e0e0' }} />
      </div>

      {/* Confirm already sent */}
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
            disabled={uploaded}
            style={{ marginTop: '3px', accentColor: '#E88FAC' }}
          />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
              I already sent my voice memo to my manager
            </div>
            <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.4' }}>
              Only check this if you have <strong>already sent</strong> the recording via text, email, or
              another channel. If you haven&apos;t sent it yet, please upload it above or send it to your
              manager first.
            </div>
          </div>
        </label>
      </div>

      <button
        onClick={onComplete}
        disabled={!canContinue}
        style={{
          padding: '10px 32px',
          background: canContinue ? '#E88FAC' : '#F0D0D8',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: canContinue ? 'pointer' : 'not-allowed',
        }}
      >
        Continue to Next Step
      </button>
    </div>
  )
}
