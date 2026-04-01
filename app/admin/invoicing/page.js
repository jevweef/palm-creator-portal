'use client'

import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'

const STATUS_CONFIG = {
  Draft:  { color: '#71717a', bg: '#1c1c1c', next: 'Sent' },
  Sent:   { color: '#3b82f6', bg: '#0f1f3d', next: 'Paid' },
  Paid:   { color: '#22c55e', bg: '#0f2d1a', next: 'Draft' },
}

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(n) {
  return Math.round(n * 100) + '%'
}

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`
}

function accountRank(name) {
  if (name.includes('Free OF')) return 1
  if (name.includes('VIP OF')) return 2
  if (name.includes('Fansly')) return 3
  return 4
}

function StatusPill({ status, saving, onClick }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.Draft
  return (
    <button
      onClick={onClick}
      disabled={saving}
      title={`Click to mark as ${cfg.next}`}
      style={{
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.color}44`,
        borderRadius: '20px',
        padding: '3px 10px',
        fontSize: '11px',
        fontWeight: 600,
        cursor: saving ? 'not-allowed' : 'pointer',
        opacity: saving ? 0.5 : 1,
        whiteSpace: 'nowrap',
        transition: 'opacity 0.15s',
        letterSpacing: '0.03em',
      }}
    >
      {saving ? '...' : status}
    </button>
  )
}

function EarningsCell({ record, onSave, saving }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  function startEdit() {
    setValue(record.earnings === 0 ? '' : String(record.earnings))
    setEditing(true)
  }

  async function commit() {
    const num = parseFloat(value)
    if (!isNaN(num) && num !== record.earnings) {
      await onSave(record.id, { earnings: num })
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        step="0.01"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          background: '#1a1a2e',
          border: '1px solid #a78bfa',
          borderRadius: '4px',
          color: '#fff',
          fontSize: '13px',
          padding: '4px 8px',
          width: '130px',
          outline: 'none',
        }}
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      disabled={saving}
      title="Click to edit"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: '4px',
        color: record.earnings > 0 ? '#e4e4e7' : '#555',
        fontSize: '13px',
        cursor: 'pointer',
        padding: '4px 8px',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#1a1a1a' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent' }}
    >
      {record.earnings > 0 ? fmt(record.earnings) : <span style={{ color: '#444' }}>—</span>}
      <span style={{ fontSize: '10px', color: '#444', lineHeight: 1 }}>✎</span>
    </button>
  )
}

