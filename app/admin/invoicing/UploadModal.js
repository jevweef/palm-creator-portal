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

export default function UploadModal({ accountName: initialAccount, dataType: initialDataType, allAccounts, onClose, onUploadComplete }) {
  const [accountName, setAccountName] = useState(initialAccount || '')
  const [dataType, setDataType] = useState(initialDataType || 'sales')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  // Find current account's coverage data
  const acctData = allAccounts?.find(a => a.accountName === accountName) || null
  const isSales = dataType === 'sales'
  const lastDate = isSales ? acctData?.earningsEnd : acctData?.chargebackEnd
  const lastUpload = isSales ? acctData?.earningsLastUpload : acctData?.chargebacksLastUpload
  // Extract creator name from account name (e.g. "Taby - Free OF" → "Taby")
  const creatorName = acctData?.creatorAka || accountName.split(' - ')[0] || ''

  async function handleUpload() {
    if (!file || !accountName) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      // Strip non-data content from HTML to get under Vercel's 4.5MB body limit.
      // OF statement HTML embeds inline SVG icons, scripts, styles, and sometimes
      // base64 images. The parser only needs the transaction <table> data.
      let uploadFile = file
      const isHtml = /\.html?$/i.test(file.name) || file.type.includes('html')
      if (isHtml && file.size > 3_500_000) {
        const text = await file.text()
        const stripped = text
          .replace(/<svg[\s\S]*?<\/svg>/gi, '')
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<link\b[^>]*>/gi, '')
          .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '')
          // Drop class values that aren't needed by the parser (keeps b-table*
          // and m-responsive__reset-pb which the parser uses as row anchors).
          .replace(/\sclass="([^"]*)"/g, (m, v) =>
            /b-table|m-responsive__reset-pb/.test(v) ? ` class="${v}"` : ''
          )
          // Drop non-parser attrs: tabindex, aria-*, data-* (except data-title
          // which carries Amount/Fee/Net anchors)
          .replace(/\stabindex="[^"]*"/g, '')
          .replace(/\saria-[a-z-]+="[^"]*"/g, '')
          .replace(/\sdata-(?!title=)[a-z-]+="[^"]*"/g, '')
        const blob = new Blob([stripped], { type: file.type || 'text/html' })
        uploadFile = new File([blob], file.name, { type: blob.type, lastModified: file.lastModified })
      }
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('creator', creatorName)
      formData.append('accountName', accountName)
      formData.append('dataType', dataType)
      if (file.lastModified) formData.append('fileLastModified', String(file.lastModified))
      const res = await fetch('/api/admin/invoicing/upload-transactions', { method: 'POST', body: formData })
      const raw = await res.text()
      let data
      try { data = JSON.parse(raw) } catch {
        if (res.status === 413 || /too large|request en/i.test(raw)) {
          throw new Error('File too large after stripping. Try saving OF page as "HTML Only" or split statement into smaller date ranges.')
        }
        throw new Error(`Upload failed (${res.status}): ${raw.slice(0, 120)}`)
      }
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      if (onUploadComplete) onUploadComplete()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  // Display name: strip creator prefix for cleaner display
  const shortName = accountName.includes(' - ') ? accountName.split(' - ').slice(1).join(' - ') : accountName

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
          background: 'var(--card-bg-solid)', borderRadius: '16px', width: '480px', maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid transparent',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)' }}>
            Upload Data
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '20px', color: 'var(--foreground-muted)',
            cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Account selector */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
              Account
            </label>
            <select
              value={accountName}
              onChange={e => { setAccountName(e.target.value); setResult(null); setError(null) }}
              style={{
                width: '100%', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
                color: 'var(--foreground)', fontSize: '14px', padding: '10px 12px', outline: 'none',
              }}
            >
              {(allAccounts || []).map(a => (
                <option key={a.id} value={a.accountName}>{a.accountName}</option>
              ))}
            </select>
          </div>

          {/* Data type toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
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
                    background: dataType === t.key ? (t.key === 'sales' ? 'rgba(125, 211, 164, 0.08)' : 'rgba(232, 120, 120, 0.1)') : '#f9fafb',
                    color: dataType === t.key ? (t.key === 'sales' ? '#7DD3A4' : '#991b1b') : '#999',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scroll-back instruction */}
          <div style={{
            background: lastDate ? 'rgba(232, 200, 120, 0.06)' : '#F0F9FF',
            border: `1px solid ${lastDate ? 'rgba(232, 200, 120, 0.2)' : '#BAE6FD'}`,
            borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
          }}>
            {lastDate ? (
              <>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#E8A878', marginBottom: '4px' }}>
                  Scroll back to {fmtDate(lastDate)}
                </div>
                <div style={{ fontSize: '12px', color: '#E8C878' }}>
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
                  No prior {isSales ? 'earnings' : 'chargeback'} data for {accountName}. Include all available data from the OF Statements page.
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
              border: `2px dashed ${dragOver ? 'var(--palm-pink)' : file ? '#7DD3A4' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '10px', padding: '20px', textAlign: 'center',
              background: dragOver ? 'rgba(232, 160, 160, 0.06)' : file ? 'rgba(125, 211, 164, 0.06)' : 'var(--card-bg-solid)',
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
              <div style={{ fontSize: '13px', color: '#7DD3A4', fontWeight: 600 }}>
                ✓ {file.name}
              </div>
            ) : (
              <>
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>📄</div>
                <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
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
              background: !file || uploading ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.08)',
              color: !file || uploading ? '#999' : 'var(--foreground)',
              fontSize: '14px', fontWeight: 600, cursor: !file || uploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {uploading ? 'Uploading...' : `Upload ${isSales ? 'Earnings' : 'Chargebacks'} for ${accountName}`}
          </button>

          {/* Error */}
          {error && (
            <div style={{
              marginTop: '12px', padding: '10px 14px', background: 'rgba(232, 120, 120, 0.06)',
              border: '1px solid #FECACA', borderRadius: '8px', fontSize: '12px', color: '#E87878',
            }}>
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              marginTop: '12px', padding: '12px 16px', background: 'rgba(125, 211, 164, 0.06)',
              border: '1px solid #BBF7D0', borderRadius: '8px',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#7DD3A4', marginBottom: '6px' }}>
                {result.uploaded > 0 ? `Added ${result.uploaded} new transactions` : (result.message || 'No new transactions to add')}
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#15803D' }}>
                <span>Parsed: {result.parsed}</span>
                <span>Skipped: {result.skipped}</span>
                {result.totalGross != null && <span>Gross: {fmtMoney(result.totalGross)}</span>}
                {result.totalNet != null && <span>Net: {fmtMoney(result.totalNet)}</span>}
              </div>
              {result.typeBreakdown && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#7DD3A4', fontWeight: 600, marginBottom: '2px' }}>By Type:</div>
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
