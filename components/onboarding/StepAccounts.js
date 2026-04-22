'use client'

import { useState, useEffect, useRef } from 'react'

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  fontSize: '14px',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  outline: 'none',
  background: 'var(--card-bg-solid)',
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
  color: 'var(--foreground)',
  marginBottom: '4px',
  marginTop: '24px',
}

const hintStyle = {
  fontSize: '11px',
  color: 'var(--foreground-muted)',
  marginBottom: '12px',
}

const PLATFORMS = [
  { key: 'freeOf', label: 'Free OnlyFans', prefix: 'onlyfans.com/' },
  { key: 'vipOf', label: 'VIP OnlyFans', prefix: 'onlyfans.com/' },
  { key: 'fansly', label: 'Fansly', prefix: 'fansly.com/' },
]

function PlatformCard({ platform, data, onUpdate, onRemove, onSendDirect }) {
  const sendDirect = data.sendDirect || false
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div style={{
      background: 'var(--card-bg-solid)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>{platform.label}</span>
        <button
          type="button"
          onClick={onRemove}
          style={{
            padding: '4px 10px',
            background: 'rgba(255,255,255,0.03)',
            border: 'none',
            borderRadius: '6px',
            fontSize: '11px',
            color: 'var(--foreground-muted)',
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={labelStyle}>Username</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
            <span style={{
              padding: '10px 12px',
              fontSize: '14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              color: 'var(--foreground-muted)',
              whiteSpace: 'nowrap',
            }}>
              {platform.prefix}
            </span>
            <input
              type="text"
              value={data.username || ''}
              onChange={e => onUpdate('username', e.target.value)}
              placeholder="yourusername"
              style={{ ...inputStyle, borderRadius: '0 8px 8px 0' }}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={data.email || ''}
            onChange={e => onUpdate('email', e.target.value)}
            placeholder="Account email"
            style={inputStyle}
          />
        </div>

        {/* Send password directly option */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          fontSize: '12px',
          color: 'rgba(240, 236, 232, 0.75)',
        }}>
          <input
            type="checkbox"
            checked={sendDirect}
            onChange={e => onSendDirect(e.target.checked)}
            style={{ accentColor: 'var(--palm-pink)' }}
          />
          I&apos;ll send my password directly to my manager
        </label>

        {!sendDirect ? (
          <div>
            <label style={labelStyle}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={data.password || ''}
                onChange={e => onUpdate('password', e.target.value)}
                placeholder="Account password"
                style={{ ...inputStyle, paddingRight: '40px' }}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '6px' }}>
              Only your account manager has access to your password. It&apos;s stored securely and encrypted.
            </div>
          </div>
        ) : (
          <div style={{
            background: 'rgba(232, 200, 120, 0.06)',
            border: '1px solid #FFE082',
            borderRadius: '8px',
            padding: '10px 14px',
            fontSize: '12px',
            color: 'rgba(240, 236, 232, 0.75)',
          }}>
            Please send your {platform.label} password to your manager via text or secure message before continuing.
          </div>
        )}
      </div>
    </div>
  )
}

