'use client'

import { useState, useEffect, useCallback } from 'react'

const STATUS_COLORS = {
  'Not Started': { bg: '#f5f5f5', color: '#999' },
  'Link Sent': { bg: '#FFF8E1', color: '#F9A825' },
  'In Progress': { bg: '#E3F2FD', color: '#1E88E5' },
  'Completed': { bg: '#E8F5E9', color: '#43A047' },
}

export default function AdminOnboarding() {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(null)
  const [filter, setFilter] = useState('all')

  const fetchCreators = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/onboarding/status')
      const data = await res.json()
      setCreators(data.creators || [])
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCreators() }, [fetchCreators])

  const handleStartOnboarding = async (e) => {
    e.preventDefault()
    if (!formName || !formEmail) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, email: formEmail }),
      })
      const data = await res.json()
      if (res.ok) {
        await navigator.clipboard.writeText(data.onboardingUrl)
        setCopied('new')
        setTimeout(() => setCopied(null), 3000)
        setShowModal(false)
        setFormName('')
        setFormEmail('')
        fetchCreators()
      }
    } catch (err) {
      console.error('Start onboarding error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleResend = async (hqId) => {
    try {
      const res = await fetch('/api/admin/onboarding/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      const data = await res.json()
      if (res.ok) {
        await navigator.clipboard.writeText(data.onboardingUrl)
        setCopied(hqId)
        setTimeout(() => setCopied(null), 3000)
        fetchCreators()
      }
    } catch (err) {
      console.error('Resend error:', err)
    }
  }

  const handleCopyLink = async (creator) => {
    if (!creator.hasToken) return
    // Reconstruct URL from existing token - just resend to get a fresh link copied
    await handleResend(creator.id)
  }

  const filtered = filter === 'all'
    ? creators
    : filter === 'No Status'
      ? creators.filter(c => !c.onboardingStatus)
      : creators.filter(c => c.onboardingStatus === filter)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>
            Onboarding
          </h1>
          <p style={{ fontSize: '13px', color: '#999' }}>
            Start onboarding for new creators and track their progress.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: '10px 20px',
            background: '#E88FAC',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Start Onboarding
        </button>
      </div>

      {copied === 'new' && (
        <div style={{
          background: '#E8F5E9',
          color: '#2E7D32',
          padding: '10px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          marginBottom: '16px',
        }}>
          Onboarding link copied to clipboard!
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {['all', 'No Status', 'Not Started', 'Link Sent', 'In Progress', 'Completed'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: 'none',
              fontSize: '12px',
              fontWeight: filter === f ? 600 : 400,
              background: filter === f ? '#E88FAC' : '#fff',
              color: filter === f ? '#fff' : '#666',
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Creators table */}
      {loading ? (
        <div style={{ color: '#999', fontSize: '14px', padding: '40px', textAlign: 'center' }}>Loading...</div>
      ) : (
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <th style={thStyle}>Creator</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Link Sent</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
                    No creators found.
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{c.name || '—'}</div>
                      {c.aka && <div style={{ fontSize: '11px', color: '#999' }}>{c.aka}</div>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '13px', color: '#666' }}>{c.email || '—'}</span>
                    </td>
                    <td style={tdStyle}>
                      {c.onboardingStatus ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          ...(STATUS_COLORS[c.onboardingStatus] || STATUS_COLORS['Not Started']),
                        }}>
                          {c.onboardingStatus}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#ccc' }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '12px', color: '#999' }}>
                        {c.tokenCreatedAt ? new Date(c.tokenCreatedAt).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {c.onboardingStatus !== 'Completed' && (
                          <button
                            onClick={() => handleResend(c.id)}
                            style={actionBtnStyle}
                          >
                            {copied === c.id ? 'Copied!' : c.hasToken ? 'Copy Link' : 'Send Link'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Start Onboarding Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '16px',
              padding: '28px',
              width: '420px',
              maxWidth: '90vw',
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
              Start Onboarding
            </h2>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>
              Enter the creator&apos;s name and email. We&apos;ll check for an existing record first.
            </p>

            <form onSubmit={handleStartOnboarding}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Creator Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Full name or stage name"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: '14px',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  placeholder="Their communication email"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: '14px',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '9px 18px',
                    background: '#f5f5f5',
                    color: '#666',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '9px 18px',
                    background: submitting ? '#F0D0D8' : '#E88FAC',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Creating...' : 'Create & Copy Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const thStyle = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: '11px',
  fontWeight: 600,
  color: '#999',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const tdStyle = {
  padding: '12px 16px',
  fontSize: '13px',
  color: '#1a1a1a',
}

const actionBtnStyle = {
  padding: '5px 12px',
  background: '#FFF0F3',
  color: '#E88FAC',
  border: 'none',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
}
