'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const SM_NAV = [
  { href: '/sm', label: 'Home', icon: '🏠', exact: true },
  { href: '/sm/setup-requests', label: 'Setup Requests', icon: '🆕' },
  { href: '/sm/grid-planner', label: 'Grid Planner', icon: '🗓️' },
  { href: '/sm/workspace', label: 'Workspace', icon: '📋' },
]

export default function SmLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isSmm = role === 'social_media'
  const hasAccess = isAdmin || isSmm

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useEffect(() => { setMobileNavOpen(false) }, [pathname])

  useEffect(() => {
    if (!isLoaded) return
    if (!hasAccess) router.replace('/dashboard')
  }, [isLoaded, hasAccess, router])

  if (!isLoaded || !hasAccess) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  return (
    <div className="sm-shell" style={{ display: 'flex', minHeight: 'calc(100vh - 49px)', background: 'var(--background)' }}>
      <style>{`
        @media (max-width: 768px) {
          .sm-shell { display: block !important; }
          .sm-sidebar {
            position: fixed !important;
            top: 49px; left: 0; bottom: 0;
            width: 240px !important;
            z-index: 250;
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            overflow-y: auto;
          }
          .sm-sidebar.open { transform: translateX(0); }
          .sm-sidebar-backdrop {
            display: none;
            position: fixed; inset: 49px 0 0 0;
            background: rgba(0,0,0,0.35);
            z-index: 240;
          }
          .sm-sidebar-backdrop.open { display: block; }
          .sm-mobile-bar { display: flex !important; }
          .sm-main { padding: 12px 14px !important; }
        }
        @media (min-width: 769px) {
          .sm-mobile-bar { display: none !important; }
          .sm-sidebar-backdrop { display: none !important; }
        }
      `}</style>

      <div className="sm-mobile-bar" style={{
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
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>Social Media</div>
      </div>

      <div
        className={`sm-sidebar-backdrop${mobileNavOpen ? ' open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside className={`sm-sidebar${mobileNavOpen ? ' open' : ''}`} style={{
        width: '200px',
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
        padding: '20px 0',
        flexShrink: 0,
        background: 'rgba(10, 10, 10, 0.95)',
      }}>
        <div style={{ padding: '0 16px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Social Media
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {SM_NAV.map(item => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname?.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
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
            )
          })}
        </nav>
      </aside>

      <main className="sm-main" style={{ flex: 1, padding: '24px 32px', minWidth: 0, overflowX: 'hidden', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
