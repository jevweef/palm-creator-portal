'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
  const [commissionTiers, setCommissionTiers] = useState([{ pct: '', upTo: '' }])
  const [formState, setFormState] = useState('')
  const [editCreator, setEditCreator] = useState(null) // for inline "Start Onboarding" modal
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(null)
  const [filter, setFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const sigCanvasRef = useRef(null)
  const [isSigDrawing, setIsSigDrawing] = useState(false)
  const [hasSigDrawn, setHasSigDrawn] = useState(false)

  const getSigPos = (e) => {
    const canvas = sigCanvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
  const startSigDraw = (e) => {
    e.preventDefault()
    const ctx = sigCanvasRef.current.getContext('2d')
    const pos = getSigPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsSigDrawing(true)
  }
  const sigDraw = (e) => {
    if (!isSigDrawing) return
    e.preventDefault()
    const ctx = sigCanvasRef.current.getContext('2d')
    const pos = getSigPos(e)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#000'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasSigDrawn(true)
  }
  const endSigDraw = () => setIsSigDrawing(false)
  const clearSigCanvas = () => {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSigDrawn(false)
  }

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
    if (!hasSigDrawn) return
    setSubmitting(true)
    try {
      const agencySignature = sigCanvasRef.current?.toDataURL('image/png') || null
      const res = await fetch('/api/admin/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, email: formEmail, commissionTiers, creatorState: formState, agencySignature }),
      })
      const data = await res.json()
      if (res.ok) {
        await navigator.clipboard.writeText(data.onboardingUrl)
        setCopied('new')
        setTimeout(() => setCopied(null), 3000)
        setShowModal(false)
        setFormName('')
        setFormEmail('')
        setCommissionTiers([{ pct: '', upTo: '' }])
        setFormState('')
        setHasSigDrawn(false)
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

  const openEditModal = (creator) => {
    setEditCreator(creator)
    setFormName(creator.name || '')
    setFormEmail(creator.email || '')
    setCommissionTiers([{ pct: '', upTo: '' }])
    setFormState('')
  }

  const handleStartExisting = async (e) => {
    e.preventDefault()
    if (!editCreator) return
    if (!hasSigDrawn) return
    setSubmitting(true)
    try {
      const agencySignature = sigCanvasRef.current?.toDataURL('image/png') || null
      const res = await fetch('/api/admin/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName || editCreator.name,
          email: formEmail || editCreator.email,
          commissionTiers,
          creatorState: formState,
          agencySignature,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        await navigator.clipboard.writeText(data.onboardingUrl)
        setCopied('new')
        setTimeout(() => setCopied(null), 3000)
        setEditCreator(null)
        fetchCreators()
      }
    } catch (err) {
      console.error('Start existing error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyLink = async (creator) => {
    if (!creator.hasToken) return
    await handleResend(creator.id)
  }

  const filtered = creators.filter(c => {
    const obMatch = filter === 'all' ? true
      : filter === 'No Status' ? !c.onboardingStatus
      : c.onboardingStatus === filter
    const stMatch = statusFilter === 'all' ? true
      : statusFilter === 'No Status' ? !c.status
      : c.status === statusFilter
    return obMatch && stMatch
  })

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
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
          {['all', 'Lead', 'Onboarding', 'Active', 'Offboarded'].map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                padding: '5px 12px',
                borderRadius: '20px',
                border: 'none',
                fontSize: '12px',
                fontWeight: statusFilter === f ? 600 : 400,
                background: statusFilter === f ? '#E88FAC' : '#fff',
                color: statusFilter === f ? '#fff' : '#666',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '20px', background: '#e0e0e0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Onboarding</span>
          {['all', 'Not Started', 'Link Sent', 'In Progress', 'Completed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px',
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
                <th style={thStyle}>Onboarding</th>
                <th style={thStyle}>Link Sent</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
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
                      {c.status ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          ...({
                            'Lead': { bg: '#FCE4EC', color: '#E88FAC' },
                            'Onboarding': { bg: '#FFF8E1', color: '#F9A825' },
                            'Active': { bg: '#E8F5E9', color: '#43A047' },
                            'Offboarded': { bg: '#FFF3E0', color: '#EF6C00' },
                          }[c.status] || { bg: '#f5f5f5', color: '#999' }),
                        }}>
                          {c.status}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#ccc' }}>—</span>
                      )}
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
                        {(!c.onboardingStatus || c.onboardingStatus === 'Not Started') && (
                          <button
                            onClick={() => openEditModal(c)}
                            style={{ ...actionBtnStyle, background: '#E88FAC', color: '#fff' }}
                          >
                            Start Onboarding
                          </button>
                        )}
                        {c.onboardingStatus && c.onboardingStatus !== 'Completed' && c.onboardingStatus !== 'Not Started' && (
                          <button
                            onClick={() => handleResend(c.id)}
                            style={actionBtnStyle}
                          >
                            {copied === c.id ? 'Copied!' : 'Copy Link'}
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
              <div style={{ marginBottom: '14px' }}>
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
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Creator&apos;s State
                </label>
                <input
                  type="text"
                  value={formState}
                  onChange={e => setFormState(e.target.value)}
                  placeholder="e.g. Idaho"
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

              {/* Commission Tiers */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '8px' }}>
                  Commission Structure
                </label>
                {commissionTiers.map((tier, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={tier.pct}
                      onChange={e => {
                        const updated = [...commissionTiers]
                        updated[i] = { ...updated[i], pct: e.target.value }
                        setCommissionTiers(updated)
                      }}
                      placeholder="%"
                      style={{
                        width: '70px',
                        padding: '10px 12px',
                        fontSize: '14px',
                        border: '1px solid #e0e0e0',
                        borderRadius: '8px',
                        outline: 'none',
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: '13px', color: '#666', whiteSpace: 'nowrap' }}>
                      {i === 0 ? 'up to' : 'above'}
                    </span>
                    {i < commissionTiers.length - 1 ? (
                      <input
                        type="number"
                        min="0"
                        value={tier.upTo}
                        onChange={e => {
                          const updated = [...commissionTiers]
                          updated[i] = { ...updated[i], upTo: e.target.value }
                          setCommissionTiers(updated)
                        }}
                        placeholder="$/month"
                        style={{
                          width: '120px',
                          padding: '10px 12px',
                          fontSize: '14px',
                          border: '1px solid #e0e0e0',
                          borderRadius: '8px',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: '13px', color: '#666' }}>
                        {commissionTiers.length > 1 ? `$${Number(commissionTiers[i - 1]?.upTo || 0).toLocaleString()}/month` : '—'}
                      </span>
                    )}
                    <span style={{ fontSize: '13px', color: '#999' }}>/month</span>
                    {commissionTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCommissionTiers(commissionTiers.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                      >
                        x
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCommissionTiers([...commissionTiers, { pct: '', upTo: '' }])}
                  style={{
                    background: 'none',
                    border: '1px dashed #ddd',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    color: '#999',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  + Add Tier
                </button>
              </div>

              {/* Agency Signature */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Agency Signature (Josh Voto)
                </label>
                <canvas
                  ref={sigCanvasRef}
                  width={500}
                  height={140}
                  onMouseDown={startSigDraw}
                  onMouseMove={sigDraw}
                  onMouseUp={endSigDraw}
                  onMouseLeave={endSigDraw}
                  onTouchStart={startSigDraw}
                  onTouchMove={sigDraw}
                  onTouchEnd={endSigDraw}
                  style={{
                    border: `1px solid ${hasSigDrawn ? '#E88FAC' : '#e0e0e0'}`,
                    borderRadius: '8px',
                    cursor: 'crosshair',
                    width: '100%',
                    maxWidth: '500px',
                    touchAction: 'none',
                    display: 'block',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={clearSigCanvas}
                    style={{ padding: '3px 10px', background: '#f5f5f5', border: 'none', borderRadius: '6px', fontSize: '11px', color: '#999', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                  {!hasSigDrawn && (
                    <span style={{ fontSize: '11px', color: '#E88FAC' }}>Signature required</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setHasSigDrawn(false) }}
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
                  disabled={submitting || !hasSigDrawn}
                  style={{
                    padding: '9px 18px',
                    background: (submitting || !hasSigDrawn) ? '#F0D0D8' : '#E88FAC',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: (submitting || !hasSigDrawn) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Creating...' : 'Create & Copy Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Inline Start Onboarding Modal (for existing creators) */}
      {editCreator && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
          onClick={() => setEditCreator(null)}
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
              Start Onboarding — {editCreator.name}
            </h2>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '20px' }}>
              Set commission and state, then send the onboarding link. Status will be set to Onboarding.
            </p>

            <form onSubmit={handleStartExisting}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Creator&apos;s State
                </label>
                <input
                  type="text"
                  value={formState}
                  onChange={e => setFormState(e.target.value)}
                  placeholder="e.g. Idaho"
                  style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #e0e0e0', borderRadius: '8px', outline: 'none' }}
                />
              </div>

              {/* Commission Tiers */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '8px' }}>
                  Commission Structure
                </label>
                {commissionTiers.map((tier, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={tier.pct}
                      onChange={e => {
                        const updated = [...commissionTiers]
                        updated[i] = { ...updated[i], pct: e.target.value }
                        setCommissionTiers(updated)
                      }}
                      placeholder="%"
                      style={{ width: '70px', padding: '10px 12px', fontSize: '14px', border: '1px solid #e0e0e0', borderRadius: '8px', outline: 'none', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '13px', color: '#666', whiteSpace: 'nowrap' }}>
                      {i === 0 ? 'up to' : 'above'}
                    </span>
                    {i < commissionTiers.length - 1 ? (
                      <input
                        type="number"
                        min="0"
                        value={tier.upTo}
                        onChange={e => {
                          const updated = [...commissionTiers]
                          updated[i] = { ...updated[i], upTo: e.target.value }
                          setCommissionTiers(updated)
                        }}
                        placeholder="$/month"
                        style={{ width: '120px', padding: '10px 12px', fontSize: '14px', border: '1px solid #e0e0e0', borderRadius: '8px', outline: 'none' }}
                      />
                    ) : (
                      <span style={{ fontSize: '13px', color: '#666' }}>
                        {commissionTiers.length > 1 ? `$${Number(commissionTiers[i - 1]?.upTo || 0).toLocaleString()}/month` : '—'}
                      </span>
                    )}
                    <span style={{ fontSize: '13px', color: '#999' }}>/month</span>
                    {commissionTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCommissionTiers(commissionTiers.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                      >
                        x
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCommissionTiers([...commissionTiers, { pct: '', upTo: '' }])}
                  style={{ background: 'none', border: '1px dashed #ddd', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: '#999', cursor: 'pointer', width: '100%' }}
                >
                  + Add Tier
                </button>
              </div>

              {!editCreator.email && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    placeholder="Their communication email"
                    required
                    style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #e0e0e0', borderRadius: '8px', outline: 'none' }}
                  />
                </div>
              )}

              {/* Agency Signature */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Agency Signature (Josh Voto)
                </label>
                <canvas
                  ref={sigCanvasRef}
                  width={500}
                  height={140}
                  onMouseDown={startSigDraw}
                  onMouseMove={sigDraw}
                  onMouseUp={endSigDraw}
                  onMouseLeave={endSigDraw}
                  onTouchStart={startSigDraw}
                  onTouchMove={sigDraw}
                  onTouchEnd={endSigDraw}
                  style={{
                    border: `1px solid ${hasSigDrawn ? '#E88FAC' : '#e0e0e0'}`,
                    borderRadius: '8px',
                    cursor: 'crosshair',
                    width: '100%',
                    maxWidth: '500px',
                    touchAction: 'none',
                    display: 'block',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={clearSigCanvas}
                    style={{ padding: '3px 10px', background: '#f5f5f5', border: 'none', borderRadius: '6px', fontSize: '11px', color: '#999', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                  {!hasSigDrawn && (
                    <span style={{ fontSize: '11px', color: '#E88FAC' }}>Signature required</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setEditCreator(null); setHasSigDrawn(false) }}
                  style={{ padding: '9px 18px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !hasSigDrawn}
                  style={{
                    padding: '9px 18px',
                    background: (submitting || !hasSigDrawn) ? '#F0D0D8' : '#E88FAC',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: (submitting || !hasSigDrawn) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Starting...' : 'Start & Copy Link'}
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
