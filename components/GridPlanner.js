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

// Deterministic muted gradient per handle — dark-theme friendly
function avatarGradient(handle) {
  const str = handle || 'x'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue}, 28%, 38%) 0%, hsl(${(hue + 40) % 360}, 28%, 28%) 100%)`
}

function relativeTime(iso) {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function PhoneFrame({ account, creator, posts, draggingId, onDragStart, onDragEnd, onDrop, onCellClick }) {
  const handle = account?.handle || account?.name || ''
  const profile = account?.scrapedProfile

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

  // Scraped IG posts from RapidAPI — show as locked "posted" cells beneath scheduled/past.
  // These are the real IG feed thumbnails so the grid reads like the account's actual page.
  const scrapedCells = (account?.scrapedFeed || []).map(s => ({
    id: `scraped-${s.url}`,
    thumbnail: s.thumbnail,
    postLink: s.url,
    postedAt: s.postedAt,
    _scraped: true,
  }))

  // Dedupe: if a scraped post matches a Post record's postLink, skip the scraped one
  const postLinks = new Set(past.map(p => p.postLink).filter(Boolean))
  const uniqScraped = scrapedCells.filter(s => !postLinks.has(s.postLink))

  const allCells = [...scheduled, ...past, ...uniqScraped]

  return (
    <div style={{
      width: '320px', flexShrink: 0,
      background: 'var(--card-bg-solid)',
      borderRadius: '32px',
      border: '10px solid #1a1a1a',
      boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Notch */}
      <div style={{ background: 'rgba(255,255,255,0.08)', height: '18px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '4px',
          width: '100px', height: '14px', background: '#000', borderRadius: '8px' }} />
      </div>

      {/* IG status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 18px 4px', fontSize: '11px', fontWeight: 600 }}>
        <span>9:41</span>
        <span>••• ▲ 100%</span>
      </div>

      {/* IG header */}
      <div style={{ padding: '6px 12px 10px', borderBottom: '1px solid transparent', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px' }}>‹</span>
        <span style={{ fontSize: '14px', fontWeight: 700, flex: 1, display: 'flex', alignItems: 'center', gap: '3px' }}>
          {handle}
          {profile?.isVerified && (
            <span title="Verified" style={{ background: 'var(--palm-pink)', color: '#060606', width: '12px', height: '12px', borderRadius: '50%', fontSize: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
          )}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 700 }}>···</span>
      </div>

      {/* IG profile section */}
      <div style={{ padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '10px' }}>
          {/* Avatar — use real profile pic if scraped */}
          {profile?.profilePicUrl ? (
            <img
              src={profile.profilePicUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling && (e.currentTarget.nextSibling.style.display = 'flex') }}
              style={{
                width: '64px', height: '64px', borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid rgba(255,255,255,0.08)',
                boxShadow: '0 0 0 2px rgba(232,160,160,0.3)',
              }}
            />
          ) : null}
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: avatarGradient(handle),
            display: profile?.profilePicUrl ? 'none' : 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--foreground)', fontSize: '24px', fontWeight: 700,
            border: '2px solid #fff',
            boxShadow: '0 0 0 2px #E88FAC',
            flexShrink: 0,
          }}>
            {(handle?.[0] || creator?.name?.[0] || '?').toUpperCase()}
          </div>
          {/* Stats */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around', fontSize: '12px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                {profile?.postCount != null ? formatCount(profile.postCount) : (past.length + scheduled.length + uniqScraped.length)}
              </div>
              <div style={{ color: 'var(--foreground-muted)', fontSize: '10px' }}>posts</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                {profile?.followers != null ? formatCount(profile.followers) : (account?.followers ? formatCount(account.followers) : '—')}
              </div>
              <div style={{ color: 'var(--foreground-muted)', fontSize: '10px' }}>followers</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>
                {profile?.following != null ? formatCount(profile.following) : '—'}
              </div>
              <div style={{ color: 'var(--foreground-muted)', fontSize: '10px' }}>following</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600 }}>{profile?.fullName || creator?.name}</div>
        {profile?.bio ? (
          <div style={{ fontSize: '11px', color: 'rgba(240, 236, 232, 0.85)', marginTop: '2px', marginBottom: '8px', whiteSpace: 'pre-wrap', lineHeight: 1.3 }}>
            {profile.bio}
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '8px' }}>{account?.accountType || 'Instagram'}</div>
        )}
        {/* Buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <div style={{ flex: 1, padding: '5px 0', textAlign: 'center', background: 'rgba(232,160,160,0.15)', color: 'var(--palm-pink)', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>Follow</div>
          <div style={{ flex: 1, padding: '5px 0', textAlign: 'center', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>Message</div>
          <div style={{ padding: '5px 8px', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground-muted)', borderRadius: '6px', fontSize: '11px' }}>▼</div>
        </div>
        {(account?.scrapedFeedUpdated || account?.scrapedError) && (
          <div style={{ fontSize: '9px', marginTop: '6px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
            {account?.scrapedError && (
              <span
                title={account.scrapedError}
                style={{ color: '#E87878', fontWeight: 600, background: 'rgba(232, 120, 120, 0.06)', padding: '1px 6px', borderRadius: '3px', border: '1px solid #fecaca' }}
              >
                ⚠ last refresh failed
              </span>
            )}
            {account?.scrapedFeedUpdated && (
              <span style={{ color: 'var(--foreground-subtle)' }}>
                scraped {relativeTime(account.scrapedFeedUpdated)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderTop: '1px solid transparent', borderBottom: '1px solid transparent' }}>
        <div style={{ flex: 1, padding: '8px', textAlign: 'center', borderBottom: '1px solid #1a1a1a' }}>▦</div>
        <div style={{ flex: 1, padding: '8px', textAlign: 'center', color: 'var(--foreground-muted)' }}>▷</div>
        <div style={{ flex: 1, padding: '8px', textAlign: 'center', color: 'var(--foreground-muted)' }}>◯</div>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '2px',
        background: 'var(--card-bg-solid)',
        minHeight: allCells.length === 0 ? '120px' : '200px',
      }}>
        {allCells.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '30px 20px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '12px' }}>
            {account?.scrapedError && !account?.scrapedFeedUpdated ? (
              <>
                <div style={{ color: '#E87878', fontWeight: 600 }}>Handle not found on IG</div>
                <div style={{ fontSize: '11px', marginTop: '6px', color: 'var(--foreground-muted)' }}>@{account.handle}</div>
                <div style={{ fontSize: '10px', marginTop: '8px', color: 'var(--foreground-subtle)', padding: '0 8px' }}>Update the handle in Creator Platform Directory, then Refresh.</div>
              </>
            ) : account?.scrapedFeedUpdated ? (
              <>
                <div style={{ color: 'var(--palm-pink)', fontWeight: 600 }}>Feed scraped, 0 posts.</div>
                <div style={{ fontSize: '11px', marginTop: '4px' }}>This account may have no public posts.</div>
              </>
            ) : (
              <>
                No posts yet.
                <div style={{ fontSize: '11px', marginTop: '4px' }}>Click "Refresh IG Feed" to pull real posts.</div>
              </>
            )}
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
    scheduled: { bg: 'rgba(232, 160, 160, 0.05)', ring: 'var(--palm-pink)', badge: 'var(--palm-pink)' },
    draft:     { bg: 'var(--background)', ring: 'var(--card-border)', badge: '#999' },
    sent:      { bg: 'rgba(125, 211, 164, 0.06)', ring: 'rgba(125, 211, 164, 0.2)', badge: '#7DD3A4' },
    posted:    { bg: 'var(--foreground)', ring: 'transparent', badge: 'rgba(240, 236, 232, 0.75)' },
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
        outline: isOver ? '1px solid var(--palm-pink)' : 'none',
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
        background: 'rgba(0,0,0,0.55)', color: 'var(--foreground)',
        fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {status}
      </div>
      {/* Date chip */}
      {post.scheduledDate && status !== 'posted' && (
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          padding: '1px 4px', borderRadius: '3px',
          background: 'rgba(0,0,0,0.55)', color: 'var(--foreground)',
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
      background: 'var(--card-bg-solid)',
      border: '1px dashed #E8C4CC',
      borderRadius: '14px',
      padding: '14px 16px',
      marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>Unassigned posts</div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
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
                border: '1px solid transparent',
              }}
            >
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', color: 'var(--foreground-muted)', fontSize: '22px' }}>✏</div>
              )}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.65)', color: 'var(--foreground)',
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
                  background: 'rgba(232, 160, 160, 0.05)', color: 'var(--palm-pink)',
                  border: '1px solid transparent', borderRadius: '5px',
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
  const [selectedCreatorMeta, setSelectedCreatorMeta] = useState(null) // { telegramThreadId, name }
  const [accounts, setAccounts] = useState([])
  const [posts, setPosts] = useState([])
  const [dragging, setDragging] = useState({ postId: null, sourceAccountId: null })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [detailPost, setDetailPost] = useState(null) // { post, accountId, account }
  const [sendingPostId, setSendingPostId] = useState(null)

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
      setSelectedCreatorMeta(d.selectedCreator || null)
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

  // Refresh scraped IG feed for all of this creator's accounts.
  // Shift-click forces a re-scrape even if cached within 6h.
  const [refreshing, setRefreshing] = useState(false)
  const handleRefreshFeed = async (e) => {
    if (!selectedCreatorId) return
    const force = e?.shiftKey === true
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/grid-planner/refresh-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: selectedCreatorId, force }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      const parts = []
      if (data.refreshed) parts.push(`${data.refreshed} scraped`)
      if (data.skipped) parts.push(`${data.skipped} cached (< 6h)`)
      if (data.failed) parts.push(`${data.failed} failed`)
      if (data.totalLinked) parts.push(`🔗 ${data.totalLinked} planned → posted`)
      showToast(parts.join(' · ') || 'Nothing to do')
      await loadCreator(selectedCreatorId)
    } catch (e) {
      showToast(e.message, true)
    } finally {
      setRefreshing(false)
    }
  }

  // Send a single post to Telegram. Uses waitUntil on the server so this
  // returns in ~1s — the real send happens in the background. We optimistically
  // flip the post's status to 'Sending' so the cell recolors immediately, then
  // poll for completion.
  const handleSendToTelegram = async (post) => {
    if (sendingPostId) return // prevent double-click
    if (!selectedCreatorMeta?.telegramThreadId) {
      showToast('This creator has no Telegram Thread ID set', true)
      return
    }
    setSendingPostId(post.id)
    // Optimistic UI update
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'Sending' } : p))
    setDetailPost(null)
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: post.id,
          editedFileLink: post.asset?.editedFileLink || post.assetEditedFileLink,
          threadId: selectedCreatorMeta.telegramThreadId,
          caption: [post.caption, post.hashtags].filter(Boolean).join('\n\n') || undefined,
          thumbnailUrl: post.thumbnailUrl || undefined,
          assetId: post.asset?.id || undefined,
          rawCaption: post.caption || undefined,
          rawHashtags: post.hashtags || undefined,
          platform: post.platform?.length ? post.platform : undefined,
          scheduledDate: post.scheduledDate || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Queue failed')
      showToast('Queued — sending in background ⏳')
      // Poll for up to 3min
      let attempts = 0
      const poll = setInterval(async () => {
        attempts++
        if (attempts > 45) { clearInterval(poll); setSendingPostId(null); return }
        try {
          const r = await fetch(`/api/admin/grid-planner?creatorId=${selectedCreatorId}`)
          const d = await r.json()
          const latest = (d.posts || []).find(p => p.id === post.id)
          if (!latest || latest.status === 'Sending') return
          clearInterval(poll)
          setSendingPostId(null)
          setPosts(d.posts || [])
          if (latest.status === 'Sent to Telegram' || latest.status === 'Ready to Post') {
            showToast('Sent to Telegram ✓')
          } else if (latest.status === 'Send Failed') {
            showToast('Send failed — check Admin Notes on post', true)
          }
        } catch {}
      }, 4000)
    } catch (e) {
      showToast(e.message, true)
      setSendingPostId(null)
      // Revert optimistic update
      await loadCreator(selectedCreatorId)
    }
  }

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
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Creator</div>
          <select
            value={selectedCreatorId || ''}
            onChange={e => setSelectedCreatorId(e.target.value)}
            style={{ padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid transparent', background: 'var(--card-bg-solid)', minWidth: '180px' }}
          >
            <option value="">Select creator…</option>
            {creators.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.accountCount})</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        {saving && <span style={{ fontSize: '12px', color: 'var(--palm-pink)' }}>Saving…</span>}
        {refreshing && <span style={{ fontSize: '12px', color: 'var(--palm-pink)' }}>Scraping IG…</span>}
        <button
          onClick={handleRefreshFeed}
          disabled={refreshing || !selectedCreatorId}
          title="Pull the latest posts + profile from each IG account. Skips anything scraped < 6h ago. Shift-click to force re-scrape."
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: refreshing ? 'rgba(255,255,255,0.04)' : 'rgba(232, 160, 160, 0.05)', color: refreshing ? '#bbb' : 'var(--palm-pink)', border: '1px solid transparent', borderRadius: '6px', cursor: refreshing ? 'default' : 'pointer' }}
        >
          {refreshing ? 'Scraping…' : '⟳ Refresh IG Feed'}
        </button>
        <button
          onClick={() => selectedCreatorId && loadCreator(selectedCreatorId)}
          disabled={loading || !selectedCreatorId}
          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 600, background: 'var(--card-bg-solid)', color: 'var(--foreground-muted)', border: '1px solid transparent', borderRadius: '6px', cursor: 'pointer' }}
        >
          Reload
        </button>
      </div>

      {/* Summary bar */}
      {selectedCreatorId && !loading && !error && (
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '14px' }}>
          {accounts.length} account{accounts.length !== 1 && 's'} · {posts.length} post{posts.length !== 1 && 's'}
          {unassignedPosts.length > 0 && <span style={{ color: 'var(--palm-pink)', fontWeight: 600 }}> · {unassignedPosts.length} unassigned</span>}
        </div>
      )}

      {loading && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading…</div>}
      {error && <div style={{ padding: '20px', background: 'rgba(232, 120, 120, 0.06)', color: '#E87878', borderRadius: '8px', fontSize: '13px' }}>{error}</div>}

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
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px', background: 'var(--background)', borderRadius: '12px' }}>
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
                    onCellClick={(post) => setDetailPost({ post, account: acc })}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Post detail + Send modal */}
      {detailPost && (
        <PostDetailModal
          post={detailPost.post}
          account={detailPost.account}
          creatorMeta={selectedCreatorMeta}
          sending={sendingPostId === detailPost.post.id}
          onClose={() => setDetailPost(null)}
          onSend={() => handleSendToTelegram(detailPost.post)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          padding: '10px 18px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
          background: toast.isError ? 'rgba(232, 120, 120, 0.06)' : 'rgba(125, 211, 164, 0.08)',
          color: toast.isError ? '#E87878' : '#7DD3A4',
          border: `1px solid ${toast.isError ? 'rgba(232, 120, 120, 0.2)' : 'rgba(125, 211, 164, 0.2)'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ─── Post detail + Send modal ──────────────────────────────────────────────────
// Opens when a cell is clicked in the grid. Shows thumbnail + caption preview
// and a "Send to Telegram" action. This is where posts actually get sent now
// (Post Prep only preps — no send action there anymore).
function PostDetailModal({ post, account, creatorMeta, sending, onClose, onSend }) {
  const canSend = post.asset?.editedFileLink && post.status !== 'Sent to Telegram' && post.status !== 'Sending' && post.status !== 'Posted'
  const scheduledLabel = post.scheduledDate
    ? new Date(post.scheduledDate).toLocaleDateString('en-US', {
        timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : null
  const statusStyle = {
    'Sending': { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    'Sent to Telegram': { bg: 'rgba(120, 180, 232, 0.08)', color: '#78B4E8', border: 'rgba(120, 180, 232, 0.3)' },
    'Send Failed': { bg: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
    'Posted': { bg: 'rgba(232, 160, 160, 0.08)', color: 'var(--palm-pink)', border: 'rgba(232, 160, 160, 0.3)' },
    'Prepping': { bg: 'rgba(202, 138, 4, 0.08)', color: '#ca8a04', border: 'rgba(202, 138, 4, 0.3)' },
  }[post.status] || { bg: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)', border: 'rgba(255,255,255,0.08)' }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '16px',
        width: '100%', maxWidth: '440px', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.name || 'Untitled post'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
              @{account?.handle || account?.name} {scheduledLabel ? ' · ' + scheduledLabel : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        {/* Thumbnail */}
        <div style={{ padding: '0 20px' }}>
          <div style={{ aspectRatio: '9/16', maxHeight: '400px', margin: '0 auto', background: '#000', borderRadius: '10px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {post.thumbnail ? (
              <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>No thumbnail</div>
            )}
          </div>
        </div>

        {/* Status pill */}
        <div style={{ padding: '12px 20px 0', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            padding: '3px 10px', borderRadius: '20px',
            background: statusStyle.bg, color: statusStyle.color,
            border: `1px solid ${statusStyle.border}`,
          }}>
            {post.status || 'Prepping'}
          </span>
          {post.platform?.map(p => (
            <span key={p} style={{
              fontSize: '10px', fontWeight: 600,
              padding: '3px 10px', borderRadius: '20px',
              background: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>{p}</span>
          ))}
        </div>

        {/* Caption preview */}
        {(post.caption || post.hashtags) && (
          <div style={{ padding: '12px 20px 0', fontSize: '12px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
            {post.caption}
            {post.hashtags ? '\n\n' + post.hashtags : ''}
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '16px 20px', display: 'flex', gap: '8px', marginTop: 'auto' }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '10px', fontSize: '13px', fontWeight: 600, background: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', cursor: 'pointer' }}
          >
            Close
          </button>
          {canSend && (
            <button
              onClick={onSend}
              disabled={sending || !creatorMeta?.telegramThreadId}
              style={{ flex: 2, padding: '10px', fontSize: '13px', fontWeight: 700,
                background: sending ? 'rgba(245, 158, 11, 0.08)' : 'rgba(125, 211, 164, 0.12)',
                color: sending ? '#f59e0b' : '#7DD3A4',
                border: `1px solid ${sending ? 'rgba(245, 158, 11, 0.3)' : 'rgba(125, 211, 164, 0.3)'}`,
                borderRadius: '8px', cursor: sending ? 'default' : 'pointer' }}
            >
              {sending ? 'Sending…' : '✈ Send to Telegram'}
            </button>
          )}
          {!canSend && post.postLink && (
            <a href={post.postLink} target="_blank" rel="noopener noreferrer"
              style={{ flex: 2, padding: '10px', fontSize: '13px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
                background: 'rgba(232, 160, 160, 0.06)', color: 'var(--palm-pink)',
                border: '1px solid rgba(232, 160, 160, 0.2)', borderRadius: '8px' }}>
              View on IG ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
