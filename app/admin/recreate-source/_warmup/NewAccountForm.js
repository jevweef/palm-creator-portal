'use client'

import { useState, useEffect } from 'react'

// Create-new-account form. Spawns an AI Account Profile + instantiates
// all ~27 playbook tasks in one POST. Onsuccess → calls onCreated(id).

export default function NewAccountForm({ onCancel, onCreated }) {
  const [personaName, setPersonaName] = useState('')
  const [personaHandle, setPersonaHandle] = useState('')
  const [realCreatorId, setRealCreatorId] = useState('')
  const [pixelDevice, setPixelDevice] = useState('')
  const [fbProfileSlot, setFbProfileSlot] = useState('')
  const [beaconsUrl, setBeaconsUrl] = useState('')
  const [personaNotes, setPersonaNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [creators, setCreators] = useState([])

  useEffect(() => {
    fetch('/api/admin/palm-creators?status=Active')
      .then(r => r.ok ? r.json() : { creators: [] })
      .then(d => setCreators(d.creators || d.records || []))
      .catch(() => setCreators([]))
  }, [])

  const submit = async (e) => {
    e?.preventDefault()
    setError('')
    if (!personaName.trim()) {
      setError('Persona name is required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/smm/warmup/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaName: personaName.trim(),
          personaHandle: personaHandle.trim(),
          realCreatorId: realCreatorId || undefined,
          pixelDevice: pixelDevice.trim() || undefined,
          fbProfileSlot: fbProfileSlot || undefined,
          beaconsUrl: beaconsUrl.trim() || undefined,
          personaNotes: personaNotes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      onCreated(data.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ padding: '20px 8px', maxWidth: 640 }}>
      <button type="button" onClick={onCancel} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer', marginBottom: 12 }}>
        ← Back to Today
      </button>

      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600 }}>New AI Account</h2>
      <p style={{ margin: '0 0 24px', color: 'var(--foreground-muted)', fontSize: 13 }}>
        Creates an AI Account Profile row + instantiates ~27 playbook tasks. After this, click
        "Mark Account Created" on the per-account view to start the Day-1 counter (do this only
        once the IG account actually exists on the phone).
      </p>

      <Section title="Persona">
        <Field label="Persona Name *" value={personaName} onChange={setPersonaName} placeholder="Brielle" autoFocus />
        <Field label="Persona Handle" value={personaHandle} onChange={setPersonaHandle} placeholder="briel.ai (without @)" />
        <SelectField
          label="Real Creator (linked)"
          value={realCreatorId}
          onChange={setRealCreatorId}
          options={[{ value: '', label: '— Standalone AI persona (no real creator) —' }, ...creators.map(c => ({ value: c.id, label: c.name || c.AKA || c.id }))]}
          hint="Brielle = Amelia, Lily = Gracie, Katie Rosie = standalone"
        />
      </Section>

      <Section title="Hardware + Vault">
        <Field label="Pixel Device + OS Profile Slot" value={pixelDevice} onChange={setPixelDevice} placeholder="Pixel-01 / Profile-A" />
        <SelectField
          label="FB Profile Slot (1 of 3 per agency FB account)"
          value={fbProfileSlot}
          onChange={setFbProfileSlot}
          options={[
            { value: '', label: '—' },
            { value: 'Slot 1', label: 'Slot 1' },
            { value: 'Slot 2', label: 'Slot 2' },
            { value: 'Slot 3', label: 'Slot 3' },
            { value: 'N/A', label: 'N/A (no FB)' },
          ]}
        />
        <Field label="Beacons URL" value={beaconsUrl} onChange={setBeaconsUrl} placeholder="https://beacons.ai/brielle (created later, Day 10)" />
        <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginTop: -4 }}>
          Vault item IDs (IG / FB / Gmail / Recovery Codes) — fill these from the per-account view
          once the credentials are stored in 1Password / Bitwarden. Don't paste the secrets here.
        </div>
      </Section>

      <Section title="Notes">
        <Field label="Persona Notes" value={personaNotes} onChange={setPersonaNotes} placeholder="Anything operator should remember about this persona" multiline />
      </Section>

      {error && (
        <div style={{ padding: 12, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 8, color: '#e87878', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} disabled={submitting} style={{
          padding: '9px 16px',
          borderRadius: 6,
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--foreground-muted)',
          fontSize: 13,
          cursor: 'pointer',
        }}>Cancel</button>
        <button type="submit" disabled={submitting} style={{
          padding: '9px 18px',
          borderRadius: 6,
          background: 'var(--palm-pink)',
          color: '#fff',
          border: 'none',
          fontWeight: 600,
          fontSize: 13,
          cursor: submitting ? 'wait' : 'pointer',
          opacity: submitting ? 0.5 : 1,
        }}>
          {submitting ? 'Creating + instantiating tasks…' : 'Create Account'}
        </button>
      </div>
    </form>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, multiline, autoFocus }) {
  const Input = multiline ? 'textarea' : 'input'
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <Input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: '100%',
          padding: '9px 11px',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          color: 'var(--foreground)',
          fontSize: 13,
          fontFamily: 'inherit',
          minHeight: multiline ? 80 : undefined,
          resize: multiline ? 'vertical' : 'none',
        }}
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options, hint }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '9px 11px',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          color: 'var(--foreground)',
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--foreground-subtle)' }}>{hint}</div>}
    </label>
  )
}
