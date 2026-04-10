'use client'

import { useState, useEffect, useRef } from 'react'

const COMMON_EMOJIS = [
  '😘', '😍', '🥰', '😏', '😈', '🔥', '💕', '💋', '❤️', '🖤',
  '💜', '🤭', '😉', '🙈', '🙊', '😜', '🥵', '💦', '✨', '🫶',
  '🤍', '💗', '😇', '🦋', '👅', '💀', '🫣', '😋', '🤤', '💅',
]

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

  const addEmoji = (emoji) => {
    const newVal = localValue ? `${localValue} ${emoji}` : emoji
    handleChange(newVal)
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
      <div style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <label style={{ fontSize: '13px', fontWeight: 500, color: '#333' }}>
          {question.text}
        </label>
        {question.required && (
          <span style={{ color: '#E88FAC', fontSize: '13px', fontWeight: 600 }}>*</span>
        )}
      </div>
      {question.inputType === 'textarea' ? (
        <textarea
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          rows={3}
          placeholder={question.placeholder || ''}
          style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }}
        />
      ) : (
        <input
          type={question.inputType === 'number' ? 'number' : 'text'}
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={question.placeholder || ''}
          style={inputStyle}
        />
      )}
      {/* Emoji picker for emoji questions */}
      {question.hasEmojiPicker && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          marginTop: '8px',
          padding: '8px',
          background: '#fafafa',
          borderRadius: '8px',
          border: '1px solid #f0f0f0',
        }}>
          {COMMON_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => addEmoji(emoji)}
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                background: localValue.includes(emoji) ? '#FFF0F3' : 'transparent',
                border: localValue.includes(emoji) ? '1px solid #E88FAC' : '1px solid transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.1s',
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
