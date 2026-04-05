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

const PLATFORMS = [
  { key: 'freeOf', label: 'Free OnlyFans', prefix: 'onlyfans.com/' },
  { key: 'vipOf', label: 'VIP OnlyFans', prefix: 'onlyfans.com/' },
  { key: 'fansly', label: 'Fansly', prefix: 'fansly.com/' },
]

function PlatformCard({ platform, data, onUpdate, onRemove, onSendDirect }) {
  const sendDirect = data.sendDirect || false

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e0e0e0',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{platform.label}</span>
        <button
          type="button"
          onClick={onRemove}
          style={{
            padding: '4px 10px',
            background: '#f5f5f5',
            border: 'none',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#999',
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>

      {/* Send directly option */}
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '14px',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#666',
      }}>
        <input
          type="checkbox"
          checked={sendDirect}
          onChange={e => onSendDirect(e.target.checked)}
          style={{ accentColor: '#E88FAC' }}
        />
        I&apos;ll send these credentials directly to my manager
      </label>

      {!sendDirect && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Username</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              <span style={{
                padding: '10px 12px',
                fontSize: '14px',
                background: '#f5f5f5',
                border: '1px solid #e0e0e0',
                borderRight: 'none',
                borderRadius: '8px 0 0 8px',
                color: '#999',
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
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={data.password || ''}
              onChange={e => onUpdate('password', e.target.value)}
              placeholder="Account password"
              style={inputStyle}
              autoComplete="off"
            />
          </div>
        </div>
      )}

      {sendDirect && (
        <div style={{
          background: '#FFF8E1',
          border: '1px solid #FFE082',
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '12px',
          color: '#666',
        }}>
          Please send your {platform.label} credentials to your manager via text or secure message before continuing.
        </div>
      )}
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
      const restored = []
      const restoredData = {}
      if (initialData.ofUrl || initialData.ofEmail) {
        // Try to detect which platform based on existing data
        restored.push('freeOf')
        restoredData.freeOf = {
          username: initialData.ofUrl || '',
          email: initialData.ofEmail || '',
          password: '',
        }
      }
      if (initialData.secondOfEmail) {
        restored.push('vipOf')
        restoredData.vipOf = {
          username: '',
          email: initialData.secondOfEmail || '',
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
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Accounts & Access
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>
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
              border: selectedPlatforms.includes(p.key) ? '2px solid #E88FAC' : '2px solid #e0e0e0',
              background: selectedPlatforms.includes(p.key) ? '#FFF0F3' : '#fff',
              color: selectedPlatforms.includes(p.key) ? '#E88FAC' : '#666',
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
          <input
            type="text"
            value={socials.tiktok}
            onChange={e => setSocials(prev => ({ ...prev, tiktok: e.target.value }))}
            placeholder="@handle or URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Twitter / X</label>
          <input
            type="text"
            value={socials.twitter}
            onChange={e => setSocials(prev => ({ ...prev, twitter: e.target.value }))}
            placeholder="@handle or URL"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Reddit</label>
          <input
            type="text"
            value={socials.reddit}
            onChange={e => setSocials(prev => ({ ...prev, reddit: e.target.value }))}
            placeholder="u/username or URL"
            style={inputStyle}
          />
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
