'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useParams, useRouter } from 'next/navigation'

function fmt$(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0) }
function fmtPct(val) { return `${Math.round((val || 0) * 100)}%` }
function fmtDate(d) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T00:00:00')
  return isNaN(date) ? '—' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Card({ children, style, className, hoverable }) {
  return (
    <div
      className={`${className || ''} ${hoverable ? 'card-hover' : ''}`}
      style={{
        background: 'var(--card-bg-solid)',
        borderRadius: '18px',
        padding: '20px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        transition: '0.3s cubic-bezier(0, 0, 0.5, 1)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function Label({ children }) {
  return <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{children}</div>
}

function Row({ label, value, href, mono }) {
  const valStyle = { color: 'rgba(240, 236, 232, 0.85)', fontSize: '13px', ...(mono ? { fontFamily: 'monospace' } : {}) }
  const content = href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...valStyle, color: 'var(--palm-pink)', textDecoration: 'none' }}>{value}</a>
    : <span style={valStyle}>{value || '—'}</span>
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid transparent' }}>
      <span style={{ color: 'var(--foreground-muted)', fontSize: '12px', flexShrink: 0, marginRight: '16px' }}>{label}</span>
      {content}
    </div>
  )
}

function StatBox({ value, label, color, gradient }) {
  const textStyle = gradient
    ? { fontSize: '22px', fontWeight: 700, background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
    : { fontSize: '22px', fontWeight: 700, color: color || 'var(--foreground)' }
  return (
    <div style={{ flex: 1, minWidth: '120px' }}>
      <div style={textStyle}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '2px' }}>{label}</div>
    </div>
  )
}

function formatPeriod(start, end) {
  if (!start || !end) return '—'
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const sMonth = s.toLocaleDateString('en-US', { month: 'long' })
  const eMonth = e.toLocaleDateString('en-US', { month: 'long' })
  const sDay = s.getDate()
  const eDay = e.getDate()
  const eYear = e.getFullYear()
  if (sMonth === eMonth) {
    return `${sMonth} ${sDay} – ${eDay}, ${eYear}`
  }
  return `${sMonth} ${sDay} – ${eMonth} ${eDay}, ${eYear}`
}

function groupInvoicesByPeriod(invoices) {
  const groups = {}
  for (const inv of invoices) {
    const key = `${inv.periodStart}|${inv.periodEnd}`
    if (!groups[key]) {
      groups[key] = {
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        dueDate: inv.dueDate,
        totalEarnings: 0,
        totalCommission: 0,
        totalPaid: 0,
        invoices: [],
      }
    }
    groups[key].totalEarnings += inv.earnings || 0
    groups[key].totalCommission += inv.totalCommission || 0
    groups[key].totalPaid += inv.amountPaid || 0
    groups[key].invoices.push(inv)
    if (inv.dueDate && !groups[key].dueDate) groups[key].dueDate = inv.dueDate
  }
  return Object.values(groups)
}

