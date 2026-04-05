'use client'

import { useState, useEffect } from 'react'

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  fontSize: '14px',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  outline: 'none',
  background: '#fff',
}

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#333',
  marginBottom: '6px',
}

const sectionHeaderStyle = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#1a1a1a',
  marginBottom: '4px',
  marginTop: '24px',
}

const hintStyle = {
  fontSize: '11px',
  color: '#999',
  marginBottom: '12px',
}

export default function StepAccounts({ initialData = {}, onSave, saving }) {
  const [form, setForm] = useState({
    ofEmail: '',
    ofPassword: '',
    of2fa: '',
    ofUrl: '',
    secondOfEmail: '',
    secondOfPassword: '',
    tiktok: '',
    twitter: '',
    reddit: '',
    youtube: '',
    oftv: '',
    otherSocials: '',
  })

  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setForm(prev => ({ ...prev, ...initialData }))
    }
  }, [initialData])

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
        Accounts & Access
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '8px' }}>
        We need access to your accounts to manage your page. All credentials are transmitted securely over HTTPS and stored privately.
      </p>

      {/* OnlyFans Primary */}
      <div style={sectionHeaderStyle}>OnlyFans Account</div>
      <div style={hintStyle}>Your primary OnlyFans account credentials.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '500px' }}>
        <div>
          <label style={labelStyle}>OnlyFans URL</label>
          <input
            type="url"
            value={form.ofUrl}
            onChange={e => update('ofUrl', e.target.value)}
            placeholder="https://onlyfans.com/yourusername"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>OnlyFans Email</label>
          <input
            type="email"
            value={form.ofEmail}
            onChange={e => update('ofEmail', e.target.value)}
            placeholder="Email used for your OF account"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>OnlyFans Password</label>
          <input
            type="password"
            value={form.ofPassword}
            onChange={e => update('ofPassword', e.target.value)}
            placeholder="Your OF password"
            style={inputStyle}
            autoComplete="off"
          />
        </div>
        <div>
          <label style={labelStyle}>2FA / Recovery Info</label>
          <input
            type="text"
            value={form.of2fa}
            onChange={e => update('of2fa', e.target.value)}
            placeholder="2FA method, backup codes, or recovery email"
            style={inputStyle}
          />
        </div>
      </div>

      {/* OnlyFans Secondary */}
      <div style={sectionHeaderStyle}>Second OnlyFans Account (if applicable)</div>
      <div style={hintStyle}>Only fill this out if you have a second/alt OnlyFans account.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '500px' }}>
        <div>
          <label style={labelStyle}>Second OF Email</label>
          <input
            type="email"
            value={form.secondOfEmail}
            onChange={e => update('secondOfEmail', e.target.value)}
            placeholder="Email for second account (optional)"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Second OF Password</label>
          <input
            type="password"
            value={form.secondOfPassword}
            onChange={e => update('secondOfPassword', e.target.value)}
            placeholder="Password for second account (optional)"
            style={inputStyle}
            autoComplete="off"
          />
        </div>
      </div>

      {/* Social Accounts */}
      <div style={sectionHeaderStyle}>Social Media Accounts</div>
      <div style={hintStyle}>Add your handles or profile URLs for each platform you use.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '500px' }}>
        <div>
          <label style={labelStyle}>TikTok</label>
          <input
            type="text"
            value={form.tiktok}
            onChange={e => update('tiktok', e.target.value)}
            placeholder="@handle or URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Twitter / X</label>
          <input
            type="text"
            value={form.twitter}
            onChange={e => update('twitter', e.target.value)}
            placeholder="@handle or URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Reddit</label>
          <input
            type="text"
            value={form.reddit}
            onChange={e => update('reddit', e.target.value)}
            placeholder="u/username or URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>YouTube</label>
          <input
            type="text"
            value={form.youtube}
            onChange={e => update('youtube', e.target.value)}
            placeholder="Channel URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>OFTV</label>
          <input
            type="text"
            value={form.oftv}
            onChange={e => update('oftv', e.target.value)}
            placeholder="OFTV profile URL (optional)"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Other Social Accounts</label>
          <textarea
            value={form.otherSocials}
            onChange={e => update('otherSocials', e.target.value)}
            placeholder="Any other platforms (Fansly, Snapchat, etc.) — one per line"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
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
        }}
      >
        {saving ? 'Saving...' : 'Save & Continue'}
      </button>
    </form>
  )
}