function SummaryBar({ records }) {
  const total = records.reduce((s, r) => ({
    tr: s.tr + (r.earnings || 0),
    commission: s.commission + (r.totalCommission || 0),
    chat: s.chat + (r.chatTeamCost || 0),
    net: s.net + (r.netProfit || 0),
  }), { tr: 0, commission: 0, chat: 0, net: 0 })

  const byStatus = records.reduce((s, r) => {
    s[r.status] = (s[r.status] || 0) + 1
    return s
  }, {})

  return (
    <div style={{
      display: 'flex',
      gap: '16px',
      marginBottom: '24px',
      flexWrap: 'wrap',
    }}>
      {[
        { label: 'Total Revenue', value: fmt(total.tr), color: '#fff' },
        { label: 'Total Commission', value: fmt(total.commission), color: '#a78bfa' },
        { label: 'Chat Team Cost', value: fmt(total.chat), color: '#f59e0b' },
        { label: 'Net Profit', value: fmt(total.net), color: '#22c55e' },
      ].map(s => (
        <div key={s.label} style={{
          background: '#111',
          border: '1px solid #222',
          borderRadius: '10px',
          padding: '16px 20px',
          minWidth: '140px',
          flex: '1 1 0',
        }}>
          <div style={{ fontSize: '11px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
            {s.label}
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
        </div>
      ))}
      <div style={{
        background: '#111',
        border: '1px solid #222',
        borderRadius: '10px',
        padding: '16px 20px',
        minWidth: '120px',
      }}>
        <div style={{ fontSize: '11px', color: '#71717a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
          Status
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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

function CreatorGroup({ aka, rows, onSave, saving, savingId }) {
  const commissionPct = rows[0]?.commissionPct || 0
  const totalTr = rows.reduce((s, r) => s + (r.earnings || 0), 0)
  const totalNet = rows.reduce((s, r) => s + (r.netProfit || 0), 0)
  const dueDate = rows[0]?.dueDate

  const sorted = [...rows].sort((a, b) => accountRank(a.accountName) - accountRank(b.accountName))

  return (
    <div style={{
      background: '#111',
      border: '1px solid #222',
      borderRadius: '10px',
      marginBottom: '12px',
      overflow: 'hidden',
    }}>
      {/* Creator header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid #1a1a1a',
        background: '#141414',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{aka}</span>
          <span style={{ fontSize: '12px', color: '#71717a' }}>
            {pct(commissionPct)} commission • {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
          </span>
          {dueDate && (
            <span style={{ fontSize: '11px', color: '#4b5563', background: '#1a1a1a', padding: '2px 8px', borderRadius: '4px' }}>
              Due {fmtDate(dueDate)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
          <span style={{ color: '#71717a' }}>TR: <span style={{ color: totalTr > 0 ? '#d4d4d8' : '#555' }}>{fmt(totalTr)}</span></span>
          <span style={{ color: '#71717a' }}>Net: <span style={{ color: totalNet > 0 ? '#22c55e' : '#555' }}>{fmt(totalNet)}</span></span>
        </div>
      </div>

      {/* Account rows */}
      <div>
        {sorted.map((record, i) => {
          const isSaving = savingId === record.id
          return (
            <div
              key={record.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 150px 130px 130px 130px 90px 50px',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 20px',
                borderTop: i === 0 ? 'none' : '1px solid #1a1a1a',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#161616'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Account name */}
              <div style={{ fontSize: '13px', color: '#a1a1aa' }}>
                {record.accountName.replace(aka + ' - ', '')}
              </div>

              {/* Earnings — editable */}
              <div>
                <EarningsCell record={record} onSave={onSave} saving={isSaving} />
              </div>

              {/* Commission */}
              <div style={{ fontSize: '13px', color: record.totalCommission > 0 ? '#a78bfa' : '#555', textAlign: 'right' }}>
                {fmt(record.totalCommission)}
              </div>

              {/* Chat fee */}
              <div style={{ fontSize: '13px', color: record.chatTeamCost > 0 ? '#f59e0b' : '#555', textAlign: 'right' }}>
                {record.chatTeamCost > 0 ? '− ' + fmt(record.chatTeamCost) : '—'}
              </div>

              {/* Net */}
              <div style={{ fontSize: '13px', fontWeight: 600, color: record.netProfit > 0 ? '#22c55e' : '#555', textAlign: 'right' }}>
                {fmt(record.netProfit)}
              </div>

              {/* Status */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <StatusPill
                  status={record.status}
                  saving={isSaving}
                  onClick={() => onSave(record.id, { status: STATUS_CONFIG[record.status]?.next || 'Draft' })}
                />
              </div>

              {/* PDF action */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                {record.dropboxLink ? (
                  <a
                    href={record.dropboxLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View PDF"
                    style={{
                      color: '#a78bfa',
                      fontSize: '16px',
                      textDecoration: 'none',
                      lineHeight: 1,
                    }}
                  >
                    ↗
                  </a>
                ) : (
                  <span style={{ color: '#333', fontSize: '13px', cursor: 'default' }} title="No PDF yet">—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Column headers
function TableHeader() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 150px 130px 130px 130px 90px 50px',
      gap: '12px',
      padding: '6px 20px',
      marginBottom: '4px',
    }}>
      {[
        { label: 'Account', align: 'left' },
        { label: 'Earnings (TR)', align: 'left' },
        { label: 'Commission', align: 'right' },
        { label: 'Chat Fee', align: 'right' },
        { label: 'Net Profit', align: 'right' },
        { label: 'Status', align: 'center' },
        { label: 'PDF', align: 'right' },
      ].map(col => (
        <div key={col.label} style={{
          fontSize: '11px',
          color: '#52525b',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          textAlign: col.align,
        }}>
          {col.label}
        </div>
      ))}
    </div>
  )
}

export default function InvoicingPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  const [records, setRecords] = useState([])
  const [periods, setPeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin'

  useEffect(() => {
    if (!isLoaded) return
    if (!isAdmin) router.replace('/dashboard')
  }, [isLoaded, isAdmin, router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/invoicing')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setRecords(data.records)
      setPeriods(data.periods)
      if (!selectedPeriod && data.periods.length > 0) {
        setSelectedPeriod(data.periods[0].key)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedPeriod])

  useEffect(() => { load() }, [])

  const handleSave = useCallback(async (recordId, fields) => {
    setSavingId(recordId)
    try {
      const res = await fetch('/api/admin/invoicing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, fields }),
      })
      if (!res.ok) throw new Error('Save failed')
      // Optimistic update
      setRecords(prev => prev.map(r => {
        if (r.id !== recordId) return r
        const updated = { ...r }
        if (fields.earnings !== undefined) updated.earnings = fields.earnings
        if (fields.status !== undefined) updated.status = fields.status
        // Recompute derived fields when earnings changes
        if (fields.earnings !== undefined) {
          const tr = fields.earnings
          updated.totalCommission = tr * r.commissionPct
          updated.chatTeamCost = tr * r.commissionPct * r.chatFeePct
          updated.netProfit = (tr * r.commissionPct) - (tr * r.commissionPct * r.chatFeePct)
        }
        return updated
      }))
    } catch (e) {
      console.error(e)
    } finally {
      setSavingId(null)
    }
  }, [])

  if (!isLoaded || !isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
        <div style={{ color: '#555', fontSize: '14px' }}>Loading...</div>
      </div>
    )
  }

  // Filter records by selected period
  const periodRecords = selectedPeriod
    ? records.filter(r => `${r.periodStart}|${r.periodEnd}` === selectedPeriod)
    : []

  // Group by creator AKA
  const grouped = periodRecords.reduce((acc, r) => {
    if (!acc[r.aka]) acc[r.aka] = []
    acc[r.aka].push(r)
    return acc
  }, {})

  const sortedCreators = Object.keys(grouped).sort((a, b) => a.localeCompare(b))

  const currentPeriod = periods.find(p => p.key === selectedPeriod)

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Page title */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', margin: 0 }}>Invoicing</h1>
        {currentPeriod && (
          <div style={{ fontSize: '13px', color: '#71717a', marginTop: '4px' }}>
            {fmtDate(currentPeriod.start)} – {fmtDate(currentPeriod.end)}, {new Date(currentPeriod.start).getFullYear()}
            &nbsp;•&nbsp;{periodRecords.length} accounts
          </div>
        )}
      </div>

      {/* Period tabs */}
      {periods.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {periods.map(p => {
            const active = selectedPeriod === p.key
            return (
              <button
                key={p.key}
                onClick={() => setSelectedPeriod(p.key)}
                style={{
                  background: active ? '#1a1a2e' : '#111',
                  border: `1px solid ${active ? '#a78bfa' : '#222'}`,
                  borderRadius: '6px',
                  color: active ? '#a78bfa' : '#71717a',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {fmtDate(p.start)} – {fmtDate(p.end)}
              </button>
            )
          })}
          <button
            onClick={load}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid #222',
              borderRadius: '6px',
              color: '#555',
              padding: '6px 14px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ↺ Refresh
          </button>
        </div>
      )}

      {loading && (
        <div style={{ color: '#555', fontSize: '14px', padding: '40px 0' }}>Loading invoices...</div>
      )}

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
              key={aka}
              aka={aka}
              rows={grouped[aka]}
              onSave={handleSave}
              savingId={savingId}
            />
          ))}
        </>
      )}

      {!loading && !error && periodRecords.length === 0 && periods.length > 0 && (
        <div style={{ color: '#555', fontSize: '14px', padding: '60px 0', textAlign: 'center' }}>
          No invoice records for this period.
        </div>
      )}

      {!loading && !error && periods.length === 0 && (
        <div style={{ color: '#555', fontSize: '14px', padding: '60px 0', textAlign: 'center' }}>
          No invoice records found. Create records in Airtable to get started.
        </div>
      )}
    </div>
  )
}
