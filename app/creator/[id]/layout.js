'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter, useParams } from 'next/navigation'
import { useEffect } from 'react'

export default function CreatorLayout({ children }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const params = useParams()
  const id = params?.id

  useEffect(() => {
    if (!isLoaded) return
    const role = user?.publicMetadata?.role
    // Admins and super_admin can preview any creator
    if (role === 'admin' || role === 'super_admin') return
    // Real creator: must match their own opsId
    const opsId = user?.publicMetadata?.airtableOpsId
    if (!opsId) {
      router.replace('/sign-in')
      return
    }
    if (opsId !== id) {
      router.replace(`/creator/${opsId}/dashboard`)
    }
  }, [isLoaded, user, id, router])

  if (!isLoaded) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  return <>{children}</>
}
