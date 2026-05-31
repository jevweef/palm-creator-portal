'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Overview — the Social Media Hub's at-a-glance landing. Cross-stream view of
// in-flight content + needs-review counts, with clickable KPIs and quick links
// that route INTO the hub's sections (post-2026-05-29 restructure).
//
// KPI tiles read /api/admin/marketing-content/overview (aggregated from Posts +
// Tasks + AI Account Profile). No emoji icons (house style).
//
// Deeper lenses Evan asked for — whole-team/editor workload and per-creator
// at-a-glance — are a follow-up: the workload view already exists as the Editor
// Dashboard (Content → Editor Dashboard), and per-creator analytics need new
// aggregation + Publer Phase 3 data. Tracked in the hub redesign spec.

const HUB = '/admin/social'

const TILES = [
  { key: 'aiInFlight',    label: 'AI posts in flight',   hint: 'Submitted to Publer, awaiting publish', href: `${HUB}?tab=outbound&sub=publer` },
  { key: 'realInFlight',  label: 'Real posts in flight', hint: 'Queued / sending to Telegram (Amin)',    href: `${HUB}?tab=outbound&sub=postprep` },
  { key: 'needsReview',   label: 'Needs your review',    hint: 'Content awaiting admin approval',         href: `${HUB}?tab=content&sub=review` },
  { key: 'activeWarmups', label: 'Active warm-ups',      hint: 'AI accounts in their 90-day warm-up',     href: `${HUB}?tab=accounts&sub=warmup` },
]

// Quick links route into hub sections. Order: review/decide first, plan second,
// outbound third — most → least frequent admin action.
const LINK_GROUPS = [
  {
    title: 'Review & Approve',
    links: [
      { label: 'For Review',        href: `${HUB}?tab=content&sub=review` },
      { label: 'Post Prep',         href: `${HUB}?tab=outbound&sub=postprep` },
      { label: 'Carousels',         href: `${HUB}?tab=content&sub=carousels` },
      { label: 'OFTV & Long Form',  href: `${HUB}?tab=content&sub=oftv` },
    ],
  },
  {
    title: 'Strategy & Setup',
    links: [
      { label: 'AI Workflow',       href: `${HUB}?tab=content&sub=workflow` },
      { label: 'Account Warm-Up',   href: `${HUB}?tab=accounts&sub=warmup` },
      { label: 'Content Strategy',  href: `${HUB}?tab=accounts&sub=strategy` },
      { label: 'Creator Library',   href: `${HUB}?tab=content&sub=library` },
      { label: 'Accounts',          href: `${HUB}?tab=accounts&sub=accounts` },
    ],
  },
  {
    title: 'Outbound',
    links: [
      { label: 'Grid Planner',      href: `${HUB}?tab=outbound&sub=grid` },
      { label: 'Publer',            href: `${HUB}?tab=outbound&sub=publer` },
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
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: 'var(--foreground)' }}>
          Overview
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
          <Link key={t.key} href={t.href} style={{
            display: 'block', textDecoration: 'none',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            padding: '18px 18px 16px',
            transition: '0.15s ease',
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
          </Link>
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
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 28, padding: 14, background: 'rgba(232,120,120,0.08)', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 8, fontSize: 12, color: '#e87878' }}>
          Couldn&apos;t load counts: {error}
        </div>
      )}
    </div>
  )
}
