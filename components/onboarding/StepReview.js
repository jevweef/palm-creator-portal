'use client'

import { useState, useEffect } from 'react'

const STEPS = [
  { key: 'basic-info', label: 'Basic Info', num: 1 },
  { key: 'accounts', label: 'Accounts', num: 2 },
  { key: 'survey', label: 'Survey', num: 3 },
  { key: 'contract', label: 'Contract', num: 4 },
  { key: 'voice-memo', label: 'Voice Memo', num: 5 },
]

export default function StepReview({ hqId, completedSteps, onGoToStep, onSubmitted }) {
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [profileData, setProfileData] = useState(null)
  const [loading, setLoading] = useState(true)

  // Fetch profile to check completion and show summary
  useEffect(() => {
    if (!hqId) { setLoading(false); return }
    Promise.all([
      fetch(`/api/creator-profile?hqId=${hqId}`).then(r => r.json()),
      fetch(`/api/onboarding/voice-memo?hqId=${hqId}`).then(r => r.json()),
      fetch(`/api/onboarding/contract/generate?hqId=${hqId}`).then(r => r.json()),
    ]).then(([profile, voiceMemo, contract]) => {
      const vmStatus = voiceMemo.voiceMemoStatus
      setProfileData({
        name: profile.profile?.name || '',
        aka: profile.profile?.aka || '',
        email: profile.profile?.communicationEmail || '',
        hasContract: contract.alreadySigned || false,
        hasVoiceMemo: voiceMemo.hasVoiceMemo || false,
        voiceMemoStatus: vmStatus || null,
        voiceMemoComplete: voiceMemo.hasVoiceMemo || vmStatus === 'Skipped' || vmStatus === 'Confirmed Sent',
        onboardingStatus: profile.profile?.onboardingStatus || '',
      })
      if (profile.profile?.onboardingStatus === 'Completed') {
        setSubmitted(true)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [hqId])

  // Use real completion data from Airtable for contract/voice memo instead of just click-through tracking
  const getStepComplete = (key) => {
    if (key === 'contract') return profileData?.hasContract || false
    if (key === 'voice-memo') return profileData?.voiceMemoComplete || false
    return completedSteps.includes(key)
  }
  const allComplete = !loading && profileData && STEPS.every(s => getStepComplete(s.key))

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      if (res.ok) {
        setSubmitted(true)
        if (onSubmitted) onSubmitted()
      }
    } catch (err) {
      console.error('Submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--foreground-muted)', fontSize: '14px', padding: '20px' }}>Loading...</div>
  }

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--palm-pink)', marginBottom: '16px' }}>Done!</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '8px' }}>
          You&apos;re all set!
        </h2>
        <p style={{ fontSize: '14px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto 24px' }}>
          Your onboarding is complete. Your manager will review everything and reach out
          with next steps. Welcome to Palm!
        </p>
        <div style={{
          background: 'rgba(125, 211, 164, 0.08)',
          borderRadius: '12px',
          padding: '16px 24px',
          display: 'inline-block',
        }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#2E7D32' }}>
            Onboarding Complete
          </span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>
        Review & Submit
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '24px' }}>
        Review your progress below. Make sure everything is complete before submitting.
      </p>

      {/* Step checklist */}
      <div style={{
        background: 'var(--card-bg-solid)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        overflow: 'hidden',
        marginBottom: '24px',
      }}>
        {STEPS.map((step, i) => {
          const isComplete = getStepComplete(step.key)
          return (
            <div
              key={step.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderBottom: i < STEPS.length - 1 ? '1px solid transparent' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  background: isComplete ? 'rgba(125, 211, 164, 0.08)' : 'rgba(255,255,255,0.03)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 600, color: isComplete ? '#43A047' : '#999',
                }}>{step.num}</span>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: isComplete ? 'var(--foreground)' : '#999',
                }}>
                  {step.label}
                </span>
              </div>
              {isComplete ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: 'rgba(125, 211, 164, 0.08)',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#43A047">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
              ) : (
                <button
                  onClick={() => onGoToStep(step.key)}
                  style={{
                    padding: '4px 12px',
                    background: 'rgba(232, 160, 160, 0.04)',
                    color: 'var(--palm-pink)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Complete
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {profileData && (
        <div style={{
          background: 'var(--card-bg-solid)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '12px' }}>
            Summary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {profileData.name && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '2px' }}>Name</div>
                <div style={{ fontSize: '13px', color: 'var(--foreground)' }}>{profileData.name}</div>
              </div>
            )}
            {profileData.aka && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '2px' }}>Stage Name</div>
                <div style={{ fontSize: '13px', color: 'var(--foreground)' }}>{profileData.aka}</div>
              </div>
            )}
            {profileData.email && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '2px' }}>Email</div>
                <div style={{ fontSize: '13px', color: 'var(--foreground)' }}>{profileData.email}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '2px' }}>Contract</div>
              <div style={{ fontSize: '13px', color: profileData.hasContract ? '#43A047' : '#999' }}>
                {profileData.hasContract ? 'Signed' : 'Not signed'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginBottom: '2px' }}>Voice Memo</div>
              <div style={{ fontSize: '13px', color: profileData.voiceMemoComplete ? (profileData.voiceMemoStatus === 'Skipped' ? '#F57F17' : '#43A047') : '#999' }}>
                {profileData.hasVoiceMemo ? 'Uploaded' : profileData.voiceMemoStatus === 'Skipped' ? 'Skipped' : profileData.voiceMemoStatus === 'Confirmed Sent' ? 'Confirmed sent' : 'Not uploaded'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit */}
      {!allComplete && (
        <div style={{
          background: 'rgba(232, 200, 120, 0.06)',
          border: '1px solid #FFE082',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#F57F17',
        }}>
          Please complete all steps before submitting.
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!allComplete || submitting}
        style={{
          padding: '12px 40px',
          background: (!allComplete || submitting) ? 'transparent' : 'var(--palm-pink)',
          color: 'rgba(255,255,255,0.08)',
          border: 'none',
          borderRadius: '8px',
          fontSize: '15px',
          fontWeight: 600,
          cursor: (!allComplete || submitting) ? 'not-allowed' : 'pointer',
          width: '100%',
        }}
      >
        {submitting ? 'Submitting...' : 'Submit Onboarding'}
      </button>
    </div>
  )
}
