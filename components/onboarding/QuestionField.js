'use client'

import { useState, useEffect, useRef } from 'react'

const TEAM_COLORS = {
  'A-team': { bg: '#EDE7F6', color: '#7E57C2' },
  'B-team': { bg: '#E3F2FD', color: '#1E88E5' },
  'Both': { bg: '#F3E5F5', color: '#AB47BC' },
}

export default function QuestionField({ question, value, onChange, saving }) {
  const [localValue, setLocalValue] = useState(value || '')
  const debounceRef = useRef(null)

  useEffect(() => {
    setLocalValue(value || '')
  }, [value])

  const handleChange = (newVal) => {
    setLocalValue(newVal)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange(question.key, newVal)
    }, 1500)
  }

  const handleBlur = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (localValue !== value) {
      onChange(question.key, localValue)
    }
  }


  const tag = question.teamTag.length === 2 || question.teamTag.includes('Both')
    ? 'Both'
    : question.teamTag[0]

  const inputStyle = {
    width: '100%',
    padding: '9px 12px',
    fontSize: '14px',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    outline: 'none',
    background: '#fff',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ marginBottom: '5px' }}>
        <label style={{ fontSize: '13px', fontWeight: 500, color: '#333' }}>
          {question.text}
        </label>
      </div>
      {question.inputType === 'textarea' ? (
        <textarea
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }}
        />
      ) : (
        <input
          type={question.inputType === 'number' ? 'number' : 'text'}
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          style={inputStyle}
        />
      )}
    </div>
  )
}
