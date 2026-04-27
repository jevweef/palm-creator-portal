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
  const creatorIdFromPath = isCreatorPath ? pathname?.split('/')?.[2] : null
  const hqId = searchParams?.get('hqId')
  const hqSuffix = hqId ? `?hqId=${hqId}` : ''

  if (pathname?.startsWith('/sign-') || pathname?.startsWith('/onboarding')) return null

  const linkStyle = (active) => ({
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: active ? 'var(--foreground)' : 'var(--foreground-muted)',
    textDecoration: 'none',
    transition: 'color 0.3s var(--ease-stripe)',
    position: 'relative',
    paddingBottom: '4px',
    borderBottom: active ? '1px solid var(--palm-pink)' : '1px solid transparent',
  })

  return (
    <>
    <style>{`
      @media (max-width: 768px) {
        .header-inner { flex-wrap: nowrap !important; }
        .header-left { gap: 16px !important; min-width: 0 !important; flex: 1 !important; }
        .header-nav { gap: 14px !important; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; white-space: nowrap; padding-right: 8px; }
        .header-nav::-webkit-scrollbar { display: none; }
        .header-nav a { font-size: 11px !important; white-space: nowrap; }
        .header-logo { height: 22px !important; }
      }
    `}</style>
    <header style={{
      borderBottom: '1px solid var(--card-border)',
      background: 'rgba(6, 6, 6, 0.8)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      position: 'sticky',
      top: 0,
      zIndex: 40,
    }}>
      <div className="header-inner px-4 md:px-8 py-4" style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <Link href={isEditor ? '/admin/editor' : isCreatorPath ? `/creator/${creatorIdFromPath}/dashboard${hqSuffix}` : '/dashboard'} style={{ display: 'flex', alignItems: 'center' }}>
          <span className="font-display gradient-text" style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Palm
          </span>
        </Link>
        <nav className="header-nav" style={{ display: 'flex', gap: '28px' }}>
          {(isEditor || isEditorPath) ? (
            <>
              <Link href="/editor" style={linkStyle(pathname === '/editor')}>Editor Queue</Link>
              <Link href="/editor/inspo" style={linkStyle(pathname?.startsWith('/editor/inspo'))}>Inspo Board</Link>
            </>
          ) : isCreatorPath ? (
            <>
              <Link href={`/creator/${creatorIdFromPath}/dashboard${hqSuffix}`} style={linkStyle(pathname?.endsWith('/dashboard'))}>Dashboard</Link>
              <Link href={`/creator/${creatorIdFromPath}/my-content${hqSuffix}`} style={linkStyle(pathname?.includes('/my-content'))}>My Content</Link>
              <Link href={`/creator/${creatorIdFromPath}/inspo${hqSuffix}`} style={linkStyle(pathname?.includes('/inspo'))}>Inspo Board</Link>
              <Link href={`/creator/${creatorIdFromPath}/content-request${hqSuffix}`} style={linkStyle(pathname?.includes('/content-request'))}>Content Request</Link>
            </>
          ) : (
            <>
              <Link href="/dashboard" style={linkStyle(pathname === '/dashboard')}>Dashboard</Link>
              <Link href="/my-content" style={linkStyle(pathname === '/my-content')}>My Content</Link>
              <Link href="/inspo" style={linkStyle(pathname === '/inspo')}>Inspo Board</Link>
              <Link href="/content-request" style={linkStyle(pathname === '/content-request')}>Content Request</Link>
              {isAdmin && (
                <Link href="/admin/dashboard" style={{ ...linkStyle(pathname?.startsWith('/admin')), color: pathname?.startsWith('/admin') ? 'var(--palm-pink)' : 'var(--foreground-muted)' }}>Admin</Link>
              )}
            </>
          )}
        </nav>
      </div>
      <UserButton
        afterSignOutUrl="/sign-in"
        appearance={{
          elements: {
            avatarBox: { width: '32px', height: '32px', border: '1px solid var(--card-border)' },
          },
        }}
      />
      </div>
    </header>
    </>
  )
}
