'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useParams } from 'next/navigation'

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
        background: '#ffffff',
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
  return <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>{children}</div>
}

function Row({ label, value, href, mono }) {
  const valStyle = { color: '#4a4a4a', fontSize: '13px', ...(mono ? { fontFamily: 'monospace' } : {}) }
  const content = href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...valStyle, color: '#E88FAC', textDecoration: 'none' }}>{value}</a>
    : <span style={valStyle}>{value || '—'}</span>
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
      <span style={{ color: '#999', fontSize: '12px', flexShrink: 0, marginRight: '16px' }}>{label}</span>
      {content}
    </div>
  )
}

function StatBox({ value, label, color, gradient }) {
  const textStyle = gradient
    ? { fontSize: '22px', fontWeight: 700, background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
    : { fontSize: '22px', fontWeight: 700, color: color || '#1a1a1a' }
  return (
    <div style={{ flex: 1, minWidth: '120px' }}>
      <div style={textStyle}>{value}</div>
      <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>{label}</div>
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
        invoices: [],
      }
    }
    groups[key].totalEarnings += inv.earnings || 0
    groups[key].totalCommission += inv.totalCommission || 0
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
        background: '#fff', borderRadius: '20px', width: '100%', maxWidth: pdfUrl ? '1000px' : '640px',
        maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', transition: 'max-width 0.3s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>
                {formatPeriod(group.periodStart, group.periodEnd)}
              </div>
              <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                {group.invoices.length} account{group.invoices.length !== 1 ? 's' : ''} · Due {fmtDate(group.dueDate)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: '#f5f5f5', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
              cursor: 'pointer', fontSize: '14px', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
          {/* Combined totals */}
          <div style={{ display: 'flex', marginTop: '16px', padding: '18px 24px', background: '#FFF8FA', borderRadius: '14px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#1a1a1a' }}>{fmt$(group.totalEarnings)}</div>
              <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '3px' }}>Total Revenue</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '28px', fontWeight: 700, background: 'linear-gradient(135deg, #86efac 0%, #22c55e 35%, #15803d 70%, #0f5132 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{fmt$(group.totalEarnings - group.totalCommission)}</div>
              <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '3px' }}>Your Take Home</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#E88FAC' }}>{fmt$(group.totalCommission)}</div>
              <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '3px' }}>Management Fee</div>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {pdfUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '75vh' }}>
              <div style={{ padding: '12px 28px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => setPdfUrl(null)} style={{
                  background: '#f5f5f5', border: 'none', borderRadius: '8px', padding: '5px 12px',
                  cursor: 'pointer', fontSize: '12px', color: '#666', fontWeight: 500,
                }}>← Back</button>
                <span style={{ fontSize: '11px', color: '#aaa' }}>Invoice PDF</span>
              </div>
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="Invoice PDF" />
            </div>
          ) : (
            <div style={{ padding: '20px 28px 28px' }}>
              {/* Account line items */}
              {group.invoices.map((inv) => {
                const acctLabel = Array.isArray(inv.accountName) ? inv.accountName.join(', ') : (inv.accountName || 'Account')
                const pdfLink = inv.invoicePdfUrl || inv.invoiceDropboxUrl
                return (
                  <div key={inv.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', marginBottom: '6px',
                    background: '#FAFAFA', borderRadius: '12px',
                    border: '1px solid rgba(0,0,0,0.04)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', minWidth: '70px' }}>{acctLabel}</div>
                      {inv.invoiceStatus && (
                        <span style={{
                          fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '5px',
                          background: inv.invoiceStatus === 'Paid' ? '#dcfce7' : inv.invoiceStatus === 'Sent' ? '#fef3c7' : '#f3f4f6',
                          color: inv.invoiceStatus === 'Paid' ? '#16a34a' : inv.invoiceStatus === 'Sent' ? '#d97706' : '#6b7280',
                        }}>{inv.invoiceStatus}</span>
                      )}
                      <span style={{ fontSize: '12px', color: '#666' }}>{fmt$(inv.earnings)}</span>
                      <span style={{ fontSize: '12px', color: '#ccc' }}>·</span>
                      <span style={{ fontSize: '12px', color: '#999' }}>{fmtPct(inv.commissionPct)} fee</span>
                    </div>
                    {pdfLink && (
                      <button onClick={() => setPdfUrl(pdfLink)} style={{
                        fontSize: '11px', color: '#E88FAC', background: '#FFF0F3', border: 'none',
                        padding: '5px 12px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer',
                        flexShrink: 0,
                      }}>View PDF</button>
                    )}
                  </div>
                )
              })}

              {/* Zelle payment section */}
              {!allPaid && (
                <div style={{
                  marginTop: '20px', padding: '20px', background: '#FAFAFA', borderRadius: '14px',
                  border: '1px solid rgba(0,0,0,0.04)', textAlign: 'center',
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>Pay via Zelle</div>
                  <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '14px' }}>Scan the QR code or send to the info below</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '28px' }}>
                    <img src="/zelle-qr.png" alt="Zelle QR Code" style={{ width: '120px', height: '120px', borderRadius: '10px', objectFit: 'contain' }} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '6px' }}>
                        <span style={{ display: 'inline-block', width: '50px' }}>To</span>
                        <span style={{ color: '#4a4a4a', fontWeight: 500 }}>Palm Digital Management LLC</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '6px' }}>
                        <span style={{ display: 'inline-block', width: '50px' }}>Bank</span>
                        <span style={{ color: '#4a4a4a', fontWeight: 500 }}>Chase</span>
                      </div>
                      <div style={{
                        marginTop: '12px', padding: '10px 20px', background: '#6d28d9', color: '#fff',
                        borderRadius: '10px', fontSize: '13px', fontWeight: 600, display: 'inline-block',
                      }}>
                        {fmt$(group.totalCommission)} due
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{title}</div>
        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>{subtitle}</div>
      </Card>
    </a>
  )
}

