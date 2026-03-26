'use client'

import { useEffect, useCallback, useState } from 'react'
import { tagStyle } from '@/lib/tagStyle'

function gradeColor(grade) {
  if (!grade) return '#52525b'
  if (grade === 'A+') return '#ffd700'
  if (grade.startsWith('A')) return '#4ade80'
  if (grade.startsWith('B')) return '#60a5fa'
  if (grade.startsWith('C')) return '#fb923c'
  return '#71717a'
}

function formatNum(n) {
  if (!n || n < 0) return null
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function parseNotes(notes) {
  if (!notes) return { inspoDirection: '', whatMattersMost: '' }
  const inspoMatch = notes.match(/Inspo direction:\n?([\s\S]*?)(?=What matters most:|$)/i)
  const wmmMatch = notes.match(/What matters most:\n?([\s\S]*?)$/i)
  return {
    inspoDirection: inspoMatch ? inspoMatch[1].trim() : '',
    whatMattersMost: wmmMatch ? wmmMatch[1].trim() : '',
  }
}

export default function InspoModal({ record, grade, onClose, onPrev, onNext, hasPrev, hasNext }) {
  const [videoFullscreen, setVideoFullscreen] = useState(false)

  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowLeft' && hasPrev) onPrev()
    if (e.key === 'ArrowRight' && hasNext) onNext()
  }, [onClose, onPrev, onNext, hasPrev, hasNext])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [handleKey])

  if (!record) return null

  const { inspoDirection, whatMattersMost } = parseNotes(record.notes)
  const views = formatNum(record.views)
  const likes = formatNum(record.likes)
  const comments = formatNum(record.comments)
  const shares = formatNum(record.shares)

  const embedHtml = record.dbEmbedCode
    ? record.dbEmbedCode.replace('<video ', '<video autoplay muted loop ')
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full h-full md:h-auto md:max-h-[90vh] md:max-w-5xl md:mx-6 md:rounded-2xl bg-[#111] overflow-hidden border-0 md:border md:border-[#2a2a2a] flex flex-col">

        {/* Header */}
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'16px 22px', borderBottom:'1px solid #222', gap:'16px'}}>
          <div style={{minWidth:0}}>
            <h2 style={{fontSize:'18px', fontWeight:600, color:'#fff', lineHeight:1.4, margin:0}}>{record.title}</h2>
            {record.username && (
              <p style={{fontSize:'12px', color:'#71717a', marginTop:'6px'}}>@{record.username}</p>
            )}
          </div>
          <button onClick={onClose} style={{flexShrink:0, color:'#71717a', background:'none', border:'none', cursor:'pointer', padding:'4px', marginTop:'2px'}}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

          {/* Video */}
          <div className="w-full flex-shrink-0 bg-black relative">
            {embedHtml ? (
              <div className="w-full" dangerouslySetInnerHTML={{ __html: embedHtml }} />
            ) : record.thumbnail ? (
              <img src={record.thumbnail} alt={record.title} className="w-full object-contain" />
            ) : null}
          </div>

          {/* Details */}
          <div style={{flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', padding:'22px 28px', borderTop:'1px solid #222', display:'flex', flexDirection:'column', gap:'20px'}} className="md:border-t-0 md:border-l md:border-l-[#222]">

            {/* Stats */}
            <div className="flex items-center gap-5 text-sm" style={{flexWrap:'wrap'}}>
              {/* Grade */}
              {grade && (
                <span style={{
                  display:'inline-flex', alignItems:'center', justifyContent:'center',
                  background: gradeColor(grade),
                  color: grade === 'D' ? '#a1a1aa' : '#000',
                  borderRadius:'8px',
                  fontSize:'14px', fontWeight:800,
                  padding:'2px 10px',
                  letterSpacing:'-0.02em',
                }}>
                  {grade}
                </span>
              )}
              {views && (
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {views}
                </span>
              )}
              {likes && (
                <span className="flex items-center gap-1.5 text-rose-400">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                  {likes}
                </span>
              )}
              {comments && (
                <span className="flex items-center gap-1.5 text-blue-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {comments}
                </span>
              )}
              {shares && (
                <span className="flex items-center gap-1.5 text-green-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {shares}
                </span>
              )}
            </div>

            {/* Tags */}
            {record.tags.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-3">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {record.tags.map((tag) => (
                    <span key={tag} style={{fontSize:'12px', padding:'4px 12px', borderRadius:'9999px', ...tagStyle(tag)}}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Film Format */}
            {record.filmFormat.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-3">Film Format</p>
                <div className="flex flex-wrap gap-2">
                  {record.filmFormat.map((f) => (
                    <span key={f} className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-400">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* On-Screen Text */}
            {record.onScreenText && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-2">On-Screen Text</p>
                <p className="text-sm text-zinc-300 italic">"{record.onScreenText}"</p>
              </div>
            )}

            {/* Inspo Direction */}
            {inspoDirection && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-2">Inspo Direction</p>
                <p className="text-sm text-zinc-200 leading-relaxed">{inspoDirection}</p>
              </div>
            )}

            {/* What Matters Most */}
            {whatMattersMost && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-2">What Matters Most</p>
                <p className="text-sm text-zinc-200 leading-relaxed">{whatMattersMost}</p>
              </div>
            )}

            {/* Original link */}
            {record.contentLink && (
              <div>
                <a
                  href={record.contentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View original
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Prev / Next */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 22px', borderTop:'1px solid #222'}}>
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{background:'#222', color:'#d4d4d8', border:'1px solid #333', borderRadius:'9999px', padding:'8px 18px'}}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Prev
          </button>
          <button
            onClick={onNext}
            disabled={!hasNext}
            className="flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{background:'#222', color:'#d4d4d8', border:'1px solid #333', borderRadius:'9999px', padding:'8px 18px'}}
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    {/* Fullscreen portrait video overlay */}
    {videoFullscreen && embedHtml && (
      <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center" onClick={() => setVideoFullscreen(false)}>
        <button
          onClick={(e) => { e.stopPropagation(); setVideoFullscreen(false) }}
          className="absolute top-5 right-5 z-10 text-white bg-black/60 rounded-full p-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div
          className="h-full w-auto"
          style={{maxWidth:'calc(100vh * 9 / 16)'}}
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: embedHtml }}
        />
      </div>
    )}
  )
}
