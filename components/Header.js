'use client'

import { UserButton } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

export default function Header() {
  const pathname = usePathname()

  // Don't show header on sign-in/sign-up pages
  if (pathname?.startsWith('/sign-')) return null

  return (
    <header style={{
      borderBottom: '1px solid #222',
      background: '#0a0a0a',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="px-4 md:px-8 py-3">
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <Link href="/dashboard">
          <img
            src="/palm-logo.png"
            alt="Palm Management"
            style={{ height: '28px', width: 'auto' }}
          />
        </Link>
        <nav style={{ display: 'flex', gap: '20px' }}>
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
        </nav>
      </div>
      <UserButton afterSignOutUrl="/sign-in" />
      </div>
    </header>
  )
}
