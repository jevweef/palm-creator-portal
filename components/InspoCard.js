'use client'

import { useState } from 'react'
import { tagStyle } from '@/lib/tagStyle'

function formatNum(n) {
  if (!n || n < 0) return null
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function gradeColor(grade) {
  if (!grade) return '#ccc'
  if (grade === 'A+') return '#ffd700'
  if (grade.startsWith('A')) return '#4ade80'
  if (grade.startsWith('B')) return '#78B4E8'
  if (grade.startsWith('C')) return '#E8A878'
  return '#999'
}

export default function InspoCard({ record, grade, onClick, isSaved, onSave }) {
  const [imgError, setImgError] = useState(false)
  const views = formatNum(record.views)
  const likes = formatNum(record.likes)
  const comments = formatNum(record.comments)
  const shares = formatNum(record.shares)

  const visibleTags = record.tags.slice(0, 3)
  const extraCount = record.tags.length - visibleTags.length

  return (
    <div
      onClick={onClick}
      className="group relative bg-[#0f0f0f] overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.01]"
      style={{display:'flex', flexDirection:'column', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderRadius: '18px', border: 'none', transition: '0.3s cubic-bezier(0, 0, 0.5, 1)'}}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[9/16] bg-[rgba(232,160,160,0.06)] overflow-hidden">
        {(record.cdnUrl || record.thumbnail) && !imgError ? (
          <img
            src={record.cdnUrl || record.thumbnail}
            alt={record.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-[#D4A0B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Username badge */}
        {record.username && (
          <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-xs text-zinc-300 px-3 py-1 rounded-full">
            @{record.username}
          </div>
        )}

        {/* Grade badge */}
        {grade && (
          <div style={{
            position:'absolute', top:'10px', right:'10px',
            background: gradeColor(grade),
            color: grade === 'D' ? '#a1a1aa' : '#000',
            borderRadius:'6px',
            fontSize:'11px', fontWeight:800,
            padding:'2px 7px',
            lineHeight:1.5,
            letterSpacing:'-0.02em',
            boxShadow:'0 1px 4px rgba(0,0,0,0.3)',
          }}>
            {grade}
          </div>
        )}

        {/* Save button */}
        {onSave && (
          <button
            onClick={(e) => { e.stopPropagation(); onSave(record.id) }}
            className="absolute bottom-[52px] right-3 z-20 transition-all duration-200 hover:scale-110"
            style={{
              background: isSaved ? 'var(--palm-pink)' : 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              border: isSaved ? 'none' : '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
            }}
            title={isSaved ? 'Unsave' : 'Save to film later'}
          >
            <svg className="w-3.5 h-3.5" fill={isSaved ? 'var(--foreground)' : 'none'} viewBox="0 0 24 24" stroke="#fff" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span style={{fontSize:'10px', fontWeight:600, color:'var(--foreground)'}}>{isSaved ? 'Saved' : 'Save'}</span>
          </button>
        )}

        {/* Engagement stats overlay at bottom of thumbnail */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent" style={{padding:'12px 12px 10px'}}>
          <div className="flex items-center gap-3 text-xs text-white">
            {views && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {views}
              </span>
            )}
            {likes && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-rose-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                {likes}
              </span>
            )}
            {comments && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {comments}
              </span>
            )}
            {shares && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                {shares}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Card body */}
      <div style={{padding:'14px', flex:1}}>
        <h3 style={{fontSize:'13px', fontWeight:600, color:'var(--foreground)', marginBottom:'10px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{record.title}</h3>

        {/* Tags — single line, overflow hidden */}
        <div style={{display:'flex', gap:'6px', overflow:'hidden', whiteSpace:'nowrap'}}>
          {visibleTags.map((tag) => (
            <span key={tag} style={{padding:'3px 8px', borderRadius:'9999px', fontSize:'10px', fontWeight:500, flexShrink:0, ...tagStyle(tag)}}>
              {tag}
            </span>
          ))}
          {extraCount > 0 && (
            <span style={{padding:'3px 8px', flexShrink:0, fontSize:'10px', borderRadius:'9999px', background:'rgba(232, 160, 160, 0.06)', color:'#999'}}>
              +{extraCount}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
