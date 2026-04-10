'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import SurveySection from './SurveySection'
import { SURVEY_QUESTIONS, SECTION_ORDER, getQuestionsBySection } from '@/lib/onboarding/surveyQuestions'

export default function StepSurvey({ hqId, opsId, onComplete }) {
  const [answers, setAnswers] = useState({}) // { questionKey: { recordId?, answer } }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null) // 'saved' | 'saving' | 'error'

  // Load existing answers + pre-fill from profile data
  const prefillSaved = useRef(false)
  useEffect(() => {
    if (!hqId) return
    Promise.all([
      fetch(`/api/onboarding/survey?hqId=${hqId}`).then(r => r.json()),
      fetch(`/api/creator-profile?hqId=${hqId}`).then(r => r.json()),
    ]).then(([surveyData, profileData]) => {
      const loaded = surveyData.answers || {}
      const profile = profileData.profile || {}

      // Pre-fill OF username from accounts step if not already answered
      // Make sure we use the actual username, not the email
      if (!loaded.of_username?.answer && profile.onlyfansUrl) {
        const ofUrl = profile.onlyfansUrl
        // Skip if it looks like an email address
        const isEmail = ofUrl.includes('@')
        if (!isEmail) {
          const usernames = [ofUrl, profile.secondOfUrl].filter(Boolean).filter(u => !u.includes('@')).join(', ')
          if (usernames) {
            loaded.of_username = { answer: usernames }
            prefillSaved.current = true
          }
        }
      }

      // Pre-fill social media usernames from accounts step
      if (!loaded.social_media_usernames?.answer) {
        const socials = []
        if (profile.tiktok) socials.push(`TikTok: @${profile.tiktok.replace(/^@/, '')}`)
        if (profile.twitter) socials.push(`Twitter: @${profile.twitter.replace(/^@/, '')}`)
        if (profile.reddit) socials.push(`Reddit: u/${profile.reddit.replace(/^u\//, '')}`)
        if (profile.youtube) socials.push(`YouTube: ${profile.youtube}`)
        if (profile.oftv) socials.push(`OFTV: ${profile.oftv}`)
        if (socials.length > 0) {
          loaded.social_media_usernames = { answer: socials.join('\n') }
        }
      }

      setAnswers(loaded)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [hqId])

  // Save pre-filled answers after state is set
  useEffect(() => {
    if (prefillSaved.current && answers.of_username?.answer && !answers.of_username?.recordId) {
      prefillSaved.current = false
      handleAnswerChange('of_username', answers.of_username.answer)
    }
  }, [answers])

  // Save a single answer
  const handleAnswerChange = useCallback(async (key, value) => {
    const question = SURVEY_QUESTIONS.find(q => q.key === key)
    if (!question) return

    const existing = answers[key]

    // Optimistic update
    setAnswers(prev => ({
      ...prev,
      [key]: { ...prev[key], answer: value },
    }))

    setSaveStatus('saving')

    try {
      const res = await fetch('/api/onboarding/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hqId,
          opsId,
          answers: [{
            key,
            text: question.text,
            answer: value,
            section: question.section,
            teamTag: question.teamTag,
            recordId: existing?.recordId || null,
          }],
        }),
      })

      const data = await res.json()
      if (res.ok && data.results?.[0]?.recordId) {
        // Store the new recordId for future updates
        setAnswers(prev => ({
          ...prev,
          [key]: { ...prev[key], recordId: data.results[0].recordId },
        }))
      }

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(null), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [hqId, opsId, answers])

  const sections = getQuestionsBySection()
  const totalQuestions = SURVEY_QUESTIONS.length
  const answeredQuestions = Object.values(answers).filter(a => a.answer).length

  if (loading) {
    return <div style={{ color: '#999', fontSize: '14px', padding: '20px' }}>Loading survey...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>
            Creator Survey
          </h2>
          <p style={{ fontSize: '13px', color: '#999' }}>
            Answer these questions so our chat team can represent you authentically.
            Your answers auto-save as you type.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#E88FAC' }}>
            {answeredQuestions}/{totalQuestions}
          </div>
          <div style={{ fontSize: '11px', color: '#999' }}>answered</div>
          <div style={{
            fontSize: '11px',
            marginTop: '4px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '4px',
            minHeight: '16px',
            color: saveStatus === 'saving' ? '#F9A825' : saveStatus === 'saved' ? '#43A047' : saveStatus === 'error' ? '#E53935' : '#999',
          }}>
            {saveStatus === 'saving' && (
              <>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: '#F9A825', display: 'inline-block',
                  animation: 'pulse 1s infinite',
                }} />
                Saving...
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#43A047"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                All changes saved
              </>
            )}
            {saveStatus === 'error' && 'Error saving — try again'}
            {!saveStatus && 'Auto-saves as you type'}
          </div>
        </div>
      </div>

      {SECTION_ORDER.map((sectionName, index) => {
        // A section is locked if the previous section isn't fully answered
        const prevSection = index > 0 ? SECTION_ORDER[index - 1] : null
        const prevQuestions = prevSection ? (sections[prevSection] || []) : []
        const prevAllAnswered = prevSection
          ? prevQuestions.every(q => answers[q.key]?.answer)
          : true

        return (
          <SurveySection
            key={sectionName}
            title={sectionName}
            questions={sections[sectionName] || []}
            answers={answers}
            onAnswerChange={handleAnswerChange}
            saving={saving}
            locked={!prevAllAnswered}
            defaultExpanded={index === 0}
          />
        )
      })}

      {/* Save Progress indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginTop: '12px',
      }}>
        <button
          onClick={() => {
            // Blur any active input to trigger pending saves
            if (document.activeElement) document.activeElement.blur()
            // Small delay to let final save fire
            setTimeout(() => {
              setSaveStatus('saved')
              setTimeout(() => setSaveStatus(null), 2000)
            }, 300)
          }}
          style={{
            padding: '10px 24px',
            background: '#fff',
            color: '#E88FAC',
            border: '2px solid #E88FAC',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Save Progress
        </button>
        <button
          onClick={() => {
            // Blur any active input to trigger pending saves
            if (document.activeElement) document.activeElement.blur()
            setTimeout(() => onComplete(), 300)
          }}
          style={{
            padding: '10px 32px',
            background: '#E88FAC',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Continue to Next Step
        </button>
      </div>
    </div>
  )
}
