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

function DataCoverageChart({ cutoffs, ranges }) {
  if (!ranges || Object.keys(ranges).length === 0) return null

  // Group by creator
  const creators = {}
  for (const [tabName, range] of Object.entries(ranges)) {
    const [creatorName, type] = tabName.split(' - ')
    if (!creatorName || !type) continue
    if (!creators[creatorName]) creators[creatorName] = {}
    creators[creatorName][type] = range
  }

  if (Object.keys(creators).length === 0) return null

  // Find global date range for the x-axis
  const allDates = Object.values(ranges).flatMap(r => [r.earliest, r.latest]).filter(Boolean)
  if (allDates.length === 0) return null
  const sortedDates = [...allDates].sort()
  const globalStart = new Date(sortedDates[0] + 'T00:00:00')
  const globalEnd = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00')
  const totalDays = Math.max(1, (globalEnd - globalStart) / 86400000)

  // Generate invoice period lines (1st and 15th of each month)
  const periodLines = []
  const cursor = new Date(globalStart)
  cursor.setDate(1)
  while (cursor <= globalEnd) {
    const d1 = new Date(cursor)
    d1.setDate(1)
    if (d1 >= globalStart && d1 <= globalEnd) periodLines.push(new Date(d1))
    const d15 = new Date(cursor)
    d15.setDate(15)
    if (d15 >= globalStart && d15 <= globalEnd) periodLines.push(new Date(d15))
    cursor.setMonth(cursor.getMonth() + 1)
  }

  function dateToPct(dateStr) {
    const d = new Date(dateStr + 'T00:00:00')
    return Math.max(0, Math.min(100, ((d - globalStart) / 86400000 / totalDays) * 100))
  }

  function fmtShort(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const sortedCreators = Object.keys(creators).sort()

  return (
    <div style={{
      background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.06)',
      padding: '20px 24px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>
        Data Coverage
      </div>

      {/* X-axis date labels */}
      <div style={{ position: 'relative', height: '16px', marginLeft: '100px', marginBottom: '4px' }}>
        {periodLines.map((d, i) => {
          const pct = ((d - globalStart) / 86400000 / totalDays) * 100
          return (
            <span key={i} style={{
              position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)',
              fontSize: '9px', color: '#ccc', whiteSpace: 'nowrap',
            }}>
              {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )
        })}
      </div>

      {/* Creator rows */}
      {sortedCreators.map(name => {
        const sales = creators[name]?.Sales
        const cbs = creators[name]?.Chargebacks
        return (
          <div key={name} style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              <div style={{ width: '100px', flexShrink: 0, fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>
                {name}
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                {/* Period lines */}
                {periodLines.map((d, i) => {
                  const pct = ((d - globalStart) / 86400000 / totalDays) * 100
                  return (
                    <div key={i} style={{
                      position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: '1px',
                      background: 'rgba(0,0,0,0.06)', zIndex: 0,
                    }} />
                  )
                })}

                {/* Sales bar */}
                <div style={{ position: 'relative', height: '14px', marginBottom: '3px' }}>
                  {sales ? (
                    <div title={`Sales: ${fmtShort(sales.earliest)} → ${fmtShort(sales.latest)} (${sales.rowCount} txns)`} style={{
                      position: 'absolute',
                      left: `${dateToPct(sales.earliest)}%`,
                      width: `${Math.max(1, dateToPct(sales.latest) - dateToPct(sales.earliest))}%`,
                      height: '100%', borderRadius: '3px',
                      background: 'linear-gradient(90deg, #86efac, #22c55e)',
                      opacity: 0.85,
                    }} />
                  ) : (
                    <div style={{ height: '100%', background: '#f3f4f6', borderRadius: '3px', opacity: 0.5 }} />
                  )}
                  <span style={{ position: 'absolute', right: '-54px', top: '1px', fontSize: '9px', color: '#aaa', width: '50px' }}>
                    {sales ? fmtShort(sales.latest) : '—'}
                  </span>
                </div>

                {/* Chargebacks bar */}
                <div style={{ position: 'relative', height: '14px' }}>
                  {cbs ? (
                    <div title={`Chargebacks: ${fmtShort(cbs.earliest)} → ${fmtShort(cbs.latest)} (${cbs.rowCount} txns)`} style={{
                      position: 'absolute',
                      left: `${dateToPct(cbs.earliest)}%`,
                      width: `${Math.max(1, dateToPct(cbs.latest) - dateToPct(cbs.earliest))}%`,
                      height: '100%', borderRadius: '3px',
                      background: 'linear-gradient(90deg, #fca5a5, #ef4444)',
                      opacity: 0.85,
                    }} />
                  ) : (
                    <div style={{ height: '100%', background: '#f3f4f6', borderRadius: '3px', opacity: 0.5 }} />
                  )}
                  <span style={{ position: 'absolute', right: '-54px', top: '1px', fontSize: '9px', color: '#aaa', width: '50px' }}>
                    {cbs ? fmtShort(cbs.latest) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginLeft: '100px' }}>
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
  const [ranges, setRanges] = useState({})
  const [spreadsheetUrl, setSpreadsheetUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const loadCutoffs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invoicing/upload-transactions')
      if (res.ok) {
        const data = await res.json()
        setCutoffs(data.tabs || {})
        setRanges(data.ranges || {})
        setSpreadsheetUrl(data.spreadsheetUrl)
      }
    } catch {}
  }, [])

  useEffect(() => { loadCutoffs() }, [loadCutoffs])

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
    <div style={{ maxWidth: '720px' }}>
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

      {/* Data coverage timeline */}
      <DataCoverageChart cutoffs={cutoffs} ranges={ranges} />

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
