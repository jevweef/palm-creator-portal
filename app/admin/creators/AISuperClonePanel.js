'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const POSE_ORDER = ['front', 'back', 'face']
const POSE_META = {
  front: { label: 'Front View', model: 'Wan 2.7', emoji: '🧍‍♀️' },
  back: { label: 'Back View', model: 'Wan 2.7', emoji: '🔄' },
  face: { label: 'Close Up Face', model: 'Nano Banana 2', emoji: '🙂' },
}

const HARDCODED_PROMPTS = {
  front:
    'Exact same woman as in the reference images, wearing a black micro bikini, front three-quarter body view, standing pose with hands relaxed, confident posture, soft studio lighting, clean light gray seamless background, hyper realistic photography, ultra detailed skin texture, best quality, 8k, sharp focus, cinematic lighting, masterpiece, photorealistic',
  back:
    'Exact same woman as in the reference images, wearing a black micro bikini, rear full body view, standing straight with hands at sides, elegant posture, soft even studio lighting highlighting her figure, clean light gray seamless background, hyper realistic, ultra detailed skin, best quality, 8k resolution, sharp focus, photorealistic, masterpiece',
  face:
    'Exact same woman as in the reference images, extreme close-up portrait of her face and shoulders, neutral expression, direct gaze, soft diffused studio lighting, clean light gray background, hyper realistic photography, ultra detailed skin texture and pores, best quality, 8k, razor sharp focus on eyes, cinematic, masterpiece, photorealistic, angle should be a half body pic, close up',
}

