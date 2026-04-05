'use client'

import { useState } from 'react'

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  fontSize: '14px',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  outline: 'none',
  transition: 'border-color 0.15s',
  background: '#fff',
}

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#333',
  marginBottom: '6px',
}

export default function StepBasicInfo({ initialData = {}, onSave, saving }) {
  const [form, setForm] = useState({
    name: initialData.name || '',
    stageName: initialData.stageName || '',
    birthday: initialData.birthday || '',
    location: initialData.location || '',
    igAccount: initialData.igAccount || '',
  })

  const update = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Basic Info
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '24px' }}>
        Let&apos;s start with the basics. This info helps us set up your account.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '500px' }}>
        <div>
          <label style={labelStyle}>Full Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => update('name', e.target.value)}
            placeholder="Your full legal name"
            style={inputStyle}
            required
          />
        </div>

        <div>
          <label style={labelStyle}>Stage Name / AKA</label>
          <input
            type="text"
            value={form.stageName}
            onChange={e => update('stageName', e.target.value)}
            placeholder="The name your fans know you by"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Date of Birth</label>
          <input
            type="date"
            value={form.birthday}
            onChange={e => update('birthday', e.target.value)}
            style={inputStyle}
            required
          />
        </div>

        <div>
          <label style={labelStyle}>Location</label>
          <input
            type="text"
            value={form.location}
            onChange={e => update('location', e.target.value)}
            placeholder="City, State / Country"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Instagram Handle</label>
          <input
            type="text"
            value={form.igAccount}
            onChange={e => update('igAccount', e.target.value)}
            placeholder="@yourhandle or full URL"
            style={inputStyle}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={saving || !form.name}
        style={{
          marginTop: '28px',
          padding: '10px 32px',
          background: saving ? '#F0D0D8' : '#E88FAC',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: saving ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {saving ? 'Saving...' : 'Save & Continue'}
      </button>
    </form>
  )
}
