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

  // Once we've finished checking and still couldn't route the creator to their
  // dashboard, it's because their account isn't fully linked yet (no opsId in
  // Clerk metadata). Show a real message instead of an infinite "Loading...".
  if (!checking) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{
          background: 'var(--card-bg-solid)',
          borderRadius: '20px',
          padding: '40px',
          maxWidth: '440px',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
            You&apos;re all set
          </h1>
          <p style={{ fontSize: '14px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.5', marginBottom: '20px' }}>
            Your onboarding is complete. We&apos;re finishing setting up your dashboard — this can take a little
            bit. Try refreshing in a moment, and your manager will reach out with next steps.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              background: 'var(--palm-pink)',
              color: '#060606',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading...</div>
    </div>
  )
}
