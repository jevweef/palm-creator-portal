'use client'

import { SignOutButton } from '@clerk/nextjs'

export default function NotAuthorizedPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(232,160,160,0.08) 0%, transparent 50%), radial-gradient(ellipse 60% 80% at 80% 50%, rgba(196,122,122,0.04) 0%, transparent 50%), #060606',
    }}>
      <div style={{
        background: 'var(--card-bg-solid)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '20px',
        padding: '48px 40px',
        maxWidth: '480px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
      }}>
        <img
          src="/palm-logo.png"
          alt="Palm Management"
          style={{ height: '36px', marginBottom: '32px', opacity: 0.95 }}
        />

        <div style={{ fontSize: '40px', marginBottom: '16px' }}>👋</div>

        <h1 style={{
          fontSize: '24px',
          fontWeight: 600,
          color: 'var(--foreground)',
          marginBottom: '14px',
          letterSpacing: '-0.01em',
        }}>
          Looks like you&apos;re early
        </h1>

        <p style={{
          fontSize: '15px',
          color: 'rgba(240, 236, 232, 0.7)',
          lineHeight: '1.6',
          marginBottom: '32px',
        }}>
          Get in touch with your manager to set you up on the website.
        </p>

        <SignOutButton redirectUrl="/sign-in">
          <button style={{
            background: 'rgba(232,160,160,0.12)',
            border: '1px solid rgba(232,160,160,0.3)',
            color: '#E8A0A0',
            padding: '11px 24px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(232,160,160,0.2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(232,160,160,0.12)' }}
          >
            Sign out
          </button>
        </SignOutButton>
      </div>
    </div>
  )
}
