'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { tagStyle } from '@/lib/tagStyle'
import { buildStreamIframeUrl } from '@/lib/cfStreamUrl'

function formatNum(n) {
  if (!n || n < 0) return null
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

function VideoPane({ record }) {
  const embedHtml = useMemo(() => {
    if (!record.dbEmbedCode) return null
    const raw = record.dbEmbedCode.replace('<video ', '<video autoplay muted loop ')
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['video', 'source'],
      ADD_ATTR: ['autoplay', 'muted', 'loop', 'controls', 'playsinline', 'src', 'type', 'poster'],
    })
  }, [record.dbEmbedCode])

  return (
    <div className="w-full bg-black overflow-hidden rounded-2xl" style={{ aspectRatio: '9/16', maxWidth: 320 }}>
      {record.streamUid ? (
        <iframe
          key={record.streamUid}
          src={buildStreamIframeUrl(record.streamUid, { autoplay: true, muted: true, loop: true, controls: true })}
          allow="autoplay; fullscreen"
          allowFullScreen
          className="w-full h-full"
          style={{ border: 'none' }}
        />
      ) : embedHtml ? (
        <div key={record.id} className="w-full h-full" dangerouslySetInnerHTML={{ __html: embedHtml }} />
      ) : record.dbRawLink ? (
        <video key={record.id} src={record.dbRawLink} controls autoPlay muted loop className="w-full h-full object-cover" />
      ) : null}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div>
      <p
        style={{
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#999',
          marginBottom: '8px',
        }}
      >
        {label}
      </p>
      {children}
    </div>
  )
}

