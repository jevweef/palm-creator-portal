'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function Header() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { user } = useUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isEditor = role === 'editor'
  const isEditorPath = pathname?.startsWith('/editor')
  const isCreatorPath = pathname?.startsWith('/creator')
  // Extract creatorId from creator paths: /creator/[id]/...
  const creatorIdFromPath = isCreatorPath ? pathname?.split('/')?.[2] : null
  // Preserve hqId across creator nav so dashboard always knows which creator
  const hqId = searchParams?.get('hqId')
  const hqSuffix = hqId ? `?hqId=${hqId}` : ''

  // Don't show header on sign-in/sign-up or onboarding pages
  if (pathname?.startsWith('/sign-') || pathname?.startsWith('/onboarding')) return null

  return (
    <>
    <style>{`
      @media (max-width: 768px) {
        .header-inner { flex-wrap: nowrap !important; }
        .header-left { gap: 16px !important; min-width: 0 !important; flex: 1 !important; }
        .header-nav { gap: 14px !important; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; white-space: nowrap; padding-right: 8px; }
        .header-nav::-webkit-scrollbar { display: none; }
        .header-nav a { font-size: 12px !important; white-space: nowrap; }
        .header-logo { height: 24px !important; }
      }
    `}</style>
    <header style={{
      border: 'none',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      background: '#ffffff',
    }}>
      <div className="header-inner px-4 md:px-8 py-3" style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <Link href={isEditor ? '/admin/editor' : isCreatorPath ? `/creator/${creatorIdFromPath}/dashboard${hqSuffix}` : '/dashboard'}>
          <img
            src="/palm-logo.png"
            alt="Palm Management"
            className="header-logo"
            style={{ height: '28px', width: 'auto' }}
          />
        </Link>
        <nav className="header-nav" style={{ display: 'flex', gap: '20px' }}>
          {(isEditor || isEditorPath) ? (
            <>
              <Link
                href="/editor"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname === '/editor' ? 600 : 400,
                  color: pathname === '/editor' ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Editor Queue
              </Link>
              <Link
                href="/editor/inspo"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.startsWith('/editor/inspo') ? 600 : 400,
                  color: pathname?.startsWith('/editor/inspo') ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Inspo Board
              </Link>
            </>
          ) : isCreatorPath ? (
            <>
              <Link
                href={`/creator/${creatorIdFromPath}/dashboard${hqSuffix}`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.endsWith('/dashboard') ? 600 : 400,
                  color: pathname?.endsWith('/dashboard') ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Dashboard
              </Link>
              <Link
                href={`/creator/${creatorIdFromPath}/my-content${hqSuffix}`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.includes('/my-content') ? 600 : 400,
                  color: pathname?.includes('/my-content') ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                My Content
              </Link>
              <Link
                href={`/creator/${creatorIdFromPath}/inspo${hqSuffix}`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.includes('/inspo') ? 600 : 400,
                  color: pathname?.includes('/inspo') ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Inspo Board
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname === '/dashboard' ? 600 : 400,
                  color: pathname === '/dashboard' ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Dashboard
              </Link>
              <Link
                href="/my-content"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname === '/my-content' ? 600 : 400,
                  color: pathname === '/my-content' ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                My Content
              </Link>
              <Link
                href="/inspo"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname === '/inspo' ? 600 : 400,
                  color: pathname === '/inspo' ? '#1a1a1a' : '#999',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Inspo Board
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/inspo"
                  style={{
                    fontSize: '13px',
                    fontWeight: pathname?.startsWith('/admin') ? 600 : 400,
                    color: pathname?.startsWith('/admin') ? '#E88FAC' : '#999',
                    textDecoration: 'none',
                    transition: 'color 0.15s',
                  }}
                >
                  Admin
                </Link>
              )}
            </>
          )}
        </nav>
      </div>
      <UserButton afterSignOutUrl="/sign-in" />
      </div>
    </header>
    </>
  )
}
