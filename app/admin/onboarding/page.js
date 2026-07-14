'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import OffboardModal from '../OffboardModal'

const STATUS_COLORS = {
  'Not Started': { bg: 'rgba(255,255,255,0.03)', color: 'var(--foreground-muted)' },
  'Link Sent': { bg: 'rgba(232, 200, 120, 0.06)', color: '#F9A825' },
  'In Progress': { bg: '#E3F2FD', color: '#1E88E5' },
  'Completed': { bg: 'rgba(125, 211, 164, 0.08)', color: '#43A047' },
}

export default function AdminOnboarding() {
  const router = useRouter()
  const { user } = useUser()
  const adminName = user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Agency Representative'
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [commissionTiers, setCommissionTiers] = useState([{ pct: '', upTo: '' }])
  const [formState, setFormState] = useState('')
  const [editCreator, setEditCreator] = useState(null) // for inline "Start Onboarding" modal
  const [contractFile, setContractFile] = useState(null) // optional custom signed contract to attach
  const [contractMode, setContractMode] = useState('generate') // 'generate' (build + e-sign) | 'upload' (already-signed PDF)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(null)
  const [filter, setFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [surveyModal, setSurveyModal] = useState(null) // { creatorName, hqId, sections, loading }
  const [offboardTarget, setOffboardTarget] = useState(null) // { hqId, name, aka }
  const [offboardResult, setOffboardResult] = useState(null)

  const sigCanvasRef = useRef(null)
  const [isSigDrawing, setIsSigDrawing] = useState(false)
  const [hasSigDrawn, setHasSigDrawn] = useState(false)

  const getSigPos = (e) => {
    const canvas = sigCanvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
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
  const endSigDraw = () => {
    setIsSigDrawing(false)
    // Auto-save signature after each stroke
    if (sigCanvasRef.current && hasSigDrawn) {
      try { localStorage.setItem('palm_agency_sig', sigCanvasRef.current.toDataURL('image/png')) } catch {}
    }
  }
  const loadSavedSig = useCallback(() => {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    const saved = localStorage.getItem('palm_agency_sig')
    if (!saved) return
    const img = new Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      setHasSigDrawn(true)
    }
    img.src = saved
  }, [])
  const clearSigCanvas = (clearSaved = false) => {
    const canvas = sigCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSigDrawn(false)
    if (clearSaved) {
      try { localStorage.removeItem('palm_agency_sig') } catch {}
    }
  }

  // Load saved signature when either modal opens
  useEffect(() => {
    if (showModal || editCreator) {
      // Small delay to ensure canvas is mounted
      setTimeout(() => loadSavedSig(), 50)
    }
  }, [showModal, editCreator, loadSavedSig])

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

  // If the admin attached a custom signed contract, upload it to the new
  // creator so onboarding shows THAT instead of the auto-generated template.
  const uploadContractFor = async (hqId) => {
    if (!contractFile || !hqId) return
    const fd = new FormData()
    fd.append('hqId', hqId)
    fd.append('file', contractFile)
    try {
      await fetch('/api/admin/onboarding/upload-contract', { method: 'POST', body: fd })
    } catch (err) { console.error('Custom contract upload error:', err) }
  }

  const handleStartOnboarding = async (e) => {
    e.preventDefault()
    if (!formName || !formEmail) return
    // Contract is either generated (needs the agency signature) or an
    // already-signed PDF upload (needs the file, no signature).
    if (contractMode === 'generate' && !hasSigDrawn) return
    if (contractMode === 'upload' && !contractFile) return
    setSubmitting(true)
    try {
      const agencySignature = contractMode === 'generate' ? (sigCanvasRef.current?.toDataURL('image/png') || null) : null
      const res = await fetch('/api/admin/onboarding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, email: formEmail, commissionTiers, creatorState: formState, agencySignature, agencyName: adminName, skipContract: contractMode === 'later' }),
      })
      const data = await res.json()
      if (res.ok) {
        await uploadContractFor(data.hqId)
        await navigator.clipboard.writeText(data.onboardingUrl)
        setCopied('new')
        setTimeout(() => setCopied(null), 3000)
        setShowModal(false)
        setFormName('')
        setFormEmail('')
        setCommissionTiers([{ pct: '', upTo: '' }])
        setFormState('')
        setHasSigDrawn(false)
        setContractFile(null)
        setContractMode('generate')
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

  const viewSurveyAnswers = async (creator) => {
    setSurveyModal({ creatorName: creator.name || creator.aka, hqId: creator.id, sections: null, loading: true })
    try {
      const res = await fetch(`/api/admin/onboarding/survey-export?hqId=${creator.id}&format=json`)
      const data = await res.json()
      if (res.ok) {
        setSurveyModal(prev => ({ ...prev, sections: data.sections, loading: false }))
      } else {
        setSurveyModal(prev => ({ ...prev, sections: {}, loading: false }))
      }
    } catch {
      setSurveyModal(prev => ({ ...prev, sections: {}, loading: false }))
    }
  }

  const downloadSurveyCsv = (hqId) => {
    window.open(`/api/admin/onboarding/survey-export?hqId=${hqId}&format=csv`, '_blank')
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
          agencyName: adminName,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        await uploadContractFor(data.hqId)
        await navigator.clipboard.writeText(data.onboardingUrl)
        setCopied('new')
        setTimeout(() => setCopied(null), 3000)
        setEditCreator(null)
        setContractFile(null)
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
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '4px' }}>
            Onboarding
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            Start onboarding for new creators and track their progress.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: '10px 20px',
            background: 'var(--palm-pink)',
            color: '#060606',
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
          background: 'rgba(125, 211, 164, 0.08)',
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
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
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
                background: statusFilter === f ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)',
                color: statusFilter === f ? 'var(--foreground)' : 'rgba(240, 236, 232, 0.75)',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Onboarding</span>
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
                background: filter === f ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)',
                color: filter === f ? 'var(--foreground)' : 'rgba(240, 236, 232, 0.75)',
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
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px', padding: '40px', textAlign: 'center' }}>Loading...</div>
      ) : (
        <div style={{
          background: 'var(--card-bg-solid)',
          borderRadius: '16px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid transparent' }}>
                <th style={thStyle}>Creator</th>
                <th style={thStyle}>Communication Email</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Onboarding</th>
                <th style={thStyle}>Link Sent</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '13px' }}>
                    No creators found.
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/admin/onboarding/${c.id}`)}
                    title="Open onboarding workspace"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
                  >
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{c.name || '—'}</div>
                      {c.aka && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{c.aka}</div>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)' }}>{c.email || '—'}</span>
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
                            'Lead': { bg: '#FCE4EC', color: 'var(--palm-pink)' },
                            'Onboarding': { bg: 'rgba(232, 200, 120, 0.06)', color: '#F9A825' },
                            'Active': { bg: 'rgba(125, 211, 164, 0.08)', color: '#43A047' },
                            'Offboarded': { bg: '#FFF3E0', color: '#EF6C00' },
                          }[c.status] || { bg: 'rgba(255,255,255,0.03)', color: 'var(--foreground-muted)' }),
                        }}>
                          {c.status}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--foreground-subtle)' }}>—</span>
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
                        <span style={{ fontSize: '12px', color: 'var(--foreground-subtle)' }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                        {c.tokenCreatedAt ? new Date(c.tokenCreatedAt).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td style={tdStyle} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => router.push(`/admin/onboarding/${c.id}`)}
                          style={{ ...actionBtnStyle, background: 'rgba(232, 160, 160, 0.12)', color: 'var(--palm-pink)', fontWeight: 600 }}
                        >
                          Checklist
                        </button>
                        {(!c.onboardingStatus || c.onboardingStatus === 'Not Started') && (
                          <button
                            onClick={() => openEditModal(c)}
                            style={actionBtnStyle}
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
                        {(c.onboardingStatus === 'In Progress' || c.onboardingStatus === 'Completed') && (
                          <button
                            onClick={() => viewSurveyAnswers(c)}
                            style={{ ...actionBtnStyle, background: '#E3F2FD', color: '#1E88E5' }}
                          >
                            View Answers
                          </button>
                        )}
                        <a
                          href={`/admin/onboarding/${c.id}/photos`}
                          style={{ ...actionBtnStyle, textDecoration: 'none', display: 'inline-block', background: 'rgba(255,255,255,0.05)', color: 'var(--foreground)' }}
                        >
                          Photos
                        </a>
                        {c.status === 'Active' && (
                          <button
                            onClick={() => setOffboardTarget({ hqId: c.id, name: c.name, aka: c.aka })}
                            style={{ ...actionBtnStyle, background: 'rgba(194, 84, 80, 0.12)', color: '#C25450' }}
                          >
                            Offboard
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
          padding: '20px',
          overflowY: 'auto',
        }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: 'var(--card-bg-solid)',
              borderRadius: '16px',
              padding: '28px',
              width: '420px',
              maxWidth: '90vw',
              maxHeight: 'calc(100vh - 40px)',
              overflowY: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
              Start Onboarding
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '20px' }}>
              Enter the creator&apos;s name and communication email. This email will be their portal login.
            </p>

            <form onSubmit={handleStartOnboarding}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Full Legal Name <span style={{ color: 'var(--palm-pink)' }}>*</span>
                </label>
                <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '6px', lineHeight: '1.4' }}>
                  Their real legal name (for the contract) — <strong>not</strong> their stage/AKA name.
                </div>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Emma Johnson"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: '14px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '8px',
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Communication Email <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}>(used to log into their portal)</span>
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  placeholder="The email they'll use to log in"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: '14px',
                    border: '1px solid rgba(255,255,255,0.08)',
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
                    border: '1px solid rgba(255,255,255,0.08)',
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
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        outline: 'none',
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', whiteSpace: 'nowrap' }}>
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
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '8px',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)' }}>
                        {commissionTiers.length > 1 ? `$${Number(commissionTiers[i - 1]?.upTo || 0).toLocaleString()}/month` : '—'}
                      </span>
                    )}
                    <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>/month</span>
                    {commissionTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCommissionTiers(commissionTiers.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
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
                    color: 'var(--foreground-muted)',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  + Add Tier
                </button>
              </div>

              {/* Contract — mutually exclusive: EITHER generate one from the
                  commission terms and e-sign it, OR upload an already-signed PDF.
                  Commission Structure above still applies to both (it's the rate). */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '8px' }}>
                  Contract
                </label>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => setContractMode('generate')} style={contractTabStyle(contractMode === 'generate')}>
                    Generate &amp; e-sign
                  </button>
                  <button type="button" onClick={() => setContractMode('upload')} style={contractTabStyle(contractMode === 'upload')}>
                    Upload signed PDF
                  </button>
                  <button type="button" onClick={() => setContractMode('later')} style={contractTabStyle(contractMode === 'later')}>
                    Handle separately
                  </button>
                </div>

                {contractMode === 'later' ? (
                  <div style={{
                    padding: '16px', borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)',
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(240, 236, 232, 0.9)', marginBottom: '4px' }}>
                      Contract handled separately
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
                      The creator won&apos;t see a contract step — they can fill out everything else now.
                      You&apos;ll still need to upload the signed contract later (from their onboarding board)
                      before they can go live.
                    </div>
                  </div>
                ) : contractMode === 'generate' ? (
                  <>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '8px' }}>
                      Our system builds the contract from the commission terms above — sign below to finalize it.
                    </div>
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
                        border: `1px solid ${hasSigDrawn ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: '8px',
                        cursor: 'crosshair',
                        width: '100%',
                        maxWidth: '500px',
                        touchAction: 'none',
                        display: 'block',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Agency signature ({adminName})</span>
                      <button
                        type="button"
                        onClick={() => clearSigCanvas(false)}
                        style={{ padding: '3px 10px', background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer' }}
                      >
                        Redraw
                      </button>
                      {localStorage.getItem('palm_agency_sig') && (
                        <button
                          type="button"
                          onClick={() => clearSigCanvas(true)}
                          style={{ padding: '3px 10px', background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer' }}
                        >
                          Clear Saved
                        </button>
                      )}
                      {!hasSigDrawn && (
                        <span style={{ fontSize: '11px', color: 'var(--palm-pink)' }}>Signature required</span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <label
                      htmlFor="customContractNew"
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                        padding: '22px', borderRadius: '10px', cursor: 'pointer', textAlign: 'center',
                        border: `1.5px dashed ${contractFile ? 'var(--palm-pink)' : 'rgba(255,255,255,0.18)'}`,
                        background: contractFile ? 'rgba(224, 122, 195, 0.06)' : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 600, color: contractFile ? 'var(--palm-pink)' : 'rgba(240, 236, 232, 0.75)' }}>
                        {contractFile ? contractFile.name : 'Choose a signed PDF'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
                        {contractFile ? 'Click to replace' : 'Click to browse — this replaces the generated contract'}
                      </span>
                      <input
                        id="customContractNew"
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={e => setContractFile(e.target.files?.[0] || null)}
                        style={{ display: 'none' }}
                      />
                    </label>
                    <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '6px' }}>
                      This PDF is already signed, so no agency signature is needed.
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setHasSigDrawn(false); setContractMode('generate') }}
                  style={{
                    padding: '9px 18px',
                    background: 'rgba(255,255,255,0.03)',
                    color: 'rgba(240, 236, 232, 0.75)',
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
                  disabled={submitting || (contractMode === 'generate' ? !hasSigDrawn : contractMode === 'upload' ? !contractFile : false)}
                  style={{
                    padding: '9px 18px',
                    background: (submitting || (contractMode === 'generate' ? !hasSigDrawn : contractMode === 'upload' ? !contractFile : false)) ? 'transparent' : 'var(--palm-pink)',
                    color: 'var(--foreground)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: (submitting || (contractMode === 'generate' ? !hasSigDrawn : contractMode === 'upload' ? !contractFile : false)) ? 'not-allowed' : 'pointer',
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
          padding: '20px',
          overflowY: 'auto',
        }}
          onClick={() => setEditCreator(null)}
        >
          <div
            style={{
              background: 'var(--card-bg-solid)',
              borderRadius: '16px',
              padding: '28px',
              width: '420px',
              maxWidth: '90vw',
              maxHeight: 'calc(100vh - 40px)',
              overflowY: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
              Start Onboarding — {editCreator.name}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '20px' }}>
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
                  style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', outline: 'none' }}
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
                      style={{ width: '70px', padding: '10px 12px', fontSize: '14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', outline: 'none', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', whiteSpace: 'nowrap' }}>
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
                        style={{ width: '120px', padding: '10px 12px', fontSize: '14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', outline: 'none' }}
                      />
                    ) : (
                      <span style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)' }}>
                        {commissionTiers.length > 1 ? `$${Number(commissionTiers[i - 1]?.upTo || 0).toLocaleString()}/month` : '—'}
                      </span>
                    )}
                    <span style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>/month</span>
                    {commissionTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCommissionTiers(commissionTiers.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: 'var(--foreground-subtle)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                      >
                        x
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCommissionTiers([...commissionTiers, { pct: '', upTo: '' }])}
                  style={{ background: 'none', border: '1px dashed #ddd', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: 'var(--foreground-muted)', cursor: 'pointer', width: '100%' }}
                >
                  + Add Tier
                </button>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Communication Email <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}>(used to log into their portal)</span>
                </label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={e => setFormEmail(e.target.value)}
                  placeholder="The email they'll use to log in"
                  required
                  style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', outline: 'none' }}
                />
              </div>

              {/* Custom signed contract (optional) — overrides the auto template */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Custom signed contract (optional)
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={e => setContractFile(e.target.files?.[0] || null)}
                  style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
                  {contractFile ? `Attached: ${contractFile.name} — replaces the standard contract for this creator.` : 'Upload an already-signed PDF to use instead of the standard contract. Leave empty for the default.'}
                </div>
              </div>

              {/* Agency Signature */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#333', marginBottom: '4px' }}>
                  Agency Signature ({adminName})
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
                    border: `1px solid ${hasSigDrawn ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
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
                    onClick={() => clearSigCanvas(false)}
                    style={{ padding: '3px 10px', background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer' }}
                  >
                    Redraw
                  </button>
                  {localStorage.getItem('palm_agency_sig') && (
                    <button
                      type="button"
                      onClick={() => clearSigCanvas(true)}
                      style={{ padding: '3px 10px', background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '6px', fontSize: '11px', color: 'var(--foreground-muted)', cursor: 'pointer' }}
                    >
                      Clear Saved
                    </button>
                  )}
                  {!hasSigDrawn && (
                    <span style={{ fontSize: '11px', color: 'var(--palm-pink)' }}>Signature required</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setEditCreator(null); setHasSigDrawn(false) }}
                  style={{ padding: '9px 18px', background: 'rgba(255,255,255,0.03)', color: 'rgba(240, 236, 232, 0.75)', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !hasSigDrawn}
                  style={{
                    padding: '9px 18px',
                    background: (submitting || !hasSigDrawn) ? 'transparent' : 'var(--palm-pink)',
                    color: 'var(--foreground)',
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

      {/* Survey Answers Modal */}
      {surveyModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setSurveyModal(null)}>
          <div
            style={{
              background: 'var(--card-bg-solid)', borderRadius: '16px', padding: '28px',
              width: '700px', maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto',
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '2px' }}>
                  Survey Answers — {surveyModal.creatorName}
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>Onboarding questionnaire responses</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => downloadSurveyCsv(surveyModal.hqId)}
                  style={{
                    padding: '7px 14px', background: 'rgba(125, 211, 164, 0.08)', color: '#43A047',
                    border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setSurveyModal(null)}
                  style={{
                    padding: '7px 14px', background: 'rgba(255,255,255,0.03)', color: 'rgba(240, 236, 232, 0.75)',
                    border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            {surveyModal.loading ? (
              <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', textAlign: 'center', padding: '40px 0' }}>Loading answers...</p>
            ) : (
              Object.entries(surveyModal.sections || {}).map(([section, entries]) => {
                const answered = entries.filter(e => e.answer)
                if (answered.length === 0) return null
                return (
                  <div key={section} style={{ marginBottom: '20px' }}>
                    <div style={{
                      fontSize: '13px', fontWeight: 600, color: 'var(--palm-pink)',
                      marginBottom: '10px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      {section}
                    </div>
                    {answered.map((entry, i) => (
                      <div key={i} style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 500, color: '#333', marginBottom: '2px' }}>
                          {entry.question}
                          {entry.teamTag && (
                            <span style={{
                              fontSize: '9px', fontWeight: 600, marginLeft: '6px',
                              padding: '1px 5px', borderRadius: '3px',
                              background: entry.teamTag.includes('A-team') ? '#EDE7F6' : entry.teamTag.includes('B-team') ? '#E3F2FD' : '#F3E5F5',
                              color: entry.teamTag.includes('A-team') ? '#7E57C2' : entry.teamTag.includes('B-team') ? '#1E88E5' : '#AB47BC',
                            }}>
                              {entry.teamTag}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.85)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                          {entry.answer}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {offboardTarget && (
        <OffboardModal
          creator={offboardTarget}
          onClose={() => setOffboardTarget(null)}
          onDone={(data) => {
            setOffboardTarget(null)
            setOffboardResult(data)
            // Refresh the list — the offboarded creator now shows under the Offboarded filter pill
            fetch('/api/admin/onboarding/status')
              .then(r => r.json())
              .then(d => setCreators(d.creators || []))
              .catch(() => {})
          }}
        />
      )}

      {offboardResult && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', maxWidth: '460px', zIndex: 999,
          background: '#1a1f1c', border: '1px solid rgba(110, 180, 130, 0.5)',
          borderLeft: '4px solid #6EB482',
          borderRadius: '10px', padding: '14px 18px', fontSize: '13px',
          color: 'var(--foreground)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
            <strong>Offboarded {offboardResult.creator?.aka || offboardResult.creator?.name}</strong>
            <button onClick={() => setOffboardResult(null)} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-muted)', fontSize: '16px', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <ul style={{ margin: '0', paddingLeft: '18px', lineHeight: '1.5', color: 'rgba(240, 236, 232, 0.85)', fontSize: '12px' }}>
            <li>HQ + Ops status flipped, reason saved</li>
            <li>{offboardResult.revenueAccountsDeactivated?.length || 0} revenue account(s) → Inactive</li>
            <li>{offboardResult.smmTopicsDeleted?.length || 0} SMM topic(s) deleted</li>
            <li>Clerk: {offboardResult.clerkUserBanned ? 'banned' : (offboardResult.clerkUserError || '—')}</li>
            <li>File requests closed: {offboardResult.fileRequestsClosed?.length || 0}</li>
            <li>Dropbox folder: {offboardResult.dropboxMoved || offboardResult.dropboxError || '—'}</li>
          </ul>
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
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

// Segmented-control tab style for the "Contract" generate-vs-upload toggle.
const contractTabStyle = (active) => ({
  flex: 1,
  padding: '8px 10px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: '8px',
  border: `1px solid ${active ? 'var(--palm-pink)' : 'rgba(255,255,255,0.08)'}`,
  background: active ? 'rgba(224, 122, 195, 0.12)' : 'rgba(255,255,255,0.03)',
  color: active ? 'var(--palm-pink)' : 'var(--foreground-muted)',
})

const tdStyle = {
  padding: '12px 16px',
  fontSize: '13px',
  color: 'var(--foreground)',
}

const actionBtnStyle = {
  padding: '5px 12px',
  background: 'rgba(232, 160, 160, 0.04)',
  color: 'var(--palm-pink)',
  border: 'none',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
}
