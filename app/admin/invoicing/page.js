'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import InvoiceWorkflowModal from './InvoiceWorkflowModal'
import RawDataUpload from './RawDataUpload'

const STATUS_CONFIG = {
  Draft:   { color: '#9ca3af', bg: 'rgba(255,255,255,0.04)', next: 'Sent' },
  Sent:    { color: '#78B4E8', bg: 'rgba(120, 180, 232, 0.08)', next: 'Paid' },
  Partial: { color: '#E8C878', bg: 'rgba(232, 200, 120, 0.08)', next: 'Paid' },
  Paid:    { color: '#7DD3A4', bg: 'rgba(125, 211, 164, 0.08)', next: 'Draft' },
}

// Derive display status from underlying record (stored status + amountPaid)
// Airtable only stores Draft/Sent/Paid. "Partial" is derived client-side when
// amountPaid is between 0 and earnings.
function derivedStatus(record) {
  const raw = record.status || 'Draft'
  const paid = record.amountPaid || 0
  const total = record.totalCommission || 0 // what the creator owes Palm
  if (raw === 'Paid') return 'Paid'
  if (raw === 'Sent' && paid > 0 && paid < total) return 'Partial'
  return raw
}

const COLS = '160px 150px 130px 130px 130px 88px'

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
function groupStageKey(rows) {
  const allHavePdfs = rows.every(r => r.hasPdf)
  const allSent = rows.every(r => r.status === 'Sent' || r.status === 'Paid')
  const allPaid = rows.every(r => r.status === 'Paid')
  const anyPartial = rows.some(r => derivedStatus(r) === 'Partial')
  if (allPaid) return 'paid'
  if (anyPartial) return 'partial'
  if (allSent) return 'sent'
  if (allHavePdfs) return 'review'
  return 'generate'
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
        background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', borderRadius: '18px',
        padding: '28px 32px', width: '440px', maxWidth: '90vw',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '6px' }}>
          Send invoice to {data.aka}?
        </div>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '24px' }}>
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
            borderBottom: '1px solid transparent', alignItems: 'center',
          }}>
            <span style={{ fontSize: '12px', color: 'var(--foreground-muted)', width: '56px', flexShrink: 0 }}>{row.label}</span>
            <span style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)' }}>{row.value}</span>
          </div>
        ))}

        {data.dropboxLink && (
          <a href={data.dropboxLink} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '12px', color: 'var(--palm-pink)', display: 'inline-block', marginTop: '12px' }}>
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
            background: 'transparent', border: '1px solid transparent', borderRadius: '7px',
            color: 'var(--foreground-muted)', padding: '8px 18px', fontSize: '13px', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={sending || !data.email} style={{
            background: data.email ? '#78B4E8' : 'rgba(232, 160, 160, 0.06)',
            border: 'none', borderRadius: '7px', color: 'var(--foreground)',
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
          background: 'rgba(232, 160, 160, 0.04)', border: '1px solid transparent', borderRadius: '4px',
          color: 'var(--foreground)', fontSize: '13px', padding: '4px 8px', width: '130px', outline: 'none',
        }}
      />
    )
  }

  return (
    <button onClick={startEdit} disabled={disabled} title="Click to edit"
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
        border: '1px solid transparent', borderRadius: '4px',
        color: record.earnings > 0 ? '#e4e4e7' : 'rgba(240, 236, 232, 0.85)',
        fontSize: '13px', cursor: disabled ? 'default' : 'pointer',
        padding: '4px 8px', fontFamily: 'inherit', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'rgba(232, 160, 160, 0.06)' }}}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }}
    >
      {record.earnings > 0 ? fmt(record.earnings) : <span style={{ color: '#444' }}>—</span>}
      {!disabled && <span style={{ fontSize: '10px', color: '#444' }}>✎</span>}
    </button>
  )
}

