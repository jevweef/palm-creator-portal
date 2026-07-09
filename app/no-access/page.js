'use client'

// Landing page for signed-in accounts with NO role and NO creator link —
// usually someone who signed up with the wrong email (invites are tied to
// one exact address) or without an invite at all. Friendly dead end: shows
// which email they're on, tells them what to do, offers sign-out.

import { useUser, useClerk } from '@clerk/nextjs'

export default function NoAccessPage() {
  const { user, isLoaded } = useUser()
  const { signOut } = useClerk()
  const email = user?.primaryEmailAddress?.emailAddress || ''

  if (!isLoaded) return null
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '440px', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '10px' }}>This account doesn&apos;t have access</div>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', lineHeight: 1.7, marginBottom: '6px' }}>
          You&apos;re signed in as <b style={{ color: 'var(--foreground)' }}>{email || 'an unrecognized account'}</b>, and that email isn&apos;t set up on the Palm portal.
        </p>
        <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', lineHeight: 1.7, marginBottom: '22px' }}>
          If you received an invitation, it only works for the exact email it was sent to — sign out below, then open your invite link again and use that address. If you think this is a mistake, contact your Palm manager.
        </p>
        <button
          onClick={() => signOut({ redirectUrl: '/sign-in' })}
          style={{ background: 'var(--palm-pink)', border: 'none', borderRadius: '8px', padding: '10px 22px', fontSize: '13px', fontWeight: 700, color: '#060606', cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
