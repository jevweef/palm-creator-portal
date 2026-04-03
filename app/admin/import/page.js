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
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>
        Import Reels
      </h1>
      <div style={{ fontSize: '13px', color: '#999', marginBottom: '24px' }}>
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
            background: dragOver ? '#FFF0F3' : '#ffffff',
            border: `2px dashed ${dragOver ? '#E88FAC' : '#E8C4CC'}`,
            borderRadius: '12px',
            padding: '60px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📥</div>
          <div style={{ color: '#888', fontSize: '14px', fontWeight: 500 }}>
            Drop your Instagram export JSON here
          </div>
          <div style={{ color: '#555', fontSize: '12px', marginTop: '6px' }}>
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
        <div style={{ background: '#ffffff', border: '1px solid #222', borderRadius: '10px', padding: '20px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '12px' }}>
            📄 {preview.fileName}
          </div>
          <div style={{ display: 'flex', gap: '24px', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>URLs Found</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#4a4a4a' }}>{preview.totalUrls}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unique Reels</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#E88FAC' }}>{preview.uniqueReels}</div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>
            Duplicates (already on inspo board or in source reels) will be automatically skipped.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={runImport}
              disabled={importing || preview.uniqueReels === 0}
              style={{
                flex: 1, padding: '10px',
                background: importing ? '#E8C4CC' : '#E88FAC',
                color: '#1a1a1a', border: 'none', borderRadius: '6px',
                fontSize: '13px', fontWeight: 600,
                cursor: importing ? 'not-allowed' : 'pointer',
                opacity: importing || preview.uniqueReels === 0 ? 0.6 : 1,
              }}
            >
              {importing ? 'Importing...' : `Import ${preview.uniqueReels} Reels`}
            </button>
            <button
              onClick={reset}
              style={{ padding: '10px 16px', background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '6px', color: '#888', fontSize: '13px', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ background: '#ffffff', border: '1px solid #222', borderRadius: '10px', padding: '20px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#22c55e', marginBottom: '16px' }}>
            ✓ Import Complete
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#FFF5F7', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Added to Queue</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#E88FAC' }}>{result.created}</div>
            </div>
            <div style={{ background: '#FFF5F7', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Already on Board</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#999' }}>{result.skippedAlreadyOnBoard}</div>
            </div>
            <div style={{ background: '#FFF5F7', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Already in Source Reels</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#999' }}>{result.skippedAlreadyInSourceReels}</div>
            </div>
            <div style={{ background: '#FFF5F7', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Parsed</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#4a4a4a' }}>{result.totalParsed}</div>
            </div>
          </div>
          <button
            onClick={reset}
            style={{ width: '100%', padding: '10px', background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '6px', color: '#888', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
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