function InvoiceModal({ group, onClose }) {
  const [pdfUrl, setPdfUrl] = useState(null)

  if (!group) return null

  const hasPdfs = group.invoices.some(inv => inv.invoicePdfUrl || inv.invoiceDropboxUrl)
  const allPaid = group.invoices.every(inv => inv.invoiceStatus === 'Paid')

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: pdfUrl ? '1000px' : '640px',
        maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', transition: 'max-width 0.3s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid transparent' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)' }}>
                {formatPeriod(group.periodStart, group.periodEnd)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginTop: '4px' }}>
                {group.invoices.length} account{group.invoices.length !== 1 ? 's' : ''} · Due {fmtDate(group.dueDate)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
              cursor: 'pointer', fontSize: '14px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
          {/* Combined totals */}
          <div style={{ display: 'flex', marginTop: '16px', padding: '18px 24px', background: 'rgba(232, 160, 160, 0.03)', borderRadius: '14px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--foreground)' }}>{fmt$(group.totalEarnings)}</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '3px' }}>Total Revenue</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '28px', fontWeight: 700, background: 'linear-gradient(135deg, #86efac 0%, #22c55e 35%, #15803d 70%, #0f5132 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{fmt$(group.totalEarnings - group.totalCommission)}</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '3px' }}>Your Take Home</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--palm-pink)' }}>{fmt$(group.totalCommission)}</div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '3px' }}>Management Fee</div>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {pdfUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '75vh' }}>
              <div style={{ padding: '12px 28px', borderBottom: '1px solid transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => setPdfUrl(null)} style={{
                  background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '8px', padding: '5px 12px',
                  cursor: 'pointer', fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', fontWeight: 500,
                }}>← Back</button>
                <span style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>Invoice PDF</span>
              </div>
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="Invoice PDF" />
            </div>
          ) : (
            <div style={{ padding: '20px 28px 28px' }}>
              {/* Account line items */}
              {group.invoices.map((inv) => {
                const acctLabel = Array.isArray(inv.accountName) ? inv.accountName.join(', ') : (inv.accountName || 'Account')
                const pdfLink = inv.invoicePdfUrl || null
                return (
                  <div key={inv.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', marginBottom: '6px',
                    background: 'var(--card-bg-solid)', borderRadius: '12px',
                    border: '1px solid transparent',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)', minWidth: '70px' }}>{acctLabel}</div>
                      {(() => {
                        const paid = inv.amountPaid || 0
                        const owed = inv.totalCommission || 0
                        let status = inv.invoiceStatus
                        if (status === 'Sent' && paid > 0 && paid < owed) status = 'Partial'
                        if (!status) return null
                        const palette = {
                          Paid:    { bg: 'rgba(125, 211, 164, 0.08)', fg: '#7DD3A4' },
                          Sent:    { bg: 'rgba(120, 180, 232, 0.08)', fg: '#78B4E8' },
                          Partial: { bg: 'rgba(232, 200, 120, 0.08)', fg: '#E8C878' },
                          Draft:   { bg: 'rgba(255,255,255,0.04)',    fg: '#6b7280' },
                        }
                        const p = palette[status] || palette.Draft
                        return (
                          <span style={{
                            fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '5px',
                            background: p.bg, color: p.fg,
                          }}>{status}</span>
                        )
                      })()}
                      <span style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)' }}>{fmt$(inv.earnings)}</span>
                      <span style={{ fontSize: '12px', color: 'var(--foreground-subtle)' }}>·</span>
                      <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>{fmtPct(inv.commissionPct)} fee</span>
                    </div>
                    {pdfLink && (
                      <button onClick={() => setPdfUrl(pdfLink)} style={{
                        fontSize: '11px', color: 'var(--palm-pink)', background: 'rgba(232, 160, 160, 0.04)', border: 'none',
                        padding: '5px 12px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer',
                        flexShrink: 0,
                      }}>View PDF</button>
                    )}
                  </div>
                )
              })}

              {/* Zelle payment section */}
              {!allPaid && (() => {
                const remaining = Math.max(0, (group.totalCommission || 0) - (group.totalPaid || 0))
                const hasPartial = (group.totalPaid || 0) > 0 && remaining > 0
                return (
                <div style={{
                  marginTop: '20px', padding: '20px', background: 'var(--card-bg-solid)', borderRadius: '14px',
                  border: '1px solid transparent', textAlign: 'center',
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>Pay via Zelle</div>
                  <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginBottom: hasPartial ? '10px' : '14px' }}>Scan the QR code or send to the info below</div>
                  {hasPartial && (
                    <div style={{
                      fontSize: '11px', color: '#E8C878', marginBottom: '14px',
                      background: 'rgba(232, 200, 120, 0.06)', padding: '6px 12px',
                      borderRadius: '8px', display: 'inline-block',
                    }}>
                      {fmt$(group.totalPaid)} of {fmt$(group.totalCommission)} paid · thank you
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '28px' }}>
                    <img src="/zelle-qr.png" alt="Zelle QR Code" style={{ width: '120px', height: '120px', borderRadius: '10px', objectFit: 'contain' }} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginBottom: '6px' }}>
                        <span style={{ display: 'inline-block', width: '50px' }}>To</span>
                        <span style={{ color: 'rgba(240, 236, 232, 0.85)', fontWeight: 500 }}>Palm Digital Management LLC</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginBottom: '6px' }}>
                        <span style={{ display: 'inline-block', width: '50px' }}>Bank</span>
                        <span style={{ color: 'rgba(240, 236, 232, 0.85)', fontWeight: 500 }}>Chase</span>
                      </div>
                      <div style={{
                        marginTop: '12px', padding: '10px 20px', background: 'var(--palm-pink)', color: '#060606',
                        borderRadius: '10px', fontSize: '13px', fontWeight: 600, display: 'inline-block',
                      }}>
                        {fmt$(remaining)} due
                      </div>
                    </div>
                  </div>
                </div>
              )})()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionCard({ href, icon, title, subtitle }) {
  return (
    <a href={href} target={href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
      <Card hoverable style={{ textAlign: 'center', cursor: 'pointer', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ fontSize: '22px', marginBottom: '6px' }}>{icon}</div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>{title}</div>
        <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginTop: '3px' }}>{subtitle}</div>
      </Card>
    </a>
  )
}

