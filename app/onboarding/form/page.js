'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import OnboardingProgress from '@/components/onboarding/OnboardingProgress'
import StepBasicInfo from '@/components/onboarding/StepBasicInfo'
import StepAccounts from '@/components/onboarding/StepAccounts'
import StepSurvey from '@/components/onboarding/StepSurvey'
import StepContract from '@/components/onboarding/StepContract'
import StepVoiceMemo from '@/components/onboarding/StepVoiceMemo'
import StepReview from '@/components/onboarding/StepReview'

export default function OnboardingForm() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  const STEPS = ['basic-info', 'accounts', 'survey', 'contract', 'voice-memo', 'review']
  const getInitialStep = () => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '')
      if (STEPS.includes(hash)) return hash
    }
    return 'basic-info'
  }
  const [currentStep, setCurrentStep] = useState(getInitialStep)
  const [completedSteps, setCompletedSteps] = useState([])
  const [saving, setSaving] = useState(false)
  const [profileData, setProfileData] = useState(null)
  const [loading, setLoading] = useState(true)

  const hqId = user?.publicMetadata?.airtableHqId
  const opsId = user?.publicMetadata?.airtableOpsId

  // Fetch existing profile data to pre-fill
  const fetchProfile = async () => {
    if (!hqId) return
    try {
      const res = await fetch(`/api/creator-profile?hqId=${hqId}`)
      const data = await res.json()
      if (data.profile) {
        setProfileData(data.profile)

        // Block re-entry if onboarding already completed
        if (data.profile.onboardingStatus === 'Completed') {
          router.replace('/dashboard')
          return
        }

        // Auto-detect completed steps based on saved data
        const completed = []
        if (data.profile.name && data.profile.onboardingStatus === 'In Progress') {
          completed.push('basic-info')
        }
        if (data.profile.ofEmail || data.profile.onlyfansUrl) {
          completed.push('accounts')
        }
        if (completed.length > 0) {
          setCompletedSteps(prev => [...new Set([...prev, ...completed])])
          // Only auto-advance if no hash is set (first visit vs refresh)
          const hash = window.location.hash.replace('#', '')
          if (!hash || !STEPS.includes(hash)) {
            if (completed.includes('basic-info') && !completed.includes('accounts')) {
              goToStep('accounts')
            } else if (completed.includes('accounts')) {
              goToStep('survey')
            }
          }
        }
      }
    } catch (err) {
      console.error('Fetch profile error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isLoaded) return
    // Admins and editors don't need onboarding
    const role = user?.publicMetadata?.role
    if (role === 'admin' || role === 'super_admin' || role === 'editor') {
      router.replace('/dashboard')
      return
    }
    if (!hqId) {
      setLoading(false)
      return
    }
    fetchProfile()
  }, [isLoaded, hqId, user, router])

  // Sync step from hash on back/forward navigation
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '')
      if (STEPS.includes(hash)) setCurrentStep(hash)
    }
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  const saveStep = async (step, data) => {
    if (!hqId) return false
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, step, data }),
      })
      if (res.ok) {
        // Re-fetch profile to get updated data
        await fetchProfile()
        return true
      }
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
    return false
  }

  const handleSaveBasicInfo = async (data) => {
    const ok = await saveStep('basic-info', data)
    if (ok) {
      setCompletedSteps(prev => [...new Set([...prev, 'basic-info'])])
      goToStep('accounts')
    }
  }

  const handleSaveAccounts = async (data) => {
    const ok = await saveStep('accounts', data)
    if (ok) {
      setCompletedSteps(prev => [...new Set([...prev, 'accounts'])])
      goToStep('survey')
    }
  }

  const handleSurveyComplete = () => {
    setCompletedSteps(prev => [...new Set([...prev, 'survey'])])
    goToStep('contract')
  }

  const handleContractComplete = () => {
    setCompletedSteps(prev => [...new Set([...prev, 'contract'])])
    goToStep('voice-memo')
  }

  const handleVoiceMemoComplete = () => {
    setCompletedSteps(prev => [...new Set([...prev, 'voice-memo'])])
    goToStep('review')
  }

  const goToStep = (step) => {
    setCurrentStep(step)
    window.location.hash = step
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!isLoaded || loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#999', fontSize: '14px' }}>Loading your onboarding...</div>
      </div>
    )
  }

  if (!hqId) {
    return (
      <div style={{ minHeight: '100vh', background: '#FFF5F7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          background: '#fff',
          borderRadius: '20px',
          padding: '40px',
          maxWidth: '440px',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#E88FAC', marginBottom: '16px' }}>...</div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>
            Setting Up Your Account
          </h1>
          <p style={{ fontSize: '14px', color: '#666', lineHeight: '1.5' }}>
            We&apos;re linking your account to our system. This usually takes a few seconds.
            Try refreshing the page in a moment.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 24px',
              background: '#E88FAC',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>
    )
  }

  const basicInfoInitial = profileData ? {
    name: profileData.name || '',
    stageName: profileData.aka || '',
    birthday: '',
    location: profileData.address || '',
    igAccount: profileData.igAccount || '',
    timeZone: profileData.timeZone || '',
    address: profileData.address || '',
    communication: profileData.communication || [],
    telegram: profileData.telegram || '',
  } : {}

  const accountsInitial = profileData ? {
    ofUrl: profileData.onlyfansUrl || '',
    ofEmail: profileData.ofEmail || '',
    ofPassword: '',
    of2fa: '',
    secondOfEmail: profileData.secondOfEmail || '',
    secondOfPassword: '',
    tiktok: '',
    twitter: '',
    reddit: '',
    youtube: '',
    oftv: '',
    otherSocials: '',
  } : {}

  const renderComingSoon = (label) => (
    <div style={{
      background: '#fff',
      borderRadius: '16px',
      padding: '40px',
      textAlign: 'center',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#999', marginBottom: '12px' }}>Coming Soon</div>
      <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>
        {label}
      </h2>
      <p style={{ fontSize: '13px', color: '#999' }}>
        This step is coming soon. We&apos;ll let you know when it&apos;s ready.
      </p>
    </div>
  )

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: '#FFF5F7' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ marginBottom: '8px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>
            Onboarding
          </h1>
          <p style={{ fontSize: '13px', color: '#999' }}>
            Complete each step below. Your progress is saved automatically.
          </p>
        </div>

        <OnboardingProgress
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={(step) => goToStep(step)}
        />

        <div style={{
          background: currentStep === 'survey' ? 'transparent' : '#fff',
          borderRadius: '16px',
          padding: currentStep === 'survey' ? '0' : '28px',
          boxShadow: currentStep === 'survey' ? 'none' : '0 2px 12px rgba(0,0,0,0.06)',
        }}>
          {currentStep === 'basic-info' && (
            <StepBasicInfo
              initialData={basicInfoInitial}
              onSave={handleSaveBasicInfo}
              saving={saving}
            />
          )}
          {currentStep === 'accounts' && (
            <StepAccounts
              initialData={accountsInitial}
              onSave={handleSaveAccounts}
              saving={saving}
            />
          )}
          {currentStep === 'survey' && (
            <StepSurvey
              hqId={hqId}
              opsId={opsId}
              onComplete={handleSurveyComplete}
            />
          )}
          {currentStep === 'contract' && (
            <StepContract hqId={hqId} onComplete={handleContractComplete} />
          )}
          {currentStep === 'voice-memo' && (
            <StepVoiceMemo hqId={hqId} onComplete={handleVoiceMemoComplete} />
          )}
          {currentStep === 'review' && (
            <StepReview
              hqId={hqId}
              completedSteps={completedSteps}
              onGoToStep={goToStep}
              onSubmitted={() => {
                setTimeout(() => router.push('/dashboard'), 2000)
              }}
            />
          )}
        </div>

        {/* Step navigation for completed steps */}
        {completedSteps.length > 0 && (
          <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {completedSteps.includes('basic-info') && currentStep !== 'basic-info' && (
              <button onClick={() => goToStep('basic-info')} style={navBtnStyle}>
                ← Basic Info
              </button>
            )}
            {completedSteps.includes('accounts') && currentStep !== 'accounts' && (
              <button onClick={() => goToStep('accounts')} style={navBtnStyle}>
                ← Accounts
              </button>
            )}
            {completedSteps.includes('survey') && currentStep !== 'survey' && (
              <button onClick={() => goToStep('survey')} style={navBtnStyle}>
                ← Survey
              </button>
            )}
            {completedSteps.includes('voice-memo') && currentStep !== 'voice-memo' && (
              <button onClick={() => goToStep('voice-memo')} style={navBtnStyle}>
                ← Voice Memo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const navBtnStyle = {
  padding: '6px 14px',
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#666',
  cursor: 'pointer',
}
