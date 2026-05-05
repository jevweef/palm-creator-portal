'use client'

import { useEffect, useCallback, useRef, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { useUser } from '@clerk/nextjs'
import { tagStyle } from '@/lib/tagStyle'
import { cdnUrlAtSize } from '@/lib/cdnImage'
import { buildStreamIframeUrl } from '@/lib/cfStreamUrl'

function gradeColor(grade) {
  if (!grade) return '#ccc'
  if (grade === 'A+') return '#ffd700'
  if (grade.startsWith('A')) return '#4ade80'
  if (grade.startsWith('B')) return '#78B4E8'
  if (grade.startsWith('C')) return '#E8A878'
  return '#999'
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

export default function InspoModal({ record, grade, onClose, onPrev, onNext, hasPrev, hasNext, isSaved, onSave, onUpload, viewAsCreator }) {
  const { user } = useUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  // Only show "Create AI" when admin has picked a creator in the view-as bar
  // AND that creator is toggled on for AI Conversions.
  const showCreateAI = isAdmin && viewAsCreator?.aiConversionsEnabled
  const bodyRef = useRef(null)

  // On mobile, auto-scroll to midpoint so content is visible on open
  useEffect(() => {
    if (bodyRef.current && window.innerWidth < 768) {
      requestAnimationFrame(() => {
        const el = bodyRef.current
        const mid = el.scrollHeight / 2 - window.innerHeight / 3
        el.scrollTo({ top: Math.max(0, mid) })
      })
    }
  }, [record])

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

  // Build video URL from DB Share Link (Dropbox dl=0 → dl=1 for direct)
  const videoUrl = record.dbRawLink || (record.dbShareLink
    ? record.dbShareLink.replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
    : null)

  // Pre-built responsive embed from Airtable — sanitize to prevent XSS
  const embedHtml = useMemo(() => {
    if (!record.dbEmbedCode) return null
    const raw = record.dbEmbedCode.replace('<video ', '<video autoplay muted loop ')
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['autoplay', 'muted', 'loop', 'controls', 'playsinline', 'src', 'type', 'poster'],
    })
  }, [record.dbEmbedCode])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full h-full md:h-auto md:max-h-[85vh] md:max-w-5xl md:mx-6 md:rounded-2xl bg-[#0f0f0f] overflow-hidden flex flex-col" style={{boxShadow: '0 8px 40px rgba(0,0,0,0.15)', border: 'none'}}>

        {/* Header */}
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'16px 22px', borderBottom:'1px solid transparent', gap:'16px'}}>
          <div style={{minWidth:0}}>
            <h2 style={{fontSize:'18px', fontWeight:600, color:'var(--foreground)', lineHeight:1.4, margin:0}}>{record.title}</h2>
            <div style={{display:'flex', alignItems:'center', gap:8, marginTop:6, flexWrap:'wrap'}}>
              {record.username && (
                <span style={{fontSize:'12px', color:'#999'}}>@{record.username}</span>
              )}
              {record.effort && (() => {
                const palette = {
                  Easy:     { bg: '#4ade80' },
                  Moderate: { bg: '#facc15' },
                  Niche:    { bg: '#f472b6' },
                }
                const c = palette[record.effort] || { bg: '#888' }
                return (
                  <span
                    title={record.effortReason || ''}
                    style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                      textTransform: 'uppercase', padding: '2px 8px',
                      borderRadius: 9999, background: c.bg, color: '#000',
                    }}
                  >
                    {record.effort}
                  </span>
                )
              })()}
              {record.effortBlockers?.length > 0 && record.effortBlockers.map((b) => (
                <span
                  key={b}
                  style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 9999,
                    background: 'rgba(255,255,255,0.04)', color: '#aaa',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
            {onUpload && (
              <button
                onClick={onUpload}
                style={{
                  background: 'var(--palm-pink)',
                  border: '1px solid transparent',
                  borderRadius: '9999px',
                  padding: '6px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--foreground)',
                  fontSize: '12px',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload
              </button>
            )}
            {onSave && (
              <button
                onClick={() => onSave(record.id)}
                style={{
                  background: isSaved ? 'var(--palm-pink)' : 'rgba(232, 160, 160, 0.06)',
                  border: isSaved ? '1px solid #E88FAC' : 'none',
                  boxShadow: isSaved ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
                  borderRadius: '9999px',
                  padding: '6px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: isSaved ? 'var(--foreground)' : '#888',
                  fontSize: '12px',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
              >
                <svg className="w-3.5 h-3.5" fill={isSaved ? 'var(--foreground)' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                {isSaved ? 'Saved' : 'Save'}
              </button>
            )}
            <button onClick={onClose} style={{color:'#999', background:'none', border:'none', cursor:'pointer', padding:'4px', marginTop:'2px'}}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — on desktop, video drives height; right side is absolute so it can't push taller */}
        <div ref={bodyRef} className="flex flex-col flex-1 min-h-0 overflow-y-auto md:overflow-visible md:relative md:flex-none">

          {/* Video — 9:16 aspect ratio sets the container height on desktop.
              Prefer Cloudflare Stream iframe (instant playback from edge) over
              the legacy embed/Dropbox <video> which can take 5-10s on first
              load. Falls back cleanly if record hasn't been mirrored yet. */}
          <div className="w-full shrink-0 md:shrink md:w-[280px] bg-black overflow-hidden" style={{aspectRatio:'9/16'}}>
            {record.streamUid ? (
              <iframe
                src={buildStreamIframeUrl(record.streamUid, { autoplay: true, muted: true, loop: true, controls: true })}
                allow="autoplay; fullscreen" allowFullScreen
                className="w-full md:h-full"
                style={{ border: 'none' }}
              />
            ) : embedHtml ? (
              <div className="w-full md:h-full" dangerouslySetInnerHTML={{ __html: embedHtml }} />
            ) : videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="w-full md:h-full object-cover"
                autoPlay
                muted
                loop
              />
            ) : (record.cdnUrl || record.thumbnail) ? (
              <img src={cdnUrlAtSize(record.cdnUrl, 1200) || record.thumbnail} alt={record.title} className="w-full md:h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#D4A0B0]">
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>

          {/* Details — absolute on desktop, pinned to right of video, scrolls within video height */}
          <div className="flex flex-col gap-5 p-[22px_28px] bg-[#0f0f0f] md:absolute md:top-0 md:bottom-0 md:left-[280px] md:right-0 md:overflow-y-auto border-t md:border-t-0 md:border-l border-[rgba(0,0,0,0.06)]">

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
                <span className="flex items-center gap-1.5 text-[#888]">
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
                <span className="flex items-center gap-1.5 text-green-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {shares}
                </span>
              )}
            </div>

            {/* Tags */}
            {record.tags.length > 0 && (() => {
              const visibleMobile = 3
              const extraCount = record.tags.length - visibleMobile
              return (
                <div>
                  <p style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.08em', color:'#999', marginBottom:'12px'}}>Tags</p>
                  {/* Desktop: all tags */}
                  <div className="hidden md:flex flex-wrap gap-2">
                    {record.tags.map((tag) => (
                      <span key={tag} style={{fontSize:'12px', padding:'4px 12px', borderRadius:'9999px', ...tagStyle(tag)}}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  {/* Mobile: first 3 + count */}
                  <div className="flex md:hidden flex-nowrap gap-2 items-center">
                    {record.tags.slice(0, visibleMobile).map((tag) => (
                      <span key={tag} style={{fontSize:'12px', padding:'4px 12px', borderRadius:'9999px', whiteSpace:'nowrap', ...tagStyle(tag)}}>
                        {tag}
                      </span>
                    ))}
                    {extraCount > 0 && (
                      <span className="text-xs whitespace-nowrap" style={{color:'#999'}}>+{extraCount}</span>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Film Format */}
            {record.filmFormat.length > 0 && (
              <div>
                <p style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.08em', color:'#999', marginBottom:'12px'}}>Film Format</p>
                <div className="flex flex-wrap gap-2">
                  {record.filmFormat.map((f) => (
                    <span key={f} className="text-xs px-3 py-1 rounded" style={{background:'#F5F0F2', color:'#888', border:'none'}}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* On-Screen Text */}
            {record.onScreenText && (
              <div>
                <p style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.08em', color:'#999', marginBottom:'8px'}}>On-Screen Text</p>
                <p style={{fontSize:'14px', color:'rgba(240, 236, 232, 0.85)', fontStyle:'italic'}}>"{record.onScreenText}"</p>
              </div>
            )}

            {/* Inspo Direction */}
            {inspoDirection && (
              <div>
                <p style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.08em', color:'#999', marginBottom:'8px'}}>Inspo Direction</p>
                <p style={{fontSize:'14px', color:'rgba(240, 236, 232, 0.92)', lineHeight:'1.7'}}>{inspoDirection}</p>
              </div>
            )}

            {/* What Matters Most */}
            {whatMattersMost && (
              <div>
                <p style={{fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.08em', color:'#999', marginBottom:'8px'}}>What Matters Most</p>
                <p style={{fontSize:'14px', color:'rgba(240, 236, 232, 0.92)', lineHeight:'1.7'}}>{whatMattersMost}</p>
              </div>
            )}

            {/* Original link + admin AI Recreate */}
            {record.contentLink && (
              <div style={{display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap'}}>
                <a
                  href={record.contentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs transition-colors"
                  style={{color:'var(--palm-pink)'}}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View original
                </a>
                {showCreateAI && (
                  <a
                    href={`/admin/inspo?tab=recreate&url=${encodeURIComponent(record.contentLink)}&creatorId=${encodeURIComponent(viewAsCreator.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
                    title={`Recreate this reel as ${viewAsCreator.name} using AI`}
                    style={{color:'var(--palm-pink)', border:'1px solid var(--palm-pink)', borderRadius:'9999px', padding:'4px 12px'}}
                  >
                    ✨ Create AI as {viewAsCreator.name}
                  </a>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Prev / Next */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 22px', borderTop:'1px solid transparent'}}>
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            className="flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{background:'rgba(232, 160, 160, 0.06)', color:'rgba(240, 236, 232, 0.75)', border:'none', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', borderRadius:'9999px', padding:'8px 18px'}}
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
            style={{background:'rgba(232, 160, 160, 0.06)', color:'rgba(240, 236, 232, 0.75)', border:'none', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', borderRadius:'9999px', padding:'8px 18px'}}
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