export default function StepAccounts({ initialData = {}, onSave, saving }) {
  const [selectedPlatforms, setSelectedPlatforms] = useState([])
  const [platformData, setPlatformData] = useState({})
  const [socials, setSocials] = useState({
    tiktok: '',
    twitter: '',
    reddit: '',
    youtube: '',
    oftv: '',
    otherSocials: '',
  })

  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setSocials(prev => ({
        ...prev,
        tiktok: initialData.tiktok || '',
        twitter: initialData.twitter || '',
        reddit: initialData.reddit || '',
        youtube: initialData.youtube || '',
        oftv: initialData.oftv || '',
        otherSocials: initialData.otherSocials || '',
      }))
      // Restore selected platforms from initialData
      const restored = initialData.selectedPlatforms?.length > 0
        ? [...initialData.selectedPlatforms]
        : []
      const restoredData = {}

      // Restore from saved selectedPlatforms or detect from existing data
      if (initialData.ofUrl || initialData.ofEmail) {
        if (!restored.includes('freeOf')) restored.push('freeOf')
        restoredData.freeOf = {
          username: initialData.ofUrl || '',
          email: initialData.ofEmail || '',
          password: '',
        }
      }
      if (initialData.secondOfUrl || initialData.secondOfEmail) {
        if (!restored.includes('vipOf')) restored.push('vipOf')
        restoredData.vipOf = {
          username: initialData.secondOfUrl || '',
          email: initialData.secondOfEmail || '',
          password: '',
        }
      }
      if (initialData.fanslyUsername || initialData.fanslyEmail) {
        if (!restored.includes('fansly')) restored.push('fansly')
        restoredData.fansly = {
          username: initialData.fanslyUsername || '',
          email: initialData.fanslyEmail || '',
          password: '',
        }
      }
      if (restored.length > 0) {
        setSelectedPlatforms(restored)
        setPlatformData(restoredData)
      }
    }
  }, [initialData])

  const togglePlatform = (key) => {
    if (selectedPlatforms.includes(key)) {
      setSelectedPlatforms(prev => prev.filter(k => k !== key))
      // Keep the data in case they re-add — no data loss
    } else {
      setSelectedPlatforms(prev => [...prev, key])
      if (!platformData[key]) {
        setPlatformData(prev => ({ ...prev, [key]: { username: '', email: '', password: '', sendDirect: false } }))
      }
    }
  }

  const updatePlatform = (key, field, value) => {
    setPlatformData(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  const removePlatform = (key) => {
    setSelectedPlatforms(prev => prev.filter(k => k !== key))
  }

  const setSendDirect = (key, checked) => {
    setPlatformData(prev => ({
      ...prev,
      [key]: { ...prev[key], sendDirect: checked },
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    // Flatten platform data into the save format
    const data = { ...socials }

    const freeOf = platformData.freeOf
    const vipOf = platformData.vipOf
    const fansly = platformData.fansly

    if (selectedPlatforms.includes('freeOf') && freeOf) {
      data.ofUrl = freeOf.username || ''
      data.ofEmail = freeOf.email || ''
      data.ofPassword = freeOf.password || ''
      data.freeOfSendDirect = freeOf.sendDirect || false
    }
    if (selectedPlatforms.includes('vipOf') && vipOf) {
      data.secondOfUrl = vipOf.username || ''
      data.secondOfEmail = vipOf.email || ''
      data.secondOfPassword = vipOf.password || ''
      data.vipOfSendDirect = vipOf.sendDirect || false
    }
    if (selectedPlatforms.includes('fansly') && fansly) {
      data.fanslyUsername = fansly.username || ''
      data.fanslyEmail = fansly.email || ''
      data.fanslyPassword = fansly.password || ''
      data.fanslySendDirect = fansly.sendDirect || false
    }

    data.selectedPlatforms = selectedPlatforms

    onSave(data)
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
        Accounts & Access
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '20px' }}>
        We need access to your accounts to manage your page. All credentials are transmitted securely over HTTPS.
      </p>

      {/* Platform selection */}
      <div style={sectionHeaderStyle}>Which platforms do you use?</div>
      <div style={hintStyle}>Select all that apply. You can remove any you selected by mistake.</div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {PLATFORMS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => togglePlatform(p.key)}
            style={{
              padding: '10px 20px',
              borderRadius: '10px',
              border: selectedPlatforms.includes(p.key) ? '1px solid var(--palm-pink)' : '1px solid var(--white-8)',
              background: selectedPlatforms.includes(p.key) ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.08)',
              color: selectedPlatforms.includes(p.key) ? 'var(--palm-pink)' : 'rgba(240, 236, 232, 0.75)',
              fontSize: '13px',
              fontWeight: selectedPlatforms.includes(p.key) ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {selectedPlatforms.includes(p.key) ? '✓ ' : ''}{p.label}
          </button>
        ))}
      </div>

      {/* Platform credential cards */}
      {selectedPlatforms.map(key => {
        const platform = PLATFORMS.find(p => p.key === key)
        if (!platform) return null
        return (
          <PlatformCard
            key={key}
            platform={platform}
            data={platformData[key] || {}}
            onUpdate={(field, value) => updatePlatform(key, field, value)}
            onRemove={() => removePlatform(key)}
            onSendDirect={(checked) => setSendDirect(key, checked)}
          />
        )
      })}

      {/* Social Accounts */}
      <div style={sectionHeaderStyle}>Social Media Accounts</div>
      <div style={hintStyle}>Add your handles or profile URLs for each platform you use.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '500px' }}>
        <div>
          <label style={labelStyle}>TikTok</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
            <span style={{
              padding: '10px 12px',
              fontSize: '14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              color: 'var(--foreground-muted)',
              whiteSpace: 'nowrap',
            }}>@</span>
            <input
              type="text"
              value={socials.tiktok}
              onChange={e => setSocials(prev => ({ ...prev, tiktok: e.target.value }))}
              placeholder="yourhandle"
              style={{ ...inputStyle, borderRadius: '0 8px 8px 0' }}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Twitter / X</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
            <span style={{
              padding: '10px 12px',
              fontSize: '14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              color: 'var(--foreground-muted)',
              whiteSpace: 'nowrap',
            }}>@</span>
            <input
              type="text"
              value={socials.twitter}
              onChange={e => setSocials(prev => ({ ...prev, twitter: e.target.value }))}
              placeholder="yourhandle"
              style={{ ...inputStyle, borderRadius: '0 8px 8px 0' }}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Reddit</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
            <span style={{
              padding: '10px 12px',
              fontSize: '14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              color: 'var(--foreground-muted)',
              whiteSpace: 'nowrap',
            }}>u/</span>
            <input
              type="text"
              value={socials.reddit}
              onChange={e => setSocials(prev => ({ ...prev, reddit: e.target.value }))}
              placeholder="yourname"
              style={{ ...inputStyle, borderRadius: '0 8px 8px 0' }}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>YouTube</label>
          <input
            type="text"
            value={socials.youtube}
            onChange={e => setSocials(prev => ({ ...prev, youtube: e.target.value }))}
            placeholder="Channel URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>OFTV</label>
          <input
            type="text"
            value={socials.oftv}
            onChange={e => setSocials(prev => ({ ...prev, oftv: e.target.value }))}
            placeholder="OFTV profile URL (optional)"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Other Social Accounts</label>
          <textarea
            value={socials.otherSocials}
            onChange={e => setSocials(prev => ({ ...prev, otherSocials: e.target.value }))}
            placeholder="Any other platforms (Snapchat, etc.) — one per line"
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
          background: saving ? 'transparent' : 'var(--palm-pink)',
          color: 'rgba(255,255,255,0.08)',
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
