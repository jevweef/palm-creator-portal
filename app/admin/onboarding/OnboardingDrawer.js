'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PHASE3_ITEMS,
  PHASE3_NOTES,
  REQUIRED_SETUP_FIELDS,
  computeReadiness,
} from '@/lib/onboarding/checklist'

// ---- tiny inline icons (no emoji per house style) ----
function CheckIcon({ color = '#43A047', size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill={color} opacity="0.16" />
      <path d="M6 10.5l2.5 2.5L14 7.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function WarnIcon({ color = '#F9A825', size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill={color} opacity="0.16" />
      <path d="M10 5.5v5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill={color} />
    </svg>
  )
}
function DotIcon({ color = 'var(--foreground-subtle)', size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke={color} strokeWidth="1.5" strokeDasharray="2 2.5" />
    </svg>
  )
}

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const C = {
  green: '#43A047',
  amber: '#F9A825',
  blue: '#1E88E5',
  border: 'rgba(255,255,255,0.07)',
  borderSoft: 'rgba(255,255,255,0.04)',
}

export default function OnboardingDrawer({ creator, onClose, onWentLive }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [runningSetup, setRunningSetup] = useState(false)
  const [setupError, setSetupError] = useState(null)
  const [goingLive, setGoingLive] = useState(false)
  const [goLiveError, setGoLiveError] = useState(null)
  const [savingField, setSavingField] = useState(null)
  const [reminderCopied, setReminderCopied] = useState(false)

  const hqId = creator?.id

  const load = useCallback(async () => {
    if (!hqId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/onboarding/checklist?hqId=${hqId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [hqId])

  useEffect(() => { load() }, [load])

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const obFields = data?.onboarding?.fields || {}
  const obId = data?.onboarding?.id

  // Optimistic PATCH of one or more Onboarding fields.
  const patchFields = useCallback(async (patch) => {
    if (!obId) return
    const prev = data
    setData((d) => ({ ...d, onboarding: { ...d.onboarding, fields: { ...d.onboarding.fields, ...patch } } }))
    setSavingField(Object.keys(patch)[0])
    try {
      const res = await fetch('/api/admin/onboarding/checklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingId: obId, fields: patch }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
    } catch (err) {
      setData(prev) // revert
      alert(`Could not save: ${err.message}`)
    } finally {
      setSavingField(null)
    }
  }, [obId, data])

  const runSetup = async () => {
    setRunningSetup(true)
    setSetupError(null)
    try {
      const res = await fetch('/api/admin/onboarding/run-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: hqId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Setup failed')
      await load() // refresh to pick up the new paths/URLs/flags
    } catch (err) {
      setSetupError(err.message)
    } finally {
      setRunningSetup(false)
    }
  }

  const goLive = async () => {
    setGoingLive(true)
    setGoLiveError(null)
    try {
      const res = await fetch('/api/admin/onboarding/go-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.missing ? `Still missing: ${json.missing.join(', ')}` : (json.error || 'Go-live failed'))
      await load()
      onWentLive?.(hqId)
    } catch (err) {
      setGoLiveError(err.message)
    } finally {
      setGoingLive(false)
    }
  }

  const sendReminder = async () => {
    try {
      const res = await fetch('/api/admin/onboarding/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      const json = await res.json()
      if (res.ok && json.onboardingUrl) {
        await navigator.clipboard.writeText(json.onboardingUrl)
        setReminderCopied(true)
        setTimeout(() => setReminderCopied(false), 2500)
      }
    } catch { /* no-op */ }
  }

  const phase1 = data?.phase1 || []
  const setupComplete = REQUIRED_SETUP_FIELDS.every((f) => obFields[f.field] === true)
  const setupStarted = REQUIRED_SETUP_FIELDS.some((f) => obFields[f.field] === true)
  const readiness = computeReadiness(phase1, obFields)
  const isActive = data?.creator?.status === 'Active'
  const portalIncomplete = phase1.some((s) => !s.done)

  return (
    <>
      {/* overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100 }} />
      {/* drawer */}
      <aside
        role="dialog"
        aria-label="Onboarding checklist"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: '520px', maxWidth: '94vw',
          background: 'var(--card-bg-solid)', zIndex: 1101,
          boxShadow: '-12px 0 40px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column',
          animation: 'palmDrawerIn 0.22s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <style>{`@keyframes palmDrawerIn{from{transform:translateX(40px);opacity:0.4}to{transform:translateX(0);opacity:1}}`}</style>

        {/* header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--foreground)' }}>
              {creator?.name || data?.creator?.name || '—'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
              {(data?.creator?.aka || creator?.aka) && <span>{data?.creator?.aka || creator?.aka} · </span>}
              <span style={{ color: isActive ? C.green : 'var(--foreground-muted)' }}>
                {data?.creator?.status || creator?.status || 'Onboarding'}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: '22px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loading ? (
            <div style={{ color: 'var(--foreground-muted)', fontSize: '13px', padding: '40px 0', textAlign: 'center' }}>Loading checklist…</div>
          ) : error ? (
            <div style={{ color: '#C25450', fontSize: '13px', padding: '20px 0' }}>{error}</div>
          ) : (
            <>
              {/* ===== PHASE 1 ===== */}
              <PhaseHeader n={1} title="Creator Portal" subtitle="What the creator completed (read-only)" />
              <div style={{ marginBottom: '8px' }}>
                {phase1.map((step) => (
                  <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0' }}>
                    {step.done ? <CheckIcon /> : <WarnIcon />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: 'var(--foreground)' }}>{step.label}</div>
                      {step.detail && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{step.detail}</div>}
                    </div>
                    {!step.done && <span style={{ fontSize: '11px', color: C.amber }}>Incomplete</span>}
                  </div>
                ))}
              </div>
              {portalIncomplete && (
                <button onClick={sendReminder} style={secondaryBtn}>
                  {reminderCopied ? 'Reminder link copied' : 'Copy reminder link'}
                </button>
              )}

              {/* ===== PHASE 2 ===== */}
              <PhaseHeader n={2} title="Auto Setup" subtitle="Accounts, credentials, Dropbox folders & file requests" />
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                background: setupComplete ? 'rgba(125,211,164,0.08)' : 'rgba(255,255,255,0.03)',
                borderRadius: '10px', marginBottom: '12px',
              }}>
                {runningSetup ? <DotIcon /> : setupComplete ? <CheckIcon /> : setupStarted ? <WarnIcon /> : <DotIcon />}
                <div style={{ flex: 1, fontSize: '13px', color: 'var(--foreground)' }}>
                  {runningSetup ? 'Running setup…' : setupComplete ? 'Setup complete' : setupStarted ? 'Partially set up' : 'Not started'}
                </div>
                <button onClick={runSetup} disabled={runningSetup} style={{ ...primaryBtnSm, opacity: runningSetup ? 0.6 : 1 }}>
                  {runningSetup ? 'Running…' : setupComplete ? 'Re-run setup' : 'Run setup'}
                </button>
              </div>
              {setupError && <div style={{ color: '#C25450', fontSize: '12px', marginBottom: '10px' }}>{setupError}</div>}
              {(obFields['Dropbox Creator Root Path'] || obFields['Social File Request URL']) && (
                <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '6px', lineHeight: 1.7 }}>
                  {obFields['Dropbox Creator Root Path'] && (
                    <div><span style={kvLabel}>Folder</span> <code style={codeStyle}>{obFields['Dropbox Creator Root Path']}</code></div>
                  )}
                  {obFields['Social File Request URL'] && (
                    <div><span style={kvLabel}>Social uploads</span> <a href={obFields['Social File Request URL']} target="_blank" rel="noreferrer" style={linkStyle}>file request →</a></div>
                  )}
                  {obFields['Longform File Request URL'] && (
                    <div><span style={kvLabel}>Long form</span> <a href={obFields['Longform File Request URL']} target="_blank" rel="noreferrer" style={linkStyle}>file request →</a></div>
                  )}
                </div>
              )}

              {/* ===== PHASE 3 ===== */}
              <PhaseHeader n={3} title="Manual Admin Tasks" subtitle="Check off as you go — saves automatically" />
              {PHASE3_ITEMS.map((it) => {
                const checked = obFields[it.field] === true
                return (
                  <div key={it.field} style={{ padding: '8px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                      <CheckBox checked={checked} onToggle={() => patchFields({ [it.field]: !checked })} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {it.label}
                          {it.required && <span style={reqTag}>required</span>}
                          {savingField === it.field && <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)' }}>saving…</span>}
                        </div>
                        {it.hint && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>{it.hint}</div>}
                      </div>
                    </label>

                    {/* companion inputs */}
                    {it.deepLink && (
                      <a href={it.deepLink} target="_blank" rel="noreferrer" style={{ ...secondaryBtn, display: 'inline-block', marginTop: '6px', marginLeft: '28px', width: 'auto', padding: '5px 12px' }}>
                        {it.deepLinkLabel || 'Open link'}
                      </a>
                    )}
                    {it.dateField && (
                      <div style={{ marginLeft: '28px', marginTop: '6px' }}>
                        <input
                          type="datetime-local"
                          defaultValue={toLocalInput(obFields[it.dateField])}
                          onBlur={(e) => {
                            const v = e.target.value ? new Date(e.target.value).toISOString() : null
                            if (v !== (obFields[it.dateField] || null)) patchFields({ [it.dateField]: v })
                          }}
                          style={inputStyle}
                        />
                      </div>
                    )}
                    {it.urlField && (
                      <div style={{ marginLeft: '28px', marginTop: '6px' }}>
                        <input
                          type="url"
                          placeholder={it.urlLabel || 'Link'}
                          defaultValue={obFields[it.urlField] || ''}
                          onBlur={(e) => {
                            if ((e.target.value || '') !== (obFields[it.urlField] || '')) patchFields({ [it.urlField]: e.target.value || null })
                          }}
                          style={inputStyle}
                        />
                      </div>
                    )}
                    {it.notesField && (
                      <div style={{ marginLeft: '28px', marginTop: '6px' }}>
                        <textarea
                          placeholder={it.notesLabel || 'Notes'}
                          defaultValue={obFields[it.notesField] || ''}
                          onBlur={(e) => {
                            if ((e.target.value || '') !== (obFields[it.notesField] || '')) patchFields({ [it.notesField]: e.target.value || null })
                          }}
                          rows={2}
                          style={{ ...inputStyle, resize: 'vertical' }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* free-text reference fields */}
              <div style={{ marginTop: '14px' }}>
                {PHASE3_NOTES.map((n) => (
                  <div key={n.field} style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--foreground-muted)', display: 'block', marginBottom: '4px' }}>{n.label}</label>
                    {n.kind === 'textarea' ? (
                      <textarea
                        defaultValue={obFields[n.field] || ''}
                        onBlur={(e) => { if ((e.target.value || '') !== (obFields[n.field] || '')) patchFields({ [n.field]: e.target.value || null }) }}
                        rows={2}
                        style={{ ...inputStyle, resize: 'vertical' }}
                      />
                    ) : (
                      <input
                        type="url"
                        defaultValue={obFields[n.field] || ''}
                        onBlur={(e) => { if ((e.target.value || '') !== (obFields[n.field] || '')) patchFields({ [n.field]: e.target.value || null }) }}
                        style={inputStyle}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* ===== PHASE 4 ===== */}
              <PhaseHeader n={4} title="Go Live" subtitle="Flip the creator to Active once everything's ready" />
              {isActive ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'rgba(125,211,164,0.08)', borderRadius: '10px' }}>
                  <CheckIcon />
                  <div style={{ fontSize: '13px', color: 'var(--foreground)' }}>
                    Live since {data?.creator?.managementStartDate ? new Date(data.creator.managementStartDate).toLocaleDateString() : 'today'}
                  </div>
                </div>
              ) : (
                <>
                  {!readiness.ready && (
                    <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
                      {readiness.missing.length} item{readiness.missing.length === 1 ? '' : 's'} left before go-live:
                      <ul style={{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.6 }}>
                        {readiness.missing.map((m) => <li key={m} style={{ color: C.amber }}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                  <button
                    onClick={goLive}
                    disabled={!readiness.ready || goingLive}
                    style={{
                      ...primaryBtn,
                      width: '100%',
                      background: (!readiness.ready || goingLive) ? 'rgba(255,255,255,0.06)' : C.green,
                      color: (!readiness.ready || goingLive) ? 'var(--foreground-subtle)' : '#fff',
                      cursor: (!readiness.ready || goingLive) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {goingLive ? 'Going live…' : readiness.ready ? 'Mark Active — Go Live' : 'Complete required items to go live'}
                  </button>
                  {goLiveError && <div style={{ color: '#C25450', fontSize: '12px', marginTop: '8px' }}>{goLiveError}</div>}
                </>
              )}
              <div style={{ height: '24px' }} />
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function PhaseHeader({ n, title, subtitle }) {
  return (
    <div style={{ margin: '22px 0 12px', paddingTop: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '22px', height: '22px', borderRadius: '50%',
          background: 'rgba(232,160,160,0.14)', color: 'var(--palm-pink)',
          fontSize: '11px', fontWeight: 700,
        }}>{n}</span>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>{title}</div>
          <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{subtitle}</div>
        </div>
      </div>
    </div>
  )
}

function CheckBox({ checked, onToggle }) {
  return (
    <span
      onClick={(e) => { e.preventDefault(); onToggle() }}
      style={{
        flexShrink: 0, width: '18px', height: '18px', borderRadius: '5px', marginTop: '1px',
        border: `1.5px solid ${checked ? C.green : 'rgba(255,255,255,0.25)'}`,
        background: checked ? C.green : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 10.5l3 3L15 6.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

const primaryBtn = { padding: '11px 18px', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: 600 }
const primaryBtnSm = { padding: '7px 14px', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: 'var(--palm-pink)', color: '#060606', cursor: 'pointer' }
const secondaryBtn = { padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '12px', fontWeight: 500, background: 'transparent', color: 'var(--foreground)', cursor: 'pointer', textDecoration: 'none' }
const inputStyle = { width: '100%', padding: '7px 10px', fontSize: '13px', border: `1px solid ${C.border}`, borderRadius: '7px', outline: 'none', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)' }
const reqTag = { fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--palm-pink)', background: 'rgba(232,160,160,0.12)', padding: '1px 6px', borderRadius: '4px' }
const kvLabel = { display: 'inline-block', minWidth: '92px', color: 'var(--foreground-subtle)' }
const codeStyle = { fontSize: '11px', color: 'var(--foreground)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px' }
const linkStyle = { color: C.blue, textDecoration: 'none' }
