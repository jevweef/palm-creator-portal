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
import { SURVEY_QUESTIONS } from '@/lib/onboarding/surveyQuestions'

function AccountLinkingScreen() {
  const [countdown, setCountdown] = useState(10)
  const [hasAutoRefreshed, setHasAutoRefreshed] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          if (!hasAutoRefreshed) {
            setHasAutoRefreshed(true)
            window.location.reload()
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [hasAutoRefreshed])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--card-bg-solid)',
        borderRadius: '20px',
        padding: '40px',
        maxWidth: '440px',
        textAlign: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
      }}>
        {/* Spinner */}
        <div style={{
          width: '48px',
          height: '48px',
          border: '3px solid #f0f0f0',
          borderTop: '3px solid #E88FAC',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 20px',
        }} />
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
          Setting Up Your Account
        </h1>
        <p style={{ fontSize: '14px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.5', marginBottom: '16px' }}>
          We&apos;re linking your account to our system. This usually takes a few seconds.
        </p>
        <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', marginBottom: '20px' }}>
          {countdown > 0 ? (
            <>Auto-refreshing in <span style={{ fontWeight: 600, color: 'var(--palm-pink)' }}>{countdown}s</span></>
          ) : (
            'Refreshing...'
          )}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px',
            background: 'var(--palm-pink)',
            color: '#060606',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Refresh Now
        </button>
        <style jsx>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}

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
  // Admin "contract handled separately" flag — when set, the contract step is
  // dropped from the wizard entirely (creator never sees it).
  const [skipContract, setSkipContract] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [profileData, setProfileData] = useState(null)
  const [loading, setLoading] = useState(true)

  const hqId = user?.publicMetadata?.airtableHqId
  const opsId = user?.publicMetadata?.airtableOpsId

  // Fetch existing profile + survey progress so we can RESUME the creator to
  // exactly where she left off (she can X out mid-flow and pick back up).
  const fetchProfile = async () => {
    if (!hqId) return
    try {
      const [data, surveyData] = await Promise.all([
        fetch(`/api/creator-profile?hqId=${hqId}`).then(r => r.json()),
        fetch(`/api/onboarding/survey?hqId=${hqId}`).then(r => r.json()).catch(() => ({ answers: {} })),
      ])
      if (data.profile) {
        setProfileData(data.profile)
        setSkipContract(!!data.profile.skipContract)

        // Block re-entry only once she's truly finished (Submit at Review).
        if (data.profile.onboardingStatus === 'Completed') {
          router.replace('/dashboard')
          return
        }

        // Evidence per step — basic-info counts done once she's saved it
        // (status flips to In Progress on the first save); accounts is treated
        // as passed once she has any survey progress (OF logins are optional
        // in-portal). Survey is "done" only when every question is answered.
        const inProgress = data.profile.onboardingStatus === 'In Progress'
        const hasBasic = !!data.profile.name && inProgress
        const hasAccounts = !!(data.profile.ofEmail || data.profile.onlyfansUrl)
        const surveyCount = Object.values(surveyData.answers || {}).filter(a => a.answer).length
        const surveyDone = surveyCount >= SURVEY_QUESTIONS.length
        const contractDone = !!data.profile.contractUrl || !!data.profile.skipContract

        const completed = []
        if (hasBasic) completed.push('basic-info')
        if (hasBasic && (hasAccounts || surveyCount > 0)) completed.push('accounts')
        if (surveyDone) completed.push('survey')
        if (completed.length > 0) setCompletedSteps(prev => [...new Set([...prev, ...completed])])

        // Resume: land on the furthest step she still needs. Only when there's
        // no explicit #step hash (a shared #survey link or a refresh wins).
        const hash = window.location.hash.replace('#', '')
        if (!hash || !STEPS.includes(hash)) {
          let resume = 'basic-info'
          if (hasBasic) resume = 'accounts'
          if (hasBasic && (hasAccounts || surveyCount > 0)) resume = 'survey'
          if (hasBasic && surveyDone) resume = contractDone ? 'voice-memo' : 'contract'
          if (resume !== 'basic-info') goToStep(resume)
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

  // If the contract is handled separately, never let the creator sit on the
  // contract step (e.g. a stale #contract hash or back-nav) — bump forward.
  useEffect(() => {
    if (skipContract && currentStep === 'contract') {
      setCurrentStep('voice-memo')
      if (typeof window !== 'undefined') window.location.hash = 'voice-memo'
    }
  }, [skipContract, currentStep])

  const saveStep = async (step, data) => {
    if (!hqId) return false
    setSaving(true)
    setSaveError(null)
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
      const body = await res.json().catch(() => ({}))
      setSaveError(body.error || 'We couldn’t save this step. Please check your details and try again.')
    } catch (err) {
      console.error('Save error:', err)
      setSaveError('We couldn’t save your progress — this can happen if the connection drops. Please try again.')
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
    // Skip straight to voice-memo when the contract is handled separately.
    goToStep(skipContract ? 'voice-memo' : 'contract')
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
      <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading your onboarding...</div>
      </div>
    )
  }

  if (!hqId) {
    return <AccountLinkingScreen />
  }

  const basicInfoInitial = profileData ? {
    name: profileData.name || '',
    stageName: profileData.aka || '',
    birthday: profileData.birthday || '',
    location: profileData.address || '',
    igAccount: profileData.igAccount || '',
    timeZone: profileData.timeZone || '',
    communication: profileData.communication || [],
    telegram: profileData.telegram || '',
  } : {}

  const accountsInitial = profileData ? {
    ofUrl: profileData.onlyfansUrl || '',
    ofEmail: profileData.ofEmail || '',
    ofPassword: '',
    secondOfUrl: profileData.secondOfUrl || '',
    secondOfEmail: profileData.secondOfEmail || '',
    secondOfPassword: '',
    fanslyUsername: profileData.fanslyUsername || '',
    fanslyEmail: profileData.fanslyEmail || '',
    fanslyPassword: '',
    selectedPlatforms: profileData.selectedPlatforms || [],
    tiktok: profileData.tiktok || '',
    twitter: profileData.twitter || '',
    reddit: profileData.reddit || '',
    youtube: profileData.youtube || '',
    oftv: profileData.oftv || '',
    otherSocials: profileData.otherSocials || '',
  } : {}

  const renderComingSoon = (label) => (
    <div style={{
      background: 'var(--card-bg-solid)',
      borderRadius: '16px',
      padding: '40px',
      textAlign: 'center',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: '12px' }}>Coming Soon</div>
      <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px' }}>
        {label}
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
        This step is coming soon. We&apos;ll let you know when it&apos;s ready.
      </p>
    </div>
  )

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ marginBottom: '8px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '4px' }}>
            Onboarding
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            Complete each step below. Your progress is saved automatically.
          </p>
        </div>

        <OnboardingProgress
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={(step) => goToStep(step)}
          skipContract={skipContract}
        />

        {saveError && (
          <div style={{
            background: 'rgba(229, 57, 53, 0.08)',
            border: '1px solid rgba(229, 57, 53, 0.3)',
            color: '#E57373',
            padding: '12px 16px',
            borderRadius: '10px',
            fontSize: '13px',
            lineHeight: '1.4',
            marginBottom: '16px',
          }}>
            {saveError}
          </div>
        )}

        <div style={{
          background: currentStep === 'survey' ? 'transparent' : 'rgba(255,255,255,0.08)',
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
          {currentStep === 'contract' && !skipContract && (
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
              skipContract={skipContract}
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
  background: 'var(--card-bg-solid)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '6px',
  fontSize: '12px',
  color: 'rgba(240, 236, 232, 0.75)',
  cursor: 'pointer',
}
