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

const CREATORS = ['Taby']

export default function RawDataUpload() {
  const [creator, setCreator] = useState(CREATORS[0])
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [cutoffs, setCutoffs] = useState({})
  const [spreadsheetUrl, setSpreadsheetUrl] = useState(null)
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

          {result.cutoff && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#15803D', fontStyle: 'italic' }}>
              Next upload: only include data after {fmtCutoff(result.cutoff)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