function AnalysisColumn({ heading, modelLabel, accentColor, data }) {
  if (!data) return null
  return (
    <div
      className="flex-1 min-w-0 rounded-2xl bg-[#0f0f0f] flex flex-col"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.15)' }}
    >
      <div
        style={{
          padding: '18px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 6,
              background: accentColor,
              color: '#000',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {heading}
          </div>
          <p style={{ fontSize: 11, color: '#666', marginTop: 6, fontFamily: 'monospace' }}>{modelLabel}</p>
        </div>
        <div style={{ fontSize: 14, color: 'rgba(240,236,232,0.85)', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>
          {data.title}
        </div>
      </div>

      <div className="flex flex-col gap-5" style={{ padding: '22px 24px' }}>
        {data.tags?.length > 0 && (
          <Section label={`Tags (${data.tags.length})`}>
            <div className="flex flex-wrap gap-2">
              {data.tags.map((tag) => (
                <span key={tag} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 9999, ...tagStyle(tag) }}>
                  {tag}
                </span>
              ))}
            </div>
          </Section>
        )}

        {data.filmFormat?.length > 0 && (
          <Section label="Film Format">
            <div className="flex flex-wrap gap-2">
              {data.filmFormat.map((f) => (
                <span key={f} className="text-xs px-3 py-1 rounded" style={{ background: '#F5F0F2', color: '#888' }}>
                  {f}
                </span>
              ))}
            </div>
          </Section>
        )}

        {data.onScreenText && (
          <Section label="On-Screen Text">
            <p style={{ fontSize: 14, color: 'rgba(240,236,232,0.85)', fontStyle: 'italic' }}>
              &ldquo;{data.onScreenText}&rdquo;
            </p>
          </Section>
        )}

        {data.inspoDirection && (
          <Section label="Inspo Direction">
            <p style={{ fontSize: 14, color: 'rgba(240,236,232,0.92)', lineHeight: 1.7 }}>{data.inspoDirection}</p>
          </Section>
        )}

        {data.whatMattersMost && (
          <Section label="What Matters Most">
            <p style={{ fontSize: 14, color: 'rgba(240,236,232,0.92)', lineHeight: 1.7 }}>{data.whatMattersMost}</p>
          </Section>
        )}

        {data.suggestedTags?.length > 0 && (
          <Section label="Suggested New Tags">
            <div className="flex flex-wrap gap-2">
              {data.suggestedTags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 12,
                    padding: '4px 12px',
                    borderRadius: 9999,
                    background: 'rgba(232,160,160,0.08)',
                    color: 'var(--palm-pink)',
                    border: '1px dashed rgba(232,160,160,0.4)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

export default function SonnetTestPage() {
  const [records, setRecords] = useState(null)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    fetch('/sonnet-test-data.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setRecords(Array.isArray(data) ? data : []))
      .catch((e) => setError(String(e)))
  }, [])

  const total = records?.length ?? 0
  const record = records?.[index] ?? null

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [goPrev, goNext])

  if (error) {
    return (
      <div style={{ padding: 40, color: '#f87171', fontFamily: 'monospace' }}>
        Failed to load /sonnet-test-data.json: {error}
        <p style={{ color: '#888', marginTop: 12, fontSize: 13 }}>
          Run <code>cd ~/inspo_test && .venv/bin/python sonnet_batch.py</code> to regenerate the data file.
        </p>
      </div>
    )
  }
  if (!records) {
    return <div style={{ padding: 40, color: '#888' }}>Loading comparisons…</div>
  }
  if (!record) {
    return <div style={{ padding: 40, color: '#888' }}>No records loaded.</div>
  }

  const views = formatNum(record.views)
  const likes = formatNum(record.likes)
  const comments = formatNum(record.comments)
  const shares = formatNum(record.shares)

  return (
    <div className="min-h-screen bg-[var(--background)]" style={{ padding: '24px 16px 80px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#888', marginBottom: 8 }}>
            Throwaway test page · OpenAI vs Sonnet · {index + 1} of {total}
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>{record.title}</h1>
          {record.username && (
            <p style={{ fontSize: 13, color: '#999', marginTop: 6 }}>
              @{record.username}
              {record.contentLink && (
                <>
                  <span style={{ margin: '0 8px', color: '#444' }}>·</span>
                  <a
                    href={record.contentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--palm-pink)', textDecoration: 'none' }}
                  >
                    View original ↗
                  </a>
                </>
              )}
            </p>
          )}
        </div>

        {/* Record selector */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 22 }}>
          {records.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setIndex(i)}
              title={r.title}
              style={{
                fontSize: 11,
                padding: '5px 11px',
                borderRadius: 9999,
                background: i === index ? 'var(--palm-pink)' : 'rgba(255,255,255,0.04)',
                color: i === index ? '#000' : '#aaa',
                border: i === index ? 'none' : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                fontWeight: i === index ? 600 : 400,
                maxWidth: 200,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {i + 1}. {r.title}
            </button>
          ))}
        </div>

        {/* Video + stats */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28, gap: 14 }}>
          <VideoPane record={record} />
          <div className="flex items-center gap-5 text-sm" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
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
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
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
        </div>

        {/* Side-by-side analysis */}
        <div className="flex flex-col md:flex-row gap-5">
          <AnalysisColumn
            heading="OpenAI"
            modelLabel={`${record.openai?.model || 'gpt-5.4-mini'} (currently in production)`}
            accentColor="#10A37F"
            data={record.openai}
          />
          <AnalysisColumn
            heading="Sonnet"
            modelLabel={record.sonnet?.model || 'claude-sonnet-4-6'}
            accentColor="#E8A0A0"
            data={record.sonnet}
          />
        </div>

        {/* Prev / Next */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 10 }}>
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(232, 160, 160, 0.06)',
              color: 'rgba(240, 236, 232, 0.75)',
              border: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              borderRadius: 9999,
              padding: '8px 18px',
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Prev
          </button>
          <button
            onClick={goNext}
            disabled={index >= total - 1}
            className="flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(232, 160, 160, 0.06)',
              color: 'rgba(240, 236, 232, 0.75)',
              border: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              borderRadius: 9999,
              padding: '8px 18px',
            }}
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
