import { validateOnboardingToken } from '@/lib/onboardingToken'
import SignUpCta from './_components/SignUpCta'

// Server component — token validation happens during render, so the user
// sees the welcome screen (or the invalid-link screen) immediately instead
// of a "Validating..." flash. Auth-aware redirect is delegated to a small
// client island, SignUpCta.
export default async function OnboardingLanding({ searchParams }) {
  const token = searchParams?.token
  const creatorInfo = await validateOnboardingToken(token)

  if (!creatorInfo.valid) {
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
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
            Invalid Link
          </h1>
          <p style={{ fontSize: '14px', color: 'rgba(240, 236, 232, 0.75)' }}>
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
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
          Welcome{creatorInfo.name ? `, ${creatorInfo.name}` : ''}!
        </h1>
        <p style={{ fontSize: '14px', color: 'rgba(240, 236, 232, 0.75)', marginBottom: '28px', lineHeight: '1.5' }}>
          Let&apos;s get you set up. This onboarding takes about an hour and covers everything we need —
          your info, a quick survey, your contract, and a voice memo about your brand.
        </p>

        <SignUpCta email={creatorInfo.email} />
      </div>
    </div>
  )
}
