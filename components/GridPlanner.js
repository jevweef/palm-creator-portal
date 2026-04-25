'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { rawDropboxUrl, isVideo } from './EditorDashboard'

const SELECTED_CREATOR_STORAGE_KEY = 'gridplanner:selectedCreatorId'

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

// Status terminology:
//   - 'live'       — already on IG (postedAt or postLink set)
//   - 'scheduled'  — sent to Telegram, locked in. SMM will post next.
//                    Cannot be moved/reordered.
//   - 'queue'      — placed on a grid with a future date OR no date set,
//                    waiting to be sent. Movable. Date is reactive (derived
//                    from queue position).
function postStatus(post) {
  if (post.postedAt || post.postLink) return 'live'
  if (post.telegramSentAt) return 'scheduled'
  return 'queue'
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

  // IG-style render: newest at top-left, oldest at bottom-right.
  //  - Queue cells (unsent): top-left = furthest future (e.g. 4/27 PM),
  //    bottom-right of queue = next to post (e.g. 4/25 AM).
  //  - Then Scheduled (sent to Telegram, locked) below queue, by send date desc.
  //  - Then Live (posted) below that.
  const queue = posts
    .filter(p => !p.telegramSentAt && !p.postedAt)
    .sort((a, b) => new Date(b.scheduledDate || 0) - new Date(a.scheduledDate || 0))

  const past = posts
    .filter(p => p.telegramSentAt || p.postedAt)
    .sort((a, b) => new Date(b.telegramSentAt || b.postedAt || 0) - new Date(a.telegramSentAt || a.postedAt || 0))

  // Scraped IG posts from RapidAPI — show as locked "posted" cells beneath scheduled/past.
  // These are the real IG feed thumbnails so the grid reads like the account's actual page.
  const scrapedCells = (account?.scrapedFeed || []).map(s => ({
    id: `scraped-${s.url}`,
    name: s.caption ? s.caption.slice(0, 60) : 'Live IG post',
    thumbnail: s.thumbnail,
    postLink: s.url,
    postedAt: s.postedAt,
    caption: s.caption || '',
    likes: s.likes,
    _scraped: true,
  }))

  // Dedupe: if a scraped post matches a Post record's postLink, skip the scraped one
  const postLinks = new Set(past.map(p => p.postLink).filter(Boolean))
  const uniqScraped = scrapedCells.filter(s => !postLinks.has(s.postLink))

  const allCells = [...queue, ...past, ...uniqScraped]

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
                {profile?.postCount != null ? formatCount(profile.postCount) : (past.length + queue.length + uniqScraped.length)}
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
          <div style={{ marginTop: '6px' }}>
            <div style={{ fontSize: '9px', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
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
            {account?.scrapedError && (
              <div style={{ fontSize: '9px', marginTop: '4px', color: '#E87878', textAlign: 'right', fontFamily: 'monospace', wordBreak: 'break-word', opacity: 0.8 }}>
                {account.scrapedError}
              </div>
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
          // Only queue items can be reordered. Scheduled (sent to Telegram)
          // and live posts are locked.
          const draggable = status === 'queue'
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
  // Scraped-from-IG cells (already posted on the real account) get a darker
  // overlay so they're visually distinct from our own scheduled/sent cells.
  const isScraped = !!post._scraped

  const borderByStatus = {
    queue:     { bg: 'rgba(232, 160, 160, 0.05)', ring: 'var(--palm-pink)', badge: 'var(--palm-pink)' },
    scheduled: { bg: 'rgba(125, 211, 164, 0.06)', ring: 'rgba(125, 211, 164, 0.2)', badge: '#7DD3A4' },
    live:      { bg: 'var(--foreground)', ring: 'transparent', badge: 'rgba(240, 236, 232, 0.75)' },
  }
  const style = borderByStatus[status] || borderByStatus.live

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart() } : undefined}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsOver(false); onDrop() }}
      onClick={onClick}
      title={isScraped ? `Already on IG · ${formatScheduled(post.postedAt)}` : `${status}${post.scheduledDate ? ' · ' + formatScheduled(post.scheduledDate) : ''}`}
      style={{
        aspectRatio: '1 / 1',
        background: post.thumbnail ? '#000' : style.bg,
        position: 'relative',
        cursor: draggable ? 'grab' : 'pointer',
        opacity: isDragging ? 0.4 : 1,
        outline: isOver ? '1px solid var(--palm-pink)' : 'none',
        outlineOffset: '-2px',
        overflow: 'hidden',
      }}
    >
      {post.thumbnail ? (
        <CellThumb post={post} style={style} status={status} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: style.badge, fontSize: '20px' }}>
          {status === 'queue' ? '🗓' : status === 'scheduled' ? '✓' : '·'}
        </div>
      )}

      {/* Darker overlay for scraped (already-live on IG) cells so the admin
          can immediately tell them apart from our own scheduled/sent cells */}
      {isScraped && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 100%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Status chip */}
      <div style={{
        position: 'absolute', top: 3, left: 3,
        padding: '1px 5px', borderRadius: '3px',
        background: isScraped ? 'rgba(240, 236, 232, 0.85)' : 'rgba(0,0,0,0.55)',
        color: isScraped ? '#060606' : 'var(--foreground)',
        fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {isScraped ? 'live' : status}
      </div>
      {/* Date chip */}
      {post.scheduledDate && status !== 'live' && !isScraped && (
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          padding: '1px 4px', borderRadius: '3px',
          background: 'rgba(0,0,0,0.55)', color: 'var(--foreground)',
          fontSize: '8px', fontWeight: 600,
        }}>
          {new Date(post.scheduledDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/New_York' })}
        </div>
      )}

      {/* SMM-scheduled checkmark — visible in all modes so admins can see status too */}
      {post.smmScheduled && !isScraped && (
        <div style={{
          position: 'absolute', top: 3, right: 3,
          width: '16px', height: '16px', borderRadius: '50%',
          background: 'rgba(34,197,94,0.95)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: 700,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
        }}>✓</div>
      )}
    </div>
  )
}

