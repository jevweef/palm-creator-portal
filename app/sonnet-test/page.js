'use client'

import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { tagStyle } from '@/lib/tagStyle'
import { buildStreamIframeUrl } from '@/lib/cfStreamUrl'

// ─── Test record (rec6fMhLBcFkSMGiL — "Who's Up for Second?") ───────────────
// Pulled live from Airtable so the video, stats, and the existing OpenAI
// analysis match what's on the inspo board. The Sonnet analysis below is the
// raw output from re-running the same prompt + frames + transcript through
// claude-sonnet-4-6.

const RECORD = {
  id: 'rec6fMhLBcFkSMGiL',
  title: 'Who’s Up for Second?',
  username: 'gracedzeja_',
  contentLink: 'https://www.instagram.com/reel/DTnSzwekbVF/',
  views: 386056,
  likes: 4213,
  comments: 31,
  shares: 16159,
  streamUid: 'd6c7a3fbb18b24b250f110b65a0aa767',
  dbRawLink: 'https://www.dropbox.com/scl/fi/laicq9plstbzhr8bwfonh/who-s-up-for-second-video.mp4?rlkey=ibr54c5h2yo4fyvcvjfbsram8&raw=1',
  dbEmbedCode: '<div style="width:100%; max-width:420px; margin:0 auto !important;"><div style="position:relative !important; width:100% !important; height:0 !important; padding-top:177.78% !important; background:#000 !important; overflow:hidden !important; border-radius:12px !important;"><video controls playsinline style="position:absolute !important; top:0 !important; left:0 !important; width:100% !important; height:100% !important; object-fit:contain !important; display:block !important;"><source src="https://www.dropbox.com/scl/fi/laicq9plstbzhr8bwfonh/who-s-up-for-second-video.mp4?rlkey=ibr54c5h2yo4fyvcvjfbsram8&raw=1" type="video/mp4"></video></div></div>',
}

const OPENAI = {
  model: 'gpt-5.4-mini',
  title: 'Who’s Up for Second?',
  inspoDirection:
    'Film yourself on a phone selfie while walking out of a gym or fitness space in workout clothes. Keep the camera held out front and let the movement feel casual, like you just finished training and are still in the moment. Add a quick glance to the camera and a little smirk while staying in motion. Needs a filming partner if you want the follow-behind angle instead of selfie.',
  whatMattersMost:
    'It’s a gym sweat-post with a sexual double meaning. The line about being up for a second frames the workout as a double entendre, so the visual needs to sell that she’s just left the gym and is hot, sweaty, and available for attention. The body is part of the appeal, but the joke is the hook.',
  onScreenText: 'Just finished my first sweat of the day... who’s up for a second?',
  tags: ['Soft Tease', 'Playful Personality', 'Body Focus', 'Thirst Trap'],
  filmFormat: ['Selfie', 'Single-Clip'],
  suggestedTags: ['Double Entendre', 'Gym Selfie', 'Suggestive Humor'],
}

