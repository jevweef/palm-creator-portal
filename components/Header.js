'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function Header() {
  const pathname = usePathname()
  const { user } = useUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin'
  const isEditor = role === 'editor'
  const isEditorPath = pathname?.startsWith('/editor')
  const isCreatorPath = pathname?.startsWith('/creator')
  // Extract creatorId from creator paths: /creator/[id]/...
  const creatorIdFromPath = isCreatorPath ? pathname?.split('/')?.[2] : null

  // Don't show header on sign-in/sign-up pages
  if (pathname?.startsWith('/sign-')) return null

  return (
    <header style={{
      borderBottom: '1px solid #222',
      background: '#0a0a0a',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="px-4 md:px-8 py-3">
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <Link href={isEditor ? '/admin/editor' : isCreatorPath ? `/creator/${creatorIdFromPath}/dashboard` : '/dashboard'}>
          <img
            src="/palm-logo.png"
            alt="Palm Management"
            style={{ height: '28px', width: 'auto' }}
          />
        </Link>
        <nav style={{ display: 'flex', gap: '20px' }}>
          {(isEditor || isEditorPath) ? (
            <>
              <Link
                href="/editor"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname === '/editor' ? 600 : 400,
                  color: pathname === '/editor' ? '#fff' : '#71717a',
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
                  color: pathname?.startsWith('/editor/inspo') ? '#fff' : '#71717a',
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
                href={`/creator/${creatorIdFromPath}/dashboard`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.endsWith('/dashboard') ? 600 : 400,
                  color: pathname?.endsWith('/dashboard') ? '#fff' : '#71717a',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Dashboard
              </Link>
              <Link
                href={`/creator/${creatorIdFromPath}/my-content`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.includes('/my-content') ? 600 : 400,
                  color: pathname?.includes('/my-content') ? '#fff' : '#71717a',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                My Content
              </Link>
              <Link
                href={`/creator/${creatorIdFromPath}/inspo`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.includes('/inspo') ? 600 : 400,
                  color: pathname?.includes('/inspo') ? '#fff' : '#71717a',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Inspo Board
              </Link>
              <Link
                href={`/creator/${creatorIdFromPath}/vault`}
                style={{
                  fontSize: '13px',
                  fontWeight: pathname?.includes('/vault') ? 600 : 400,
                  color: pathname?.includes('/vault') ? '#fff' : '#71717a',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                New OF Content Upload
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                style={{
                  fontSize: '13px',
                  fontWeight: pathname === '/dashboard' ? 600 : 400,
                  color: pathname === '/dashboard' ? '#fff' : '#71717a',
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
                  color: pathname === '/my-content' ? '#fff' : '#71717a',
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
                  color: pathname === '/inspo' ? '#fff' : '#71717a',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
              >
                Inspo Board
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  style={{
                    fontSize: '13px',
                    fontWeight: pathname?.startsWith('/admin') ? 600 : 400,
                    color: pathname?.startsWith('/admin') ? '#a78bfa' : '#71717a',
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
  )
}
