'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import InvoiceWorkflowModal from './InvoiceWorkflowModal'
import RawDataUpload from './RawDataUpload'

const STATUS_CONFIG = {
  Draft: { color: '#9ca3af', bg: 'rgba(255,255,255,0.04)', next: 'Sent' },
  Sent:  { color: '#78B4E8', bg: 'rgba(120, 180, 232, 0.08)', next: 'Paid' },
  Paid:  { color: '#7DD3A4', bg: 'rgba(125, 211, 164, 0.08)', next: 'Draft' },
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
            border: 'none', borderRadius: '7px', color: 'rgba(255,255,255,0.08)',
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
          background: 'rgba(232, 160, 160, 0.04)', border: '1px solid #E88FAC', borderRadius: '4px',
          color: 'rgba(255,255,255,0.08)', fontSize: '13px', padding: '4px 8px', width: '130px', outline: 'none',
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
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <span style={{
                  background: STATUS_CONFIG[record.status]?.bg || 'rgba(255,255,255,0.04)',
                  color: STATUS_CONFIG[record.status]?.color || '#999',
                  borderRadius: '20px', padding: '2px 10px', fontSize: '10px', fontWeight: 600,
                  letterSpacing: '0.03em',
                }}>{record.status}</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#9ca3af' }}>
              <span>Editable revenue:</span>
              <EarningsCell record={record} onSave={onSave} disabled={savingId === record.id} />
              {record.chatTeamCost > 0 && (
                <span>Chat fee: <span style={{ color: '#E8C878' }}>−{fmt(record.chatTeamCost)}</span></span>
              )}
            </div>
            <span style={{
              background: STATUS_CONFIG[record.status]?.bg || 'rgba(255,255,255,0.04)',
              color: STATUS_CONFIG[record.status]?.color || '#999',
              borderRadius: '20px', padding: '3px 12px', fontSize: '11px', fontWeight: 600,
              letterSpacing: '0.03em',
            }}>{record.status}</span>
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
  const sortedCreators = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
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
            return (
              <button key={p.key} onClick={() => setSelectedPeriod(p.key)} style={{
                background: active ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.08)',
                border: active ? '1px solid #E88FAC' : 'none', boxShadow: active ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
                borderRadius: '6px', color: active ? 'var(--palm-pink)' : '#999',
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

      {loading && <div style={{ color: 'rgba(240, 236, 232, 0.85)', fontSize: '14px', padding: '40px 0' }}>Loading invoices...</div>}
      {error && (
        <div style={{ color: '#ff8888', fontSize: '14px', padding: '20px', background: '#2d1515', border: '1px solid #5c2020', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {!loading && periodRecords.length > 0 && (
        <>
          <SummaryBar records={periodRecords} />
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
    </div>
  )
}
