'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const ADMIN_NAV = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/admin/inspo', label: 'Inspo Board', icon: '🎬', children: [
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'sources', label: 'Sources' },
    { key: 'review', label: 'Review' },
    { key: 'import', label: 'Import' },
    { key: 'training', label: 'Training' },
    { key: 'suggest', label: 'Suggest' },
    { key: 'recreate', label: 'AI Recreate' },
  ]},
  { href: '/admin/editor', label: 'Editor', icon: '✂️', children: [
    { key: 'editorview', label: 'Dashboard' },
    { key: 'review', label: 'For Review' },
    { key: 'postprep', label: 'Post Prep' },
    { key: 'grid', label: 'Grid Planner' },
    { key: 'library', label: 'Creator Library' },
    { key: 'oftv', label: 'OFTV Projects' },
    { key: 'longform', label: 'Long Form' },
  ]},
  { href: '/admin/creators', label: 'Creators', icon: '🎭', children: [
    { key: 'earnings', label: 'Earnings' },
    { key: 'dna', label: 'DNA Profile' },
  ]},
  { href: '/admin/whale-hunting', label: 'Whale Hunting', icon: '🐋', children: [
    { key: 'internal', label: 'Palm Internal' },
    { key: 'team', label: 'Chat Team Report' },
  ]},
  { href: '/photo-library', label: 'Photo Library', icon: '🖼️' },
  { href: '/admin/onboarding', label: 'Onboarding', icon: '📋' },
  { href: '/admin/invoicing', label: 'Invoicing', icon: '💸', children: [
    { key: 'invoices', label: 'Invoices' },
    { key: 'upload', label: 'Raw Data Upload' },
  ]},
  { href: '/admin/inbox', label: 'Inbox', icon: '📥' },
  { href: '/admin/help', label: 'Help', icon: '❓' },
]

const EDITOR_NAV = [
  { href: '/editor', label: 'My Dashboard', icon: '✂️' },
  { href: '/inspo', label: 'Inspo Board', icon: '🎬' },
]

const CHAT_MANAGER_NAV = [
  { href: '/photo-library', label: 'Photo Library', icon: '🖼️' },
]

