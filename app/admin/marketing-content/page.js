'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Marketing Content — admin-only at-a-glance hub introduced in SMM Batch 1.
// Cross-stream view of in-flight content + needs-review counts + quick links
// into the surfaces where real work happens. Not a parent route with children:
// it's a single landing page.
//
// KPI tiles read /api/admin/marketing-content/overview. Counts are aggregated
// from existing Posts + Tasks tables — no new Airtable schema for Batch 1.
// "Active warm-ups" returns 0 until Batch 2 ships the Warmup table.

const TILES = [
  { key: 'aiInFlight',      label: 'AI posts in flight',  hint: 'Submitted to Publer, awaiting publish' },
  { key: 'realInFlight',    label: 'Real posts in flight', hint: 'Queued / sending to Telegram (Amin)' },
  { key: 'needsReview',     label: 'Needs your review',    hint: 'Tasks awaiting admin approval' },
  { key: 'activeWarmups',   label: 'Active warm-ups',      hint: 'AI accounts in their 90-day warm-up' },
]

// Grouped quick links — review/decide stuff first (most-frequent admin action),
// strategy/setup second (planning), outbound/operational third (when content
// is moving). Order within group is most → least common.
const LINK_GROUPS = [
  {
    title: 'Review & Approve',
    links: [
      { label: 'Editor — For Review',     href: '/admin/editor?tab=review',     icon: '👀' },
      { label: 'Post Prep',               href: '/admin/editor?tab=postprep',   icon: '📝' },
      { label: 'Carousels',               href: '/admin/editor?tab=carousels',  icon: '📸' },
      { label: 'OFTV Projects',           href: '/admin/editor?tab=oftv',       icon: '📺' },
    ],
  },
  {
    title: 'Strategy & Setup',
    links: [
      { label: 'AI Content',              href: '/admin/recreate-source',                icon: '🎨' },
      { label: 'Account Warm-Up',         href: '/admin/account-warmup',                 icon: '🔥' },
      { label: 'Content Strategy',        href: '/admin/recreate-source?tab=strategy',   icon: '🧭' },
      { label: 'Creator Library',         href: '/admin/editor?tab=library',             icon: '📂' },
    ],
  },
  {
    title: 'Outbound',
    links: [
      { label: 'Grid Planner',            href: '/admin/editor?tab=grid',  icon: '🗓️' },
      { label: 'Publer Mappings',         href: '/admin/publer',           icon: '📅' },
    ],
  },
]

export default function MarketingContentPage() {
  const [overview, setOverview] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/marketing-content/overview')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setOverview(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ padding: '24px 8px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: 'var(--foreground)' }}>
          Marketing Content
        </h1>
        <p style={{ marginTop: 6, color: 'var(--foreground-muted)', fontSize: 13 }}>
          At-a-glance view of both content streams — AI accounts and real-creator posts.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 14,
        marginBottom: 32,
      }}>
        {TILES.map(t => (
          <div key={t.key} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            padding: '18px 18px 16px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.label}
            </div>
            <div style={{ marginTop: 10, fontSize: 28, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1 }}>
              {overview ? overview[t.key] : (error ? '—' : '…')}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--foreground-muted)' }}>
              {t.hint}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {LINK_GROUPS.map(group => (
          <div key={group.title}>
            <h2 style={{
              margin: '0 0 10px', fontSize: 11, fontWeight: 700,
              color: 'var(--foreground-muted)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              {group.title}
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 8,
            }}>
              {group.links.map(l => (
                <Link key={l.href} href={l.href} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'rgba(232,160,160,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 9,
                  textDecoration: 'none',
                  color: 'var(--foreground)',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: '0.15s ease',
                }}>
                  <span style={{ fontSize: 17 }}>{l.icon}</span>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 28, padding: 14, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 8, fontSize: 12, color: '#e87878' }}>
          Couldn't load counts: {error}
        </div>
      )}

      <div style={{ marginTop: 36, padding: 16, border: '1px dashed rgba(255,255,255,0.10)', borderRadius: 10, fontSize: 12, color: 'var(--foreground-subtle)' }}>
        Coming soon: reach trend sparklines, posted-this-week count, per-account engagement
        deltas — these light up once Publer Phase 3 starts collecting analytics.
      </div>
    </div>
  )
}
