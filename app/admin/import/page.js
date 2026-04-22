'use client'

import { useState, useRef } from 'react'

export default function AdminImport() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFile(f) {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)

        // Try to find reel URLs in the IG export structure
        let urls = []

        // Format 1: saved_saved_media array
        const saved = data.saved_saved_media || data.saved_media || []
        for (const entry of saved) {
          const stringData = entry.string_map_data || {}
          const mediaList = entry.media_list_data || []

          for (const media of mediaList) {
            const url = media.media_url || media.uri || ''
            if (url && url.includes('instagram.com')) urls.push(url)
          }

          const titleData = stringData['Title'] || stringData['Media'] || {}
          if (titleData.href && titleData.href.includes('instagram.com')) {
            urls.push(titleData.href)
          }
        }

        // Format 2: flat array of objects with url field
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.url && item.url.includes('instagram.com')) urls.push(item.url)
          }
        }

        // Dedup
        const shortcodeRe = /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/
        const seen = new Set()
        let unique = 0
        for (const url of urls) {
          const m = url.match(shortcodeRe)
          if (m && !seen.has(m[1])) {
            seen.add(m[1])
            unique++
          }
        }

        setPreview({
          fileName: f.name,
          totalUrls: urls.length,
          uniqueReels: unique,
          rawData: data,
        })
      } catch (err) {
        setError('Could not parse JSON file: ' + err.message)
        setPreview(null)
      }
    }
    reader.readAsText(f)
  }

  async function runImport() {
    if (!preview?.rawData) return
    setImporting(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: preview.rawData }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '8px' }}>
        Import Reels
      </h1>
      <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '24px' }}>
        Upload an Instagram data export JSON to import saved reels into the review queue.
      </div>

      {/* Drop zone */}
      {!preview && !result && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFile(e.dataTransfer.files[0])
          }}
          onClick={() => fileRef.current?.click()}
          style={{
            background: dragOver ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.08)',
            border: `2px dashed ${dragOver ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '18px',
            padding: '60px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📥</div>
          <div style={{ color: 'var(--foreground-muted)', fontSize: '14px', fontWeight: 500 }}>
            Drop your Instagram export JSON here
          </div>
          <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '12px', marginTop: '6px' }}>
            or click to browse
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* Preview */}
      {preview && !result && (
        <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '20px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '12px' }}>
            📄 {preview.fileName}
          </div>
          <div style={{ display: 'flex', gap: '24px', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>URLs Found</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>{preview.totalUrls}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unique Reels</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--palm-pink)' }}>{preview.uniqueReels}</div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '16px' }}>
            Duplicates (already on inspo board or in source reels) will be automatically skipped.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={runImport}
              disabled={importing || preview.uniqueReels === 0}
              style={{
                flex: 1, padding: '10px',
                background: importing ? 'transparent' : 'var(--palm-pink)',
                color: 'var(--foreground)', border: 'none', borderRadius: '6px',
                fontSize: '13px', fontWeight: 600,
                cursor: importing ? 'not-allowed' : 'pointer',
                opacity: importing || preview.uniqueReels === 0 ? 0.6 : 1,
              }}
            >
              {importing ? 'Importing...' : `Import ${preview.uniqueReels} Reels`}
            </button>
            <button
              onClick={reset}
              style={{ padding: '10px 16px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '13px', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '20px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#7DD3A4', marginBottom: '16px' }}>
            ✓ Import Complete
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: 'var(--background)', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Added to Queue</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--palm-pink)' }}>{result.created}</div>
            </div>
            <div style={{ background: 'var(--background)', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Already on Board</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground-muted)' }}>{result.skippedAlreadyOnBoard}</div>
            </div>
            <div style={{ background: 'var(--background)', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Already in Source Reels</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground-muted)' }}>{result.skippedAlreadyInSourceReels}</div>
            </div>
            <div style={{ background: 'var(--background)', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(240, 236, 232, 0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Parsed</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: 'rgba(240, 236, 232, 0.85)' }}>{result.totalParsed}</div>
            </div>
          </div>
          <button
            onClick={reset}
            style={{ width: '100%', padding: '10px', background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '6px', color: 'var(--foreground-muted)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Import Another File
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginTop: '16px', padding: '12px', background: '#2d1515', border: '1px solid #5c2020', borderRadius: '8px', color: '#ff8888', fontSize: '13px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
