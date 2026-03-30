'use client'

import { useState, useEffect, useCallback } from 'react'

const STATUS_COLORS = {
  'To Do': { bg: '#332b00', text: '#f59e0b', border: '#5c4b00' },
  'In Progress': { bg: '#0a1a3d', text: '#3b82f6', border: '#1a3a6d' },
}

const TAG_COLORS = [
  '#a78bfa', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4',
]

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg: '#1a1a1a', text: '#71717a', border: '#333' }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>
      {status}
    </span>
  )
}

function TagPill({ tag, index }) {
  const color = TAG_COLORS[index % TAG_COLORS.length]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500,
      background: `${color}15`, color, border: `1px solid ${color}30`,
    }}>
      {typeof tag === 'object' ? tag.name : tag}
    </span>
  )
}

export default function EditorQueue() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(new Set())
  const [updating, setUpdating] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/editor')
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (err) {
      console.error(err)
      showToast(err.message, true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const updateStatus = async (taskId, newStatus) => {
    setUpdating(taskId)
    try {
      const res = await fetch('/api/admin/editor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, newStatus }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Update failed')

      if (newStatus === 'Done') {
        // Remove from queue
        setTasks(prev => prev.filter(t => t.id !== taskId))
        showToast('Submitted for review')
      } else {
        // Update status in place
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
        showToast('Started editing')
      }
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setUpdating(null)
    }
  }

  const toggleExpand = (taskId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(taskId) ? next.delete(taskId) : next.add(taskId)
      return next
    })
  }

  const filtered = filter === 'all' ? tasks : tasks.filter(t => {
    if (filter === 'todo') return t.status === 'To Do'
    if (filter === 'inprogress') return t.status === 'In Progress'
    return true
  })

  const counts = {
    all: tasks.length,
    todo: tasks.filter(t => t.status === 'To Do').length,
    inprogress: tasks.filter(t => t.status === 'In Progress').length,
  }

  if (loading) {
    return <div style={{ color: '#555', fontSize: '14px', padding: '40px' }}>Loading editor queue...</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: 0 }}>Editor Queue</h1>
          <p style={{ fontSize: '13px', color: '#71717a', marginTop: '4px' }}>
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} pending
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchTasks() }}
          style={{
            padding: '8px 16px', fontSize: '13px', fontWeight: 600,
            background: '#111', color: '#a1a1aa', border: '1px solid #333',
            borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'todo', label: `To Do (${counts.todo})` },
          { key: 'inprogress', label: `In Progress (${counts.inprogress})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 600,
              background: filter === tab.key ? '#1a1a2e' : 'transparent',
              color: filter === tab.key ? '#a78bfa' : '#71717a',
              border: `1px solid ${filter === tab.key ? '#a78bfa' : '#333'}`,
              borderRadius: '6px', cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Task grid */}
      {filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
          {tasks.length === 0 ? 'No editing tasks in queue.' : 'No tasks match this filter.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '16px' }}>
          {filtered.map(task => (
            <div key={task.id} style={{
              background: '#111', border: '1px solid #222', borderRadius: '10px',
              padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
              {/* Top: Creator + Status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>
                  {task.creator.name || 'Unknown Creator'}
                </div>
                <StatusBadge status={task.status} />
              </div>

              {/* Task name */}
              <div style={{ fontSize: '13px', color: '#a1a1aa' }}>
                {task.name}
              </div>

              {/* Download Clips — prominent */}
              {task.asset.dropboxLink && (
                <a
                  href={task.asset.dropboxLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block', textAlign: 'center', padding: '10px',
                    background: '#1a1a2e', color: '#a78bfa', fontWeight: 600, fontSize: '13px',
                    border: '1px solid #a78bfa', borderRadius: '8px', textDecoration: 'none',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2a2a4e'}
                  onMouseLeave={e => e.currentTarget.style.background = '#1a1a2e'}
                >
                  Download Clips
                </a>
              )}

              {/* Creator notes */}
              {task.asset.creatorNotes && (
                <div style={{
                  background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '6px', padding: '10px',
                }}>
                  <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                    Creator Notes
                  </div>
                  <div style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: 1.4 }}>
                    {task.asset.creatorNotes}
                  </div>
                </div>
              )}

              {/* Inspo toggle */}
              {task.inspo.id && (
                <>
                  <button
                    onClick={() => toggleExpand(task.id)}
                    style={{
                      background: 'none', border: 'none', color: '#71717a', fontSize: '12px',
                      cursor: 'pointer', textAlign: 'left', padding: 0,
                    }}
                  >
                    {expanded.has(task.id) ? '▾ Hide Inspo Details' : '▸ View Inspo Details'}
                  </button>

                  {expanded.has(task.id) && (
                    <div style={{
                      background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '8px',
                      padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px',
                    }}>
                      {/* Thumbnail + Title */}
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        {task.inspo.thumbnail && (
                          <img
                            src={task.inspo.thumbnail}
                            alt=""
                            style={{ width: '60px', height: '107px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                          />
                        )}
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
                            {task.inspo.title}
                          </div>
                          <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '6px' }}>
                            @{task.inspo.username}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {task.inspo.contentLink && (
                              <a href={task.inspo.contentLink} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none' }}>
                                Original Reel
                              </a>
                            )}
                            {task.inspo.dbShareLink && (
                              <a href={task.inspo.dbShareLink} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: '11px', color: '#a78bfa', textDecoration: 'none' }}>
                                Analyzed Video
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Inspo Direction + What Matters Most */}
                      {task.inspo.notes && (
                        <div style={{ fontSize: '12px', color: '#d4d4d8', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {task.inspo.notes}
                        </div>
                      )}

                      {/* Tags */}
                      {task.inspo.tags?.length > 0 && (
                        <div>
                          <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Tags</div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {task.inspo.tags.map((tag, i) => <TagPill key={i} tag={tag} index={i} />)}
                          </div>
                        </div>
                      )}

                      {/* Film Format + Audio Type */}
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {task.inspo.filmFormat?.length > 0 && (
                          <div>
                            <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Film Format</div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {task.inspo.filmFormat.map((fmt, i) => (
                                <span key={i} style={{
                                  padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                                  background: '#1a1a2e', color: '#a78bfa', border: '1px solid #333',
                                }}>
                                  {typeof fmt === 'object' ? fmt.name : fmt}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {task.inspo.audioType && (
                          <div>
                            <div style={{ fontSize: '10px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Audio</div>
                            <span style={{
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                              background: '#1a1a1a', color: '#a1a1aa', border: '1px solid #333',
                            }}>
                              {typeof task.inspo.audioType === 'object' ? task.inspo.audioType.name : task.inspo.audioType}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Action button */}
              <div style={{ marginTop: 'auto' }}>
                {task.status === 'To Do' && (
                  <button
                    onClick={() => updateStatus(task.id, 'In Progress')}
                    disabled={updating === task.id}
                    style={{
                      width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600,
                      background: updating === task.id ? '#333' : '#0a2e0a',
                      color: updating === task.id ? '#555' : '#22c55e',
                      border: '1px solid #1a5c1a', borderRadius: '8px', cursor: 'pointer',
                      opacity: updating === task.id ? 0.6 : 1,
                    }}
                  >
                    {updating === task.id ? 'Updating...' : 'Start Editing'}
                  </button>
                )}
                {task.status === 'In Progress' && (
                  <button
                    onClick={() => updateStatus(task.id, 'Done')}
                    disabled={updating === task.id}
                    style={{
                      width: '100%', padding: '10px', fontSize: '13px', fontWeight: 600,
                      background: updating === task.id ? '#333' : '#1a1a2e',
                      color: updating === task.id ? '#555' : '#a78bfa',
                      border: '1px solid #a78bfa', borderRadius: '8px', cursor: 'pointer',
                      opacity: updating === task.id ? 0.6 : 1,
                    }}
                  >
                    {updating === task.id ? 'Submitting...' : 'Submit for Review'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
          padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: toast.error ? '#2d1515' : '#0a2e0a',
          color: toast.error ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.error ? '#5c2020' : '#1a5c1a'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
