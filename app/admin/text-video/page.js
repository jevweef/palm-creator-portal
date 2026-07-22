'use client'

// Text-to-Video — its own workflow, separate from reel recreation (Evan,
// 2026-07-22): no inspo reel, no frame swaps. Pick a creator, her approved AI
// refs anchor WHO she is, the prompt alone decides the scene. Powered by
// x-ai/grok-imagine-video/reference-to-video via /api/admin/recreate/animate
// (quality 'grok_ref'); output keeps Grok's native audio (no mux).

import { useState, useEffect, useCallback, useRef } from 'react'

const card = { background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px 22px', marginBottom: '18px' }
const label = { fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }

export default function TextVideoPage() {
  const [creators, setCreators] = useState([])
  const [creatorId, setCreatorId] = useState('')
  const [refs, setRefs] = useState(null)     // null = not loaded
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')     // ride-along negative (Wan only)
  const [inspoUrl, setInspoUrl] = useState('')
  const [inspoBusy, setInspoBusy] = useState(false)
  const [inspoInfo, setInspoInfo] = useState(null) // { title, username, thumbnail, cached }
  const [engine, setEngine] = useState('grok_ref') // 'grok_ref' | 'wan26'
  const [duration, setDuration] = useState(6)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [videos, setVideos] = useState([])   // { url, prompt, at } newest first
  const pollRef = useRef(null)

  useEffect(() => {
    fetch('/api/admin/palm-creators').then(r => r.json()).then(d => setCreators(d.creators || [])).catch(() => {})
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    setRefs(null)
    if (!creatorId) return
    let alive = true
    fetch(`/api/admin/recreate/ai-refs?creatorId=${creatorId}`)
      .then(r => r.json())
      .then(d => { if (alive) setRefs(d.refs || []) })
      .catch(() => { if (alive) setRefs([]) })
    return () => { alive = false }
  }, [creatorId])

  const generate = useCallback(async () => {
    if (!creatorId || !prompt.trim()) return
    setRunning(true); setError('')
    try {
      const res = await fetch('/api/admin/recreate/animate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, quality: engine, motionPrompt: prompt.trim(), motionNegative: negative || undefined, duration }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submit failed')
      const taskId = data.taskId
      const startedPrompt = prompt.trim()
      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch('/api/admin/recreate/animate-status', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, quality: engine }),
          })
          const sj = await sr.json()
          if (sj.status === 'completed' && sj.outputUrl) {
            clearInterval(pollRef.current)
            setVideos(v => [{ url: sj.outputUrl, prompt: startedPrompt, at: new Date().toLocaleTimeString() }, ...v])
            setRunning(false)
          } else if (sj.status === 'failed') {
            clearInterval(pollRef.current)
            setError(sj.error || 'Generation failed')
            setRunning(false)
          }
        } catch { /* keep polling */ }
      }, 5000)
    } catch (err) {
      setError(err.message); setRunning(false)
    }
  }, [creatorId, prompt, negative, duration, engine])

  // Pull an inspo reel's DISSECTED prompts (the recreate pipeline's Sonnet
  // analysis) straight into the scene box: cached Recreate Scene + Motion
  // prompts when the reel has them, else run the motion analysis now (~20s,
  // saves back to the reel so it's cached for next time).
  const pullInspo = useCallback(async () => {
    const q = inspoUrl.trim()
    if (!q) return
    setInspoBusy(true); setError(''); setInspoInfo(null)
    try {
      const lr = await fetch(`/api/admin/recreate/lookup?url=${encodeURIComponent(q)}`)
      const reel = await lr.json()
      if (!lr.ok) throw new Error(reel.error || 'Reel not found on the inspo board')
      let scene = reel.recreateScenePrompt || ''
      let motion = reel.recreateMotionPrompt || ''
      let cached = !!motion
      if (!motion) {
        if (!reel.dbRawLink) throw new Error('Reel has no stored video file — scrape it first')
        const mr = await fetch('/api/admin/recreate/extract-motion-prompt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: reel.dbRawLink, inspoRecordId: reel.id }),
        })
        const mj = await mr.json()
        if (!mr.ok) throw new Error(mj.error || 'Motion analysis failed')
        motion = mj.positivePrompt || mj.motionPrompt || ''
        if (mj.negativePrompt) setNegative(mj.negativePrompt)
      }
      if (reel.recreateMotionNegative) setNegative(reel.recreateMotionNegative)
      // Text-to-video has no start frame, so the SCENE must live in the text:
      // scene prompt (setting) + motion prompt (action) when both exist.
      setPrompt([scene, motion].filter(Boolean).join(' '))
      setInspoInfo({ title: reel.title || reel.username || q, username: reel.username, thumbnail: reel.thumbnail, cached })
    } catch (err) { setError(err.message) } finally { setInspoBusy(false) }
  }, [inspoUrl])

  return (
    <div style={{ maxWidth: '860px' }}>
      <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '4px 0 18px', lineHeight: 1.5 }}>
        Describe a scene; her approved AI reference photos keep it <i>her</i>. No reel, no frame swaps — text in, video out.
        {engine === 'wan26' ? `1080p, ${duration}s, ~$${(duration * 0.15).toFixed(2)} per run — Wan is the loosest-moderated hosted engine (try it when Grok refuses).` : `720p, ${duration}s, ~$${duration === 6 ? '0.30' : '0.50'} per run.`} About a minute or two to generate; keeps the model&apos;s native audio.
      </div>

      <div style={card}>
        <div style={label}>1 · Creator</div>
        <select value={creatorId} onChange={e => setCreatorId(e.target.value)} disabled={running}
          style={{ width: '100%', maxWidth: '320px', padding: '9px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)' }}>
          <option value="">— pick a creator —</option>
          {creators.map(c => <option key={c.id} value={c.id}>{c.aka || c.name}</option>)}
        </select>

        {creatorId && (
          <div style={{ marginTop: '14px' }}>
            <div style={label}>Identity anchors (her approved AI refs)</div>
            {refs === null ? (
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Loading refs…</div>
            ) : refs.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#E87878' }}>No approved AI refs on this creator — approve refs in AI Recreate first; generation will refuse without them.</div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {refs.map((r, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumb} alt={r.label} style={{ width: '72px', height: '96px', objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                    <div style={{ fontSize: '9px', color: 'var(--foreground-subtle)', marginTop: '3px' }}>{r.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={label}>2 · Scene</div>
        {/* Inspo bridge — dissect a board reel into the prompt */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={inspoUrl}
            onChange={e => setInspoUrl(e.target.value)}
            disabled={inspoBusy || running}
            placeholder="Optional: paste an inspo reel URL / shortcode to use ITS scene + motion"
            style={{ flex: 1, minWidth: '260px', padding: '7px 10px', fontSize: '12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)', outline: 'none' }}
          />
          <button onClick={pullInspo} disabled={inspoBusy || running || !inspoUrl.trim()}
            style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '7px', border: 'none', cursor: inspoBusy ? 'wait' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: inspoBusy || !inspoUrl.trim() ? 0.6 : 1 }}>
            {inspoBusy ? 'Dissecting…' : 'Use reel'}
          </button>
          {inspoInfo && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--foreground-muted)' }}>
              {inspoInfo.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={inspoInfo.thumbnail} alt="" style={{ width: '22px', height: '30px', objectFit: 'cover', borderRadius: '4px' }} />
              )}
              @{inspoInfo.username || '?'} · {inspoInfo.cached ? 'saved analysis' : 'freshly analyzed'} — edit below, then Generate
            </span>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          disabled={running}
          rows={4}
          placeholder={'e.g. "She films a mirror selfie video in a sunlit bedroom wearing an oversized hoodie, laughs at something off-screen, handheld iPhone footage, hyper realistic, true-to-life skin texture, no filter."'}
          style={{ width: '100%', padding: '12px 14px', fontSize: '13px', lineHeight: 1.5, borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { id: 'grok_ref', name: 'Grok', hint: '720p · all refs anchor her' },
              { id: 'wan26', name: 'Wan 2.6', hint: '1080p · loosest moderation' },
            ].map(e => (
              <button key={e.id} title={e.hint} disabled={running}
                onClick={() => { setEngine(e.id); setDuration(e.id === 'wan26' ? 5 : 6) }}
                style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '7px', border: '1px solid ' + (engine === e.id ? 'var(--palm-pink)' : 'rgba(255,255,255,0.1)'), cursor: 'pointer', background: engine === e.id ? 'rgba(232,160,160,0.14)' : 'transparent', color: engine === e.id ? 'var(--palm-pink)' : 'var(--foreground-muted)' }}>
                {e.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(engine === 'wan26' ? [5, 10, 15] : [6, 10]).map(s => (
              <button key={s} onClick={() => setDuration(s)} disabled={running}
                style={{ padding: '7px 14px', fontSize: '12px', fontWeight: 700, borderRadius: '7px', border: 'none', cursor: 'pointer', background: duration === s ? 'var(--palm-pink)' : 'rgba(255,255,255,0.05)', color: duration === s ? '#060606' : 'var(--foreground-muted)' }}>
                {s}s
              </button>
            ))}
          </div>
          <button onClick={generate} disabled={running || !creatorId || !prompt.trim() || refs?.length === 0}
            style={{ padding: '9px 22px', fontSize: '13px', fontWeight: 700, borderRadius: '8px', border: 'none', cursor: running ? 'wait' : 'pointer', background: 'var(--palm-pink)', color: '#060606', opacity: running || !creatorId || !prompt.trim() ? 0.6 : 1 }}>
            {running ? 'Generating… (~1 min)' : 'Generate video'}
          </button>
        </div>
        {error && <div style={{ marginTop: '10px', fontSize: '12px', color: '#E87878' }}>{error}</div>}
      </div>

      {videos.length > 0 && (
        <div style={card}>
          <div style={label}>Results (this session)</div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {videos.map((v, i) => (
              <div key={i} style={{ width: '240px' }}>
                <video src={v.url} controls loop style={{ width: '100%', borderRadius: '10px', background: 'rgba(0,0,0,0.4)' }} />
                <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                  {v.at} — {v.prompt.slice(0, 90)}{v.prompt.length > 90 ? '…' : ''}
                </div>
                <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: 'var(--palm-pink)' }}>Download</a>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginTop: '10px' }}>
            Links are temporary hosting from WaveSpeed — download keepers. Saving into the content pipeline comes next once we know we like the output.
          </div>
        </div>
      )}
    </div>
  )
}
