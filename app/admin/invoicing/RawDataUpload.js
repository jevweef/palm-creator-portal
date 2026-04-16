'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCutoff(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

const CREATORS = ['Amelia', 'Laurel', 'Taby', 'Gracie', 'MG']

function DataCoverageChart({ creators: coverageCreators, loading: coverageLoading }) {
  const scrollRef = useRef(null)

  // Auto-scroll to the right (newest dates) on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [coverageCreators])

  if (coverageLoading) {
    return (
      <div style={{
        background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.06)',
        padding: '20px 24px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>
          Data Coverage
        </div>
        <div style={{ fontSize: '13px', color: '#ccc', padding: '20px 0', textAlign: 'center' }}>Loading coverage data...</div>
      </div>
    )
  }

  if (!coverageCreators || coverageCreators.length === 0) return null

  // Determine x-axis range: default to last 2 months, expand if data exists earlier
  const today = new Date()
  const twoMonthsAgo = new Date(today)
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
  twoMonthsAgo.setDate(1)

  // Collect all dates from creators
  const allDates = coverageCreators.flatMap(c =>
    [c.earningsStart, c.earningsEnd, c.chargebackStart, c.chargebackEnd].filter(Boolean)
  )
  const sortedDates = [...allDates].sort()
  const dataStart = sortedDates.length > 0 ? new Date(sortedDates[0] + 'T00:00:00') : twoMonthsAgo
  const dataEnd = sortedDates.length > 0 ? new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00') : today

  const globalStart = new Date(Math.min(dataStart, twoMonthsAgo))
  const globalEnd = new Date(Math.max(dataEnd, today))
  const totalDays = Math.max(1, (globalEnd - globalStart) / 86400000)

  // Chart width: 8px per day, minimum 600px
  const chartWidth = Math.max(600, totalDays * 8)
  const todayStr = today.toISOString().split('T')[0]

  // Generate period lines (1st and 15th of each month) and period labels
  const periodLines = []
  const periodLabels = []
  const cursor = new Date(globalStart)
  cursor.setDate(1)
  while (cursor <= globalEnd) {
    const yr = cursor.getFullYear()
    const mo = cursor.getMonth()
    const d1 = new Date(yr, mo, 1)
    const d15 = new Date(yr, mo, 15)
    const lastDay = new Date(yr, mo + 1, 0).getDate() // last day of month

    if (d1 >= globalStart && d1 <= globalEnd) periodLines.push({ date: new Date(d1), isFirst: true })
    if (d15 >= globalStart && d15 <= globalEnd) periodLines.push({ date: new Date(d15), isFirst: false })

    // Period 1: 1st – 14th
    const p1Start = new Date(yr, mo, 1)
    const p1End = new Date(yr, mo, 14)
    if (p1End >= globalStart && p1Start <= globalEnd) {
      const moAbbr = p1Start.toLocaleDateString('en-US', { month: 'short' })
      periodLabels.push({ start: p1Start, end: p1End, label: `${moAbbr} 1 – ${moAbbr} 14` })
    }

    // Period 2: 15th – end of month
    const p2Start = new Date(yr, mo, 15)
    const p2End = new Date(yr, mo, lastDay)
    if (p2End >= globalStart && p2Start <= globalEnd) {
      const moAbbr = p2Start.toLocaleDateString('en-US', { month: 'short' })
      periodLabels.push({ start: p2Start, end: p2End, label: `${moAbbr} 15 – ${moAbbr} ${lastDay}` })
    }

    cursor.setMonth(cursor.getMonth() + 1)
  }

  function dateToPx(dateStr) {
    const d = new Date(dateStr + 'T00:00:00')
    return Math.max(0, Math.min(chartWidth, ((d - globalStart) / 86400000 / totalDays) * chartWidth))
  }

  function fmtShort(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function fmtUpload(iso) {
    if (!iso) return null
    const d = new Date(iso)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const sortedCreators = [...coverageCreators].sort((a, b) => a.aka.localeCompare(b.aka))

  return (
    <div style={{
      background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)',
      padding: '20px 24px', marginBottom: '20px',
    }}>
      <style>{`
        .coverage-scroll-main::-webkit-scrollbar { height: 4px; }
        .coverage-scroll-main::-webkit-scrollbar-track { background: transparent; }
        .coverage-scroll-main::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }
        .coverage-scroll-main::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
      `}</style>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>
        Data Coverage
      </div>

      <div style={{ display: 'flex' }}>
        {/* Creator names column (fixed) */}
        <div style={{ width: '130px', flexShrink: 0 }}>
          <div style={{ height: '20px', marginBottom: '4px' }} /> {/* spacer for date labels */}
          {sortedCreators.map(c => (
            <div key={c.id} style={{ height: '35px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{c.aka || '—'}</span>
            </div>
          ))}
        </div>

        {/* Scrollable chart area */}
        <div ref={scrollRef} className="coverage-scroll-main" style={{ flex: 1, overflowX: 'auto', position: 'relative' }}>
          <div style={{ width: `${chartWidth}px`, minWidth: '100%', paddingRight: '24px' }}>
            {/* X-axis — period range labels centered in each pay period */}
            <div style={{ position: 'relative', height: '20px', marginBottom: '4px' }}>
              {periodLabels.map((p, i) => {
                const startPx = ((p.start - globalStart) / 86400000 / totalDays) * chartWidth
                const endPx = ((p.end - globalStart) / 86400000 / totalDays) * chartWidth
                const centerPx = (startPx + endPx) / 2
                return (
                  <span key={i} style={{
                    position: 'absolute', left: `${centerPx}px`, transform: 'translateX(-50%)',
                    fontSize: '9px', color: '#aaa', whiteSpace: 'nowrap', fontWeight: 500,
                  }}>
                    {p.label}
                  </span>
                )
              })}
            </div>

            {/* Creator rows */}
            {sortedCreators.map(c => {
              const hasEarnings = c.earningsStart && c.earningsEnd
              const hasChargebacks = c.chargebackStart && c.chargebackEnd
              return (
                <div key={c.id} style={{ height: '35px', position: 'relative' }}>
                  {/* Period lines */}
                  {periodLines.map((p, i) => {
                    const px = ((p.date - globalStart) / 86400000 / totalDays) * chartWidth
                    return (
                      <div key={i} style={{
                        position: 'absolute', left: `${px}px`, top: 0, bottom: 0, width: '1px',
                        background: p.isFirst ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)', zIndex: 0,
                      }} />
                    )
                  })}

                  {/* Sales bar */}
                  <div style={{ position: 'relative', height: '14px', marginBottom: '3px' }}>
                    {/* Gray background bar spanning full timeline to today */}
                    <div style={{
                      position: 'absolute', left: 0,
                      width: `${dateToPx(todayStr)}px`,
                      height: '100%', borderRadius: '3px',
                      background: '#f3f4f6', opacity: 0.5,
                    }} />
                    {hasEarnings && (
                      <div title={c.earningsLastUpload ? `Last upload: ${fmtUpload(c.earningsLastUpload)}` : `Data through ${fmtShort(c.earningsEnd)}, ${new Date(c.earningsEnd + 'T00:00:00').getFullYear()}`} style={{
                        position: 'absolute',
                        left: `${dateToPx(c.earningsStart)}px`,
                        width: `${Math.max(4, dateToPx(c.earningsEnd) - dateToPx(c.earningsStart))}px`,
                        height: '100%', borderRadius: '3px', cursor: 'default',
                        background: 'linear-gradient(90deg, #86efac, #22c55e)',
                        opacity: 0.85, zIndex: 1,
                      }} />
                    )}
                  </div>

                  {/* Chargebacks bar */}
                  <div style={{ position: 'relative', height: '14px' }}>
                    {/* Gray background bar spanning full timeline to today */}
                    <div style={{
                      position: 'absolute', left: 0,
                      width: `${dateToPx(todayStr)}px`,
                      height: '100%', borderRadius: '3px',
                      background: '#f3f4f6', opacity: 0.5,
                    }} />
                    {hasChargebacks && (
                      <div title={c.chargebacksLastUpload ? `Last upload: ${fmtUpload(c.chargebacksLastUpload)}` : `Data through ${fmtShort(c.chargebackEnd)}, ${new Date(c.chargebackEnd + 'T00:00:00').getFullYear()}`} style={{
                        position: 'absolute',
                        left: `${dateToPx(c.chargebackStart)}px`,
                        width: `${Math.max(4, dateToPx(c.chargebackEnd) - dateToPx(c.chargebackStart))}px`,
                        height: '100%', borderRadius: '3px', cursor: 'default',
                        background: 'linear-gradient(90deg, #fca5a5, #ef4444)',
                        opacity: 0.85, zIndex: 1,
                      }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginLeft: '130px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '8px', borderRadius: '2px', background: 'linear-gradient(90deg, #86efac, #22c55e)' }} />
          <span style={{ fontSize: '10px', color: '#999' }}>Earnings</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '8px', borderRadius: '2px', background: 'linear-gradient(90deg, #fca5a5, #ef4444)' }} />
          <span style={{ fontSize: '10px', color: '#999' }}>Chargebacks</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '1px', height: '10px', background: 'rgba(0,0,0,0.15)' }} />
          <span style={{ fontSize: '10px', color: '#999' }}>Invoice periods (1st &amp; 15th)</span>
        </div>
      </div>
    </div>
  )
}

export default function RawDataUpload() {
  const [creator, setCreator] = useState(CREATORS[0])
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [cutoffs, setCutoffs] = useState({})
  const [spreadsheetUrl, setSpreadsheetUrl] = useState(null)
  const [coverageCreators, setCoverageCreators] = useState([])
  const [coverageLoading, setCoverageLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const loadCutoffs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invoicing/upload-transactions')
      if (res.ok) {
        const data = await res.json()
        setCutoffs(data.tabs || {})
        setSpreadsheetUrl(data.spreadsheetUrl)
      }
    } catch {}
  }, [])

  const loadCoverage = useCallback(async () => {
    try {
      setCoverageLoading(true)
      const res = await fetch('/api/admin/earnings-coverage')
      if (res.ok) {
        const data = await res.json()
        setCoverageCreators(data.creators || [])
      }
    } catch {} finally {
      setCoverageLoading(false)
    }
  }, [])

  useEffect(() => { loadCutoffs(); loadCoverage() }, [loadCutoffs, loadCoverage])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('creator', creator)

      const res = await fetch('/api/admin/invoicing/upload-transactions', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      loadCutoffs()
      loadCoverage()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.html') || f.name.endsWith('.htm'))) {
      setFile(f)
      setError(null)
    } else {
      setError('Please drop an HTML file (.html)')
    }
  }

  const salesCutoff = cutoffs[`${creator} - Sales`]
  const cbCutoff = cutoffs[`${creator} - Chargebacks`]

  return (
    <div>
      {/* Data coverage timeline — full width */}
      <DataCoverageChart creators={coverageCreators} loading={coverageLoading} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>
            Raw Data Upload
          </h2>
          <p style={{ fontSize: '13px', color: '#999', margin: '4px 0 0' }}>
            Upload saved OF statements page to extract transactions
          </p>
        </div>
        {spreadsheetUrl && (
          <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: '12px', color: '#E88FAC', textDecoration: 'none',
              border: '1px solid #E8C4CC', borderRadius: '6px', padding: '6px 12px',
            }}>
            View Spreadsheet ↗
          </a>
        )}
      </div>

      {/* Creator selector */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
          Creator
        </label>
        <select value={creator} onChange={e => setCreator(e.target.value)}
          style={{
            width: '100%', maxWidth: '300px', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px',
            color: '#1a1a1a', fontSize: '14px', padding: '10px 12px', outline: 'none',
          }}>
          {CREATORS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Cutoff notices */}
      {(salesCutoff || cbCutoff) && (
        <div style={{
          background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px',
          padding: '12px 16px', marginBottom: '16px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#C2410C', marginBottom: '6px' }}>
            Upload Cutoffs for {creator}
          </div>
          {salesCutoff && (
            <div style={{ fontSize: '13px', color: '#9A3412', marginBottom: '2px' }}>
              Sales: only upload after <strong>{fmtCutoff(salesCutoff)}</strong>
            </div>
          )}
          {cbCutoff && (
            <div style={{ fontSize: '13px', color: '#9A3412' }}>
              Chargebacks: only upload after <strong>{fmtCutoff(cbCutoff)}</strong>
            </div>
          )}
        </div>
      )}

      {/* How-to */}
      <div style={{
        background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px',
        padding: '14px 16px', marginBottom: '16px', fontSize: '13px', color: '#64748B',
      }}>
        <strong style={{ color: '#475569' }}>How to upload:</strong>
        <ol style={{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: '1.7' }}>
          <li>Go to the creator's OF Statements → Earnings page</li>
          <li>Scroll down as far as you want to load transactions</li>
          <li>File → Save As → "Webpage, Complete"</li>
          <li>Upload the .html file below</li>
        </ol>
      </div>

      {/* File upload / drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#E88FAC' : file ? '#22c55e' : '#e5e7eb'}`,
          borderRadius: '12px', padding: '40px 20px', textAlign: 'center',
          cursor: 'pointer', marginBottom: '16px', transition: 'all 0.15s',
          background: dragOver ? '#FFF0F3' : file ? '#F0FDF4' : '#FAFAFA',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm"
          onChange={e => { if (e.target.files[0]) { setFile(e.target.files[0]); setError(null) }}}
          style={{ display: 'none' }}
        />
        {file ? (
          <>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>✓</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#166534' }}>{file.name}</div>
            <div style={{ fontSize: '12px', color: '#22c55e', marginTop: '4px' }}>
              {(file.size / 1024 / 1024).toFixed(1)} MB — Ready to upload
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.4 }}>📄</div>
            <div style={{ fontSize: '14px', color: '#999' }}>
              Drop HTML file here or <span style={{ color: '#E88FAC', fontWeight: 600 }}>click to browse</span>
            </div>
            <div style={{ fontSize: '12px', color: '#ccc', marginTop: '4px' }}>
              Accepts .html files saved from OF Statements page
            </div>
          </>
        )}
      </div>

      {/* Upload button */}
      <button onClick={handleUpload} disabled={uploading || !file}
        style={{
          background: file ? '#E88FAC' : '#f3f4f6',
          border: 'none', borderRadius: '8px',
          color: file ? '#fff' : '#999',
          fontSize: '14px', fontWeight: 600, padding: '12px 24px',
          cursor: file && !uploading ? 'pointer' : 'not-allowed',
          opacity: uploading ? 0.6 : 1, width: '100%',
          transition: 'all 0.15s',
        }}>
        {uploading ? 'Uploading & parsing...' : 'Upload Transactions'}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: '16px', padding: '12px 16px', background: '#FEF2F2',
          border: '1px solid #FECACA', borderRadius: '10px', fontSize: '13px', color: '#DC2626',
        }}>
          {error}
        </div>
      )}

      {/* Success result */}
      {result && (
        <div style={{
          marginTop: '16px', background: '#F0FDF4', border: '1px solid #BBF7D0',
          borderRadius: '12px', padding: '16px 20px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#166534', marginBottom: '8px' }}>
            {result.message}
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {[
              { label: 'Parsed', value: result.parsed },
              { label: 'Uploaded', value: result.uploaded },
              { label: 'Skipped', value: result.skipped },
              { label: 'With Usernames', value: result.withUsernames },
              { label: 'Gross', value: fmt(result.totalGross) },
              { label: 'Net', value: fmt(result.totalNet) },
            ].map(s => (
              <div key={s.label} style={{ fontSize: '12px', color: '#166534' }}>
                <span style={{ color: '#4ADE80', fontWeight: 500 }}>{s.label}:</span>{' '}
                <span style={{ fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
          </div>

          {result.typeBreakdown && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, marginBottom: '4px' }}>By Type:</div>
              {Object.entries(result.typeBreakdown).map(([type, total]) => (
                <div key={type} style={{ fontSize: '12px', color: '#166534', paddingLeft: '8px' }}>
                  {type}: {fmt(total)}
                </div>
              ))}
            </div>
          )}

          {result.topFans?.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, marginBottom: '4px' }}>Top Fans:</div>
              {result.topFans.map(f => (
                <div key={f.name} style={{ fontSize: '12px', color: '#166534', paddingLeft: '8px' }}>
                  {f.name}: {fmt(f.total)}
                </div>
              ))}
            </div>
          )}

          {result.overlapMethod && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#15803D', fontStyle: 'italic' }}>
              Dedup: {result.overlapMethod === 'fingerprint' ? 'matched last transaction in sheet, appended new rows after overlap' : result.overlapMethod === 'cutoff_fallback' ? 'no exact match found, used timestamp cutoff' : 'first upload, no dedup needed'}
            </div>
          )}
          {result.cutoff && (
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#15803D', fontStyle: 'italic' }}>
              Latest transaction: {fmtCutoff(result.cutoff)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
