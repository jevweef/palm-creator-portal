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
  ]},
  { href: '/admin/editor', label: 'Editor', icon: '✂️', children: [
    { key: 'editorview', label: 'Dashboard' },
    { key: 'review', label: 'For Review' },
    { key: 'postprep', label: 'Post Prep' },
    { key: 'library', label: 'Creator Library' },
  ]},
  { href: '/admin/creators', label: 'Creators', icon: '🎭', children: [
    { key: 'earnings', label: 'Earnings' },
    { key: 'dna', label: 'DNA Profile' },
  ]},
  { href: '/admin/onboarding', label: 'Onboarding', icon: '📋' },
  { href: '/admin/invoicing', label: 'Invoicing', icon: '💸', children: [
    { key: 'invoices', label: 'Invoices' },
    { key: 'upload', label: 'Raw Data Upload' },
  ]},
  { href: '/admin/help', label: 'Help', icon: '❓' },
  { href: '/admin/test', label: 'Test', icon: '🧪' },
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
      <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const NAV_ITEMS = isAdmin ? ADMIN_NAV : EDITOR_NAV

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 49px)', background: '#FFF5F7' }}>
      {/* Sidebar */}
      <aside style={{
        width: '180px',
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
        padding: '20px 0',
        flexShrink: 0,
        background: '#ffffff',
      }}>
        <div style={{ padding: '0 16px 16px', fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                    color: isActive ? '#E88FAC' : '#666',
                    background: isActive ? '#FFF0F3' : 'transparent',
                    borderLeft: isActive ? '2px solid #E88FAC' : '2px solid transparent',
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
                            color: isChildActive ? '#E88FAC' : '#999',
                            textDecoration: 'none',
                            transition: '0.15s ease',
                            background: isChildActive ? '#FFF8FA' : 'transparent',
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
      <main style={{ flex: 1, padding: '24px 32px', minWidth: 0, overflowX: 'hidden', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
