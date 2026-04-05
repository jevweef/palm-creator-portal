'use client'

import { useState, useEffect, useCallback } from 'react'
import SurveySection from './SurveySection'
import { SURVEY_QUESTIONS, SECTION_ORDER, getQuestionsBySection } from '@/lib/onboarding/surveyQuestions'

export default function StepSurvey({ hqId, opsId, onComplete }) {
  const [answers, setAnswers] = useState({}) // { questionKey: { recordId?, answer } }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null) // 'saved' | 'saving' | 'error'

  // Load existing answers
  useEffect(() => {
    if (!hqId) return
    fetch(`/api/onboarding/survey?hqId=${hqId}`)
      .then(r => r.json())
      .then(data => {
        setAnswers(data.answers || {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [hqId])

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
          {saveStatus && (
            <div style={{
              fontSize: '11px',
              marginTop: '4px',
              color: saveStatus === 'saving' ? '#F9A825' : saveStatus === 'saved' ? '#43A047' : '#E53935',
              fontWeight: 500,
            }}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error saving'}
            </div>
          )}
        </div>
      </div>

      {SECTION_ORDER.map(sectionName => (
        <SurveySection
          key={sectionName}
          title={sectionName}
          questions={sections[sectionName] || []}
          answers={answers}
          onAnswerChange={handleAnswerChange}
          saving={saving}
        />
      ))}

      <button
        onClick={onComplete}
        style={{
          marginTop: '12px',
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
  )
}
