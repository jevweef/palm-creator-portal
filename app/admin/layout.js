'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'

const ADMIN_NAV = [
  { href: '/admin', label: 'Pipeline', icon: '⚡' },
  { href: '/admin/sources', label: 'Sources', icon: '📡' },
  { href: '/admin/review', label: 'Review', icon: '✅' },
  { href: '/admin/import', label: 'Import', icon: '📥' },
  { href: '/admin/editor', label: 'Editor', icon: '✂️' },
]

const EDITOR_NAV = [
  { href: '/admin/editor', label: 'Editor Queue', icon: '✂️' },
  { href: '/inspo', label: 'Inspo Board', icon: '🎬' },
]

export default function AdminLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin'
  const isEditor = role === 'editor'

  useEffect(() => {
    if (!isLoaded) return
    if (!isAdmin && !isEditor) {
      router.replace('/dashboard')
    }
    // Editors can only access /admin/editor
    if (isEditor && pathname !== '/admin/editor') {
      router.replace('/admin/editor')
    }
  }, [isLoaded, user, router, pathname, isAdmin, isEditor])

  if (!isLoaded || (!isAdmin && !isEditor)) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const NAV_ITEMS = isAdmin ? ADMIN_NAV : EDITOR_NAV

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 49px)', background: '#0a0a0a' }}>
      {/* Sidebar */}
      <aside style={{
        width: '200px',
        borderRight: '1px solid #222',
        padding: '20px 0',
        flexShrink: 0,
      }}>
        <div style={{ padding: '0 16px 16px', fontSize: '11px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {isAdmin ? 'Admin' : 'Editor'}
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href
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
                  color: isActive ? '#fff' : '#a1a1aa',
                  background: isActive ? '#1a1a2e' : 'transparent',
                  borderLeft: isActive ? '2px solid #a78bfa' : '2px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                }}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '24px 32px', maxWidth: '1200px' }}>
        {children}
      </main>
    </div>
  )
}