// ─── Unassigned tray ───────────────────────────────────────────────────────────

// Phone-grid cell thumbnail with onError fallback. Same broken-attachment
// problem as the tray — Airtable attachment URLs can rotate and source URLs
// can die. Swap to the placeholder if the image won't load.
function CellThumb({ post, style, status }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: style?.badge || '#999', fontSize: '20px' }}>
        {status === 'queue' ? '🗓' : status === 'scheduled' ? '✓' : '·'}
      </div>
    )
  }
  return (
    <img
      src={post.thumbnail}
      alt=""
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
    />
  )
}

// Tray thumbnail with onError fallback. Some Post.Thumbnail attachments point
// at stale/dead source URLs (Airtable attachment URLs rotate, original Dropbox
// links can become invalid). When the <img> fails to load, swap to the
// UNPREPPED placeholder so the cell doesn't show a broken-image icon.
function TrayThumb({ sample }) {
  const [failed, setFailed] = useState(false)
  if (!sample.thumbnail || failed) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--background)', color: 'var(--foreground-muted)', fontSize: '20px', gap: '2px', pointerEvents: 'none' }}>
        <span>✏</span>
        <span style={{ fontSize: '8px', fontWeight: 600 }}>UNPREPPED</span>
      </div>
    )
  }
  return (
    <img
      src={sample.thumbnail}
      alt=""
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
    />
  )
}

