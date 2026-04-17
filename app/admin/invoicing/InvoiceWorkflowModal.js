'use client'

import { useState, useCallback } from 'react'

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(n) { return Math.round(n * 100) + '%' }
function fmtTs(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
function accountRank(name) {
  if (name.includes('Free OF')) return 1
  if (name.includes('VIP OF')) return 2
  if (name.includes('Fansly')) return 3
  return 4
}

const STEPS = [
  { key: 'generate', label: 'Generate PDFs', icon: '1' },
  { key: 'review', label: 'Review PDFs', icon: '2' },
  { key: 'preview', label: 'Preview Email', icon: '3' },
  { key: 'send', label: 'Send Email', icon: '4' },
  { key: 'payment', label: 'Payment Status', icon: '5' },
]

export default function InvoiceWorkflowModal({ aka, rows, onClose, onRecordsUpdate }) {
  const getNextUnfinishedStep = (recs) => {
    const allPdfs = recs.every(r => r.hasPdf)
    const allSentOrPaid = recs.every(r => r.status === 'Sent' || r.status === 'Paid')
    const allPaid = recs.every(r => r.status === 'Paid')
    const anySent = recs.some(r => r.sentAt || r.status === 'Sent' || r.status === 'Paid')
    if (allPaid) return 4
    if (allSentOrPaid) return 4
    if (anySent) return 3 // email was sent, go to Send step to show confirmation
    if (allPdfs) return 1
    return 0
  }
  const [activeStep, setActiveStep] = useState(() => getNextUnfinishedStep(rows))
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })
  const [pdfTab, setPdfTab] = useState(0)
  const [pdfApproved, setPdfApproved] = useState(() => {
    // If email was already sent, PDFs were approved
    return rows.some(r => r.sentAt || r.status === 'Sent' || r.status === 'Paid')
  })
  const [emailApproved, setEmailApproved] = useState(() => {
    return rows.some(r => r.sentAt || r.status === 'Sent' || r.status === 'Paid')
  })
  const [emailPreview, setEmailPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  const sorted = [...rows].sort((a, b) => accountRank(a.accountName) - accountRank(b.accountName))
  const allHavePdfs = sorted.every(r => r.hasPdf)
  const allSent = sorted.every(r => r.status === 'Sent' || r.status === 'Paid')
  const allPaid = sorted.every(r => r.status === 'Paid')
  const latestGenAt = sorted.reduce((latest, r) => {
    if (!r.generatedAt) return latest
    return !latest || new Date(r.generatedAt) > new Date(latest) ? r.generatedAt : latest
  }, null)
  const latestSentAt = sorted.reduce((latest, r) => {
    if (!r.sentAt) return latest
    return !latest || new Date(r.sentAt) > new Date(latest) ? r.sentAt : latest
  }, null)

  const periodStart = rows[0]?.periodStart
  const periodEnd = rows[0]?.periodEnd
  const dueDate = rows[0]?.dueDate
  const totalEarnings = rows.reduce((s, r) => s + (r.earnings || 0), 0)
  const totalCommission = rows.reduce((s, r) => s + (r.totalCommission || 0), 0)

  // Step status
  const stepStatus = (i) => {
    switch (i) {
      case 0: return allHavePdfs ? 'complete' : 'ready'
      case 1: return pdfApproved ? 'complete' : allHavePdfs ? 'ready' : 'locked'
      case 2: return emailApproved ? 'complete' : allHavePdfs ? 'ready' : 'locked'
      case 3: return allSent ? 'complete' : allHavePdfs ? 'ready' : 'locked'
      case 4: return allPaid ? 'complete' : 'ready'
      default: return 'locked'
    }
  }

  // Generate one combined PDF for all accounts in this creator+period group.
  // The backend produces a single PDF with one line-item block per account and attaches
  // the same file to every record in the group.
  const handleGenerateAll = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setGenProgress({ done: 0, total: 1 })

    try {
      const res = await fetch('/api/admin/invoicing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: sorted.map(r => r.id) }),
      })
      if (!res.ok) {
        const text = await res.text()
        try { const err = JSON.parse(text); setError(`Failed: ${err.error}`) } catch (_) { setError(`Generation failed (${res.status}). May have timed out — try again.`) }
      } else {
        const data = await res.json()
        if (data.ok) {
          const genAt = data.generatedAt || new Date().toISOString()
          onRecordsUpdate(prev => prev.map(r => sorted.find(s => s.id === r.id) ? {
            ...r, hasPdf: true, dropboxLink: data.dropboxLink,
            invoiceNumber: data.invoiceNumber ? Number(data.invoiceNumber) : r.invoiceNumber,
            generatedAt: genAt,
          } : r))
        } else {
          setError(`Failed to generate: ${data.error}`)
        }
      }
      setGenProgress({ done: 1, total: 1 })
    } catch (e) {
      setError(e.message)
    }

    // Reload to pick up fresh Airtable attachment URLs (needed for thumbnail preview)
    try {
      const refresh = await fetch('/api/admin/invoicing')
      const refreshData = await refresh.json()
      if (refreshData.records) onRecordsUpdate(() => refreshData.records)
    } catch (_) {}
    setGenerating(false)
    setActiveStep(1)
  }, [sorted, onRecordsUpdate])

  // Load email preview
  const handleLoadPreview = useCallback(async () => {
    setLoadingPreview(true)
    setError(null)
    try {
      const ids = sorted.map(r => r.id).join(',')
      const res = await fetch(`/api/admin/invoicing/send-combined?recordIds=${ids}`)
      const data = await res.json()
      setEmailPreview(data)
    } catch (e) {
      setError(e.message)
    }
    setLoadingPreview(false)
  }, [sorted])

  // Send email
  const handleSend = useCallback(async () => {
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/invoicing/send-combined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: sorted.map(r => r.id) }),
      })
      const data = await res.json()
      if (data.ok) {
        onRecordsUpdate(prev => prev.map(r => {
          if (sorted.find(s => s.id === r.id)) {
            return { ...r, status: 'Sent', sentAt: data.sentAt || new Date().toISOString() }
          }
          return r
        }))
      } else if (data.manual) {
        setError('Resend API key not configured. Add RESEND_API_KEY to .env.local.')
      } else {
        setError(data.error || 'Send failed')
      }
    } catch (e) {
      setError(e.message)
    }
    setSending(false)
  }, [sorted, onRecordsUpdate])

  // Mark paid
  const handleMarkPaid = useCallback(async (recordId) => {
    try {
      await fetch('/api/admin/invoicing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, fields: { status: 'Paid' } }),
      })
      onRecordsUpdate(prev => prev.map(r => r.id === recordId ? { ...r, status: 'Paid' } : r))
    } catch (e) { setError(e.message) }
  }, [onRecordsUpdate])

  const handleMarkAllPaid = useCallback(async () => {
    for (const r of sorted) {
      if (r.status !== 'Paid') await handleMarkPaid(r.id)
    }
  }, [sorted, handleMarkPaid])

  // Reset the entire invoice workflow back to Draft — flips status + clears Sent At so the
  // modal re-opens on step 1. Used for re-doing a send after fixing a bad PDF/email.
  const handleResetToDraft = useCallback(async () => {
    if (!confirm('Reset this invoice back to Draft? You can re-generate and re-send after.')) return
    try {
      for (const r of sorted) {
        await fetch('/api/admin/invoicing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: r.id, fields: { status: 'Draft', sentAt: null } }),
        })
      }
      onRecordsUpdate(prev => prev.map(r => sorted.find(s => s.id === r.id) ? { ...r, status: 'Draft', sentAt: null } : r))
      setEmailApproved(false)
      setPdfApproved(false)
      setActiveStep(0)
    } catch (e) { setError(e.message) }
  }, [sorted, onRecordsUpdate])

  // Render step content
  const renderContent = () => {
    switch (activeStep) {
      case 0: return (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <button onClick={handleGenerateAll} disabled={generating} style={{
              background: generating ? '#e5e7eb' : allHavePdfs ? '#f3f4f6' : '#3b82f6',
              color: generating ? '#999' : allHavePdfs ? '#666' : '#fff',
              border: 'none', borderRadius: '10px', padding: '10px 24px',
              fontSize: '14px', fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer',
            }}>
              {generating ? `Generating ${genProgress.done} of ${genProgress.total}...` :
                allHavePdfs ? 'Regenerate All PDFs' : 'Generate All PDFs'}
            </button>
          </div>
          {sorted.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 14px', marginBottom: '4px',
              background: '#fafafa', borderRadius: '10px',
            }}>
              <span style={{
                width: '20px', height: '20px', borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '11px', flexShrink: 0,
                background: r.hasPdf ? '#dcfce7' : '#f3f4f6',
                color: r.hasPdf ? '#16a34a' : '#999',
              }}>{r.hasPdf ? '✓' : '—'}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', minWidth: '80px' }}>
                {r.accountName.replace(aka + ' - ', '')}
              </span>
              <span style={{ fontSize: '12px', color: '#888' }}>{fmt(r.earnings)}</span>
              {r.generatedAt && (
                <span style={{ fontSize: '10px', color: '#aaa', marginLeft: 'auto' }}>{fmtTs(r.generatedAt)}</span>
              )}
            </div>
          ))}
        </div>
      )

      case 1: return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {!allHavePdfs ? (
            <div style={{ color: '#999', fontSize: '13px', padding: '20px 0' }}>Generate PDFs first to review them.</div>
          ) : (() => {
            const rec = sorted[pdfTab]
            const thumbnailUrl = rec?.pdfThumbnail || null
            const dropboxView = rec?.dropboxLink || null
            return (thumbnailUrl || dropboxView) ? (
              <>
                {/* Top bar: account tabs + actions — always visible */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {sorted.map((r, i) => (
                      <button key={r.id} onClick={() => setPdfTab(i)} style={{
                        background: pdfTab === i ? '#FFF0F3' : '#f5f5f5',
                        border: pdfTab === i ? '1px solid #E88FAC' : '1px solid transparent',
                        borderRadius: '8px', padding: '6px 14px', fontSize: '12px', fontWeight: 500,
                        color: pdfTab === i ? '#E88FAC' : '#888', cursor: 'pointer',
                      }}>{r.accountName.replace(aka + ' - ', '')}</button>
                    ))}
                    {dropboxView && (
                      <a href={dropboxView} target="_blank" rel="noopener noreferrer" style={{
                        marginLeft: '8px',
                        fontSize: '12px', color: '#888', textDecoration: 'none',
                      }}>
                        Open full PDF ↗
                      </a>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setPdfApproved(false); setActiveStep(0) }} style={{
                      background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px',
                      padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    }}>
                      Needs Fix → Re-generate
                    </button>
                    <button onClick={() => { setPdfApproved(true); setActiveStep(2); handleLoadPreview() }} style={{
                      background: '#22c55e', color: '#fff', border: 'none', borderRadius: '10px',
                      padding: '9px 22px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    }}>
                      Approve PDF →
                    </button>
                  </div>
                </div>

                {/* Thumbnail preview — fills remaining space */}
                <div style={{
                  flex: 1, minHeight: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: '#f5f5f7', borderRadius: '12px', padding: '20px', overflow: 'auto',
                }}>
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt="Invoice preview"
                      style={{
                        maxHeight: '100%', maxWidth: '100%',
                        width: 'auto', height: 'auto', display: 'block',
                        boxShadow: '0 4px 24px rgba(0,0,0,0.12)', borderRadius: '4px',
                      }}
                    />
                  ) : (
                    <div style={{ color: '#999', fontSize: '13px', textAlign: 'center' }}>
                      Preview still processing — open the PDF to view it.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: '#999', fontSize: '13px' }}>No PDF link available for this account.</div>
            )
          })()}
        </div>
      )

      case 2: return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {!allHavePdfs ? (
            <div style={{ color: '#999', fontSize: '13px', padding: '20px 0' }}>Generate PDFs first.</div>
          ) : emailPreview ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* Validation warnings — always visible when present */}
              {(emailPreview.warnings || []).length > 0 && (
                <div style={{ marginBottom: '12px', flexShrink: 0 }}>
                  {emailPreview.warnings.map((w, i) => (
                    <div key={i} style={{
                      padding: '10px 14px',
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '10px',
                      fontSize: '12px',
                      color: '#B91C1C',
                      marginBottom: '6px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                    }}>
                      <span style={{ fontSize: '14px', lineHeight: 1 }}>⚠</span>
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Earnings delta indicator */}
              {emailPreview.earningsDelta && (
                <div style={{
                  marginBottom: '12px', flexShrink: 0, padding: '8px 14px',
                  background: emailPreview.earningsDelta === 'up' ? '#F0FDF4' : '#F9FAFB',
                  border: `1px solid ${emailPreview.earningsDelta === 'up' ? '#BBF7D0' : '#E5E7EB'}`,
                  borderRadius: '10px', fontSize: '12px',
                  color: emailPreview.earningsDelta === 'up' ? '#15803D' : '#6B7280',
                }}>
                  {emailPreview.earningsDelta === 'up'
                    ? `📈 Earnings up from last period — "great work" paragraph will be included.`
                    : emailPreview.earningsDelta === 'down'
                    ? `📉 Earnings down from last period — celebratory paragraph omitted, straight to invoice.`
                    : `Earnings flat vs. last period — celebratory paragraph omitted.`}
                </div>
              )}
              {/* Top bar: email meta + send button */}
              <div style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                gap: '12px', marginBottom: '14px', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 14px', background: '#fafafa', borderRadius: '10px', flex: 1 }}>
                  {[
                    { label: 'To', value: (emailPreview.to || []).join(', ') + (emailPreview.testMode ? '  (test mode)' : '') },
                    ...((emailPreview.bcc || []).length ? [{ label: 'Bcc', value: emailPreview.bcc.join(', ') }] : []),
                    ...((emailPreview.cc || []).length ? [{ label: 'Cc', value: emailPreview.cc.join(', ') }] : []),
                    { label: 'From', value: emailPreview.from || 'evan@palm-mgmt.com' },
                    { label: 'Subject', value: emailPreview.subject || `Your Palm Invoice — ${fmtDate(periodStart)} to ${fmtDate(periodEnd)}` },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                      <span style={{ color: '#999', width: '55px', flexShrink: 0 }}>{r.label}</span>
                      <span style={{ color: '#4a4a4a' }}>{r.value}</span>
                    </div>
                  ))}
                  {emailPreview.testMode && (emailPreview.wouldSendTo || []).length > 0 && (
                    <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed rgba(0,0,0,0.08)', fontSize: '11px', color: '#9ca3af' }}>
                      <em>Production would send to <strong>{emailPreview.wouldSendTo.join(', ')}</strong>, cc <strong>{(emailPreview.wouldCc || []).join(', ')}</strong>.</em>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setEmailApproved(true); setActiveStep(3) }}
                  style={{
                    background: '#22c55e', color: '#fff',
                    border: 'none', borderRadius: '10px',
                    padding: '10px 22px', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', flexShrink: 0,
                  }}>
                  Looks Good → Send
                </button>
              </div>
              {/* Email body preview — fills remaining space */}
              <div style={{ border: '1px solid #eee', borderRadius: '10px', overflow: 'hidden', flex: 1, minHeight: 0 }}>
                <iframe
                  srcDoc={emailPreview.html || emailPreview.manual?.html || '<p>No preview available</p>'}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox="allow-same-origin"
                  title="Email Preview"
                />
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px 0' }}>
              <button onClick={handleLoadPreview} disabled={loadingPreview} style={{
                background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px',
                padding: '10px 24px', fontSize: '14px', fontWeight: 600,
                cursor: loadingPreview ? 'not-allowed' : 'pointer',
                opacity: loadingPreview ? 0.6 : 1,
              }}>
                {loadingPreview ? 'Loading preview...' : 'Load Email Preview'}
              </button>
            </div>
          )}
        </div>
      )

      case 3: return (
        <div>
          {allSent ? (
            <div style={{ padding: '20px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>✓</span>
                <span style={{ fontSize: '15px', fontWeight: 600, color: '#16a34a' }}>Invoice Sent</span>
              </div>
              {latestSentAt && <div style={{ fontSize: '12px', color: '#aaa' }}>Sent {fmtTs(latestSentAt)}</div>}
            </div>
          ) : !allHavePdfs ? (
            <div style={{ color: '#999', fontSize: '13px', padding: '20px 0' }}>Generate PDFs first.</div>
          ) : (
            <div style={{ padding: '20px 0' }}>
              <div style={{ padding: '14px 16px', background: '#fafafa', borderRadius: '10px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '6px' }}>
                  Sending to <strong style={{ color: '#4a4a4a' }}>{(emailPreview?.to || []).join(', ') || '(creator email missing)'}</strong>
                  {emailPreview?.cc?.length ? <> · cc <strong style={{ color: '#4a4a4a' }}>{emailPreview.cc.join(', ')}</strong></> : null}
                </div>
                <div style={{ fontSize: '12px', color: '#999' }}>
                  {sorted.length} account{sorted.length > 1 ? 's' : ''} · Management fee: <strong style={{ color: '#E88FAC' }}>{fmt(totalCommission)}</strong>
                </div>
              </div>
              <button onClick={handleSend} disabled={sending} style={{
                background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px',
                padding: '12px 28px', fontSize: '14px', fontWeight: 600,
                cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1,
              }}>
                {sending ? 'Sending...' : '✉ Send Invoice Email'}
              </button>
            </div>
          )}
        </div>
      )

      case 4: return (
        <div>
          {sorted.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', marginBottom: '4px', background: '#fafafa', borderRadius: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>
                  {r.accountName.replace(aka + ' - ', '')}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 500, padding: '2px 8px', borderRadius: '5px',
                  background: r.status === 'Paid' ? '#dcfce7' : r.status === 'Sent' ? '#fef3c7' : '#f3f4f6',
                  color: r.status === 'Paid' ? '#16a34a' : r.status === 'Sent' ? '#d97706' : '#6b7280',
                }}>{r.status}</span>
              </div>
              {r.status !== 'Paid' && (
                <button onClick={() => handleMarkPaid(r.id)} style={{
                  background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '6px',
                  padding: '4px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                }}>Mark Paid</button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px' }}>
            {!allPaid && (
              <button onClick={handleMarkAllPaid} style={{
                background: '#22c55e', color: '#fff', border: 'none',
                borderRadius: '10px', padding: '10px 24px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}>Mark All Paid</button>
            )}
            <button onClick={handleResetToDraft} style={{
              background: 'transparent', color: '#9ca3af', border: '1px solid #e5e7eb',
              borderRadius: '10px', padding: '9px 18px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.borderColor = '#fecaca' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#e5e7eb' }}
            >
              ↺ Reset to Draft
            </button>
          </div>
        </div>
      )
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '1100px',
        height: '95vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        display: 'flex', flexDirection: 'row',
      }}>
        {/* Left sidebar: header info + stats + stepper */}
        <div style={{
          width: '260px', borderRight: '1px solid rgba(0,0,0,0.06)', flexShrink: 0,
          display: 'flex', flexDirection: 'column', overflow: 'auto',
        }}>
          {/* Close button */}
          <div style={{ padding: '16px 20px 0', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{
              background: '#f5f5f5', border: 'none', borderRadius: '50%', width: '28px', height: '28px',
              cursor: 'pointer', fontSize: '13px', color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>

          {/* Creator + period */}
          <div style={{ padding: '8px 20px 18px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>{aka}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', lineHeight: 1.4 }}>
              {fmtDate(periodStart)} – {fmtDate(periodEnd)}<br/>
              {sorted.length} account{sorted.length > 1 ? 's' : ''}{dueDate && ` · Due ${fmtDate(dueDate)}`}
            </div>
          </div>

          {/* Summary stats — stacked vertically */}
          <div style={{ padding: '0 20px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>{fmt(totalEarnings)}</div>
              <div style={{ fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1px' }}>Revenue</div>
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#E88FAC' }}>{fmt(totalCommission)}</div>
              <div style={{ fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1px' }}>Mgmt Fee</div>
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e' }}>{fmt(totalEarnings - totalCommission)}</div>
              <div style={{ fontSize: '9px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1px' }}>Creator Take Home</div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', margin: '0 20px' }} />

          {/* Stepper */}
          <div style={{ padding: '14px 0' }}>
            {STEPS.map((step, i) => {
              const status = stepStatus(i)
              const isActive = activeStep === i
              const isLocked = status === 'locked'
              const isComplete = status === 'complete'

              return (
                <button key={step.key}
                  onClick={() => !isLocked && setActiveStep(i)}
                  disabled={isLocked}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                    padding: '10px 20px', background: isActive ? '#FFF8FA' : 'transparent',
                    border: 'none', borderLeft: isActive ? '3px solid #E88FAC' : '3px solid transparent',
                    cursor: isLocked ? 'not-allowed' : 'pointer', textAlign: 'left',
                    transition: '0.15s',
                  }}>
                  <span style={{
                    width: '24px', height: '24px', borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0,
                    background: isComplete ? '#dcfce7' : isActive ? '#E88FAC' : isLocked ? '#f3f4f6' : '#dbeafe',
                    color: isComplete ? '#16a34a' : isActive ? '#fff' : isLocked ? '#ccc' : '#3b82f6',
                  }}>
                    {isComplete ? '✓' : step.icon}
                  </span>
                  <div>
                    <div style={{
                      fontSize: '12px', fontWeight: isActive ? 600 : 400,
                      color: isLocked ? '#ccc' : isComplete ? '#16a34a' : '#1a1a1a',
                    }}>{step.label}</div>
                    {i === 0 && latestGenAt && isComplete && (
                      <div style={{ fontSize: '9px', color: '#aaa', marginTop: '1px' }}>{fmtTs(latestGenAt)}</div>
                    )}
                    {i === 3 && latestSentAt && isComplete && (
                      <div style={{ fontSize: '9px', color: '#aaa', marginTop: '1px' }}>{fmtTs(latestSentAt)}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right content — fills full modal height */}
        <div style={{ flex: 1, padding: '24px 28px', overflow: activeStep === 1 ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
          {error && (
            <div style={{
              marginBottom: '14px', padding: '10px 14px', background: '#fef2f2',
              border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', color: '#dc2626',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>×</button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  )
}
