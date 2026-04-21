'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatScheduled(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatCount(n) {
  if (n == null) return ''
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

function postStatus(post) {
  if (post.postedAt || post.postLink) return 'posted'
  if (post.telegramSentAt) return 'sent'
  if (post.scheduledDate && new Date(post.scheduledDate) > new Date()) return 'scheduled'
  return 'draft'
}

// ─── Phone frame mimicking IG profile ──────────────────────────────────────────

// Deterministic pastel gradient per handle so each account visually differentiates
function avatarGradient(handle) {
  const str = handle || 'x'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue}, 70%, 60%) 0%, hsl(${(hue + 40) % 360}, 70%, 50%) 100%)`
}

function PhoneFrame({ account, creator, posts, draggingId, onDragStart, onDragEnd, onDrop, onCellClick }) {
  const handle = account?.handle || account?.name || ''

  // Sort: scheduled first (by date asc), then sent/posted (by date desc). Top-left = most recent scheduled.
  // IG actually shows newest-at-top-left, but for PLANNING we want:
  //  - Top rows: upcoming scheduled (draggable)
  //  - Bottom rows: already posted (locked)
  const scheduled = posts
    .filter(p => !p.telegramSentAt && !p.postedAt)
    .sort((a, b) => new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0))

  const past = posts
    .filter(p => p.telegramSentAt || p.postedAt)
    .sort((a, b) => new Date(b.telegramSentAt || b.postedAt || 0) - new Date(a.telegramSentAt || a.postedAt || 0))

  const allCells = [...scheduled, ...past]

  return (
    <div style={{
      width: '320px', flexShrink: 0,
      background: '#fff',
      borderRadius: '32px',
      border: '10px solid #1a1a1a',
      boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Notch */}
      <div style={{ background: '#1a1a1a', height: '18px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '4px',
          width: '100px', height: '14px', background: '#000', borderRadius: '8px' }} />
      </div>

      {/* IG status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 18px 4px', fontSize: '11px', fontWeight: 600 }}>
        <span>9:41</span>
        <span>••• ▲ 100%</span>
      </div>

      {/* IG header */}
      <div style={{ padding: '6px 12px 10px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px' }}>‹</span>
        <span style={{ fontSize: '14px', fontWeight: 700, flex: 1 }}>{handle}</span>
        <span style={{ fontSize: '14px', fontWeight: 700 }}>···</span>
      </div>

      {/* IG profile section */}
      <div style={{ padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '10px' }}>
          {/* Avatar */}
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: avatarGradient(handle),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '24px', fontWeight: 700,
            border: '2px solid #fff',
            boxShadow: '0 0 0 2px #E88FAC',
          }}>
            {(handle?.[0] || creator?.name?.[0] || '?').toUpperCase()}
          </div>
          {/* Stats */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around', fontSize: '12px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{past.length + scheduled.length}</div>
              <div style={{ color: '#666', fontSize: '10px' }}>posts</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{account?.followers ? formatCount(account.followers) : '—'}</div>
              <div style={{ color: '#666', fontSize: '10px' }}>followers</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>—</div>
              <div style={{ color: '#666', fontSize: '10px' }}>following</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>{creator?.name}</div>
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>{account?.accountType || 'Instagram'}</div>
        {/* Buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <div style={{ flex: 1, padding: '5px 0', textAlign: 'center', background: '#0095f6', color: '#fff', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>Follow</div>
          <div style={{ flex: 1, padding: '5px 0', textAlign: 'center', background: '#efefef', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>Message</div>
          <div style={{ padding: '5px 8px', background: '#efefef', borderRadius: '6px', fontSize: '11px' }}>▼</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
        <div style={{ flex: 1, padding: '8px', textAlign: 'center', borderBottom: '1px solid #1a1a1a' }}>▦</div>
        <div style={{ flex: 1, padding: '8px', textAlign: 'center', color: '#999' }}>▷</div>
        <div style={{ flex: 1, padding: '8px', textAlign: 'center', color: '#999' }}>◯</div>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '2px',
        background: '#fff',
        minHeight: allCells.length === 0 ? '120px' : '200px',
      }}>
        {allCells.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>
            No posts yet.
            <div style={{ fontSize: '11px', marginTop: '4px' }}>Drag unassigned posts here.</div>
          </div>
        )}
        {allCells.map((post) => {
          const status = postStatus(post)
          const draggable = status === 'scheduled' || status === 'draft'
          const isDragging = draggingId === post.id
          return (
            <GridCell
              key={post.id}
              post={post}
              status={status}
              draggable={draggable}
              isDragging={isDragging}
              onDragStart={() => onDragStart(post.id, account.id)}
              onDragEnd={onDragEnd}
              onDrop={() => onDrop(post.id, account.id)}
              onClick={() => onCellClick(post)}
            />
          )
        })}
      </div>
    </div>
  )
}

function GridCell({ post, status, draggable, isDragging, onDragStart, onDragEnd, onDrop, onClick }) {
  const [isOver, setIsOver] = useState(false)

  const borderByStatus = {
    scheduled: { bg: '#FFF0F3', ring: '#E88FAC', badge: '#E88FAC' },
    draft:     { bg: '#FFF5F7', ring: '#E8C4CC', badge: '#999' },
    sent:      { bg: '#f0fdf4', ring: '#bbf7d0', badge: '#22c55e' },
    posted:    { bg: '#fff', ring: 'transparent', badge: '#666' },
  }
  const style = borderByStatus[status] || borderByStatus.posted

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() } : undefined}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsOver(false); onDrop() }}
      onClick={onClick}
      title={`${status}${post.scheduledDate ? ' · ' + formatScheduled(post.scheduledDate) : ''}`}
      style={{
        aspectRatio: '1 / 1',
        background: post.thumbnail ? '#000' : style.bg,
        position: 'relative',
        cursor: draggable ? 'grab' : 'pointer',
        opacity: isDragging ? 0.4 : (status === 'posted' ? 1 : 1),
        outline: isOver ? '2px solid #E88FAC' : 'none',
        outlineOffset: '-2px',
        overflow: 'hidden',
      }}
    >
      {post.thumbnail ? (
        <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: style.badge, fontSize: '20px' }}>
          {status === 'draft' ? '✏' : '🗓'}
        </div>
      )}
      {/* Status chip */}
      <div style={{
        position: 'absolute', top: 3, left: 3,
        padding: '1px 5px', borderRadius: '3px',
        background: 'rgba(0,0,0,0.55)', color: '#fff',
        fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {status}
      </div>
      {/* Date chip */}
      {post.scheduledDate && status !== 'posted' && (
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          padding: '1px 4px', borderRadius: '3px',
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          fontSize: '8px', fontWeight: 600,
        }}>
          {new Date(post.scheduledDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/New_York' })}
        </div>
      )}
    </div>
  )
}

// ─── Unassigned tray ───────────────────────────────────────────────────────────

function UnassignedTray({ posts, accounts, draggingId, onDragStart, onDragEnd, onFanOut }) {
  if (posts.length === 0) return null
  return (
    <div style={{
      background: '#fff',
      border: '1px dashed #E8C4CC',
      borderRadius: '14px',
      padding: '14px 16px',
      marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Unassigned posts</div>
          <div style={{ fontSize: '11px', color: '#999' }}>
            {posts.length} to assign — drag to one account, or use Fan Out to post across all {accounts.length}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '6px' }}>
        {posts.map(p => (
          <div key={p.id} style={{ flexShrink: 0, width: '96px' }}>
            <div
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(p.id, null) }}
              onDragEnd={onDragEnd}
              title={`${p.name} · ${formatScheduled(p.scheduledDate)}`}
              style={{
                width: '96px', height: '96px',
                background: '#000', borderRadius: '8px', overflow: 'hidden',
                cursor: 'grab', position: 'relative',
                opacity: draggingId === p.id ? 0.4 : 1,
                border: '1px solid #E8C4CC',
              }}
            >
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF5F7', color: '#999', fontSize: '22px' }}>✏</div>
              )}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.65)', color: '#fff',
                fontSize: '9px', padding: '2px 5px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.scheduledDate ? new Date(p.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : 'no date'}
              </div>
            </div>
            {onFanOut && accounts.length > 1 && (
              <button
                onClick={() => onFanOut(p)}
                style={{
                  marginTop: '4px', width: '96px',
                  padding: '3px 6px', fontSize: '9px', fontWeight: 700,
                  background: '#FFF0F3', color: '#E88FAC',
                  border: '1px solid #E8C4CC', borderRadius: '5px',
                  cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
                title={`Duplicate this post to all ${accounts.length} account grids`}
              >
                ⇉ Fan Out
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function GridPlanner() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creators, setCreators] = useState([])
  const [selectedCreatorId, setSelectedCreatorId] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [posts, setPosts] = useState([])
  const [dragging, setDragging] = useState({ postId: null, sourceAccountId: null })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  // Load creator list on mount
  useEffect(() => {
    fetch('/api/admin/grid-planner')
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setCreators(d.creators || [])
        // Auto-select the first creator w/ ≥1 account
        const first = (d.creators || []).find(c => c.accountCount > 0)
        if (first) setSelectedCreatorId(first.id)
        else setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  // Load data for selected creator
  const loadCreator = useCallback(async (creatorId) => {
    if (!creatorId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/grid-planner?creatorId=${creatorId}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setAccounts(d.accounts || [])
      setPosts(d.posts || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCreatorId) loadCreator(selectedCreatorId)
  }, [selectedCreatorId, loadCreator])

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 2800)
  }

  // Drag handlers
  const handleDragStart = (postId, sourceAccountId) => {
    setDragging({ postId, sourceAccountId })
  }
  const handleDragEnd = () => {
    setDragging({ postId: null, sourceAccountId: null })
  }

  // Drop onto an existing post in an account grid:
  //   - if source is same account → SWAP scheduled dates
  //   - if source is different account or unassigned → REASSIGN dragged post to target account,
  //     inheriting target's scheduled time shift? For v1, simpler: re-assign only.
  const handleDropOnPost = async (targetPostId, targetAccountId) => {
    const sourcePostId = dragging.postId
    const sourceAcc = dragging.sourceAccountId
    if (!sourcePostId || sourcePostId === targetPostId) return

    const sourcePost = posts.find(p => p.id === sourcePostId)
    const targetPost = posts.find(p => p.id === targetPostId)
    if (!sourcePost || !targetPost) return

    setSaving(true)
    try {
      if (sourceAcc && sourceAcc === targetAccountId) {
        // Same-grid swap
        // Optimistic UI
        const newPosts = posts.map(p => {
          if (p.id === sourcePostId) return { ...p, scheduledDate: targetPost.scheduledDate }
          if (p.id === targetPostId) return { ...p, scheduledDate: sourcePost.scheduledDate }
          return p
        })
        setPosts(newPosts)
        const res = await fetch('/api/admin/grid-planner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'swap', postA: sourcePostId, postB: targetPostId }),
        })
        if (!res.ok) throw new Error('Swap failed')
        showToast('Swapped times')
      } else {
        // Cross-account or from-unassigned → reassign
        const newPosts = posts.map(p => p.id === sourcePostId ? { ...p, accountId: targetAccountId } : p)
        setPosts(newPosts)
        const res = await fetch('/api/admin/grid-planner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'assign', postId: sourcePostId, accountIds: [targetAccountId] }),
        })
        if (!res.ok) throw new Error('Assign failed')
        showToast('Moved to ' + (accounts.find(a => a.id === targetAccountId)?.name || 'account'))
      }
    } catch (e) {
      showToast(e.message, true)
      loadCreator(selectedCreatorId) // Reload truth on failure
    } finally {
      setSaving(false)
    }
  }

  // Drop onto the empty space of a phone grid (for unassigned → that account, no target post)
  const handleDropOnAccount = async (accountId) => {
    const sourcePostId = dragging.postId
    if (!sourcePostId) return
    const src = posts.find(p => p.id === sourcePostId)
    if (!src || src.accountId === accountId) return
    setSaving(true)
    try {
      setPosts(posts.map(p => p.id === sourcePostId ? { ...p, accountId } : p))
      const res = await fetch('/api/admin/grid-planner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', postId: sourcePostId, accountIds: [accountId] }),
      })
      if (!res.ok) throw new Error('Assign failed')
      showToast('Assigned to ' + (accounts.find(a => a.id === accountId)?.name || 'account'))
    } catch (e) {
      showToast(e.message, true)
      loadCreator(selectedCreatorId)
    } finally {
      setSaving(false)
    }
  }

  // Unassigned: only scheduled/draft posts (not historical sent/posted without account).
  // Historical posts without an Account are noise — nothing to do with them.
  // Sort soonest-scheduled first so the planner feels sequential.
  const unassignedPosts = posts
    .filter(p => !p.accountId && !p.telegramSentAt && !p.postedAt)
    .sort((a, b) => new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0))
  const postsByAccount = Object.fromEntries(
    accounts.map(a => [a.id, posts.filter(p => p.accountId === a.id)])
  )

  // Fan out: duplicate post to all managed accounts, auto-staggering times
  const handleFanOut = async (post) => {
    if (!accounts.length) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/grid-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fanOut', postId: post.id, accountIds: accounts.map(a => a.id) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fan out failed')
      showToast(`Fanned out to ${accounts.length} account${accounts.length > 1 ? 's' : ''}`)
      await loadCreator(selectedCreatorId)
    } catch (e) {
      showToast(e.message, true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Header row: creator picker + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Creator</div>
          <select
            value={selectedCreatorId || ''}
            onChange={e => setSelectedCreatorId(e.target.value)}
            style={{ padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid #E8C4CC', background: '#fff', minWidth: '180px' }}
          >
            <option value="">Select creator…</option>
            {creators.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.accountCount})</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        {saving && <span style={{ fontSize: '12px', color: '#E88FAC' }}>Saving…</span>}
        <button
          onClick={() => selectedCreatorId && loadCreator(selectedCreatorId)}
          disabled={loading || !selectedCreatorId}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: '#fff', color: '#888', border: '1px solid #E8C4CC', borderRadius: '6px', cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {/* Summary bar */}
      {selectedCreatorId && !loading && !error && (
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '14px' }}>
          {accounts.length} account{accounts.length !== 1 && 's'} · {posts.length} post{posts.length !== 1 && 's'}
          {unassignedPosts.length > 0 && <span style={{ color: '#E88FAC', fontWeight: 600 }}> · {unassignedPosts.length} unassigned</span>}
        </div>
      )}

      {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '14px' }}>Loading…</div>}
      {error && <div style={{ padding: '20px', background: '#fef2f2', color: '#ef4444', borderRadius: '8px', fontSize: '13px' }}>{error}</div>}

      {!loading && !error && selectedCreatorId && (
        <>
          {/* Unassigned tray */}
          <UnassignedTray
            posts={unassignedPosts}
            accounts={accounts}
            draggingId={dragging.postId}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onFanOut={handleFanOut}
          />

          {/* Phones */}
          {accounts.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px', background: '#FFF5F7', borderRadius: '12px' }}>
              No Instagram accounts found for this creator in Creator Platform Directory.
            </div>
          ) : (
            <div
              style={{
                display: 'flex', gap: '24px', overflowX: 'auto',
                paddingBottom: '20px', paddingTop: '10px',
                scrollbarWidth: 'thin',
              }}
            >
              {accounts.map(acc => (
                <div
                  key={acc.id}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                  onDrop={(e) => { e.preventDefault(); handleDropOnAccount(acc.id) }}
                >
                  <PhoneFrame
                    account={acc}
                    creator={creators.find(c => c.id === selectedCreatorId)}
                    posts={postsByAccount[acc.id] || []}
                    draggingId={dragging.postId}
                    onDragStart={(postId) => handleDragStart(postId, acc.id)}
                    onDragEnd={handleDragEnd}
                    onDrop={(targetPostId) => handleDropOnPost(targetPostId, acc.id)}
                    onCellClick={(post) => {
                      // future: open post detail
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          padding: '10px 18px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
          background: toast.isError ? '#fef2f2' : '#dcfce7',
          color: toast.isError ? '#ef4444' : '#22c55e',
          border: `1px solid ${toast.isError ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
