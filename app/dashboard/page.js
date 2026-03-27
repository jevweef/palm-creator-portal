'use client'

import { useUser, UserButton } from '@clerk/nextjs'
import { useEffect, useState } from 'react'

function formatCurrency(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0)
}

function formatPct(val) {
  return `${Math.round((val || 0) * 100)}%`
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Card({ children, style }) {
  return (
    <div style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '20px', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: '10px', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>{children}</div>
}

function InfoRow({ label, value, href }) {
  const content = href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa', textDecoration: 'none', fontSize: '14px' }}>{value}</a>
  ) : (
    <span style={{ color: '#d4d4d8', fontSize: '14px' }}>{value || '—'}</span>
  )
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ color: '#71717a', fontSize: '13px' }}>{label}</span>
      {content}
    </div>
  )
}

export default function CreatorDashboard() {
  const { user, isLoaded } = useUser()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // For now, use Taby's test ID. Later this will come from user.publicMetadata.airtableHqId
    const hqId = user?.publicMetadata?.airtableHqId || 'rec6jLwh1nKf90S6K'
    fetch(`/api/creator-profile?hqId=${hqId}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch((err) => { console.error(err); setLoading(false) })
  }, [user])

  if (!isLoaded || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const { profile, uploads, invoices } = data || {}
  const displayName = profile?.aka || profile?.name || 'there'

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Hey, {displayName}</h1>
            <p style={{ fontSize: '13px', color: '#71717a', marginTop: '4px' }}>Your Palm Management Dashboard</p>
          </div>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>

        {/* Profile Card */}
        <Card style={{ marginBottom: '16px' }}>
          <SectionLabel>Your Profile</SectionLabel>
          <InfoRow label="Name" value={profile?.name} />
          <InfoRow label="Stage Name" value={profile?.aka} />
          <InfoRow label="Commission" value={formatPct(profile?.commission)} />
          <InfoRow label="Management Start" value={formatDate(profile?.managementStartDate)} />
          <InfoRow label="OnlyFans" value={profile?.onlyfansUrl?.replace('https://', '')} href={profile?.onlyfansUrl} />
          <InfoRow label="Instagram" value={profile?.igAccount?.replace('https://', '')?.replace('instagram.com/', '@')} href={profile?.igAccount?.startsWith('http') ? profile.igAccount : `https://${profile?.igAccount}`} />
          {profile?.contractUrl && (
            <InfoRow label="Contract" value={profile?.contractFilename || 'View Contract'} href={profile.contractUrl} />
          )}
          {profile?.telegram && (
            <InfoRow label="Telegram" value={profile.telegram} />
          )}
        </Card>

        {/* Quick Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {uploads?.socialUploadUrl && (
            <a href={uploads.socialUploadUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Card style={{ textAlign: 'center', cursor: 'pointer', borderColor: '#2a2a2a', transition: 'border-color 0.2s' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📱</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Upload Social Content</div>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>Dropbox file request</div>
              </Card>
            </a>
          )}
          {uploads?.longformUploadUrl && (
            <a href={uploads.longformUploadUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Card style={{ textAlign: 'center', cursor: 'pointer', borderColor: '#2a2a2a', transition: 'border-color 0.2s' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎬</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Upload Longform Content</div>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>Dropbox file request</div>
              </Card>
            </a>
          )}
          <a href="/inspo" style={{ textDecoration: 'none' }}>
            <Card style={{ textAlign: 'center', cursor: 'pointer', borderColor: '#2a2a2a', transition: 'border-color 0.2s' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>✨</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>Browse Inspo</div>
              <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>Find reels to recreate</div>
            </Card>
          </a>
        </div>

        {/* Earnings Snapshot */}
        {profile?.previousMonthTR > 0 && (
          <Card style={{ marginBottom: '16px' }}>
            <SectionLabel>Last Month</SectionLabel>
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#fff' }}>{formatCurrency(profile.previousMonthTR)}</div>
                <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>Total Revenue</div>
              </div>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#4ade80' }}>{formatCurrency(profile.previousMonthTR * (profile.commission || 0))}</div>
                <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>Your Commission ({formatPct(profile.commission)})</div>
              </div>
            </div>
          </Card>
        )}

        {/* Invoices */}
        {invoices && invoices.length > 0 && (
          <Card>
            <SectionLabel>Invoices</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {invoices.map((inv) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 500, color: '#d4d4d8' }}>{inv.label || `${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`}</div>
                    <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>
                      {formatCurrency(inv.earnings)} earned · {formatCurrency(inv.totalCommission)} commission
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {inv.dueDate && (
                      <span style={{ fontSize: '11px', color: '#52525b' }}>Due {formatDate(inv.dueDate)}</span>
                    )}
                    {inv.invoicePdfUrl && (
                      <a href={inv.invoicePdfUrl} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: '12px', color: '#a78bfa', textDecoration: 'none', padding: '4px 10px',
                        border: '1px solid #333', borderRadius: '6px',
                      }}>
                        PDF
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}
