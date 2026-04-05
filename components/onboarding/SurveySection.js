'use client'

import { useState, useEffect } from 'react'
import QuestionField from './QuestionField'

export default function SurveySection({ title, questions, answers, onAnswerChange, saving, locked, defaultExpanded }) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded)

  const answeredCount = questions.filter(q => answers[q.key]?.answer).length
  const totalCount = questions.length
  const allAnswered = answeredCount === totalCount

  // Auto-expand when unlocked for the first time
  useEffect(() => {
    if (!locked && collapsed && defaultExpanded) {
      setCollapsed(false)
    }
  }, [locked])

  const handleClick = () => {
    if (locked) return
    setCollapsed(!collapsed)
  }

  return (
    <div style={{
      marginBottom: '20px',
      background: '#fff',
      borderRadius: '12px',
      border: locked ? '1px solid #f0f0f0' : '1px solid #f0f0f0',
      overflow: 'hidden',
      opacity: locked ? 0.5 : 1,
      transition: 'opacity 0.2s',
    }}>
      <button
        onClick={handleClick}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          cursor: locked ? 'not-allowed' : 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
            {title}
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '10px',
            background: allAnswered ? '#E8F5E9' : locked ? '#f5f5f5' : '#FFF8E1',
            color: allAnswered ? '#43A047' : locked ? '#ccc' : '#F9A825',
          }}>
            {answeredCount}/{totalCount}
          </span>
          {locked && (
            <span style={{ fontSize: '11px', color: '#ccc' }}>
              Complete the section above first
            </span>
          )}
        </div>
        <span style={{ fontSize: '12px', color: '#999', transition: 'transform 0.2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          ▼
        </span>
      </button>

      {!collapsed && !locked && (
        <div style={{ padding: '0 16px 16px' }}>
          {questions.map(q => (
            <QuestionField
              key={q.key}
              question={q}
              value={answers[q.key]?.answer || ''}
              onChange={onAnswerChange}
              saving={saving}
            />
          ))}
        </div>
      )}
    </div>
  )
}
