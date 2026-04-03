'use client'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function DashboardRedirect() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (!isLoaded) return
    const opsId = user?.publicMetadata?.airtableOpsId
    const hqId = user?.publicMetadata?.airtableHqId
    const role = user?.publicMetadata?.role
    if (role === 'admin' || role === 'super_admin') {
      router.replace('/admin')
      return
    }
    if (opsId && opsId !== 'undefined') {
      router.replace(`/creator/${opsId}/dashboard?hqId=${hqId}`)
    }
  }, [isLoaded, user, router])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
    </div>
  )
}
