'use client'

import { useEffect, useState } from 'react'

// Cloaking interstitial. The real destination (OnlyFans) is NOT in this page's
// HTML — it's fetched from /api/l/resolve by JS after a brief delay, then we
// redirect. A link scraper that only reads HTML (what Instagram does) sees this
// "checking you're human" screen, never the OF link.
export default function GatePage({ params }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/l/resolve?slug=${encodeURIComponent(params.slug)}&linkId=${encodeURIComponent(params.linkId)}`, { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (!cancelled && j.url) { window.location.replace(j.url); return }
        if (!cancelled) setFailed(true)
      } catch { if (!cancelled) setFailed(true) }
    }, 1100)
    return () => { cancelled = true; clearTimeout(t) }
  }, [params.slug, params.linkId])

  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0f', color: '#f4f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        {!failed ? (
          <>
            <div style={{ width: 34, height: 34, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#E88FAC', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: 14, color: '#c9c9d2' }}>Checking you&apos;re human…</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </>
        ) : (
          <div style={{ fontSize: 14, color: '#9a9aa5' }}>
            Couldn&apos;t open that link.{' '}
            <a href={`/l/${encodeURIComponent(params.slug)}`} style={{ color: '#E88FAC' }}>Go back</a>
          </div>
        )}
      </div>
    </div>
  )
}
