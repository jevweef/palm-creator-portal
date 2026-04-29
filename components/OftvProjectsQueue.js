'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useBackdropDismiss } from '@/lib/useBackdropDismiss'
import { useToast } from '@/lib/useToast'
import { useConfirm } from '@/lib/useConfirm'
import {
  STATUSES,
  STATUS_STYLES,
  ALL_STATUSES,
  ACTIVE_STATUSES,
  getBucketsForRole,
} from '@/lib/oftvWorkflow'

function fmtSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusPill({ status, pulse = false }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Awaiting Upload']
  const shouldPulse = pulse || s.urgent === true
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      fontSize: '10px', fontWeight: 600, padding: '3px 10px', borderRadius: '9999px',
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>
      {shouldPulse && (
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%', background: s.color,
          animation: 'palmStatusPulse 1.4s ease-in-out infinite',
        }} />
      )}
      {s.label || status}
      {shouldPulse && (
        <style>{`@keyframes palmStatusPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }`}</style>
      )}
    </span>
  )
}

/**
 * Tiny status chip for the admin queue card. Shows where the editor is
 * in their pickup loop — "Not seen" / "Seen" / "Started". Three states
 * keep the at-a-glance scan fast: anything that's "Not seen" longer than
 * expected is the row that needs nudging.
 */