// Unassigned column — phone-shaped, 3-wide grid of reel tiles. Each tile is
// draggable; drop onto an account phone to place. Counter badge = remaining
// instances.
function UnassignedTray({ groups, accounts, draggingTaskKey, onDragStart, onDragEnd, onTileClick, smmMode = false, onDebug }) {
  const visibleGroups = smmMode
    ? groups.filter(g => g.samplePost?.thumbnail)
    : groups
  const totalSlotsRemaining = visibleGroups.reduce((s, g) => s + g.remaining, 0)

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

      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--palm-pink)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>🗂️</span> Ready to schedule
        </div>
        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>
          {visibleGroups.length} reel{visibleGroups.length !== 1 && 's'} · {totalSlotsRemaining} slot{totalSlotsRemaining !== 1 && 's'} left
        </div>
        <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginTop: '6px' }}>
          Drag a thumbnail onto an account →
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '12px' }}>
          Nothing waiting to be scheduled.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '2px',
          background: 'var(--card-bg-solid)',
          padding: '2px 0',
        }}>
          {visibleGroups.map(g => {
            const key = g.taskId || `orphan-${g.samplePost.id}`
            const isDragging = draggingTaskKey === key
            const sample = g.samplePost
            return (
              <div
                key={key}
                draggable
                onClick={() => onTileClick?.(g)}
                onDragStart={(e) => {
                  // 'all' lets either 'copy' or 'move' dropEffect be accepted
                  // by the target. Setting 'copy' while the target uses 'move'
                  // causes the browser to silently cancel the drop (dropEffect
                  // ends up 'none'), which was the actual bug here.
                  e.dataTransfer.effectAllowed = 'all'
                  try { e.dataTransfer.setData('text/plain', key) } catch {}
                  onDebug?.(`dragStart ${key.slice(-8)} rem=${g.remaining}`)
                  onDragStart(g)
                }}
                onDragEnd={(e) => {
                  onDebug?.(`dragEnd dropEffect=${e.dataTransfer?.dropEffect || 'none'}`)
                  onDragEnd()
                }}
                title={`${sample.name || 'Reel'} — click to preview, drag to schedule`}
                style={{
                  aspectRatio: '1 / 1',
                  background: '#000',
                  position: 'relative',
                  cursor: 'grab',
                  opacity: isDragging ? 0.4 : 1,
                  overflow: 'hidden',
                }}
              >
                <TrayThumb sample={sample} />
                {/* Counter badge */}
                <div style={{
                  position: 'absolute', top: 4, right: 4,
                  minWidth: '20px', height: '20px', borderRadius: '10px',
                  background: 'var(--palm-pink)', color: '#060606',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 800, padding: '0 5px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  pointerEvents: 'none',
                }}>
                  {g.remaining}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function GridPlanner({ smmMode = false } = {}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creators, setCreators] = useState([])
  const [selectedCreatorId, setSelectedCreatorId] = useState(null)
  const [selectedCreatorMeta, setSelectedCreatorMeta] = useState(null) // { telegramThreadId, name }
  const [accounts, setAccounts] = useState([])
  const [posts, setPosts] = useState([])
  const [unassignedGroups, setUnassignedGroups] = useState([])
  const [draggingTaskGroup, setDraggingTaskGroup] = useState(null) // picked-up group (via click) — name kept so downstream code unchanged
  const [dragging, setDragging] = useState({ postId: null, sourceAccountId: null })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [detailPost, setDetailPost] = useState(null) // { post, accountId, account }
  const [sendingPostId, setSendingPostId] = useState(null)

  // On-screen debug log — visible diagnostic panel. Captures drag/drop/API
  // events so bugs can be diagnosed without opening devtools.
  const [debugLog, setDebugLog] = useState([])
  const pushDebug = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(-8)
    setDebugLog(prev => [`${ts}  ${msg}`, ...prev].slice(0, 12))
  }, [])

  // Load creator list on mount. Prefer (in order):
  //   1. creatorId in URL query (so links are shareable)
  //   2. last-selected creator in localStorage (persists across refresh)
  //   3. first creator with ≥1 account (default)
  useEffect(() => {
    fetch('/api/admin/grid-planner')
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        const list = d.creators || []
        setCreators(list)

        const urlId = searchParams?.get('creatorId')
        let stored = null
        try { stored = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_CREATOR_STORAGE_KEY) : null } catch {}

        const candidates = [urlId, stored].filter(Boolean)
        const match = candidates
          .map(id => list.find(c => c.id === id))
          .find(Boolean)

        if (match) {
          setSelectedCreatorId(match.id)
        } else {
          const first = list.find(c => c.accountCount > 0)
          if (first) setSelectedCreatorId(first.id)
          else setLoading(false)
        }
      })
      .catch(e => { setError(e.message); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist selected creator to URL + localStorage whenever it changes so
  // refresh / tab-restore brings the user back to the same view.
  useEffect(() => {
    if (!selectedCreatorId) return
    try { localStorage.setItem(SELECTED_CREATOR_STORAGE_KEY, selectedCreatorId) } catch {}
    const currentUrl = searchParams?.get('creatorId')
    if (currentUrl !== selectedCreatorId && pathname) {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('creatorId', selectedCreatorId)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCreatorId])

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
      setUnassignedGroups(d.unassignedGroups || [])
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
    // Errors stick for 10s so failures don't get missed; successes fade 2.8s
    setTimeout(() => setToast(null), isError ? 10000 : 2800)
  }

  // Drag handlers
  const handleDragStart = (postId, sourceAccountId) => {
    pushDebug(`cellDragStart post=${postId.slice(-6)} acc=${sourceAccountId?.slice(-6)}`)
    setDragging({ postId, sourceAccountId })
  }
  const handleDragEnd = () => {
    pushDebug('cellDragEnd')
    setDragging({ postId: null, sourceAccountId: null })
  }

  // Drop onto an existing post in an account grid.
  // Same account: insertion-shift reorder. Source moves to target's queue
  // position; everything between source and target shifts toward source's
  // old position. Server then renumbers all queue dates for that account.
  // Different account: reassign dragged post to target account.
  const handleDropOnPost = async (targetPostId, targetAccountId) => {
    const sourcePostId = dragging.postId
    const sourceAcc = dragging.sourceAccountId
    pushDebug(`dropOnPost target=${targetPostId.slice(-6)} acc=${targetAccountId.slice(-6)} src=${sourcePostId?.slice(-6) || 'null'}`)
    if (!sourcePostId || sourcePostId === targetPostId) {
      pushDebug(`↳ skip: ${!sourcePostId ? 'no source' : 'same post'}`)
      return
    }

    const sourcePost = posts.find(p => p.id === sourcePostId)
    const targetPost = posts.find(p => p.id === targetPostId)
    if (!sourcePost || !targetPost) {
      pushDebug(`↳ skip: ${!sourcePost ? 'source not found' : 'target not found'}`)
      return
    }

    setSaving(true)
    try {
      if (sourceAcc && sourceAcc === targetAccountId) {
        // Insertion-shift reorder within the same account.
        // Build the queue (oldest → newest = sorted asc by current scheduledDate).
        const queue = posts
          .filter(p => p.accountId === targetAccountId && !p.telegramSentAt && !p.postedAt)
          .sort((a, b) => new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0))
        const fromIdx = queue.findIndex(p => p.id === sourcePostId)
        const toIdx = queue.findIndex(p => p.id === targetPostId)
        if (fromIdx === -1 || toIdx === -1) return

        // Move source to target's index; everything between shifts.
        const newQueue = [...queue]
        const [moved] = newQueue.splice(fromIdx, 1)
        newQueue.splice(toIdx, 0, moved)

        // Compute new dates: position 0 = today AM, 1 = today PM, 2 = tomorrow AM, ...
        // Mirror server-side getQueueSlots so optimistic UI matches truth.
        const computeSlots = (count) => {
          const slots = []
          const now = new Date()
          const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
          const [sy, sm, sd] = todayET.split('-').map(Number)
          for (let i = 0; i < count; i++) {
            const dayOffset = Math.floor(i / 2)
            const hourIdx = i % 2
            const etHour = [11, 19][hourIdx]
            // Construct noon UTC of target day so format-back-to-ET stays stable
            const iter = new Date(Date.UTC(sy, sm - 1, sd + dayOffset, 12))
            const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iter)
            const [ty, tm, td] = etDateStr.split('-').map(Number)
            // 11 AM EDT = 15:00 UTC, 7 PM EDT = 23:00 UTC. Use Intl-derived offset
            // to handle EDT/EST boundary correctly.
            const noonUtc = new Date(Date.UTC(ty, tm - 1, td, 12))
            const etHourAtNoon = parseInt(
              new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(noonUtc)
            )
            const utcHour = etHour + (12 - etHourAtNoon)
            slots.push(new Date(Date.UTC(ty, tm - 1, td, utcHour)).toISOString())
          }
          return slots
        }
        const slots = computeSlots(newQueue.length)
        const dateById = Object.fromEntries(newQueue.map((p, i) => [p.id, slots[i]]))

        // Optimistic UI
        setPosts(posts.map(p => dateById[p.id] ? { ...p, scheduledDate: dateById[p.id] } : p))

        const res = await fetch('/api/admin/grid-planner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reorder', accountId: targetAccountId, postIds: newQueue.map(p => p.id) }),
        })
        if (!res.ok) throw new Error('Reorder failed')
        showToast('Reordered')
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
    // Drop from the Unassigned Tray (task group drag) — this is the primary
    // drop path now. Triggers assignInstance: picks up an unassigned Post in
    // the task group or clones a sibling, then schedules it on the next open
    // slot on this account.
    pushDebug(`handleDrop acc=${accountId.slice(-6)} group=${!!draggingTaskGroup}`)
    if (draggingTaskGroup) {
      const group = draggingTaskGroup
      // Guard: already at this account
      if (group.assignedAccountIds?.includes(accountId)) {
        pushDebug('↳ already on this account')
        showToast('Already on this account', true)
        setDraggingTaskGroup(null)
        return
      }
      setSaving(true)
      try {
        pushDebug(`↳ PATCH assignInstance ids=${(group.unassignedPostIds || []).length}`)
        const res = await fetch('/api/admin/grid-planner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'assignInstance',
            taskId: group.taskId,
            accountId,
            unassignedPostIds: group.unassignedPostIds || [],
          }),
        })
        const data = await res.json()
        pushDebug(`↳ resp ${res.status} ${data.reused ? 'reused' : data.cloned ? 'cloned' : 'other'}`)
        if (!res.ok) throw new Error(data.error || 'Assign failed')
        showToast(`Scheduled on ${accounts.find(a => a.id === accountId)?.name || 'account'}`)

        // Optimistically reflect the placement locally so the UI feels instant
        // and doesn't rely on Airtable's eventual-consistency window for the
        // re-GET to show the change. The refetch below is authoritative truth,
        // so if the optimistic patch differs we snap back.
        if (data.reused && data.postId) {
          setPosts(prev => prev.map(p =>
            p.id === data.postId
              ? { ...p, accountId, scheduledDate: data.scheduledDate || p.scheduledDate }
              : p
          ))
        } else if (data.cloned && data.postId) {
          // Clone from samplePost so the new cell renders immediately
          const sample = group.samplePost
          setPosts(prev => [...prev, {
            id: data.postId,
            name: sample?.name || '',
            status: 'Prepping',
            accountId,
            taskId: group.taskId,
            scheduledDate: data.scheduledDate,
            telegramSentAt: null,
            postedAt: null,
            postLink: '',
            thumbnail: sample?.thumbnail || '',
            platform: sample?.platform || [],
            caption: sample?.caption || '',
            hashtags: sample?.hashtags || '',
            asset: sample?.asset || null,
            thumbnailUrl: sample?.thumbnailUrl || '',
          }])
        }
        // Decrement the tray badge locally so it matches the drop
        setUnassignedGroups(prev => prev.map(g => {
          const gKey = g.taskId || `orphan-${g.samplePost?.id}`
          const dKey = group.taskId || `orphan-${group.samplePost?.id}`
          if (gKey !== dKey) return g
          const nextAssigned = Array.from(new Set([...(g.assignedAccountIds || []), accountId]))
          const nextUnassigned = data.reused
            ? (g.unassignedPostIds || []).filter(id => id !== data.postId)
            : (g.unassignedPostIds || [])
          return {
            ...g,
            remaining: Math.max(0, (g.remaining || 0) - 1),
            assignedAccountIds: nextAssigned,
            unassignedPostIds: nextUnassigned,
          }
        }).filter(g => g.remaining > 0))

        // Optimistic update is authoritative — no auto-refetch. The PATCH
        // response confirms the write, so re-GETing just to verify wastes
        // the round-trip and makes the page feel like it's reloading after
        // every drop. User can manually refresh if they suspect drift.
      } catch (e) {
        showToast(e.message, true)
      } finally {
        setSaving(false)
        setDraggingTaskGroup(null)
      }
      return
    }

    // Fallback: drag from a different account grid (post already placed)
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

  // Bulk send: fire all scheduled-but-unsent posts for this creator to Telegram
  // in order of Scheduled Date. Each fetch returns in ~1s (waitUntil-backed
  // server endpoint), so firing 10 in parallel is fine. Each post flips to
  // 'Sending' on its own schedule.
  const [bulkSending, setBulkSending] = useState(false)
  const sendablePosts = posts
    .filter(p => p.accountId && p.scheduledDate && p.status !== 'Sent to Telegram' && p.status !== 'Sending' && p.status !== 'Send Failed' && !p.telegramSentAt && !p.postedAt && p.asset?.editedFileLink)
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
  const handleBulkSend = async () => {
    if (!sendablePosts.length) return
    // Each post routes to its own account's Telegram topic in the SMM master
    // group. Posts without an account or whose account has no topic ID can't
    // be sent — flag them.
    const accountById = Object.fromEntries(accounts.map(a => [a.id, a]))
    const missingTopic = sendablePosts.filter(p => !accountById[p.accountId]?.telegramTopicId)
    if (missingTopic.length) {
      showToast(`${missingTopic.length} post${missingTopic.length !== 1 ? 's' : ''} can't send — account has no Telegram topic. Run backfill on /sm.`, true)
      return
    }
    const confirmed = window.confirm(`Send ${sendablePosts.length} scheduled post${sendablePosts.length !== 1 ? 's' : ''} to Telegram? They'll fire in order of Scheduled Date, each routed to its account's topic in the SMM group.`)
    if (!confirmed) return
    setBulkSending(true)
    // Optimistic UI update
    const sendableIds = new Set(sendablePosts.map(p => p.id))
    setPosts(prev => prev.map(p => sendableIds.has(p.id) ? { ...p, status: 'Sending' } : p))
    try {
      // Fire all requests. Each server call returns in ~1s via waitUntil; the
      // actual sends happen async on Vercel's side. Sequenced-by-date is
      // already the sort order of sendablePosts; we kick them in that order
      // 200ms apart so the server-side order lines up with user expectation.
      let errorCount = 0
      for (let i = 0; i < sendablePosts.length; i++) {
        const p = sendablePosts[i]
        try {
          const res = await fetch('/api/telegram/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: p.id,
              editedFileLink: p.asset?.editedFileLink,
              smmTopicId: accountById[p.accountId].telegramTopicId,
              caption: [p.caption, p.hashtags].filter(Boolean).join('\n\n') || undefined,
              thumbnailUrl: p.thumbnailUrl || undefined,
              assetId: p.asset?.id || undefined,
              rawCaption: p.caption || undefined,
              rawHashtags: p.hashtags || undefined,
              platform: p.platform?.length ? p.platform : undefined,
              scheduledDate: p.scheduledDate || undefined,
            }),
          })
          if (!res.ok) errorCount++
        } catch {
          errorCount++
        }
        // Small delay between queue submissions — keeps server logs readable
        // and avoids hammering Vercel with 10 concurrent function starts.
        if (i < sendablePosts.length - 1) await new Promise(r => setTimeout(r, 200))
      }
      if (errorCount) {
        showToast(`Queued ${sendablePosts.length - errorCount}/${sendablePosts.length} · ${errorCount} failed to queue`, errorCount > 0)
      } else {
        showToast(`Queued ${sendablePosts.length} post${sendablePosts.length !== 1 ? 's' : ''} — sending in background`)
      }
      // Give the server a beat, then reload to pick up 'Sending' status
      setTimeout(() => loadCreator(selectedCreatorId), 2000)
    } finally {
      setBulkSending(false)
    }
  }

  // Push every queue item onto every managed account that doesn't already
  // have it. After this runs, the unassigned tray empties — admin can drag
  // posts around inside each account grid to reorder.
  const [distributing, setDistributing] = useState(false)
  const handleDistributeQueue = async () => {
    if (!selectedCreatorId || !unassignedGroups.length) return
    const remaining = unassignedGroups.reduce((s, g) => s + (g.remaining || 0), 0)
    const confirmed = window.confirm(`Push ${unassignedGroups.length} queue item${unassignedGroups.length !== 1 ? 's' : ''} (${remaining} placement${remaining !== 1 ? 's' : ''}) onto every Palm IG account that's missing it?`)
    if (!confirmed) return
    setDistributing(true)
    try {
      const res = await fetch('/api/admin/grid-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'distributeQueue', creatorId: selectedCreatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Distribute failed')
      showToast(`Distributed ${data.distributed} placement${data.distributed !== 1 ? 's' : ''}`)
      await loadCreator(selectedCreatorId)
    } catch (e) {
      showToast(e.message, true)
    } finally {
      setDistributing(false)
    }
  }

  // Refresh scraped IG feed for all of this creator's accounts.
  // Clicking this button always forces a fresh scrape — the whole point is
  // "I want the latest NOW". The 6h cache on the API is for programmatic
  // callers; user clicks always bypass it.
  const [refreshing, setRefreshing] = useState(false)
  const handleRefreshFeed = async () => {
    if (!selectedCreatorId) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/grid-planner/refresh-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: selectedCreatorId, force: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      const parts = []
      if (data.refreshed) parts.push(`${data.refreshed} scraped`)
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
    const account = accounts.find(a => a.id === post.accountId)
    if (!account?.telegramTopicId) {
      showToast('This account has no Telegram topic set. Run backfill on /sm.', true)
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
          smmTopicId: account.telegramTopicId,
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
            showToast('Scheduled ✓')
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
        {unassignedGroups.length > 0 && (
          <button
            onClick={handleDistributeQueue}
            disabled={distributing}
            title="Push every queue item onto every managed Palm IG account it's not already on. Skips accounts that already have the item."
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 700,
              background: distributing ? 'rgba(232, 160, 160, 0.04)' : 'rgba(232, 160, 160, 0.10)',
              color: 'var(--palm-pink)',
              border: '1px solid rgba(232, 160, 160, 0.25)',
              borderRadius: '6px', cursor: distributing ? 'default' : 'pointer',
            }}
          >
            {distributing ? 'Distributing…' : `↗ Push queue to all accounts`}
          </button>
        )}
        {sendablePosts.length > 0 && (
          <button
            onClick={handleBulkSend}
            disabled={bulkSending}
            title={`Fire all ${sendablePosts.length} scheduled-but-unsent posts to Telegram, sequenced by Scheduled Date. They run in the background — each post's card flips to Sending → Sent as it completes.`}
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 700,
              background: bulkSending ? 'rgba(125, 211, 164, 0.04)' : 'rgba(125, 211, 164, 0.10)',
              color: bulkSending ? '#7DD3A4' : '#7DD3A4',
              border: '1px solid rgba(125, 211, 164, 0.25)',
              borderRadius: '6px', cursor: bulkSending ? 'default' : 'pointer',
            }}
          >
            {bulkSending ? 'Queuing…' : `✈ Send ${sendablePosts.length} to Telegram`}
          </button>
        )}
        <button
          onClick={handleRefreshFeed}
          disabled={refreshing || !selectedCreatorId}
          title="Pull the latest posts + profile from each IG account (always forces a fresh scrape)."
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
                alignItems: 'flex-start',
              }}
            >
              {/* Leftmost column — unassigned reels, phone-shaped. Drag a tile. */}
              <UnassignedTray
                groups={unassignedGroups}
                accounts={accounts}
                smmMode={smmMode}
                draggingTaskKey={draggingTaskGroup ? (draggingTaskGroup.taskId || `orphan-${draggingTaskGroup.samplePost?.id}`) : null}
                onDragStart={(group) => setDraggingTaskGroup(group)}
                onDragEnd={() => setDraggingTaskGroup(null)}
                onTileClick={(group) => setDetailPost({ post: group.samplePost, account: null, fromTray: true })}
                onDebug={pushDebug}
              />

              {/* Account phones — drop targets */}
              {accounts.map(acc => (
                <div
                  key={acc.id}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    pushDebug(`dragEnter acc=${acc.name?.slice(-10) || acc.id.slice(-6)}`)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    pushDebug(`DROP acc=${acc.name?.slice(-10) || acc.id.slice(-6)} hasGroup=${!!draggingTaskGroup}`)
                    handleDropOnAccount(acc.id)
                  }}
                  style={{
                    // Subtle visible drop target so user sees phones ARE drop zones
                    outline: draggingTaskGroup ? '2px dashed rgba(232,160,160,0.5)' : 'none',
                    outlineOffset: '6px',
                    borderRadius: '40px',
                    transition: 'outline 0.1s ease',
                  }}
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
          onUnassign={async () => {
            const postId = detailPost.post.id
            // Optimistic: remove account locally, send post back to tray
            setPosts(ps => ps.map(p => p.id === postId ? { ...p, accountId: null } : p))
            setDetailPost(null)
            try {
              const res = await fetch('/api/admin/grid-planner', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'assign', postId, accountIds: [] }),
              })
              if (!res.ok) throw new Error('Unassign failed')
              showToast('Sent back to tray')
              setTimeout(() => loadCreator(selectedCreatorId), 2500)
            } catch (e) {
              showToast(e.message, true)
              loadCreator(selectedCreatorId)
            }
          }}
          onSendBackToPrepping={async () => {
            const postId = detailPost.post.id
            // Optimistic
            setPosts(ps => ps.map(p => p.id === postId ? { ...p, status: 'Prepping' } : p))
            setDetailPost(d => d && d.post.id === postId ? { ...d, post: { ...d.post, status: 'Prepping' } } : d)
            try {
              const res = await fetch('/api/admin/grid-planner', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'setStatus', postId, status: 'Prepping' }),
              })
              if (!res.ok) throw new Error('Status update failed')
              showToast('Sent back to Prepping')
              setTimeout(() => loadCreator(selectedCreatorId), 2500)
            } catch (e) {
              showToast(e.message, true)
              loadCreator(selectedCreatorId)
            }
          }}
          onThumbnailReplaced={(postId, newUrl) => {
            // Optimistic: drop the new URL on the post so the grid cell flips
            // immediately. The Dropbox URL itself doesn't render in <img> reliably,
            // so we also refetch from Airtable — Airtable re-hosts attachments
            // on its CDN and that URL works everywhere.
            setPosts(ps => ps.map(p => p.id === postId ? { ...p, thumbnail: newUrl, thumbnailUrl: newUrl } : p))
            setDetailPost(d => d && d.post.id === postId
              ? { ...d, post: { ...d.post, thumbnail: newUrl, thumbnailUrl: newUrl } }
              : d
            )
            showToast('Thumbnail updated')
            // Airtable needs ~3-5s to ingest the source URL into its CDN. Refetch
            // after that so the post object gets the Airtable-hosted URL.
            setTimeout(() => loadCreator(selectedCreatorId), 4000)
          }}
          smmMode={smmMode}
          onMarkScheduled={async (scheduled) => {
            // Optimistic update on the post in local state
            setPosts(ps => ps.map(p => p.id === detailPost.post.id
              ? { ...p, smmScheduled: scheduled, smmScheduledAt: scheduled ? new Date().toISOString() : null }
              : p
            ))
            setDetailPost(d => d && ({
              ...d,
              post: { ...d.post, smmScheduled: scheduled, smmScheduledAt: scheduled ? new Date().toISOString() : null },
            }))
            try {
              const res = await fetch('/api/admin/sm-grid/mark-scheduled', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postId: detailPost.post.id, scheduled }),
              })
              if (!res.ok) throw new Error('Failed')
              showToast(scheduled ? 'Marked scheduled' : 'Unmarked')
            } catch (e) {
              // Revert
              setPosts(ps => ps.map(p => p.id === detailPost.post.id
                ? { ...p, smmScheduled: !scheduled }
                : p
              ))
              showToast('Failed to update', true)
            }
          }}
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

      {/* On-screen debug log — TEMPORARY. Paste this back so we can diagnose
          drag-drop. Click the × to dismiss. */}
      {debugLog.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '24px', zIndex: 300,
          width: '420px', maxHeight: '320px', overflowY: 'auto',
          background: 'rgba(10, 10, 10, 0.95)',
          border: '1px solid rgba(232, 160, 160, 0.3)',
          borderRadius: '8px',
          padding: '10px 12px',
          fontSize: '11px', fontFamily: 'monospace',
          color: 'var(--foreground)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: 700, color: 'var(--palm-pink)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Drag Debug</span>
            <button onClick={() => setDebugLog([])} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', cursor: 'pointer', padding: 0, fontSize: '14px' }}>×</button>
          </div>
          {debugLog.map((line, i) => (
            <div key={i} style={{ lineHeight: 1.6, color: i === 0 ? 'var(--palm-pink)' : 'var(--foreground-muted)', whiteSpace: 'pre-wrap' }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Post detail + Send modal ──────────────────────────────────────────────────
// Opens when a cell is clicked in the grid. Shows thumbnail + caption preview
// and a "Send to Telegram" action. This is where posts actually get sent now
// (Post Prep only preps — no send action there anymore).
const smmBtn = {
  display: 'block',
  padding: '9px 10px',
  fontSize: '12px',
  fontWeight: 600,
  textAlign: 'center',
  textDecoration: 'none',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--foreground)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  cursor: 'pointer',
}

function PostDetailModal({ post, account, creatorMeta, sending, onClose, onSend, onUnassign, onThumbnailReplaced, onSendBackToPrepping, smmMode = false, onMarkScheduled }) {
  const [copiedKey, setCopiedKey] = useState(null)
  const [uploadingThumb, setUploadingThumb] = useState(false)
  const [localThumb, setLocalThumb] = useState(null) // optimistic preview after upload
  const thumbInputRef = useRef(null)
  async function copyText(text, key) {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }
  const isScraped = !!post._scraped
  const canReplaceThumb = !isScraped && post.id?.startsWith('rec')

  async function handleThumbnailFile(file) {
    if (!file || !file.type?.startsWith('image/')) {
      alert('Pick an image file (JPEG, PNG, etc.).')
      return
    }
    setUploadingThumb(true)
    try {
      // Show local preview immediately
      const previewUrl = URL.createObjectURL(file)
      setLocalThumb(previewUrl)

      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/grid-planner/post-thumbnail/${post.id}`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Thumbnail upload failed')
      onThumbnailReplaced?.(post.id, data.url)
    } catch (e) {
      alert(`Could not replace thumbnail: ${e.message}`)
      setLocalThumb(null)
    } finally {
      setUploadingThumb(false)
    }
  }
  // Scraped cells are just IG feed items — never sendable, never have an
  // Airtable Status. Show them as "Live" with a link out.
  // Airtable Status values are mapped to user-facing labels:
  //   Prepping/Staged → Queue, Sent to Telegram → Scheduled, Posted → Live.
  const rawStatus = isScraped ? 'Live' : (post.status || 'Prepping')
  const displayStatusMap = {
    'Prepping': 'Queue',
    'Staged': 'Queue',
    'Sent to Telegram': 'Scheduled',
    'Posted': 'Live',
    'Live on IG': 'Live',
  }
  const effectiveStatus = displayStatusMap[rawStatus] || rawStatus
  const canSend = !isScraped && post.asset?.editedFileLink && post.status !== 'Sent to Telegram' && post.status !== 'Sending' && post.status !== 'Posted'
  const scheduledLabel = post.scheduledDate
    ? new Date(post.scheduledDate).toLocaleDateString('en-US', {
        timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : post.postedAt
    ? new Date(post.postedAt).toLocaleDateString('en-US', {
        timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : null
  const statusStyle = {
    'Sending': { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    'Scheduled': { bg: 'rgba(125, 211, 164, 0.10)', color: '#7DD3A4', border: 'rgba(125, 211, 164, 0.3)' },
    'Send Failed': { bg: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
    'Live': { bg: 'rgba(232, 160, 160, 0.08)', color: 'var(--palm-pink)', border: 'rgba(232, 160, 160, 0.3)' },
    'Queue': { bg: 'rgba(232, 160, 160, 0.10)', color: 'var(--palm-pink)', border: 'rgba(232, 160, 160, 0.3)' },
  }[effectiveStatus] || { bg: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)', border: 'rgba(255,255,255,0.08)' }

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
              {account?.handle || account?.name
                ? `@${account.handle || account.name}`
                : <span style={{ color: 'var(--palm-pink)', fontWeight: 600 }}>Unassigned</span>}
              {scheduledLabel ? ' · ' + scheduledLabel : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--foreground-muted)', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        {/* Thumbnail / Video */}
        <div style={{ padding: '0 20px', position: 'relative' }}>
          <div style={{ aspectRatio: '9/16', maxHeight: '400px', margin: '0 auto', background: '#000', borderRadius: '10px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {(() => {
              const videoLink = post.asset?.editedFileLink || post.assetEditedFileLink
              const videoSrc = videoLink && isVideo(videoLink) ? rawDropboxUrl(videoLink) : null
              const posterSrc = localThumb || post.thumbnail
              if (videoSrc) {
                return (
                  <video
                    src={videoSrc}
                    poster={posterSrc || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                  />
                )
              }
              if (posterSrc) {
                return <img src={posterSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              }
              return <div style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>No thumbnail</div>
            })()}
            {uploadingThumb && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--palm-pink)', fontSize: '13px', fontWeight: 600,
              }}>
                Uploading new thumbnail…
              </div>
            )}
          </div>
          {canReplaceThumb && (
            <div style={{ marginTop: '8px', textAlign: 'center' }}>
              <input
                ref={thumbInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleThumbnailFile(f)
                  e.target.value = ''
                }}
              />
              {post.thumbnailBroken && (
                <div style={{ fontSize: '11px', color: '#ef4444', marginBottom: '6px', fontWeight: 500 }}>
                  ⚠ Existing thumbnail is broken — replace it.
                </div>
              )}
              <button
                onClick={() => thumbInputRef.current?.click()}
                disabled={uploadingThumb}
                style={{
                  background: post.thumbnailBroken ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
                  border: `1px solid ${post.thumbnailBroken ? 'rgba(239, 68, 68, 0.4)' : 'var(--card-border)'}`,
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  color: post.thumbnailBroken ? '#ef4444' : 'var(--foreground-muted)',
                  cursor: uploadingThumb ? 'default' : 'pointer',
                  fontWeight: 500,
                }}
              >
                {uploadingThumb ? 'Uploading…' : '↻ Replace thumbnail'}
              </button>
            </div>
          )}
        </div>

        {/* Status pill */}
        <div style={{ padding: '12px 20px 0', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            padding: '3px 10px', borderRadius: '20px',
            background: statusStyle.bg, color: statusStyle.color,
            border: `1px solid ${statusStyle.border}`,
          }}>
            {effectiveStatus}
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

        {/* Caption + Hashtags */}
        {(post.caption || post.hashtags) ? (
          <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {post.caption && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '4px' }}>Caption</div>
                <div style={{ fontSize: '12px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '8px 10px' }}>
                  {post.caption}
                </div>
              </div>
            )}
            {post.hashtags && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '4px' }}>Hashtags</div>
                <div style={{ fontSize: '12px', color: 'var(--foreground)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: '100px', overflowY: 'auto', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '8px 10px' }}>
                  {post.hashtags}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '12px 20px 0', fontSize: '11px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
            No caption or hashtags yet.
          </div>
        )}

        {/* SMM action grid — only in smmMode, only for non-scraped posts with an asset */}
        {smmMode && !isScraped && (
          <div style={{ padding: '12px 20px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {post.asset?.editedFileLink ? (
                <a href={post.asset.editedFileLink} target="_blank" rel="noreferrer" style={smmBtn}>
                  ↓ Video
                </a>
              ) : <span style={{ ...smmBtn, opacity: 0.4 }}>↓ Video</span>}
              {post.thumbnailUrl ? (
                <a href={post.thumbnailUrl} target="_blank" rel="noreferrer" style={smmBtn}>
                  ↓ Thumbnail
                </a>
              ) : <span style={{ ...smmBtn, opacity: 0.4 }}>↓ Thumbnail</span>}
              <button
                onClick={() => copyText(post.caption, 'c')}
                disabled={!post.caption}
                style={{ ...smmBtn, opacity: post.caption ? 1 : 0.4, cursor: post.caption ? 'pointer' : 'default' }}
              >
                {copiedKey === 'c' ? '✓ Copied' : '⎘ Caption'}
              </button>
              <button
                onClick={() => copyText(post.hashtags, 'h')}
                disabled={!post.hashtags}
                style={{ ...smmBtn, opacity: post.hashtags ? 1 : 0.4, cursor: post.hashtags ? 'pointer' : 'default' }}
              >
                {copiedKey === 'h' ? '✓ Copied' : '⎘ Hashtags'}
              </button>
            </div>
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
          {/* Unassign: only if placed + editable (not scraped, not sent/posted) */}
          {!isScraped && onUnassign && post.accountId && !post.telegramSentAt && !post.postedAt && post.status !== 'Sent to Telegram' && post.status !== 'Sending' && post.status !== 'Posted' && (
            <button
              onClick={() => { if (confirm('Send this reel back to the tray?')) onUnassign() }}
              title="Remove from this account — the reel goes back to the Ready to Schedule tray"
              style={{ flex: 1, padding: '10px', fontSize: '13px', fontWeight: 600,
                background: 'rgba(232, 120, 120, 0.06)', color: '#E87878',
                border: '1px solid rgba(232, 120, 120, 0.25)', borderRadius: '8px', cursor: 'pointer' }}
            >
              ↶ Unassign
            </button>
          )}
          {/* Send back to Prepping: any non-prepping, non-final post */}
          {!isScraped && onSendBackToPrepping && post.status !== 'Prepping' && !post.telegramSentAt && !post.postedAt && (
            <button
              onClick={() => { if (confirm('Send this post back to Prepping? You can re-edit thumbnail, caption, etc.')) onSendBackToPrepping() }}
              title="Move this post back to Prepping status"
              style={{ flex: 1, padding: '10px', fontSize: '13px', fontWeight: 600,
                background: 'rgba(202, 138, 4, 0.08)', color: '#ca8a04',
                border: '1px solid rgba(202, 138, 4, 0.3)', borderRadius: '8px', cursor: 'pointer' }}
            >
              ↺ To Prepping
            </button>
          )}
          {smmMode && !isScraped ? (
            <button
              onClick={() => onMarkScheduled?.(!post.smmScheduled)}
              style={{ flex: 2, padding: '10px', fontSize: '13px', fontWeight: 700,
                background: post.smmScheduled ? 'rgba(34,197,94,0.15)' : 'rgba(232, 160, 160, 0.12)',
                color: post.smmScheduled ? '#22c55e' : 'var(--palm-pink)',
                border: `1px solid ${post.smmScheduled ? 'rgba(34,197,94,0.3)' : 'rgba(232,160,160,0.3)'}`,
                borderRadius: '8px', cursor: 'pointer' }}
            >
              {post.smmScheduled ? '✓ Scheduled on IG' : 'Mark Scheduled on IG'}
            </button>
          ) : canSend ? (
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
          ) : null}
          {!smmMode && !canSend && post.postLink && (
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
