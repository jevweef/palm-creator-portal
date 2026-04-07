'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

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
const TYPE_LABELS = { 'Payment for message': 'PPV', 'Recurring subscription': 'Subscription' }
const typeLabel = t => TYPE_LABELS[t] || t

const PERIOD_PRESETS = [
  { key: 'last30', label: 'Last 30 Days', days: 30 },
  { key: 'last90', label: 'Last 90 Days', days: 90 },
  { key: 'mtd', label: 'MTD' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'qtd', label: 'This Quarter' },
  { key: 'lastQuarter', label: 'Last Quarter' },
  { key: 'ytd', label: 'YTD' },
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
  return `${months[parseInt(m)-1]} ${parseInt(d)},\n${y}`
}

function fmtChartMoney(v) {
  if (v >= 1000) return '$' + (v/1000).toFixed(v >= 10000 ? 0 : 1) + 'k'
  return '$' + Math.round(v)
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
      if (typeFilter !== 'all') val = d.byType?.[typeFilter] || 0
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
      const val = typeFilter !== 'all' ? (d.byType?.[typeFilter] || 0) : d.net
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
  const pad = { t: 10, r: 50, b: 45, l: 10 }
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
      {/* Chart header — OF style */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>{fmtM(totalNet)}</span>
          <span style={{ fontSize: '14px', color: '#999' }}>({fmtM(totalGross)} Gross)</span>
          {pctChange !== null && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              background: pctChange >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: pctChange >= 0 ? '#16a34a' : '#dc2626',
              padding: '3px 10px', borderRadius: '14px', fontSize: '13px', fontWeight: 600, marginLeft: '8px',
            }}>
              {pctChange >= 0 ? '↗' : '↘'} {Math.abs(pctChange).toFixed(1)}%
            </span>
          )}
        </div>
        <button onClick={() => setScaleMode(scaleMode === 'fit' ? 'relative' : 'fit')}
          title={scaleMode === 'fit' ? 'Scale: Fit to visible data — click for relative' : 'Scale: Relative to all-time peak — click to fit'}
          style={{
            background: scaleMode === 'relative' ? '#FFF0F3' : '#f9f9f9',
            border: scaleMode === 'relative' ? '1px solid #E88FAC' : '1px solid #e5e7eb',
            borderRadius: '5px', padding: '3px 8px', fontSize: '10px', color: scaleMode === 'relative' ? '#E88FAC' : '#999',
            cursor: 'pointer', fontWeight: 500,
          }}>
          {scaleMode === 'fit' ? 'Fit' : 'Relative'}
        </button>
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${CW} ${CH}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair' }}
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
        {xLabels.map(({ pos, label }, i) => {
          const lines = label.split('\n')
          return (
            <text key={i} x={pad.l + pos * cw} y={CH - 18} textAnchor="middle" fill="#999" fontSize={10} fontFamily="system-ui">
              {lines.map((line, li) => (
                <tspan key={li} x={pad.l + pos * cw} dy={li === 0 ? 0 : 12}>{line}</tspan>
              ))}
            </text>
          )
        })}

        {/* Hover */}
        {hover && (() => {
          const ttW = 150, ttH = 42
          const ttX = Math.max(10, Math.min(hover.cx - ttW/2, CW - ttW - 10))
          const ttY = hover.cyE > ttH + 30 ? hover.cyE - ttH - 12 : hover.cyE + 16
          return (
            <g>
              <line x1={hover.cx} x2={hover.cx} y1={pad.t} y2={pad.t + ch} stroke="rgba(0,0,0,0.1)" strokeWidth={1} />
              <circle cx={hover.cx} cy={hover.cyE} r={4} fill="#E88FAC" stroke="#fff" strokeWidth={2} />
              <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={6} fill="#fff" stroke="rgba(0,0,0,0.08)" strokeWidth={1} style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.06))' }} />
              <text x={ttX + ttW/2} y={ttY + 16} textAnchor="middle" fill="#1a1a1a" fontSize={11} fontWeight={700} fontFamily="system-ui">{hover.date}</text>
              <circle cx={ttX + 14} cy={ttY + 32} r={3.5} fill="#E88FAC" />
              <text x={ttX + 24} y={ttY + 35} fill="#999" fontSize={10} fontFamily="system-ui">Earnings</text>
              <text x={ttX + ttW - 12} y={ttY + 35} textAnchor="end" fill="#1a1a1a" fontSize={10} fontWeight={600} fontFamily="system-ui">{fmtM(hover.net)}</text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}

// ── Whale Row (expandable) ──────────────────────────────────────────────────

function WhaleRow({ whale: w, index: i, fmtMoney }) {
  const [expanded, setExpanded] = useState(false)
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
          <svg viewBox={`0 0 ${MW} ${MH}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
            <defs>
              <linearGradient id={`whaleGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(232,143,172,0.2)" />
                <stop offset="100%" stopColor="rgba(232,143,172,0.02)" />
              </linearGradient>
            </defs>

            {/* Investigation zone (one month after peak) */}
            {inspectStartIdx >= 0 && inspectEnd >= 0 && (
              <rect
                x={mpx(inspectStartIdx)} y={MP.t}
                width={mpx(inspectEnd) - mpx(inspectStartIdx)}
                height={mH}
                fill="rgba(220,38,38,0.06)" stroke="rgba(220,38,38,0.15)" strokeWidth={1} strokeDasharray="4,3"
                rx={4}
              />
            )}

            {/* Peak period highlight */}
            {w.peakStart && (() => {
              const peakStartIdx = timeline.findIndex(t => t.week >= w.peakStart)
              const peakEndIdx = w.peakEnd ? timeline.findIndex(t => t.week >= w.peakEnd) : peakStartIdx + 4
              if (peakStartIdx >= 0) {
                return (
                  <rect
                    x={mpx(peakStartIdx)} y={MP.t}
                    width={mpx(Math.min(peakEndIdx, timeline.length - 1)) - mpx(peakStartIdx)}
                    height={mH}
                    fill="rgba(232,143,172,0.08)" stroke="rgba(232,143,172,0.2)" strokeWidth={1}
                    rx={4}
                  />
                )
              }
              return null
            })()}

            {/* Area */}
            {miniArea && <path d={miniArea} fill={`url(#whaleGrad${i})`} />}
            {/* Line */}
            {miniPath && <path d={miniPath} fill="none" stroke="#E88FAC" strokeWidth={1} />}

            {/* Data points */}
            {timeline.map((t, idx) => (
              <circle key={idx} cx={mpx(idx)} cy={mpy(t.spend)} r={2}
                fill={t.spend === 0 ? '#DC2626' : '#E88FAC'} />
            ))}

            {/* X labels (every 4th week) */}
            {timeline.filter((_, idx) => idx % Math.max(Math.floor(timeline.length / 6), 1) === 0).map((t, idx) => {
              const realIdx = timeline.indexOf(t)
              return (
                <text key={idx} x={mpx(realIdx)} y={MH - 3} textAnchor="middle" fill="#999" fontSize={9}>
                  {t.week}
                </text>
              )
            })}
          </svg>
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
  const [showWhales, setShowWhales] = useState(false)

  if (loading) return <div style={{ color: '#999', fontSize: '13px', padding: '40px 0', textAlign: 'center' }}>Loading earnings data...</div>
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

  const { summary, byType, topFans, dailyData, whaleAlerts, whaleCount, cachedAt } = data
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
  const periodTypeTotal = Object.values(periodByType).reduce((s, v) => s + v, 0)

  // Compute previous period of same duration for % change
  let prevPeriodNet = 0
  if (periodStart && periodEnd) {
    const durationMs = periodEnd.getTime() - periodStart.getTime()
    const prevEnd = new Date(periodStart.getTime() - 1) // day before current period start
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
  const allTypes = [...new Set(Object.keys(byType))]

  return (
    <div>
      {/* Controls bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
              color: '#1a1a1a', fontSize: '12px', padding: '5px 10px', outline: 'none', cursor: 'pointer',
            }}>
            {PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Custom Range</option>
          </select>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: '#999' }}>Period: <strong style={{ color: '#1a1a1a' }}>{fmtMoney(periodNet)}</strong></span>
          <span style={{ color: '#e5e7eb' }}>|</span>
          <span style={{ fontSize: '13px', color: '#999' }}>All-time: <strong style={{ color: '#1a1a1a' }}>{fmtMoney(summary.totalNet)}</strong></span>
          <span style={{ color: '#e5e7eb' }}>|</span>
          <span style={{ fontSize: '13px', color: '#999' }}>{fmtNum(summary.transactionCount)} txns</span>
          <button onClick={onRefresh} title="Refresh" style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '5px', padding: '3px 6px', cursor: 'pointer', fontSize: '11px', color: '#ccc' }}>↺</button>
        </div>
      </div>

      {/* Type filters inline */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
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
        {/* Type breakdown inline */}
        <div style={{ marginLeft: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {Object.entries(periodByType).sort((a, b) => b[1] - a[1]).map(([type, net]) => (
            <span key={type} style={{ fontSize: '10px', color: '#999' }}>
              {typeLabel(type)}: <strong style={{ color: '#666' }}>{fmtMoney(net)}</strong>
              <span style={{ color: '#ddd' }}> ({periodTypeTotal > 0 ? Math.round((net / periodTypeTotal) * 100) : 0}%)</span>
            </span>
          ))}
        </div>
      </div>

      {/* Revenue chart — immediately visible */}
      <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '12px 16px', marginBottom: '12px' }}>
        <RevenueChart dailyData={filteredDaily} allDailyData={dailyData} typeFilter={typeFilter} pctChange={pctChange} milestones={[
          ...(creator?.managementStartDate ? [{ date: creator.managementStartDate, label: 'Joined Palm' }] : []),
        ]} />
      </div>

      {/* Whale alerts banner */}
      {whaleCount > 0 && (
        <button onClick={() => setShowWhales(!showWhales)}
          style={{
            width: '100%', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px',
            padding: '8px 14px', marginBottom: '10px', cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
          <div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#DC2626' }}>{whaleCount} whale{whaleCount !== 1 ? 's' : ''} gone cold</span>
            <span style={{ fontSize: '11px', color: '#999', marginLeft: '6px' }}>Last 30 days below 25% of peak</span>
          </div>
          <span style={{ color: '#DC2626', fontSize: '14px' }}>{showWhales ? '▲' : '▼'}</span>
        </button>
      )}

      {/* Whale details — expandable */}
      {showWhales && whaleAlerts && (
        <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden', marginBottom: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 140px 100px 100px 100px 90px 70px', padding: '8px 16px', fontSize: '9px', fontWeight: 600, color: '#999', textTransform: 'uppercase', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <span></span><span>Fan</span><span>Peak Period</span><span style={{ textAlign: 'right' }}>Peak 30-day</span><span style={{ textAlign: 'right' }}>Last 30 days</span><span style={{ textAlign: 'right' }}>Lifetime</span><span style={{ textAlign: 'right' }}>Last Txn</span><span style={{ textAlign: 'center' }}>Status</span>
          </div>
          {whaleAlerts.map((w, i) => (
            <WhaleRow key={w.fan} whale={w} index={i} fmtMoney={fmtMoney} />
          ))}
        </div>
      )}

      {/* Top fans */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Top Fans</div>
        <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 100px 60px 90px', padding: '10px 16px', fontSize: '10px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <span>#</span><span>Name</span><span>Username</span><span style={{ textAlign: 'right' }}>Spent</span><span style={{ textAlign: 'right' }}>Txns</span><span style={{ textAlign: 'right' }}>Last Active</span>
          </div>
          {topFans.map((fan, i) => (
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
        </div>
      </div>
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

  // Lazy-load earnings when section is opened
  useEffect(() => {
    if (activeSection === 'earnings' && !earningsData && !earningsLoading) {
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
    }
  }, [activeSection, earningsData, earningsLoading, creator])

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
        {[['profile', 'Profile'], ['documents', `Documents (${documents.length})`], ['tags', 'Tag Weights'], ...(c.refinementHistory?.length > 0 ? [['adjustments', 'Adjustments']] : [])].map(([key, label]) => (
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
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [activeSection, setActiveSection] = useState('earnings')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/palm-creators').then(r => r.json()),
      fetch('/api/admin/invoicing').then(r => r.json()),
    ]).then(([creatorsData, invoicingData]) => {
      const list = creatorsData.creators || []
      setCreators(list)

      // Auto-select highest earner from most recent pay period
      const records = invoicingData.records || []
      const periods = invoicingData.periods || []
      if (list.length > 0 && !selected) {
        let topCreator = list[0]
        if (periods.length > 0) {
          const latestKey = periods[0].key
          const periodRecords = records.filter(r => `${r.periodStart}|${r.periodEnd}` === latestKey)
          // Sum earnings by aka
          const byAka = {}
          for (const r of periodRecords) {
            byAka[r.aka] = (byAka[r.aka] || 0) + (r.earnings || 0)
          }
          const topAka = Object.entries(byAka).sort((a, b) => b[1] - a[1])[0]
          if (topAka) {
            const match = list.find(c => c.aka === topAka[0])
            if (match) topCreator = match
          }
        }
        setSelected(topCreator)
      }
      setLoading(false)
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
            {[['earnings', 'Earnings'], ['dna', 'DNA Profile']].map(([key, label]) => (
              <button key={key} onClick={() => setActiveSection(key)}
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
        <div style={{ background: activeSection === 'earnings' ? 'transparent' : '#ffffff', border: 'none', boxShadow: activeSection === 'earnings' ? 'none' : '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: activeSection === 'earnings' ? '0' : '24px' }}>
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
