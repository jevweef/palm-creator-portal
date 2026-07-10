'use client'

import { useRef, useState } from 'react'

// Written feedback on a report flag — the training loop's free-text channel.
// Anyone signed in (admin or chat manager) can type or DICTATE (mic button)
// what they think about the flag; every note is saved under their name and
// fed into the nightly calibration that tunes what the analyst flags.
//
// Props:
//   flag  — { date, creator, fan, message, issues, severity }
//   notes — existing notes for this flag [{ author, text, at }]
//   onSaved(note) — parent appends the new note to its state

const fmtAt = (iso) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

function MicIcon({ active }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? '#E87878' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  )
}

export default function FlagFeedback({ flag, notes = [], onSaved }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')        // '' | 'rec' | 'stt' | 'save'
  const [err, setErr] = useState('')
  const recRef = useRef(null)

  const startRec = async () => {
    setErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setBusy('stt')
        try {
          const fd = new FormData()
          fd.append('audio', new Blob(chunks, { type: mime }), 'note')
          const r = await fetch('/api/chat-team/transcribe', { method: 'POST', body: fd })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || 'transcription failed')
          setText((t) => (t ? `${t} ${j.text}` : j.text))
        } catch (e) { setErr(e.message) }
        setBusy('')
      }
      recRef.current = rec
      rec.start()
      setBusy('rec')
    } catch {
      setErr('Microphone blocked — allow mic access in the browser and try again.')
    }
  }
  const stopRec = () => { try { recRef.current?.stop() } catch {} }

  const save = async () => {
    if (!text.trim()) return
    setBusy('save'); setErr('')
    try {
      const r = await fetch('/api/admin/whales/report-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: flag.date, creator: flag.creator, fan: flag.fan, message: flag.message,
          issues: flag.issues, severity: flag.severity, text: text.trim(),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'save failed')
      setText('')
      onSaved?.(j.note)
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const btn = {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--foreground-muted)',
    borderRadius: '6px', padding: '2px 9px', fontSize: '11px', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: '5px',
  }

  return (
    <div style={{ marginTop: '6px' }}>
      {!open && (
        <button onClick={() => setOpen(true)} style={btn}>
          give feedback{notes.length ? ` (${notes.length})` : ''}
        </button>
      )}
      {open && (
        <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '10px 12px' }}>
          {notes.map((n, i) => (
            <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#C4A5F7' }}>{n.author}</span>
              <span style={{ fontSize: '10px', color: 'var(--foreground-muted)', marginLeft: '6px' }}>{fmtAt(n.at)}</span>
              <div style={{ fontSize: '12px', color: 'var(--foreground)', marginTop: '1px' }}>{n.text}</div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: notes.length ? '8px' : 0 }}>
            <textarea
              value={text} onChange={(e) => setText(e.target.value)} rows={2}
              placeholder="Should this have been flagged? Say why or why not — it trains the overnight analyst."
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'var(--foreground)', fontSize: '12px', padding: '6px 9px', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <button
                onClick={busy === 'rec' ? stopRec : startRec} disabled={busy === 'stt' || busy === 'save'}
                title={busy === 'rec' ? 'Stop recording' : 'Dictate your feedback'}
                style={{ ...btn, borderColor: busy === 'rec' ? 'rgba(232,120,120,0.6)' : 'rgba(255,255,255,0.15)', color: busy === 'rec' ? '#E87878' : 'var(--foreground-muted)' }}>
                <MicIcon active={busy === 'rec'} />
                {busy === 'rec' ? 'stop' : busy === 'stt' ? 'transcribing…' : 'talk'}
              </button>
              <button onClick={save} disabled={!text.trim() || !!busy}
                style={{ ...btn, borderColor: 'rgba(125,211,164,0.4)', color: '#7DD3A4', fontWeight: 700, opacity: !text.trim() || busy ? 0.5 : 1 }}>
                {busy === 'save' ? 'saving…' : 'save'}
              </button>
            </div>
          </div>
          {err && <div style={{ fontSize: '11px', color: '#E87878', marginTop: '4px' }}>{err}</div>}
          <div style={{ marginTop: '6px' }}>
            <button onClick={() => setOpen(false)} style={{ ...btn, border: 'none', padding: 0 }}>close</button>
          </div>
        </div>
      )}
    </div>
  )
}
