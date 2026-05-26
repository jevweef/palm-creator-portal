'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, SignUpButton } from '@clerk/nextjs'

// Client-only piece of the onboarding landing page: the Clerk sign-up button
// plus the "already signed in → redirect" effect. Everything else on the
// landing page (token validation, creator name, copy) renders on the server.
export default function SignUpCta({ email }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (isLoaded && user) {
      router.push('/onboarding/form')
    }
  }, [isLoaded, user, router])

  return (
    <>
      <SignUpButton
        mode="redirect"
        afterSignUpUrl="/onboarding/form"
        initialValues={{ emailAddress: email || '' }}
      >
        <button style={{
          width: '100%',
          padding: '12px',
          background: 'var(--palm-pink)',
          color: '#060606',
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

      <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '16px' }}>
        Already have an account?{' '}
        <a href="/sign-in?redirect_url=/onboarding/form" style={{ color: 'var(--palm-pink)', textDecoration: 'none', fontWeight: 500 }}>
          Sign in
        </a>
      </p>
    </>
  )
}
