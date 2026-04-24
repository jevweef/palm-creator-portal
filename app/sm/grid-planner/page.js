'use client'

import { useEffect, useState } from 'react'

export default function SmGridPlanner() {
  const [creators, setCreators] = useState([])
  const [selectedCreatorId, setSelectedCreatorId] = useState('')
  const [accounts, setAccounts] = useState([])
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('todo') // 'todo' | 'done' | 'all'

  // Initial creators list
  useEffect(() => {
    fetch('/api/admin/grid-planner').then(r => r.json()).then(d => {
      setCreators(d.creators || [])
    })
  }, [])

  async function loadCreator(id) {
    if (!id) return
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/grid-planner?creatorId=${id}`)
      const d = await r.json()
      setAccounts(d.accounts || [])
      setPosts(d.posts || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { loadCreator(selectedCreatorId) }, [selectedCreatorId])

  async function toggleScheduled(postId, currentlyScheduled) {
    // Optimistic update
    setPosts(ps => ps.map(p => p.id === postId ? { ...p, smmScheduled: !currentlyScheduled, smmScheduledAt: !currentlyScheduled ? new Date().toISOString() : null } : p))
    const r = await fetch('/api/admin/sm-grid/mark-scheduled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, scheduled: !currentlyScheduled }),
    })
    if (!r.ok) {
      // Revert on failure
      setPosts(ps => ps.map(p => p.id === postId ? { ...p, smmScheduled: currentlyScheduled } : p))
      alert('Failed to update. Try again.')
    }
  }

  const accountsById = Object.fromEntries(accounts.map(a => [a.id, a]))

  // Only show posts that have an Account assigned and a real asset (something the SMM can actually schedule)
  const schedulable = posts.filter(p => p.accountId && p.asset?.editedFileLink)
  const visible = schedulable.filter(p =>
    filter === 'todo' ? !p.smmScheduled :
    filter === 'done' ? p.smmScheduled :
    true
  )

  // Group by account
  const byAccount = {}
  for (const p of visible) {
    if (!byAccount[p.accountId]) byAccount[p.accountId] = []
    byAccount[p.accountId].push(p)
  }
  // Sort posts within each account by scheduled date
  for (const id in byAccount) {
    byAccount[id].sort((a, b) => new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0))
  }

  return (
    <div style={{ maxWidth: '1200px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Grid Planner</h1>
        <p style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>
          Download each asset, copy the caption, schedule on IG, then mark the box.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <select
          value={selectedCreatorId}
          onChange={e => setSelectedCreatorId(e.target.value)}
          style={{
            padding: '8px 12px', fontSize: '13px',
            background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '6px',
            color: 'var(--foreground)',
          }}
        >
          <option value="">— Select creator —</option>
          {creators.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.accountCount ? ` (${c.accountCount})` : ''}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '3px' }}>
          {[
            { k: 'todo', label: 'To Schedule' },
            { k: 'done', label: 'Scheduled' },
            { k: 'all', label: 'All' },
          ].map(opt => (
            <button
              key={opt.k}
              onClick={() => setFilter(opt.k)}
              style={{
                padding: '6px 12px', fontSize: '12px', fontWeight: 500,
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                background: filter === opt.k ? 'var(--palm-pink)' : 'transparent',
                color: filter === opt.k ? '#060606' : 'var(--foreground-muted)',
              }}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {!selectedCreatorId ? (
        <div style={{ padding: '40px', color: 'var(--foreground-muted)', textAlign: 'center' }}>
          Pick a creator to see their posts.
        </div>
      ) : loading ? (
        <div style={{ padding: '40px', color: 'var(--foreground-muted)' }}>Loading...</div>
      ) : Object.keys(byAccount).length === 0 ? (
        <div style={{ padding: '40px', background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--card-border)', borderRadius: '12px', textAlign: 'center', color: 'var(--foreground-muted)' }}>
          Nothing in the <strong>{filter}</strong> pile for this creator.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {accounts
            .filter(a => byAccount[a.id]?.length)
            .map(account => (
              <div key={account.id}>
                <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 600 }}>
                  @{account.handle || '(no handle)'}
                  <span style={{ color: 'var(--foreground-muted)', fontWeight: 400, marginLeft: '8px', fontSize: '12px' }}>
                    · {account.name} · {byAccount[account.id].length} {byAccount[account.id].length === 1 ? 'post' : 'posts'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {byAccount[account.id].map(post => (
                    <PostRow key={post.id} post={post} onToggle={() => toggleScheduled(post.id, post.smmScheduled)} />
                  ))}
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

function PostRow({ post, onToggle }) {
  const [copiedKey, setCopiedKey] = useState(null)

  async function copy(text, key) {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  const scheduledLabel = post.scheduledDate
    ? new Date(post.scheduledDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
    : '—'

  const btn = {
    padding: '5px 10px',
    fontSize: '11px',
    fontWeight: 500,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--card-border)',
    borderRadius: '5px',
    cursor: 'pointer',
    color: 'var(--foreground)',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{
      display: 'flex', gap: '14px', alignItems: 'center',
      padding: '10px 12px',
      background: post.smmScheduled ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${post.smmScheduled ? 'rgba(34,197,94,0.25)' : 'var(--card-border)'}`,
      borderRadius: '10px',
    }}>
      {/* Thumbnail */}
      {post.thumbnail ? (
        <img src={post.thumbnail} alt="" style={{ width: '56px', height: '70px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0, background: '#000' }} />
      ) : (
        <div style={{ width: '56px', height: '70px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {post.name || '(untitled)'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
          Plan: {scheduledLabel}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {post.asset?.editedFileLink ? (
          <a href={post.asset.editedFileLink} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
            ↓ Video
          </a>
        ) : (
          <span style={{ ...btn, opacity: 0.4 }}>↓ Video</span>
        )}
        {post.thumbnailUrl ? (
          <a href={post.thumbnailUrl} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
            ↓ Thumb
          </a>
        ) : (
          <span style={{ ...btn, opacity: 0.4 }}>↓ Thumb</span>
        )}
        <button onClick={() => copy(post.caption, `${post.id}:c`)} style={btn} disabled={!post.caption}>
          {copiedKey === `${post.id}:c` ? '✓ Copied' : 'Caption'}
        </button>
        <button onClick={() => copy(post.hashtags, `${post.id}:h`)} style={btn} disabled={!post.hashtags}>
          {copiedKey === `${post.id}:h` ? '✓ Copied' : 'Tags'}
        </button>
      </div>

      <label style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '6px 10px',
        background: post.smmScheduled ? 'rgba(34,197,94,0.15)' : 'rgba(232,160,160,0.08)',
        border: `1px solid ${post.smmScheduled ? 'rgba(34,197,94,0.3)' : 'rgba(232,160,160,0.3)'}`,
        borderRadius: '6px', cursor: 'pointer',
        fontSize: '12px', fontWeight: 600,
        color: post.smmScheduled ? '#22c55e' : 'var(--palm-pink)',
        whiteSpace: 'nowrap',
      }}>
        <input
          type="checkbox"
          checked={post.smmScheduled}
          onChange={onToggle}
          style={{ margin: 0, cursor: 'pointer' }}
        />
        {post.smmScheduled ? 'Scheduled' : 'Not yet'}
      </label>
    </div>
  )
}
