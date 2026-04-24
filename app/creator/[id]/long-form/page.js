'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

const STATUS_STYLES = {
  'Awaiting Upload': { bg: 'rgba(156, 163, 175, 0.08)', color: '#9ca3af', label: 'Awaiting Upload' },
  'Files Uploaded':  { bg: 'rgba(120, 180, 232, 0.08)', color: '#78B4E8', label: 'Files Uploaded' },
  'In Editing':      { bg: 'rgba(232, 200, 120, 0.08)', color: '#E8C878', label: 'In Editing' },
  'Needs Revision':  { bg: 'rgba(232, 168, 120, 0.08)', color: '#E8A878', label: 'Needs Revision' },
  'Delivered':       { bg: 'rgba(125, 211, 164, 0.08)', color: '#4ade80', label: 'Delivered' },
  'Archived':        { bg: 'rgba(156, 163, 175, 0.06)', color: '#6b7280', label: 'Archived' },
}

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
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '3px 10px', borderRadius: '9999px',
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

function NewProjectModal({ creatorOpsId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

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
      onClick={e => e.target === e.currentTarget && !submitting && onClose()}
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

function ProjectDetail({ project, onClose, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false)
  const [files, setFiles] = useState(null)

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
      onClick={e => e.target === e.currentTarget && onClose()}
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
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Upload Files</div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                    padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '14px' }}>📄</span>
                      <span style={{ fontSize: '13px', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', display: 'flex', gap: '10px', flexShrink: 0 }}>
                      <span>{fmtSize(f.size)}</span>
                      <span>{fmtDate(f.modified)}</span>
                    </div>
                  </div>
                ))}
              </div>
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
        </div>
      </div>
    </div>
  )
}

function ProjectRow({ project, onClick, onDelete }) {
  const handleDelete = (e) => {
    e.stopPropagation()
    if (confirm(`Delete project "${project.projectName}"? The Dropbox folder and its files will stay in Dropbox, but the project record and upload link will be removed.`)) {
      onDelete(project.id)
    }
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
              onClick={() => setDetail(p)}
              onDelete={async (id) => {
                const res = await fetch(`/api/creator/oftv-projects/${id}`, { method: 'DELETE' })
                if (res.ok) {
                  setProjects(prev => prev.filter(x => x.id !== id))
                  if (detail?.id === id) setDetail(null)
                } else {
                  alert((await res.json()).error || 'Delete failed')
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
            if (warning) alert(warning)
          }}
        />
      )}

      {detail && (
        <ProjectDetail
          project={detail}
          onClose={() => setDetail(null)}
          onRefresh={refreshDetail}
        />
      )}
    </div>
  )
}
