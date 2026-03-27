'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'

function fmt$(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0) }
function fmtPct(val) { return `${Math.round((val || 0) * 100)}%` }
function fmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' }

function Card({ children, style, className }) {
  return <div className={className} style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '20px', ...style }}>{children}</div>
}

function Label({ children }) {
  return <div style={{ fontSize: '10px', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{children}</div>
}

function Row({ label, value, href, mono }) {
  const valStyle = { color: '#d4d4d8', fontSize: '13px', ...(mono ? { fontFamily: 'monospace' } : {}) }
  const content = href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...valStyle, color: '#a78bfa', textDecoration: 'none' }}>{value}</a>
    : <span style={valStyle}>{value || '—'}</span>
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ color: '#71717a', fontSize: '12px', flexShrink: 0, marginRight: '16px' }}>{label}</span>
      {content}
    </div>
  )
}

function StatBox({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: '120px' }}>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color || '#fff' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#71717a', marginTop: '2px' }}>{label}</div>
    </div>
  )
}

function ActionCard({ href, icon, title, subtitle }) {
  return (
    <a href={href} target={href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
      <Card style={{ textAlign: 'center', cursor: 'pointer', borderColor: '#2a2a2a', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', transition: 'border-color 0.2s' }}>
        <div style={{ fontSize: '22px', marginBottom: '6px' }}>{icon}</div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{title}</div>
        <div style={{ fontSize: '10px', color: '#71717a', marginTop: '3px' }}>{subtitle}</div>
      </Card>
    </a>
  )
}

export default function CreatorDashboard() {
  const { user, isLoaded } = useUser()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savedReels, setSavedReels] = useState([])

  const creatorOpsId = user?.publicMetadata?.airtableOpsId || 'recBELsdb0C6fRBSm'

  useEffect(() => {
    const hqId = user?.publicMetadata?.airtableHqId || 'rec6jLwh1nKf90S6K'
    Promise.all([
      fetch(`/api/creator-profile?hqId=${hqId}`).then((r) => r.json()),
      fetch(`/api/saved-inspo?creatorOpsId=${creatorOpsId}`).then((r) => r.json()).catch(() => ({ records: [] })),
    ])
      .then(([profileData, savedData]) => {
        setData(profileData)
        setSavedReels(savedData.records || [])
        setLoading(false)
      })
      .catch((err) => { console.error(err); setLoading(false) })
  }, [user, creatorOpsId])

  if (!isLoaded || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const { profile, uploads, invoices } = data || {}
  const p = profile || {}
  const displayName = p.aka || p.name || 'there'
  const igHandle = p.igAccount?.replace('https://', '')?.replace('instagram.com/', '@') || ''
  const igHref = p.igAccount?.startsWith('http') ? p.igAccount : `https://${p.igAccount}`

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }} className="px-4 md:px-8 py-8">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Hey, {displayName}</h1>
            <p style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>Palm Management Dashboard</p>
          </div>
        </div>

        {/* ── Row 1: Profile + Earnings + Quick Actions ── */}
        <div style={{ display: 'grid', gap: '12px', marginBottom: '12px' }} className="grid-cols-1 md:grid-cols-12">

          {/* Profile — spans 5 cols on desktop, full on mobile */}
          <Card className="md:col-span-5">
            <Label>Profile</Label>
            <Row label="Name" value={p.name} />
            <Row label="Stage Name" value={p.aka} />
            <Row label="Commission" value={fmtPct(p.commission)} />
            <Row label="Started" value={fmtDate(p.managementStartDate)} />
            <Row label="OnlyFans" value={p.onlyfansUrl?.replace('https://', '')} href={p.onlyfansUrl} />
            {igHandle && <Row label="Instagram" value={igHandle} href={igHref} />}
            {p.ofEmail && <Row label="OF Email" value={p.ofEmail} />}
            {p.communicationEmail && p.communicationEmail !== p.ofEmail && <Row label="Email" value={p.communicationEmail} />}
            {p.telegram && <Row label="Telegram" value={p.telegram} />}
            {p.contractUrl && <Row label="Contract" value="View PDF" href={p.contractUrl} />}
          </Card>

          {/* Right column — Earnings + Actions stacked */}
          <div className="md:col-span-7" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Earnings row */}
            <Card>
              <Label>Last Month</Label>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <StatBox value={fmt$(p.previousMonthTR)} label="Total Revenue" />
                <StatBox value={fmt$(p.previousMonthTR * (p.commission || 0))} label={`Your Commission (${fmtPct(p.commission)})`} color="#4ade80" />
                <StatBox value={fmtPct(p.commission)} label="Commission Rate" color="#a78bfa" />
              </div>
            </Card>

            {/* Quick Actions grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {uploads?.socialUploadUrl && (
                <ActionCard href={uploads.socialUploadUrl} icon="📱" title="Upload Social" subtitle="Dropbox" />
              )}
              {uploads?.longformUploadUrl && (
                <ActionCard href={uploads.longformUploadUrl} icon="🎬" title="Upload Longform" subtitle="Dropbox" />
              )}
              <ActionCard href="/inspo" icon="✨" title="Browse Inspo" subtitle="Find reels" />
              <ActionCard href="#" icon="📂" title="My Files" subtitle="Coming soon" />
            </div>

            {/* Stats placeholder */}
            <Card style={{ flex: 1 }}>
              <Label>Growth & Stats</Label>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', padding: '8px 0' }}>
                <StatBox value="—" label="IG Followers" />
                <StatBox value="—" label="TikTok Followers" />
                <StatBox value="—" label="OF Subscribers" />
                <StatBox value="—" label="Week-over-Week" />
              </div>
              <div style={{ fontSize: '11px', color: '#3f3f46', marginTop: '8px', fontStyle: 'italic' }}>Stats tracking coming soon</div>
            </Card>
          </div>
        </div>

        {/* ── Row 2: Invoices + Saved Inspo ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px' }}>

          {/* Invoices */}
          <Card>
            <Label>Invoices</Label>
            {invoices && invoices.length > 0 ? (
              invoices.map((inv) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#d4d4d8' }}>{inv.label || `${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}`}</div>
                    <div style={{ fontSize: '11px', color: '#71717a', marginTop: '2px' }}>
                      {fmt$(inv.earnings)} earned · {fmt$(inv.totalCommission)} commission
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {inv.dueDate && <span style={{ fontSize: '10px', color: '#52525b' }}>Due {fmtDate(inv.dueDate)}</span>}
                    {inv.invoicePdfUrl && (
                      <a href={inv.invoicePdfUrl} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: '11px', color: '#a78bfa', textDecoration: 'none', padding: '3px 8px',
                        border: '1px solid #333', borderRadius: '6px',
                      }}>PDF</a>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: '12px', color: '#3f3f46', fontStyle: 'italic' }}>No invoices yet</div>
            )}
          </Card>

          {/* Saved Inspo — clickable card grid that links to My Content */}
          <a href="/my-content" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <Card style={{ cursor: 'pointer', transition: 'border-color 0.2s' }}
              className="hover:!border-[#444]"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: savedReels.length > 0 ? '14px' : 0 }}>
                <Label>Saved Inspo ({savedReels.length})</Label>
                <span style={{ color: '#a78bfa', fontSize: '12px', fontWeight: 500 }}>
                  My Content →
                </span>
              </div>
              {savedReels.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                  {savedReels.slice(0, 8).map((reel) => (
                    <div key={reel.id} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #222', background: '#0a0a0a' }}>
                      <div style={{ aspectRatio: '9/16', background: '#1a1a1a', overflow: 'hidden' }}>
                        {reel.thumbnail ? (
                          <img src={reel.thumbnail} alt={reel.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '24px' }}>🎬</div>
                        )}
                      </div>
                      <div style={{ padding: '6px 8px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reel.title}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#52525b', fontSize: '13px' }}>
                  Save reels from the Inspo Board to start creating content
                </div>
              )}
            </Card>
          </a>
        </div>

      </div>

      {/* Responsive overrides */}
      <style>{`
        @media (max-width: 1024px) {
          [style*="grid-template-columns: repeat(12"] { grid-template-columns: 1fr !important; }
          [style*="grid-column: span 5"] { grid-column: span 1 !important; }
          [style*="grid-column: span 7"] { grid-column: span 1 !important; }
          [style*="grid-template-columns: repeat(4"] { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 640px) {
          [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          [style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
