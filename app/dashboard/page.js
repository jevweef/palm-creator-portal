'use client'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function DashboardRedirect() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!isLoaded) return
    const opsId = user?.publicMetadata?.airtableOpsId
    const hqId = user?.publicMetadata?.airtableHqId
    const role = user?.publicMetadata?.role
    if (role === 'admin' || role === 'super_admin') {
      router.replace('/admin/inspo')
      return
    }
    if (role === 'editor') {
      router.replace('/admin/editor')
      return
    }
    if (!hqId) {
      setChecking(false)
      return
    }

    // Check onboarding status before allowing dashboard access
    fetch(`/api/creator-profile?hqId=${hqId}`)
      .then(r => r.json())
      .then(data => {
        const onboardingStatus = data.profile?.onboardingStatus
        if (onboardingStatus && onboardingStatus !== 'Completed') {
          router.replace('/onboarding/form')
        } else if (opsId && opsId !== 'undefined') {
          router.replace(`/creator/${opsId}/dashboard?hqId=${hqId}`)
        } else {
          setChecking(false)
        }
      })
      .catch(() => {
        if (opsId && opsId !== 'undefined') {
          router.replace(`/creator/${opsId}/dashboard?hqId=${hqId}`)
        }
        setChecking(false)
      })
  }, [isLoaded, user, router])

  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
    </div>
  )
}
