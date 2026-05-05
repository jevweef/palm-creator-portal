'use client'

import { useState, useEffect } from 'react'

const REASON_PRESETS = [
  'Churned — no longer producing content',
  'Mutual end of agreement',
  'Creator requested to leave',
  'Performance / fit issue',
  'Going to another agency',
  'Other (see notes)',
]

/**
 * Shared offboarding modal. Used from /admin/creators and /admin/onboarding.
 *
 * Props:
 *   creator: { hqId, name, aka }
 *   onClose: () => void
 *   onDone: (resultSummary) => void  // POST result; caller refreshes its list
 */
export default function OffboardModal({ creator, onClose, onDone }) {
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [confirmText, setConfirmText] = useState('')
  const [reasonPreset, setReasonPreset] = useState('')
  const [reasonNotes, setReasonNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!creator?.hqId) { setLoadingPreview(false); return }
    fetch(`/api/admin/creator/offboard?hqId=${creator.hqId}`)
      .then(r => r.json())
      .then(data => { setPreview(data); setLoadingPreview(false) })
      .catch(e => { setError(e.message); setLoadingPreview(false) })
  }, [creator?.hqId])

  const aka = preview?.creator?.aka || creator?.aka || ''
  const akaMatches = confirmText.trim().toLowerCase() === aka.trim().toLowerCase() && aka.length > 0
  const accounts = preview?.revenueAccounts || []
  const willDeactivate = accounts.filter(a => a.status !== 'Inactive')
  // Reason is required so we always have a record of why someone left.
  const reason = [reasonPreset, reasonNotes.trim()].filter(Boolean).join(' — ')
  const reasonOk = reasonPreset && (reasonPreset !== 'Other (see notes)' || reasonNotes.trim().length > 0)
  const canSubmit = akaMatches && reasonOk && !submitting

  const handleConfirm = async () => {
    if (!canSubmit) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/admin/creator/offboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId: creator.hqId, confirmAka: confirmText, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Offboard failed')
      onDone(data)
    } catch (e) {
      setError(e.message); setSubmitting(false)
    }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
    }}>
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '14px', maxWidth: '560px', width: '100%',
        padding: '24px 26px', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.08)', color: 'var(--foreground)',
        maxHeight: '90vh', overflow: 'auto',
      }}>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
          Offboard {creator?.name || creator?.aka}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '18px' }}>
          Sets the creator to Offboarded and runs the cascade below. Reversible in Airtable + Clerk if you ever need to bring them back.
        </div>

        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Will happen automatically:</div>
        <ul style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', margin: '0 0 14px 0', paddingLeft: '18px', lineHeight: '1.6' }}>
          <li>HQ + Ops Creators: <code>Status → Offboarded</code>, <code>Offboarded Date → today</code>, reason saved</li>
          <li>Ops <code>Social Media Editing</code> unchecked → drops from editor + grid planner</li>
          <li>
            Revenue Accounts → Inactive ({loadingPreview ? '…' : willDeactivate.length}
            {!loadingPreview && willDeactivate.length > 0 && (
              <span style={{ color: 'var(--foreground-muted)' }}>: {willDeactivate.map(a => a.name).join(', ')}</span>
            )}
            {!loadingPreview && willDeactivate.length === 0 && accounts.length > 0 && (
              <span style={{ color: 'var(--foreground-muted)' }}> — all already inactive</span>
            )}
            {!loadingPreview && accounts.length === 0 && (
              <span style={{ color: 'var(--foreground-muted)' }}> — none linked</span>
            )})
          </li>
          <li>
            SMM Telegram topics deleted ({loadingPreview ? '…' : (preview?.cpdTopicCount || 0)})
            {preview?.hasCreatorTelegramThread && <> + creator Telegram thread cleared</>}
          </li>
          <li>Clerk login banned (by Communication Email — reversible via unban)</li>
          <li>Dropbox file requests closed → no new uploads can arrive (Make.com ingest stops at the source)</li>
          <li>Dropbox folder moved <code>/Palm Ops/Creators/{aka}/</code> → <code>/Palm Ops/Archive/Creators/{aka}/</code></li>
          <li>Past invoices preserved — historical records stay attached to the creator.</li>
        </ul>

        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#E8A07A' }}>Still manual:</div>
        <ul style={{ fontSize: '12px', color: 'var(--foreground-muted)', margin: '0 0 18px 0', paddingLeft: '18px', lineHeight: '1.55' }}>
          <li>Apify: remove their inspo source accounts (stop scraping)</li>
          <li>Final invoice for the partial period</li>
        </ul>

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '6px' }}>
          Reason <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}>(saved to HQ Creators · Offboarded Reason)</span>
        </div>
        <select
          value={reasonPreset}
          onChange={e => setReasonPreset(e.target.value)}
          disabled={submitting}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: '6px',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--foreground)', fontSize: '13px', outline: 'none', marginBottom: '8px',
          }}
        >
          <option value="">Select a reason…</option>
          {REASON_PRESETS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <textarea
          value={reasonNotes}
          onChange={e => setReasonNotes(e.target.value)}
          placeholder={reasonPreset === 'Other (see notes)' ? 'Describe what happened (required)' : 'Optional context — keep this honest, it goes in the record.'}
          disabled={submitting}
          rows={3}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: '6px',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--foreground)', fontSize: '13px', outline: 'none', marginBottom: '14px',
            resize: 'vertical', fontFamily: 'inherit',
          }}
        />

        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '6px' }}>
          Type <strong style={{ color: 'var(--foreground)' }}>{aka || '(missing AKA)'}</strong> to confirm:
        </div>
        <input
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          disabled={submitting}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: '6px',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--foreground)', fontSize: '13px', outline: 'none', marginBottom: '14px',
          }}
        />

        {error && (
          <div style={{ fontSize: '12px', color: '#E87878', marginBottom: '12px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} disabled={submitting} style={{
            padding: '8px 14px', fontSize: '13px', fontWeight: 500, borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
            color: 'var(--foreground)', cursor: submitting ? 'default' : 'pointer',
          }}>Cancel</button>
          <button onClick={handleConfirm} disabled={!canSubmit} style={{
            padding: '8px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: 'none',
            background: canSubmit ? '#C25450' : 'rgba(194, 84, 80, 0.35)',
            color: '#fff', cursor: canSubmit ? 'pointer' : 'default',
          }}>{submitting ? 'Offboarding…' : 'Offboard creator'}</button>
        </div>
      </div>
    </div>
  )
}
