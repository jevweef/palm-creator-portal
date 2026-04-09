'use client'

import { useState, useEffect } from 'react'

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

const TIMEZONES = [
  { value: '', label: 'Select your time zone' },
  { value: 'EST', label: 'Eastern (EST)' },
  { value: 'CST', label: 'Central (CST)' },
  { value: 'MST', label: 'Mountain (MST)' },
  { value: 'PST', label: 'Pacific (PST)' },
  { value: 'HST', label: 'Hawaii (HST)' },
  { value: 'Other', label: 'Other' },
]

const COMM_OPTIONS = ['iMessage', 'WhatsApp', 'Telegram', 'Email', 'Instagram DM']

export default function StepBasicInfo({ initialData = {}, onSave, saving }) {
  const [form, setForm] = useState({
    name: '',
    stageName: '',
    birthday: '',
    location: '',
    igAccount: '',
    timeZone: '',
    communication: [],
    telegram: '',
    noTelegram: false,
  })

  // Sync initialData when it changes (fixes persistence on navigate back)
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setForm(prev => ({
        ...prev,
        name: initialData.name || prev.name,
        stageName: initialData.stageName || prev.stageName,
        birthday: initialData.birthday || prev.birthday,
        location: initialData.location || prev.location,
        igAccount: initialData.igAccount || prev.igAccount,
        timeZone: initialData.timeZone || prev.timeZone,
        communication: initialData.communication || prev.communication,
        telegram: initialData.telegram || prev.telegram,
      }))
    }
  }, [initialData])

  const update = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const toggleComm = (opt) => {
    setForm(prev => ({
      ...prev,
      communication: prev.communication.includes(opt)
        ? prev.communication.filter(c => c !== opt)
        : [...prev.communication, opt],
    }))
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
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px', lineHeight: '1.4' }}>
            The name we&apos;ll use on your social accounts, OF page, and bios. Can be your real name or a stage name — whatever your fans know you by.
          </div>
          <input
            type="text"
            value={form.stageName}
            onChange={e => update('stageName', e.target.value)}
            placeholder='e.g. "Bella," "Mia Rose," or your first name'
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
          <label style={labelStyle}>Time Zone</label>
          <select
            value={form.timeZone}
            onChange={e => update('timeZone', e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
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

        <div>
          <label style={labelStyle}>Telegram</label>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px', lineHeight: '1.4' }}>
            We use Telegram for day-to-day communication. You can enter your username (e.g. @yourname) or the phone number linked to your account.
          </div>
          {!form.noTelegram && (
            <input
              type="text"
              value={form.telegram}
              onChange={e => update('telegram', e.target.value)}
              placeholder="@username or phone number"
              style={inputStyle}
            />
          )}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '8px',
            fontSize: '12px',
            color: '#666',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={form.noTelegram}
              onChange={e => {
                update('noTelegram', e.target.checked)
                if (e.target.checked) update('telegram', '')
              }}
              style={{ accentColor: '#E88FAC' }}
            />
            I don&apos;t have Telegram
          </label>
        </div>

        <div>
          <label style={labelStyle}>Preferred Communication Methods</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
            {COMM_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => toggleComm(opt)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: form.communication.includes(opt) ? 600 : 400,
                  background: form.communication.includes(opt) ? '#E88FAC' : '#f5f5f5',
                  color: form.communication.includes(opt) ? '#fff' : '#666',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
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
