'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Photo Library is a single-page workspace shared by:
//   - chat managers (their only allowed view)
//   - admins / super admins (so they can preview the page directly OR
//     impersonate a specific chat manager via the View As bar)
//
// Editors and creators are bounced. Unauthenticated users are caught by
// middleware and bounced to /sign-in.
//
// This layout intentionally renders no chrome of its own — the page
// supplies its own header/banner and the global Header component already
// strips its tabs on this route. We just keep it centered with a
// sensible max-width.
export default function PhotoLibraryLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const role = user?.publicMetadata?.role
  const allowed = role === 'admin' || role === 'super_admin' || role === 'chat_manager'

  useEffect(() => {
    if (!isLoaded) return
    if (!allowed) {
      // Editors → editor; everyone else → /dashboard which routes them
      // appropriately based on their own role.
      router.replace(role === 'editor' ? '/admin/editor' : '/dashboard')
    }
  }, [isLoaded, allowed, role, router])

  if (!isLoaded || !allowed) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  return (
    <main style={{
      padding: '24px 32px',
      minHeight: 'calc(100vh - 49px)',
      maxWidth: '1400px',
      margin: '0 auto',
      width: '100%',
      overflowX: 'hidden',
    }}>
      {children}
    </main>
  )
}
