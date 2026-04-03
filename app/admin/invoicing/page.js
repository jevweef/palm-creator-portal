'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'

const STATUS_CONFIG = {
  Draft: { color: '#999', bg: '#1c1c1c', next: 'Sent' },
  Sent:  { color: '#3b82f6', bg: '#0f1f3d', next: 'Paid' },
  Paid:  { color: '#22c55e', bg: '#0f2d1a', next: 'Draft' },
}

const COLS = '160px 150px 130px 130px 130px 88px 140px'

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(n) { return Math.round(n * 100) + '%' }
function fmtDate(iso) {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1] + ' ' + parseInt(d)
}
function accountRank(name) {
  if (name.includes('Free OF')) return 1
  if (name.includes('VIP OF')) return 2
  if (name.includes('Fansly')) return 3
  return 4
}

// ── Send confirmation modal ─────────────────────────────────────────────────
function SendModal({ data, onConfirm, onCancel, sending }) {
  if (!data) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#ffffff', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px',
        padding: '28px 32px', width: '440px', maxWidth: '90vw',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>
          Send invoice to {data.aka}?
        </div>
        <div style={{ fontSize: '13px', color: '#999', marginBottom: '24px' }}>
          This will email the PDF link and mark the invoice as Sent.
        </div>

        {[
          { label: 'To', value: data.email || '⚠ No email on file' },
          { label: 'Invoice', value: `#${data.invoiceNumber} — ${data.accountName}` },
          { label: 'Period', value: `${fmtDate(data.periodStart)} – ${fmtDate(data.periodEnd)}` },
          { label: 'Amount', value: fmt(data.totalDue) },
        ].map(row => (
          <div key={row.label} style={{
            display: 'flex', gap: '16px', padding: '8px 0',
            borderBottom: '1px solid rgba(0,0,0,0.04)', alignItems: 'center',
          }}>
            <span style={{ fontSize: '12px', color: '#999', width: '56px', flexShrink: 0 }}>{row.label}</span>
            <span style={{ fontSize: '13px', color: '#4a4a4a' }}>{row.value}</span>
          </div>
        ))}

        {data.dropboxLink && (
          <a href={data.dropboxLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#E88FAC', display: 'inline-block', marginTop: '12px' }}>
            Preview PDF ↗
          </a>
        )}

        {!process.env.NEXT_PUBLIC_RESEND_CONFIGURED && !data.email && (
          <div style={{ marginTop: '14px', padding: '10px 14px', background: '#2d1515', border: '1px solid #5c2020', borderRadius: '8px', fontSize: '12px', color: '#f87171' }}>
            No email address found for this creator. Add one to their Creator record first.
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            background: 'transparent', border: '1px solid #E8C4CC', borderRadius: '7px',
            color: '#888', padding: '8px 18px', fontSize: '13px', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={sending || !data.email} style={{
            background: data.email ? '#3b82f6' : '#FFF0F3',
            border: 'none', borderRadius: '7px', color: '#1a1a1a',
            padding: '8px 20px', fontSize: '13px', fontWeight: 600,
            cursor: data.email ? 'pointer' : 'not-allowed', opacity: sending ? 0.6 : 1,
          }}>
            {sending ? 'Sending...' : 'Send Invoice ✉'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status, saving, onClick }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.Draft
  return (
    <button onClick={onClick} disabled={saving} title={`Click to mark as ${cfg.next}`}
      style={{
        background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}44`,
        borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: 600,
        cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
        whiteSpace: 'nowrap', transition: 'opacity 0.15s', letterSpacing: '0.03em',
      }}>
      {saving ? '...' : status}
    </button>
  )
}

// ── Inline earnings editor ───────────────────────────────────────────────────
function EarningsCell({ record, onSave, disabled }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  function startEdit() {
    if (disabled) return
    setValue(record.earnings === 0 ? '' : String(record.earnings))
    setEditing(true)
  }

  async function commit() {
    const num = parseFloat(value)
    if (!isNaN(num) && num !== record.earnings) await onSave(record.id, { earnings: num })
    setEditing(false)
  }

  if (editing) {
    return (
      <input autoFocus type="number" step="0.01" value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          background: '#FFF0F3', border: '1px solid #E88FAC', borderRadius: '4px',
          color: '#1a1a1a', fontSize: '13px', padding: '4px 8px', width: '130px', outline: 'none',
        }}
      />
    )
  }

  return (
    <button onClick={startEdit} disabled={disabled} title="Click to edit"
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
        border: '1px solid transparent', borderRadius: '4px',
        color: record.earnings > 0 ? '#e4e4e7' : '#555',
        fontSize: '13px', cursor: disabled ? 'default' : 'pointer',
        padding: '4px 8px', fontFamily: 'inherit', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = '#E8C4CC'; e.currentTarget.style.background = '#FFF0F3' }}}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }}
    >
      {record.earnings > 0 ? fmt(record.earnings) : <span style={{ color: '#444' }}>—</span>}
      {!disabled && <span style={{ fontSize: '10px', color: '#444' }}>✎</span>}
    </button>
  )
}

// ── Summary bar ──────────────────────────────────────────────────────────────
function SummaryBar({ records }) {
  const total = records.reduce((s, r) => ({
    tr: s.tr + (r.earnings || 0),
    commission: s.commission + (r.totalCommission || 0),
    chat: s.chat + (r.chatTeamCost || 0),
    net: s.net + (r.netProfit || 0),
  }), { tr: 0, commission: 0, chat: 0, net: 0 })

  const byStatus = records.reduce((s, r) => { s[r.status] = (s[r.status] || 0) + 1; return s }, {})

  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
      {[
        { label: 'Total Revenue', value: fmt(total.tr), color: '#1a1a1a' },
        { label: 'Total Commission', value: fmt(total.commission), color: '#E88FAC' },
        { label: 'Chat Team Cost', value: fmt(total.chat), color: '#f59e0b' },
        { label: 'Net Profit', value: fmt(total.net), color: '#22c55e' },
      ].map(s => (
        <div key={s.label} style={{
          background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
          padding: '14px 18px', minWidth: '130px', flex: '1 1 0',
        }}>
          <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
            {s.label}
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
        </div>
      ))}
      <div style={{ background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '14px 18px', minWidth: '110px' }}>
        <div style={{ fontSize: '10px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Status</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
            <span key={s} style={{ fontSize: '12px', color: cfg.color, fontWeight: 600 }}>
              {byStatus[s] || 0} {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Sticky column headers ────────────────────────────────────────────────────
function TableHeader() {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: '#FFF5F7',
      display: 'grid', gridTemplateColumns: COLS, gap: '12px',
      padding: '6px 20px 8px', marginBottom: '4px',
      borderBottom: '1px solid rgba(0,0,0,0.04)',
    }}>
      {[
        { label: 'Account', align: 'left' },
        { label: 'Earnings (TR)', align: 'left' },
        { label: 'Commission', align: 'right' },
        { label: 'Chat Fee', align: 'right' },
        { label: 'Net Profit', align: 'right' },
        { label: 'Status', align: 'center' },
        { label: 'Actions', align: 'right' },
      ].map(col => (
        <div key={col.label} style={{
          fontSize: '11px', color: '#3f3f46', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: col.align,
        }}>
          {col.label}
        </div>
      ))}
    </div>
  )
}

// ── Creator group card ───────────────────────────────────────────────────────
function CreatorGroup({ aka, rows, onSave, onBulkStatus, onGenerate, onSendClick, onSendInvoice, savingId, actionState }) {
  const commissionPct = rows[0]?.commissionPct || 0
  const totalTr = rows.reduce((s, r) => s + (r.earnings || 0), 0)
  const totalNet = rows.reduce((s, r) => s + (r.netProfit || 0), 0)
  const dueDate = rows[0]?.dueDate
  const allHavePdfs = rows.every(r => r.hasPdf)
  const allSent = rows.every(r => r.status === 'Sent' || r.status === 'Paid')
  const sorted = [...rows].sort((a, b) => accountRank(a.accountName) - accountRank(b.accountName))

  return (
    <div style={{
      background: '#ffffff', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
      marginBottom: '10px', overflow: 'hidden',
    }}>
      {/* Creator header row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: '#fafafa',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{aka}</span>
          <span style={{ fontSize: '12px', color: '#999' }}>
            {pct(commissionPct)} commission · {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
          </span>
          {dueDate && (
            <span style={{ fontSize: '11px', color: '#3f3f46', background: '#FFF0F3', padding: '2px 8px', borderRadius: '4px' }}>
              Due {fmtDate(dueDate)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '12px', fontSize: '13px', alignItems: 'center' }}>
          <span style={{ color: '#999' }}>TR: <span style={{ color: totalTr > 0 ? '#4a4a4a' : '#444' }}>{fmt(totalTr)}</span></span>
          <span style={{ color: '#999' }}>Net: <span style={{ color: totalNet > 0 ? '#22c55e' : '#444' }}>{fmt(totalNet)}</span></span>
          <span style={{ color: '#ddd', margin: '0 2px' }}>|</span>
          {(() => {
            const allSame = rows.every(r => r.status === rows[0]?.status)
            const currentStatus = allSame ? rows[0]?.status : null
            const nextStatus = currentStatus ? STATUS_CONFIG[currentStatus]?.next : null
            const ids = rows.map(r => r.id)
            return (<>
              {currentStatus && nextStatus ? (
                <button onClick={() => onBulkStatus(ids, nextStatus)}
                  style={{
                    background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '5px',
                    color: '#E88FAC', fontSize: '11px', fontWeight: 600, padding: '3px 10px',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  Mark All {nextStatus}
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '4px' }}>
                  {['Sent', 'Paid'].map(s => (
                    <button key={s} onClick={() => onBulkStatus(ids, s)}
                      style={{
                        background: '#FFF0F3', border: '1px solid #E8C4CC', borderRadius: '5px',
                        color: '#E88FAC', fontSize: '10px', fontWeight: 600, padding: '2px 8px',
                        cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                      All {s}
                    </button>
                  ))}
                </div>
              )}
              {allHavePdfs && !allSent && (
                <button onClick={() => onSendInvoice(ids, aka)}
                  style={{
                    background: '#3b82f6', border: 'none', borderRadius: '5px',
                    color: '#fff', fontSize: '11px', fontWeight: 600, padding: '3px 12px',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                  ✉ Send Invoice
                </button>
              )}
            </>)
          })()}
        </div>
      </div>

      {/* Account rows */}
      {sorted.map((record, i) => {
        const isSavingStatus = savingId === record.id
        const action = actionState[record.id]
        const isGenerating = action === 'generating'
        const isSending = action === 'sending'
        const isBusy = isSavingStatus || isGenerating || isSending

        return (
          <div key={record.id}
            style={{
              display: 'grid', gridTemplateColumns: COLS,
              alignItems: 'center', gap: '12px', padding: '10px 20px',
              borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.04)', transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#161616'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Account name */}
            <div style={{ fontSize: '13px', color: '#888' }}>
              {record.accountName.replace(aka + ' - ', '')}
            </div>

            {/* Earnings — editable */}
            <EarningsCell record={record} onSave={onSave} disabled={isBusy} />

            {/* Commission */}
            <div style={{ fontSize: '13px', color: record.totalCommission > 0 ? '#E88FAC' : '#444', textAlign: 'right' }}>
              {fmt(record.totalCommission)}
            </div>

            {/* Chat fee */}
            <div style={{ fontSize: '13px', color: record.chatTeamCost > 0 ? '#f59e0b' : '#444', textAlign: 'right' }}>
              {record.chatTeamCost > 0 ? '− ' + fmt(record.chatTeamCost) : '—'}
            </div>

            {/* Net profit */}
            <div style={{ fontSize: '13px', fontWeight: 600, color: record.netProfit > 0 ? '#22c55e' : '#444', textAlign: 'right' }}>
              {fmt(record.netProfit)}
            </div>

            {/* Status */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <StatusPill
                status={record.status} saving={isSavingStatus}
                onClick={() => onSave(record.id, { status: STATUS_CONFIG[record.status]?.next || 'Draft' })}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
              {/* View PDF */}
              {record.dropboxLink && (
                <a href={record.dropboxLink} target="_blank" rel="noopener noreferrer"
                  title="View PDF" style={{
                    color: '#999', fontSize: '14px', textDecoration: 'none',
                    padding: '4px 6px', borderRadius: '4px', lineHeight: 1,
                    border: '1px solid #E8C4CC',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#E88FAC'}
                  onMouseLeave={e => e.currentTarget.style.color = '#999'}
                >
                  ↗
                </a>
              )}

              {/* Generate button */}
              <button onClick={() => onGenerate(record.id)} disabled={isBusy}
                title={record.hasPdf ? 'Regenerate PDF' : 'Generate PDF'}
                style={{
                  background: isGenerating ? '#FFF0F3' : '#FFF0F3',
                  border: `1px solid ${isGenerating ? '#E88FAC44' : '#E8C4CC'}`,
                  borderRadius: '4px', color: isGenerating ? '#E88FAC' : '#999',
                  fontSize: '11px', fontWeight: 600, padding: '4px 8px',
                  cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy && !isGenerating ? 0.4 : 1,
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}>
                {isGenerating ? '⟳ Gen...' : record.hasPdf ? '⟳ PDF' : '⚙ Gen'}
              </button>

              {/* Send button */}
              <button onClick={() => onSendClick(record.id)} disabled={isBusy || !record.hasPdf}
                title={!record.hasPdf ? 'Generate PDF first' : 'Send to creator'}
                style={{
                  background: isSending ? '#0f1f3d' : '#FFF0F3',
                  border: `1px solid ${isSending ? '#3b82f644' : '#E8C4CC'}`,
                  borderRadius: '4px', color: isSending ? '#3b82f6' : record.hasPdf ? '#999' : '#E8C4CC',
                  fontSize: '11px', fontWeight: 600, padding: '4px 8px',
                  cursor: (isBusy || !record.hasPdf) ? 'not-allowed' : 'pointer',
                  opacity: (!record.hasPdf && !isSending) ? 0.4 : 1,
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}>
                {isSending ? '✉ ...' : '✉ Send'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function InvoicingPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  const [records, setRecords] = useState([])
  const [periods, setPeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [actionState, setActionState] = useState({}) // { [recordId]: 'generating' | 'sending' }
  const [sendModal, setSendModal] = useState(null)   // preflight data for the modal
  const [actionError, setActionError] = useState(null)

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin'

  useEffect(() => {
    if (!isLoaded) return
    if (!isAdmin) router.replace('/dashboard')
  }, [isLoaded, isAdmin, router])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/invoicing')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setRecords(data.records)
      setPeriods(data.periods)
      if (data.periods.length > 0 && !selectedPeriod) setSelectedPeriod(data.periods[0].key)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [selectedPeriod])

  useEffect(() => { load() }, [])

  // Save earnings or status
  const handleSave = useCallback(async (recordId, fields) => {
    setSavingId(recordId)
    try {
      const res = await fetch('/api/admin/invoicing', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, fields }),
      })
      if (!res.ok) throw new Error('Save failed')
      setRecords(prev => prev.map(r => {
        if (r.id !== recordId) return r
        const u = { ...r }
        if (fields.earnings !== undefined) {
          u.earnings = fields.earnings
          u.totalCommission = fields.earnings * r.commissionPct
          u.chatTeamCost = fields.earnings * r.commissionPct * r.chatFeePct
          u.netProfit = u.totalCommission - u.chatTeamCost
        }
        if (fields.status !== undefined) u.status = fields.status
        return u
      }))
    } catch (e) { console.error(e) }
    finally { setSavingId(null) }
  }, [])

  // Bulk status update — mark all records for a creator as Sent/Paid
  const handleBulkStatus = useCallback(async (recordIds, status) => {
    for (const id of recordIds) {
      setSavingId(id)
      try {
        const res = await fetch('/api/admin/invoicing', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: id, fields: { status } }),
        })
        if (res.ok) {
          setRecords(prev => prev.map(r => r.id === id ? { ...r, status } : r))
        }
      } catch (e) { console.error(e) }
    }
    setSavingId(null)
  }, [])

  // Generate PDF
  const handleGenerate = useCallback(async (recordId) => {
    setActionState(prev => ({ ...prev, [recordId]: 'generating' }))
    setActionError(null)
    try {
      const res = await fetch('/api/admin/invoicing/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setActionError(data.error || 'PDF generation failed')
        return
      }
      setRecords(prev => prev.map(r => r.id !== recordId ? r : {
        ...r, dropboxLink: data.dropboxLink, hasPdf: true,
        invoiceNumber: data.invoiceNumber ? Number(data.invoiceNumber) : r.invoiceNumber,
      }))
    } catch (e) {
      setActionError(e.message)
    } finally {
      setActionState(prev => ({ ...prev, [recordId]: null }))
    }
  }, [])

  // Open send modal — fetch preflight data first
  const handleSendClick = useCallback(async (recordId) => {
    setActionState(prev => ({ ...prev, [recordId]: 'sending' }))
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/invoicing/send?recordId=${recordId}`)
      const data = await res.json()
      if (!res.ok) { setActionError(data.error); return }
      setSendModal({ ...data, recordId })
    } catch (e) {
      setActionError(e.message)
    } finally {
      setActionState(prev => ({ ...prev, [recordId]: null }))
    }
  }, [])

  // Confirm send
  const handleSendConfirm = useCallback(async () => {
    if (!sendModal) return
    const { recordId } = sendModal
    setActionState(prev => ({ ...prev, [recordId]: 'sending' }))
    try {
      const res = await fetch('/api/admin/invoicing/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      })
      const data = await res.json()
      if (data.ok) {
        setRecords(prev => prev.map(r => r.id === recordId ? { ...r, status: 'Sent' } : r))
        setSendModal(null)
      } else if (data.manual) {
        // Resend not configured — show details for manual send
        setSendModal(prev => ({ ...prev, manual: true, manualDetails: data }))
      } else {
        setActionError(data.error || 'Send failed')
        setSendModal(null)
      }
    } catch (e) {
      setActionError(e.message)
      setSendModal(null)
    } finally {
      setActionState(prev => ({ ...prev, [recordId]: null }))
    }
  }, [sendModal])

  // Combined invoice send
  const [combinedSendModal, setCombinedSendModal] = useState(null) // { ids, aka, loading, data }

  const handleSendInvoice = useCallback(async (recordIds, aka) => {
    setCombinedSendModal({ ids: recordIds, aka, loading: true, data: null })
    try {
      const res = await fetch(`/api/admin/invoicing/send-combined?recordIds=${recordIds.join(',')}`)
      const data = await res.json()
      setCombinedSendModal({ ids: recordIds, aka, loading: false, data })
    } catch (e) {
      setActionError(e.message)
      setCombinedSendModal(null)
    }
  }, [])

  const handleConfirmSendInvoice = useCallback(async () => {
    if (!combinedSendModal) return
    const { ids } = combinedSendModal
    setCombinedSendModal(prev => ({ ...prev, loading: true }))
    try {
      const res = await fetch('/api/admin/invoicing/send-combined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds: ids }),
      })
      const data = await res.json()
      if (data.ok) {
        setRecords(prev => prev.map(r => ids.includes(r.id) ? { ...r, status: 'Sent' } : r))
        setCombinedSendModal(null)
      } else if (data.manual) {
        setCombinedSendModal(prev => ({ ...prev, loading: false, manual: data }))
      } else {
        setActionError(data.error || 'Send failed')
        setCombinedSendModal(null)
      }
    } catch (e) {
      setActionError(e.message)
      setCombinedSendModal(null)
    }
  }, [combinedSendModal])

  if (!isLoaded || !isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
        <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  const periodRecords = selectedPeriod
    ? records.filter(r => `${r.periodStart}|${r.periodEnd}` === selectedPeriod)
    : []

  const grouped = periodRecords.reduce((acc, r) => {
    if (!acc[r.aka]) acc[r.aka] = []
    acc[r.aka].push(r)
    return acc
  }, {})
  const sortedCreators = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
  const currentPeriod = periods.find(p => p.key === selectedPeriod)

  return (
    <div style={{ maxWidth: '1060px' }}>
      {/* Send confirmation modal (per-account, legacy) */}
      <SendModal
        data={sendModal}
        onConfirm={handleSendConfirm}
        onCancel={() => setSendModal(null)}
        sending={sendModal ? !!actionState[sendModal.recordId] : false}
      />

      {/* Combined send invoice modal */}
      {combinedSendModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '18px', boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
            padding: '28px 32px', width: '500px', maxWidth: '90vw',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>
              Send invoice to {combinedSendModal.aka}?
            </div>
            {combinedSendModal.loading ? (
              <div style={{ padding: '20px 0', color: '#999', fontSize: '13px' }}>Loading invoice details...</div>
            ) : combinedSendModal.manual ? (
              <div>
                <div style={{ fontSize: '13px', color: '#f87171', marginBottom: '12px', padding: '10px 14px', background: '#fef2f2', borderRadius: '8px' }}>
                  Resend API key not configured. Add RESEND_API_KEY to .env.local to enable email sending.
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setCombinedSendModal(null)} style={{
                    background: 'transparent', border: '1px solid #E8C4CC', borderRadius: '7px',
                    color: '#888', padding: '8px 18px', fontSize: '13px', cursor: 'pointer',
                  }}>Close</button>
                </div>
              </div>
            ) : combinedSendModal.data ? (
              <div>
                <div style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>
                  This will email all {combinedSendModal.ids.length} account invoices and mark them as Sent.
                </div>
                {[
                  { label: 'To', value: `josh@palmmanagement.com (test)` },
                  { label: 'From', value: 'evan@palmmanagement.com' },
                  { label: 'Period', value: `${fmtDate(combinedSendModal.data.periodStart)} – ${fmtDate(combinedSendModal.data.periodEnd)}` },
                  { label: 'Accounts', value: combinedSendModal.data.invoices?.map(i => i.accountName).join(', ') },
                  { label: 'Mgmt Fee', value: fmt(combinedSendModal.data.totalCommission) },
                ].map(row => (
                  <div key={row.label} style={{
                    display: 'flex', gap: '16px', padding: '8px 0',
                    borderBottom: '1px solid rgba(0,0,0,0.04)', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: '12px', color: '#999', width: '70px', flexShrink: 0 }}>{row.label}</span>
                    <span style={{ fontSize: '13px', color: '#4a4a4a' }}>{row.value}</span>
                  </div>
                ))}

                {!combinedSendModal.data.allHavePdfs && (
                  <div style={{ marginTop: '14px', padding: '10px 14px', background: '#fef3c7', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
                    Some accounts don't have PDFs generated yet. Generate all PDFs first.
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setCombinedSendModal(null)} style={{
                    background: 'transparent', border: '1px solid #E8C4CC', borderRadius: '7px',
                    color: '#888', padding: '8px 18px', fontSize: '13px', cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={handleConfirmSendInvoice}
                    disabled={!combinedSendModal.data.allHavePdfs}
                    style={{
                      background: combinedSendModal.data.allHavePdfs ? '#3b82f6' : '#e5e7eb',
                      border: 'none', borderRadius: '7px', color: '#fff',
                      padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                      cursor: combinedSendModal.data.allHavePdfs ? 'pointer' : 'not-allowed',
                    }}>
                    Send Invoice ✉
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Title */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Invoicing</h1>
        {currentPeriod && (
          <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>
            {fmtDate(currentPeriod.start)} – {fmtDate(currentPeriod.end)}, {new Date(currentPeriod.start + 'T12:00:00').getFullYear()}
            &nbsp;·&nbsp;{periodRecords.length} accounts
          </div>
        )}
      </div>

      {/* Period tabs */}
      {periods.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
          {periods.map(p => {
            const active = selectedPeriod === p.key
            return (
              <button key={p.key} onClick={() => setSelectedPeriod(p.key)} style={{
                background: active ? '#FFF0F3' : '#ffffff',
                border: active ? '1px solid #E88FAC' : 'none', boxShadow: active ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
                borderRadius: '6px', color: active ? '#E88FAC' : '#999',
                padding: '6px 14px', fontSize: '12px', fontWeight: active ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {fmtDate(p.start)} – {fmtDate(p.end)}
              </button>
            )
          })}
          <button onClick={load} style={{
            marginLeft: 'auto', background: 'transparent', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            borderRadius: '6px', color: '#3f3f46', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
          }}>
            ↺
          </button>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px', background: '#2d1515',
          border: '1px solid #5c2020', borderRadius: '8px', fontSize: '13px', color: '#f87171',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '16px' }}>×</button>
        </div>
      )}

      {loading && <div style={{ color: '#555', fontSize: '14px', padding: '40px 0' }}>Loading invoices...</div>}
      {error && (
        <div style={{ color: '#ff8888', fontSize: '14px', padding: '20px', background: '#2d1515', border: '1px solid #5c2020', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {!loading && periodRecords.length > 0 && (
        <>
          <SummaryBar records={periodRecords} />
          <TableHeader />
          {sortedCreators.map(aka => (
            <CreatorGroup
              key={aka} aka={aka} rows={grouped[aka]}
              onSave={handleSave}
              onBulkStatus={handleBulkStatus}
              onGenerate={handleGenerate}
              onSendClick={handleSendClick}
              onSendInvoice={handleSendInvoice}
              savingId={savingId}
              actionState={actionState}
            />
          ))}
        </>
      )}

      {!loading && !error && periodRecords.length === 0 && periods.length > 0 && (
        <div style={{ color: '#555', fontSize: '14px', padding: '60px 0', textAlign: 'center' }}>
          No invoice records for this period.
        </div>
      )}
    </div>
  )
}
