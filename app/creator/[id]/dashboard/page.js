'use client'

import { useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import { useSearchParams, useParams } from 'next/navigation'

function fmt$(val) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0) }
function fmtPct(val) { return `${Math.round((val || 0) * 100)}%` }
function fmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' }

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

function StatBox({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: '120px' }}>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color || '#1a1a1a' }}>{value}</div>
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

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '20px', width: '100%', maxWidth: pdfUrl ? '900px' : '520px',
        maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'column', transition: 'max-width 0.3s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#1a1a1a' }}>
                {formatPeriod(group.periodStart, group.periodEnd)}
              </div>
              <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                {group.invoices.length} account{group.invoices.length !== 1 ? 's' : ''} · Due {fmtDate(group.dueDate)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: '#f5f5f5', border: 'none', borderRadius: '50%', width: '30px', height: '30px',
              cursor: 'pointer', fontSize: '14px', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
          {/* Combined totals */}
          <div style={{ display: 'flex', gap: '24px', marginTop: '14px', padding: '12px 16px', background: '#FFF8FA', borderRadius: '12px' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>{fmt$(group.totalEarnings)}</div>
              <div style={{ fontSize: '10px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Revenue</div>
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#4ade80' }}>{fmt$(group.totalCommission)}</div>
              <div style={{ fontSize: '10px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your Commission</div>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {pdfUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '70vh' }}>
              <div style={{ padding: '12px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => setPdfUrl(null)} style={{
                  background: '#f5f5f5', border: 'none', borderRadius: '8px', padding: '5px 12px',
                  cursor: 'pointer', fontSize: '12px', color: '#666', fontWeight: 500,
                }}>← Back</button>
                <span style={{ fontSize: '11px', color: '#aaa' }}>Invoice PDF</span>
              </div>
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="Invoice PDF" />
            </div>
          ) : (
            <div style={{ padding: '16px 24px 24px' }}>
              {group.invoices.map((inv) => {
                const acctLabel = Array.isArray(inv.accountName) ? inv.accountName.join(', ') : (inv.accountName || 'Account')
                return (
                  <div key={inv.id} style={{
                    padding: '14px 16px', marginBottom: '8px',
                    background: '#FAFAFA', borderRadius: '14px',
                    border: '1px solid rgba(0,0,0,0.04)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{acctLabel}</div>
                        {inv.invoiceStatus && (
                          <span style={{
                            fontSize: '10px', fontWeight: 500, marginTop: '4px', display: 'inline-block',
                            padding: '2px 8px', borderRadius: '6px',
                            background: inv.invoiceStatus === 'Paid' ? '#dcfce7' : inv.invoiceStatus === 'Sent' ? '#fef3c7' : '#f3f4f6',
                            color: inv.invoiceStatus === 'Paid' ? '#16a34a' : inv.invoiceStatus === 'Sent' ? '#d97706' : '#6b7280',
                          }}>{inv.invoiceStatus}</span>
                        )}
                      </div>
                      {inv.invoicePdfUrl && (
                        <button onClick={() => setPdfUrl(inv.invoicePdfUrl)} style={{
                          fontSize: '11px', color: '#E88FAC', background: '#FFF0F3', border: 'none',
                          padding: '5px 14px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.06)', transition: '0.2s',
                        }}>View PDF</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '20px', fontSize: '12px' }}>
                      <div>
                        <span style={{ color: '#aaa' }}>Revenue </span>
                        <span style={{ color: '#4a4a4a', fontWeight: 500 }}>{fmt$(inv.earnings)}</span>
                      </div>
                      <div>
                        <span style={{ color: '#aaa' }}>Commission </span>
                        <span style={{ color: '#4a4a4a', fontWeight: 500 }}>{fmt$(inv.totalCommission)}</span>
                      </div>
                      <div>
                        <span style={{ color: '#aaa' }}>Rate </span>
                        <span style={{ color: '#4a4a4a', fontWeight: 500 }}>{fmtPct(inv.commissionPct)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
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

  const [creatorProfile, setCreatorProfile] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [invoiceModal, setInvoiceModal] = useState(null)

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
      <div style={{ maxWidth: '1400px', margin: '0 auto' }} className="px-4 md:px-8 py-8">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Hey, {displayName}</h1>
            <p style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>Palm Management Dashboard</p>
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
                <StatBox value={fmtPct(p.commission)} label="Commission Rate" color="#E88FAC" />
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
              <ActionCard href={inspoPath} icon="✨" title="Browse Inspo" subtitle="Find reels" />
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
              <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px', fontStyle: 'italic' }}>Stats tracking coming soon</div>
            </Card>
          </div>
        </div>

        {/* ── Row 2: Invoices + Saved Inspo ── */}
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '12px' }}>

          {/* Invoices */}
          <Card>
            <Label>Invoices</Label>
            {invoices && invoices.length > 0 ? (
              groupInvoicesByPeriod(invoices).map((group) => {
                const hasPdf = group.invoices.some(inv => inv.invoicePdfUrl)
                const allPaid = group.invoices.every(inv => inv.invoiceStatus === 'Paid')
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
                        {fmt$(group.totalEarnings)} earned · {fmt$(group.totalCommission)} commission
                        {group.invoices.length > 1 && <span style={{ color: '#bbb' }}> · {group.invoices.length} accounts</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {allPaid && (
                        <span style={{ fontSize: '10px', fontWeight: 500, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '6px' }}>Paid</span>
                      )}
                      {group.dueDate && !allPaid && (
                        <span style={{ fontSize: '10px', color: '#aaa' }}>Due {fmtDate(group.dueDate)}</span>
                      )}
                      <span style={{ color: '#ccc', fontSize: '14px' }}>›</span>
                    </div>
                  </div>
                )
              })
            ) : (
              <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>No invoices yet</div>
            )}
          </Card>

          {/* Invoice detail modal */}
          {invoiceModal && <InvoiceModal group={invoiceModal} onClose={() => setInvoiceModal(null)} />}

          {/* Content Pipeline — shows saved, in progress, and completed content */}
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
        </div>

        {/* ── Creator Profile (collapsible) ── */}
        {creatorProfile && (
          <div style={{ marginTop: '12px' }}>
            <button onClick={() => setProfileOpen(!profileOpen)} className="card-hover" style={{
              width: '100%', background: '#ffffff', borderRadius: '18px', border: 'none',
              padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Your Creator Profile</span>
                {(() => {
                  const topTags = Object.entries(creatorProfile.tagWeights || {}).filter(([, w]) => w > 0).sort(([, a], [, b]) => b - a).slice(0, 3)
                  return topTags.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {topTags.map(([tag, weight]) => (
                        <span key={tag} style={{ fontSize: '10px', color: '#E88FAC', background: '#FFF0F3', padding: '2px 8px', borderRadius: '10px', fontWeight: 500 }}>
                          {tag} · {weight}
                        </span>
                      ))}
                    </div>
                  )
                })()}
              </div>
              <span style={{ color: '#ccc', fontSize: '18px', transition: 'transform 0.2s', transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
            </button>

            {profileOpen && (
              <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }} className="grid-cols-1 md:grid-cols-2">
                <Card>
                  {creatorProfile.profileSummary && (
                    <div style={{ fontSize: '13px', color: '#4a4a4a', lineHeight: '1.6', marginBottom: '16px' }}>
                      {creatorProfile.profileSummary}
                    </div>
                  )}
                  {creatorProfile.contentDirectionNotes && (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Content Direction</div>
                      <div style={{ fontSize: '12px', color: '#888', lineHeight: '1.6' }}>
                        {creatorProfile.contentDirectionNotes}
                      </div>
                    </>
                  )}
                  {creatorProfile.dosDonts && (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', marginTop: '16px' }}>Do / Don't</div>
                      <div style={{ fontSize: '11px', color: '#888', lineHeight: '1.7', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: '#FAFAFA', borderRadius: '10px', padding: '10px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}>
                        {creatorProfile.dosDonts}
                      </div>
                    </>
                  )}
                </Card>
                <Card>
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
                </Card>
              </div>
            )}
          </div>
        )}

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
        @media (max-width: 640px) {
          [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          [style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}
