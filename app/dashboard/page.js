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
      router.replace('/admin/dashboard')
      return
    }
    if (role === 'editor') {
      router.replace('/admin/editor')
      return
    }
    if (role === 'chat_manager') {
      router.replace('/photo-library')
      return
    }
    if (!hqId) {
      setChecking(false)
      return
    }

    // Check onboarding status before allowing dashboard access (skip for admins/editors)
    const userRole = user?.publicMetadata?.role
    if (userRole === 'admin' || userRole === 'super_admin' || userRole === 'editor') {
      if (opsId && opsId !== 'undefined') {
        router.replace(`/creator/${opsId}/dashboard?hqId=${hqId}`)
      }
      return
    }

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
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
    </div>
  )
}