export default function CreatorDashboard() {
  const { user, isLoaded } = useUser()
  const searchParams = useSearchParams()
  const params = useParams()
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
        setData(profileData)
        setSavedReels(savedData.records || [])
        setPipeline(pipelineData)
        if (cpData && cpData.profileAnalysisStatus === 'Complete') {
          setCreatorProfile({ ...cpData, tagWeights: tagData.tagWeights || {} })
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
      <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#aaa', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const { profile, uploads, invoices } = data || {}
  const p = profile || {}
  const displayName = p.aka || p.name || 'there'
  const igHandle = p.igAccount?.replace('https://', '')?.replace('instagram.com/', '@') || ''
  const igHref = p.igAccount?.startsWith('http') ? p.igAccount : `https://${p.igAccount}`

  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', color: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }} className="px-4 md:px-8 py-4 md:py-8">

        {/* ── Header + Earnings ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px', marginBottom: '12px' }}>
          <div className="md:pl-5" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h1 className="text-[22px] md:text-[28px]" style={{ fontWeight: 700, margin: 0 }}>Hey, {displayName}</h1>
            <p style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>Palm Management Dashboard</p>
          </div>
          <Card>
            {(() => {
              const groups = invoices?.length > 0 ? groupInvoicesByPeriod(invoices).sort((a, b) => (b.periodEnd || '').localeCompare(a.periodEnd || '')) : []
              const latestPeriod = groups[0]
              return <Label>{latestPeriod ? formatPeriod(latestPeriod.periodStart, latestPeriod.periodEnd) : 'Earnings'}</Label>
            })()}
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', padding: '4px 0', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ flex: 1, minWidth: '120px' }}>
                <div style={{ fontSize: '28px', fontWeight: 700, background: 'linear-gradient(135deg, #86efac 0%, #22c55e 35%, #15803d 70%, #0f5132 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{fmt$(p.previousMonthTR)}</div>
                <div style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>Total Revenue</div>
              </div>
              <div style={{ flex: 1, minWidth: '120px' }}>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#1a1a1a' }}>{fmt$(p.previousMonthTR * (1 - (p.commission || 0)))}</div>
                <div style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>Your Take Home</div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Browse Inspo + Quick Actions ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px', marginBottom: '12px' }}>
          {/* Browse Inspo — visual card with sort shortcuts */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 20px 16px' }}>
              <Label>Browse Inspo</Label>
              <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 14px' }}>Find reels to recreate for your audience</p>
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
                      background: s.key === 'foryou' ? '#FFF0F3' : '#FAFAFA',
                      border: s.key === 'foryou' ? '1px solid #E88FAC' : '1px solid rgba(0,0,0,0.04)',
                      transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                    }}
                  >
                    <span style={{ fontSize: '18px' }}>{s.icon}</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: s.key === 'foryou' ? '#E88FAC' : '#666' }}>{s.label}</span>
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
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.04)', padding: '12px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stripLabel}</span>
                    <a href={`${inspoPath}?sort=${stripSort}`} style={{ fontSize: '11px', color: '#E88FAC', textDecoration: 'none', fontWeight: 500 }}>See All →</a>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${topReels.length}, 1fr)`, gap: '6px' }}>
                    {topReels.map(r => (
                      <a key={r.id} href={`${inspoPath}?sort=${stripSort}`} style={{ aspectRatio: '9/14', borderRadius: '8px', overflow: 'hidden', background: '#FFF0F3', display: 'block' }}>
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
              {uploads?.longformUploadUrl && (
                <ActionCard href={uploads.longformUploadUrl} icon="🎬" title="Upload Longform" subtitle="Dropbox" />
              )}
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
                  if (allPaid) { statusLabel = 'Paid'; statusColor = '#16a34a'; statusBg = '#dcfce7' }
                  else if (allSent) { statusLabel = 'Sent'; statusColor = '#d97706'; statusBg = '#fef3c7' }
                  else if (somePaid || someSent) { statusLabel = 'Partial'; statusColor = '#d97706'; statusBg = '#fef3c7' }
                  else if (isActive) { statusLabel = 'Active'; statusColor = '#3b82f6'; statusBg = '#dbeafe' }
                  else { statusLabel = 'Not Sent'; statusColor = '#9ca3af'; statusBg = '#f3f4f6' }

                  return (
                    <div
                      key={`${group.periodStart}|${group.periodEnd}`}
                      onClick={() => setInvoiceModal(group)}
                      className="card-hover"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 14px', marginBottom: '6px', cursor: 'pointer',
                        borderRadius: '12px', background: '#FAFAFA',
                        border: '1px solid rgba(0,0,0,0.04)',
                        transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>
                          {formatPeriod(group.periodStart, group.periodEnd)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginTop: '3px' }}>
                          {fmt$(group.totalEarnings)} earned · {fmt$(group.totalCommission)} management fee
                          {group.invoices.length > 1 && <span style={{ color: '#bbb' }}> · {group.invoices.length} accounts</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', fontWeight: 500, color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: '6px' }}>{statusLabel}</span>
                        {group.dueDate && !allPaid && (
                          <span style={{ fontSize: '10px', color: '#aaa' }}>Due {fmtDate(group.dueDate)}</span>
                        )}
                        <span style={{ color: '#ccc', fontSize: '14px' }}>›</span>
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
                      borderRadius: '12px', background: '#FFF0F3',
                      border: '1px solid rgba(232,143,172,0.15)',
                      transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                      gap: '6px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#E88FAC' }}>
                      View All {allGroups.length} Periods
                    </span>
                    <span style={{ color: '#E88FAC', fontSize: '14px' }}>›</span>
                  </div>
                )}
              </>)
            })() : (
              <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>No invoices yet</div>
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
              background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '640px',
              maxHeight: '85vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>All Invoices</div>
                  <div style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>{groupInvoicesByPeriod(invoices).length} billing periods</div>
                </div>
                <button onClick={() => setShowAllInvoices(false)} style={{
                  background: '#f5f5f5', border: 'none', borderRadius: '50%', width: '32px', height: '32px',
                  cursor: 'pointer', fontSize: '14px', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                  if (allPaid) { statusLabel = 'Paid'; statusColor = '#16a34a'; statusBg = '#dcfce7' }
                  else if (allSent) { statusLabel = 'Sent'; statusColor = '#d97706'; statusBg = '#fef3c7' }
                  else if (somePaid || someSent) { statusLabel = 'Partial'; statusColor = '#d97706'; statusBg = '#fef3c7' }
                  else if (isActive) { statusLabel = 'Active'; statusColor = '#3b82f6'; statusBg = '#dbeafe' }
                  else { statusLabel = 'Not Sent'; statusColor = '#9ca3af'; statusBg = '#f3f4f6' }

                  return (
                    <div
                      key={`all-${group.periodStart}|${group.periodEnd}`}
                      onClick={() => { setShowAllInvoices(false); setInvoiceModal(group) }}
                      className="card-hover"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 16px', marginBottom: '8px', cursor: 'pointer',
                        borderRadius: '12px', background: '#FAFAFA',
                        border: '1px solid rgba(0,0,0,0.04)',
                        transition: '0.2s cubic-bezier(0, 0, 0.5, 1)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
                          {formatPeriod(group.periodStart, group.periodEnd)}
                        </div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                          {fmt$(group.totalEarnings)} earned · {fmt$(group.totalCommission)} management fee
                          {group.invoices.length > 1 && <span style={{ color: '#bbb' }}> · {group.invoices.length} accounts</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', fontWeight: 500, color: statusColor, background: statusBg, padding: '2px 8px', borderRadius: '6px' }}>{statusLabel}</span>
                        {group.dueDate && !allPaid && (
                          <span style={{ fontSize: '10px', color: '#aaa' }}>Due {fmtDate(group.dueDate)}</span>
                        )}
                        <span style={{ color: '#ccc', fontSize: '14px' }}>›</span>
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
              <a href="/my-content" style={{ color: '#E88FAC', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}>
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
                { label: 'Saved', count: savedOnly.length, color: '#E88FAC' },
                { label: 'Uploaded', count: pipeline?.uploaded?.length || 0, color: '#f59e0b' },
                { label: 'Editing', count: pipeline?.editing?.length || 0, color: '#3b82f6' },
                { label: 'Posted', count: pipeline?.posted?.length || 0, color: '#22c55e' },
              ].map(stage => (
                <div key={stage.label} style={{
                  textAlign: 'center', padding: '8px',
                  background: '#FFF8FA', borderRadius: '12px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: stage.count > 0 ? stage.color : '#ddd' }}>{stage.count}</div>
                  <div style={{ fontSize: '10px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '2px' }}>{stage.label}</div>
                </div>
              ))}
            </div>

            {/* Saved inspo thumbnails */}
            {savedOnly.length > 0 ? (
              <div>
                <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Saved Inspo</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                  {savedOnly.slice(0, 8).map((reel) => (
                    <a key={reel.id} href="/my-content?tab=saved" className="thumb-hover" style={{ textDecoration: 'none', display: 'block', borderRadius: '10px', overflow: 'hidden', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)' }}>
                      <div style={{ aspectRatio: '9/16', background: '#FFF0F3', overflow: 'hidden' }}>
                        {reel.thumbnail ? (
                          <img src={reel.thumbnail} alt={reel.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ddd', fontSize: '20px' }}>🎬</div>
                        )}
                      </div>
                      <div style={{ padding: '4px 6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: '#4a4a4a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reel.title}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ) : (pipeline?.editing?.length > 0 || pipeline?.uploaded?.length > 0) ? null : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#aaa', fontSize: '13px' }}>
                Save reels from the Inspo Board to start creating content
              </div>
            )}

            {/* In progress content thumbnails */}
            {pipeline?.editing?.length > 0 && (
              <div style={{ marginTop: savedReels.length > 0 ? '12px' : 0 }}>
                <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>In Editing</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                  {pipeline.editing.slice(0, 4).map((item) => (
                    <a key={item.assetId} href="/my-content?tab=editing" className="thumb-hover" style={{ textDecoration: 'none', display: 'block', borderRadius: '10px', overflow: 'hidden', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)' }}>
                      <div style={{ aspectRatio: '9/16', background: '#FFF0F3', overflow: 'hidden' }}>
                        {item.inspoThumbnail ? (
                          <img src={item.inspoThumbnail} alt={item.inspoTitle} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ddd', fontSize: '20px' }}>✂️</div>
                        )}
                      </div>
                      <div style={{ padding: '4px 6px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: '#3b82f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.inspoTitle || item.assetName}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
              </>)
            })()}
          </Card>

          {/* Growth & Stats — next to My Content */}
          <Card>
            <Label>Growth & Stats</Label>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', padding: '8px 0' }}>
              <StatBox value="—" label="IG Followers" />
              <StatBox value="—" label="TikTok Followers" />
              <StatBox value="—" label="OF Subscribers" />
              <StatBox value="—" label="Week-over-Week" />
            </div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px', fontStyle: 'italic' }}>Stats tracking coming soon</div>
          </Card>
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
                  width: '100%', background: '#ffffff', borderRadius: profileOpen ? '18px 18px 0 0' : '18px', border: 'none',
                  padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px' }}>&#x1F9EC;</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Your Content DNA</span>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: profileOpen ? '#E88FAC' : '#FFF0F3',
                  padding: '4px 12px', borderRadius: '9999px', transition: 'all 0.2s',
                }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: profileOpen ? '#fff' : '#E88FAC' }}>{profileOpen ? 'Hide' : 'View'}</span>
                  <span style={{ fontSize: '12px', color: profileOpen ? '#fff' : '#E88FAC', transition: 'transform 0.2s', transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#x25BE;</span>
                </div>
              </button>
              {profileOpen && (
                <div style={{ background: '#ffffff', borderRadius: '0 0 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'grid', gap: '0' }} className="grid-cols-1 md:grid-cols-2">
                    <div style={{ padding: '20px 24px' }}>
                      {creatorProfile.profileSummary && (
                        <div style={{ fontSize: '13px', color: '#4a4a4a', lineHeight: '1.6', marginBottom: '16px' }}>{creatorProfile.profileSummary}</div>
                      )}
                      {creatorProfile.contentDirectionNotes && (
                        <>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Content Direction</div>
                          <div style={{ fontSize: '12px', color: '#888', lineHeight: '1.6' }}>{creatorProfile.contentDirectionNotes}</div>
                        </>
                      )}
                      {creatorProfile.dosDonts && (
                        <>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', marginTop: '16px' }}>Do / Don't</div>
                          <div style={{ fontSize: '11px', color: '#888', lineHeight: '1.7', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: '#FAFAFA', borderRadius: '10px', padding: '10px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>{creatorProfile.dosDonts}</div>
                        </>
                      )}
                    </div>
                    <div style={{ padding: '20px 24px', borderLeft: '1px solid rgba(0,0,0,0.04)' }}>
                      <Label>Your Top Tags</Label>
                      {(() => {
                        const topTags = Object.entries(creatorProfile.tagWeights || {}).filter(([, w]) => w > 0).sort(([, a], [, b]) => b - a).slice(0, 10)
                        if (topTags.length === 0) return <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>No tags yet</div>
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {topTags.map(([tag, weight]) => (
                              <div key={tag}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                                  <span style={{ fontSize: '12px', color: '#4a4a4a' }}>{tag}</span>
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#E88FAC' }}>{weight}</span>
                                </div>
                                <div style={{ height: '4px', background: '#F5F0F2', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${weight}%`, background: '#E88FAC', borderRadius: '2px' }} />
                                </div>
                              </div>
                            ))}
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
                width: '100%', background: '#ffffff', borderRadius: showProfile ? '18px 18px 0 0' : '18px', border: 'none',
                padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>&#x1F464;</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Account Details</span>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: showProfile ? '#E88FAC' : '#FFF0F3',
                padding: '4px 12px', borderRadius: '9999px', transition: 'all 0.2s',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: showProfile ? '#fff' : '#E88FAC' }}>{showProfile ? 'Hide' : 'View'}</span>
                <span style={{ fontSize: '12px', color: showProfile ? '#fff' : '#E88FAC', transition: 'transform 0.2s', transform: showProfile ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#x25BE;</span>
              </div>
            </button>
            {showProfile && (
              <div style={{ background: '#ffffff', borderRadius: '0 0 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '4px 20px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
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
