'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function EditorLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const role = user?.publicMetadata?.role

  useEffect(() => {
    if (!isLoaded) return
    if (role !== 'admin' && role !== 'editor') {
      router.replace('/dashboard')
    }
  }, [isLoaded, role, router])

  if (!isLoaded) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  return <>{children}</>
}