function EditorPickupChip({ acknowledgedAt, startedAt, acknowledgedBy }) {
  let label, color, bg
  if (startedAt) {
    label = '🎬 Started'
    color = '#7DD3A4'
    bg = 'rgba(125, 211, 164, 0.10)'
  } else if (acknowledgedAt) {
    label = `👀 Seen${acknowledgedBy ? ` · ${acknowledgedBy.split(' ')[0]}` : ''}`
    color = '#E8C878'
    bg = 'rgba(232, 200, 120, 0.10)'
  } else {
    label = '✗ Not seen'
    color = '#9ca3af'
    bg = 'rgba(156, 163, 175, 0.08)'
  }
  return (
    <span
      title={
        startedAt ? `Editor downloaded files on ${new Date(startedAt).toLocaleString()}` :
        acknowledgedAt ? `Editor opened on ${new Date(acknowledgedAt).toLocaleString()}` :
        'Editor has not opened this project yet'
      }
      style={{
        fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '9999px',
        background: bg, color, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function ProjectDetail({ project, creatorName, onClose, onUpdate, showToast, confirm, toast, role }) {
  const isAdmin = role === 'admin'
  const [editorNotes, setEditorNotes] = useState(project.editorNotes || '')
  const [editedFileLink, setEditedFileLink] = useState(project.editedFileLink || '')
  const [status, setStatus] = useState(project.status || 'Awaiting Upload')
  const [assignedEditor, setAssignedEditor] = useState(project.assignedEditor || '')
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [filesExpanded, setFilesExpanded] = useState(false)
  const COLLAPSED_FILE_COUNT = 5
  const [files, setFiles] = useState(null)
  const [assets, setAssets] = useState([])
  const [finalFiles, setFinalFiles] = useState([])
  const [finalUploadUrl, setFinalUploadUrl] = useState('')
  const [previewFile, setPreviewFile] = useState(null)
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewKind, setPreviewKind] = useState('project') // 'project' | 'asset' | 'final'
  const [deletingFinalPath, setDeletingFinalPath] = useState('')
  const dismiss = useBackdropDismiss(onClose, () => !saving)
  const dismissPreview = useBackdropDismiss(() => setPreviewFile(null))

  useEffect(() => {
    fetch(`/api/creator/oftv-projects/${project.id}?includeFiles=1`)
      .then(r => r.json())
      .then(d => setFiles(d.project?.files || []))
      .catch(() => setFiles([]))
  }, [project.id])

  // First-touch acknowledgement — fires once when the modal opens.
  // Endpoint is idempotent on the server side (only writes if empty), so
  // re-firing doesn't hurt. We don't await it; nothing in the UI depends
  // on the response.
  useEffect(() => {
    fetch(`/api/admin/oftv-projects/${project.id}/acknowledge`, { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.acknowledgedAt && !project.editorAcknowledgedAt) {
          // Reflect locally so the admin sees the badge update immediately
          // without needing a queue refresh.
          onUpdate?.({ id: project.id, editorAcknowledgedAt: d.acknowledgedAt })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const creatorId = (project.creatorIds || [])[0]
  useEffect(() => {
    if (!creatorId) return
    fetch(`/api/admin/creator-assets?creatorOpsId=${creatorId}`)
      .then(r => r.json())
      .then(d => setAssets(d.assets || []))
      .catch(() => setAssets([]))
  }, [creatorId])

  const loadFinal = useCallback(() => {
    fetch(`/api/admin/oftv-projects/${project.id}/final`)
      .then(r => r.json())
      .then(d => {
        setFinalFiles(d.files || [])
        setFinalUploadUrl(d.fileRequestUrl || '')
      })
      .catch(() => {})
  }, [project.id])
  useEffect(() => { loadFinal() }, [loadFinal])
  useEffect(() => {
    const t = setInterval(loadFinal, 15000)
    return () => clearInterval(t)
  }, [loadFinal])

  useEffect(() => {
    if (!previewFile) { setPreviewSrc(''); return }
    const url = previewKind === 'asset'
      ? `/api/admin/creator-assets?creatorOpsId=${creatorId}&path=${encodeURIComponent(previewFile.path)}`
      : previewKind === 'final'
      ? `/api/admin/oftv-projects/${project.id}/final?path=${encodeURIComponent(previewFile.path)}`
      : `/api/creator/oftv-projects/${project.id}/file-link?path=${encodeURIComponent(previewFile.path)}`
    fetch(url)
      .then(r => r.json())
      .then(d => setPreviewSrc(d.link || ''))
      .catch(() => setPreviewSrc(''))
  }, [previewFile, previewKind, project.id, creatorId])

  const deleteFinal = async (file) => {
    const ok = await confirm({
      title: `Delete final cut "${file.name}"?`,
      message: 'This removes the file from Dropbox permanently.',
      confirmLabel: 'Delete',
      destructive: true,
      requireDoubleConfirm: true,
      doubleConfirmTitle: `Really delete "${file.name}"?`,
      doubleConfirmMessage: 'There is no undo.',
    })
    if (!ok) return
    setDeletingFinalPath(file.path)
    try {
      const res = await fetch(`/api/admin/oftv-projects/${project.id}/final?path=${encodeURIComponent(file.path)}`, { method: 'DELETE' })
      if (res.ok) {
        setFinalFiles(prev => prev.filter(f => f.path !== file.path))
        toast?.('Final deleted', 'success')
      } else {
        toast?.('Delete failed', 'error')
      }
    } finally {
      setDeletingFinalPath('')
    }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/creator/oftv-projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editorNotes, editedFileLink, status, assignedEditor }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      const data = await res.json()
      onUpdate(data.project)
      showToast?.('Project updated')
      onClose()
    } catch (e) {
      showToast?.(e.message, true)
    } finally {
      setSaving(false)
    }
  }

  const approveFinal = async () => {
    const ok = await confirm({
      title: 'Approve and send to creator?',
      message: `${creatorName || 'The creator'} will see this final cut on their dashboard and can mark it complete or request changes.`,
      confirmLabel: 'Approve & Send',
    })
    if (!ok) return
    setReviewing(true)
    try {
      const res = await fetch(`/api/admin/oftv-projects/${project.id}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Approve failed')
      toast?.('Sent to creator', 'success')
      onUpdate({ ...project, status: STATUSES.SENT_TO_CREATOR })
      setStatus(STATUSES.SENT_TO_CREATOR)
    } catch (e) {
      toast?.(e.message || 'Approve failed', 'error')
    } finally {
      setReviewing(false)
    }
  }

  // Editor clicks "Download from Dropbox" → log the start, flip status to
  // In Editing if applicable, then open Dropbox in a new tab. We open in
  // an explicit window.open() instead of the <a> default so we can guarantee
  // the API call lands before the new tab steals focus on slow connections.
  const handleDropboxDownload = (e) => {
    e.preventDefault()
    if (project.folderLink) {
      // Open immediately — popup blockers fire only on async user gestures,
      // and we want to keep this as direct as possible. The API call below
      // races but is fire-and-forget.
      window.open(project.folderLink, '_blank', 'noopener,noreferrer')
    }
    fetch(`/api/admin/oftv-projects/${project.id}/start`, { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.flippedStatus) {
          onUpdate?.({ id: project.id, status: STATUSES.IN_EDITING, editorStartedAt: new Date().toISOString() })
          setStatus(STATUSES.IN_EDITING)
          toast?.('Status → In Editing', 'success')
        } else if (!project.editorStartedAt) {
          // Started but status was already past Files Uploaded — still log
          // the timestamp locally if it wasn't there yet.
          onUpdate?.({ id: project.id, editorStartedAt: new Date().toISOString() })
        }
      })
      .catch(() => {})
  }

  const sendBack = async () => {
    setReviewing(true)
    try {
      const res = await fetch(`/api/admin/oftv-projects/${project.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: rejectNotes.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Send back failed')
      toast?.('Sent back to editor', 'success')
      onUpdate({ ...project, status: STATUSES.ADMIN_REVISION, adminRevisionNotes: rejectNotes.trim() })
      setStatus(STATUSES.ADMIN_REVISION)
      setShowRejectInput(false)
    } catch (e) {
      toast?.(e.message || 'Send back failed', 'error')
    } finally {
      setReviewing(false)
    }
  }

  const syncFiles = async () => {
    try {
      const res = await fetch(`/api/admin/oftv-projects/${project.id}/sync`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Sync failed')
      const data = await res.json()
      showToast?.(`${data.fileCount} file${data.fileCount === 1 ? '' : 's'} in folder`)
      onUpdate({ ...project, fileCount: data.fileCount, totalSize: data.totalSize, lastUploadedAt: data.lastUploadedAt })
    } catch (e) {
      showToast?.(e.message, true)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...dismiss}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '760px',
        maxHeight: '92vh', overflow: 'auto', margin: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: 'var(--foreground)' }}>{project.projectName}</h2>
              <StatusPill status={project.status} />
            </div>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
              {creatorName || 'Unknown creator'} · Created {fmtDate(project.createdAt)}
              {project.fileCount > 0 && ` · ${project.fileCount} file${project.fileCount === 1 ? '' : 's'} · ${fmtSize(project.totalSize)}`}
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {(project.editingPrefs || assets.length > 0) && (
            <div style={{ background: 'rgba(232, 160, 160, 0.06)', border: '1px solid rgba(232, 160, 160, 0.15)', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#E8A0A0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>🎨 Creator's Standing Editing Preferences</div>
              {project.editingPrefs && (
                <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: assets.length > 0 ? '14px' : 0 }}>
                  {project.editingPrefs}
                </div>
              )}
              {assets.length > 0 && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#E8A0A0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Brand Assets ({assets.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {assets.map((a, i) => {
                      const isMedia = /\.(mp4|mov|webm|mkv|m4v|jpg|jpeg|png|gif|webp|heic)$/i.test(a.name)
                      const icon = /\.(mp4|mov|webm|mkv|m4v)$/i.test(a.name) ? '🎞️'
                        : /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.name) ? '🖼️'
                        : /\.(ttf|otf|woff|woff2)$/i.test(a.name) ? '🔤'
                        : /\.(pdf)$/i.test(a.name) ? '📕' : '📄'
                      return (
                        <div
                          key={i}
                          onClick={() => { setPreviewKind('asset'); setPreviewFile(a) }}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                            padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: '13px' }}>{icon}</span>
                            <span style={{ fontSize: '12px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                            <span>{fmtSize(a.size)}</span>
                            {isMedia && <span style={{ color: '#E8A0A0' }}>▶</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginTop: '10px' }}>
                Applies to all this creator's long-form projects.
              </div>
            </div>
          )}

          {project.instructions && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>This Project's Brief</div>
              <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: '10px' }}>
                {project.instructions}
              </div>
            </div>
          )}

          {/* Source files — prominent download CTA up top, then a
              collapsed preview list. With 60+ raw clips per project, the
              modal would be unusable if every file expanded by default. */}
          {files && files.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Source Files ({files.length})
                </div>
                {project.folderLink && (
                  <a
                    href={project.folderLink}
                    onClick={handleDropboxDownload}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                      borderRadius: '9999px', textDecoration: 'none',
                      background: 'rgba(120, 180, 232, 0.10)', color: '#78B4E8',
                      border: '1px solid rgba(120, 180, 232, 0.25)',
                    }}
                  >
                    ⬇ Download from Dropbox
                  </a>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginBottom: '8px' }}>
                Click the Dropbox link above to download everything as a zip, or click any file below to preview.
              </div>

              {(() => {
                const visibleFiles = filesExpanded ? files : files.slice(0, COLLAPSED_FILE_COUNT)
                const hiddenCount = files.length - visibleFiles.length
                return (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {visibleFiles.map((f, i) => {
                        const isMedia = /\.(mp4|mov|webm|mkv|m4v|jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
                        const icon = /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name) ? '🎞️'
                          : /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name) ? '🖼️' : '📄'
                        return (
                          <div
                            key={i}
                            onClick={isMedia ? () => { setPreviewKind('project'); setPreviewFile(f) } : undefined}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                              padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                              cursor: isMedia ? 'pointer' : 'default',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                              <span style={{ fontSize: '14px' }}>{icon}</span>
                              <span style={{ fontSize: '13px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', display: 'flex', gap: '10px', flexShrink: 0, alignItems: 'center' }}>
                              <span>{fmtSize(f.size)}</span>
                              {isMedia && <span style={{ color: '#E8A0A0' }}>▶</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => setFilesExpanded(true)}
                        style={{
                          marginTop: '8px', width: '100%',
                          padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                          background: 'rgba(255,255,255,0.03)', color: 'var(--foreground-muted)',
                          border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
                          cursor: 'pointer',
                        }}
                      >
                        Show all {files.length} files
                      </button>
                    )}
                    {filesExpanded && files.length > COLLAPSED_FILE_COUNT && (
                      <button
                        onClick={() => setFilesExpanded(false)}
                        style={{
                          marginTop: '8px', width: '100%',
                          padding: '6px 14px', fontSize: '11px', fontWeight: 600,
                          background: 'transparent', color: 'var(--foreground-subtle)',
                          border: 'none', cursor: 'pointer',
                        }}
                      >
                        Collapse
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={syncFiles} style={{
              padding: '8px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px',
              background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
            }}>Recount files</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={{
                width: '100%', padding: '10px 12px', fontSize: '13px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: 'var(--foreground)', outline: 'none',
              }}>
                {ALL_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>Assigned Editor</label>
              <input value={assignedEditor} onChange={e => setAssignedEditor(e.target.value)} placeholder="Editor name" style={{
                width: '100%', padding: '10px 12px', fontSize: '13px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: 'var(--foreground)', outline: 'none',
              }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>Editor Notes</label>
            <textarea value={editorNotes} onChange={e => setEditorNotes(e.target.value)} rows={3} placeholder="Progress notes, questions for the creator, etc." style={{
              width: '100%', padding: '10px 12px', fontSize: '13px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: 'var(--foreground)', outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }} />
          </div>

          {/* Final Cut Upload + Files */}
          <div style={{
            background: 'rgba(125, 211, 164, 0.04)', border: '1px solid rgba(125, 211, 164, 0.18)',
            borderRadius: '12px', padding: '14px 16px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#7DD3A4', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
              ✅ Final Cut Delivery
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
              Drop your finished edit here. Re-upload anytime for revisions.
            </div>
            {finalUploadUrl && (
              <a
                href={finalUploadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 14px', borderRadius: '10px', marginBottom: '10px',
                  background: 'rgba(125, 211, 164, 0.08)', border: '1px solid rgba(125, 211, 164, 0.25)',
                  textDecoration: 'none', color: 'var(--foreground)',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>Upload final cut to Dropbox</div>
                  <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>No size limit · Lands directly in this project's _Final folder</div>
                </div>
                <span style={{ fontSize: '15px' }}>→</span>
              </a>
            )}
            {finalFiles.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', padding: '12px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.08)' }}>
                No final cut delivered yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {finalFiles.map((f, i) => {
                  const isMedia = /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name)
                  const isDeleting = deletingFinalPath === f.path
                  return (
                    <div
                      key={i}
                      onClick={isMedia && !isDeleting ? () => { setPreviewKind('final'); setPreviewFile(f) } : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                        padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
                        cursor: isMedia && !isDeleting ? 'pointer' : 'default',
                        opacity: isDeleting ? 0.4 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '13px' }}>🎞️</span>
                        <span style={{ fontSize: '12px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                        <span>{fmtSize(f.size)}</span>
                        {isMedia && <span style={{ color: '#7DD3A4' }}>▶</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteFinal(f) }}
                          disabled={isDeleting}
                          title="Delete final"
                          style={{
                            padding: '3px 7px', fontSize: '10px', fontWeight: 600,
                            background: 'transparent', color: 'var(--foreground-subtle)',
                            border: '1px solid transparent', borderRadius: '5px',
                            cursor: isDeleting ? 'not-allowed' : 'pointer',
                          }}
                          onMouseEnter={e => { if (!isDeleting) { e.currentTarget.style.background = 'rgba(232, 120, 120, 0.1)'; e.currentTarget.style.color = '#E87878' } }}
                          onMouseLeave={e => { if (!isDeleting) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--foreground-subtle)' } }}
                        >{isDeleting ? '…' : '✕'}</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ─── Admin Review Panel ─────────────────────────────────────
                Shows when status is Final Submitted. Admin reviews the
                final cut and either approves it (sends to creator) or
                kicks it back to the editor with optional notes. */}
            {isAdmin && project.status === STATUSES.FINAL_SUBMITTED && finalFiles.length > 0 && (
              <div style={{
                marginTop: '12px',
                padding: '14px',
                borderRadius: '10px',
                background: 'rgba(232, 120, 120, 0.06)',
                border: '1px solid rgba(232, 120, 120, 0.20)',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#E87878', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
                  ⚠️ Awaiting your review
                </div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
                  Review the final cut above. Approve to send to {creatorName || 'the creator'}, or send back with notes for the editor.
                </div>
                {!showRejectInput ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={approveFinal}
                      disabled={reviewing}
                      style={{
                        padding: '9px 18px', fontSize: '12px', fontWeight: 600,
                        background: '#7DD3A4', color: '#1a1a1a', border: 'none', borderRadius: '9999px',
                        cursor: reviewing ? 'not-allowed' : 'pointer', opacity: reviewing ? 0.5 : 1,
                      }}
                    >✓ Approve & Send to Creator</button>
                    <button
                      onClick={() => setShowRejectInput(true)}
                      disabled={reviewing}
                      style={{
                        padding: '9px 16px', fontSize: '12px', fontWeight: 600,
                        background: 'transparent', color: '#E8A878',
                        border: '1px solid rgba(232, 168, 120, 0.35)', borderRadius: '9999px',
                        cursor: reviewing ? 'not-allowed' : 'pointer',
                      }}
                    >Send Back to Editor</button>
                  </div>
                ) : (
                  <div>
                    <textarea
                      value={rejectNotes}
                      onChange={e => setRejectNotes(e.target.value)}
                      placeholder="Optional — what needs to change? (Leave blank if you already told the editor in chat.)"
                      rows={3}
                      style={{
                        width: '100%', padding: '10px 12px', fontSize: '12px',
                        background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px', color: 'var(--foreground)', outline: 'none',
                        resize: 'vertical', fontFamily: 'inherit', marginBottom: '8px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={sendBack}
                        disabled={reviewing}
                        style={{
                          padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                          background: '#E8A878', color: '#1a1a1a', border: 'none', borderRadius: '9999px',
                          cursor: reviewing ? 'not-allowed' : 'pointer', opacity: reviewing ? 0.5 : 1,
                        }}
                      >{reviewing ? 'Sending…' : 'Send Back'}</button>
                      <button
                        onClick={() => { setShowRejectInput(false); setRejectNotes('') }}
                        disabled={reviewing}
                        style={{
                          padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                          background: 'transparent', color: 'var(--foreground-muted)',
                          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '9999px',
                          cursor: 'pointer',
                        }}
                      >Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Status banners for non-actionable states */}
            {project.status === STATUSES.SENT_TO_CREATOR && (
              <div style={{
                marginTop: '12px', padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(120, 200, 220, 0.06)', border: '1px solid rgba(120, 200, 220, 0.20)',
                fontSize: '12px', color: 'var(--foreground)',
              }}>
                <strong style={{ color: '#78D4E8' }}>Sent to creator</strong> — waiting for {creatorName || 'them'} to approve or request changes.
                {project.sentToCreatorAt && <span style={{ color: 'var(--foreground-muted)' }}> · Sent {fmtDate(project.sentToCreatorAt)}</span>}
              </div>
            )}
            {project.status === STATUSES.APPROVED && (
              <div style={{
                marginTop: '12px', padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(125, 211, 164, 0.06)', border: '1px solid rgba(125, 211, 164, 0.20)',
                fontSize: '12px', color: 'var(--foreground)',
              }}>
                <strong style={{ color: '#7DD3A4' }}>✓ Approved by creator</strong>
                {project.approvedAt && <span style={{ color: 'var(--foreground-muted)' }}> · {fmtDate(project.approvedAt)}</span>}
              </div>
            )}

            {/* Show last creator feedback so editor can act on it */}
            {project.status === STATUSES.CREATOR_REVISION && project.creatorFeedback && (
              <div style={{
                marginTop: '12px', padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(232, 160, 200, 0.06)', border: '1px solid rgba(232, 160, 200, 0.20)',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#E8A0C8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                  Creator's revision notes
                </div>
                <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {project.creatorFeedback}
                </div>
                {project.creatorFeedbackAt && (
                  <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginTop: '6px' }}>
                    Submitted {fmtDate(project.creatorFeedbackAt)}
                  </div>
                )}
              </div>
            )}

            {/* Show last admin revision notes so editor can act on it */}
            {project.status === STATUSES.ADMIN_REVISION && project.adminRevisionNotes && (
              <div style={{
                marginTop: '12px', padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(232, 168, 120, 0.06)', border: '1px solid rgba(232, 168, 120, 0.20)',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#E8A878', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                  Admin's notes for revision
                </div>
                <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {project.adminRevisionNotes}
                </div>
                {project.reviewedBy && (
                  <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginTop: '6px' }}>
                    From {project.reviewedBy}{project.adminReviewedAt ? ` · ${fmtDate(project.adminReviewedAt)}` : ''}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>Delivered Edit URL <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--foreground-subtle)' }}>(optional — for outside links)</span></label>
            <input value={editedFileLink} onChange={e => setEditedFileLink(e.target.value)} placeholder="Frame.io, Drive, etc — only if not using Dropbox upload above" style={{
              width: '100%', padding: '10px 12px', fontSize: '13px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: 'var(--foreground)', outline: 'none',
            }} />
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button onClick={onClose} disabled={saving} style={{
              padding: '10px 20px', fontSize: '13px', fontWeight: 600,
              background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '9999px', cursor: saving ? 'not-allowed' : 'pointer',
            }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{
              padding: '10px 24px', fontSize: '13px', fontWeight: 600,
              background: 'var(--palm-pink)', color: '#1a1a1a', border: 'none', borderRadius: '9999px',
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
            }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>

      {previewFile && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          {...dismissPreview}
        >
          <div style={{ width: '100%', maxWidth: '900px', maxHeight: '92vh', margin: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
              <div style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '12px' }}>{previewFile.name}</div>
              <button onClick={() => setPreviewFile(null)} style={{ color: '#fff', background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ background: '#000', borderRadius: '14px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
              {!previewSrc ? (
                <div style={{ color: 'var(--foreground-muted)', padding: '40px', fontSize: '13px' }}>Loading…</div>
              ) : /\.(mp4|mov|webm|mkv|m4v)$/i.test(previewFile.name) ? (
                <video src={previewSrc} controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh' }} />
              ) : (
                <img src={previewSrc} alt={previewFile.name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OftvProjectsQueue({ showToast, role = 'admin' }) {
  const [projects, setProjects] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null)
  const [statusFilter, setStatusFilter] = useState('active')
  const { toast, ToastViewport } = useToast()
  const { confirm, ConfirmDialog } = useConfirm()
  const buckets = getBucketsForRole(role)

  // Deep-linking: Telegram notifications send /editor?tab=oftv&project=recXXX
  // so the editor (or admin) can jump straight to the project that needs
  // attention. Auto-open it once projects + creators have loaded.
  const searchParams = useSearchParams()
  const targetProjectId = searchParams?.get('project') || null
  const [autoOpenedFor, setAutoOpenedFor] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Run independently so a failure in one doesn't strand the other (and so
    // a thrown JSON-parse / network error never traps loading=true forever).
    const settle = (label, p) => p.then(
      r => ({ ok: true, label, value: r }),
      e => ({ ok: false, label, error: e })
    )
    const [pRes, cRes] = await Promise.all([
      settle('projects', fetch('/api/admin/oftv-projects')),
      settle('creators', fetch('/api/admin/palm-creators')),
    ])
    try {
      if (pRes.ok && pRes.value.ok) {
        setProjects((await pRes.value.json()).projects || [])
      } else if (!pRes.ok) {
        console.warn('[OftvProjectsQueue] projects fetch failed:', pRes.error?.message)
      }
      if (cRes.ok && cRes.value.ok) {
        setCreators((await cRes.value.json()).creators || [])
      } else if (!cRes.ok) {
        console.warn('[OftvProjectsQueue] creators fetch failed:', cRes.error?.message)
      }
    } catch (err) {
      console.warn('[OftvProjectsQueue] parse error:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const creatorNameById = Object.fromEntries(creators.map(c => [c.id, c.aka || c.name || '']))

  // Auto-open the deep-linked project once load completes. Only fires once
  // per id so closing the modal doesn't immediately reopen it.
  useEffect(() => {
    if (!targetProjectId || autoOpenedFor === targetProjectId || loading) return
    const match = projects.find(p => p.id === targetProjectId)
    if (match) {
      const creatorName = creatorNameById[(match.creatorIds || [])[0]] || '—'
      setDetail({ ...match, creatorName })
      setAutoOpenedFor(targetProjectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetProjectId, projects, loading])

  const filtered = projects.filter(p => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return ACTIVE_STATUSES.includes(p.status)
    return p.status === statusFilter
  })

  // Group projects into role-aware buckets. Each project can only land in
  // one bucket — the first matching set wins (review > inflight > done).
  const grouped = buckets
    .map(bucket => ({
      ...bucket,
      items: filtered.filter(p => bucket.statuses.includes(p.status)),
    }))
    .filter(g => g.items.length > 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>OFTV / Long-Form Projects</h2>
          <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
            Creator-submitted long-form projects with briefs + source files
          </p>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{
          padding: '8px 14px', fontSize: '12px', borderRadius: '9999px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--foreground)', cursor: 'pointer',
        }}>
          <option value="active">Active only</option>
          <option value="all">All</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>No projects yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {grouped.map(group => (
            <div key={group.key} style={group.urgent ? {
              padding: '16px',
              borderRadius: '14px',
              background: 'rgba(232, 120, 120, 0.04)',
              border: '1px solid rgba(232, 120, 120, 0.20)',
            } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{
                  fontSize: '12px', fontWeight: 700,
                  color: group.urgent ? '#E87878' : 'var(--foreground)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>{group.label}</span>
                <span style={{
                  fontSize: '11px', fontWeight: 600,
                  padding: '2px 8px', borderRadius: '9999px',
                  background: group.urgent ? 'rgba(232, 120, 120, 0.15)' : 'rgba(255,255,255,0.06)',
                  color: group.urgent ? '#E87878' : 'var(--foreground-muted)',
                }}>{group.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {group.items.map(p => {
                  const creatorName = creatorNameById[(p.creatorIds || [])[0]] || '—'
                  // Editor pickup chip: only meaningful before Final Submitted —
                  // after that, "started" is implied by the deliverable.
                  const showsPickup = (
                    p.status === STATUSES.FILES_UPLOADED ||
                    p.status === STATUSES.IN_EDITING ||
                    p.status === STATUSES.ADMIN_REVISION ||
                    p.status === STATUSES.CREATOR_REVISION
                  )
                  return (
                    <div
                      key={p.id}
                      onClick={() => setDetail({ ...p, creatorName })}
                      style={{
                        padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
                        background: 'var(--card-bg-solid)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>{p.projectName}</span>
                          <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{creatorName}</span>
                          {showsPickup && (role === 'admin') && (
                            <EditorPickupChip
                              acknowledgedAt={p.editorAcknowledgedAt}
                              startedAt={p.editorStartedAt}
                              acknowledgedBy={p.editorAcknowledgedBy}
                            />
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>
                          {p.fileCount > 0 ? `${p.fileCount} file${p.fileCount === 1 ? '' : 's'} · ${fmtSize(p.totalSize)}` : 'No files yet'}
                          {' · '}Created {fmtDate(p.createdAt)}
                          {p.assignedEditor && ` · ${p.assignedEditor}`}
                        </div>
                      </div>
                      <span style={{ color: 'var(--foreground-subtle)', fontSize: '16px' }}>→</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <ProjectDetail
          project={detail}
          creatorName={detail.creatorName}
          showToast={showToast}
          confirm={confirm}
          toast={toast}
          role={role}
          onClose={() => setDetail(null)}
          onUpdate={(updated) => {
            setProjects(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
            setDetail(prev => prev ? { ...prev, ...updated } : prev)
          }}
        />
      )}

      <ToastViewport />
      <ConfirmDialog />
    </div>
  )
}
