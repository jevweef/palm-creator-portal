'use client'

import { useState, useRef } from 'react'

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtUpload(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtMoney(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function UploadModal({ creator: initialCreator, dataType: initialDataType, allCreators, onClose, onUploadComplete }) {
  const [creator, setCreator] = useState(initialCreator || '')
  const [dataType, setDataType] = useState(initialDataType || 'sales')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  // Find current creator's coverage data
  const creatorData = allCreators?.find(c => c.aka === creator) || null
  const isSales = dataType === 'sales'
  const lastDate = isSales ? creatorData?.earningsEnd : creatorData?.chargebackEnd
  const lastUpload = isSales ? creatorData?.earningsLastUpload : creatorData?.chargebacksLastUpload

  async function handleUpload() {
    if (!file || !creator) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('creator', creator)
      formData.append('dataType', dataType)
      if (file.lastModified) formData.append('fileLastModified', String(file.lastModified))
      const res = await fetch('/api/admin/invoicing/upload-transactions', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      if (data.uploaded > 0 && onUploadComplete) onUploadComplete()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(6px)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '16px', width: '480px', maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a' }}>
            Upload Data
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '20px', color: '#999',
            cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Creator selector */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
              Creator
            </label>
            <select
              value={creator}
              onChange={e => { setCreator(e.target.value); setResult(null); setError(null) }}
              style={{
                width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
                color: '#1a1a1a', fontSize: '14px', padding: '10px 12px', outline: 'none',
              }}
            >
              {(allCreators || []).map(c => (
                <option key={c.id || c.aka} value={c.aka}>{c.aka}</option>
              ))}
            </select>
          </div>

          {/* Data type toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
              Data Type
            </label>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[
                { key: 'sales', label: 'Earnings' },
                { key: 'chargebacks', label: 'Chargebacks' },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => { setDataType(t.key); setResult(null); setError(null) }}
                  style={{
                    flex: 1, padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s', border: 'none',
                    background: dataType === t.key ? (t.key === 'sales' ? '#dcfce7' : '#fee2e2') : '#f9fafb',
                    color: dataType === t.key ? (t.key === 'sales' ? '#166534' : '#991b1b') : '#999',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scroll-back instruction */}
          <div style={{
            background: lastDate ? '#FFFBEB' : '#F0F9FF',
            border: `1px solid ${lastDate ? '#FDE68A' : '#BAE6FD'}`,
            borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
          }}>
            {lastDate ? (
              <>
                <div style={{ fontSize: '13px', fontWeight: 600, color: lastDate ? '#92400E' : '#0369A1', marginBottom: '4px' }}>
                  Scroll back to {fmtDate(lastDate)}
                </div>
                <div style={{ fontSize: '12px', color: '#A16207' }}>
                  Data is current through this date. On the OF Statements page, scroll past this date — duplicates are automatically skipped.
                </div>
                {lastUpload && (
                  <div style={{ fontSize: '11px', color: '#B45309', marginTop: '6px' }}>
                    Last upload: {fmtUpload(lastUpload)}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0369A1' }}>
                  First upload
                </div>
                <div style={{ fontSize: '12px', color: '#0284C7' }}>
                  No prior {isSales ? 'earnings' : 'chargeback'} data for {creator}. Include all available data from the OF Statements page.
                </div>
              </>
            )}
          </div>

          {/* File upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f && (f.name.endsWith('.html') || f.name.endsWith('.htm'))) {
                setFile(f)
                setError(null)
                setResult(null)
              } else {
                setError('Please drop an HTML file (.html)')
              }
            }}
            style={{
              border: `2px dashed ${dragOver ? '#E88FAC' : file ? '#22c55e' : '#e5e7eb'}`,
              borderRadius: '10px', padding: '20px', textAlign: 'center',
              background: dragOver ? '#FFF0F3' : file ? '#F0FDF4' : '#fafafa',
              cursor: 'pointer', transition: 'all 0.15s', marginBottom: '16px',
            }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm"
              onChange={e => { if (e.target.files[0]) { setFile(e.target.files[0]); setError(null); setResult(null) } }}
              style={{ display: 'none' }}
            />
            {file ? (
              <div style={{ fontSize: '13px', color: '#166534', fontWeight: 600 }}>
                ✓ {file.name}
              </div>
            ) : (
              <>
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>📄</div>
                <div style={{ fontSize: '13px', color: '#999' }}>
                  Drop HTML file here or click to browse
                </div>
              </>
            )}
          </div>

          {/* Upload button */}
          <button
            disabled={!file || uploading}
            onClick={handleUpload}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
              background: !file || uploading ? '#e5e7eb' : '#1a1a1a',
              color: !file || uploading ? '#999' : '#fff',
              fontSize: '14px', fontWeight: 600, cursor: !file || uploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {uploading ? 'Uploading...' : `Upload ${isSales ? 'Earnings' : 'Chargebacks'} for ${creator}`}
          </button>

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '12px', padding: '10px 14px', background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: '8px', fontSize: '12px', color: '#DC2626',
            }}>
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              marginTop: '12px', padding: '12px 16px', background: '#F0FDF4',
              border: '1px solid #BBF7D0', borderRadius: '8px',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#166534', marginBottom: '6px' }}>
                {result.uploaded > 0 ? `Added ${result.uploaded} new transactions` : 'No new transactions to add'}
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#15803D' }}>
                <span>Parsed: {result.parsed}</span>
                <span>Skipped: {result.skipped}</span>
                {result.totalGross != null && <span>Gross: {fmtMoney(result.totalGross)}</span>}
                {result.totalNet != null && <span>Net: {fmtMoney(result.totalNet)}</span>}
              </div>
              {result.typeBreakdown && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, marginBottom: '2px' }}>By Type:</div>
                  {Object.entries(result.typeBreakdown).map(([type, total]) => (
                    <div key={type} style={{ fontSize: '12px', color: '#15803D', paddingLeft: '8px' }}>
                      {type}: {fmtMoney(total)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
