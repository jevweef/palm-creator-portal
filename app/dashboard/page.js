'use client'

import { useUser, UserButton } from '@clerk/nextjs'

export default function CreatorDashboard() {
  const { user, isLoaded } = useUser()

  if (!isLoaded) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const role = user?.publicMetadata?.role
  const name = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'there'

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '40px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Hey, {name}</h1>
            <p style={{ fontSize: '13px', color: '#71717a', marginTop: '4px' }}>Palm Management Dashboard</p>
          </div>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>

        {/* Quick Links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '40px' }}>
          <a href="/inspo" style={{
            display: 'block', padding: '20px', background: '#111', border: '1px solid #222',
            borderRadius: '12px', textDecoration: 'none', color: '#fff', transition: 'border-color 0.2s',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Inspo Board</div>
            <div style={{ fontSize: '12px', color: '#71717a' }}>Browse inspiration reels</div>
          </a>

          {role === 'admin' && (
            <a href="/inspo" style={{
              display: 'block', padding: '20px', background: '#111', border: '1px solid #222',
              borderRadius: '12px', textDecoration: 'none', color: '#fff', transition: 'border-color 0.2s',
            }}>
              <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>Review Queue</div>
              <div style={{ fontSize: '12px', color: '#71717a' }}>Rate and approve new reels</div>
            </a>
          )}
        </div>

        {/* Placeholder sections */}
        <div style={{ padding: '40px', background: '#111', border: '1px solid #222', borderRadius: '12px', textAlign: 'center' }}>
          <p style={{ color: '#52525b', fontSize: '14px', margin: 0 }}>More coming soon — saved inspo, content uploads, stats, invoices</p>
        </div>

      </div>
    </div>
  )
}