function PoseCard({ creatorId, pose, state, prompts, onPromptChange, onRefresh }) {
  const meta = POSE_META[pose]
  const inputs = state.inputsByPose[pose] || []
  const output = state.outputs[pose]
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [taskId, setTaskId] = useState(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  // Polling effect — when we have a taskId, poll every 4s until completed/failed.
  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/admin/creator-ai-clone/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorId, pose, taskId }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || `Poll failed (${res.status})`)
          setTaskId(null)
          setGenerating(false)
          return
        }
        if (data.status === 'completed') {
          setTaskId(null)
          setGenerating(false)
          await onRefresh()
        } else if (data.status === 'failed') {
          setTaskId(null)
          setGenerating(false)
          setError(data.error || 'Generation failed')
        } else {
          setTimeout(poll, 4000)
        }
      } catch (e) {
        if (cancelled) return
        setError(e.message)
        setTaskId(null)
        setGenerating(false)
      }
    }
    poll()
    return () => { cancelled = true }
  }, [taskId, creatorId, pose, onRefresh])

  const handleUpload = async (filesList) => {
    if (!filesList?.length) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('creatorId', creatorId)
      form.append('pose', pose)
      Array.from(filesList).forEach(f => form.append('files', f))
      const res = await fetch('/api/admin/creator-ai-clone/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      await onRefresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (attachmentId) => {
    if (!confirm('Remove this input photo?')) return
    setError('')
    try {
      const res = await fetch('/api/admin/creator-ai-clone', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, attachmentId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      await onRefresh()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleGenerate = async () => {
    setError('')
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/creator-ai-clone/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, pose, customPrompt: prompts[pose] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generate failed')
      setTaskId(data.taskId)
    } catch (e) {
      setError(e.message)
      setGenerating(false)
    }
  }

  const handleRegenerate = async () => {
    if (!confirm(`Regenerate ${meta.label} reference? The current approved image will be replaced.`)) return
    handleGenerate()
  }

  const canGenerate = inputs.length > 0 && !generating

  return (
    <div style={{
      background: 'var(--card-bg-solid)',
      borderRadius: '14px',
      padding: '20px',
      marginBottom: '16px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>{meta.emoji}</span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)' }}>{meta.label}</div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Model: {meta.model}</div>
          </div>
        </div>
        {output && (
          <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600, background: 'rgba(125, 211, 164, 0.08)', color: '#7DD3A4', border: '1px solid rgba(125, 211, 164, 0.2)' }}>
            ✓ APPROVED
          </span>
        )}
      </div>

      {/* Two-column layout: inputs on left, output on right (when present) */}
      <div style={{ display: 'grid', gridTemplateColumns: output ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* Inputs column */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Input Photos ({inputs.length})
          </div>
          {inputs.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '6px', marginBottom: '10px' }}>
              {inputs.map((att, i) => (
                <div key={att.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={att.url} alt={att.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {i === 0 && (
                    <div style={{ position: 'absolute', top: '2px', left: '2px', fontSize: '9px', fontWeight: 700, padding: '2px 5px', background: 'var(--palm-pink)', color: '#060606', borderRadius: '3px' }}>
                      ANCHOR
                    </div>
                  )}
                  <button
                    onClick={() => handleDelete(att.id)}
                    title={`Delete ${att.filename}`}
                    style={{ position: 'absolute', top: '2px', right: '2px', width: '18px', height: '18px', fontSize: '11px', background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', cursor: 'pointer', lineHeight: 1, padding: 0 }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            disabled={uploading}
            onChange={e => handleUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragOver(true) }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!uploading) setDragOver(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation()
              setDragOver(false)
              if (uploading) return
              const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'))
              if (files.length) handleUpload(files)
            }}
            style={{
              padding: '14px 12px', fontSize: '12px', fontWeight: 600,
              background: dragOver ? 'rgba(232, 160, 160, 0.12)' : 'transparent',
              color: 'var(--palm-pink)',
              border: `1px dashed ${dragOver ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.5)'}`,
              borderRadius: '6px', cursor: uploading ? 'wait' : 'pointer',
              textAlign: 'center', userSelect: 'none',
              transition: 'background 0.12s, border-color 0.12s',
            }}
          >
            {uploading
              ? 'Uploading…'
              : dragOver
                ? `Drop to upload`
                : `+ Drop or click to add ${meta.label.toLowerCase()} photos`}
          </div>
          {inputs.length > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '6px', fontStyle: 'italic' }}>
              First image = face anchor. The AI locks onto this face for all outputs.
            </div>
          )}
        </div>

        {/* Output column */}
        {output && (
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              AI Reference Image
            </div>
            <div style={{ aspectRatio: '9/16', maxHeight: '280px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.3)', marginBottom: '10px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={output.url} alt={output.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <button
              onClick={handleRegenerate}
              disabled={generating}
              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: generating ? 'wait' : 'pointer', width: '100%' }}
            >
              {generating ? 'Regenerating…' : '🔄 Regenerate'}
            </button>
          </div>
        )}
      </div>

      {/* Prompt textarea */}
      <details style={{ marginTop: '14px' }}>
        <summary style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
          Prompt (editable)
        </summary>
        <textarea
          value={prompts[pose]}
          onChange={e => onPromptChange(pose, e.target.value)}
          rows={4}
          style={{ width: '100%', marginTop: '8px', padding: '8px', fontSize: '11px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'var(--foreground)', resize: 'vertical' }}
        />
        {prompts[pose] !== HARDCODED_PROMPTS[pose] && (
          <button onClick={() => onPromptChange(pose, HARDCODED_PROMPTS[pose])} style={{ marginTop: '4px', padding: '3px 8px', fontSize: '10px', background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}>
            Reset to default
          </button>
        )}
      </details>

      {/* Generate button (when no output yet) */}
      {!output && (
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            marginTop: '14px', padding: '10px 16px', fontSize: '13px', fontWeight: 700,
            background: canGenerate ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
            color: canGenerate ? '#060606' : 'var(--foreground-subtle)',
            border: 'none', borderRadius: '8px',
            cursor: canGenerate ? 'pointer' : 'not-allowed', width: '100%',
          }}
        >
          {generating ? '⏳ Generating… (this can take 30-60s)' : `✨ Generate ${meta.label} Reference`}
        </button>
      )}

      {error && (
        <div style={{ marginTop: '10px', fontSize: '11px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '6px 10px' }}>
          {error}
        </div>
      )}
    </div>
  )
}

export default function AISuperClonePanel({ creatorId }) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')
  const [prompts, setPrompts] = useState(HARDCODED_PROMPTS)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/creator-ai-clone?creatorId=${creatorId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setState(data.state)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [creatorId])

  useEffect(() => { fetchState() }, [fetchState])

  const handleToggle = async () => {
    if (!state) return
    setToggling(true)
    try {
      const res = await fetch('/api/admin/creator-ai-clone', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, enabled: !state.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Toggle failed')
      setState(prev => ({ ...prev, enabled: data.enabled }))
    } catch (e) {
      setError(e.message)
    } finally {
      setToggling(false)
    }
  }

  if (loading) return <div style={{ padding: '20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading…</div>
  if (!state) return <div style={{ padding: '20px', color: '#E87878', fontSize: '13px' }}>{error || 'No state'}</div>

  return (
    <div>
      {/* Toggle */}
      <div style={{ background: 'var(--card-bg-solid)', borderRadius: '14px', padding: '16px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>AI Conversions</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
            {state.enabled
              ? 'Enabled — reference setup unlocked. AI Recreate workflow uses these references.'
              : 'Disabled — toggle on to start the reference image setup.'}
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggling}
          style={{
            position: 'relative', width: '44px', height: '24px',
            background: state.enabled ? '#7DD3A4' : 'rgba(255,255,255,0.1)',
            borderRadius: '12px', border: 'none', cursor: toggling ? 'wait' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          <div style={{
            position: 'absolute', top: '3px', left: state.enabled ? '23px' : '3px',
            width: '18px', height: '18px', borderRadius: '50%',
            background: 'white', transition: 'left 0.15s',
          }} />
        </button>
      </div>

      {!state.enabled && (
        <div style={{ background: 'rgba(255, 200, 100, 0.04)', border: '1px solid rgba(255, 200, 100, 0.15)', borderRadius: '12px', padding: '16px', fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: 1.6 }}>
          When toggled on, you&apos;ll get three pose cards (Front / Back / Face) where you upload source photos
          for each pose. We auto-rename them in Dropbox, send them to WaveSpeed (Wan 2.7 for body, Nano Banana 2 for face),
          and surface the generated AI references inline for approval. Once all three are approved, the creator&apos;s
          identity packet is ready for the Recreate workflow.
        </div>
      )}

      {state.enabled && POSE_ORDER.map(pose => (
        <PoseCard
          key={pose}
          creatorId={creatorId}
          pose={pose}
          state={state}
          prompts={prompts}
          onPromptChange={(p, value) => setPrompts(prev => ({ ...prev, [p]: value }))}
          onRefresh={fetchState}
        />
      ))}

      {error && (
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#E87878', background: 'rgba(232, 120, 120, 0.06)', border: '1px solid #fecdd3', borderRadius: '6px', padding: '8px 12px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
