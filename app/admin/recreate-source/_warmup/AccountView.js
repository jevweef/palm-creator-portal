'use client'

import { useEffect, useState, useCallback } from 'react'

// Per-account detailed view. Shows full task schedule (grouped by phase),
// profile fields (vault refs, hardware slot, beacons URL, notes),
// pause/resume controls, owner-approval affordance.

export default function AccountView({ accountId, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [savingTaskId, setSavingTaskId] = useState(null)
  const [openTaskId, setOpenTaskId] = useState(null)
  const [editProfile, setEditProfile] = useState(false)
  const [profileDraft, setProfileDraft] = useState({})

  const load = useCallback(() => {
    fetch(`/api/admin/smm/warmup/accounts/${accountId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        setData(d); setError('')
        setProfileDraft({
          beaconsUrl: d.profile.beaconsUrl,
          fbProfileSlot: d.profile.fbProfileSlot,
          pixelDevice: d.profile.pixelDevice,
          personaNotes: d.profile.personaNotes,
          igVaultItemId: d.profile.vaultRefs.ig,
          fbVaultItemId: d.profile.vaultRefs.fb,
          gmailVaultItemId: d.profile.vaultRefs.gmail,
          recoveryVaultItemId: d.profile.vaultRefs.recovery,
        })
      })
      .catch(e => setError(e.message))
  }, [accountId])

  useEffect(() => { load() }, [load])

  if (!data && !error) return <div style={{ padding: 40, fontSize: 13, color: 'var(--foreground-muted)' }}>Loading…</div>
  if (error) return <div style={{ padding: 24, color: '#e87878', fontSize: 13 }}>Couldn't load: {error}</div>

  const { profile, currentDay, tasks } = data
  const tasksByPhase = tasks.reduce((acc, t) => {
    ;(acc[t.phase || 'Setup'] ||= []).push(t)
    return acc
  }, {})
  const phaseOrder = ['Setup', 'Build', 'Build-Steady', 'Steady', 'Live']

  const patchTask = async (taskId, body) => {
    setSavingTaskId(taskId)
    const res = await fetch(`/api/admin/smm/warmup/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSavingTaskId(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.message || j.error || `HTTP ${res.status}`)
      return false
    }
    load()
    return true
  }

  const patchProfile = async (body) => {
    const res = await fetch(`/api/admin/smm/warmup/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.message || j.error || `HTTP ${res.status}`)
      return false
    }
    load()
    return true
  }

  const onMarkCreated = () => patchProfile({ markAccountCreated: true })
  const onPause = () => {
    if (!confirm('Pause warm-up for this account? Day counter freezes; resume later by un-pausing.')) return
    patchProfile({ warmupStatus: 'Paused' })
  }
  const onResume = () => patchProfile({ warmupStatus: 'Warming Up' })
  const onRetire = () => {
    if (!confirm('Retire this account? Use this for banned/abandoned accounts. Reversible by setting Warmup Status manually in Airtable.')) return
    patchProfile({ warmupStatus: 'Retired' })
  }
  const onSaveProfile = async () => {
    const ok = await patchProfile(profileDraft)
    if (ok) setEditProfile(false)
  }

  return (
    <div style={{ padding: '20px 8px' }}>
      <button
        onClick={onBack}
        style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer', marginBottom: 12 }}
      >
        ← Back to Today
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
            {profile.personaName}
            {profile.personaHandle && <span style={{ color: 'var(--foreground-subtle)', fontWeight: 400, fontSize: 15, marginLeft: 8 }}>@{profile.personaHandle}</span>}
          </h2>
          <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: 'var(--foreground-muted)' }}>
            <StatusPill status={profile.warmupStatus} />
            <span>·</span>
            <span>{currentDay == null ? 'No start date' : `Day ${currentDay}`}</span>
            {profile.warmupStartDate && (
              <>
                <span>·</span>
                <span>started {new Date(profile.warmupStartDate).toLocaleDateString()}</span>
              </>
            )}
            {profile.daysPaused > 0 && (
              <>
                <span>·</span>
                <span>{profile.daysPaused} paused day{profile.daysPaused === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {profile.warmupStatus === 'Setup' && (
            <button onClick={onMarkCreated} style={btn('primary')}>Mark Account Created</button>
          )}
          {profile.warmupStatus === 'Warming Up' && (
            <button onClick={onPause} style={btn('secondary')}>Pause</button>
          )}
          {profile.warmupStatus === 'Paused' && (
            <button onClick={onResume} style={btn('primary')}>Resume</button>
          )}
          {['Warming Up', 'Live', 'Paused'].includes(profile.warmupStatus) && (
            <button onClick={onRetire} style={btn('danger')}>Retire</button>
          )}
        </div>
      </div>

      {/* Profile fields panel */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: 16,
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>Profile + Hardware + Vault</h3>
          <button onClick={() => setEditProfile(e => !e)} style={btn('ghost')}>
            {editProfile ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {editProfile ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            <Field label="Pixel Device" value={profileDraft.pixelDevice} onChange={v => setProfileDraft(d => ({ ...d, pixelDevice: v }))} placeholder="Pixel-01 / Profile-A" />
            <Field label="FB Profile Slot" value={profileDraft.fbProfileSlot} onChange={v => setProfileDraft(d => ({ ...d, fbProfileSlot: v }))} placeholder="Slot 1 | Slot 2 | Slot 3 | N/A" />
            <Field label="Beacons URL" value={profileDraft.beaconsUrl} onChange={v => setProfileDraft(d => ({ ...d, beaconsUrl: v }))} placeholder="https://beacons.ai/…" />
            <Field label="IG Vault Item ID" value={profileDraft.igVaultItemId} onChange={v => setProfileDraft(d => ({ ...d, igVaultItemId: v }))} placeholder="vault item ID, not the secret" />
            <Field label="FB Vault Item ID" value={profileDraft.fbVaultItemId} onChange={v => setProfileDraft(d => ({ ...d, fbVaultItemId: v }))} />
            <Field label="Gmail Vault Item ID" value={profileDraft.gmailVaultItemId} onChange={v => setProfileDraft(d => ({ ...d, gmailVaultItemId: v }))} />
            <Field label="Recovery Codes Vault Item ID" value={profileDraft.recoveryVaultItemId} onChange={v => setProfileDraft(d => ({ ...d, recoveryVaultItemId: v }))} />
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Persona Notes" value={profileDraft.personaNotes} onChange={v => setProfileDraft(d => ({ ...d, personaNotes: v }))} multiline />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onSaveProfile} style={btn('primary')}>Save</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, fontSize: 12 }}>
            <ReadField label="Pixel Device" value={profile.pixelDevice} />
            <ReadField label="FB Profile Slot" value={profile.fbProfileSlot} />
            <ReadField label="Beacons URL" value={profile.beaconsUrl} />
            <ReadField label="IG Vault" value={profile.vaultRefs.ig} />
            <ReadField label="FB Vault" value={profile.vaultRefs.fb} />
            <ReadField label="Gmail Vault" value={profile.vaultRefs.gmail} />
            <ReadField label="Recovery Vault" value={profile.vaultRefs.recovery} />
            <div style={{ gridColumn: '1 / -1' }}>
              <ReadField label="Persona Notes" value={profile.personaNotes} multiline />
            </div>
          </div>
        )}
      </div>

      {/* Tasks by phase */}
      {phaseOrder.map(phase => {
        const phaseTasks = tasksByPhase[phase]
        if (!phaseTasks || phaseTasks.length === 0) return null
        return (
          <div key={phase} style={{ marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {phase} ({phaseTasks.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {phaseTasks.map(t => {
                const blockedByPrereq = !!t.prerequisiteTaskKey && (tasks.find(x => x.key === t.prerequisiteTaskKey)?.status !== 'Done')
                const blockedByApproval = t.requiresOwnerApproval && !t.ownerApproved
                const isOpen = openTaskId === t.id
                const isDone = t.status === 'Done'
                const isSkipped = t.status === 'Skipped'
                const isPastDue = currentDay != null && t.day < currentDay && !isDone && !isSkipped
                return (
                  <div key={t.id} style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: isDone ? 'rgba(106,198,138,0.04)' : (blockedByPrereq || blockedByApproval ? 'rgba(232,195,106,0.04)' : 'rgba(255,255,255,0.02)'),
                    border: `1px solid ${isDone ? 'rgba(106,198,138,0.18)' : (blockedByPrereq || blockedByApproval ? 'rgba(232,195,106,0.18)' : 'rgba(255,255,255,0.06)')}`,
                    opacity: isSkipped ? 0.5 : 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <button
                        onClick={() => {
                          if (isDone) return
                          if (blockedByApproval) {
                            alert('Owner approval required. Click ⚠ to approve below.')
                            return
                          }
                          if (blockedByPrereq) {
                            alert('Prerequisite task is not Done yet.')
                            return
                          }
                          patchTask(t.id, { status: 'Done' })
                        }}
                        disabled={isDone || savingTaskId === t.id}
                        style={{
                          width: 18, height: 18, borderRadius: 4,
                          border: `1.5px solid ${isDone ? 'rgba(106,198,138,0.6)' : 'rgba(255,255,255,0.20)'}`,
                          background: isDone ? 'rgba(106,198,138,0.4)' : 'transparent',
                          cursor: isDone ? 'default' : 'pointer',
                          flexShrink: 0, marginTop: 1,
                          color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {isDone ? '✓' : ''}
                      </button>
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setOpenTaskId(isOpen ? null : t.id)}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)', lineHeight: 1.35, textDecoration: isSkipped ? 'line-through' : 'none' }}>
                          {t.title}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 10, color: 'var(--foreground-subtle)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>Day {t.day}</span>
                          {isPastDue && <><span>·</span><span style={{ color: '#E87878' }}>past due</span></>}
                          {isDone && t.completedBy && <><span>·</span><span>by {t.completedBy}</span></>}
                          {t.requiresOwnerApproval && (
                            <>
                              <span>·</span>
                              <span style={{ color: t.ownerApproved ? '#6AC68A' : '#E8C36A' }}>
                                ⚠ approval {t.ownerApproved ? 'granted' : 'required'}
                              </span>
                            </>
                          )}
                          {t.prerequisiteTaskKey && (
                            <>
                              <span>·</span>
                              <span style={{ color: blockedByPrereq ? '#E8C36A' : 'var(--foreground-subtle)' }}>
                                prereq: {t.prerequisiteTaskKey}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: 12, color: 'var(--foreground-muted)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                          {t.description}
                        </div>
                        <textarea
                          defaultValue={t.notes}
                          placeholder="Notes for this task…"
                          onBlur={e => {
                            if (e.target.value !== t.notes) patchTask(t.id, { notes: e.target.value })
                          }}
                          style={{
                            marginTop: 10, width: '100%', minHeight: 60,
                            padding: 8, background: 'rgba(0,0,0,0.25)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 6, color: 'var(--foreground)',
                            fontSize: 12, fontFamily: 'inherit', resize: 'vertical',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          {t.requiresOwnerApproval && !t.ownerApproved && (
                            <button onClick={() => patchTask(t.id, { ownerApproved: true })} style={btn('warning')}>
                              ⚠ Grant Owner Approval
                            </button>
                          )}
                          {!isDone && !isSkipped && (
                            <button onClick={() => {
                              if (confirm('Skip this task? It won\'t affect the day counter, but the task will be marked Skipped permanently.')) {
                                patchTask(t.id, { status: 'Skipped' })
                              }
                            }} style={btn('ghost')}>Skip</button>
                          )}
                          {(isDone || isSkipped) && (
                            <button onClick={() => patchTask(t.id, { status: 'Pending' })} style={btn('ghost')}>Reopen</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function btn(variant) {
  const styles = {
    primary:   { background: 'var(--palm-pink)', color: '#fff', border: 'none' },
    secondary: { background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.08)' },
    danger:    { background: 'rgba(232,120,120,0.10)', color: '#e87878', border: '1px solid rgba(232,120,120,0.35)' },
    warning:   { background: 'rgba(232,195,106,0.12)', color: '#E8C36A', border: '1px solid rgba(232,195,106,0.35)' },
    ghost:     { background: 'transparent', color: 'var(--foreground-muted)', border: '1px solid rgba(255,255,255,0.08)' },
  }[variant]
  return {
    padding: '7px 14px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    ...styles,
  }
}

function Field({ label, value, onChange, placeholder, multiline }) {
  const Input = multiline ? 'textarea' : 'input'
  return (
    <label style={{ display: 'block', fontSize: 11 }}>
      <div style={{ color: 'var(--foreground-subtle)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <Input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '7px 9px',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          color: 'var(--foreground)',
          fontSize: 12,
          fontFamily: 'inherit',
          minHeight: multiline ? 70 : undefined,
          resize: multiline ? 'vertical' : 'none',
        }}
      />
    </label>
  )
}

function ReadField({ label, value, multiline }) {
  return (
    <div>
      <div style={{ color: 'var(--foreground-subtle)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ marginTop: 3, color: value ? 'var(--foreground)' : 'var(--foreground-subtle)', fontSize: 12, whiteSpace: multiline ? 'pre-wrap' : 'nowrap', overflow: multiline ? 'visible' : 'hidden', textOverflow: 'ellipsis' }}>
        {value || '—'}
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const tint = {
    'Setup': 'rgba(160,160,160,0.16)',
    'Warming Up': 'rgba(232,195,106,0.20)',
    'Live': 'rgba(106,198,138,0.20)',
    'Paused': 'rgba(160,160,160,0.16)',
    'Retired': 'rgba(160,160,160,0.10)',
  }[status] || 'rgba(160,160,160,0.16)'
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, background: tint, fontSize: 10, fontWeight: 600 }}>
      {status}
    </span>
  )
}
