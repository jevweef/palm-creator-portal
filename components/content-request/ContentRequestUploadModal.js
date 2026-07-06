'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadFileToDropbox } from '@/lib/dropboxUpload'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Does a File match this section's accepted types? (e.g. "image/*,video/*")
function typeAllowed(file, accept) {
  if (!accept) return true
  const rules = accept.split(',').map(s => s.trim()).filter(Boolean)
  return rules.some(rule => {
    if (rule.endsWith('/*')) return file.type.startsWith(rule.slice(0, -1))
    return file.type === rule
  })
}

let _uid = 0
const nextId = () => `f${++_uid}`

export default function ContentRequestUploadModal({
  open,
  onClose,
  sectionName,
  acceptedFileTypes,
  hqId,
  requestId,
  creatorOpsId,
  month,
  initialFiles,
  onUploaded,
}) {
  const [items, setItems] = useState([]) // {id, file, status, progress, error}
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef(null)
  const tokenRef = useRef(null) // cache the upload token across files
  const abortRef = useRef(null)
  const seededRef = useRef(false)

  const reset = useCallback(() => {
    setItems([])
    setRunning(false)
    tokenRef.current = null
    abortRef.current = null
    seededRef.current = false
  }, [])

  useEffect(() => { if (!open) reset() }, [open, reset])

  const addFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return
    setItems(prev => [
      ...prev,
      ...incoming.map(file => {
        const ok = typeAllowed(file, acceptedFileTypes)
        return {
          id: nextId(),
          file,
          status: ok ? 'queued' : 'error',
          progress: 0,
          error: ok ? '' : 'Wrong file type for this section',
        }
      }),
    ])
  }, [acceptedFileTypes])

  // Seed the queue with files dropped/selected in the section card (once per open).
  useEffect(() => {
    if (open && !seededRef.current && initialFiles?.length) {
      seededRef.current = true
      addFiles(initialFiles)
    }
  }, [open, initialFiles, addFiles])

  const setItem = useCallback((id, patch) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const removeItem = useCallback((id) => {
    setItems(prev => prev.filter(it => it.id !== id))
  }, [])

  // Fetch a Dropbox token, refreshing it if the cached one is older than ~50 min
  // (tokens last 4h, but a long queue of big files could otherwise outlive one).
  // Pass force=true to bypass the cache — used when a mid-upload 401 tells us the
  // token expired and the in-flight transfer needs a fresh one.
  const getToken = useCallback(async (force = false) => {
    const cached = tokenRef.current
    if (!force && cached && Date.now() - cached.fetchedAt < 50 * 60 * 1000) return cached.value
    const res = await fetch('/api/upload-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creatorHqId: hqId }),
    })
    if (!res.ok) throw new Error('Could not get upload permission')
    const value = await res.json()
    tokenRef.current = { value, fetchedAt: Date.now() }
    return value
  }, [hqId])

  // Upload one file fully: Dropbox (chunked) -> shared link -> Airtable record.
  const uploadOne = useCallback(async (item) => {
    const { file, id } = item
    setItem(id, { status: 'uploading', progress: 0, error: '' })
    let stage = 'token' // which step failed, for the error report

    try {
      const { accessToken, rootNamespaceId, creatorName } = await getToken()
      const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })
      stage = 'upload'

      // If a previous attempt already landed this file in Dropbox and only the
      // record-keeping failed, skip straight to that step — NEVER re-upload the
      // bytes (retrying a multi-GB clip from zero is exactly what we're avoiding).
      let actualPath = item.dropboxPath || ''
      let dropboxLink = item.dropboxLink || ''

      if (!actualPath) {
      const [year, monthNum] = (month || '').split('-')
      const monthFolder = `${monthNum} ${MONTH_NAMES[parseInt(monthNum, 10) - 1] || ''}`.trim()
      const ext = file.name.split('.').pop()
      const safeName = `${creatorName}_${Date.now()}_${id}.${ext}`
      // /Vault Content/{AKA}/{YYYY}/{MM Month}/{Section}/{file}
      const uploadPath = `/Vault Content/${creatorName}/${year}/${monthFolder}/${sectionName}/${safeName}`

      const meta = await uploadFileToDropbox({
        file,
        path: uploadPath,
        accessToken,
        pathRoot,
        // On a mid-upload 401, force a fresh token and resume the same transfer.
        getToken: async () => (await getToken(true)).accessToken,
        signal: abortRef.current?.signal,
        onProgress: (frac) => setItem(id, { progress: frac }),
      })
      actualPath = meta?.path_display || uploadPath

      // Create a shared link (best effort).
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Dropbox-API-Path-Root': pathRoot,
          },
          body: JSON.stringify({ path: actualPath, settings: { requested_visibility: 'public' } }),
        })
        if (linkRes.ok) {
          dropboxLink = (await linkRes.json()).url
        } else if (linkRes.status === 409) {
          const existing = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Dropbox-API-Path-Root': pathRoot },
            body: JSON.stringify({ path: actualPath, direct_only: true }),
          })
          if (existing.ok) {
            const data = await existing.json()
            if (data.links?.length) dropboxLink = data.links[0].url
          }
        }
      } catch { /* link is best-effort */ }

      // Remember the landed file on the item so a retry after a metadata
      // failure goes straight to the save step instead of re-uploading.
      setItem(id, { dropboxPath: actualPath, dropboxLink, progress: 1 })
      } else {
        setItem(id, { progress: 1 })
      }

      // Save metadata to Airtable.
      stage = 'metadata'
      const saveRes = await fetch('/api/content-request/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          creatorOpsId,
          section: sectionName,
          dropboxPath: actualPath,
          dropboxLink,
          fileName: file.name,
          fileSize: file.size,
        }),
      })
      if (!saveRes.ok) throw new Error('Saved to Dropbox but failed to record it — please retry')
      const { recordId } = await saveRes.json()

      setItem(id, { status: 'done', progress: 1 })
      onUploaded?.(sectionName, [{
        id: recordId,
        section: sectionName,
        fileName: file.name,
        fileSize: file.size,
        dropboxLink,
        dropboxPath: actualPath,
        uploadedAt: new Date().toISOString(),
        status: 'Draft',
      }])
    } catch (err) {
      setItem(id, { status: 'error', error: err.message || 'Upload failed' })
      // Report the failure so it's visible in Portal Upload Errors (Airtable) —
      // fire-and-forget; a cancel by the creator isn't an error worth logging.
      if (err.message !== 'Upload canceled') {
        fetch('/api/content-request/log-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: err.message || 'Upload failed',
            details: err.stack || '',
            section: sectionName,
            fileName: file.name,
            fileSize: file.size,
            stage,
            creatorHqId: hqId,
            page: typeof window !== 'undefined' ? window.location.pathname : '',
          }),
        }).catch(() => {})
      }
    }
  }, [getToken, month, sectionName, requestId, creatorOpsId, onUploaded, setItem, hqId])

  // Process the queue. Small files upload up to 3 at once (a selfie dump
  // shouldn't crawl one-by-one); a big file gets the whole pipe to itself so
  // its chunks aren't competing for phone bandwidth.
  const SMALL_FILE = 25 * 1024 * 1024
  const runQueue = useCallback(async () => {
    if (running) return
    setRunning(true)
    abortRef.current = new AbortController() // one controller for the whole run
    let pending = true
    while (pending) {
      pending = false
      // Re-read queued items each pass via a functional snapshot.
      const queued = await new Promise(resolve => {
        setItems(prev => { resolve(prev.filter(it => it.status === 'queued')); return prev })
      })
      if (queued.length) {
        pending = true
        const batch = queued[0].file.size > SMALL_FILE
          ? [queued[0]]
          : queued.filter(it => it.file.size <= SMALL_FILE).slice(0, 3)
        await Promise.all(batch.map(uploadOne))
      }
    }
    setRunning(false)
  }, [running, uploadOne])

  // Auto-start whenever there are queued items.
  useEffect(() => {
    if (open && !running && items.some(it => it.status === 'queued')) {
      runQueue()
    }
  }, [open, running, items, runQueue])

  const uploadsActive = items.some(it => it.status === 'uploading' || it.status === 'queued')

  // Keep the phone's screen awake while uploads run — a locked screen suspends
  // JS and kills the transfer, which is the #1 way big clips die on mobile.
  // Re-acquired on tab return (the lock auto-releases when the tab hides).
  useEffect(() => {
    if (!open || !uploadsActive || !navigator.wakeLock) return
    let lock = null
    let released = false
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen') } catch { /* unsupported/denied — warning banner still covers us */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible' && !released) acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      try { lock?.release() } catch { /* already released */ }
    }
  }, [open, uploadsActive])

  // Warn before closing/leaving the page mid-upload — otherwise the browser
  // silently kills the transfer.
  useEffect(() => {
    if (!open || !uploadsActive) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [open, uploadsActive])

  if (!open) return null

  const total = items.length
  const done = items.filter(it => it.status === 'done').length
  const failed = items.filter(it => it.status === 'error').length
  const active = items.some(it => it.status === 'uploading')
  const overall = total > 0
    ? Math.round((items.reduce((s, it) => s + (it.status === 'done' ? 1 : it.progress), 0) / total) * 100)
    : 0

  const cancelAll = () => { abortRef.current?.abort() }

  return (
    <div
      onClick={() => { if (!active) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card-bg-solid)',
          width: '100%', maxWidth: 560, maxHeight: '88vh',
          borderRadius: '20px 20px 0 0',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 12px' }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)', margin: 0, textTransform: 'uppercase' }}>{sectionName}</h2>
            <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>
              {total === 0 ? 'Add files to upload' : `${done} of ${total} uploaded${failed ? ` · ${failed} failed` : ''}`}
            </div>
          </div>
          <button
            onClick={() => { if (!active) onClose?.() }}
            disabled={active}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none',
              background: 'var(--background)', cursor: active ? 'not-allowed' : 'pointer',
              opacity: active ? 0.4 : 1, fontSize: 18, color: 'var(--foreground-muted)', lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Overall progress */}
        {total > 0 && (
          <div style={{ padding: '0 24px 8px' }}>
            <div style={{ height: 6, background: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${overall}%`, background: overall >= 100 && !failed ? '#7DD3A4' : 'var(--palm-pink)', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}

        {/* Keep-open warning while uploading */}
        {active && (
          <div style={{ margin: '4px 24px 0', padding: '8px 12px', background: 'rgba(232, 200, 120, 0.12)', borderRadius: 8, fontSize: 11.5, fontWeight: 500, color: '#9a7a1f' }}>
            Keep this screen open and your phone unlocked until uploads finish.
          </div>
        )}

        {/* File list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
          {items.map(it => (
            <div key={it.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{it.file.name}</span>
                <span style={{ fontSize: 11, color: 'var(--foreground-subtle)', flexShrink: 0 }}>{formatSize(it.file.size)}</span>
                {(it.status === 'queued' || it.status === 'error') && (
                  <button onClick={() => removeItem(it.id)} style={{ border: 'none', background: 'none', color: 'var(--foreground-subtle)', cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }} aria-label="Remove">×</button>
                )}
              </div>

              {/* Per-file status row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {it.status === 'uploading' && (
                  <>
                    <div style={{ flex: 1, height: 5, background: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round(it.progress * 100)}%`, background: 'var(--palm-pink)', transition: 'width 0.2s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--palm-pink)', fontWeight: 600, minWidth: 34, textAlign: 'right' }}>{Math.round(it.progress * 100)}%</span>
                  </>
                )}
                {it.status === 'queued' && <span style={{ fontSize: 11, color: 'var(--foreground-subtle)' }}>Waiting…</span>}
                {it.status === 'done' && <span style={{ fontSize: 11, color: '#7DD3A4', fontWeight: 600 }}>Uploaded</span>}
                {it.status === 'error' && (
                  <>
                    <span style={{ fontSize: 11, color: '#E87878', fontWeight: 500, flex: 1 }}>{it.error}</span>
                    {typeAllowed(it.file, acceptedFileTypes) && (
                      <button onClick={() => setItem(it.id, { status: 'queued', error: '', progress: 0 })} style={{ border: '1px solid rgba(232,120,120,0.3)', background: 'rgba(232,120,120,0.06)', color: '#E87878', borderRadius: 6, fontSize: 11, fontWeight: 600, padding: '3px 10px', cursor: 'pointer' }}>Retry</button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {total === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--foreground-subtle)', fontSize: 13, padding: '24px 0' }}>No files added yet</div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: 10 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ flex: 1, padding: '12px', borderRadius: 10, border: '1px dashed var(--palm-pink)', background: 'rgba(232,160,160,0.06)', color: 'var(--palm-pink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Add files
          </button>
          {active ? (
            <button onClick={cancelAll} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.05)', color: 'var(--foreground-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel uploads</button>
          ) : (
            <button onClick={() => onClose?.()} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: done > 0 ? 'rgba(125,211,164,0.12)' : 'var(--background)', color: done > 0 ? '#3a9d6e' : 'var(--foreground-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {done > 0 ? 'Done' : 'Close'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedFileTypes || '*'}
            style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
        </div>
      </div>
    </div>
  )
}