const SONNET = {
  model: 'claude-sonnet-4-6',
  title: 'Who\'s Up for a Second?',
  inspoDirection:
    'Film yourself post-workout in a sports bra and leggings, holding your phone in a selfie-style angle that frames your chest and midriff. Move naturally — walking, turning, looking into the camera playfully. The double entendre text is the concept: “Just finished my first sweat of the day… who’s up for a second?” reads as a workout invite on the surface but is clearly an offer for sex. Let the clip breathe — don’t pose stiffly, just move around casually as if you just wrapped a session.',
  whatMattersMost:
    'The text is doing a clean double entendre: “first sweat of the day” and “who’s up for a second” sounds like fitness talk but means she’s offering round two in bed. The caption “Any volunteers?” locks in the invitation. It performs because it’s technically safe for Instagram while being unmistakably sexual to anyone paying attention. Pair that with visible cleavage and a bare midriff in the frame and the subtext lands immediately. This only works if the creator has a chest that makes the low-cut sports bra the visual anchor — without that, the text loses its punch.',
  onScreenText: 'Just finished my first sweat of the day… who’s up for a second?',
  tags: [
    'Nature / Outdoors',
    'Fitness / Gym',
    'Playful Personality',
    'Direct Flirt',
    'Boobs',
    'Body Focus',
    'Implied Scenario',
    'Eye Contact Driven',
  ],
  filmFormat: ['Selfie', 'Single-Clip'],
  suggestedTags: [
    'Double Entendre / Plausible Deniability',
    'Post-Workout / Gym Exit',
    'Open Invitation',
  ],
}

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
          src={buildStreamIframeUrl(record.streamUid, { autoplay: true, muted: true, loop: true, controls: true })}
          allow="autoplay; fullscreen"
          allowFullScreen
          className="w-full h-full"
          style={{ border: 'none' }}
        />
      ) : embedHtml ? (
        <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: embedHtml }} />
      ) : record.dbRawLink ? (
        <video src={record.dbRawLink} controls autoPlay muted loop className="w-full h-full object-cover" />
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
  return (
    <div
      className="flex-1 min-w-0 rounded-2xl bg-[#0f0f0f] flex flex-col"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.15)' }}
    >
      {/* Column header */}
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

      {/* Body */}
      <div className="flex flex-col gap-5" style={{ padding: '22px 24px' }}>
        {/* Tags */}
        {data.tags?.length > 0 && (
          <Section label={`Tags (${data.tags.length})`}>
            <div className="flex flex-wrap gap-2">
              {data.tags.map((tag) => (
                <span
                  key={tag}
                  style={{ fontSize: 12, padding: '4px 12px', borderRadius: 9999, ...tagStyle(tag) }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Film Format */}
        {data.filmFormat?.length > 0 && (
          <Section label="Film Format">
            <div className="flex flex-wrap gap-2">
              {data.filmFormat.map((f) => (
                <span
                  key={f}
                  className="text-xs px-3 py-1 rounded"
                  style={{ background: '#F5F0F2', color: '#888', border: 'none' }}
                >
                  {f}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* On-Screen Text */}
        {data.onScreenText && (
          <Section label="On-Screen Text">
            <p style={{ fontSize: 14, color: 'rgba(240,236,232,0.85)', fontStyle: 'italic' }}>
              &ldquo;{data.onScreenText}&rdquo;
            </p>
          </Section>
        )}

        {/* Inspo Direction */}
        {data.inspoDirection && (
          <Section label="Inspo Direction">
            <p style={{ fontSize: 14, color: 'rgba(240,236,232,0.92)', lineHeight: 1.7 }}>{data.inspoDirection}</p>
          </Section>
        )}

        {/* What Matters Most */}
        {data.whatMattersMost && (
          <Section label="What Matters Most">
            <p style={{ fontSize: 14, color: 'rgba(240,236,232,0.92)', lineHeight: 1.7 }}>{data.whatMattersMost}</p>
          </Section>
        )}

        {/* Suggested New Tags */}
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
  const views = formatNum(RECORD.views)
  const likes = formatNum(RECORD.likes)
  const comments = formatNum(RECORD.comments)
  const shares = formatNum(RECORD.shares)

  return (
    <div className="min-h-screen bg-[var(--background)]" style={{ padding: '24px 16px 80px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <p
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: '#888',
              marginBottom: 8,
            }}
          >
            Throwaway test page · OpenAI vs Sonnet
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
            {RECORD.title}
          </h1>
          {RECORD.username && (
            <p style={{ fontSize: 13, color: '#999', marginTop: 6 }}>
              @{RECORD.username}
              {RECORD.contentLink && (
                <>
                  <span style={{ margin: '0 8px', color: '#444' }}>·</span>
                  <a
                    href={RECORD.contentLink}
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

        {/* Video + stats */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 28,
            gap: 14,
          }}
        >
          <VideoPane record={RECORD} />
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
            modelLabel={OPENAI.model + ' (currently in production)'}
            accentColor="#10A37F"
            data={OPENAI}
          />
          <AnalysisColumn
            heading="Sonnet"
            modelLabel={SONNET.model}
            accentColor="#E8A0A0"
            data={SONNET}
          />
        </div>
      </div>
    </div>
  )
}
