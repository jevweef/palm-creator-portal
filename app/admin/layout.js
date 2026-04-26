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
  { href: '/admin/onboarding', label: 'Onboarding', icon: '📋' },
  { href: '/admin/invoicing', label: 'Invoicing', icon: '💸', children: [
    { key: 'invoices', label: 'Invoices' },
    { key: 'upload', label: 'Raw Data Upload' },
  ]},
  { href: '/admin/help', label: 'Help', icon: '❓' },
]

const EDITOR_NAV = [
  { href: '/editor', label: 'My Dashboard', icon: '✂️' },
  { href: '/inspo', label: 'Inspo Board', icon: '🎬' },
]

export default function AdminLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin'
  const isEditor = role === 'editor'

  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab')

  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close mobile nav on route change
  useEffect(() => { setMobileNavOpen(false) }, [pathname, activeTab])

  useEffect(() => {
    if (!isLoaded) return
    if (!isAdmin && !isEditor) {
      router.replace('/dashboard')
    }
    if (isEditor) {
      router.replace('/editor')
    }
  }, [isLoaded, user, router, pathname, isAdmin, isEditor])

  // Early returns AFTER all hooks
  if (!isLoaded || (!isAdmin && !isEditor)) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const NAV_ITEMS = isAdmin ? ADMIN_NAV : EDITOR_NAV

  return (
    <div className="admin-shell" style={{ display: 'flex', minHeight: 'calc(100vh - 49px)', background: 'var(--background)' }}>
      {/* Mobile-only styles — desktop untouched */}
      <style>{`
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

      {/* Mobile top bar — only visible on mobile */}
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
          {isAdmin ? 'Admin' : 'Editor'}
        </div>
      </div>

      {/* Backdrop (mobile only) */}
      <div
        className={`admin-sidebar-backdrop${mobileNavOpen ? ' open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`admin-sidebar${mobileNavOpen ? ' open' : ''}`} style={{
        width: '180px',
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
        padding: '20px 0',
        flexShrink: 0,
        background: 'rgba(10, 10, 10, 0.95)',
      }}>
        <div style={{ padding: '0 16px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {isAdmin ? 'Admin' : 'Editor'}
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
                  {item.label}
                </Link>
                {/* Sub-items */}
                {isActive && item.children && (
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {item.children.map(child => {
                      const isChildActive = activeTab === child.key || (!activeTab && child === item.children[0])
                      return (
                        <Link
                          key={child.key}
                          href={`${item.href}?tab=${child.key}`}
                          style={{
                            padding: '5px 16px 5px 42px',
                            fontSize: '11px',
                            fontWeight: isChildActive ? 600 : 400,
                            color: isChildActive ? 'var(--palm-pink)' : '#999',
                            textDecoration: 'none',
                            transition: '0.15s ease',
                            background: isChildActive ? 'rgba(232, 160, 160, 0.04)' : 'transparent',
                          }}
                        >
                          {child.label}
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

      {/* Main content */}
      <main className="admin-main" style={{ flex: 1, padding: '24px 32px', minWidth: 0, overflowX: 'hidden', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
