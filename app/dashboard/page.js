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
      router.replace('/admin/inspo')
      return
    }
    if (opsId && opsId !== 'undefined') {
      router.replace(`/creator/${opsId}/dashboard?hqId=${hqId}`)
    }
  }, [isLoaded, user, router])

  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
    </div>
  )
}