// ── Inline payment editor ────────────────────────────────────────────────────
function PaymentCell({ record, onSave, disabled }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const paid = record.amountPaid || 0
  // Creator owes Palm the management fee (totalCommission), not the revenue
  const total = record.totalCommission || 0
  const remaining = Math.max(0, total - paid)

  function startEdit() {
    if (disabled) return
    setValue(paid === 0 ? '' : String(paid))
    setEditing(true)
  }

  async function commit() {
    const num = parseFloat(value)
    if (!isNaN(num) && num !== paid) {
      // Auto-update status based on amount vs mgmt fee owed
      const fields = { amountPaid: num }
      if (num >= total && total > 0) fields.status = 'Paid'
      else if (num > 0) fields.status = 'Sent' // will display as Partial via derivedStatus
      else fields.status = 'Sent'
      await onSave(record.id, fields)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input autoFocus type="number" step="0.01" value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          background: 'rgba(232, 200, 120, 0.04)', border: '1px solid #E8C87844', borderRadius: '4px',
          color: 'var(--foreground)', fontSize: '12px', padding: '3px 8px', width: '100px', outline: 'none',
        }}
      />
    )
  }

  return (
    <button onClick={startEdit} disabled={disabled} title="Click to log a payment"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent',
        border: '1px solid transparent', borderRadius: '4px',
        color: paid > 0 ? '#E8C878' : '#9ca3af',
        fontSize: '12px', cursor: disabled ? 'default' : 'pointer',
        padding: '3px 8px', fontFamily: 'inherit', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'rgba(232, 200, 120, 0.06)' }}}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {paid > 0 ? (
        <>
          <span>{fmt(paid)} paid</span>
          {remaining > 0 && <span style={{ color: '#9ca3af' }}>· {fmt(remaining)} left</span>}
        </>
      ) : (
        <span style={{ fontSize: '11px' }}>+ Log payment</span>
      )}
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
        { label: 'Total Revenue', value: fmt(total.tr), color: 'var(--foreground)' },
        { label: 'Total Commission', value: fmt(total.commission), color: 'var(--palm-pink)' },
        { label: 'Chat Team Cost', value: fmt(total.chat), color: '#E8C878' },
        { label: 'Net Profit', value: fmt(total.net), color: '#7DD3A4' },
      ].map(s => (
        <div key={s.label} style={{
          background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
          padding: '14px 18px', minWidth: '130px', flex: '1 1 0',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
            {s.label}
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.value}</div>
        </div>
      ))}
      <div style={{ background: 'var(--card-bg-solid)', border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', padding: '14px 18px', minWidth: '110px' }}>
        <div style={{ fontSize: '10px', color: 'var(--foreground-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Status</div>
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

// ── Creator group card ───────────────────────────────────────────────────────
const STAGE_CONFIG = {
  generate: { label: 'Generate',  dot: '#9ca3af', bg: 'rgba(255,255,255,0.04)', fg: '#6b7280' },
  review:   { label: 'Review',    dot: 'var(--palm-pink)', bg: 'rgba(232, 160, 160, 0.06)', fg: '#b4586f' },
  send:     { label: 'Ready',     dot: '#78B4E8', bg: 'rgba(120, 180, 232, 0.08)', fg: '#1d4ed8' },
  sent:     { label: 'Sent',      dot: '#78B4E8', bg: 'rgba(120, 180, 232, 0.08)', fg: '#1d4ed8' },
  partial:  { label: 'Partial',   dot: '#E8C878', bg: 'rgba(232, 200, 120, 0.08)', fg: '#a16207' },
  paid:     { label: 'Paid',      dot: '#7DD3A4', bg: 'rgba(125, 211, 164, 0.08)', fg: '#15803d' },
}

function CreatorGroup({ aka, rows, onSave, onBulkStatus, onOpenWorkflow, savingId }) {
  const commissionPct = rows[0]?.commissionPct || 0
  const totalTr = rows.reduce((s, r) => s + (r.earnings || 0), 0)
  const totalFee = rows.reduce((s, r) => s + (r.totalCommission || 0), 0)
  const totalChat = rows.reduce((s, r) => s + (r.chatTeamCost || 0), 0)
  const totalNet = rows.reduce((s, r) => s + (r.netProfit || 0), 0)
  const dueDate = rows[0]?.dueDate
  const periodStart = rows[0]?.periodStart
  const periodEnd = rows[0]?.periodEnd
  const allHavePdfs = rows.every(r => r.hasPdf)
  const allSent = rows.every(r => r.status === 'Sent' || r.status === 'Paid')
  const allPaid = rows.every(r => r.status === 'Paid')
  const sorted = [...rows].sort((a, b) => accountRank(a.accountName) - accountRank(b.accountName))

  // Determine stage
  let stageKey = 'generate'
  if (allPaid) stageKey = 'paid'
  else if (allSent) stageKey = 'sent'
  else if (allHavePdfs) stageKey = 'review'
  const stage = STAGE_CONFIG[stageKey]

  // Shared-status bulk button
  const allSame = rows.every(r => r.status === rows[0]?.status)
  const currentStatus = allSame ? rows[0]?.status : null
  const nextStatus = currentStatus ? STATUS_CONFIG[currentStatus]?.next : null
  const ids = rows.map(r => r.id)

  return (
    <div style={{
      background: 'var(--card-bg-solid)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px',
      marginBottom: '14px', overflow: 'hidden',
    }}>
      {/* ─── Top: name + period + stage + primary action ───────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '18px 22px 14px', gap: '16px',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>
              {aka}
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px',
              background: stage.bg, color: stage.fg,
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: stage.dot }} />
              {stage.label}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>
            {periodStart && periodEnd ? `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}` : null}
            {dueDate ? `  ·  Due ${fmtDate(dueDate)}` : null}
            {`  ·  ${pct(commissionPct)} commission`}
            {rows.length > 1 ? `  ·  ${rows.length} accounts` : null}
          </div>
        </div>

        {/* Primary action + secondary bulk status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {currentStatus && nextStatus ? (
            <button onClick={() => onBulkStatus(ids, nextStatus)} style={{
              background: 'transparent', border: 'none',
              color: '#9ca3af', fontSize: '12px', fontWeight: 500, padding: '6px 8px',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--palm-pink)'}
              onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}
            >
              Mark All {nextStatus}
            </button>
          ) : null}
          <button onClick={() => onOpenWorkflow(aka, rows)} style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px',
            color: 'var(--foreground)', fontSize: '12px', fontWeight: 600, padding: '8px 16px',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            Manage →
          </button>
        </div>
      </div>

      {/* ─── KPI blocks: Revenue · Mgmt Fee · Net Profit ─────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px',
        background: 'rgba(255,255,255,0.05)', margin: '0 22px',
        borderRadius: '10px', overflow: 'hidden',
      }}>
        {[
          { label: 'Revenue',    value: totalTr,  color: 'var(--foreground)' },
          { label: 'Mgmt Fee',   value: totalFee, color: 'var(--palm-pink)' },
          { label: 'Net Profit', value: totalNet, color: '#7DD3A4' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--card-bg-solid)', padding: '12px 14px' }}>
            <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {k.label}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: k.color, marginTop: '2px' }}>
              {fmt(k.value)}
            </div>
          </div>
        ))}
      </div>

      {/* ─── Account breakdown (only when multi-account) ─────────────── */}
      {sorted.length > 1 && (
        <div style={{ padding: '8px 22px 6px', marginTop: '12px' }}>
          <div style={{
            fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em',
            fontWeight: 600, marginBottom: '4px',
          }}>
            Accounts
          </div>
          {sorted.map(record => (
            <div key={record.id} style={{
              display: 'grid', gridTemplateColumns: '140px 1fr 120px 120px 120px 90px',
              alignItems: 'center', gap: '12px', padding: '8px 0',
              borderBottom: '1px solid transparent',
            }}>
              <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', fontWeight: 500 }}>
                {record.accountName.replace(aka + ' - ', '')}
              </div>
              <EarningsCell record={record} onSave={onSave} disabled={savingId === record.id} />
              <div style={{ fontSize: '12px', color: record.totalCommission > 0 ? 'var(--palm-pink)' : '#bbb', textAlign: 'right' }}>
                {fmt(record.totalCommission)}
              </div>
              <div style={{ fontSize: '12px', color: record.chatTeamCost > 0 ? '#E8C878' : '#bbb', textAlign: 'right' }}>
                {record.chatTeamCost > 0 ? '− ' + fmt(record.chatTeamCost) : '—'}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: record.netProfit > 0 ? '#7DD3A4' : '#bbb', textAlign: 'right' }}>
                {fmt(record.netProfit)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                {(() => { const d = derivedStatus(record); return (
                  <span style={{
                    background: STATUS_CONFIG[d]?.bg || 'rgba(255,255,255,0.04)',
                    color: STATUS_CONFIG[d]?.color || '#999',
                    borderRadius: '20px', padding: '2px 10px', fontSize: '10px', fontWeight: 600,
                    letterSpacing: '0.03em',
                  }}>{d}</span>
                )})()}
                {record.status !== 'Draft' && (
                  <PaymentCell record={record} onSave={onSave} disabled={savingId === record.id} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Single-account: just show editable earnings + status inline with small footer row */}
      {sorted.length === 1 && (() => {
        const record = sorted[0]
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 22px 16px', marginTop: '4px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#9ca3af', flexWrap: 'wrap' }}>
              <span>Editable revenue:</span>
              <EarningsCell record={record} onSave={onSave} disabled={savingId === record.id} />
              {record.chatTeamCost > 0 && (
                <span>Chat fee: <span style={{ color: '#E8C878' }}>−{fmt(record.chatTeamCost)}</span></span>
              )}
              {record.status !== 'Draft' && (
                <PaymentCell record={record} onSave={onSave} disabled={savingId === record.id} />
              )}
            </div>
            {(() => { const d = derivedStatus(record); return (
              <span style={{
                background: STATUS_CONFIG[d]?.bg || 'rgba(255,255,255,0.04)',
                color: STATUS_CONFIG[d]?.color || '#999',
                borderRadius: '20px', padding: '3px 12px', fontSize: '11px', fontWeight: 600,
                letterSpacing: '0.03em',
              }}>{d}</span>
            )})()}
          </div>
        )
      })()}

      {/* Bottom spacer for multi-account to keep breathing room */}
      {sorted.length > 1 && <div style={{ height: '10px' }} />}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function InvoicingPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  const [records, setRecords] = useState([])
  const [periods, setPeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [workflowModal, setWorkflowModal] = useState(null) // { aka, rows }
  const [statusFilter, setStatusFilter] = useState('all') // all | draft | sent | paid
  const [loadedPeriods, setLoadedPeriods] = useState(new Set()) // period keys whose full records are loaded
  const [periodLoading, setPeriodLoading] = useState(null) // period key currently loading
  // Generate-invoices flow (replaces Airtable scheduled automation)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [generatePreview, setGeneratePreview] = useState(null) // dryRun result
  const [generateResult, setGenerateResult] = useState(null) // real-run result
  const [generateError, setGenerateError] = useState(null)
  // Populate-from-earnings flow (auto-fill Earnings (TR) for current period from Sheets)
  const [populateOpen, setPopulateOpen] = useState(false)
  const [populateLoading, setPopulateLoading] = useState(false)
  const [populatePreview, setPopulatePreview] = useState(null)
  const [populateResult, setPopulateResult] = useState(null)
  const [populateError, setPopulateError] = useState(null)
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'invoices')
  useEffect(() => { const t = searchParams.get('tab'); if (t) setActiveTab(t) }, [searchParams])

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin'

  useEffect(() => {
    if (!isLoaded) return
    if (!isAdmin) router.replace('/dashboard')
  }, [isLoaded, isAdmin, router])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Default: fetches only most recent period's records + full period list
      const res = await fetch('/api/admin/invoicing')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setRecords(data.records)
      setPeriods(data.periods)
      if (data.periods.length > 0 && !selectedPeriod) {
        setSelectedPeriod(data.periods[0].key)
        setLoadedPeriods(new Set([data.periods[0].key]))
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [selectedPeriod])

  useEffect(() => { load() }, [])

  // Lazy-load a specific period's records when user clicks its tab
  const loadPeriod = useCallback(async (periodKey) => {
    if (loadedPeriods.has(periodKey)) return
    setPeriodLoading(periodKey)
    try {
      const res = await fetch(`/api/admin/invoicing?mode=period&period=${encodeURIComponent(periodKey)}`)
      if (!res.ok) throw new Error('Failed to load period')
      const data = await res.json()
      // Merge new records with existing (dedupe by id)
      setRecords(prev => {
        const existingIds = new Set(prev.map(r => r.id))
        const merged = [...prev]
        for (const r of data.records) if (!existingIds.has(r.id)) merged.push(r)
        return merged
      })
      setLoadedPeriods(prev => new Set(prev).add(periodKey))
    } catch (e) { setError(e.message) }
    finally { setPeriodLoading(null) }
  }, [loadedPeriods])

  // When selected period changes, ensure it's loaded
  useEffect(() => {
    if (selectedPeriod && !loadedPeriods.has(selectedPeriod)) {
      loadPeriod(selectedPeriod)
    }
  }, [selectedPeriod, loadedPeriods, loadPeriod])

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
        if (fields.amountPaid !== undefined) u.amountPaid = fields.amountPaid
        return u
      }))
    } catch (e) { console.error(e) }
    finally { setSavingId(null) }
  }, [])

  // Generate-invoices handlers
  const openGenerate = useCallback(async () => {
    setGenerateOpen(true)
    setGenerateLoading(true)
    setGenerateError(null)
    setGeneratePreview(null)
    setGenerateResult(null)
    try {
      const res = await fetch('/api/cron/generate-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Dry run failed')
      setGeneratePreview(data)
    } catch (e) { setGenerateError(e.message) }
    finally { setGenerateLoading(false) }
  }, [])

  const confirmGenerate = useCallback(async () => {
    if (!generatePreview) return
    setGenerateLoading(true)
    setGenerateError(null)
    try {
      const res = await fetch('/api/cron/generate-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: generatePreview.period.start,
          periodEnd: generatePreview.period.end,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setGenerateResult(data)
      // Refresh invoices list so new rows appear
      load()
    } catch (e) { setGenerateError(e.message) }
    finally { setGenerateLoading(false) }
  }, [generatePreview, load])

  // Populate-from-earnings: read selected period's invoices, fill Earnings (TR) from Google Sheets
  const openPopulate = useCallback(async () => {
    setPopulateOpen(true)
    setPopulateLoading(true)
    setPopulateError(null)
    setPopulatePreview(null)
    setPopulateResult(null)
    try {
      const [start, end] = (selectedPeriod || '|').split('|')
      if (!start || !end) throw new Error('No period selected')
      const res = await fetch('/api/admin/invoicing/refresh-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodStart: start, periodEnd: end, dryRun: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setPopulatePreview(data)
    } catch (e) { setPopulateError(e.message) }
    finally { setPopulateLoading(false) }
  }, [selectedPeriod])

  const confirmPopulate = useCallback(async () => {
    if (!populatePreview) return
    setPopulateLoading(true)
    setPopulateError(null)
    try {
      const res = await fetch('/api/admin/invoicing/refresh-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: populatePreview.periodStart,
          periodEnd: populatePreview.periodEnd,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Populate failed')
      setPopulateResult(data)
      load()
    } catch (e) { setPopulateError(e.message) }
    finally { setPopulateLoading(false) }
  }, [populatePreview, load])

  // Bulk status update — mark all records for a creator as Sent/Paid
  const handleBulkStatus = useCallback(async (recordIds, status) => {
    for (const id of recordIds) {
      setSavingId(id)
      try {
        // When marking Paid, also set amountPaid = earnings so remaining goes to $0
        const rec = records.find(r => r.id === id)
        const fields = { status }
        if (status === 'Paid' && rec) fields.amountPaid = rec.totalCommission || 0
        if (status === 'Draft') fields.amountPaid = 0
        const res = await fetch('/api/admin/invoicing', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: id, fields }),
        })
        if (res.ok) {
          setRecords(prev => prev.map(r => r.id === id ? {
            ...r,
            status,
            amountPaid: fields.amountPaid !== undefined ? fields.amountPaid : r.amountPaid,
          } : r))
        }
      } catch (e) { console.error(e) }
    }
    setSavingId(null)
  }, [records])

  if (!isLoaded || !isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
        <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px' }}>Loading...</div>
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

  // Count groups per status bucket (stage-based)
  const statusCounts = { all: 0, draft: 0, sent: 0, partial: 0, paid: 0 }
  for (const aka of Object.keys(grouped)) {
    statusCounts.all++
    const stage = groupStageKey(grouped[aka])
    if (stage === 'generate' || stage === 'review') statusCounts.draft++
    else if (stage === 'sent') statusCounts.sent++
    else if (stage === 'partial') statusCounts.partial++
    else if (stage === 'paid') statusCounts.paid++
  }

  const sortedCreators = Object.keys(grouped)
    .filter(aka => {
      if (statusFilter === 'all') return true
      const stage = groupStageKey(grouped[aka])
      if (statusFilter === 'draft') return stage === 'generate' || stage === 'review'
      if (statusFilter === 'sent') return stage === 'sent'
      if (statusFilter === 'partial') return stage === 'partial'
      if (statusFilter === 'paid') return stage === 'paid'
      return true
    })
    .sort((a, b) => a.localeCompare(b))
  const currentPeriod = periods.find(p => p.key === selectedPeriod)

  return (
    <div>
      {/* Workflow modal */}
      {workflowModal && (() => {
        const liveRows = periodRecords.filter(r => r.aka === workflowModal.aka)
        return liveRows.length > 0 ? (
          <InvoiceWorkflowModal
            aka={workflowModal.aka}
            rows={liveRows}
            onClose={() => setWorkflowModal(null)}
            onRecordsUpdate={setRecords}
          />
        ) : null
      })()}

      {/* Title + Tab switcher */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Invoicing</h1>
        <div style={{ display: 'flex', gap: '4px', marginTop: '12px' }}>
          {[
            { key: 'invoices', label: 'Invoices' },
            { key: 'upload', label: 'Raw Data Upload' },
          ].map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); router.replace(`${pathname}?tab=${tab.key}`, { scroll: false }) }}
              style={{
                background: activeTab === tab.key ? 'rgba(232, 160, 160, 0.06)' : 'transparent',
                border: activeTab === tab.key ? '1px solid #E88FAC' : '1px solid transparent',
                borderRadius: '6px', color: activeTab === tab.key ? 'var(--palm-pink)' : '#999',
                padding: '6px 14px', fontSize: '13px', fontWeight: activeTab === tab.key ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Raw Data Upload tab */}
      {activeTab === 'upload' && <RawDataUpload />}

      {/* Invoices tab */}
      {activeTab === 'invoices' && (<div>
      <div style={{ marginBottom: '20px' }}>
        {currentPeriod && (
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
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
            const isLoading = periodLoading === p.key
            const notYetLoaded = !loadedPeriods.has(p.key)
            return (
              <button key={p.key} onClick={() => setSelectedPeriod(p.key)} style={{
                background: active ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.08)',
                border: active ? '1px solid #E88FAC' : 'none', boxShadow: active ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
                borderRadius: '6px', color: active ? 'var(--palm-pink)' : '#999',
                padding: '6px 14px', fontSize: '12px', fontWeight: active ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
                opacity: notYetLoaded && !active ? 0.7 : 1,
                display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}>
                {fmtDate(p.start)} – {fmtDate(p.end)}
                {isLoading && <span style={{ fontSize: '10px', opacity: 0.6 }}>…</span>}
              </button>
            )
          })}
          <button onClick={openPopulate} disabled={!selectedPeriod} style={{
            marginLeft: 'auto', background: 'rgba(125, 211, 164, 0.08)', border: '1px solid #7DD3A4',
            borderRadius: '6px', color: '#15803d', padding: '6px 14px', fontSize: '12px', fontWeight: 600,
            cursor: selectedPeriod ? 'pointer' : 'not-allowed', opacity: selectedPeriod ? 1 : 0.5,
          }} title="Read earnings from Google Sheets and auto-fill Earnings (TR) for every invoice in the selected period that doesn't have a PDF yet">
            ↻ Populate from earnings
          </button>
          <button onClick={openGenerate} style={{
            background: 'rgba(232, 160, 160, 0.06)', border: '1px solid #E88FAC',
            borderRadius: '6px', color: 'var(--palm-pink)', padding: '6px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }} title="Create placeholder invoices for the most recent pay period">
            + Generate invoices
          </button>
          <button onClick={load} style={{
            background: 'transparent', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            borderRadius: '6px', color: 'var(--foreground-muted)', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
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

      {loading && <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading invoices...</div>}
      {error && (
        <div style={{ color: '#ff8888', fontSize: '14px', padding: '20px', background: '#2d1515', border: '1px solid #5c2020', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {!loading && periodLoading === selectedPeriod && periodRecords.length === 0 && (
        <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading period…</div>
      )}

      {!loading && periodRecords.length > 0 && (
        <>
          <SummaryBar records={periodRecords} />
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'All', color: '#e4e4e7' },
              { key: 'draft', label: 'Draft', color: '#9ca3af' },
              { key: 'sent', label: 'Sent', color: '#78B4E8' },
              { key: 'partial', label: 'Partial', color: '#E8C878' },
              { key: 'paid', label: 'Paid', color: '#7DD3A4' },
            ].map(f => {
              const active = statusFilter === f.key
              const count = statusCounts[f.key]
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} style={{
                  background: active ? `${f.color}14` : 'rgba(255,255,255,0.04)',
                  border: active ? `1px solid ${f.color}66` : '1px solid transparent',
                  borderRadius: '6px', color: active ? f.color : '#9ca3af',
                  padding: '5px 12px', fontSize: '12px', fontWeight: active ? 600 : 500,
                  cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.02em',
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                }}>
                  {f.label}
                  <span style={{ fontSize: '11px', opacity: 0.65 }}>{count}</span>
                </button>
              )
            })}
          </div>
          {sortedCreators.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: '13px', padding: '40px 0', textAlign: 'center' }}>
              No {statusFilter} invoices in this period.
            </div>
          )}
          {sortedCreators.map(aka => (
            <CreatorGroup
              key={aka} aka={aka} rows={grouped[aka]}
              onSave={handleSave}
              onBulkStatus={handleBulkStatus}
              onOpenWorkflow={(a, r) => setWorkflowModal({ aka: a, rows: r })}
              savingId={savingId}
            />
          ))}
        </>
      )}

      {!loading && !error && periodRecords.length === 0 && periods.length > 0 && (
        <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '60px 0', textAlign: 'center' }}>
          No invoice records for this period.
        </div>
      )}
      </div>)}

      {/* Generate-invoices modal */}
      {generateOpen && (
        <div onClick={() => !generateLoading && setGenerateOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '12px',
            padding: '24px', width: 'min(560px, 92vw)', maxHeight: '85vh', overflow: 'auto',
            color: 'var(--foreground)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                {generateResult ? 'Done' : 'Generate invoices'}
              </h2>
              <button onClick={() => setGenerateOpen(false)} disabled={generateLoading} style={{
                background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer',
              }}>×</button>
            </div>

            {generateError && (
              <div style={{ padding: '10px 14px', background: '#2d1515', border: '1px solid #5c2020',
                borderRadius: '8px', fontSize: '13px', color: '#f87171', marginBottom: '14px' }}>
                {generateError}
              </div>
            )}

            {generateLoading && !generatePreview && (
              <div style={{ color: '#9ca3af', fontSize: '13px' }}>Checking what needs to be created…</div>
            )}

            {/* Preview state — show what would happen, ask for confirmation */}
            {generatePreview && !generateResult && (
              <>
                <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '14px' }}>
                  Pay period <strong style={{ color: 'var(--foreground)' }}>
                    {generatePreview.period.start} → {generatePreview.period.end}
                  </strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  <KPI label="Active accounts" value={generatePreview.totalActiveAccounts} />
                  <KPI label="Will create" value={generatePreview.details.created.length} accent="#7DD3A4" />
                  <KPI label="Will skip" value={generatePreview.details.skipped.length} accent="#9ca3af" />
                </div>
                {generatePreview.details.created.length > 0 && (
                  <DetailList title="To be created" items={generatePreview.details.created.map(c => {
                    const base = `${c.accountName} — ${(c.commission * 100).toFixed(0)}% commission`
                    return c.partialPeriodNote ? `${base}  ⚠︎ ${c.partialPeriodNote}` : base
                  })} />
                )}
                {generatePreview.details.warnings && generatePreview.details.warnings.length > 0 && (
                  <div style={{ padding: '10px 14px', background: '#2a2010', border: '1px solid #5c4520',
                    borderRadius: '8px', fontSize: '12.5px', color: '#E8C878', marginBottom: '14px' }}>
                    <strong>Partial-period notice:</strong> some creators started mid-period and need their earnings prorated manually after creation.
                  </div>
                )}
                {generatePreview.details.skipped.length > 0 && (
                  <DetailList title="Skipped" items={generatePreview.details.skipped.map(s =>
                    `${s.accountName} — ${s.reason}`
                  )} muted />
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button onClick={() => setGenerateOpen(false)} disabled={generateLoading} style={{
                    background: 'transparent', border: '1px solid #333', color: '#aaa',
                    padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={confirmGenerate} disabled={generateLoading || generatePreview.details.created.length === 0} style={{
                    background: 'var(--palm-pink)', border: 'none', color: '#1a1a1a',
                    padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                    cursor: generateLoading ? 'wait' : 'pointer',
                    opacity: generatePreview.details.created.length === 0 ? 0.5 : 1,
                  }}>
                    {generateLoading ? 'Creating…' : `Create ${generatePreview.details.created.length} invoice${generatePreview.details.created.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}

            {/* Result state — confirmation of what was actually created */}
            {generateResult && (
              <>
                <div style={{ padding: '14px', background: '#0f2618', border: '1px solid #1f4d2f',
                  borderRadius: '8px', fontSize: '13px', color: '#7DD3A4', marginBottom: '14px' }}>
                  Created {generateResult.createdCount} invoice{generateResult.createdCount === 1 ? '' : 's'} for {generateResult.period.start} → {generateResult.period.end}.
                </div>
                {generateResult.details.created.length > 0 && (
                  <DetailList title="Created" items={generateResult.details.created.map(c =>
                    c.partialPeriodNote ? `${c.accountName}  ⚠︎ ${c.partialPeriodNote}` : c.accountName
                  )} />
                )}
                {generateResult.details.warnings && generateResult.details.warnings.length > 0 && (
                  <div style={{ padding: '10px 14px', background: '#2a2010', border: '1px solid #5c4520',
                    borderRadius: '8px', fontSize: '12.5px', color: '#E8C878', marginBottom: '14px' }}>
                    <strong>Action needed:</strong> {generateResult.details.warnings.length} creator(s) started mid-period — open each invoice and adjust earnings before sending.
                  </div>
                )}
                {generateResult.details.skipped.length > 0 && (
                  <DetailList title="Skipped" items={generateResult.details.skipped.map(s =>
                    `${s.accountName} — ${s.reason}`
                  )} muted />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button onClick={() => setGenerateOpen(false)} style={{
                    background: 'var(--palm-pink)', border: 'none', color: '#1a1a1a',
                    padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  }}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Populate-from-earnings modal */}
      {populateOpen && (
        <div onClick={() => !populateLoading && setPopulateOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '12px',
            padding: '24px', width: 'min(640px, 92vw)', maxHeight: '85vh', overflow: 'auto',
            color: 'var(--foreground)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                {populateResult ? 'Done' : 'Populate from earnings'}
              </h2>
              <button onClick={() => setPopulateOpen(false)} disabled={populateLoading} style={{
                background: 'none', border: 'none', color: '#999', fontSize: '20px', cursor: 'pointer',
              }}>×</button>
            </div>

            {populateError && (
              <div style={{ padding: '10px 14px', background: '#2d1515', border: '1px solid #5c2020',
                borderRadius: '8px', fontSize: '13px', color: '#f87171', marginBottom: '14px' }}>
                {populateError}
              </div>
            )}

            {populateLoading && !populatePreview && !populateResult && (
              <div style={{ color: '#9ca3af', fontSize: '13px' }}>Reading earnings from Google Sheets…</div>
            )}

            {populatePreview && !populateResult && (
              <>
                <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '14px' }}>
                  Pay period <strong style={{ color: 'var(--foreground)' }}>
                    {populatePreview.periodStart} → {populatePreview.periodEnd}
                  </strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  <KPI label="Total invoices" value={populatePreview.total} />
                  <KPI label="Will populate" value={populatePreview.eligible} accent="#7DD3A4" />
                  <KPI label="Locked (has PDF)" value={populatePreview.skippedPdf} accent="#9ca3af" />
                </div>
                <DetailList title="Will populate (net revenue from Sheets)" items={
                  (populatePreview.results || []).map(r => {
                    if (r.error) return `${r.aka || r.id} — ❌ ${r.error}`
                    if (r.warning) return `${r.aka || r.accountName} — ⚠ ${r.warning}`
                    const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    const parts = [
                      `${r.accountName}: ${fmt(r.earningsNet)}`,
                      r.txnCount ? `(${r.txnCount} txns)` : '(no data)',
                    ]
                    if (r.chargebackNet < 0) parts.push(`incl. ${fmt(r.chargebackNet)} chargebacks`)
                    if (r.missingTab) parts.push('⚠ tab missing')
                    if (r.effectiveStartDate !== r.periodStart) parts.push(`from ${r.effectiveStartDate}`)
                    return parts.join('  ')
                  })
                } />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button onClick={() => setPopulateOpen(false)} disabled={populateLoading} style={{
                    background: 'transparent', border: '1px solid #333', color: '#aaa',
                    padding: '8px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={confirmPopulate} disabled={populateLoading || populatePreview.eligible === 0} style={{
                    background: '#7DD3A4', border: 'none', color: '#1a1a1a',
                    padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                    cursor: populateLoading ? 'wait' : 'pointer',
                    opacity: populatePreview.eligible === 0 ? 0.5 : 1,
                  }}>
                    {populateLoading ? 'Populating…' : `Populate ${populatePreview.eligible} invoice${populatePreview.eligible === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}

            {populateResult && (
              <>
                <div style={{ padding: '14px', background: '#0f2618', border: '1px solid #1f4d2f',
                  borderRadius: '8px', fontSize: '13px', color: '#7DD3A4', marginBottom: '14px' }}>
                  Populated {populateResult.populated} invoice{populateResult.populated === 1 ? '' : 's'} for {populateResult.periodStart} → {populateResult.periodEnd}.
                  {populateResult.errors > 0 ? `  ${populateResult.errors} error${populateResult.errors === 1 ? '' : 's'}.` : ''}
                </div>
                {populateResult.errors > 0 && (
                  <DetailList title="Errors" items={
                    (populateResult.results || []).filter(r => r.error).map(r => `${r.aka || r.accountName || r.id} — ${r.error}`)
                  } muted />
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button onClick={() => setPopulateOpen(false)} style={{
                    background: '#7DD3A4', border: 'none', color: '#1a1a1a',
                    padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  }}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, accent }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px' }}>
      <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: accent || 'var(--foreground)', marginTop: '2px' }}>{value}</div>
    </div>
  )
}

function DetailList({ title, items, muted }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: muted ? '#9ca3af' : 'var(--foreground)', lineHeight: 1.7 }}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}
