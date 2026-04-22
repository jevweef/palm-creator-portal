'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useUser, SignUpButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'

export default function OnboardingLanding() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { user, isLoaded } = useUser()
  const router = useRouter()

  const [status, setStatus] = useState('loading') // loading, valid, invalid, already-signed-up
  const [creatorInfo, setCreatorInfo] = useState(null)

  useEffect(() => {
    if (!token) {
      setStatus('invalid')
      return
    }

    fetch(`/api/onboarding/validate-token?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          setCreatorInfo(data)
          setStatus('valid')
        } else {
          setStatus('invalid')
        }
      })
      .catch(() => setStatus('invalid'))
  }, [token])

  // If user is already signed in, redirect to the form
  useEffect(() => {
    if (isLoaded && user && status === 'valid') {
      router.push('/onboarding/form')
    }
  }, [isLoaded, user, status, router])

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#999', fontSize: '14px' }}>Validating your link...</div>
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          background: 'var(--card-bg-solid)',
          borderRadius: '20px',
          padding: '40px',
          maxWidth: '440px',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>🔗</div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>
            Invalid Link
          </h1>
          <p style={{ fontSize: '14px', color: '#666' }}>
            This onboarding link is invalid or has expired. Please contact your manager for a new link.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--card-bg-solid)',
        borderRadius: '20px',
        padding: '40px',
        maxWidth: '440px',
        textAlign: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
      }}>
        <img
          src="/palm-logo.png"
          alt="Palm Management"
          style={{ height: '32px', marginBottom: '24px' }}
        />
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>
          Welcome{creatorInfo?.name ? `, ${creatorInfo.name}` : ''}!
        </h1>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '28px', lineHeight: '1.5' }}>
          Let&apos;s get you set up. This onboarding takes about an hour and covers everything we need —
          your info, a quick survey, your contract, and a voice memo about your brand.
        </p>

        <SignUpButton
          mode="redirect"
          afterSignUpUrl="/onboarding/form"
          initialValues={{ emailAddress: creatorInfo?.email || '' }}
        >
          <button style={{
            width: '100%',
            padding: '12px',
            background: '#E88FAC',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}>
            Create Your Account
          </button>
        </SignUpButton>

        <p style={{ fontSize: '12px', color: '#999', marginTop: '16px' }}>
          Already have an account?{' '}
          <a href="/sign-in?redirect_url=/onboarding/form" style={{ color: '#E88FAC', textDecoration: 'none', fontWeight: 500 }}>
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}
