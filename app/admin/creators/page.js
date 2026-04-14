'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

const TAG_CATEGORIES = [
  'Setting / Location',
  'Persona / Niche',
  'Tone / Energy',
  'Visual / Body',
  'Viewer Experience',
  'Film Format',
]

const STATUS_STYLES = {
  'Not Started':       { bg: '#FFF0F3', text: '#999', border: '#E8C4CC' },
  'Ready to Analyze':  { bg: '#dbeafe', text: '#60a5fa', border: '#bfdbfe' },
  'Analyzing':         { bg: '#fef3c7', text: '#f59e0b', border: '#fde68a' },
  'Analyzed':          { bg: '#dcfce7', text: '#22c55e', border: '#bbf7d0' },
  'Reanalyze':         { bg: '#ffedd5', text: '#fb923c', border: '#fed7aa' },
}

// Derive display status from analysis status + documents + dates
function getDisplayStatus(profileAnalysisStatus, documents, profileLastAnalyzed, analyzing) {
  if (analyzing) return 'Analyzing'
  if (profileAnalysisStatus === 'Analyzing') return 'Analyzing'
  if (profileAnalysisStatus === 'Complete') {
    // Check if any doc was uploaded after the last analysis
    if (profileLastAnalyzed && documents.length > 0) {
      const hasNewDocs = documents.some(d => d.uploadDate > profileLastAnalyzed)
      if (hasNewDocs) return 'Reanalyze'
    }
    return 'Analyzed'
  }
  if (documents.length > 0) return 'Ready to Analyze'
  return 'Not Started'
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Not Started']
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
    }}>
      {status || 'Not Started'}
    </span>
  )
}