export default function AdminLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isEditor = role === 'editor'
  const isChatManager = role === 'chat_manager'

  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab')

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Sidebar badge counts — pings the user when a role-relevant queue has
  // items waiting. Right now only OFTV (Final Submitted = needs admin review).
  // Pattern is reusable for Inspo Review, Post Prep, etc. as we go.
  const [navCounts, setNavCounts] = useState({ oftvReview: 0 })
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const tick = () => {
      fetch('/api/admin/oftv-projects?status=Final%20Submitted')
        .then(r => r.ok ? r.json() : { projects: [] })
        .then(d => { if (!cancelled) setNavCounts(c => ({ ...c, oftvReview: (d.projects || []).length })) })
        .catch(() => {})
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isAdmin])

  // Close mobile nav on route change
  useEffect(() => { setMobileNavOpen(false) }, [pathname, activeTab])

  useEffect(() => {
    if (!isLoaded) return
    if (!isAdmin && !isEditor && !isChatManager) {
      router.replace('/dashboard')
    }
    if (isEditor) {
      router.replace('/editor')
    }
    // chat_manager should never see /admin/* — bounce to /photo-library.
    // The layout's role check below also catches this, but redirecting in
    // the effect avoids a flash of the loading state.
    if (isChatManager) {
      router.replace('/photo-library')
    }
  }, [isLoaded, user, router, pathname, isAdmin, isEditor, isChatManager])

  // Early returns AFTER all hooks. Chat managers never render the admin
  // layout — they're redirected above. This block catches anyone else
  // without a permitted role.
  if (!isLoaded || (!isAdmin && !isEditor)) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const NAV_ITEMS = isAdmin ? ADMIN_NAV : EDITOR_NAV
  const sectionLabel = isAdmin ? 'Admin' : 'Editor'
  // Kept for backwards-compatible main-content centering on the deleted
  // legacy /admin/chat-wall path. Always false now since the page moved.
  const isOnChatWall = false

  return (
    <div className="admin-shell" style={{ display: 'flex', minHeight: 'calc(100vh - 49px)', background: 'var(--background)' }}>
      {/* Mobile-only styles — desktop untouched */}
      <style>{`
        @keyframes palmNavBadgePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(232, 120, 120, 0.6); }
          50%      { box-shadow: 0 0 0 6px rgba(232, 120, 120, 0); }
        }
        @keyframes palmNavDotPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.5); opacity: 0.5; }
        }
        @media (max-width: 768px) {
          .admin-shell { display: block !important; }
          .admin-sidebar {
            position: fixed !important;
            top: 49px; left: 0; bottom: 0;
            width: 240px !important;
            z-index: 250;
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            overflow-y: auto;
          }
          .admin-sidebar.open { transform: translateX(0); }
          .admin-sidebar-backdrop {
            display: none;
            position: fixed; inset: 49px 0 0 0;
            background: rgba(0,0,0,0.35);
            z-index: 240;
          }
          .admin-sidebar-backdrop.open { display: block; }
          .admin-mobile-bar {
            display: flex !important;
          }
          .admin-main {
            padding: 12px 14px !important;
          }
        }
        @media (min-width: 769px) {
          .admin-mobile-bar { display: none !important; }
          .admin-sidebar-backdrop { display: none !important; }
        }
      `}</style>

      {/* Mobile top bar — hidden on chat-wall (no nav to expose). */}
      {!isOnChatWall && (
      <div className="admin-mobile-bar" style={{
        display: 'none',
        position: 'sticky', top: 0, zIndex: 220,
        background: 'rgba(10, 10, 10, 0.95)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '10px 14px',
        alignItems: 'center', gap: '12px',
      }}>
        <button
          onClick={() => setMobileNavOpen(o => !o)}
          aria-label="Open navigation"
          style={{
            background: 'rgba(232, 160, 160, 0.08)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px',
            width: '36px', height: '36px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }}
        >
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ width: '16px', height: '2px', background: 'var(--palm-pink)', borderRadius: '2px' }} />
            <span style={{ width: '16px', height: '2px', background: 'var(--palm-pink)', borderRadius: '2px' }} />
            <span style={{ width: '16px', height: '2px', background: 'var(--palm-pink)', borderRadius: '2px' }} />
          </span>
        </button>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>
          {sectionLabel}
        </div>
      </div>
      )}

      {/* Backdrop (mobile only) — also hidden on chat-wall since no sidebar */}
      {!isOnChatWall && (
      <div
        className={`admin-sidebar-backdrop${mobileNavOpen ? ' open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />
      )}

      {/* Sidebar — hidden on chat-wall. The chat-manager experience is a
          single-page workspace; no nav clutter until we add more features
          to that role. */}
      {!isOnChatWall && (
      <aside className={`admin-sidebar${mobileNavOpen ? ' open' : ''}`} style={{
        width: '180px',
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
        padding: '20px 0',
        flexShrink: 0,
        background: 'rgba(10, 10, 10, 0.95)',
      }}>
        <div style={{ padding: '0 16px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {sectionLabel}
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {NAV_ITEMS.map(item => {
            const isActive = item.href === '/admin/dashboard'
              ? (pathname === '/admin/dashboard' || pathname === '/admin')
              : item.href === '/admin/inspo'
              ? (pathname === '/admin/inspo' || pathname === '/admin/sources' || pathname === '/admin/review' || pathname === '/admin/import')
              : pathname === item.href || pathname?.startsWith(item.href + '/')
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                    background: isActive ? 'rgba(232, 160, 160, 0.08)' : 'transparent',
                    borderLeft: isActive ? '1px solid var(--palm-pink)' : '2px solid transparent',
                    textDecoration: 'none',
                    transition: '0.15s ease',
                  }}
                >
                  <span>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {/* Parent-level pulse dot — surfaces nested counts so the
                      admin notices even from a different section. */}
                  {item.href === '/admin/editor' && navCounts.oftvReview > 0 && !isActive && (
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: '#E87878', flexShrink: 0,
                      animation: 'palmNavDotPulse 1.4s ease-in-out infinite',
                    }} />
                  )}
                </Link>
                {/* Sub-items */}
                {isActive && item.children && (
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {item.children.map(child => {
                      const isChildActive = activeTab === child.key || (!activeTab && child === item.children[0])
                      // Count badges on specific sub-items. Currently only
                      // OFTV — extend by mapping more keys to navCounts.
                      const childCount = (item.href === '/admin/editor' && child.key === 'oftv') ? navCounts.oftvReview : 0
                      return (
                        <Link
                          key={child.key}
                          href={`${item.href}?tab=${child.key}`}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
                            padding: '5px 16px 5px 42px',
                            fontSize: '11px',
                            fontWeight: isChildActive ? 600 : 400,
                            color: isChildActive ? 'var(--palm-pink)' : '#999',
                            textDecoration: 'none',
                            transition: '0.15s ease',
                            background: isChildActive ? 'rgba(232, 160, 160, 0.04)' : 'transparent',
                          }}
                        >
                          <span>{child.label}</span>
                          {childCount > 0 && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              minWidth: '18px', height: '16px', padding: '0 5px',
                              borderRadius: '9999px',
                              background: '#E87878', color: '#fff',
                              fontSize: '10px', fontWeight: 700,
                              boxShadow: '0 0 0 0 rgba(232, 120, 120, 0.6)',
                              animation: 'palmNavBadgePulse 1.6s ease-in-out infinite',
                            }}>
                              {childCount}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>
      )}

      {/* Main content. On chat-wall it takes the full viewport since there's
          no sidebar; we add a max-width to keep line lengths readable. */}
      <main className="admin-main" style={{
        flex: 1,
        padding: '24px 32px',
        minWidth: 0,
        overflowX: 'hidden',
        overflowY: 'auto',
        ...(isOnChatWall ? { maxWidth: '1400px', margin: '0 auto', width: '100%' } : {}),
      }}>
        {children}
      </main>
    </div>
  )
}
