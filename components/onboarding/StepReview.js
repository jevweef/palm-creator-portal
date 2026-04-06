'use client'

import { useState, useEffect } from 'react'

const STEPS = [
  { key: 'basic-info', label: 'Basic Info', num: 1 },
  { key: 'accounts', label: 'Accounts', num: 2 },
  { key: 'survey', label: 'Survey', num: 3 },
  { key: 'contract', label: 'Contract', num: 4 },
  { key: 'voice-memo', label: 'Voice Memo', num: 5 },
]

export default function StepReview({ hqId, completedSteps, onGoToStep }) {
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
      setProfileData({
        name: profile.profile?.name || '',
        aka: profile.profile?.aka || '',
        email: profile.profile?.communicationEmail || '',
        hasContract: contract.alreadySigned || false,
        hasVoiceMemo: voiceMemo.hasVoiceMemo || false,
        onboardingStatus: profile.profile?.onboardingStatus || '',
      })
      if (profile.profile?.onboardingStatus === 'Completed') {
        setSubmitted(true)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [hqId])

  const allComplete = STEPS.every(s => completedSteps.includes(s.key))

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
      }
    } catch (err) {
      console.error('Submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div style={{ color: '#999', fontSize: '14px', padding: '20px' }}>Loading...</div>
  }

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '32px', fontWeight: 800, color: '#E88FAC', marginBottom: '16px' }}>Done!</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>
          You&apos;re all set!
        </h2>
        <p style={{ fontSize: '14px', color: '#666', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto 24px' }}>
          Your onboarding is complete. Your manager will review everything and reach out
          with next steps. Welcome to Palm!
        </p>
        <div style={{
          background: '#E8F5E9',
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
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
        Review & Submit
      </h2>
      <p style={{ fontSize: '13px', color: '#999', marginBottom: '24px' }}>
        Review your progress below. Make sure everything is complete before submitting.
      </p>

      {/* Step checklist */}
      <div style={{
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: '12px',
        overflow: 'hidden',
        marginBottom: '24px',
      }}>
        {STEPS.map((step, i) => {
          const isComplete = completedSteps.includes(step.key)
          return (
            <div
              key={step.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderBottom: i < STEPS.length - 1 ? '1px solid #f0f0f0' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  background: isComplete ? '#E8F5E9' : '#f5f5f5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 600, color: isComplete ? '#43A047' : '#999',
                }}>{step.num}</span>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: isComplete ? '#1a1a1a' : '#999',
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
                  background: '#E8F5E9',
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
                    background: '#FFF0F3',
                    color: '#E88FAC',
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
          background: '#FAFAFA',
          border: '1px solid #e0e0e0',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '12px' }}>
            Summary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {profileData.name && (
              <div>
                <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Name</div>
                <div style={{ fontSize: '13px', color: '#1a1a1a' }}>{profileData.name}</div>
              </div>
            )}
            {profileData.aka && (
              <div>
                <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Stage Name</div>
                <div style={{ fontSize: '13px', color: '#1a1a1a' }}>{profileData.aka}</div>
              </div>
            )}
            {profileData.email && (
              <div>
                <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Email</div>
                <div style={{ fontSize: '13px', color: '#1a1a1a' }}>{profileData.email}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Contract</div>
              <div style={{ fontSize: '13px', color: profileData.hasContract ? '#43A047' : '#999' }}>
                {profileData.hasContract ? 'Signed' : 'Not signed'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Voice Memo</div>
              <div style={{ fontSize: '13px', color: profileData.hasVoiceMemo ? '#43A047' : '#999' }}>
                {profileData.hasVoiceMemo ? 'Uploaded' : 'Not uploaded'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit */}
      {!allComplete && (
        <div style={{
          background: '#FFF8E1',
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
          background: (!allComplete || submitting) ? '#F0D0D8' : '#E88FAC',
          color: '#fff',
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