function WeightBar({ tag, weight, category }) {
  const catColors = {
    'Setting / Location': '#06b6d4',
    'Persona / Niche':    '#E88FAC',
    'Tone / Energy':      '#f472b6',
    'Visual / Body':      '#fb923c',
    'Viewer Experience':  '#60a5fa',
    'Film Format':        '#34d399',
  }
  const color = catColors[category] || '#E88FAC'
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
        <span style={{ fontSize: '12px', color: '#4a4a4a' }}>{tag}</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '28px', textAlign: 'right' }}>{weight}</span>
      </div>
      <div style={{ height: '4px', background: 'rgba(0,0,0,0.04)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${weight}%`, background: color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

function MusicDnaPanel({ creator, creatorId, onUpdate }) {
  const [inputType, setInputType] = useState('spotify_playlist')
  const [rawInput, setRawInput] = useState(creator?.musicDnaInput || '')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const dna = creator?.musicDnaProcessed || null

  async function handleProcess() {
    if (!rawInput.trim()) return
    setProcessing(true)
    setError('')
    try {
      const res = await fetch('/api/admin/music/process-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId, inputType, rawInput: rawInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to process')
      onUpdate?.(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setProcessing(false)
    }
  }

  const typeOptions = [
    ['spotify_playlist', 'Spotify Playlist'],
    ['text_list', 'Text List'],
    ['apple_music', 'Apple Music'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Input section */}
      <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)', padding: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Music DNA Input</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          {typeOptions.map(([value, label]) => (
            <button key={value} onClick={() => setInputType(value)}
              style={{
                padding: '5px 12px', fontSize: '12px', fontWeight: inputType === value ? 600 : 400,
                background: inputType === value ? '#FFF0F3' : '#fafafa',
                color: inputType === value ? '#E88FAC' : '#999',
                border: inputType === value ? '1px solid #E88FAC' : '1px solid rgba(0,0,0,0.06)',
                borderRadius: '6px', cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>
        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder={inputType === 'spotify_playlist' ? 'Paste Spotify playlist URL...' : inputType === 'text_list' ? 'One song per line: Artist - Song Title' : 'Paste Apple Music playlist URL...'}
          style={{
            width: '100%', minHeight: '80px', padding: '10px', fontSize: '13px',
            border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', resize: 'vertical',
            fontFamily: 'inherit', background: '#fafafa', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          <button onClick={handleProcess} disabled={processing || !rawInput.trim()}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
              background: processing ? '#E8C4CC' : '#E88FAC', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: processing ? 'default' : 'pointer',
              opacity: (!rawInput.trim() || processing) ? 0.5 : 1,
            }}>
            {processing ? 'Processing...' : 'Process Music DNA'}
          </button>
          {error && <span style={{ fontSize: '12px', color: '#ef4444' }}>{error}</span>}
        </div>
      </div>

      {/* Processed DNA display */}
      {dna && (
        <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Processed DNA
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', color: '#999' }}>
                {dna.trackCount} tracks · {dna.processedAt ? new Date(dna.processedAt).toLocaleDateString() : ''}
              </span>
              {rawInput.trim() && (
                <button onClick={handleProcess} disabled={processing}
                  style={{
                    padding: '3px 10px', fontSize: '11px', fontWeight: 600,
                    background: processing ? '#f5f5f5' : '#fafafa', color: processing ? '#bbb' : '#666',
                    border: '1px solid rgba(0,0,0,0.08)', borderRadius: '4px',
                    cursor: processing ? 'default' : 'pointer',
                  }}>
                  {processing ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
            </div>
          </div>

          {/* Top genres */}
          {dna.topGenres?.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Top Genres</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {dna.topGenres.map(g => (
                  <span key={g} style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', background: '#F0F4FF', color: '#6B7FE3', border: '1px solid rgba(107,127,227,0.15)' }}>
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Track list */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Tracks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
              {(dna.tracks || []).map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: '4px', background: i % 2 === 0 ? '#fafafa' : 'transparent' }}>
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: '#1a1a1a' }}>{t.track}</span>
                    {t.artist && <span style={{ fontSize: '12px', color: '#999', marginLeft: '6px' }}>— {t.artist}</span>}
                  </div>
                  {t.spotifyUrl && (
                    <a href={t.spotifyUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '10px', color: '#1DB954', textDecoration: 'none', flexShrink: 0 }}>
                      Spotify ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!dna && (
        <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
          No music DNA yet. Paste a playlist URL or song list above and hit Process.
        </div>
      )}
    </div>
  )
}

function TagWeightPanel({ tagWeights }) {
  if (!tagWeights || tagWeights.length === 0) {
    return <div style={{ color: '#555', fontSize: '13px', padding: '12px 0' }}>No tag weights yet — run analysis first.</div>
  }

  const byCategory = {}
  tagWeights.forEach(tw => {
    const cat = tw.category || 'Other'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(tw)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {TAG_CATEGORIES.map(cat => {
        const tags = (byCategory[cat] || []).sort((a, b) => b.weight - a.weight)
        if (!tags.length) return null
        return (
          <div key={cat}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{cat}</div>
            {tags.map(tw => (
              <WeightBar key={tw.tag} tag={tw.tag} weight={tw.weight} category={cat} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function DocumentRow({ doc, isNew }) {
  const typeColors = {
    Audio: '#E88FAC', Transcript: '#60a5fa', PDF: '#fb923c',
    'Meeting Notes': '#34d399', Other: '#999',
  }
  const color = typeColors[doc.fileType] || '#999'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '10px 12px', background: isNew ? '#FFFBEB' : '#ffffff', borderRadius: '8px',
      border: isNew ? '1px solid #FDE68A' : 'none',
      boxShadow: isNew ? 'none' : '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color, background: '#FFF0F3', border: `1px solid ${color}30`, padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>
        {doc.fileType}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</span>
          {isNew && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#d97706', background: '#FEF3C7', border: '1px solid #FDE68A', padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>
              New
            </span>
          )}
        </div>
        {doc.notes && <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{doc.notes}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {doc.hasExtractedText && (
          <span style={{ fontSize: '11px', color: '#22c55e' }}>Text extracted</span>
        )}
        {!doc.hasExtractedText && doc.analysisStatus === 'Pending' && (
          <span style={{ fontSize: '11px', color: '#f59e0b' }}>Pending extraction</span>
        )}
        <span style={{ fontSize: '11px', color: '#555' }}>{doc.uploadDate || '—'}</span>
      </div>
    </div>
  )
}

function UploadModal({ creator, onClose, onUploaded }) {
  const [fileType, setFileType] = useState('Audio')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const fileRef = useRef()

  const submit = async () => {
    if (!file) { setError('Please select a file.'); return }
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      // Step 1: get a short-lived Dropbox token + upload path from the server
      const tokenRes = await fetch(`/api/admin/creator-profile/upload-token?creatorName=${encodeURIComponent(creator.name || creator.aka)}`)
      const tokenData = await tokenRes.json()
      if (!tokenRes.ok) throw new Error(tokenData.error || 'Failed to get upload token')
      const { accessToken, namespaceId, uploadPathPrefix } = tokenData
      const dropboxPath = `${uploadPathPrefix}/${file.name}`

      // Step 2: upload directly to Dropbox from the browser (bypasses Vercel body limit)
      const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true, mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: namespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error_summary || 'Dropbox upload failed')
      const storedPath = uploadData.path_display || dropboxPath

      // Step 3: register the Airtable record (lightweight JSON, no file)
      const res = await fetch('/api/admin/creator-profile/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, fileType, notes, fileName: file.name, dropboxPath: storedPath }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to register document')
      setResult({ ...data, fileName: file.name })
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px', padding: '28px', width: '480px', maxWidth: '95vw' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '20px' }}>
          Upload Document — {creator.name || creator.aka}
        </div>

        {result ? (
          <div>
            <div style={{ color: '#22c55e', fontSize: '14px', marginBottom: '12px' }}>
              Uploaded successfully.{result.isAudio ? ' Audio will be transcribed when you run analysis.' : ''}
            </div>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '20px' }}>{result.fileName}</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setResult(null); setFile(null); setNotes('') }}
                style={{ flex: 1, background: '#FFF0F3', color: '#1a1a1a', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Upload Another
              </button>
              <button onClick={() => { onUploaded(); onClose() }}
                style={{ flex: 1, background: '#E88FAC', color: '#1a1a1a', border: 'none', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>File Type</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {['Audio', 'Transcript', 'PDF', 'Meeting Notes', 'Other'].map(t => (
                  <button key={t} onClick={() => setFileType(t)}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                      background: fileType === t ? '#E88FAC' : '#FFF0F3',
                      color: fileType === t ? '#fff' : '#888',
                      border: fileType === t ? '1px solid #E88FAC' : '1px solid #E8C4CC',
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>File</label>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: '1px dashed #E8C4CC', borderRadius: '8px', padding: '20px', textAlign: 'center',
                  cursor: 'pointer', background: file ? '#dcfce7' : '#FFF5F7', color: file ? '#16a34a' : '#999', fontSize: '13px', fontWeight: file ? 600 : 400,
                }}>
                {file ? file.name : 'Click to select a file'}
              </div>
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>Notes (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Onboarding call Jan 2026"
                style={{ width: '100%', background: '#FFF5F7', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '8px 10px', color: '#1a1a1a', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>}

            {fileType === 'Audio' && (
              <div style={{ fontSize: '11px', color: '#999', marginBottom: '16px', padding: '8px 10px', background: '#FFF5F7', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '6px' }}>
                Audio uploads directly to Dropbox. Whisper transcription runs when you hit "Run Analysis."
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={onClose}
                style={{ flex: 1, background: '#FFF0F3', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Cancel
              </button>
              <button onClick={submit} disabled={uploading || !file}
                style={{
                  flex: 2, background: uploading ? '#E8C4CC' : '#E88FAC', color: '#1a1a1a', border: 'none',
                  borderRadius: '6px', padding: '8px', cursor: uploading || !file ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 600, opacity: !file ? 0.5 : 1,
                }}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Earnings Panel ──────────────────────────────────────────────────────────

const TYPE_COLORS = {
  'Tip': '#E88FAC',
  'Subscription': '#60a5fa',
  'Recurring subscription': '#60a5fa',
  'Payment for message': '#fb923c',
}
const TYPE_LABELS = { 'Payment for message': 'Messages', 'Recurring subscription': 'Subscription' }
const typeLabel = t => TYPE_LABELS[t] || t

const PERIOD_PRESETS = [
  { key: 'last30', label: 'Last 30 Days', days: 30 },
  { key: 'last90', label: 'Last 90 Days', days: 90 },
  { key: 'mtd', label: 'MTD' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'qtd', label: 'This Quarter' },
  { key: 'lastQuarter', label: 'Last Quarter' },
  { key: 'ytd', label: 'YTD' },
  { key: 'last365', label: 'Last 365 Days' },
  { key: 'all', label: 'All Time' },
]

function getPeriodRange(key) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (key) {
    case 'last30': { const d = new Date(today); d.setDate(d.getDate() - 30); return [d, today] }
    case 'last90': { const d = new Date(today); d.setDate(d.getDate() - 90); return [d, today] }
    case 'mtd': return [new Date(now.getFullYear(), now.getMonth(), 1), today]
    case 'lastMonth': { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return [s, e] }
    case 'qtd': { const q = Math.floor(now.getMonth() / 3) * 3; return [new Date(now.getFullYear(), q, 1), today] }
    case 'lastQuarter': { const q = Math.floor(now.getMonth() / 3) * 3; const s = new Date(now.getFullYear(), q - 3, 1); const e = new Date(now.getFullYear(), q, 0); return [s, e] }
    case 'ytd': return [new Date(now.getFullYear(), 0, 1), today]
    case 'last365': { const d = new Date(today); d.setDate(d.getDate() - 365); return [d, today] }
    case 'all': return [null, null]
    default: return [null, null]
  }
}

// ── SVG Chart ───────────────────────────────────────────────────────────────

const CHART_W = 900, CHART_H = 280
const CP = { t: 25, r: 55, b: 40, l: 10 }
const chartW = CHART_W - CP.l - CP.r, chartH = CHART_H - CP.t - CP.b

function fmtChartDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m)-1]} ${String(parseInt(d)).padStart(2, '0')}, ${y.slice(2)}`
}

function fmtChartMoney(v) {
  return '$' + Math.round(v).toLocaleString('en-US')
}

function buildMonotonePath(pts) {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`
  const n = pts.length
  const slopes = []
  for (let i = 0; i < n; i++) {
    if (i === 0) slopes.push((pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0] || 1))
    else if (i === n - 1) slopes.push((pts[n-1][1] - pts[n-2][1]) / (pts[n-1][0] - pts[n-2][0] || 1))
    else {
      const d0 = (pts[i][1] - pts[i-1][1]) / (pts[i][0] - pts[i-1][0] || 1)
      const d1 = (pts[i+1][1] - pts[i][1]) / (pts[i+1][0] - pts[i][0] || 1)
      slopes.push(d0 * d1 <= 0 ? 0 : (d0 + d1) / 2)
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i+1][0] - pts[i][0]) / 5
    d += `C${(pts[i][0]+dx).toFixed(1)},${(pts[i][1]+slopes[i]*dx).toFixed(1)},${(pts[i+1][0]-dx).toFixed(1)},${(pts[i+1][1]-slopes[i+1]*dx).toFixed(1)},${pts[i+1][0].toFixed(1)},${pts[i+1][1].toFixed(1)}`
  }
  return d
}

function RevenueChart({ dailyData, allDailyData, typeFilter, pctChange, milestones }) {
  const [hover, setHover] = useState(null)
  const [scaleMode, setScaleMode] = useState('fit') // 'fit' | 'relative'
  const svgRef = useRef(null)

  const chartData = useMemo(() => {
    return dailyData.map(d => {
      let val = d.net
      if (typeFilter !== 'all') {
        val = d.byType?.[typeFilter] || 0
        if (typeFilter === 'Subscription') val += d.byType?.['Recurring subscription'] || 0
      }
      return { date: d.date, net: val, gross: d.gross || 0, txnCount: d.txnCount || 0 }
    })
  }, [dailyData, typeFilter])

  if (chartData.length === 0) return null

  // Summary for header
  const totalNet = chartData.reduce((s, d) => s + d.net, 0)
  const totalGross = chartData.reduce((s, d) => s + d.gross, 0)

  // Compute all-time max for relative mode
  const allTimeMax = useMemo(() => {
    const source = allDailyData || dailyData
    let max = 0
    for (const d of source) {
      let val = typeFilter !== 'all' ? (d.byType?.[typeFilter] || 0) : d.net
      if (typeFilter === 'Subscription') val += d.byType?.['Recurring subscription'] || 0
      if (val > max) max = val
    }
    return max
  }, [allDailyData, dailyData, typeFilter])

  // Pick max based on scale mode
  const visibleMax = Math.max(...chartData.map(d => d.net), 1)
  const rawMax = scaleMode === 'relative' ? Math.max(allTimeMax, 1) : visibleMax

  // Round up to nice number for consistent grid
  function niceMax(v) {
    const mag = Math.pow(10, Math.floor(Math.log10(v)))
    const norm = v / mag
    if (norm <= 1.5) return 1.5 * mag
    if (norm <= 2) return 2 * mag
    if (norm <= 3) return 3 * mag
    if (norm <= 5) return 5 * mag
    if (norm <= 7.5) return 7.5 * mag
    return 10 * mag
  }
  const maxEarnings = niceMax(rawMax * 1.05)

  // Fixed 4 grid lines
  const GRID_COUNT = 4
  const eSteps = []
  for (let i = 1; i <= GRID_COUNT; i++) eSteps.push(Math.round(maxEarnings * (i / GRID_COUNT)))

  const CW = CHART_W, CH = CHART_H
  const pad = { t: 10, r: 60, b: 25, l: 35 }
  const cw = CW - pad.l - pad.r, ch = CH - pad.t - pad.b

  const px = (i) => pad.l + (i / Math.max(chartData.length - 1, 1)) * cw
  const pyE = (v) => pad.t + ch - (v / maxEarnings) * ch

  // Earnings line + area
  const earningsPoints = chartData.map((d, i) => [px(i), pyE(d.net)])
  const earningsPath = buildMonotonePath(earningsPoints)
  const earningsArea = earningsPath + `L${(pad.l + cw).toFixed(1)},${pad.t + ch}L${pad.l},${pad.t + ch}Z`

  // X-axis labels (4-5 evenly spaced)
  const xCount = Math.min(5, chartData.length)
  const xLabels = []
  for (let j = 0; j < xCount; j++) {
    const pos = j / (xCount - 1)
    const idx = Math.round(pos * (chartData.length - 1))
    xLabels.push({ pos, label: fmtChartDate(chartData[idx]?.date) })
  }

  const onMove = useCallback((e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * CW
    const i = Math.round(((mx - pad.l) / cw) * (chartData.length - 1))
    if (i < 0 || i >= chartData.length) { setHover(null); return }
    const d = chartData[i]
    setHover({ i, cx: px(i), cyE: pyE(d.net), net: d.net, date: d.date })
  }, [chartData, maxEarnings])

  const fmtM = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div>
      <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${CW} ${CH}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair', display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchMove={e => { const t = e.touches[0]; if (t) onMove({ clientX: t.clientX }) }}
        onTouchEnd={() => setHover(null)}>
        <defs>
          <linearGradient id="earningsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(232,143,172,0.18)" />
            <stop offset="100%" stopColor="rgba(232,143,172,0.01)" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {eSteps.map(v => <line key={v} x1={pad.l} x2={pad.l + cw} y1={pyE(v)} y2={pyE(v)} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />)}
        {/* Baseline at zero */}
        <line x1={pad.l} x2={pad.l + cw} y1={pyE(0)} y2={pyE(0)} stroke="rgba(0,0,0,0.05)" strokeWidth={1} />

        {/* Earnings area fill */}
        <path d={earningsArea} fill="url(#earningsGrad)" />

        {/* Earnings line */}
        <path d={earningsPath} fill="none" stroke="#E88FAC" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />


        {/* Milestone lines */}
        {milestones?.map((m, idx) => {
          const mIdx = chartData.findIndex(d => d.date === m.date)
          if (mIdx < 0) return null
          const mx = px(mIdx)
          return (
            <g key={idx}>
              <line x1={mx} x2={mx} y1={pad.t} y2={pad.t + ch} stroke="rgba(232,143,172,0.45)" strokeWidth={1.5} strokeDasharray="6,4" />
              <text x={mx} y={pad.t - 4} textAnchor="middle" fill="#E88FAC" fontSize={9} fontWeight={600}>{m.label}</text>
            </g>
          )
        })}

        {/* Y labels — earnings (right) */}
        {eSteps.map(v => <text key={`e${v}`} x={pad.l + cw + 6} y={pyE(v) + 4} fill="#999" fontSize={10} fontFamily="system-ui">{fmtChartMoney(v)}</text>)}


        {/* X labels */}
        {xLabels.map(({ pos, label }, i) => (
          <text key={i} x={pad.l + pos * cw} y={CH - 8} textAnchor="middle" fill="#aaa" fontSize={8} fontFamily="system-ui">{label}</text>
        ))}

        {/* Hover guide line (stays in SVG) */}
        {hover && (
          <line x1={hover.cx} x2={hover.cx} y1={pad.t} y2={pad.t + ch} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
        )}
      </svg>

      {/* Hover dot + tooltip — HTML overlay for smooth transitions */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: hover ? 1 : 0, transition: 'opacity 0.15s ease',
      }}>
        {hover && (() => {
          // Convert SVG coords to percentages
          const dotLeft = `${(hover.cx / CW) * 100}%`
          const dotTop = `${(hover.cyE / CH) * 100}%`
          const ttAbove = hover.cyE > CH * 0.35
          const fmtDate = (d) => {
            if (!d) return ''
            const [y,m,day] = d.split('-')
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y}`
          }
          return (<>
            {/* Dot */}
            <div style={{
              position: 'absolute', left: dotLeft, top: dotTop,
              width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px',
              borderRadius: '50%', background: '#E88FAC', border: '2px solid #fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              transform: 'scale(1)', transition: 'left 0.08s ease, top 0.08s ease',
              animation: 'dotPulse 0.2s ease-out',
            }} />
            {/* Tooltip */}
            <div style={{
              position: 'absolute',
              left: `clamp(10px, calc(${dotLeft} - 70px), calc(100% - 150px))`,
              top: ttAbove ? `calc(${dotTop} - 56px)` : `calc(${dotTop} + 16px)`,
              background: '#fff', borderRadius: '8px', padding: '8px 14px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)', border: '1px solid rgba(0,0,0,0.06)',
              transition: 'left 0.08s ease, top 0.08s ease, opacity 0.12s ease',
              whiteSpace: 'nowrap',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '2px' }}>{fmtDate(hover.date)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#E88FAC' }} />
                <span style={{ fontSize: '11px', color: '#999' }}>Earnings</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', marginLeft: 'auto' }}>{fmtM(hover.net)}</span>
              </div>
            </div>
          </>)
        })()}
      </div>
      </div>
    </div>
  )
}

// ── Whale Row (expandable) ──────────────────────────────────────────────────

function WhaleRow({ whale: w, index: i, fmtMoney }) {
  const [expanded, setExpanded] = useState(false)
  const [miniHover, setMiniHover] = useState(null)
  const miniSvgRef = useRef(null)
  const fullTimeline = w.timeline || []

  // Center the investigation zone in the visible timeline
  const timeline = useMemo(() => {
    if (!w.inspectFrom || !w.inspectTo || fullTimeline.length === 0) return fullTimeline
    const inspStart = fullTimeline.findIndex(t => t.week >= w.inspectFrom)
    const inspEnd = fullTimeline.findIndex(t => t.week >= w.inspectTo)
    if (inspStart < 0) return fullTimeline
    const end = inspEnd >= 0 ? inspEnd : Math.min(inspStart + 30, fullTimeline.length - 1)
    const inspCenter = Math.floor((inspStart + end) / 2)
    const inspWidth = end - inspStart
    // Show 3x the investigation zone width on each side (or at least 60 days)
    const padding = Math.max(inspWidth * 3, 60)
    const viewStart = Math.max(0, inspCenter - padding)
    const viewEnd = Math.min(fullTimeline.length - 1, inspCenter + padding)
    return fullTimeline.slice(viewStart, viewEnd + 1)
  }, [fullTimeline, w.inspectFrom, w.inspectTo])

  // Mini chart dimensions
  const MW = 700, MH = 120
  const MP = { t: 15, r: 10, b: 20, l: 10 }
  const mW = MW - MP.l - MP.r, mH = MH - MP.t - MP.b

  const maxSpend = Math.max(...timeline.map(t => t.spend), 1)
  const mpx = (idx) => MP.l + (idx / Math.max(timeline.length - 1, 1)) * mW
  const mpy = (v) => MP.t + mH - (v / maxSpend) * mH

  // Build smooth path for mini chart
  const miniPoints = timeline.map((t, idx) => [mpx(idx), mpy(t.spend)])
  let miniPath = ''
  if (miniPoints.length >= 2) {
    const pts = miniPoints
    const n = pts.length
    const slopes = []
    for (let j = 0; j < n; j++) {
      if (j === 0) slopes.push((pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0] || 1))
      else if (j === n - 1) slopes.push((pts[n-1][1] - pts[n-2][1]) / (pts[n-1][0] - pts[n-2][0] || 1))
      else {
        const d0 = (pts[j][1] - pts[j-1][1]) / (pts[j][0] - pts[j-1][0] || 1)
        const d1 = (pts[j+1][1] - pts[j][1]) / (pts[j+1][0] - pts[j][0] || 1)
        slopes.push(d0 * d1 <= 0 ? 0 : (d0 + d1) / 2)
      }
    }
    miniPath = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
    for (let j = 0; j < n - 1; j++) {
      const dx = (pts[j+1][0] - pts[j][0]) / 5
      miniPath += `C${(pts[j][0]+dx).toFixed(1)},${(pts[j][1]+slopes[j]*dx).toFixed(1)},${(pts[j+1][0]-dx).toFixed(1)},${(pts[j+1][1]-slopes[j+1]*dx).toFixed(1)},${pts[j+1][0].toFixed(1)},${pts[j+1][1].toFixed(1)}`
    }
  }
  const miniArea = miniPath ? miniPath + `L${(MP.l + mW).toFixed(1)},${MP.t + mH}L${MP.l},${MP.t + mH}Z` : ''

  // Find inspect zone indices (one month after peak)
  const inspectStartIdx = w.inspectFrom ? timeline.findIndex(t => t.week >= w.inspectFrom) : -1
  const inspectEndIdx = w.inspectTo ? timeline.findIndex(t => t.week >= w.inspectTo) : -1
  const inspectEnd = inspectEndIdx >= 0 ? inspectEndIdx : (inspectStartIdx >= 0 ? Math.min(inspectStartIdx + 30, timeline.length - 1) : -1)

  return (
    <div style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
      {/* Summary row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'grid', gridTemplateColumns: '24px 1fr 140px 100px 100px 100px 90px 70px', padding: '8px 16px',
          fontSize: '12px', cursor: 'pointer',
          background: expanded ? '#FFF8F8' : i % 2 === 0 ? '#fff' : '#FAFAFA',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = '#FAFAFA' }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#FAFAFA' }}
      >
        <span style={{ color: '#ccc', fontSize: '10px', lineHeight: '20px' }}>{expanded ? '▼' : '▶'}</span>
        <div>
          <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{w.fan}</span>
          {w.username && <span style={{ color: '#E88FAC', fontSize: '11px', marginLeft: '6px' }}>@{w.username}</span>}
        </div>
        <span style={{ color: '#666', fontSize: '11px' }}>{w.peakStart} → {w.peakEnd}</span>
        <span style={{ textAlign: 'right', fontWeight: 600, color: '#1a1a1a' }}>{fmtMoney(w.peak30)}</span>
        <span style={{ textAlign: 'right', color: w.last30 === 0 ? '#DC2626' : '#f59e0b', fontWeight: 600 }}>{fmtMoney(w.last30)}</span>
        <span style={{ textAlign: 'right', color: '#666' }}>{fmtMoney(w.lifetime)}</span>
        <span style={{ textAlign: 'right', color: '#999', fontSize: '11px' }}>{w.lastTxnDate}</span>
        <span style={{ textAlign: 'center' }}>
          <span style={{
            background: w.status === 'gone' ? '#FEE2E2' : '#FEF3C7',
            color: w.status === 'gone' ? '#DC2626' : '#D97706',
            padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
          }}>{w.status === 'gone' ? 'GONE' : 'DROP'}</span>
        </span>
      </div>

      {/* Expanded: spending graph + inspect zone */}
      {expanded && timeline.length > 0 && (
        <div style={{ padding: '12px 16px 16px 40px', background: '#FEFBFB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#999' }}>Weekly spending — <span style={{ color: '#E88FAC', fontWeight: 600 }}>peak period</span> and <span style={{ color: '#DC2626', fontWeight: 600 }}>investigation zone</span></div>
            {w.inspectFrom && w.inspectTo && (
              <div style={{ fontSize: '11px', color: '#DC2626', fontWeight: 500 }}>
                Investigate DMs: {w.inspectFrom} → {w.inspectTo}
              </div>
            )}
          </div>
          <svg ref={miniSvgRef} viewBox={`0 0 ${MW} ${MH}`}
            style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair' }}
            onMouseMove={e => {
              const svg = miniSvgRef.current
              if (!svg) return
              const rect = svg.getBoundingClientRect()
              const mx = ((e.clientX - rect.left) / rect.width) * MW
              const idx = Math.round(((mx - MP.l) / mW) * (timeline.length - 1))
              if (idx < 0 || idx >= timeline.length) { setMiniHover(null); return }
              const t = timeline[idx]
              setMiniHover({ idx, cx: mpx(idx), cy: mpy(t.spend), spend: t.spend, date: t.week })
            }}
            onMouseLeave={() => setMiniHover(null)}>
            <defs>
              <linearGradient id={`whaleGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(232,143,172,0.2)" />
                <stop offset="100%" stopColor="rgba(232,143,172,0.02)" />
              </linearGradient>
            </defs>

            {/* Investigation zone */}
            {inspectStartIdx >= 0 && inspectEnd >= 0 && (
              <rect x={mpx(inspectStartIdx)} y={MP.t} width={mpx(inspectEnd) - mpx(inspectStartIdx)} height={mH}
                fill="rgba(220,38,38,0.06)" stroke="rgba(220,38,38,0.15)" strokeWidth={1} strokeDasharray="4,3" rx={4} />
            )}

            {/* Peak period highlight */}
            {w.peakStart && (() => {
              const peakStartIdx = timeline.findIndex(t => t.week >= w.peakStart)
              const peakEndIdx = w.peakEnd ? timeline.findIndex(t => t.week >= w.peakEnd) : peakStartIdx + 4
              if (peakStartIdx >= 0) {
                return <rect x={mpx(peakStartIdx)} y={MP.t} width={mpx(Math.min(peakEndIdx, timeline.length - 1)) - mpx(peakStartIdx)} height={mH}
                  fill="rgba(232,143,172,0.08)" stroke="rgba(232,143,172,0.2)" strokeWidth={1} rx={4} />
              }
              return null
            })()}

            {/* Area + Line */}
            {miniArea && <path d={miniArea} fill={`url(#whaleGrad${i})`} />}
            {miniPath && <path d={miniPath} fill="none" stroke="#E88FAC" strokeWidth={1} />}

            {/* X labels */}
            {timeline.filter((_, idx) => idx % Math.max(Math.floor(timeline.length / 6), 1) === 0).map((t, idx) => {
              const realIdx = timeline.indexOf(t)
              return <text key={idx} x={mpx(realIdx)} y={MH - 3} textAnchor="middle" fill="#999" fontSize={9}>{t.week}</text>
            })}

            {/* Hover interaction */}
            {miniHover && (() => {
              const ttW = 130, ttH = 38
              const ttX = Math.max(5, Math.min(miniHover.cx - ttW/2, MW - ttW - 5))
              const ttY = miniHover.cy > ttH + 25 ? miniHover.cy - ttH - 10 : miniHover.cy + 14
              return (
                <g>
                  <line x1={miniHover.cx} x2={miniHover.cx} y1={MP.t} y2={MP.t + mH} stroke="rgba(0,0,0,0.1)" strokeWidth={1} />
                  <circle cx={miniHover.cx} cy={miniHover.cy} r={3.5} fill="#E88FAC" stroke="#fff" strokeWidth={2} />
                  <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={5} fill="#fff" stroke="rgba(0,0,0,0.08)" strokeWidth={1} style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.06))' }} />
                  <text x={ttX + ttW/2} y={ttY + 15} textAnchor="middle" fill="#1a1a1a" fontSize={10} fontWeight={600}>{miniHover.date}</text>
                  <text x={ttX + ttW/2} y={ttY + 29} textAnchor="middle" fill="#E88FAC" fontSize={11} fontWeight={700}>{fmtMoney(miniHover.spend)}</text>
                </g>
              )
            })()}
          </svg>
        </div>
      )}
    </div>
  )
}

// ── Going Cold Row ─────────────────────────────────────────────────────────

function GoingColdRow({ alert: a, index: i, fmtMoney, creatorName, creatorRecordId, allTxns }) {
  const [expanded, setExpanded] = useState(false)
  const [chatFile, setChatFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [showBrief, setShowBrief] = useState(false)
  const [loadedFromAirtable, setLoadedFromAirtable] = useState(false)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null) // { success: true } or { error: '...' }
  const chatFileRef = useRef(null)
  const urgColors = { critical: { bg: '#FEE2E2', text: '#DC2626' }, high: { bg: '#FFF3CD', text: '#D97706' }, warning: { bg: '#FEF9C3', text: '#A16207' } }

  // Load existing analysis from Airtable when expanded
  useEffect(() => {
    if (!expanded || analysis || loadedFromAirtable) return
    setLoadedFromAirtable(true)
    fetch(`/api/admin/creator-earnings/analyze-chat?fan=${encodeURIComponent(a.fan)}&creator=${encodeURIComponent(creatorName || '')}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.analysis) setAnalysis(data) })
      .catch(() => {})
  }, [expanded])

  function buildFormData() {
    const formData = new FormData()
    formData.append('file', chatFile)
    formData.append('fanName', a.fan)
    formData.append('fanUsername', a.username || '')
    formData.append('lifetime', a.lifetime)
    formData.append('medianGap', a.medianGap)
    formData.append('currentGap', a.currentGap)
    formData.append('rolling30', a.rolling30)
    formData.append('monthlyAvg90', a.monthlyAvg90)
    formData.append('lastPurchaseDate', a.lastPurchaseDate || '')
    formData.append('creatorName', creatorName || '')
    formData.append('creatorRecordId', creatorRecordId || '')
    // Compute daily spend for this fan from transaction data
    if (allTxns) {
      const dailySpend = {}
      for (const t of allTxns) {
        if ((t.displayName || '') === a.fan || (t.ofUsername || '') === a.username) {
          dailySpend[t.date] = (dailySpend[t.date] || 0) + (t.net || 0)
        }
      }
      const timeline = Object.entries(dailySpend)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, spend]) => `${date}: $${spend.toFixed(2)}`)
        .join('\n')
      if (timeline) formData.append('spendingTimeline', timeline)
    }
    return formData
  }

  async function handleAnalyze() {
    if (!chatFile) return
    setAnalyzing(true)
    setAnalysisError(null)
    try {
      const res = await fetch('/api/admin/creator-earnings/analyze-chat', { method: 'POST', body: buildFormData() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setAnalysis(data)
      // Don't clear chatFile — keep it for re-analyze
    } catch (e) {
      setAnalysisError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }
  async function handleSendToTelegram() {
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch('/api/admin/whale-alert/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorName,
          creatorRecordId,
          alert: a,
          analysis: analysis ? { analysis: analysis.analysis, managerBrief: analysis.managerBrief } : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setSendResult({ success: true, tracked: true })
    } catch (e) {
      setSendResult({ error: e.message })
    } finally {
      setSending(false)
    }
  }

  const uc = urgColors[a.urgency] || urgColors.warning

  return (
    <div style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 90px 100px 90px 70px', padding: '8px 16px',
          fontSize: '12px', cursor: 'pointer',
          background: expanded ? '#FFFBF5' : i % 2 === 0 ? '#fff' : '#FAFAFA',
        }}
      >
        <span style={{ color: '#ccc', fontSize: '10px', lineHeight: '20px' }}>{expanded ? '▼' : '▶'}</span>
        <div>
          <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{a.fan}</span>
          {a.username && <span style={{ color: '#E88FAC', fontSize: '11px', marginLeft: '6px' }}>@{a.username}</span>}
        </div>
        <span style={{ textAlign: 'right', color: '#666' }}>{a.medianGap}d</span>
        <span style={{ textAlign: 'right', fontWeight: 600, color: a.currentGap > a.medianGap * 3 ? '#DC2626' : '#EA580C' }}>{a.currentGap}d <span style={{ fontSize: '10px', color: '#999', fontWeight: 400 }}>({a.gapRatio}x)</span></span>
        <span style={{ textAlign: 'right', color: a.rolling30 === 0 ? '#DC2626' : '#666', fontWeight: a.rolling30 === 0 ? 600 : 400 }}>{fmtMoney(a.rolling30)}</span>
        <span style={{ textAlign: 'right', color: '#666' }}>{fmtMoney(a.monthlyAvg90)}</span>
        <span style={{ textAlign: 'right', color: '#666' }}>{fmtMoney(a.lifetime)}</span>
        <span style={{ textAlign: 'center' }}>
          <span style={{ background: uc.bg, color: uc.text, padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 600, textTransform: 'uppercase' }}>{a.urgency}</span>
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '12px 16px 16px 40px', background: '#FFFBF5' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Trigger</div>
              <div style={{ fontSize: '12px', color: '#1a1a1a' }}>
                {a.triggerReason === 'gap' && `Purchase gap ${a.currentGap}d exceeds ${a.medianGap * 2}d threshold (2× median)`}
                {a.triggerReason === 'spend_drop' && `30-day spend dropped to ${Math.round(a.spendDropRatio * 100)}% of normal`}
                {a.triggerReason === 'both' && `Gap ${a.gapRatio}× overdue + spending at ${Math.round(a.spendDropRatio * 100)}% of normal`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Last Purchase</div>
              <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{a.lastPurchaseDate}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Total Purchases</div>
              <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{a.totalPurchases} sessions</div>
            </div>
          </div>

          {/* Monthly spend mini bars */}
          {a.monthlyHistory && a.monthlyHistory.length > 0 && (() => {
            const maxMo = Math.max(...a.monthlyHistory.map(m => m.spend), 1)
            const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            return (
              <div>
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '16px' }}>Monthly Spending (last 6 months)</div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '60px' }}>
                  {a.monthlyHistory.map(m => {
                    const h = Math.max((m.spend / maxMo) * 50, m.spend > 0 ? 3 : 0)
                    const moNum = parseInt(m.month.slice(5))
                    return (
                      <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                        <div style={{ fontSize: '9px', color: '#666', marginBottom: '2px' }}>{m.spend > 0 ? fmtMoney(m.spend) : ''}</div>
                        <div style={{ width: '100%', maxWidth: '40px', height: h + 'px', background: m.spend === 0 ? '#F3F4F6' : m.spend < a.monthlyAvg90 * 0.25 ? '#FECACA' : '#E88FAC', borderRadius: '3px 3px 0 0', minHeight: '2px' }} />
                        <div style={{ fontSize: '9px', color: '#999', marginTop: '3px' }}>{moNames[moNum]}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Send to Chat Manager button */}
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => { setSendResult(null); setShowSendModal(true) }}
              style={{
                background: '#1a1a1a', border: 'none', borderRadius: '6px',
                padding: '7px 14px', fontSize: '12px', color: '#fff', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span style={{ fontSize: '14px' }}>&#9993;</span> Send to Chat Manager
            </button>
            {sendResult?.success && <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 500 }}>&#10003; Sent &amp; tracked</span>}
            {sendResult?.error && <span style={{ fontSize: '11px', color: '#DC2626' }}>{sendResult.error}</span>}
          </div>

          {/* Chat analysis section */}
          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px' }}>
            <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>
              Chat Analysis {a.lifetime >= 1000 ? '(Deep Dive)' : '(Quick Snapshot)'}
            </div>

            {!analysis && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  ref={chatFileRef}
                  type="file"
                  accept=".html,.htm"
                  onChange={e => { if (e.target.files[0]) { setChatFile(e.target.files[0]); setAnalysisError(null) }}}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => chatFileRef.current?.click()}
                  style={{
                    background: chatFile ? '#F0FDF4' : '#F8FAFC', border: `1px solid ${chatFile ? '#BBF7D0' : '#E2E8F0'}`,
                    borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                    color: chatFile ? '#166534' : '#64748B',
                  }}
                >
                  {chatFile ? `✓ ${chatFile.name}` : 'Upload OF chat HTML'}
                </button>
                {chatFile && (
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    style={{
                      background: '#EA580C', border: 'none', borderRadius: '6px',
                      padding: '6px 14px', fontSize: '12px', color: '#fff', fontWeight: 600,
                      cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.6 : 1,
                    }}
                  >
                    {analyzing ? 'Analyzing...' : 'Analyze Conversation'}
                  </button>
                )}
                <span style={{ fontSize: '11px', color: '#bbb' }}>
                  Save chat page as HTML → upload here
                </span>
              </div>
            )}

            {analysisError && (
              <div style={{ marginTop: '8px', padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#DC2626' }}>
                {analysisError}
              </div>
            )}

            {analysis && (
              <div style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '11px', color: '#999' }}>
                    <span>{analysis.messageCount} msgs ({analysis.fanMessages} fan / {analysis.creatorMessages} creator)</span>
                    {analysis.managerBrief && (
                      <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                        <button onClick={() => setShowBrief(false)} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: !showBrief ? '#EA580C' : 'transparent', color: !showBrief ? '#fff' : '#666' }}>Full</button>
                        <button onClick={() => setShowBrief(true)} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: showBrief ? '#EA580C' : 'transparent', color: showBrief ? '#fff' : '#666' }}>Manager Brief</button>
                      </div>
                    )}
                    {analysis.saved && <span style={{ color: '#22c55e', fontSize: '10px' }}>✓ Saved</span>}
                  </div>
                  {chatFile ? (
                    <button
                      onClick={() => { setAnalysis(null); setShowBrief(false); handleAnalyze() }}
                      disabled={analyzing}
                      style={{ fontSize: '11px', color: '#EA580C', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                    >
                      {analyzing ? 'Re-analyzing...' : 'Re-analyze'}
                    </button>
                  ) : (
                    <button
                      onClick={() => { setAnalysis(null); setShowBrief(false) }}
                      style={{ fontSize: '11px', color: '#999', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Upload new chat
                    </button>
                  )}
                </div>
                <div style={{
                  background: showBrief ? '#F8FAFC' : '#FFFBF5',
                  border: `1px solid ${showBrief ? '#E2E8F0' : '#FED7AA'}`,
                  borderRadius: '8px',
                  padding: '16px 20px', fontSize: '13px', color: '#1a1a1a', lineHeight: '1.7',
                }}>
                  {(() => {
                    const text = showBrief ? (analysis.managerBrief || analysis.analysis) : analysis.analysis
                    const accentColor = showBrief ? '#334155' : '#EA580C'
                    return text.split('\n').map((line, idx) => {
                      const trimmed = line.trim()
                      if (!trimmed) return <div key={idx} style={{ height: '8px' }} />

                      // Section header: line starts with **
                      if (/^\*\*[^*]+\*\*/.test(trimmed)) {
                        const headerMatch = trimmed.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
                        if (headerMatch) {
                          const rest = headerMatch[2]?.replace(/\*\*([^*]+)\*\*/g, '$1') || ''
                          return (
                            <div key={idx} style={{ marginTop: idx > 0 ? '14px' : 0, marginBottom: '4px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{headerMatch[1]}</div>
                              {rest && <div style={{ marginTop: '2px' }}>{rest}</div>}
                            </div>
                          )
                        }
                      }

                      // Numbered item: 1. or 2.
                      if (/^\d+\.\s/.test(trimmed)) {
                        const content = trimmed.replace(/^\d+\.\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                        const numMatch = trimmed.match(/^(\d+)\./)
                        return (
                          <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px', paddingLeft: '4px' }}>
                            <span style={{ color: accentColor, fontWeight: 700, fontSize: '12px', minWidth: '16px' }}>{numMatch[1]}.</span>
                            <span>{content}</span>
                          </div>
                        )
                      }

                      // Bullet point
                      if (/^[-•]\s/.test(trimmed)) {
                        const content = trimmed.replace(/^[-•]\s*/, '')
                        // Handle bold label at start of bullet: **Label**: rest
                        const labelMatch = content.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
                        if (labelMatch) {
                          return (
                            <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px', paddingLeft: '4px' }}>
                              <span style={{ color: '#ccc', marginTop: '2px' }}>•</span>
                              <span><strong style={{ color: '#333' }}>{labelMatch[1]}:</strong> {labelMatch[2]}</span>
                            </div>
                          )
                        }
                        return (
                          <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px', paddingLeft: '4px' }}>
                            <span style={{ color: '#ccc', marginTop: '2px' }}>•</span>
                            <span>{content.replace(/\*\*([^*]+)\*\*/g, (_, t) => t)}</span>
                          </div>
                        )
                      }

                      // Quoted message (in "quotes")
                      const withQuotes = trimmed.replace(/"([^"]+)"/g, (_, q) => `"${q}"`)
                      // Inline bold
                      const withBold = withQuotes.replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                      return <div key={idx} style={{ marginBottom: '2px' }}>{withBold}</div>
                    })
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Send to Chat Manager modal */}
      {showSendModal && (
        <div
          onClick={() => !sending && setShowSendModal(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', padding: '24px', width: '480px',
              maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Send Whale Alert</div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>
              This will generate a PDF and send it to the <strong>{creatorName}</strong> topic in Telegram.
            </div>

            {/* Preview card */}
            <div style={{ background: '#FAFAFA', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{a.fan}</span>
                  {a.username && <span style={{ color: '#E88FAC', fontSize: '12px', marginLeft: '6px' }}>@{a.username}</span>}
                </div>
                <span style={{ background: uc.bg, color: uc.text, padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>{a.urgency}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '12px' }}>
                <div><span style={{ color: '#999' }}>Gap:</span> <strong style={{ color: a.currentGap > a.medianGap * 3 ? '#DC2626' : '#EA580C' }}>{a.currentGap}d</strong> <span style={{ color: '#999' }}>({a.gapRatio}x)</span></div>
                <div><span style={{ color: '#999' }}>Last 30d:</span> <strong>{fmtMoney(a.rolling30)}</strong></div>
                <div><span style={{ color: '#999' }}>Lifetime:</span> <strong>{fmtMoney(a.lifetime)}</strong></div>
              </div>
              {analysis?.managerBrief && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #E5E7EB', fontSize: '12px', color: '#333', lineHeight: '1.5' }}>
                  <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Manager Brief</div>
                  {analysis.managerBrief.split('\n').filter(l => l.trim()).slice(0, 4).map((line, i) => (
                    <div key={i} style={{ marginBottom: '2px' }}>{line.replace(/\*\*([^*]+)\*\*/g, '$1')}</div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ fontSize: '11px', color: '#999', marginBottom: '16px' }}>
              PDF will include: stats, 6-month spend chart{analysis ? ', manager brief, and full analysis' : ''}. {!analysis && <span style={{ color: '#D97706' }}>No chat analysis available — PDF will only contain spending data.</span>}
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSendModal(false)}
                disabled={sending}
                style={{
                  background: '#F3F4F6', border: 'none', borderRadius: '6px',
                  padding: '8px 16px', fontSize: '12px', cursor: 'pointer', color: '#666',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setSending(true)
                  setSendResult(null)
                  try {
                    const res = await fetch('/api/admin/whale-alert/send', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        creatorName,
                        creatorRecordId,
                        alert: a,
                        analysis: analysis ? { analysis: analysis.analysis, managerBrief: analysis.managerBrief } : null,
                      }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Send failed')
                    setSendResult({ success: true, tracked: true })
                    setTimeout(() => setShowSendModal(false), 1500)
                  } catch (e) {
                    setSendResult({ error: e.message })
                  } finally {
                    setSending(false)
                  }
                }}
                disabled={sending}
                style={{
                  background: sending ? '#999' : '#1a1a1a', border: 'none', borderRadius: '6px',
                  padding: '8px 20px', fontSize: '12px', color: '#fff', fontWeight: 600,
                  cursor: sending ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? 'Generating & Sending...' : 'Send PDF to Telegram'}
              </button>
            </div>

            {sendResult?.success && (
              <div style={{ marginTop: '12px', padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '6px', fontSize: '12px', color: '#166534', textAlign: 'center' }}>
                &#10003; Sent to {creatorName} topic &amp; logged in Fan Tracker
              </div>
            )}
            {sendResult?.error && (
              <div style={{ marginTop: '12px', padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#DC2626' }}>
                {sendResult.error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Panel ──────────────────────────────────────────────────────────────

function EarningsPanel({ data, loading, error, onRefresh, creator }) {
  const [period, setPeriod] = useState('last30')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showAllCold, setShowAllCold] = useState(false)
  const [showAllFans, setShowAllFans] = useState(false)
  const [slideDir, setSlideDir] = useState(null) // 'left' | 'right' | null
  const [slideKey, setSlideKey] = useState(0)
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const uploadFileRef = useRef(null)

  // Extract data safely — all hooks must run before any early returns
  const { summary, byType, topFans: allTimeTopFans, transactions: allTxns, dailyData: rawDailyData, goingColdAlerts, goingColdCount, cachedAt } = data || {}
  const dailyData = rawDailyData || []

  // Compute top fans for current period (hook must be before early returns)
  const topFans = useMemo(() => {
    if (!allTxns || !Array.isArray(allTxns) || allTxns.length === 0) return allTimeTopFans || []
    const [ps, pe] = period === 'custom' && customStart && customEnd
      ? [new Date(customStart + 'T00:00:00'), new Date(customEnd + 'T00:00:00')]
      : getPeriodRange(period)
    const fanMap = {}
    for (const t of allTxns) {
      if (ps && pe) {
        const dt = new Date(t.date + ' 12:00:00')
        if (dt < ps || dt > new Date(pe.getTime() + 86400000)) continue
      }
      const key = t.displayName || 'Unknown'
      if (!fanMap[key]) fanMap[key] = { displayName: key, ofUsername: t.ofUsername, totalNet: 0, transactionCount: 0, lastDate: '' }
      fanMap[key].totalNet += t.net
      fanMap[key].transactionCount += 1
      if (!fanMap[key].lastDate || t.date > fanMap[key].lastDate) fanMap[key].lastDate = t.date
    }
    return Object.values(fanMap)
      .filter(f => f.totalNet > 0)
      .sort((a, b) => b.totalNet - a.totalNet)
      .slice(0, 25)
      .map((f, i) => ({ rank: i + 1, ...f }))
  }, [allTxns, period, customStart, customEnd])

  // Early returns AFTER all hooks
  if (loading) return (
    <div style={{ padding: '20px 0' }}>
      {/* Skeleton: period selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[80, 60, 50, 40, 60, 50].map((w, i) => (
          <div key={i} style={{ width: w, height: 28, background: '#F3F4F6', borderRadius: '6px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
      {/* Skeleton: chart area */}
      <div style={{ height: 200, background: '#F9FAFB', borderRadius: '12px', marginBottom: '20px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      {/* Skeleton: going cold rows */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ width: 120, height: 14, background: '#F3F4F6', borderRadius: '4px', marginBottom: '10px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', gap: '12px', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
            <div style={{ width: 120, height: 14, background: '#F3F4F6', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ width: 60, height: 14, background: '#F3F4F6', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ width: 50, height: 14, background: '#F3F4F6', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ width: 70, height: 14, background: '#F3F4F6', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
          </div>
        ))}
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  )
  if (error) return (
    <div style={{ padding: '16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', fontSize: '13px', color: '#DC2626' }}>
      {error}
      <button onClick={onRefresh} style={{ marginLeft: '12px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: '5px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}>Retry</button>
    </div>
  )
  if (!data || data.empty) return (
    <div style={{ color: '#999', fontSize: '13px', padding: '40px 0', textAlign: 'center' }}>
      No sales data found. Upload transactions from the Invoicing → Raw Data Upload tab.
    </div>
  )

  const fmtMoney = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtNum = n => Number(n || 0).toLocaleString()

  // Filter daily data by period
  const [periodStart, periodEnd] = period === 'custom' && customStart && customEnd
    ? [new Date(customStart + 'T00:00:00'), new Date(customEnd + 'T00:00:00')]
    : getPeriodRange(period)
  const filteredDaily = periodStart
    ? dailyData.filter(d => {
        const dt = new Date(d.date + ' 12:00:00')
        return dt >= periodStart && dt <= new Date(periodEnd.getTime() + 86400000)
      })
    : dailyData

  // Compute period summary from filtered daily data
  let periodNet = 0, periodGross = 0, periodCount = 0
  const periodByType = {}
  for (const d of filteredDaily) {
    if (typeFilter === 'all') {
      periodNet += d.net
    } else {
      periodNet += d.byType?.[typeFilter] || 0
    }
    for (const [tp, val] of Object.entries(d.byType || {})) {
      periodByType[tp] = (periodByType[tp] || 0) + val
    }
  }
  // Merge Subscription + Recurring subscription
  if (periodByType['Recurring subscription']) {
    periodByType['Subscription'] = (periodByType['Subscription'] || 0) + periodByType['Recurring subscription']
    delete periodByType['Recurring subscription']
  }
  const periodTypeTotal = Object.values(periodByType).reduce((s, v) => s + v, 0)

  // Compute previous period of same duration for % change
  let prevPeriodNet = 0
  if (periodStart && periodEnd) {
    const durationMs = periodEnd.getTime() - periodStart.getTime()
    const prevEnd = new Date(periodStart.getTime() - 1)
    const prevStart = new Date(prevEnd.getTime() - durationMs)
    for (const d of dailyData) {
      const dt = new Date(d.date + ' 12:00:00')
      if (dt >= prevStart && dt <= new Date(prevEnd.getTime() + 86400000)) {
        if (typeFilter === 'all') prevPeriodNet += d.net
        else prevPeriodNet += d.byType?.[typeFilter] || 0
      }
    }
  }
  const pctChange = prevPeriodNet > 0 ? ((periodNet - prevPeriodNet) / prevPeriodNet) * 100 : null

  // Unique types for filter buttons
  const mergedByType = { ...byType }
  if (mergedByType['Recurring subscription']) {
    mergedByType['Subscription'] = (mergedByType['Subscription'] || 0) + mergedByType['Recurring subscription']
    delete mergedByType['Recurring subscription']
  }
  const allTypes = [...new Set(Object.keys(mergedByType))].filter(t => t !== 'Chargeback')

  return (
    <div>
      {/* Controls bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button onClick={() => {
            const shift = -7
            const [s, e] = periodStart && periodEnd ? [periodStart, periodEnd] : [new Date(Date.now() - 30*86400000), new Date()]
            const ns = new Date(s); ns.setDate(ns.getDate() + shift)
            const ne = new Date(e); ne.setDate(ne.getDate() + shift)
            setCustomStart(ns.toISOString().split('T')[0])
            setCustomEnd(ne.toISOString().split('T')[0])
            setPeriod('custom')
            setSlideDir('right'); setSlideKey(k => k + 1)
            setTimeout(() => setSlideDir(null), 350)
          }} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '13px', color: '#999', lineHeight: 1 }}>‹</button>
          <select value={period} onChange={e => { setPeriod(e.target.value); setSlideDir(null); setShowAllFans(false) }}
            style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
              color: '#1a1a1a', fontSize: '12px', padding: '5px 10px', outline: 'none', cursor: 'pointer',
            }}>
            {PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Custom Range</option>
          </select>
          <button onClick={() => {
            const shift = 7
            const [s, e] = periodStart && periodEnd ? [periodStart, periodEnd] : [new Date(Date.now() - 30*86400000), new Date()]
            const ns = new Date(s); ns.setDate(ns.getDate() + shift)
            const ne = new Date(e); ne.setDate(ne.getDate() + shift)
            if (ne > new Date()) return // don't go past today
            setCustomStart(ns.toISOString().split('T')[0])
            setCustomEnd(ne.toISOString().split('T')[0])
            setPeriod('custom')
            setSlideDir('left'); setSlideKey(k => k + 1)
            setTimeout(() => setSlideDir(null), 350)
          }} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '13px', color: '#999', lineHeight: 1 }}>›</button>
          {period === 'custom' && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '11px', padding: '4px 6px', color: '#1a1a1a', outline: 'none' }} />
              <span style={{ color: '#ccc', fontSize: '11px' }}>→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '11px', padding: '4px 6px', color: '#1a1a1a', outline: 'none' }} />
            </div>
          )}
        </div>
        {/* Type filters + breakdown */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setTypeFilter('all')}
            style={{
              background: typeFilter === 'all' ? '#1a1a1a' : 'transparent',
              color: typeFilter === 'all' ? '#fff' : '#bbb',
              border: typeFilter === 'all' ? '1px solid #1a1a1a' : '1px solid transparent',
              borderRadius: '14px', padding: '2px 10px', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
            }}>All</button>
          {allTypes.map(t => (
            <button key={t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
              style={{
                background: typeFilter === t ? (TYPE_COLORS[t] || '#999') + '18' : 'transparent',
                color: typeFilter === t ? TYPE_COLORS[t] || '#999' : '#bbb',
                border: typeFilter === t ? `1px solid ${TYPE_COLORS[t] || '#999'}` : '1px solid transparent',
                borderRadius: '14px', padding: '2px 10px', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
              }}>
              <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: TYPE_COLORS[t] || '#999', marginRight: '4px' }} />
              {typeLabel(t)}
            </button>
          ))}
          <span style={{ color: '#e5e7eb', margin: '0 2px' }}>|</span>
          {Object.entries(periodByType).sort((a, b) => b[1] - a[1]).map(([type, net]) => (
            <span key={type} style={{ fontSize: '10px', color: '#999' }}>
              {typeLabel(type)}: <strong style={{ color: '#666' }}>{fmtMoney(net)}</strong>
              <span style={{ color: '#ddd' }}> ({periodTypeTotal > 0 ? Math.round((net / periodTypeTotal) * 100) : 0}%)</span>
            </span>
          ))}
          <button onClick={onRefresh} title="Refresh" style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '3px 6px', cursor: 'pointer', fontSize: '11px', color: '#ccc', marginLeft: '4px' }}>↺</button>
          <button
            onClick={() => { setShowUploadPanel(!showUploadPanel); setUploadResult(null); setUploadError(null) }}
            style={{
              background: showUploadPanel ? '#1a1a1a' : 'none',
              color: showUploadPanel ? '#fff' : '#999',
              border: showUploadPanel ? 'none' : '1px solid #e5e7eb',
              borderRadius: '5px', padding: '3px 10px', cursor: 'pointer',
              fontSize: '11px', fontWeight: 600, marginLeft: '4px',
              transition: 'all 0.15s',
            }}
          >
            Update Earnings Data
          </button>
        </div>
      </div>

      {/* Inline upload panel */}
      {showUploadPanel && (
        <div style={{
          background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          padding: '16px', marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>
              Upload OF Statements for {creator?.name || 'this creator'}
            </div>
            <button onClick={() => setShowUploadPanel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#999' }}>×</button>
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '12px', lineHeight: '1.6' }}>
            Save the OF Statements → Earnings page as HTML. Scroll past existing data — duplicates are automatically skipped.
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              ref={uploadFileRef}
              type="file"
              accept=".html,.htm"
              onChange={e => { if (e.target.files[0]) { setUploadFile(e.target.files[0]); setUploadError(null); setUploadResult(null) }}}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => uploadFileRef.current?.click()}
              style={{
                background: uploadFile ? '#F0FDF4' : '#F8FAFC',
                border: `1px solid ${uploadFile ? '#BBF7D0' : '#E2E8F0'}`,
                borderRadius: '6px', padding: '8px 14px', fontSize: '12px', cursor: 'pointer',
                color: uploadFile ? '#166534' : '#64748B',
              }}
            >
              {uploadFile ? `✓ ${uploadFile.name}` : 'Choose HTML file'}
            </button>
            {uploadFile && (
              <button
                disabled={uploading}
                onClick={async () => {
                  setUploading(true)
                  setUploadError(null)
                  setUploadResult(null)
                  try {
                    const formData = new FormData()
                    formData.append('file', uploadFile)
                    formData.append('creator', creator?.aka || creator?.name || '')
                    const res = await fetch('/api/admin/invoicing/upload-transactions', { method: 'POST', body: formData })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Upload failed')
                    setUploadResult(data)
                    setUploadFile(null)
                    if (uploadFileRef.current) uploadFileRef.current.value = ''
                    // Auto-refresh earnings after successful upload
                    if (data.uploaded > 0) setTimeout(() => onRefresh(), 500)
                  } catch (e) {
                    setUploadError(e.message)
                  } finally {
                    setUploading(false)
                  }
                }}
                style={{
                  background: uploading ? '#E5E7EB' : '#1a1a1a', border: 'none', borderRadius: '6px',
                  padding: '8px 16px', fontSize: '12px', color: uploading ? '#999' : '#fff', fontWeight: 600,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            )}
          </div>
          {uploadError && (
            <div style={{ marginTop: '10px', padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#DC2626' }}>
              {uploadError}
            </div>
          )}
          {uploadResult && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#166534', marginBottom: '4px' }}>
                {uploadResult.uploaded > 0 ? `Added ${uploadResult.uploaded} new transactions` : 'No new transactions to add'}
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#15803D' }}>
                <span>Parsed: {uploadResult.parsed}</span>
                <span>Skipped: {uploadResult.skipped}</span>
                {uploadResult.overlapMethod && (
                  <span style={{ color: '#999' }}>
                    ({uploadResult.overlapMethod === 'fingerprint' ? 'matched overlap' : uploadResult.overlapMethod === 'cutoff_fallback' ? 'timestamp cutoff' : 'first upload'})
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Revenue chart — immediately visible */}
      <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '12px 16px', marginBottom: '12px', overflow: 'hidden' }}>
        {/* Chart header — stays static during slide */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '8px' }}>
          <span style={{ fontSize: '28px', fontWeight: 700, color: '#1a1a1a' }}>{fmtMoney(periodNet)}</span>
          <span style={{ fontSize: '14px', color: '#999' }}>({fmtMoney(periodNet / 0.8)} Gross)</span>
          {pctChange !== null && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              background: pctChange >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: pctChange >= 0 ? '#16a34a' : '#dc2626',
              padding: '3px 10px', borderRadius: '14px', fontSize: '13px', fontWeight: 600,
            }}>
              {pctChange >= 0 ? '↗' : '↘'} {Math.abs(pctChange).toFixed(1)}%
            </span>
          )}
        </div>
        {/* Sliding chart */}
        <div key={slideKey} style={{
          animation: slideDir ? `chartSlide${slideDir === 'left' ? 'Left' : 'Right'} 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)` : 'none',
        }}>
          <style>{`
            @keyframes chartSlideLeft {
              0% { transform: translateX(60px); opacity: 0; }
              40% { opacity: 0.7; }
              100% { transform: translateX(0); opacity: 1; }
            }
            @keyframes chartSlideRight {
              0% { transform: translateX(-60px); opacity: 0; }
              40% { opacity: 0.7; }
              100% { transform: translateX(0); opacity: 1; }
            }
          `}</style>
          <RevenueChart dailyData={filteredDaily} allDailyData={dailyData} typeFilter={typeFilter} pctChange={pctChange} milestones={[
            ...(creator?.managementStartDate ? [{ date: creator.managementStartDate, label: 'Joined Palm' }] : []),
          ]} />
        </div>
      </div>

      {/* Going Cold alerts — auto-expanded */}
      {goingColdAlerts && goingColdAlerts.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#EA580C' }}>{goingColdCount} fan{goingColdCount !== 1 ? 's' : ''} going cold</span>
              <span style={{ fontSize: '11px', color: '#999', marginLeft: '6px' }}>Spending below their normal cadence</span>
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 90px 100px 90px 70px', padding: '8px 16px', fontSize: '9px', fontWeight: 600, color: '#999', textTransform: 'uppercase', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <span></span><span>Fan</span><span style={{ textAlign: 'right' }}>Normal Gap</span><span style={{ textAlign: 'right' }}>Current Gap</span><span style={{ textAlign: 'right' }}>Last 30d</span><span style={{ textAlign: 'right' }}>90d Avg/mo</span><span style={{ textAlign: 'right' }}>Lifetime</span><span style={{ textAlign: 'center' }}>Urgency</span>
            </div>
            {(showAllCold ? goingColdAlerts : goingColdAlerts.slice(0, 10)).map((a, i) => (
              <GoingColdRow key={a.fan} alert={a} index={i} fmtMoney={fmtMoney} creatorName={creator?.name || creator?.aka || ''} creatorRecordId={creator?.id} allTxns={allTxns} />
            ))}
            {goingColdAlerts.length > 10 && !showAllCold && (
              <button onClick={() => setShowAllCold(true)}
                style={{ width: '100%', padding: '10px', background: '#FAFAFA', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer', fontSize: '12px', color: '#EA580C', fontWeight: 600 }}>
                Show all {goingColdCount} fans
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top fans */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Top Fans — {PERIOD_PRESETS.find(p => p.key === period)?.label || (period === 'custom' ? 'Custom Range' : 'All Time')}
        </div>
        <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 100px 60px 90px', padding: '10px 16px', fontSize: '10px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <span>#</span><span>Name</span><span>Username</span><span style={{ textAlign: 'right' }}>Spent</span><span style={{ textAlign: 'right' }}>Txns</span><span style={{ textAlign: 'right' }}>Last Active</span>
          </div>
          {(showAllFans ? topFans : topFans.slice(0, 5)).map((fan, i) => (
            <div key={fan.displayName} style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 1fr 100px 60px 90px', padding: '8px 16px',
              fontSize: '12px', borderBottom: '1px solid rgba(0,0,0,0.03)',
              background: i % 2 === 0 ? '#fff' : '#FAFAFA',
            }}>
              <span style={{ color: '#ccc', fontWeight: 600 }}>{fan.rank}</span>
              <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{fan.displayName}</span>
              <span>{fan.ofUsername ? (
                <a href={`https://onlyfans.com/${fan.ofUsername}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#E88FAC', textDecoration: 'none', fontSize: '11px' }}>
                  @{fan.ofUsername}
                </a>
              ) : <span style={{ color: '#ccc' }}>—</span>}</span>
              <span style={{ textAlign: 'right', fontWeight: 600, color: '#1a1a1a' }}>{fmtMoney(fan.totalNet)}</span>
              <span style={{ textAlign: 'right', color: '#666' }}>{fan.transactionCount}</span>
              <span style={{ textAlign: 'right', color: '#999', fontSize: '11px' }}>{fan.lastDate}</span>
            </div>
          ))}
          {topFans.length > 5 && !showAllFans && (
            <button onClick={() => setShowAllFans(true)}
              style={{ width: '100%', padding: '10px', background: '#FAFAFA', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer', fontSize: '12px', color: '#E88FAC', fontWeight: 600 }}>
              Show all {topFans.length} fans
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fans CRM Panel ──────────────────────────────────────────────────────────

function FanRow({ f, i, isExpanded, onToggle, statusColors, effectColors, fmtDate, fmtMoney, setFans, creatorName, creatorRecordId, allTxns }) {
  const [chatFile, setChatFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [showBrief, setShowBrief] = useState(false)
  const [loadedFromAirtable, setLoadedFromAirtable] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [selectedAnalysisIdx, setSelectedAnalysisIdx] = useState(0)
  const [chartMode, setChartMode] = useState('monthly') // 'daily' | 'monthly'
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [hoverIdx, setHoverIdx] = useState(null)
  const chatFileRef = useRef(null)

  const sc = statusColors[f.status] || statusColors['Monitoring']
  const ec = effectColors[f.effectiveness] || effectColors['Pending']

  // Load existing analysis from Airtable when expanded
  useEffect(() => {
    if (!isExpanded || analysis || loadedFromAirtable) return
    setLoadedFromAirtable(true)
    fetch(`/api/admin/creator-earnings/analyze-chat?fan=${encodeURIComponent(f.fanName)}&creator=${encodeURIComponent(creatorName || '')}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.analysis) setAnalysis(data) })
      .catch(() => {})
  }, [isExpanded])

  // Build daily + monthly spend data for this fan from allTxns
  const { fanSpendData, monthlySpendData } = useMemo(() => {
    if (!allTxns || !Array.isArray(allTxns)) return { fanSpendData: null, monthlySpendData: null }
    const dailySpend = {}
    for (const t of allTxns) {
      const match = (f.ofUsername && t.ofUsername === f.ofUsername) ||
        (!f.ofUsername && (t.displayName || '').toLowerCase() === (f.fanName || '').toLowerCase())
      if (!match || t.type === 'Chargeback') continue
      const d = t.date
      if (!d) continue
      dailySpend[d] = (dailySpend[d] || 0) + (t.net || 0)
    }
    const entries = Object.entries(dailySpend).sort(([a], [b]) => a.localeCompare(b))
    if (entries.length < 1) return { fanSpendData: null, monthlySpendData: null }

    // Fill gaps with zero-spend days
    const filled = []
    const startDate = new Date(entries[0][0] + 'T00:00:00')
    const endDate = new Date(entries[entries.length - 1][0] + 'T00:00:00')
    const spendMap = Object.fromEntries(entries)
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0]
      filled.push({ date: key, spend: spendMap[key] || 0 })
    }

    // Build monthly totals — include all months from first to current
    const months = {}
    for (const d of filled) {
      const mo = d.date.slice(0, 7)
      months[mo] = (months[mo] || 0) + d.spend
    }
    // Fill in missing months between first and now
    const firstMo = filled[0].date.slice(0, 7)
    const now = new Date()
    const lastMo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const allMonths = []
    let cur = firstMo
    while (cur <= lastMo) {
      allMonths.push({ month: cur, spend: months[cur] || 0 })
      const [y, m] = cur.split('-').map(Number)
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
      cur = next
    }

    return { fanSpendData: filled, monthlySpendData: allMonths }
  }, [allTxns, f.ofUsername, f.fanName])

  // Milestone dates from alert history and analyses
  const milestones = useMemo(() => {
    const m = []
    if (f.alertHistory) {
      for (const h of f.alertHistory) {
        if (h.date) m.push({ date: h.date.split('T')[0], label: 'Sent to Manager', color: '#DC2626' })
      }
    }
    if (f.analysisRecords) {
      for (const a of f.analysisRecords) {
        if (a.date) m.push({ date: a.date.split('T')[0], label: 'Analyzed', color: '#7C3AED' })
      }
    }
    return m
  }, [f.alertHistory, f.analysisRecords])

  function buildFormData() {
    const formData = new FormData()
    formData.append('file', chatFile)
    formData.append('fanName', f.fanName)
    formData.append('fanUsername', f.ofUsername || '')
    formData.append('lifetime', f.lifetimeSpend || 0)
    if (f.goingCold) {
      formData.append('medianGap', f.goingCold.medianGap || 0)
      formData.append('currentGap', f.goingCold.currentGap || 0)
      formData.append('rolling30', f.goingCold.rolling30 || 0)
      formData.append('monthlyAvg90', f.goingCold.monthlyAvg90 || 0)
      formData.append('lastPurchaseDate', f.goingCold.lastPurchaseDate || '')
    }
    formData.append('creatorName', creatorName || '')
    formData.append('creatorRecordId', creatorRecordId || '')
    // Compute daily spend timeline for analysis context
    if (allTxns) {
      const dailySpend = {}
      for (const t of allTxns) {
        if ((t.displayName || '') === f.fanName || (t.ofUsername || '') === f.ofUsername) {
          dailySpend[t.date] = (dailySpend[t.date] || 0) + (t.net || 0)
        }
      }
      const timeline = Object.entries(dailySpend)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, spend]) => `${date}: $${spend.toFixed(2)}`)
        .join('\n')
      if (timeline) formData.append('spendingTimeline', timeline)
    }
    return formData
  }

  async function handleAnalyze() {
    if (!chatFile) return
    setAnalyzing(true)
    setAnalysisError(null)
    try {
      const res = await fetch('/api/admin/creator-earnings/analyze-chat', { method: 'POST', body: buildFormData() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setAnalysis(data)
      // Refresh fans list to show new analysis
      const refreshRes = await fetch(`/api/admin/fan-tracker?creator=${encodeURIComponent(creatorName)}`)
      const refreshData = await refreshRes.json()
      if (refreshData.fans) setFans(refreshData.fans)
    } catch (e) {
      setAnalysisError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSendToTelegram() {
    setSending(true)
    setSendResult(null)
    try {
      const alertData = f.goingCold || {
        fan: f.fanName,
        username: f.ofUsername,
        lifetime: f.lifetimeSpend,
        rolling30: f.last30,
        urgency: 'warning',
        medianGap: 0,
        currentGap: 0,
        gapRatio: 0,
      }
      const res = await fetch('/api/admin/whale-alert/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorName,
          creatorRecordId,
          alert: { ...alertData, fan: f.fanName, username: f.ofUsername },
          analysis: analysis ? { analysis: analysis.analysis, managerBrief: analysis.managerBrief } : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setSendResult({ success: true })
    } catch (e) {
      setSendResult({ error: e.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 80px 80px 90px',
          padding: '8px 16px', fontSize: '12px', cursor: 'pointer',
          background: isExpanded ? '#FFFBF5' : i % 2 === 0 ? '#fff' : '#FAFAFA',
        }}
      >
        <span style={{ color: '#ccc', fontSize: '10px', lineHeight: '20px' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
        <div>
          <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{f.fanName}</span>
          {f.ofUsername && <span style={{ color: '#E88FAC', fontSize: '11px', marginLeft: '6px' }}>@{f.ofUsername}</span>}
          {f.alertCount > 0 && <span style={{ fontSize: '9px', color: '#999', marginLeft: '6px' }}>{f.alertCount} alert{f.alertCount !== 1 ? 's' : ''}</span>}
        </div>
        <span><span style={{ background: sc.bg, color: sc.text, padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 600 }}>{f.status}</span></span>
        <span style={{ textAlign: 'right', fontWeight: 600, color: '#1a1a1a' }}>{fmtMoney(f.lifetimeSpend)}</span>
        <span style={{ textAlign: 'right', color: f.last30 === 0 ? '#DC2626' : '#666', fontWeight: f.last30 === 0 && f.lifetimeSpend > 100 ? 600 : 400 }}>{fmtMoney(f.last30)}</span>
        <span style={{ textAlign: 'right', color: '#666' }}>{f.txnCount || 0}</span>
        <span style={{ textAlign: 'right', color: '#999', fontSize: '11px' }}>{f.lastDate || '—'}</span>
      </div>

      {isExpanded && (
        <div style={{ padding: '12px 16px 16px 40px', background: '#FFFBF5' }}>
          {/* Going cold details */}
          {f.goingCold && (
            <div style={{ marginBottom: '12px', padding: '10px 14px', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FECACA' }}>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '12px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#DC2626', fontWeight: 600, marginBottom: '2px' }}>Trigger</div>
                  <div style={{ color: '#1a1a1a' }}>
                    {f.goingCold.triggerReason === 'gap' && `Purchase gap ${f.goingCold.currentGap}d exceeds ${f.goingCold.medianGap * 2}d threshold (2\u00d7 median)`}
                    {f.goingCold.triggerReason === 'spend_drop' && `30-day spend dropped to ${Math.round(f.goingCold.spendDropRatio * 100)}% of normal`}
                    {f.goingCold.triggerReason === 'both' && `Gap ${f.goingCold.gapRatio}\u00d7 overdue + spending at ${Math.round(f.goingCold.spendDropRatio * 100)}% of normal`}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Last Purchase</div>
                  <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{f.goingCold.lastPurchaseDate}</div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Gap</div>
                  <div style={{ fontWeight: 600, color: '#DC2626' }}>{f.goingCold.currentGap}d <span style={{ fontWeight: 400, color: '#999' }}>({f.goingCold.gapRatio}x median {f.goingCold.medianGap}d)</span></div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Last 30d</div>
                  <div>{fmtMoney(f.goingCold.rolling30)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>90d Avg/mo</div>
                  <div>{fmtMoney(f.goingCold.monthlyAvg90)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Total Purchases</div>
                  <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{f.goingCold.totalPurchases || f.txnCount || 0} sessions</div>
                </div>
              </div>
            </div>
          )}

          {/* Stats row */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {f.firstDate && (
              <div>
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>First Purchase</div>
                <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{f.firstDate}</div>
              </div>
            )}
            {f.firstFlagged && (
              <div>
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>First Flagged</div>
                <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{fmtDate(f.firstFlagged)}</div>
              </div>
            )}
            {f.timesGoneCold > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Times Gone Cold</div>
                <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{f.timesGoneCold}</div>
              </div>
            )}
            {(f.preAlertSpend30d > 0 || f.postAlertSpend30d > 0) && (
              <div>
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Post-Alert Spend (30d)</div>
                <div style={{ fontSize: '12px', color: f.postAlertSpend30d > f.preAlertSpend30d ? '#166534' : '#DC2626', fontWeight: 600 }}>
                  {fmtMoney(f.postAlertSpend30d)}
                </div>
              </div>
            )}
            {f.lastChatUpload && (
              <div>
                <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Last Chat Upload</div>
                <div style={{ fontSize: '12px', color: '#1a1a1a' }}>{fmtDate(f.lastChatUpload)}</div>
              </div>
            )}
          </div>

          {/* Spending chart — full width, monthly bars (default) / daily line toggle */}
          {(fanSpendData || monthlySpendData) && (() => {
            const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            const VW = 900, H = 150, padL = 50, padR = 30, padT = 16, padB = 24
            const chartW = VW - padL - padR, chartH = H - padT - padB
            const milestoneMonths = milestones.map(m => m.date.slice(0, 7))

            const allMonthly = monthlySpendData || []
            const defaultMonthly = allMonthly.length > 7 ? allMonthly.slice(-7) : allMonthly
            const visibleMonthly = showAllHistory ? allMonthly : defaultMonthly
            const canExpandMonthly = allMonthly.length > 7
            const startMonth = visibleMonthly.length > 0 ? visibleMonthly[0].month : null
            const allDaily = fanSpendData || []
            const visibleDaily = startMonth ? allDaily.filter(d => d.date >= startMonth) : allDaily

            // Shared y-axis scale across both charts with round tick numbers
            const monthlyMax = visibleMonthly.length > 0 ? Math.max(...visibleMonthly.map(d => d.spend)) : 0
            const dailyMax = visibleDaily.length > 0 ? Math.max(...visibleDaily.map(d => d.spend)) : 0
            const rawMax = Math.max(monthlyMax, dailyMax, 1)
            // Round up to a nice number
            const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)))
            const niceSteps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            const sharedMax = niceSteps.map(s => s * magnitude).find(s => s >= rawMax) || rawMax
            const sharedTicks = [0, Math.round(sharedMax / 2), Math.round(sharedMax)]

            const headerRow = (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>Spending History</div>
                  {canExpandMonthly && (
                    <button onClick={() => setShowAllHistory(!showAllHistory)}
                      style={{ fontSize: '10px', color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 500 }}>
                      {showAllHistory ? `Last 7 months` : `Show all (${allMonthly.length} months)`}
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                  <button onClick={() => setChartMode('monthly')} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: chartMode === 'monthly' ? '#7C3AED' : 'transparent', color: chartMode === 'monthly' ? '#fff' : '#666' }}>Monthly</button>
                  <button onClick={() => setChartMode('daily')} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: chartMode === 'daily' ? '#7C3AED' : 'transparent', color: chartMode === 'daily' ? '#fff' : '#666' }}>Daily</button>
                </div>
              </div>
            )

            if (chartMode === 'monthly' && visibleMonthly.length >= 1) {
              const data = visibleMonthly
              const barW = Math.min(chartW / data.length * 0.7, 40)
              const yScale = (v) => padT + chartH - (v / sharedMax) * chartH

              return (
                <div style={{ marginBottom: '12px' }}>
                  {headerRow}
                  <svg viewBox={`0 0 ${VW} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
                    {sharedTicks.map(v => (
                      <g key={v}>
                        <line x1={padL} x2={VW - padR} y1={yScale(v)} y2={yScale(v)} stroke="#F3F4F6" strokeWidth="1" />
                        <text x={padL - 6} y={yScale(v) + 3} textAnchor="end" fontSize="9" fill="#999">${v > 0 ? v.toLocaleString() : '0'}</text>
                      </g>
                    ))}
                    {data.map((d, i) => {
                      const cx = padL + ((i + 0.5) / data.length) * chartW
                      const barH = Math.max((d.spend / sharedMax) * chartH, d.spend > 0 ? 2 : 0)
                      const moNum = parseInt(d.month.slice(5))
                      const yr = d.month.slice(2, 4)
                      const hasMilestone = milestoneMonths.includes(d.month)
                      const spendLabelY = padT + chartH - barH - 3
                      const defaultDotY = padT - 6
                      const dotY = hasMilestone && d.spend > 0 && spendLabelY < defaultDotY + 12 ? spendLabelY - 10 : defaultDotY
                      return (
                        <g key={d.month}>
                          <rect x={cx - barW / 2} y={padT + chartH - barH} width={barW} height={barH} fill={d.spend === 0 ? '#F3F4F6' : '#E88FAC'} rx="2" />
                          {d.spend > 0 && <text x={cx} y={spendLabelY} textAnchor="middle" fontSize="8" fill="#666">{fmtMoney(d.spend)}</text>}
                          <text x={cx} y={H - 4} textAnchor="middle" fontSize="9" fill={hasMilestone ? '#7C3AED' : '#999'} fontWeight={hasMilestone ? '700' : '400'}>{moNames[moNum]}{data.length > 12 ? `'${yr}` : ''}</text>
                          {hasMilestone && <circle cx={cx} cy={dotY} r="3.5" fill="#7C3AED" />}
                        </g>
                      )
                    })}
                  </svg>
                  {milestones.length > 0 && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '9px', color: '#999' }}>
                      <span><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#7C3AED', marginRight: '3px', verticalAlign: 'middle' }} />Analysis/Alert sent</span>
                    </div>
                  )}
                </div>
              )
            }

            if (chartMode === 'daily' && visibleDaily.length >= 2) {
              const data = visibleDaily
              const xScale = (i) => padL + (i / (data.length - 1)) * chartW
              const yScale = (v) => padT + chartH - (v / sharedMax) * chartH
              const points = data.map((d, i) => `${xScale(i)},${yScale(d.spend)}`)
              const linePath = 'M' + points.join(' L')
              const areaPath = linePath + ` L${xScale(data.length - 1)},${yScale(0)} L${xScale(0)},${yScale(0)} Z`
              const step = Math.max(Math.floor(data.length / 6), 1)
              const moAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
              const fmtDateLabel = (dateStr) => {
                const dt = new Date(dateStr + 'T12:00:00')
                return `${moAbbr[dt.getMonth()]} ${dt.getDate()}`
              }
              const xLabels = []
              for (let xi = 0; xi < data.length; xi += step) xLabels.push({ i: xi, label: fmtDateLabel(data[xi].date) })
              if (xLabels[xLabels.length - 1]?.i !== data.length - 1) xLabels.push({ i: data.length - 1, label: fmtDateLabel(data[data.length - 1].date) })
              const dateToIndex = {}
              data.forEach((d, i) => { dateToIndex[d.date] = i })

              return (
                <div style={{ marginBottom: '12px' }}>
                  {headerRow}
                  <svg viewBox={`0 0 ${VW} ${H}`} style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
                    onMouseMove={e => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const scale = VW / rect.width
                      const mx = (e.clientX - rect.left) * scale
                      let closest = 0, closestDist = Infinity
                      for (let i = 0; i < data.length; i++) {
                        const dist = Math.abs(xScale(i) - mx)
                        if (dist < closestDist) { closestDist = dist; closest = i }
                      }
                      setHoverIdx(closest)
                    }}
                    onMouseLeave={() => setHoverIdx(null)}
                  >
                    {sharedTicks.map(v => (
                      <g key={v}>
                        <line x1={padL} x2={VW - padR} y1={yScale(v)} y2={yScale(v)} stroke="#F3F4F6" strokeWidth="1" />
                        <text x={padL - 6} y={yScale(v) + 3} textAnchor="end" fontSize="9" fill="#999">${v > 0 ? v.toLocaleString() : '0'}</text>
                      </g>
                    ))}
                    <path d={areaPath} fill="rgba(124, 58, 237, 0.08)" />
                    <path d={linePath} fill="none" stroke="#7C3AED" strokeWidth="1.5" />
                    {data.map((d, i) => d.spend > 0 ? (
                      <circle key={i} cx={xScale(i)} cy={yScale(d.spend)} r={hoverIdx === i ? 4 : 2} fill="#7C3AED" />
                    ) : null)}
                    {hoverIdx !== null && data[hoverIdx] && (() => {
                      const d = data[hoverIdx]
                      const hx = xScale(hoverIdx)
                      const hy = yScale(d.spend)
                      const moN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      const dt = new Date(d.date + 'T12:00:00')
                      const label = `${moN[dt.getMonth()]} ${dt.getDate()}`
                      const tooltipW = 90
                      const tx = Math.max(padL, Math.min(hx - tooltipW / 2, VW - padR - tooltipW))
                      return (
                        <g>
                          <line x1={hx} x2={hx} y1={padT} y2={padT + chartH} stroke="#7C3AED" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
                          <rect x={tx} y={hy - 28} width={tooltipW} height="22" rx="4" fill="#1a1a1a" />
                          <text x={tx + tooltipW / 2} y={hy - 14} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="600">{label}: {fmtMoney(d.spend)}</text>
                        </g>
                      )
                    })()}
                    {milestones.map((m, idx) => {
                      const mi = dateToIndex[m.date]
                      if (mi === undefined) return null
                      const x = xScale(mi)
                      return (
                        <g key={idx}>
                          <line x1={x} x2={x} y1={padT} y2={H - padB} stroke={m.color} strokeWidth="1.5" strokeDasharray="4,3" />
                          <text x={x} y={padT - 2} textAnchor="middle" fontSize="8" fill={m.color} fontWeight="600">{m.label}</text>
                        </g>
                      )
                    })}
                    {xLabels.map(({ i: xi, label }) => (
                      <text key={xi} x={xScale(xi)} y={H - 4} textAnchor="middle" fontSize="7.5" fill="#999">{label}</text>
                    ))}
                  </svg>
                </div>
              )
            }
            return null
          })()}

          {/* Alert history timeline */}
          {f.alertHistory && f.alertHistory.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Alert History</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {f.alertHistory.slice().reverse().map((h, idx) => {
                  const urgEmoji = { critical: '\uD83D\uDEA8', high: '\u26A0\uFE0F', warning: '\uD83D\uDFE1' }
                  return (
                    <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: '#666' }}>
                      <span>{urgEmoji[h.urgency] || '\uD83D\uDFE1'}</span>
                      <span style={{ color: '#999', minWidth: '90px' }}>{fmtDate(h.date)}</span>
                      <span>{h.currentGap}d gap ({h.medianGap}d normal)</span>
                      <span style={{ color: '#999' }}>&middot;</span>
                      <span>30d: {fmtMoney(h.rolling30)}</span>
                      <span style={{ color: '#999' }}>&middot;</span>
                      <span>Lifetime: {fmtMoney(h.lifetime)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Chat Analysis Section (unified: history + viewer + upload) ── */}
          <div style={{ marginTop: '12px', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase' }}>
                Chat Analysis {f.lifetimeSpend >= 1000 ? '(Deep Dive)' : '(Quick Snapshot)'}
              </div>
              {/* Analysis selector dropdown when multiple exist */}
              {f.analysisRecords && f.analysisRecords.length > 1 && (
                <select value={selectedAnalysisIdx} onChange={e => { setSelectedAnalysisIdx(Number(e.target.value)); setAnalysis(null); setShowBrief(false) }}
                  style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #E2E8F0', borderRadius: '4px', color: '#666', background: '#FAFAFA' }}>
                  {f.analysisRecords.map((a, idx) => (
                    <option key={idx} value={idx}>{fmtDate(a.date)} — {a.type || 'Analysis'}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Show selected analysis from history */}
            {f.analysisRecords && f.analysisRecords.length > 0 && (() => {
              const sel = f.analysisRecords[selectedAnalysisIdx] || f.analysisRecords[0]
              // Check if this analysis has been sent (alert exists after analysis date)
              const analysisSent = f.alertHistory?.some(h => {
                if (!h.date || !sel.date) return false
                return h.date >= sel.date
              })
              return (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#999' }}>{fmtDate(sel.date)}</span>
                    {sel.type && <span style={{ fontSize: '9px', fontWeight: 600, color: '#7C3AED', background: '#EDE9FE', padding: '1px 5px', borderRadius: '3px' }}>{sel.type}</span>}
                    {analysisSent
                      ? <span style={{ fontSize: '9px', fontWeight: 600, color: '#166534', background: '#DCFCE7', padding: '1px 5px', borderRadius: '3px' }}>Sent to Manager</span>
                      : <span style={{ fontSize: '9px', fontWeight: 600, color: '#D97706', background: '#FEF3C7', padding: '1px 5px', borderRadius: '3px' }}>Not Sent</span>
                    }
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm('Delete this analysis?')) return
                        const res = await fetch(`/api/admin/fan-tracker?recordId=${sel.id}&table=analysis`, { method: 'DELETE' })
                        if (res.ok) {
                          setFans(prev => prev.map(fan => {
                            if (fan.id !== f.id) return fan
                            const updated = { ...fan, analysisRecords: fan.analysisRecords.filter(ar => ar.id !== sel.id) }
                            if (updated.analysisRecords.length === 0 && updated.source === 'analysis') return null
                            return updated
                          }).filter(Boolean))
                          setSelectedAnalysisIdx(0)
                        }
                      }}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
                      onMouseEnter={e => e.target.style.color = '#DC2626'}
                      onMouseLeave={e => e.target.style.color = '#ccc'}
                      title="Delete this analysis"
                    >&times;</button>
                  </div>
                  {sel.brief && <div style={{ fontSize: '11px', color: '#444', lineHeight: '1.5', marginBottom: '8px' }}>
                    {sel.brief.split('\n').map((line, li) => {
                      const t = line.trim()
                      if (!t) return <div key={li} style={{ height: '4px' }} />
                      if (/^\*\*[^*]+\*\*/.test(t)) {
                        const m = t.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
                        if (m) return <div key={li} style={{ marginTop: li > 0 ? '6px' : 0 }}><span style={{ fontWeight: 700, color: '#7C3AED' }}>{m[1]}:</span> {m[2]?.replace(/\*\*([^*]+)\*\*/g, '$1') || ''}</div>
                      }
                      return <div key={li}>{t.replace(/\*\*([^*]+)\*\*/g, '$1')}</div>
                    })}
                  </div>}
                  {/* Send to Manager button — only if not already sent */}
                  {!analysisSent && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <button onClick={handleSendToTelegram} disabled={sending}
                        style={{
                          background: '#1a1a1a', border: 'none', borderRadius: '6px',
                          padding: '6px 12px', fontSize: '11px', color: '#fff', fontWeight: 600,
                          cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1,
                          display: 'flex', alignItems: 'center', gap: '5px',
                        }}>
                        <span style={{ fontSize: '13px' }}>&#9993;</span> {sending ? 'Sending...' : 'Send to Chat Manager'}
                      </button>
                      {sendResult?.success && <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 500 }}>&#10003; Sent &amp; tracked</span>}
                      {sendResult?.error && <span style={{ fontSize: '11px', color: '#DC2626' }}>{sendResult.error}</span>}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Full analysis viewer (loaded from Airtable or freshly analyzed) */}
            {analysis && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '11px', color: '#999' }}>
                    <span>{analysis.messageCount} msgs ({analysis.fanMessages} fan / {analysis.creatorMessages} creator)</span>
                    {analysis.lastMessageDate && <span>through {analysis.lastMessageDate}</span>}
                    {analysis.managerBrief && (
                      <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                        <button onClick={() => setShowBrief(false)} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: !showBrief ? '#EA580C' : 'transparent', color: !showBrief ? '#fff' : '#666' }}>Full</button>
                        <button onClick={() => setShowBrief(true)} style={{ padding: '3px 8px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', background: showBrief ? '#EA580C' : 'transparent', color: showBrief ? '#fff' : '#666' }}>Manager Brief</button>
                      </div>
                    )}
                    {analysis.saved && <span style={{ color: '#22c55e', fontSize: '10px' }}>\u2713 Saved</span>}
                  </div>
                  {chatFile ? (
                    <button onClick={() => { setAnalysis(null); setShowBrief(false); handleAnalyze() }} disabled={analyzing}
                      style={{ fontSize: '11px', color: '#EA580C', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                      {analyzing ? 'Re-analyzing...' : 'Re-analyze'}
                    </button>
                  ) : (
                    <button onClick={() => { setAnalysis(null); setShowBrief(false) }}
                      style={{ fontSize: '11px', color: '#999', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      Upload new chat
                    </button>
                  )}
                </div>
                <div style={{
                  background: showBrief ? '#F8FAFC' : '#FFFBF5',
                  border: `1px solid ${showBrief ? '#E2E8F0' : '#FED7AA'}`,
                  borderRadius: '8px', padding: '16px 20px', fontSize: '13px', color: '#1a1a1a', lineHeight: '1.7',
                }}>
                  {(() => {
                    const text = showBrief ? (analysis.managerBrief || analysis.analysis) : analysis.analysis
                    const accentColor = showBrief ? '#334155' : '#EA580C'
                    return text.split('\n').map((line, idx) => {
                      const trimmed = line.trim()
                      if (!trimmed) return <div key={idx} style={{ height: '8px' }} />
                      if (/^\*\*[^*]+\*\*/.test(trimmed)) {
                        const hm = trimmed.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
                        if (hm) {
                          const rest = hm[2]?.replace(/\*\*([^*]+)\*\*/g, '$1') || ''
                          return <div key={idx} style={{ marginTop: idx > 0 ? '14px' : 0, marginBottom: '4px' }}><div style={{ fontSize: '12px', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{hm[1]}</div>{rest && <div style={{ marginTop: '2px' }}>{rest}</div>}</div>
                        }
                      }
                      if (/^\d+\.\s/.test(trimmed)) {
                        const content = trimmed.replace(/^\d+\.\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                        const nm = trimmed.match(/^(\d+)\./)
                        return <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px', paddingLeft: '4px' }}><span style={{ color: accentColor, fontWeight: 700, fontSize: '12px', minWidth: '16px' }}>{nm[1]}.</span><span>{content}</span></div>
                      }
                      if (/^[-\u2022]\s/.test(trimmed)) {
                        const content = trimmed.replace(/^[-\u2022]\s*/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => t)
                        return <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '3px', paddingLeft: '4px' }}><span style={{ color: accentColor, fontSize: '8px', marginTop: '5px' }}>\u25CF</span><span>{content}</span></div>
                      }
                      return <div key={idx}>{trimmed.replace(/\*\*([^*]+)\*\*/g, (_, t) => t)}</div>
                    })
                  })()}
                </div>
              </div>
            )}

            {/* Upload new chat */}
            {!analysis && (
              <div>
                {/* Show "scroll back to" hint if there's a previous analysis */}
                {analysis?.lastMessageDate && (
                  <div style={{ marginBottom: '8px', padding: '6px 10px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '6px', fontSize: '11px', color: '#92400E' }}>
                    Previous analysis covered messages through <strong>{analysis.lastMessageDate}</strong>. Scroll back to at least this date before saving the HTML.
                  </div>
                )}
                {f.analysisRecords?.length > 0 && !analysis?.lastMessageDate && (
                  <div style={{ marginBottom: '8px', padding: '6px 10px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', fontSize: '11px', color: '#0369A1' }}>
                    Each upload is analyzed independently. Scroll back far enough in the OF chat to include all messages you want covered, then save as HTML.
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input ref={chatFileRef} type="file" accept=".html,.htm"
                    onChange={e => { if (e.target.files[0]) { setChatFile(e.target.files[0]); setAnalysisError(null) }}}
                    style={{ display: 'none' }} />
                  <button onClick={() => chatFileRef.current?.click()}
                    style={{
                      background: chatFile ? '#F0FDF4' : '#F8FAFC', border: `1px solid ${chatFile ? '#BBF7D0' : '#E2E8F0'}`,
                      borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                      color: chatFile ? '#166534' : '#64748B',
                    }}>
                    {chatFile ? `\u2713 ${chatFile.name}` : 'Upload OF chat HTML'}
                  </button>
                  {chatFile && (
                    <button onClick={handleAnalyze} disabled={analyzing}
                      style={{
                        background: '#EA580C', border: 'none', borderRadius: '6px',
                        padding: '6px 14px', fontSize: '12px', color: '#fff', fontWeight: 600,
                        cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.6 : 1,
                      }}>
                      {analyzing ? 'Analyzing...' : 'Analyze Conversation'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {analysisError && (
              <div style={{ marginTop: '8px', padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '12px', color: '#DC2626' }}>
                {analysisError}
              </div>
            )}
          </div>

          {/* Notes */}
          {f.notes && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Notes</div>
              <div style={{ fontSize: '12px', color: '#1a1a1a', whiteSpace: 'pre-wrap' }}>{f.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FansPanel({ creator, allTxns, goingColdAlerts }) {
  const [crmData, setCrmData] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [showAllFans, setShowAllFans] = useState(false)

  const creatorName = creator?.name || creator?.aka || ''
  const creatorRecordId = creator?.id || ''

  // Fetch CRM data (analyses + tracker records)
  useEffect(() => {
    setLoading(true)
    const name = creator?.aka || creator?.name || ''
    fetch(`/api/admin/fan-tracker?creator=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(data => { setCrmData(data.fans || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [creator?.id])

  // Build comprehensive fan list from allTxns + CRM data + going cold alerts
  const allFans = useMemo(() => {
    const fanMap = new Map() // keyed by ofUsername or displayName

    // 1. Build from transaction data — every fan who's spent money
    if (allTxns && Array.isArray(allTxns)) {
      const thirtyAgo = new Date()
      thirtyAgo.setDate(thirtyAgo.getDate() - 30)
      const thirtyAgoStr = thirtyAgo.toISOString().split('T')[0]

      for (const t of allTxns) {
        if (t.type === 'Chargeback') continue
        const key = (t.ofUsername || t.displayName || 'Unknown').toLowerCase()
        if (key === 'unknown') continue
        if (!fanMap.has(key)) {
          fanMap.set(key, {
            id: `txn-${key}`,
            fanName: t.displayName || key,
            ofUsername: t.ofUsername || '',
            lifetimeSpend: 0,
            last30: 0,
            txnCount: 0,
            lastDate: '',
            firstDate: '',
            status: 'Fan',
            alertCount: 0,
            alertHistory: [],
            analysisRecords: [],
            effectiveness: '',
            preAlertSpend30d: 0,
            postAlertSpend30d: 0,
            firstFlagged: null,
            lastAlertSent: null,
            timesGoneCold: 0,
            lastChatUpload: null,
            notes: '',
            source: 'transactions',
          })
        }
        const fan = fanMap.get(key)
        fan.lifetimeSpend += t.net || 0
        fan.txnCount += 1
        if (t.displayName) fan.fanName = t.displayName
        if (!fan.ofUsername && t.ofUsername) fan.ofUsername = t.ofUsername
        if (!fan.lastDate || t.date > fan.lastDate) fan.lastDate = t.date
        if (!fan.firstDate || t.date < fan.firstDate) fan.firstDate = t.date
        if (t.date >= thirtyAgoStr) fan.last30 += t.net || 0
      }
    }

    // 2. Overlay going cold alerts
    if (goingColdAlerts) {
      for (const a of goingColdAlerts) {
        const key = (a.username || a.fan || '').toLowerCase()
        if (!key) continue
        if (fanMap.has(key)) {
          const f = fanMap.get(key)
          f.status = 'Going Cold'
          f.goingCold = a // attach full alert data
        }
      }
    }

    // 3. Overlay CRM data (analyses, alerts, tracker status)
    for (const c of crmData) {
      const key = (c.ofUsername || c.fanName || '').toLowerCase()
      if (!key) continue
      if (fanMap.has(key)) {
        const f = fanMap.get(key)
        // CRM status takes priority over "Fan" but not over "Going Cold"
        // Don't let CRM status set "Going Cold" — only the live goingColdAlerts detection should do that
        if (c.status && f.status !== 'Going Cold') {
          f.status = c.status === 'Going Cold' ? f.status : c.status
        }
        if (c.alertCount > 0) { f.alertCount = c.alertCount }
        if (c.alertHistory) f.alertHistory = c.alertHistory
        if (c.analysisRecords && c.analysisRecords.length > 0) {
          f.analysisRecords = c.analysisRecords
          if (f.status === 'Fan') f.status = 'Analyzed'
        }
        f.effectiveness = c.effectiveness || f.effectiveness
        f.preAlertSpend30d = c.preAlertSpend30d || f.preAlertSpend30d
        f.postAlertSpend30d = c.postAlertSpend30d || f.postAlertSpend30d
        f.firstFlagged = c.firstFlagged || f.firstFlagged
        f.lastAlertSent = c.lastAlertSent || f.lastAlertSent
        f.timesGoneCold = c.timesGoneCold || f.timesGoneCold
        f.lastChatUpload = c.lastChatUpload || f.lastChatUpload
        f.notes = c.notes || f.notes
        f.crmId = c.id
      } else {
        // CRM-only record (no transactions)
        fanMap.set(key, { ...c, id: c.id, txnCount: 0, last30: 0, lastDate: '', firstDate: '', source: 'crm' })
      }
    }

    // Sort: Going Cold first, then Alert Sent, Analyzed, then by lifetime spend
    const statusOrder = { 'Going Cold': 0, 'Alert Sent': 1, 'Analyzed': 2, 'Recovering': 3, 'Monitoring': 4, 'Reactivated': 5, 'Lost': 6, 'Fan': 7 }
    return Array.from(fanMap.values())
      .filter(f => f.lifetimeSpend > 0 || f.analysisRecords?.length > 0 || f.alertCount > 0)
      .sort((a, b) => {
        const so = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        if (so !== 0) return so
        return (b.lifetimeSpend || 0) - (a.lifetimeSpend || 0)
      })
  }, [allTxns, crmData, goingColdAlerts])

  const statusColors = {
    'Going Cold': { bg: '#FEE2E2', text: '#DC2626' },
    'Alert Sent': { bg: '#FFF3CD', text: '#D97706' },
    'Analyzed': { bg: '#EDE9FE', text: '#7C3AED' },
    'Recovering': { bg: '#FEF9C3', text: '#A16207' },
    'Reactivated': { bg: '#DCFCE7', text: '#166534' },
    'Lost': { bg: '#F3F4F6', text: '#6B7280' },
    'Monitoring': { bg: '#DBEAFE', text: '#1D4ED8' },
    'Fan': { bg: '#F3F4F6', text: '#666' },
  }

  const effectColors = {
    'Worked': { bg: '#DCFCE7', text: '#166534' },
    'Didn\'t Work': { bg: '#FEE2E2', text: '#DC2626' },
    'Too Early': { bg: '#FEF9C3', text: '#A16207' },
    'Pending': { bg: '#F3F4F6', text: '#6B7280' },
  }

  const filtered = allFans.filter(f => {
    if (filter === 'going_cold') return f.status === 'Going Cold'
    if (filter === 'tracked') return ['Alert Sent', 'Analyzed', 'Recovering', 'Monitoring'].includes(f.status)
    if (filter === 'resolved') return ['Reactivated', 'Lost'].includes(f.status)
    return true
  })

  const goingColdCount = allFans.filter(f => f.status === 'Going Cold').length
  const trackedCount = allFans.filter(f => ['Alert Sent', 'Analyzed', 'Recovering', 'Monitoring'].includes(f.status)).length
  const displayFans = showAllFans ? filtered : filtered.slice(0, 25)

  function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  function fmtMoney(n) {
    if (!n && n !== 0) return '—'
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  if (loading && (!allTxns || allTxns.length === 0)) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ width: '24px', height: '24px', border: '2px solid #E88FAC', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ fontSize: '13px', color: '#999' }}>Loading fans...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Fan CRM</h3>
          <p style={{ fontSize: '12px', color: '#999', margin: '2px 0 0' }}>
            {allFans.length} fan{allFans.length !== 1 ? 's' : ''}
            {goingColdCount > 0 && <span style={{ color: '#DC2626', fontWeight: 600 }}> &middot; {goingColdCount} going cold</span>}
            {trackedCount > 0 && <span> &middot; {trackedCount} tracked</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            ['all', `All (${allFans.length})`],
            ['going_cold', `Going Cold (${goingColdCount})`],
            ['tracked', `Tracked (${trackedCount})`],
            ['resolved', 'Resolved'],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              style={{
                padding: '4px 10px', fontSize: '11px', fontWeight: filter === key ? 600 : 400,
                background: filter === key ? '#1a1a1a' : '#F3F4F6', color: filter === key ? '#fff' : '#666',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px', background: '#FAFAFA', borderRadius: '10px' }}>
          No fans match this filter.
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px 80px 80px 90px', padding: '8px 16px', fontSize: '9px', fontWeight: 600, color: '#999', textTransform: 'uppercase', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <span></span><span>Fan</span><span>Status</span><span style={{ textAlign: 'right' }}>Lifetime</span><span style={{ textAlign: 'right' }}>Last 30d</span><span style={{ textAlign: 'right' }}>Txns</span><span style={{ textAlign: 'right' }}>Last Active</span>
          </div>
          {displayFans.map((f, i) => (
            <FanRow key={f.id} f={f} i={i} isExpanded={expandedId === f.id}
              onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
              statusColors={statusColors} effectColors={effectColors}
              fmtDate={fmtDate} fmtMoney={fmtMoney} setFans={setCrmData}
              creatorName={creatorName} creatorRecordId={creatorRecordId}
              allTxns={allTxns} />
          ))}
          {filtered.length > 25 && !showAllFans && (
            <button onClick={() => setShowAllFans(true)}
              style={{ width: '100%', padding: '10px', background: '#FAFAFA', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer', fontSize: '12px', color: '#E88FAC', fontWeight: 600 }}>
              Show all {filtered.length} fans
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CreatorDetail({ creator, onProfileUpdated, activeSection }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [refining, setRefining] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState(null)
  const [refineResult, setRefineResult] = useState(null)
  const [refinePreview, setRefinePreview] = useState(null)
  const [analyzeError, setAnalyzeError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')
  const [feedback, setFeedback] = useState('')
  const [earningsData, setEarningsData] = useState(null)
  const [earningsLoading, setEarningsLoading] = useState(false)
  const [earningsError, setEarningsError] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/creator-profile?creatorId=${creator.id}`)
      const data = await res.json()
      setProfile(data)
      setFeedback('')
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); setEarningsData(null); setEarningsError(null) }, [creator.id])

  // Prefetch earnings immediately on creator change (don't wait for tab click)
  useEffect(() => {
    setEarningsData(null)
    setEarningsLoading(true)
    setEarningsError(null)
    const name = creator.aka || creator.name
    fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error === 'no_sheet') setEarningsData({ empty: true })
        else if (data.error) setEarningsError(data.error)
        else setEarningsData(data)
      })
      .catch(e => setEarningsError(e.message))
      .finally(() => setEarningsLoading(false))
  }, [creator.id])

  const refreshEarnings = useCallback(() => {
    setEarningsData(null)
    setEarningsLoading(true)
    setEarningsError(null)
    const name = creator.aka || creator.name
    fetch(`/api/admin/creator-earnings?creator=${encodeURIComponent(name)}&refresh=true`)
      .then(r => r.json())
      .then(data => {
        if (data.error === 'no_sheet') setEarningsData({ empty: true })
        else if (data.error) setEarningsError(data.error)
        else setEarningsData(data)
      })
      .catch(e => setEarningsError(e.message))
      .finally(() => setEarningsLoading(false))
  }, [creator])

  const resetAnalysis = async () => {
    setResetting(true)
    setAnalyzeResult(null)
    setAnalyzeError('')
    try {
      const res = await fetch('/api/admin/creator-profile/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reset failed')
      load()
      onProfileUpdated(creator.id, 'Not Started')
    } catch (e) {
      setAnalyzeError(e.message)
    } finally {
      setResetting(false)
    }
  }

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalyzeError('')
    setAnalyzeResult(null)
    try {
      const res = await fetch('/api/admin/creator-profile/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, creatorName: creator.name || creator.aka }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      setAnalyzeResult(data)
      load()
      onProfileUpdated(creator.id, 'Complete')
    } catch (e) {
      setAnalyzeError(e.message)
      onProfileUpdated(creator.id, 'Not Started')
    } finally {
      setAnalyzing(false)
    }
  }

  const runRefine = async () => {
    if (!feedback.trim()) return
    setRefining(true)
    setAnalyzeError('')
    setRefineResult(null)
    setRefinePreview(null)
    try {
      const res = await fetch('/api/admin/creator-profile/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: creator.id, feedback: feedback.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refine failed')
      setRefinePreview(data)
    } catch (e) {
      setAnalyzeError(e.message)
    } finally {
      setRefining(false)
    }
  }

  const commitRefine = async () => {
    if (!refinePreview?.proposed) return
    setCommitting(true)
    setAnalyzeError('')
    try {
      const res = await fetch('/api/admin/creator-profile/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: creator.id,
          feedback: feedback.trim(),
          commit: true,
          proposal: refinePreview.proposed,
          changesMade: refinePreview.changesMade || '',
          currentTagWeights: refinePreview.current?.tagWeights || {},
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Commit failed')
      setRefineResult({ changesMade: refinePreview.changesMade })
      setRefinePreview(null)
      load()
      onProfileUpdated(creator.id, 'Complete')
    } catch (e) {
      setAnalyzeError(e.message)
    } finally {
      setCommitting(false)
    }
  }

  const discardRefine = () => {
    setRefinePreview(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#555', fontSize: '13px' }}>
      Loading...
    </div>
  )

  const { documents = [], tagWeights = [] } = profile || {}
  const c = profile?.creator || {}

  const status = getDisplayStatus(c.profileAnalysisStatus, documents, c.profileLastAnalyzed, analyzing)
  const topTags = [...tagWeights].filter(tw => tw.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 5)

  return (
    <div>

      {/* ── Earnings section ─────────────────────────────────────────────── */}
      {activeSection === 'earnings' && (
        <EarningsPanel
          data={earningsData}
          loading={earningsLoading}
          error={earningsError}
          onRefresh={refreshEarnings}
          creator={creator}
        />
      )}

      {/* ── Fans CRM section ────────────────────────────────────────────── */}
      {activeSection === 'fans' && (
        <FansPanel creator={creator} allTxns={earningsData?.transactions} goingColdAlerts={earningsData?.goingColdAlerts || []} />
      )}

      {/* ── DNA section ──────────────────────────────────────────────────── */}
      {activeSection === 'dna' && (<>
      {/* DNA header: status + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusPill status={status} />
          {c.profileLastAnalyzed && (
            <span style={{ fontSize: '11px', color: '#555' }}>Last analyzed {c.profileLastAnalyzed}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowUpload(true)}
            style={{ background: '#FFF0F3', color: '#1a1a1a', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}>
            + Upload
          </button>
          {(status === 'Analyzed' || status === 'Reanalyze' || status === 'Analyzing') && (
            <button onClick={resetAnalysis} disabled={resetting}
              style={{
                background: '#FFF0F3', color: '#999', border: '1px solid #E8C4CC',
                borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: 500,
                cursor: resetting ? 'not-allowed' : 'pointer', opacity: resetting ? 0.5 : 1,
              }}>
              {resetting ? 'Resetting...' : 'Reset'}
            </button>
          )}
          <button onClick={runAnalysis} disabled={analyzing}
            style={{
              background: analyzing ? '#E8C4CC' : '#E88FAC', color: '#1a1a1a', border: 'none',
              borderRadius: '6px', padding: '7px 16px', fontSize: '12px', fontWeight: 600,
              cursor: analyzing ? 'not-allowed' : 'pointer', opacity: analyzing ? 0.7 : 1,
            }}>
            {analyzing ? 'Analyzing...' : (status === 'Analyzed' || status === 'Reanalyze' ? 'Reanalyze' : 'Run Analysis')}
          </button>
        </div>
      </div>

      {analyzeResult && (
        <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#22c55e' }}>
          Analysis complete. {analyzeResult.documentsAnalyzed} document(s) analyzed.
          {analyzeResult.topTags?.length > 0 && (
            <span style={{ color: '#888' }}> Top tags: {analyzeResult.topTags.map(t => `${t.tag} (${t.weight})`).join(', ')}</span>
          )}
        </div>
      )}

      {refineResult && (
        <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#22c55e' }}>
          Profile refined.{refineResult.changesMade && <span style={{ color: '#888' }}> {refineResult.changesMade}</span>}
        </div>
      )}

      {analyzeError && (
        <div style={{ background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#ef4444' }}>
          {analyzeError}
        </div>
      )}

      {/* Admin Feedback + Refine — above tabs */}
      {!refinePreview && (status === 'Analyzed' || status === 'Reanalyze') && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '20px' }}>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="e.g. she's more bratty than sweet, tone down Girl Next Door, bump up Soft Tease"
            rows={2}
            style={{
              flex: 1, background: '#FFF5F7', border: '1px solid #E8C4CC', borderRadius: '8px',
              padding: '10px 12px', color: '#1a1a1a', fontSize: '13px', lineHeight: '1.5',
              resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
          <button
            onClick={runRefine}
            disabled={refining || !feedback.trim()}
            style={{
              background: refining ? '#E8C4CC' : '#E88FAC', color: '#1a1a1a', border: 'none',
              borderRadius: '8px', padding: '10px 16px', fontSize: '12px', fontWeight: 600,
              cursor: refining || !feedback.trim() ? 'not-allowed' : 'pointer',
              opacity: !feedback.trim() ? 0.5 : 1, flexShrink: 0, alignSelf: 'stretch',
            }}
          >
            {refining ? 'Refining...' : 'Refine'}
          </button>
        </div>
      )}

      {/* Refine Preview */}
      {refinePreview && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', gap: '16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>Review Proposed Changes</div>
              {refinePreview.changesMade && (
                <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{refinePreview.changesMade}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button onClick={discardRefine}
                style={{ background: '#FFF0F3', color: '#999', border: '1px solid #E8C4CC', borderRadius: '6px', padding: '7px 14px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                Discard
              </button>
              <button onClick={commitRefine} disabled={committing}
                style={{
                  background: committing ? '#bbf7d0' : '#22c55e', color: '#fff', border: 'none',
                  borderRadius: '6px', padding: '7px 16px', fontSize: '12px', fontWeight: 600,
                  cursor: committing ? 'not-allowed' : 'pointer',
                }}>
                {committing ? 'Saving...' : 'Accept & Save'}
              </button>
            </div>
          </div>

          {/* Profile text diffs */}
          {[
            ['Profile Summary', 'profileSummary', 'profile_summary'],
            ['Brand Voice', 'brandVoiceNotes', 'brand_voice_notes'],
            ['Content Direction', 'contentDirectionNotes', 'content_direction_notes'],
            ['Do / Don\'t', 'dosDonts', 'do_dont_notes'],
          ].map(([label, currentKey, proposedKey]) => {
            const cur = refinePreview.current?.[currentKey] || ''
            const proposed = refinePreview.proposed?.[proposedKey] || ''
            if (cur === proposed) return null
            return (
              <div key={label} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ background: '#FEF2F2', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#991B1B', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#DC2626', marginBottom: '6px' }}>CURRENT</div>
                    {cur || <span style={{ color: '#999', fontStyle: 'italic' }}>empty</span>}
                  </div>
                  <div style={{ background: '#F0FDF4', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#166534', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#16A34A', marginBottom: '6px' }}>PROPOSED</div>
                    {proposed || <span style={{ color: '#999', fontStyle: 'italic' }}>empty</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Tag weight diffs — only show tags that changed */}
          {(() => {
            const curTags = refinePreview.current?.tagWeights || {}
            const propTags = refinePreview.proposed?.tag_weights || {}
            const allTags = new Set([...Object.keys(curTags), ...Object.keys(propTags)])
            const changed = [...allTags].filter(t => (curTags[t] || 0) !== (propTags[t] || 0))
              .sort((a, b) => Math.abs((propTags[b] || 0) - (curTags[b] || 0)) - Math.abs((propTags[a] || 0) - (curTags[a] || 0)))
            if (changed.length === 0) return (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Tag Weight Changes</div>
                <div style={{ fontSize: '12px', color: '#999', fontStyle: 'italic' }}>No tag weight changes — only profile text was adjusted.</div>
              </div>
            )
            const maxDelta = Math.max(...changed.map(t => Math.abs((propTags[t] || 0) - (curTags[t] || 0))), 1)
            return (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Tag Weight Changes</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {changed.map(tag => {
                    const from = curTags[tag] || 0
                    const to = propTags[tag] || 0
                    const diff = to - from
                    const barPct = Math.abs(diff) / maxDelta * 45
                    return (
                      <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                        {/* Tag name */}
                        <span style={{ fontSize: '12px', color: '#4a4a4a', width: '160px', flexShrink: 0, textAlign: 'right', paddingRight: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                        {/* From value */}
                        <span style={{ fontSize: '11px', color: '#999', width: '28px', textAlign: 'right', flexShrink: 0 }}>{from}</span>
                        {/* Diverging bar */}
                        <div style={{ flex: 1, height: '20px', position: 'relative', margin: '0 8px' }}>
                          {/* Center line */}
                          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#ddd' }} />
                          {/* Bar */}
                          {diff > 0 ? (
                            <div style={{
                              position: 'absolute', left: '50%', top: '3px', height: '14px',
                              width: `${barPct}%`, background: '#22c55e', borderRadius: '0 4px 4px 0',
                              transition: 'width 0.3s ease',
                            }} />
                          ) : (
                            <div style={{
                              position: 'absolute', right: '50%', top: '3px', height: '14px',
                              width: `${barPct}%`, background: '#ef4444', borderRadius: '4px 0 0 4px',
                              transition: 'width 0.3s ease',
                            }} />
                          )}
                        </div>
                        {/* To value */}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: diff > 0 ? '#16a34a' : '#dc2626', width: '28px', textAlign: 'left', flexShrink: 0 }}>{to}</span>
                        {/* Delta */}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: diff > 0 ? '#16a34a' : '#dc2626', width: '36px', textAlign: 'right', flexShrink: 0 }}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Tabs — hidden during refine preview */}
      {!refinePreview && <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid rgba(0,0,0,0.04)', marginBottom: '20px' }}>
        {[['profile', 'Profile'], ['documents', `Documents (${documents.length})`], ['tags', 'Tag Weights'], ['music', 'Music DNA'], ...(c.refinementHistory?.length > 0 ? [['adjustments', 'Adjustments']] : [])].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? '#1a1a1a' : '#999', background: 'none', border: 'none',
              borderBottom: activeTab === key ? '2px solid #E88FAC' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {label}
          </button>
        ))}
      </div>}

      {/* Profile tab */}
      {!refinePreview && activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {!c.profileSummary && status !== 'Analyzed' && status !== 'Reanalyze' && (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
              No profile yet. Upload documents and run analysis to generate.
            </div>
          )}

          {c.profileSummary && (
            <ProfileSection label="Profile Summary" text={c.profileSummary} />
          )}
          {c.brandVoiceNotes && (
            <ProfileSection label="Brand Voice" text={c.brandVoiceNotes} />
          )}
          {c.contentDirectionNotes && (
            <ProfileSection label="Content Direction" text={c.contentDirectionNotes} />
          )}
          {c.dosDonts && (
            <ProfileSection label="Do / Don't" text={c.dosDonts} mono />
          )}

          {topTags.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Top Tags</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {topTags.map(tw => (
                  <span key={tw.tag} style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, background: '#FFF0F3', color: '#E88FAC', border: '1px solid rgba(0,0,0,0.04)' }}>
                    {tw.tag} · {tw.weight}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Documents tab */}
      {!refinePreview && activeTab === 'documents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {documents.length === 0 && (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
              No documents yet. Click "+ Upload" to add voice memos, transcripts, or notes.
            </div>
          )}
          {documents.some(doc => c.profileLastAnalyzed && doc.uploadDate > c.profileLastAnalyzed) && (
            <div style={{ fontSize: '11px', color: '#d97706', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '6px 10px' }}>
              Yellow docs were uploaded after the last analysis and are not yet included. Hit Reanalyze to pick them up.
            </div>
          )}
          {documents.map(doc => (
            <DocumentRow key={doc.id} doc={doc} isNew={!!(c.profileLastAnalyzed && doc.uploadDate > c.profileLastAnalyzed)} />
          ))}
          <button onClick={() => setShowUpload(true)}
            style={{ marginTop: '4px', background: '#FFF5F7', color: '#999', border: '1px dashed #E8C4CC', borderRadius: '8px', padding: '10px', fontSize: '13px', cursor: 'pointer' }}>
            + Upload another document
          </button>
        </div>
      )}

      {/* Tag weights tab */}
      {!refinePreview && activeTab === 'tags' && (
        <TagWeightPanel tagWeights={tagWeights} />
      )}

      {/* Music DNA tab */}
      {!refinePreview && activeTab === 'music' && (
        <MusicDnaPanel creator={c} creatorId={creator.id} onUpdate={(dna) => {
          setProfile(prev => prev ? { ...prev, creator: { ...prev.creator, musicDnaProcessed: dna } } : prev)
        }} />
      )}

      {/* Adjustments tab */}
      {!refinePreview && activeTab === 'adjustments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(c.refinementHistory || []).length === 0 ? (
            <div style={{ color: '#555', fontSize: '13px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.04)' }}>
              No adjustments yet. Use the Refine field above to make targeted changes.
            </div>
          ) : (
            [...c.refinementHistory].reverse().map((entry, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '10px 14px', background: '#ffffff', borderRadius: '8px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              }}>
                <span style={{ fontSize: '11px', color: '#999', flexShrink: 0, paddingTop: '1px' }}>{entry.date}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: '#4a4a4a', lineHeight: '1.5' }}>{entry.summary}</div>
                  {entry.tagChanges?.length > 0 ? (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                      {entry.tagChanges.slice(0, 5).map(tc => {
                        const diff = tc.to - tc.from
                        return (
                          <span key={tc.tag} style={{
                            fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px',
                            background: diff > 0 ? '#F0FDF4' : '#FEF2F2',
                            color: diff > 0 ? '#16a34a' : '#dc2626',
                          }}>
                            {tc.tag} {diff > 0 ? '+' : ''}{diff}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '10px', color: '#999', marginTop: '4px', fontStyle: 'italic' }}>Text only — no tag changes</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      </>)}

      {showUpload && (
        <UploadModal
          creator={creator}
          onClose={() => setShowUpload(false)}
          onUploaded={load}
        />
      )}
    </div>
  )
}

function ProfileSection({ label, text, mono }) {
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{
        fontSize: '13px', color: '#4a4a4a', lineHeight: '1.6', whiteSpace: 'pre-wrap',
        fontFamily: mono ? 'monospace' : 'inherit', background: '#ffffff',
        borderRadius: '8px', padding: '12px 14px', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        {text}
      </div>
    </div>
  )
}

export default function CreatorsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [activeSection, setActiveSection] = useState(searchParams.get('tab') || 'earnings')
  useEffect(() => { const t = searchParams.get('tab'); if (t) setActiveSection(t) }, [searchParams])

  // Helper to update URL params without scroll
  const updateUrl = useCallback((creatorId, tab) => {
    const params = new URLSearchParams()
    if (creatorId) params.set('creator', creatorId)
    if (tab) params.set('tab', tab)
    const qs = params.toString()
    router.replace(`${pathname}${qs ? '?' + qs : ''}`, { scroll: false })
  }, [router, pathname])

  useEffect(() => {
    const urlCreatorId = searchParams.get('creator')
    // Load creators first (fast), show page immediately, then load invoicing in background
    fetch('/api/admin/palm-creators').then(r => r.json()).then(creatorsData => {
      const list = creatorsData.creators || []
      setCreators(list)

      // If URL has ?creator=, select that one
      if (urlCreatorId) {
        const match = list.find(c => c.id === urlCreatorId)
        if (match) { setSelected(match); setLoading(false); return }
      }

      if (list.length > 0 && !selected) setSelected(list[0])
      setLoading(false)

      // Background: load invoicing to re-sort by top earner (only if no URL creator)
      if (!urlCreatorId) {
        fetch('/api/admin/invoicing').then(r => r.json()).then(invoicingData => {
          const records = invoicingData.records || []
          const periods = invoicingData.periods || []
          if (list.length > 0 && periods.length > 0) {
            const latestKey = periods[0].key
            const periodRecords = records.filter(r => `${r.periodStart}|${r.periodEnd}` === latestKey)
            const byAka = {}
            for (const r of periodRecords) {
              byAka[r.aka] = (byAka[r.aka] || 0) + (r.earnings || 0)
            }
            const topAka = Object.entries(byAka).sort((a, b) => b[1] - a[1])[0]
            if (topAka) {
              const match = list.find(c => c.aka === topAka[0])
              if (match) setSelected(match)
            }
          }
        }).catch(() => {})
      }
    }).catch(() => setLoading(false))
  }, [])

  const handleProfileUpdated = (creatorId, status) => {
    setCreators(prev => prev.map(c => c.id === creatorId ? { ...c, profileAnalysisStatus: status } : c))
  }

  return (
    <div>
      {/* Header: dropdown + section buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <select
          value={selected?.id || ''}
          onChange={e => {
            const c = creators.find(c => c.id === e.target.value)
            setSelected(c || null)
            updateUrl(e.target.value, activeSection)
          }}
          style={{
            background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px',
            color: '#1a1a1a', fontSize: '14px', padding: '8px 14px', outline: 'none',
            minWidth: '220px', cursor: 'pointer',
          }}>
          {!selected && <option value="">Select a creator...</option>}
          {creators.map(c => (
            <option key={c.id} value={c.id}>
              {c.name || c.aka}{c.aka && c.name ? ` (${c.aka})` : ''}
            </option>
          ))}
        </select>
        {selected && (
          <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid rgba(0,0,0,0.04)' }}>
            {[['earnings', 'Earnings'], ['fans', 'Fans'], ['dna', 'DNA Profile']].map(([key, label]) => (
              <button key={key} onClick={() => { setActiveSection(key); updateUrl(selected?.id, key) }}
                style={{
                  padding: '6px 16px', fontSize: '13px', fontWeight: activeSection === key ? 700 : 400,
                  color: activeSection === key ? '#1a1a1a' : '#bbb', background: 'none', border: 'none',
                  borderBottom: activeSection === key ? '2px solid #E88FAC' : '2px solid transparent',
                  cursor: 'pointer', marginBottom: '-2px',
                }}>
                {label}
              </button>
            ))}
          </div>
        )}
        {loading && <span style={{ color: '#999', fontSize: '13px' }}>Loading...</span>}
      </div>

      {/* Detail panel */}
      {!selected ? (
        <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '60px 0' }}>
          Select a creator above to get started.
        </div>
      ) : (
        <div style={{ background: (activeSection === 'earnings' || activeSection === 'fans') ? 'transparent' : '#ffffff', border: 'none', boxShadow: (activeSection === 'earnings' || activeSection === 'fans') ? 'none' : '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: (activeSection === 'earnings' || activeSection === 'fans') ? '0' : '24px' }}>
          <CreatorDetail
            key={selected.id}
            creator={selected}
            onProfileUpdated={handleProfileUpdated}
            activeSection={activeSection}
          />
        </div>
      )}
    </div>
  )
}
