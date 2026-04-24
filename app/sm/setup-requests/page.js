'use client'

import { useEffect, useState } from 'react'

export default function SetupRequestsPage() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [filter, setFilter] = useState('open') // 'open' | 'all' | 'complete'

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/sm-requests')
      const d = await r.json()
      setRequests(d.requests || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = requests.filter(r =>
    filter === 'open' ? r.status !== 'Complete' :
    filter === 'complete' ? r.status === 'Complete' :
    true
  )

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Setup Requests</h1>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>
            New creators needing Palm IG accounts. Fill in handles, check done as each account goes live.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '3px' }}>
          {['open', 'all', 'complete'].map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                background: filter === k ? 'var(--palm-pink)' : 'transparent',
                color: filter === k ? '#060606' : 'var(--foreground-muted)',
              }}
            >{k}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--foreground-muted)', padding: '40px 0' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px', background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--card-border)', borderRadius: '12px', textAlign: 'center', color: 'var(--foreground-muted)' }}>
          No {filter === 'all' ? '' : filter + ' '}setup requests.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(req => (
            <RequestRow
              key={req.id}
              request={req}
              expanded={expandedId === req.id}
              onToggle={() => setExpandedId(expandedId === req.id ? null : req.id)}
              onChange={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RequestRow({ request, expanded, onToggle, onChange }) {
  const doneCount = request.slots.filter(s => s.done).length
  const statusColor = request.status === 'Complete' ? '#22c55e' : request.status === 'In Progress' ? '#3b82f6' : '#eab308'

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)', borderRadius: '12px', overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '14px 18px', background: 'transparent', border: 'none',
          display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer', textAlign: 'left',
          color: 'var(--foreground)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{request.aka || request.fullName}</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
            {request.fullName}{request.dob ? ` · DOB ${request.dob}` : ''}
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
          {doneCount}/3 accounts
        </div>
        <div style={{
          padding: '4px 10px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
          borderRadius: '6px', background: `${statusColor}22`, color: statusColor,
        }}>
          {request.status}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', width: '14px', textAlign: 'center' }}>
          {expanded ? '▾' : '▸'}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '8px 18px 20px', borderTop: '1px solid var(--card-border)' }}>
          {/* Profile photos gallery */}
          {request.photos.length > 0 && (
            <div style={{ margin: '12px 0 20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--foreground-muted)', marginBottom: '8px' }}>
                Profile Photos
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {request.photos.map(p => (
                  <div key={p.id} style={{ position: 'relative', width: '120px' }}>
                    <img src={p.thumbnail} alt={p.filename} style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px', display: 'block' }} />
                    <a
                      href={p.url}
                      download={p.filename}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'block', marginTop: '4px',
                        fontSize: '11px', color: 'var(--palm-pink)', textDecoration: 'none',
                        textAlign: 'center',
                      }}
                    >↓ Download</a>
                  </div>
                ))}
              </div>
            </div>
          )}
          {request.photos.length === 0 && (
            <div style={{ margin: '12px 0 16px', padding: '10px 14px', fontSize: '12px', color: 'var(--foreground-muted)', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '8px' }}>
              No profile photos yet. Ask Palm to upload them first (Admin → Onboarding → Photos).
            </div>
          )}

          {/* 3 slots */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {request.slots.map(slot => (
              <SlotRow key={slot.n} requestId={request.id} slot={slot} onChange={onChange} />
            ))}
          </div>

          {/* Notes */}
          <NotesField requestId={request.id} initial={request.notes} />
        </div>
      )}
    </div>
  )
}

function SlotRow({ requestId, slot, onChange }) {
  const [candidates, setCandidates] = useState(slot.candidates)
  const [handle, setHandle] = useState(slot.handle)
  const [saving, setSaving] = useState(false)
  const [savingDone, setSavingDone] = useState(false)
  const disabled = slot.done

  async function saveField(fieldPatch) {
    setSaving(true)
    try {
      await fetch(`/api/admin/sm-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fieldPatch),
      })
    } finally { setSaving(false) }
  }

  async function markDone() {
    if (!handle.trim()) { alert('Enter a handle first.'); return }
    if (!confirm(`Confirm: @${handle.trim().replace(/^@/, '')} is live and ready. This creates the CPD row.`)) return
    setSavingDone(true)
    try {
      const r = await fetch(`/api/admin/sm-requests/${requestId}/complete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: slot.n, handle }),
      })
      const d = await r.json()
      if (!r.ok) { alert(`Failed: ${d.error || 'unknown'}`); return }
      onChange()
    } finally { setSavingDone(false) }
  }

  return (
    <div style={{
      padding: '14px', background: slot.done ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${slot.done ? 'rgba(34,197,94,0.3)' : 'var(--card-border)'}`,
      borderRadius: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>Palm IG {slot.n} {slot.done && <span style={{ color: '#22c55e', fontWeight: 400, marginLeft: '8px' }}>✓ Live</span>}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px auto', gap: '10px', alignItems: 'flex-start' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'block', marginBottom: '4px' }}>Username candidates</label>
          <textarea
            value={candidates}
            onChange={e => setCandidates(e.target.value)}
            onBlur={() => candidates !== slot.candidates && saveField({ [`slot${slot.n}Candidates`]: candidates })}
            disabled={disabled}
            placeholder="Options to discuss with Palm..."
            rows={2}
            style={{
              width: '100%', padding: '8px 10px', fontSize: '13px',
              background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '6px',
              color: 'var(--foreground)', resize: 'vertical', fontFamily: 'inherit',
              opacity: disabled ? 0.6 : 1,
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'block', marginBottom: '4px' }}>Final handle</label>
          <input
            type="text"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            onBlur={() => handle !== slot.handle && saveField({ [`slot${slot.n}Handle`]: handle })}
            disabled={disabled}
            placeholder="@username"
            style={{
              width: '100%', padding: '8px 10px', fontSize: '13px',
              background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '6px',
              color: 'var(--foreground)',
              opacity: disabled ? 0.6 : 1,
            }}
          />
        </div>

        <div style={{ paddingTop: '18px' }}>
          <button
            onClick={markDone}
            disabled={disabled || savingDone || !handle.trim()}
            style={{
              padding: '8px 14px', fontSize: '13px', fontWeight: 600,
              background: disabled ? 'rgba(34,197,94,0.15)' : 'var(--palm-pink)',
              color: disabled ? '#22c55e' : '#060606',
              border: 'none', borderRadius: '6px',
              cursor: disabled ? 'default' : 'pointer',
              opacity: (!handle.trim() && !disabled) ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {disabled ? '✓ Done' : savingDone ? 'Saving...' : 'Mark Live'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NotesField({ requestId, initial }) {
  const [notes, setNotes] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (notes === initial) return
    setSaving(true)
    try {
      await fetch(`/api/admin/sm-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ marginTop: '16px' }}>
      <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'block', marginBottom: '4px' }}>Notes</label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={save}
        placeholder="Anything Palm should know..."
        rows={2}
        style={{
          width: '100%', padding: '8px 10px', fontSize: '13px',
          background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', borderRadius: '6px',
          color: 'var(--foreground)', resize: 'vertical', fontFamily: 'inherit',
        }}
      />
      {saving && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>Saving...</div>}
    </div>
  )
}
