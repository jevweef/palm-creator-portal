'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useBackdropDismiss } from '@/lib/useBackdropDismiss'
import { useToast } from '@/lib/useToast'
import { useConfirm } from '@/lib/useConfirm'
import { STATUSES, STATUS_STYLES, ACTIVE_STATUSES, CREATOR_NEEDS_REVIEW } from '@/lib/oftvWorkflow'

function fmtSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card-bg-solid)',
        borderRadius: '18px',
        padding: '20px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        transition: '0.25s cubic-bezier(0, 0, 0.5, 1)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.transform = '' }}
    >
      {children}
    </div>
  )
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Awaiting Upload']
  // Pulse if this status needs the creator's attention (Sent to Creator).
  const shouldPulse = s.urgent === 'creator'
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
      {s.label}
      {shouldPulse && (
        <style>{`@keyframes palmStatusPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }`}</style>
      )}
    </span>
  )
}

function EditingPreferencesCard({ creatorOpsId, confirm, toast }) {
  const [prefs, setPrefs] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [assetsUrl, setAssetsUrl] = useState('')
  const [assets, setAssets] = useState([])
  const [deletingAsset, setDeletingAsset] = useState('')
  const [previewAsset, setPreviewAsset] = useState(null)

  const load = useCallback(() => {
    if (!creatorOpsId) return
    fetch(`/api/creator/long-form-prefs?creatorOpsId=${creatorOpsId}`)
      .then(r => r.json())
      .then(d => {
        setPrefs(d.longFormPrefs || '')
        setOriginal(d.longFormPrefs || '')
        setAssetsUrl(d.assetsFileRequestUrl || '')
        setAssets(d.assets || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [creatorOpsId])

  useEffect(() => { load() }, [load])

  // Poll for new asset uploads while expanded
  useEffect(() => {
    if (!expanded) return
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [expanded, load])

  const save = async () => {
    setSaving(true)
    try {
      await fetch(`/api/creator/long-form-prefs?creatorOpsId=${creatorOpsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ longFormPrefs: prefs }),
      })
      setOriginal(prefs)
    } finally {
      setSaving(false)
    }
  }

  const deleteAsset = async (asset) => {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      message: 'This removes the file from your brand assets folder in Dropbox permanently. The editor will no longer have it.',
      confirmLabel: 'Delete',
      destructive: true,
      requireDoubleConfirm: true,
      doubleConfirmTitle: `Really delete "${asset.name}"?`,
      doubleConfirmMessage: 'There is no undo.',
    })
    if (!ok) return
    setDeletingAsset(asset.path)
    try {
      const res = await fetch(
        `/api/creator/long-form-prefs/asset?creatorOpsId=${creatorOpsId}&path=${encodeURIComponent(asset.path)}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        setAssets(prev => prev.filter(a => a.path !== asset.path))
        toast('Asset deleted', 'success')
      } else {
        toast('Delete failed', 'error')
      }
    } finally {
      setDeletingAsset('')
    }
  }

  const dirty = prefs !== original
  const isEmpty = !original.trim()

  return (
    <div style={{
      background: 'var(--card-bg-solid)', borderRadius: '18px', padding: expanded ? '20px' : '14px 20px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: '20px',
      transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: '12px' }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
            🎨 Your editing preferences
          </div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>
            {loading ? 'Loading…' : isEmpty
              ? 'Add style notes that apply to ALL your long-form videos — intro, fonts, vibe, inspiration'
              : expanded ? 'Editing — click save when done' : 'Click to view or edit'}
          </div>
        </div>
        <span style={{ fontSize: '16px', color: 'var(--foreground-subtle)', transform: expanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }}>▾</span>
      </div>

      {expanded && (
        <div style={{ marginTop: '14px' }}>
          <textarea
            value={prefs}
            onChange={e => setPrefs(e.target.value)}
            placeholder={`Example:
- Always open with the same intro style (my talking head, no music)
- Use Helvetica for all text, pink (#E8A0A0) accent color
- Reference vibe: my "Summer Vlog 2025" video — clean cuts, airy pacing
- Keep captions minimal, only for key moments
- No transitions between clips, just hard cuts`}
            rows={8}
            style={{
              width: '100%', padding: '12px 14px', fontSize: '13px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px', color: 'var(--foreground)', outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
            {dirty && (
              <button
                onClick={() => setPrefs(original)}
                disabled={saving}
                style={{
                  padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                  background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '9999px', cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >Discard</button>
            )}
            <button
              onClick={save}
              disabled={!dirty || saving}
              style={{
                padding: '8px 20px', fontSize: '12px', fontWeight: 600,
                background: dirty ? 'var(--palm-pink)' : 'rgba(255,255,255,0.04)',
                color: dirty ? '#1a1a1a' : 'var(--foreground-subtle)',
                border: 'none', borderRadius: '9999px',
                cursor: (!dirty || saving) ? 'not-allowed' : 'pointer', opacity: (!dirty || saving) ? 0.6 : 1,
              }}
            >{saving ? 'Saving…' : dirty ? 'Save preferences' : 'Saved'}</button>
          </div>

          {/* Brand Assets */}
          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
              📎 Brand assets for editors
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
              Logos, fonts, reference videos, example edits, intro clips — anything the editor should use across <strong>all</strong> your long-form projects.
            </div>

            {assetsUrl && (
              <a
                href={assetsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', borderRadius: '12px', marginBottom: '12px',
                  background: 'linear-gradient(135deg, rgba(232, 160, 160, 0.12), rgba(232, 160, 160, 0.04))',
                  border: '1px solid rgba(232, 160, 160, 0.25)',
                  textDecoration: 'none', color: 'var(--foreground)',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>Upload brand assets</div>
                  <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>Drop files — no Dropbox account needed. Upload more anytime.</div>
                </div>
                <span style={{ fontSize: '16px' }}>→</span>
              </a>
            )}

            {assets.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px dashed rgba(255,255,255,0.08)' }}>
                No assets yet. Anything you upload here the editor will see on every one of your long-form projects.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {assets.map((a, i) => {
                  const isMedia = /\.(mp4|mov|webm|mkv|m4v|jpg|jpeg|png|gif|webp|heic)$/i.test(a.name)
                  const icon = /\.(mp4|mov|webm|mkv|m4v)$/i.test(a.name) ? '🎞️'
                    : /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.name) ? '🖼️'
                    : /\.(ttf|otf|woff|woff2)$/i.test(a.name) ? '🔤'
                    : /\.(pdf)$/i.test(a.name) ? '📕'
                    : '📄'
                  const isDeleting = deletingAsset === a.path
                  return (
                    <div
                      key={i}
                      onClick={isMedia && !isDeleting ? () => setPreviewAsset(a) : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                        padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                        cursor: isMedia && !isDeleting ? 'pointer' : 'default',
                        opacity: isDeleting ? 0.4 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '14px' }}>{icon}</span>
                        <span style={{ fontSize: '13px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', display: 'flex', gap: '10px', flexShrink: 0, alignItems: 'center' }}>
                        <span>{fmtSize(a.size)}</span>
                        {isMedia && <span style={{ color: 'var(--palm-pink)' }}>▶</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteAsset(a) }}
                          disabled={isDeleting}
                          title="Delete asset"
                          style={{
                            padding: '4px 8px', fontSize: '11px', fontWeight: 600,
                            background: 'transparent', color: 'var(--foreground-subtle)',
                            border: '1px solid transparent', borderRadius: '6px',
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

            {previewAsset && (
              <AssetPreviewModal
                creatorOpsId={creatorOpsId}
                asset={previewAsset}
                onClose={() => setPreviewAsset(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AssetPreviewModal({ creatorOpsId, asset, onClose }) {
  const [src, setSrc] = useState('')
  const dismiss = useBackdropDismiss(onClose)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  useEffect(() => {
    fetch(`/api/creator/long-form-prefs/asset?creatorOpsId=${creatorOpsId}&path=${encodeURIComponent(asset.path)}`)
      .then(r => r.json())
      .then(d => setSrc(d.link || ''))
      .catch(() => setSrc(''))
  }, [creatorOpsId, asset.path])

  const isVideo = /\.(mp4|mov|webm|mkv|m4v)$/i.test(asset.name)
  const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(asset.name)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      {...dismiss}
    >
      <div style={{ width: '100%', maxWidth: '900px', maxHeight: '92vh', margin: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
          <div style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '12px' }}>{asset.name}</div>
          <button onClick={onClose} style={{ color: '#fff', background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ background: '#000', borderRadius: '14px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          {!src ? (
            <div style={{ color: 'var(--foreground-muted)', padding: '40px', fontSize: '13px' }}>Loading…</div>
          ) : isVideo ? (
            <video src={src} controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh' }} />
          ) : isImage ? (
            <img src={src} alt={asset.name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
          ) : (
            <a href={src} download={asset.name} style={{ padding: '10px 20px', background: 'var(--palm-pink)', color: '#1a1a1a', borderRadius: '9999px', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>Download</a>
          )}
        </div>
      </div>
    </div>
  )
}

function VideoPreviewModal({ projectId, file, onClose }) {
  const [src, setSrc] = useState('')
  const [err, setErr] = useState('')
  const dismiss = useBackdropDismiss(onClose)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/creator/oftv-projects/${projectId}/file-link?path=${encodeURIComponent(file.path)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { if (d.link) setSrc(d.link); else setErr(d.error || 'Could not load file') } })
      .catch(e => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [projectId, file.path])

  const isVideo = /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)
  const isImage = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      {...dismiss}
    >
      <div style={{ width: '100%', maxWidth: '900px', maxHeight: '92vh', margin: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--foreground)' }}>
          <div style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '12px' }}>{file.name}</div>
          <button onClick={onClose} style={{ color: 'var(--foreground)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ background: '#000', borderRadius: '14px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          {err ? (
            <div style={{ color: 'var(--foreground-muted)', padding: '40px', textAlign: 'center', fontSize: '13px' }}>{err}</div>
          ) : !src ? (
            <div style={{ color: 'var(--foreground-muted)', padding: '40px', fontSize: '13px' }}>Loading…</div>
          ) : isVideo ? (
            <video src={src} controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh' }} />
          ) : isImage ? (
            <img src={src} alt={file.name} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
          ) : (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ color: 'var(--foreground-muted)', fontSize: '13px', marginBottom: '12px' }}>Preview not available for this file type</div>
              <a href={src} download={file.name} style={{ padding: '8px 18px', background: 'var(--palm-pink)', color: '#1a1a1a', borderRadius: '9999px', textDecoration: 'none', fontSize: '12px', fontWeight: 600 }}>Download</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NewProjectModal({ creatorOpsId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const dismiss = useBackdropDismiss(onClose, () => !submitting)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const submit = async () => {
    if (!name.trim()) { setErr('Project name is required'); return }
    setSubmitting(true); setErr('')
    try {
      const res = await fetch('/api/creator/oftv-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorOpsId, projectName: name.trim(), instructions: instructions.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || data.error || 'Create failed')
      onCreated(data.project, data.warning)
    } catch (e) {
      setErr(e.message)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...dismiss}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '560px',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', margin: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>New Long-Form Project</h2>
          <button onClick={onClose} disabled={submitting} style={{ color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>
              Project Name
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Morning Routine Vlog"
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', fontSize: '14px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px', color: 'var(--foreground)', outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>
              Instructions for the Editor
            </label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Describe the project — feel, pacing, references, anything the editor should know. The more detail, the better."
              rows={6}
              style={{
                width: '100%', padding: '10px 14px', fontSize: '14px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px', color: 'var(--foreground)', outline: 'none', resize: 'vertical', fontFamily: 'inherit',
              }}
            />
          </div>

          {err && <div style={{ fontSize: '12px', color: '#E8A878' }}>{err}</div>}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '9999px', cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !name.trim()}
              style={{
                padding: '10px 24px', fontSize: '13px', fontWeight: 600,
                background: 'var(--palm-pink)', color: '#1a1a1a', border: 'none',
                borderRadius: '9999px', cursor: (submitting || !name.trim()) ? 'not-allowed' : 'pointer',
                opacity: (submitting || !name.trim()) ? 0.5 : 1,
              }}
            >
              {submitting ? 'Creating…' : 'Create Project'}
            </button>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', lineHeight: 1.5, paddingTop: '4px' }}>
            Creating a project sets up a Dropbox folder and upload link. You can add files right away or come back later.
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectDetail({ project, onClose, onRefresh, confirm, toast }) {
  const [refreshing, setRefreshing] = useState(false)
  const [files, setFiles] = useState(null)
  const dismiss = useBackdropDismiss(onClose)
  const [previewFile, setPreviewFile] = useState(null)
  const [deletingPath, setDeletingPath] = useState('')
  const [filesExpanded, setFilesExpanded] = useState(false)
  const COLLAPSED_FILE_COUNT = 5

  // Final cut review state — only relevant when admin has sent the cut over.
  const [finalFiles, setFinalFiles] = useState([])
  const [finalPreviewFile, setFinalPreviewFile] = useState(null)
  const [finalPreviewSrc, setFinalPreviewSrc] = useState('')
  const [showRevisionInput, setShowRevisionInput] = useState(false)
  const [revisionFeedback, setRevisionFeedback] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const dismissFinalPreview = useBackdropDismiss(() => setFinalPreviewFile(null))

  const showsFinalCut = (
    project.status === STATUSES.SENT_TO_CREATOR ||
    project.status === STATUSES.APPROVED ||
    project.status === STATUSES.CREATOR_REVISION
  )

  useEffect(() => {
    if (!showsFinalCut) { setFinalFiles([]); return }
    fetch(`/api/creator/oftv-projects/${project.id}/final`)
      .then(r => r.json())
      .then(d => setFinalFiles(d.files || []))
      .catch(() => setFinalFiles([]))
  }, [project.id, showsFinalCut])

  useEffect(() => {
    if (!finalPreviewFile) { setFinalPreviewSrc(''); return }
    fetch(`/api/creator/oftv-projects/${project.id}/final?path=${encodeURIComponent(finalPreviewFile.path)}`)
      .then(r => r.json())
      .then(d => setFinalPreviewSrc(d.link || ''))
      .catch(() => setFinalPreviewSrc(''))
  }, [finalPreviewFile, project.id])

  const approveAndClose = async () => {
    const ok = await confirm({
      title: 'Approve & close project?',
      message: 'This marks the project complete. The team will know you\'re happy with the final cut. You can still revisit the project, but it will be moved out of your active list.',
      confirmLabel: 'Approve & Close',
    })
    if (!ok) return
    setReviewing(true)
    try {
      const res = await fetch(`/api/creator/oftv-projects/${project.id}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'Approve failed')
      toast('Approved — thanks for the thumbs up!', 'success')
      await onRefresh()
      onClose()
    } catch (e) {
      toast(e.message || 'Could not approve', 'error')
    } finally {
      setReviewing(false)
    }
  }

  const requestRevision = async () => {
    if (!revisionFeedback.trim()) {
      toast('Please describe what needs to change', 'warning')
      return
    }
    setReviewing(true)
    try {
      const res = await fetch(`/api/creator/oftv-projects/${project.id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: revisionFeedback.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Submit failed')
      toast('Sent back to the editor', 'success')
      setShowRevisionInput(false)
      setRevisionFeedback('')
      await onRefresh()
      onClose()
    } catch (e) {
      toast(e.message || 'Could not submit feedback', 'error')
    } finally {
      setReviewing(false)
    }
  }

  const deleteFile = async (file) => {
    const ok = await confirm({
      title: `Delete "${file.name}"?`,
      message: 'This removes the file from your Dropbox project folder. The editor will no longer see it.',
      confirmLabel: 'Delete',
      destructive: true,
      requireDoubleConfirm: true,
      doubleConfirmTitle: `Really delete "${file.name}"?`,
      doubleConfirmMessage: 'There is no undo.',
    })
    if (!ok) return

    setDeletingPath(file.path)
    try {
      const res = await fetch(
        `/api/creator/oftv-projects/${project.id}/file?path=${encodeURIComponent(file.path)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json()
        toast(`Delete failed: ${err.error || 'Unknown error'}`, 'error')
      } else {
        toast('File deleted', 'success')
        setFiles(prev => (prev || []).filter(f => f.path !== file.path))
        fetch(`/api/creator/oftv-projects/${project.id}/sync`, { method: 'POST' }).then(() => onRefresh())
      }
    } finally {
      setDeletingPath('')
    }
  }

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/creator/oftv-projects/${project.id}?includeFiles=1`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.project?.files || [])
      }
    } catch {}
  }, [project.id])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  // Poll every 10s so uploads appear without needing a manual click
  useEffect(() => {
    const t = setInterval(() => {
      fetch(`/api/creator/oftv-projects/${project.id}/sync`, { method: 'POST' }).then(() => fetchFiles())
    }, 10000)
    return () => clearInterval(t)
  }, [project.id, fetchFiles])

  const syncFiles = async () => {
    setRefreshing(true)
    try {
      await fetch(`/api/creator/oftv-projects/${project.id}/sync`, { method: 'POST' })
      await Promise.all([onRefresh(), fetchFiles()])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...dismiss}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '720px',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', margin: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.projectName}</h2>
              <StatusPill status={project.status} />
            </div>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
              Created {fmtDate(project.createdAt)}
              {project.fileCount > 0 && ` · ${project.fileCount} file${project.fileCount === 1 ? '' : 's'} · ${fmtSize(project.totalSize)}`}
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {project.instructions && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Instructions</div>
              <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: '10px' }}>
                {project.instructions}
              </div>
            </div>
          )}

          {(project.fileRequestUrl || project.folderLink) && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Upload Files</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
                Keep this link — if you forgot a clip or need to add more later, use this same link to upload them into this project.
              </div>
              <a
                href={project.fileRequestUrl || project.folderLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 18px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(232, 160, 160, 0.12), rgba(232, 160, 160, 0.04))',
                  border: '1px solid rgba(232, 160, 160, 0.25)',
                  textDecoration: 'none', color: 'var(--foreground)',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{project.fileRequestUrl ? 'Open Dropbox upload link' : 'Open Dropbox folder'}</div>
                  <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>
                    {project.fileRequestUrl
                      ? 'Drop files directly into the project folder — no Dropbox account needed'
                      : 'Upload link unavailable — drop files into the project folder in Dropbox'}
                  </div>
                </div>
                <span style={{ fontSize: '18px' }}>→</span>
              </a>
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Uploaded Files {files !== null && `(${files.length})`}
              </div>
              <button
                onClick={syncFiles}
                disabled={refreshing}
                style={{
                  padding: '6px 12px', fontSize: '11px', fontWeight: 600,
                  background: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '9999px', cursor: refreshing ? 'not-allowed' : 'pointer',
                }}
              >
                {refreshing ? 'Checking…' : '↻ Refresh'}
              </button>
            </div>
            {files === null ? (
              <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', padding: '14px', textAlign: 'center' }}>Loading…</div>
            ) : files.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', padding: '18px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px dashed rgba(255,255,255,0.08)' }}>
                No files uploaded yet. Use the link above to upload.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(filesExpanded ? files : files.slice(0, COLLAPSED_FILE_COUNT)).map((f, i) => {
                    const isMedia = /\.(mp4|mov|webm|mkv|m4v|jpg|jpeg|png|gif|webp|heic)$/i.test(f.name)
                    const icon = /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name) ? '🎞️'
                      : /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.name) ? '🖼️' : '📄'
                    const isDeleting = deletingPath === f.path
                    return (
                      <div
                        key={i}
                        onClick={isMedia && !isDeleting ? () => setPreviewFile(f) : undefined}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                          padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                          cursor: isMedia && !isDeleting ? 'pointer' : 'default',
                          opacity: isDeleting ? 0.4 : 1,
                          transition: 'background 0.15s, opacity 0.15s',
                        }}
                        onMouseEnter={e => { if (isMedia && !isDeleting) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                        onMouseLeave={e => { if (isMedia && !isDeleting) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '14px' }}>{icon}</span>
                          <span style={{ fontSize: '13px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', display: 'flex', gap: '10px', flexShrink: 0, alignItems: 'center' }}>
                          <span>{fmtSize(f.size)}</span>
                          <span>{fmtDate(f.modified)}</span>
                          {isMedia && <span style={{ color: 'var(--palm-pink)' }}>▶</span>}
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteFile(f) }}
                            disabled={isDeleting}
                            title="Delete this file from Dropbox"
                            style={{
                              marginLeft: '2px', padding: '4px 8px', fontSize: '11px', fontWeight: 600,
                              background: 'transparent', color: 'var(--foreground-subtle)',
                              border: '1px solid transparent', borderRadius: '6px',
                              cursor: isDeleting ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { if (!isDeleting) { e.currentTarget.style.background = 'rgba(232, 120, 120, 0.1)'; e.currentTarget.style.color = '#E87878' } }}
                            onMouseLeave={e => { if (!isDeleting) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--foreground-subtle)' } }}
                          >
                            {isDeleting ? '…' : '✕'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Collapsed by default when there are more than COLLAPSED_FILE_COUNT files —
                    creators routinely upload 60+ raw clips per long-form project. */}
                {!filesExpanded && files.length > COLLAPSED_FILE_COUNT && (
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
                {previewFile && (
                  <VideoPreviewModal
                    projectId={project.id}
                    file={previewFile}
                    onClose={() => setPreviewFile(null)}
                  />
                )}
                <div style={{
                  fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '10px',
                  padding: '10px 14px', background: 'rgba(120, 180, 232, 0.06)', borderRadius: '10px',
                  border: '1px solid rgba(120, 180, 232, 0.15)',
                }}>
                  💡 <strong style={{ color: 'var(--foreground)' }}>Forgot a clip or need to add more?</strong> Use the <strong>Open Dropbox upload link</strong> above — new uploads drop into this same project. Click ✕ on any file to delete it.
                </div>
              </>
            )}
          </div>

          {project.editorNotes && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Editor Notes</div>
              <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: '10px' }}>
                {project.editorNotes}
              </div>
            </div>
          )}

          {project.editedFileLink && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Delivered Edit</div>
              <a href={project.editedFileLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: 'var(--palm-pink)', textDecoration: 'none' }}>
                {project.editedFileLink}
              </a>
            </div>
          )}

          {/* ─── Creator Review Surface ───────────────────────────────────
              Shows when the admin has approved a final cut and is now
              waiting on the creator to either approve-close or request
              changes. Also shows the approved cut once Approved (read-only)
              and the prior feedback during Creator Revision (so they can
              see what they asked for). */}
          {showsFinalCut && finalFiles.length > 0 && (
            <div style={{
              padding: '16px',
              borderRadius: '14px',
              background: project.status === STATUSES.SENT_TO_CREATOR
                ? 'linear-gradient(135deg, rgba(120, 200, 220, 0.08), rgba(120, 200, 220, 0.02))'
                : project.status === STATUSES.APPROVED
                ? 'rgba(125, 211, 164, 0.06)'
                : 'rgba(232, 160, 200, 0.06)',
              border: project.status === STATUSES.SENT_TO_CREATOR
                ? '1px solid rgba(120, 200, 220, 0.30)'
                : project.status === STATUSES.APPROVED
                ? '1px solid rgba(125, 211, 164, 0.25)'
                : '1px solid rgba(232, 160, 200, 0.25)',
            }}>
              <div style={{
                fontSize: '11px', fontWeight: 700,
                color: project.status === STATUSES.SENT_TO_CREATOR ? '#78D4E8'
                  : project.status === STATUSES.APPROVED ? '#7DD3A4'
                  : '#E8A0C8',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px',
              }}>
                {project.status === STATUSES.SENT_TO_CREATOR && '🎬 Your Final Cut Is Ready'}
                {project.status === STATUSES.APPROVED && '✓ Approved'}
                {project.status === STATUSES.CREATOR_REVISION && '⏳ Editor Working on Your Feedback'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '14px' }}>
                {project.status === STATUSES.SENT_TO_CREATOR && 'Watch the cut below, then either approve to close out the project, or request changes.'}
                {project.status === STATUSES.APPROVED && 'You\'ve approved this project. The final cut stays here for reference.'}
                {project.status === STATUSES.CREATOR_REVISION && 'The editor is incorporating your notes — you\'ll get a new cut to review soon.'}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                {finalFiles.map((f, i) => {
                  const isVideo = /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name)
                  return (
                    <div
                      key={i}
                      onClick={isVideo ? () => setFinalPreviewFile(f) : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                        padding: '10px 14px', background: 'rgba(0,0,0,0.15)', borderRadius: '10px',
                        cursor: isVideo ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '14px' }}>🎞️</span>
                        <span style={{ fontSize: '13px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', display: 'flex', gap: '10px', flexShrink: 0, alignItems: 'center' }}>
                        <span>{fmtSize(f.size)}</span>
                        {isVideo && <span style={{ color: 'var(--palm-pink)' }}>▶ Watch</span>}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Approve / Request Changes — only when admin sent over */}
              {project.status === STATUSES.SENT_TO_CREATOR && !showRevisionInput && (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={approveAndClose}
                    disabled={reviewing}
                    style={{
                      padding: '11px 22px', fontSize: '13px', fontWeight: 600,
                      background: '#7DD3A4', color: '#1a1a1a', border: 'none', borderRadius: '9999px',
                      cursor: reviewing ? 'not-allowed' : 'pointer', opacity: reviewing ? 0.5 : 1,
                    }}
                  >✓ Approve & Close</button>
                  <button
                    onClick={() => setShowRevisionInput(true)}
                    disabled={reviewing}
                    style={{
                      padding: '11px 18px', fontSize: '13px', fontWeight: 600,
                      background: 'transparent', color: 'var(--palm-pink)',
                      border: '1px solid rgba(232, 160, 160, 0.35)', borderRadius: '9999px',
                      cursor: reviewing ? 'not-allowed' : 'pointer',
                    }}
                  >Request Changes</button>
                </div>
              )}
              {project.status === STATUSES.SENT_TO_CREATOR && showRevisionInput && (
                <div>
                  <textarea
                    value={revisionFeedback}
                    onChange={e => setRevisionFeedback(e.target.value)}
                    placeholder="What needs to change? Be as specific as you can — timestamps, sections, vibe notes — anything that helps the editor."
                    rows={4}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: '13px',
                      background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '10px', color: 'var(--foreground)', outline: 'none',
                      resize: 'vertical', fontFamily: 'inherit', marginBottom: '10px',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={requestRevision}
                      disabled={reviewing || !revisionFeedback.trim()}
                      style={{
                        padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                        background: 'var(--palm-pink)', color: '#1a1a1a', border: 'none', borderRadius: '9999px',
                        cursor: (reviewing || !revisionFeedback.trim()) ? 'not-allowed' : 'pointer',
                        opacity: (reviewing || !revisionFeedback.trim()) ? 0.5 : 1,
                      }}
                    >{reviewing ? 'Sending…' : 'Send Feedback'}</button>
                    <button
                      onClick={() => { setShowRevisionInput(false); setRevisionFeedback('') }}
                      disabled={reviewing}
                      style={{
                        padding: '10px 18px', fontSize: '13px', fontWeight: 600,
                        background: 'transparent', color: 'var(--foreground-muted)',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: '9999px',
                        cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </div>
                </div>
              )}

              {/* Show prior feedback during Creator Revision */}
              {project.status === STATUSES.CREATOR_REVISION && project.creatorFeedback && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#E8A0C8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                    Your notes
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', padding: '10px 12px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px' }}>
                    {project.creatorFeedback}
                  </div>
                </div>
              )}

              {project.status === STATUSES.APPROVED && project.approvedAt && (
                <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '4px' }}>
                  Approved {fmtDate(project.approvedAt)}
                </div>
              )}
            </div>
          )}

          {finalPreviewFile && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm"
              {...dismissFinalPreview}
            >
              <div style={{ width: '100%', maxWidth: '900px', maxHeight: '92vh', margin: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff' }}>
                  <div style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '12px' }}>{finalPreviewFile.name}</div>
                  <button onClick={() => setFinalPreviewFile(null)} style={{ color: '#fff', background: 'none', border: 'none', cursor: 'pointer', fontSize: '24px', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ background: '#000', borderRadius: '14px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
                  {!finalPreviewSrc ? (
                    <div style={{ color: 'var(--foreground-muted)', padding: '40px', fontSize: '13px' }}>Loading…</div>
                  ) : (
                    <video src={finalPreviewSrc} controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh' }} />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProjectRow({ project, onClick, onDelete, confirm }) {
  const handleDelete = async (e) => {
    e.stopPropagation()
    const ok = await confirm({
      title: `Delete project "${project.projectName}"?`,
      message: 'The Dropbox folder and its files will stay in Dropbox. The project record and upload link will be removed from the portal.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (ok) onDelete(project.id)
  }
  return (
    <Card onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.projectName}
            </h3>
            <StatusPill status={project.status} />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
            {project.fileCount > 0
              ? `${project.fileCount} file${project.fileCount === 1 ? '' : 's'} · ${fmtSize(project.totalSize)}`
              : 'No files yet'}
            {' · '}Created {fmtDate(project.createdAt)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleDelete}
            title="Delete project"
            style={{
              padding: '6px 10px', fontSize: '11px', fontWeight: 600,
              background: 'transparent', color: 'var(--foreground-subtle)',
              border: '1px solid transparent', borderRadius: '9999px', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232, 120, 120, 0.08)'; e.currentTarget.style.color = '#E87878' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--foreground-subtle)' }}
          >
            Delete
          </button>
          <span style={{ color: 'var(--foreground-subtle)', fontSize: '18px' }}>→</span>
        </div>
      </div>
    </Card>
  )
}

export default function LongFormPage() {
  const params = useParams()
  const { user } = useUser()
  const creatorOpsId = params?.id

  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)
  const { toast, ToastViewport } = useToast()
  const { confirm, ConfirmDialog } = useConfirm()

  const load = useCallback(async () => {
    if (!creatorOpsId) return
    const res = await fetch(`/api/creator/oftv-projects?creatorOpsId=${creatorOpsId}`)
    if (res.ok) {
      const data = await res.json()
      setProjects(data.projects || [])
    }
    setLoading(false)
  }, [creatorOpsId])

  useEffect(() => { load() }, [load])

  const refreshDetail = async () => {
    await load()
    if (detail) {
      const updated = projects.find(p => p.id === detail.id)
      if (updated) setDetail(updated)
    }
  }

  // Sync file counts for any projects that are awaiting / files-uploaded on mount
  useEffect(() => {
    if (!projects.length) return
    const toSync = projects.filter(p => p.status === 'Awaiting Upload' || p.status === 'Files Uploaded')
    if (!toSync.length) return
    Promise.all(toSync.map(p =>
      fetch(`/api/creator/oftv-projects/${p.id}/sync`, { method: 'POST' }).catch(() => null)
    )).then(() => load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length])

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Long-Form Projects</h1>
          <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '6px' }}>
            OFTV and other long-form content. Create a project, upload your raw files, and the editor takes it from there.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            padding: '10px 22px', fontSize: '13px', fontWeight: 600,
            background: 'var(--palm-pink)', color: '#1a1a1a', border: 'none',
            borderRadius: '9999px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          + New Project
        </button>
      </div>

      <EditingPreferencesCard creatorOpsId={creatorOpsId} confirm={confirm} toast={toast} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)' }}>
          Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>🎬</div>
          <div style={{ fontSize: '14px', color: 'var(--foreground)', marginBottom: '6px', fontWeight: 600 }}>No long-form projects yet</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', maxWidth: '380px', margin: '0 auto' }}>
            Click <strong>New Project</strong> to create an OFTV project, add your brief, and upload files.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {projects.map(p => (
            <ProjectRow
              key={p.id}
              project={p}
              confirm={confirm}
              onClick={() => setDetail(p)}
              onDelete={async (id) => {
                const res = await fetch(`/api/creator/oftv-projects/${id}`, { method: 'DELETE' })
                if (res.ok) {
                  setProjects(prev => prev.filter(x => x.id !== id))
                  if (detail?.id === id) setDetail(null)
                  toast('Project deleted', 'success')
                } else {
                  toast((await res.json()).error || 'Delete failed', 'error')
                }
              }}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewProjectModal
          creatorOpsId={creatorOpsId}
          onClose={() => setShowNew(false)}
          onCreated={(p, warning) => {
            setShowNew(false)
            setProjects(prev => [p, ...prev])
            setDetail(p)
            if (warning) {
              toast(warning, 'warning', { duration: 8000 })
            } else {
              toast('Project created', 'success')
            }
          }}
        />
      )}

      {detail && (
        <ProjectDetail
          project={detail}
          onClose={() => setDetail(null)}
          onRefresh={refreshDetail}
          confirm={confirm}
          toast={toast}
        />
      )}

      <ToastViewport />
      <ConfirmDialog />
    </div>
  )
}
