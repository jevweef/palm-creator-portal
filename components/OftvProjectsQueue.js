'use client'

import { useEffect, useState, useCallback } from 'react'

const STATUS_STYLES = {
  'Awaiting Upload': { bg: 'rgba(156, 163, 175, 0.08)', color: '#9ca3af' },
  'Files Uploaded':  { bg: 'rgba(120, 180, 232, 0.08)', color: '#78B4E8' },
  'In Editing':      { bg: 'rgba(232, 200, 120, 0.08)', color: '#E8C878' },
  'Needs Revision':  { bg: 'rgba(232, 168, 120, 0.08)', color: '#E8A878' },
  'Delivered':       { bg: 'rgba(125, 211, 164, 0.08)', color: '#4ade80' },
  'Archived':        { bg: 'rgba(156, 163, 175, 0.06)', color: '#6b7280' },
}
const STATUS_ORDER = ['Files Uploaded', 'In Editing', 'Needs Revision', 'Awaiting Upload', 'Delivered', 'Archived']

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

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Awaiting Upload']
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '3px 10px', borderRadius: '9999px',
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>{status}</span>
  )
}

function ProjectDetail({ project, creatorName, onClose, onUpdate, showToast }) {
  const [editorNotes, setEditorNotes] = useState(project.editorNotes || '')
  const [editedFileLink, setEditedFileLink] = useState(project.editedFileLink || '')
  const [status, setStatus] = useState(project.status || 'Awaiting Upload')
  const [assignedEditor, setAssignedEditor] = useState(project.assignedEditor || '')
  const [saving, setSaving] = useState(false)

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
      onClick={e => e.target === e.currentTarget && onClose()}
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
          {project.instructions && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Creator's Brief</div>
              <div style={{ fontSize: '13px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.03)', padding: '12px 14px', borderRadius: '10px' }}>
                {project.instructions}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {project.folderLink && (
              <a href={project.folderLink} target="_blank" rel="noopener noreferrer" style={{
                padding: '8px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px',
                background: 'rgba(120, 180, 232, 0.08)', color: '#78B4E8', textDecoration: 'none',
              }}>📁 Open source folder in Dropbox</a>
            )}
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
                {['Awaiting Upload', 'Files Uploaded', 'In Editing', 'Needs Revision', 'Delivered', 'Archived'].map(s => (
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

          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>Delivered Edit URL</label>
            <input value={editedFileLink} onChange={e => setEditedFileLink(e.target.value)} placeholder="Dropbox / Drive link to final cut" style={{
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
    </div>
  )
}

export default function OftvProjectsQueue({ showToast }) {
  const [projects, setProjects] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null)
  const [statusFilter, setStatusFilter] = useState('active')

  const load = useCallback(async () => {
    const [pRes, cRes] = await Promise.all([
      fetch('/api/admin/oftv-projects'),
      fetch('/api/admin/palm-creators'),
    ])
    if (pRes.ok) setProjects((await pRes.json()).projects || [])
    if (cRes.ok) setCreators((await cRes.json()).creators || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const creatorNameById = Object.fromEntries(creators.map(c => [c.id, c.aka || c.name || '']))

  const filtered = projects.filter(p => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return p.status !== 'Delivered' && p.status !== 'Archived'
    return p.status === statusFilter
  })

  const grouped = STATUS_ORDER.map(status => ({
    status,
    items: filtered.filter(p => p.status === status),
  })).filter(g => g.items.length > 0)

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
          <option value="Awaiting Upload">Awaiting Upload</option>
          <option value="Files Uploaded">Files Uploaded</option>
          <option value="In Editing">In Editing</option>
          <option value="Needs Revision">Needs Revision</option>
          <option value="Delivered">Delivered</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading projects…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>No projects yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {grouped.map(group => (
            <div key={group.status}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <StatusPill status={group.status} />
                <span style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>{group.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {group.items.map(p => {
                  const creatorName = creatorNameById[(p.creatorIds || [])[0]] || '—'
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
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>{p.projectName}</span>
                          <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{creatorName}</span>
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
          onClose={() => setDetail(null)}
          onUpdate={(updated) => {
            setProjects(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
            setDetail(prev => prev ? { ...prev, ...updated } : prev)
          }}
        />
      )}
    </div>
  )
}
