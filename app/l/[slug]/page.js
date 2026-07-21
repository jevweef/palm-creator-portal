import { getLinkPageBySlug } from '@/lib/linkPages'

export const dynamic = 'force-dynamic'

// Brand marks (simple-icons paths) + colors. Anything without a path falls back
// to a lettered badge in its brand color — clean, no emoji (Evan dislikes emoji
// as UI icons).
const BRAND = {
  onlyfans:  { color: '#00AFF0', letter: 'OF' },
  fanvue:    { color: '#7C5CFF', letter: 'F' },
  instagram: { color: '#E4405F', path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z' },
  tiktok:    { color: '#FE2C55', path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
  youtube:   { color: '#FF0000', path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
  twitter:   { color: '#ffffff', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  x:         { color: '#ffffff', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  snapchat:  { color: '#FFFC00', letter: 'S' },
  threads:   { color: '#ffffff', letter: '@' },
  amazon:    { color: '#FF9900', letter: 'a' },
  patreon:   { color: '#F96854', path: 'M0 .48v23.04h4.219V.48zm15.384 0c-4.764 0-8.641 3.88-8.641 8.65 0 4.755 3.877 8.623 8.641 8.623 4.75 0 8.615-3.868 8.615-8.623C24 4.36 20.134.48 15.384.48z' },
  spotify:   { color: '#1DB954', path: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.24 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z' },
  twitch:    { color: '#9146FF', path: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z' },
  kick:      { color: '#53FC18', letter: 'K' },
  discord:   { color: '#5865F2', letter: 'D' },
  telegram:  { color: '#26A5E4', letter: 'T' },
  'cash app': { color: '#00D632', letter: '$' },
  cashapp:   { color: '#00D632', letter: '$' },
  link:      { color: '#E88FAC', letter: '↗' },
}
const brandOf = (p) => BRAND[String(p || 'link').toLowerCase()] || BRAND.link
// Platforms that render as the circular icon row up top (vs. full-width buttons).
const SOCIAL_ROW = new Set(['instagram', 'tiktok', 'twitter', 'x', 'snapchat', 'threads', 'patreon', 'spotify', 'youtube', 'twitch', 'kick', 'discord', 'telegram'])

function Glyph({ platform, size = 18, mono }) {
  const b = brandOf(platform)
  if (b.path) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill={mono ? '#fff' : b.color} aria-hidden="true">
        <path d={b.path} />
      </svg>
    )
  }
  return <span style={{ fontSize: size * 0.62, fontWeight: 800, color: mono ? '#fff' : b.color, lineHeight: 1 }}>{b.letter}</span>
}

export async function generateMetadata({ params }) {
  const page = await getLinkPageBySlug(params.slug)
  if (!page) return { title: 'Not found' }
  const img = page.coverImageUrl || page.avatarUrl
  return {
    title: `${page.displayName} | Official`,
    description: page.bio || `${page.displayName} — all my links`,
    openGraph: { title: `${page.displayName} | Official`, images: img ? [img] : [] },
    robots: { index: false },
  }
}

export default async function LinkPage({ params }) {
  const page = await getLinkPageBySlug(params.slug)

  if (!page || !page.published) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b0b0f', color: '#8a8a95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
        This page isn&apos;t available.
      </div>
    )
  }

  const light = page.theme === 'Light'
  const bg = light ? '#ece9ee' : '#08080b'
  const fg = light ? '#111' : '#f4f4f6'
  const sub = light ? '#666' : '#b6b6c2'
  const cardBg = light ? '#ffffff' : 'rgba(255,255,255,0.055)'
  const cardBorder = light ? '1px solid rgba(0,0,0,0.07)' : '1px solid rgba(255,255,255,0.09)'

  const links = page.links.filter((l) => l.label && (l.url || l.gated))
  const hrefFor = (l) => (l.gated ? `/l/${encodeURIComponent(page.slug)}/go/${encodeURIComponent(l.id)}` : l.url)
  const relFor = (l) => (l.gated ? 'nofollow' : 'nofollow noopener noreferrer')
  const targetFor = (l) => (l.gated ? '_self' : '_blank')

  // Split links into: circle social row / photo tiles / buttons.
  const socialRow = links.filter((l) => !l.gated && !l.image && SOCIAL_ROW.has(String(l.platform).toLowerCase()))
  const rest = links.filter((l) => !socialRow.includes(l))
  const tiles = rest.filter((l) => l.image)
  const buttons = rest.filter((l) => !l.image)

  const hero = page.coverImageUrl || page.avatarUrl

  return (
    <div style={{ minHeight: '100vh', background: bg, color: fg, fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex', justifyContent: 'center', padding: '20px 16px 56px' }}>
      <div style={{ width: '100%', maxWidth: 460 }}>

        {/* Hero photo card */}
        <div style={{ position: 'relative', borderRadius: 26, overflow: 'hidden', aspectRatio: '4 / 5', background: '#15151c', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          {hero && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt={page.displayName} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.86) 100%)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 20px 20px', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>{page.displayName}</span>
              {page.verified && (
                <svg width="22" height="22" viewBox="0 0 24 24" aria-label="Verified" style={{ flexShrink: 0 }}>
                  <path fill="#3897F0" d="M12 1l2.6 2.1 3.3-.4 1.2 3.1 3 1.5-1 3.2 1 3.2-3 1.5-1.2 3.1-3.3-.4L12 23l-2.6-2.1-3.3.4-1.2-3.1-3-1.5 1-3.2-1-3.2 3-1.5L5.1 2.7l3.3.4z" />
                  <path fill="#fff" d="M10.6 14.6l-2.2-2.2-1.3 1.3 3.5 3.5 6-6-1.3-1.3z" />
                </svg>
              )}
            </div>
            {(page.handle || true) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                {page.handle && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)' }}>{page.handle}</span>}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.82)', background: 'rgba(255,255,255,0.14)', padding: '2px 9px', borderRadius: 999, backdropFilter: 'blur(6px)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#38d66b', boxShadow: '0 0 6px #38d66b' }} /> Online
                </span>
              </div>
            )}
            {socialRow.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {socialRow.map((l) => (
                  <a key={l.id} href={hrefFor(l)} target={targetFor(l)} rel={relFor(l)} aria-label={l.label}
                    style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                    <Glyph platform={l.platform} size={17} mono />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {page.bio && <div style={{ fontSize: 14, color: sub, marginTop: 16, textAlign: 'center', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{page.bio}</div>}

        {/* Photo tiles (e.g. gated "More of me") */}
        {tiles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
            {tiles.map((l) => (
              <a key={l.id} href={hrefFor(l)} target={targetFor(l)} rel={relFor(l)}
                style={{ position: 'relative', display: 'block', borderRadius: 18, overflow: 'hidden', aspectRatio: '16 / 10', textDecoration: 'none' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.image} alt={l.label} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.72) 100%)' }} />
                <div style={{ position: 'absolute', left: 16, bottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 16, fontWeight: 800 }}>
                  {l.gated && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0v3z" /></svg>
                  )}
                  {l.label}
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Buttons */}
        {buttons.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 14 }}>
            {buttons.map((l) => {
              const b = brandOf(l.platform)
              return (
                <a key={l.id} href={hrefFor(l)} target={targetFor(l)} rel={relFor(l)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 15, background: cardBg, border: cardBorder, color: fg, textDecoration: 'none', fontSize: 15, fontWeight: 700, boxShadow: light ? '0 1px 2px rgba(0,0,0,0.04)' : 'none' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: b.color === '#ffffff' ? '#111' : b.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Glyph platform={l.platform} size={18} mono />
                  </span>
                  <span style={{ flex: 1, textAlign: 'center', marginLeft: -34, paddingLeft: 34 }}>{l.label}</span>
                </a>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: 34, textAlign: 'center', fontSize: 11, color: sub, opacity: 0.4 }}>{page.handle || page.displayName}</div>
      </div>
    </div>
  )
}
