'use client'

import { useState, useEffect, useCallback } from 'react'

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCutoff(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

// Known creators — can be extended
const CREATORS = ['Taby']

export default function RawDataUpload() {
  const [creator, setCreator] = useState(CREATORS[0])
  const [dataType, setDataType] = useState('auto')
  const [rawData, setRawData] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [cutoffs, setCutoffs] = useState({})
  const [spreadsheetUrl, setSpreadsheetUrl] = useState(null)
  const [loadingCutoffs, setLoadingCutoffs] = useState(true)

  const loadCutoffs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invoicing/upload-transactions')
      if (res.ok) {
        const data = await res.json()
        setCutoffs(data.tabs || {})
        setSpreadsheetUrl(data.spreadsheetUrl)
      }
    } catch {}
    finally { setLoadingCutoffs(false) }
  }, [])

  useEffect(() => { loadCutoffs() }, [loadCutoffs])

  async function handleUpload() {
    if (!rawData.trim()) return
    setUploading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/invoicing/upload-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawData, creator, dataType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data)
      setRawData('')
      loadCutoffs() // refresh cutoffs
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  // Find cutoff for current creator
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
            Paste transaction data from OnlyFans
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

      {/* Creator + Data Type selectors */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
            Creator
          </label>
          <select value={creator} onChange={e => setCreator(e.target.value)}
            style={{
              width: '100%', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px',
              color: '#1a1a1a', fontSize: '14px', padding: '10px 12px', outline: 'none',
            }}>
            {CREATORS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
            Data Type
          </label>
          <select value={dataType} onChange={e => setDataType(e.target.value)}
            style={{
              width: '100%', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px',
              color: '#1a1a1a', fontSize: '14px', padding: '10px 12px', outline: 'none',
            }}>
            <option value="auto">Auto-detect</option>
            <option value="sales">Sales</option>
            <option value="chargebacks">Chargebacks</option>
          </select>
        </div>
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

      {/* Paste area */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
          Paste OF Data
        </label>
        <textarea
          value={rawData}
          onChange={e => setRawData(e.target.value)}
          placeholder="Copy transaction data from OnlyFans and paste here..."
          rows={12}
          style={{
            width: '100%', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '10px',
            color: '#1a1a1a', fontSize: '13px', padding: '14px', outline: 'none',
            fontFamily: 'ui-monospace, monospace', resize: 'vertical', lineHeight: '1.5',
            boxSizing: 'border-box',
          }}
        />
        {rawData && (
          <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
            {rawData.split('\n').filter(l => l.trim()).length} lines pasted
          </div>
        )}
      </div>

      {/* Upload button */}
      <button onClick={handleUpload} disabled={uploading || !rawData.trim()}
        style={{
          background: rawData.trim() ? '#E88FAC' : '#f3f4f6',
          border: 'none', borderRadius: '8px',
          color: rawData.trim() ? '#fff' : '#999',
          fontSize: '14px', fontWeight: 600, padding: '12px 24px',
          cursor: rawData.trim() && !uploading ? 'pointer' : 'not-allowed',
          opacity: uploading ? 0.6 : 1, width: '100%',
          transition: 'all 0.15s',
        }}>
        {uploading ? 'Uploading...' : 'Upload Transactions'}
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

          {/* Stats */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {[
              { label: 'Parsed', value: result.parsed },
              { label: 'Uploaded', value: result.uploaded },
              { label: 'Skipped', value: result.skipped },
              { label: 'Gross', value: fmt(result.totalGross) },
              { label: 'Net', value: fmt(result.totalNet) },
            ].map(s => (
              <div key={s.label} style={{ fontSize: '12px', color: '#166534' }}>
                <span style={{ color: '#4ADE80', fontWeight: 500 }}>{s.label}:</span>{' '}
                <span style={{ fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Type breakdown */}
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

          {/* Top fans */}
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

          {/* Cutoff update */}
          {result.cutoff && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#15803D', fontStyle: 'italic' }}>
              Next upload: only paste data after {fmtCutoff(result.cutoff)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