export default function CreatorDashboard() {
  const { user, isLoaded } = useUser()
  const searchParams = useSearchParams()
  const params = useParams()
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savedReels, setSavedReels] = useState([])
  const [pipeline, setPipeline] = useState(null)

  // id from URL param is the opsId
  const creatorOpsId = params?.id

  // hqId: prefer searchParam (admin preview), then Clerk metadata — no hardcoded fallback
  const hqIdFromParam = searchParams.get('hqId')
  const hqIdFromClerk = user?.publicMetadata?.airtableHqId
  const hqId = hqIdFromParam || hqIdFromClerk || null

  // inspo board path for this creator
  const inspoPath = `/creator/${creatorOpsId}/inspo`
  const vaultPath = `/creator/${creatorOpsId}/vault`

  const [creatorProfile, setCreatorProfile] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const profileRef = useRef(null)
  const [invoiceModal, setInvoiceModal] = useState(null)
  const [showAllInvoices, setShowAllInvoices] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const [topReels, setTopReels] = useState([])

  useEffect(() => {
    if (!isLoaded) return
    Promise.all([
      fetch(`/api/creator-profile?hqId=${hqId}`).then((r) => r.json()),
      fetch(`/api/saved-inspo?creatorOpsId=${creatorOpsId}`).then((r) => r.json()).catch(() => ({ records: [] })),
      fetch(`/api/content-pipeline?creatorOpsId=${creatorOpsId}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/creator/profile?creatorOpsId=${creatorOpsId}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/creator/tag-weights?creatorOpsId=${creatorOpsId}`).then((r) => r.json()).catch(() => ({ tagWeights: {} })),
    ])
      .then(([profileData, savedData, pipelineData, cpData, tagData]) => {
        // Redirect to onboarding if not completed (skip for admins)
        const role = user?.publicMetadata?.role
        const isAdmin = role === 'admin' || role === 'super_admin'
        const obStatus = profileData?.profile?.onboardingStatus
        if (!isAdmin && obStatus && obStatus !== 'Completed') {
          router.replace('/onboarding/form')
          return
        }
        setData(profileData)
        setSavedReels(savedData.records || [])
        setPipeline(pipelineData)
        if (cpData && cpData.profileAnalysisStatus === 'Complete') {
          setCreatorProfile({ ...cpData, tagWeights: tagData.tagWeights || {}, allTags: tagData.allTags || [] })
        }
        setLoading(false)
      })
      .catch((err) => { console.error(err); setLoading(false) })

    // Fetch reels for preview strip (non-blocking, cached 5min on server)
    Promise.all([
      fetch('/api/inspiration').then(r => r.json()).catch(() => ({ records: [] })),
      fetch(`/api/creator/tag-weights?creatorOpsId=${creatorOpsId}`).then(r => r.json()).catch(() => ({ tagWeights: {} })),
    ]).then(([inspoData, twData]) => {
      const recs = (inspoData.records || []).filter(r => r.thumbnail)
      const tw = twData.tagWeights || {}
      const hasForYou = Object.keys(tw).length > 0
      if (hasForYou) {
        // Score by tag overlap, then sort
        const scored = recs.map(r => {
          const tags = [...(r.tags || []), ...(r.suggestedTags || [])]
          const score = tags.reduce((sum, t) => sum + (tw[t] || 0), 0)
          return { ...r, forYouScore: score }
        })
        scored.sort((a, b) => b.forYouScore - a.forYouScore)
        setTopReels(scored.slice(0, 6))
      } else {
        recs.sort((a, b) => (b.views || 0) - (a.views || 0))
        setTopReels(recs.slice(0, 6))
      }
    }).catch(() => {})
  }, [isLoaded, creatorOpsId, hqId])

  if (!isLoaded || loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-subtle)', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const { profile, uploads, invoices } = data || {}
  const p = profile || {}
  const displayName = p.aka || p.name || 'there'
  const igHandle = p.igAccount?.replace('https://', '')?.replace('instagram.com/', '@') || ''
  const igHref = p.igAccount?.startsWith('http') ? p.igAccount : `https://${p.igAccount}`

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }} className="px-4 md:px-8 py-4 md:py-8">

        {/* ── Header + Earnings ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px', marginBottom: '12px' }}>
          <div className="md:pl-5" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h1 className="text-[22px] md:text-[28px]" style={{ fontWeight: 700, margin: 0 }}>Hey, {displayName}</h1>
            <p style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginTop: '2px' }}>Palm Management Dashboard</p>
          </div>
          <Card>
            {(() => {
              const groups = invoices?.length > 0 ? groupInvoicesByPeriod(invoices).sort((a, b) => (b.periodEnd || '').localeCompare(a.periodEnd || '')) : []
              const latestPeriod = groups[0]
              const revenue = latestPeriod?.totalEarnings ?? p.previousMonthTR ?? 0
              const commission = latestPeriod?.totalCommission ?? (p.previousMonthTR || 0) * (p.commission || 0)
              const takeHome = revenue - commission
              return (
                <>
                  <Label>{latestPeriod ? formatPeriod(latestPeriod.periodStart, latestPeriod.periodEnd) : 'Earnings'}</Label>
                  <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', padding: '4px 0', justifyContent: 'center', textAlign: 'center' }}>
                    <div style={{ flex: 1, minWidth: '120px' }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, background: 'linear-gradient(135deg, #86efac 0%, #22c55e 35%, #15803d 70%, #0f5132 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{fmt$(revenue)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginTop: '2px' }}>Total Revenue</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '120px' }}>
                      <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--foreground)' }}>{fmt$(takeHome)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginTop: '2px' }}>Your Take Home</div>
                    </div>
                  </div>
                </>
              )
            })()}
          </Card>
        </div>

        {/* ── Browse Inspo + Quick Actions ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px', marginBottom: '12px' }}>
          {/* Browse Inspo — visual card with sort shortcuts */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 16px' }}>
              <Label>Browse Inspo</Label>
              <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', margin: '4px 0 14px' }}>Find reels to recreate for your audience</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  ...(creatorProfile ? [{ key: 'foryou', label: 'For You', icon: '✨' }] : []),
                  { key: 'top', label: 'Top', icon: '🔥' },
                  { key: 'viral', label: 'Viral', icon: '🚀' },
                  { key: 'recent', label: 'Recent', icon: '🕐' },
                ].map(s => (
                  <a
                    key={s.key}
                    href={`${inspoPath}?sort=${s.key}`}
                    className="card-hover"
                    style={{
                      flex: 1, minWidth: '70px', textDecoration: 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                      padding: '12px 8px', borderRadius: '14px',
                      background: s.key === 'foryou' ? 'rgba(232, 160, 160, 0.06)' : 'var(--card-bg-solid)',
                      border: s.key === 'foryou' ? '1px solid #E88FAC' : '1px solid transparent',
                      transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{s.icon}</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: s.key === 'foryou' ? 'var(--palm-pink)' : 'rgba(240, 236, 232, 0.75)' }}>{s.label}</span>
                  </a>
                ))}
              </div>
            </div>
            {/* Reel preview strip — For You if available, otherwise Viral */}
            {topReels.length > 0 && (() => {
              const isForYou = creatorProfile && topReels[0]?.forYouScore !== undefined
              const stripLabel = isForYou ? 'Picked For You' : 'Viral Right Now'
              const stripSort = isForYou ? 'foryou' : 'viral'
              return (
                <div style={{ borderTop: '1px solid transparent', padding: '12px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stripLabel}</span>
                    <a href={`${inspoPath}?sort=${stripSort}`} style={{ fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none', fontWeight: 500 }}>See All →</a>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${topReels.length}, 1fr)`, gap: '6px' }}>
                    {topReels.map(r => (
                      <a key={r.id} href={`${inspoPath}?sort=${stripSort}`} style={{ aspectRatio: '9/14', borderRadius: '8px', overflow: 'hidden', background: 'rgba(232, 160, 160, 0.04)', display: 'block' }}>
                        {r.thumbnail && <img src={r.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </a>
                    ))}
                  </div>
                </div>
              )
            })()}
          </Card>

          {/* Quick Actions + Invoices */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="quick-actions-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {uploads?.socialUploadUrl && (
                <ActionCard href={uploads.socialUploadUrl} icon="📱" title="Upload Social" subtitle="Dropbox" />
              )}
              <ActionCard href={`/creator/${creatorOpsId}/long-form`} icon="🎬" title="Long-Form Projects" subtitle="OFTV / YouTube" />
              <ActionCard href={vaultPath} icon="🔐" title="OF Vault Upload" subtitle="OnlyFans" />
            </div>

            {/* Invoices fills remaining space */}
            <Card style={{ flex: 1 }}>
              <Label>Invoices</Label>
            {invoices && invoices.length > 0 ? (() => {
              const allGroups = groupInvoicesByPeriod(invoices).sort((a, b) => (b.periodEnd || '').localeCompare(a.periodEnd || ''))
              const hasMore = allGroups.length > 3
              const visible = hasMore ? allGroups.slice(0, 2) : allGroups

              return (<>
                {visible.map((group) => {
                  const statuses = group.invoices.map(inv => inv.invoiceStatus || 'Draft')
                  const allPaid = statuses.every(s => s === 'Paid')
                  const allSent = statuses.every(s => s === 'Sent')
                  const somePaid = statuses.some(s => s === 'Paid')
                  const someSent = statuses.some(s => s === 'Sent')
                  const now = new Date()
                  const periodEnd = group.periodEnd ? new Date(group.periodEnd + 'T23:59:59') : null
                  const isActive = periodEnd && now <= periodEnd

                  let statusLabel, statusColor, statusBg
                  const hasPartialPayment = (group.totalPaid || 0) > 0 && (group.totalPaid || 0) < (group.totalCommission || 0)
                  if (allPaid) { statusLabel = 'Paid'; statusColor = '#7DD3A4'; statusBg = 'rgba(125, 211, 164, 0.08)' }
                  else if (allSent && hasPartialPayment) { statusLabel = 'Partial'; statusColor = '#E8C878'; statusBg = 'rgba(232, 200, 120, 0.08)' }
                  else if (allSent) { statusLabel = 'Sent'; statusColor = '#E8A878'; statusBg = 'rgba(232, 200, 120, 0.08)' }
                  else if (somePaid || someSent) { statusLabel = 'Partial'; statusColor = '#E8C878'; statusBg = 'rgba(232, 200, 120, 0.08)' }
                  else if (isActive) { statusLabel = 'Active'; statusColor = '#78B4E8'; statusBg = 'rgba(120, 180, 232, 0.08)' }
                  else { statusLabel = 'Not Sent'; statusColor = '#9ca3af'; statusBg = 'rgba(255,255,255,0.04)' }

                  return (
                    <div
                      key={`${group.periodStart}|${group.periodEnd}`}
                      onClick={() => setInvoiceModal(group)}
                      className="card-hover"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 14px', marginBottom: '6px', cursor: 'pointer',
                        borderRadius: '12px', background: 'var(--card-bg-solid)',
                        border: '1px solid transparent',
                        transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>
                          {formatPeriod(group.periodStart, group.periodEnd)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '3px' }}>
                          {fmt$(group.totalEarnings)} earned · {fmt$(group.totalCommission)} management fee
                          {group.invoices.length > 1 && <span style={{ color: 'var(--foreground-subtle)' }}> · {group.invoices.length} accounts</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', fontWeight: 500, color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: '6px' }}>{statusLabel}</span>
                        {group.dueDate && !allPaid && (
                          <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)' }}>Due {fmtDate(group.dueDate)}</span>
                        )}
                        <span style={{ color: 'var(--foreground-subtle)', fontSize: '14px' }}>›</span>
                      </div>
                    </div>
                  )
                })}
                {hasMore && (
                  <div
                    onClick={() => setShowAllInvoices(true)}
                    className="card-hover"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '12px 14px', cursor: 'pointer',
                      borderRadius: '12px', background: 'rgba(232, 160, 160, 0.04)',
                      border: '1px solid rgba(232,143,172,0.15)',
                      transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                      gap: '6px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--palm-pink)' }}>
                      View All {allGroups.length} Periods
                    </span>
                    <span style={{ color: 'var(--palm-pink)', fontSize: '14px' }}>›</span>
                  </div>
                )}
              </>)
            })() : (
              <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', fontStyle: 'italic' }}>No invoices yet</div>
            )}
            </Card>
          </div>
        </div>

        {/* Invoice detail modal */}
        {invoiceModal && <InvoiceModal group={invoiceModal} onClose={() => setInvoiceModal(null)} />}

        {/* All Invoices modal */}
        {showAllInvoices && invoices?.length > 0 && (
          <div onClick={() => setShowAllInvoices(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '640px',
              maxHeight: '85vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--foreground)' }}>All Invoices</div>
                  <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', marginTop: '2px' }}>{groupInvoicesByPeriod(invoices).length} billing periods</div>
                </div>
                <button onClick={() => setShowAllInvoices(false)} style={{
                  background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
                  cursor: 'pointer', fontSize: '14px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 28px 28px' }}>
                {groupInvoicesByPeriod(invoices).sort((a, b) => (b.periodEnd || '').localeCompare(a.periodEnd || '')).map((group) => {
                  const statuses = group.invoices.map(inv => inv.invoiceStatus || 'Draft')
                  const allPaid = statuses.every(s => s === 'Paid')
                  const allSent = statuses.every(s => s === 'Sent')
                  const somePaid = statuses.some(s => s === 'Paid')
                  const someSent = statuses.some(s => s === 'Sent')
                  const now = new Date()
                  const periodEnd = group.periodEnd ? new Date(group.periodEnd + 'T23:59:59') : null
                  const isActive = periodEnd && now <= periodEnd

                  let statusLabel, statusColor, statusBg
                  const hasPartialPayment = (group.totalPaid || 0) > 0 && (group.totalPaid || 0) < (group.totalCommission || 0)
                  if (allPaid) { statusLabel = 'Paid'; statusColor = '#7DD3A4'; statusBg = 'rgba(125, 211, 164, 0.08)' }
                  else if (allSent && hasPartialPayment) { statusLabel = 'Partial'; statusColor = '#E8C878'; statusBg = 'rgba(232, 200, 120, 0.08)' }
                  else if (allSent) { statusLabel = 'Sent'; statusColor = '#E8A878'; statusBg = 'rgba(232, 200, 120, 0.08)' }
                  else if (somePaid || someSent) { statusLabel = 'Partial'; statusColor = '#E8C878'; statusBg = 'rgba(232, 200, 120, 0.08)' }
                  else if (isActive) { statusLabel = 'Active'; statusColor = '#78B4E8'; statusBg = 'rgba(120, 180, 232, 0.08)' }
                  else { statusLabel = 'Not Sent'; statusColor = '#9ca3af'; statusBg = 'rgba(255,255,255,0.04)' }

                  return (
                    <div
                      key={`all-${group.periodStart}|${group.periodEnd}`}
                      onClick={() => { setShowAllInvoices(false); setInvoiceModal(group) }}
                      className="card-hover"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 16px', marginBottom: '8px', cursor: 'pointer',
                        borderRadius: '12px', background: 'var(--card-bg-solid)',
                        border: '1px solid transparent',
                        transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)' }}>
                          {formatPeriod(group.periodStart, group.periodEnd)}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
                          {fmt$(group.totalEarnings)} earned · {fmt$(group.totalCommission)} management fee
                          {group.invoices.length > 1 && <span style={{ color: 'var(--foreground-subtle)' }}> · {group.invoices.length} accounts</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', fontWeight: 500, color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: '6px' }}>{statusLabel}</span>
                        {group.dueDate && !allPaid && (
                          <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)' }}>Due {fmtDate(group.dueDate)}</span>
                        )}
                        <span style={{ color: 'var(--foreground-subtle)', fontSize: '14px' }}>›</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── My Content + Growth & Stats ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px', marginTop: '12px' }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <Label>My Content</Label>
              <a href="/my-content" style={{ color: 'var(--palm-pink)', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}>
                View All →
              </a>
            </div>

            {/* Pipeline stages — filter saved to exclude anything further along */}
            {(() => {
              const progressedInspoIds = new Set([
                ...(pipeline?.uploaded || []).map(i => i.inspoId),
                ...(pipeline?.editing || []).map(i => i.inspoId),
                ...(pipeline?.scheduled || []).map(i => i.inspoId),
                ...(pipeline?.posted || []).map(i => i.inspoId),
              ].filter(Boolean))
              const savedOnly = savedReels.filter(r => !progressedInspoIds.has(r.id))

              return (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: savedOnly.length > 0 || (pipeline?.editing?.length > 0) ? '14px' : 0 }}>
              {[
                { label: 'Saved', count: savedOnly.length, color: 'var(--palm-pink)' },
                { label: 'Uploaded', count: pipeline?.uploaded?.length || 0, color: '#E8C878' },
                { label: 'Editing', count: pipeline?.editing?.length || 0, color: '#78B4E8' },
                { label: 'Posted', count: pipeline?.posted?.length || 0, color: '#7DD3A4' },
              ].map(stage => (
                <div key={stage.label} style={{
                  textAlign: 'center', padding: '8px',
                  background: 'rgba(232, 160, 160, 0.03)', borderRadius: '12px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: stage.count > 0 ? stage.color : 'rgba(255,255,255,0.08)' }}>{stage.count}</div>
                  <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>{stage.label}</div>
                </div>
              ))}
            </div>

            {/* Saved inspo thumbnails */}
            {savedOnly.length > 0 ? (
              <div>
                <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Saved Inspo</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                  {savedOnly.slice(0, 8).map((reel) => (
                    <a key={reel.id} href="/my-content?tab=saved" className="thumb-hover" style={{ textDecoration: 'none', display: 'block', borderRadius: '10px', overflow: 'hidden', background: 'var(--card-bg-solid)', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)' }}>
                      <div style={{ aspectRatio: '9/16', background: 'rgba(232, 160, 160, 0.04)', overflow: 'hidden' }}>
                        {reel.thumbnail ? (
                          <img src={reel.thumbnail} alt={reel.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground)', fontSize: '20px' }}>🎬</div>
                        )}
                      </div>
                      <div style={{ padding: '4px 6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(240, 236, 232, 0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reel.title}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ) : (pipeline?.editing?.length > 0 || pipeline?.uploaded?.length > 0) ? null : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--foreground-subtle)', fontSize: '13px' }}>
                Save reels from the Inspo Board to start creating content
              </div>
            )}

            {/* In progress content thumbnails */}
            {pipeline?.editing?.length > 0 && (
              <div style={{ marginTop: savedReels.length > 0 ? '12px' : 0 }}>
                <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>In Editing</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                  {pipeline.editing.slice(0, 4).map((item) => (
                    <a key={item.assetId} href="/my-content?tab=editing" className="thumb-hover" style={{ textDecoration: 'none', display: 'block', borderRadius: '10px', overflow: 'hidden', background: 'var(--card-bg-solid)', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)' }}>
                      <div style={{ aspectRatio: '9/16', background: 'rgba(232, 160, 160, 0.04)', overflow: 'hidden' }}>
                        {item.inspoThumbnail ? (
                          <img src={item.inspoThumbnail} alt={item.inspoTitle} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground)', fontSize: '20px' }}>✂️</div>
                        )}
                      </div>
                      <div style={{ padding: '4px 6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: '#78B4E8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.inspoTitle || item.assetName}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
              </>)
            })()}
          </Card>

          {/* Content DNA preview — next to My Content */}
          {creatorProfile ? (
            <Card style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>&#x1F9EC;</span>
                  <Label style={{ marginBottom: 0 }}>Your Content DNA</Label>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(true)
                    setTimeout(() => profileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                  }}
                  style={{
                    background: 'rgba(232, 160, 160, 0.04)', border: 'none', borderRadius: '9999px',
                    padding: '4px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, color: 'var(--palm-pink)',
                  }}
                >
                  Full Profile →
                </button>
              </div>

              {/* Profile summary snippet */}
              {creatorProfile.profileSummary && (
                <div style={{
                  fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.6', marginBottom: '14px',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {creatorProfile.profileSummary}
                </div>
              )}

              {/* Top tags */}
              {(() => {
                const topTags = Object.entries(creatorProfile.tagWeights || {}).filter(([, w]) => w > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
                if (topTags.length === 0) return null
                const maxWeight = topTags[0]?.[1] || 1
                return (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Top Tags</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {topTags.map(([tag, weight]) => (
                        <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)', fontWeight: 500, width: '110px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                          <div style={{ flex: 1, height: '6px', background: 'rgba(232, 160, 160, 0.04)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.round((weight / maxWeight) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #E88FAC, #D4A0B0)', borderRadius: '3px' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </Card>
          ) : (
            <Card>
              <Label>Growth & Stats</Label>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', padding: '8px 0' }}>
                <StatBox value="—" label="IG Followers" />
                <StatBox value="—" label="TikTok Followers" />
                <StatBox value="—" label="OF Subscribers" />
                <StatBox value="—" label="Week-over-Week" />
              </div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '8px', fontStyle: 'italic' }}>Stats tracking coming soon</div>
            </Card>
          )}
        </div>

        {/* ── Collapsible bars: Content DNA + Profile ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
          {/* Content DNA */}
          {creatorProfile && (
            <div ref={profileRef}>
              <button
                onClick={() => {
                  const willOpen = !profileOpen
                  setProfileOpen(willOpen)
                  if (willOpen) {
                    setTimeout(() => profileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                  }
                }}
                className="card-hover"
                style={{
                  width: '100%', background: 'var(--card-bg-solid)', borderRadius: profileOpen ? '18px 18px 0 0' : '18px', border: 'none',
                  padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px' }}>&#x1F9EC;</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>Your Content DNA</span>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: profileOpen ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
                  padding: '4px 12px', borderRadius: '9999px', transition: 'all 0.2s',
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: profileOpen ? 'var(--foreground)' : 'var(--palm-pink)' }}>{profileOpen ? 'Hide' : 'View'}</span>
                  <span style={{ fontSize: '12px', color: profileOpen ? 'var(--foreground)' : 'var(--palm-pink)', transition: 'transform 0.2s', transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#x25BE;</span>
                </div>
              </button>
              {profileOpen && (
                <div style={{ background: 'var(--card-bg-solid)', borderRadius: '0 0 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderTop: '1px solid transparent' }}>
                  <div style={{ display: 'grid', gap: '0' }} className="grid-cols-1 md:grid-cols-2">
                    <div style={{ padding: '20px 24px' }}>
                      {creatorProfile.profileSummary && (
                        <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: '1.6', marginBottom: '16px' }}>{creatorProfile.profileSummary}</div>
                      )}
                      {creatorProfile.contentDirectionNotes && (
                        <>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Content Direction</div>
                          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', lineHeight: '1.6' }}>{creatorProfile.contentDirectionNotes}</div>
                        </>
                      )}
                      {creatorProfile.dosDonts && (
                        <>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', marginTop: '16px' }}>Do / Don't</div>
                          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', lineHeight: '1.7', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: 'var(--card-bg-solid)', borderRadius: '10px', padding: '10px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>{creatorProfile.dosDonts}</div>
                        </>
                      )}
                    </div>
                    <div style={{ padding: '20px 24px', borderLeft: '1px solid transparent', display: 'flex', flexDirection: 'column' }}>
                      <Label>All Tags</Label>
                      {(() => {
                        const TAG_CATEGORIES = ['Setting / Location', 'Persona / Niche', 'Tone / Energy', 'Visual / Body', 'Viewer Experience', 'Film Format']
                        const CAT_COLORS = {
                          'Setting / Location': '#06b6d4',
                          'Persona / Niche': 'var(--palm-pink)',
                          'Tone / Energy': '#f472b6',
                          'Visual / Body': '#E8A878',
                          'Viewer Experience': '#78B4E8',
                          'Film Format': '#34d399',
                        }
                        const tags = (creatorProfile.allTags || []).filter(t => t.weight > 0)
                        if (tags.length === 0) return <div style={{ fontSize: '12px', color: 'var(--foreground-subtle)', fontStyle: 'italic' }}>No tags yet</div>

                        const byCategory = {}
                        tags.forEach(t => {
                          const cat = t.category || 'Other'
                          if (!byCategory[cat]) byCategory[cat] = []
                          byCategory[cat].push(t)
                        })

                        return (
                          <div style={{
                            display: 'flex', flexDirection: 'column', gap: '16px', flex: 1,
                            maxHeight: '500px', overflowY: 'auto', paddingRight: '4px',
                          }}>
                            {TAG_CATEGORIES.map(cat => {
                              const catTags = (byCategory[cat] || []).sort((a, b) => b.weight - a.weight)
                              if (!catTags.length) return null
                              const color = CAT_COLORS[cat] || 'var(--palm-pink)'
                              return (
                                <div key={cat}>
                                  <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{cat}</div>
                                  {catTags.map(t => (
                                    <div key={t.tag} style={{ marginBottom: '5px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                        <span style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.85)' }}>{t.tag}</span>
                                        <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '28px', textAlign: 'right' }}>{t.weight}</span>
                                      </div>
                                      <div style={{ height: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '2px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${t.weight}%`, background: color, borderRadius: '2px' }} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Profile — collapsible bar */}
          <div>
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="card-hover"
              style={{
                width: '100%', background: 'var(--card-bg-solid)', borderRadius: showProfile ? '18px 18px 0 0' : '18px', border: 'none',
                padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>&#x1F464;</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)' }}>Account Details</span>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: showProfile ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
                padding: '4px 12px', borderRadius: '9999px', transition: 'all 0.2s',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: showProfile ? 'var(--foreground)' : 'var(--palm-pink)' }}>{showProfile ? 'Hide' : 'View'}</span>
                <span style={{ fontSize: '12px', color: showProfile ? 'var(--foreground)' : 'var(--palm-pink)', transition: 'transform 0.2s', transform: showProfile ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#x25BE;</span>
              </div>
            </button>
            {showProfile && (
              <div style={{ background: 'var(--card-bg-solid)', borderRadius: '0 0 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '4px 20px 20px', borderTop: '1px solid transparent' }}>
                <Row label="Name" value={p.name} />
                <Row label="Stage Name" value={p.aka} />
                <Row label="Your Rate" value={fmtPct(1 - (p.commission || 0))} />
                <Row label="Management Fee" value={fmtPct(p.commission)} />
                <Row label="Started" value={fmtDate(p.managementStartDate)} />
                <Row label="OnlyFans" value={p.onlyfansUrl?.replace('https://', '')} href={p.onlyfansUrl} />
                {igHandle && <Row label="Instagram" value={igHandle} href={igHref} />}
                {p.ofEmail && <Row label="OF Email" value={p.ofEmail} />}
                {p.communicationEmail && p.communicationEmail !== p.ofEmail && <Row label="Email" value={p.communicationEmail} />}
                {p.telegram && <Row label="Telegram" value={p.telegram} />}
                {p.contractUrl && <Row label="Contract" value="View PDF" href={p.contractUrl} />}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Apple-style hover interactions */}
      <style>{`
        .card-hover:hover {
          transform: scale(1.01);
          box-shadow: 0 4px 20px rgba(0,0,0,0.1) !important;
        }
        .thumb-hover:hover {
          transform: scale(1.02);
          box-shadow: 0 4px 16px rgba(0,0,0,0.12) !important;
        }
        @media (max-width: 1024px) {
          [style*="grid-template-columns: repeat(12"] { grid-template-columns: 1fr !important; }
          [style*="grid-column: span 5"] { grid-column: span 1 !important; }
          [style*="grid-column: span 7"] { grid-column: span 1 !important; }
          [style*="grid-template-columns: repeat(4"] { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 768px) {
          [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          [style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; }
          [style*="gap: 32px"] { gap: 16px !important; }
          .quick-actions-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
      `}</style>
    </div>
  )
}
