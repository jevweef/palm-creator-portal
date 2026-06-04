'use client'

// ============================================================================
// Social Media Hub — the single home for all social-media content work.
//
// Replaces four separate sidebar items (Marketing Content, AI Content,
// Account Warm-Up, Editor) with ONE hub. This intentionally reverses the
// 2026-05-27 "no single parent" decision — see
// docs/build-plans/smm-consolidation/ + the master plan memory file.
//
// SHAPE (locked 2026-05-29): separate front, shared-back LOCATION.
//   • Overview      — at-a-glance KPIs + (coming) creator upload-volume tracker
//   • Real Content  — real, human-filmed content (AI filtered OUT)
//   • AI Content    — AI-generated content (its own dashboard + workflow)
//   • Outbound      — review → schedule → post; SHARED location, but content
//                     never mixes. Routing is automatic by type:
//                     AI → Publer, Real → Telegram. (Filters + separate
//                     grids-with-toggle land in a follow-up milestone.)
//
// MILESTONE 1 (this file): the nav backbone + re-parenting of existing,
// working surfaces. Every panel below is an existing component — nothing was
// rewritten. Follow-ups: Outbound All/Real/AI filters, separate Real/AI grids
// with a per-creator toggle, AI dashboard, Overview upload tracker.
// ============================================================================

import { useUser } from '@clerk/nextjs'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'

// Real Content + Outbound surfaces (reused from the Editor page — three of
// these are newly `export`ed inline components; the rest were already modules).
import { EditorDashboardContent } from '@/components/EditorDashboard'
import { SubmissionsFeed, UnreviewedLibrary } from '@/app/admin/editor/page'
import PostsPage from '@/app/admin/posts/page'
import GridPlanner from '@/components/GridPlanner'
import CarouselsTab from '@/app/admin/editor/CarouselsTab'

// AI Content surfaces (reused from /admin/recreate-source).
import SetupTab from '@/app/admin/recreate-source/SetupTab'
import WorkflowTab from '@/app/admin/recreate-source/WorkflowTab'
import StrategyTab from '@/app/admin/recreate-source/StrategyTab'
import WarmupTab from '@/app/admin/recreate-source/WarmupTab'

// Overview (reused from /admin/marketing-content).
import MarketingContentPage from '@/app/admin/marketing-content/page'

// Shared hub primitives — one design language across every section.
import { HubSection, ContentReview, OftvAndLongForm, AccountsPanel, ContentMovement } from './_components'

// --- small in-hub panels for surfaces not yet built out ---------------------

function PublerPanel() {
  return (
    <div style={{ padding: 32, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Publer</h2>
      <p style={{ marginTop: 12, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
        AI content schedules out through Publer. Account mappings and scheduling live on the
        dedicated Publer page.
      </p>
      <Link href="/admin/publer" style={{ display: 'inline-block', marginTop: 16, padding: '10px 18px', borderRadius: 8, background: 'var(--palm-pink)', color: '#1a1a1a', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
        Open Publer →
      </Link>
    </div>
  )
}

// --- section / sub-tab config -----------------------------------------------
// `render` receives { showToast }. Sections key off ?tab=, sub-tabs off ?sub=.

// Four sections (locked 2026-05-29): Overview / Content / Accounts & Setup /
// Outbound. The two axes (Real vs AI, Reel vs Carousel vs Photo) never blur.
// `aiEditor: true` marks the only subtabs an ai_editor may reach (everything
// else is real-content or admin and stays hidden from them).
const SECTIONS = [
  {
    key: 'overview', label: 'Overview',
    subtabs: [
      { key: 'home', label: 'Overview', render: () => (
        <div>
          <ContentMovement />
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 32px 8px' }} />
          <MarketingContentPage />
        </div>
      ) },
      // Lens A — whole-team / editor workload (the existing editor dashboard).
      { key: 'workload',  label: 'Editor Workload',  render: () => <EditorDashboardContent /> },
    ],
  },
  {
    key: 'content', label: 'Content',
    subtabs: [
      // For Review first — it's the most frequent daily action.
      { key: 'review',      label: 'For Review',       render: ({ showToast }) => <ContentReview showToast={showToast} /> },
      { key: 'library',     label: 'Creator Library',  render: ({ showToast }) => <UnreviewedLibrary showToast={showToast} /> },
      { key: 'submissions', label: 'Submissions',      render: ({ showToast }) => <SubmissionsFeed showToast={showToast} /> },
      { key: 'carousels',   label: 'Carousels',        render: ({ showToast }) => <CarouselsTab showToast={showToast} /> },
      { key: 'workflow',    label: 'AI Workflow',      render: () => <WorkflowTab />, aiEditor: true },
      { key: 'oftv',        label: 'OFTV & Long Form', render: ({ showToast }) => <OftvAndLongForm showToast={showToast} /> },
    ],
  },
  {
    key: 'outbound', label: 'Outbound',
    subtabs: [
      { key: 'postprep',  label: 'Post Prep',    render: () => <PostsPage /> },
      { key: 'grid',      label: 'Grid Planner', render: () => <GridPlanner /> },
      { key: 'publer',    label: 'Publer',       render: () => <PublerPanel /> },
    ],
  },
  // Accounts & Setup last — it's config/reference, kept out of the daily
  // Content -> Outbound workflow.
  {
    key: 'accounts', label: 'Accounts & Setup',
    subtabs: [
      { key: 'accounts', label: 'Accounts', render: () => <AccountsPanel /> },
      { key: 'warmup',   label: 'Warm-Up',  render: () => <WarmupTab />, aiEditor: true },
      { key: 'setup',    label: 'Setup',    render: () => <SetupTab containerMaxWidth="none" /> },
      { key: 'strategy', label: 'Strategy', render: () => <StrategyTab maxWidth="none" /> },
    ],
  },
]

// Back-compat: old deep links used ?tab=real|ai (the pre-2026-05-29 sections).
const SECTION_ALIAS = { real: 'content', ai: 'content' }

function SocialHubInner() {
  const { user } = useUser()
  const role = user?.publicMetadata?.role
  const isAiEditor = role === 'ai_editor'

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // ai_editor may ONLY reach aiEditor:true subtabs (AI Workflow + Warm-Up) —
  // never real-content or admin surfaces. Pre-filter subtabs, then drop any
  // section left with nothing visible.
  const subtabAllowed = (t) => (isAiEditor ? !!t.aiEditor : true)
  const visibleSections = SECTIONS
    .map(s => ({ ...s, subtabs: s.subtabs.filter(subtabAllowed) }))
    .filter(s => s.subtabs.length > 0)
  const defaultSectionKey = isAiEditor ? 'content' : 'overview'

  const [toast, setToast] = useState(null)
  const showToast = useCallback((msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const rawSection = searchParams.get('tab')
  const urlSection = SECTION_ALIAS[rawSection] || rawSection
  const urlSub = searchParams.get('sub')

  const activeSection = visibleSections.find(s => s.key === urlSection) || visibleSections.find(s => s.key === defaultSectionKey) || visibleSections[0]

  // sub-tabs are already role-filtered in visibleSections
  const availableSubtabs = activeSection.subtabs
  const activeSub = availableSubtabs.find(t => t.key === urlSub) || availableSubtabs[0]

  // Keep the URL canonical so deep links + sidebar highlighting stay in sync.
  useEffect(() => {
    if (!activeSection || !activeSub) return
    if (rawSection !== activeSection.key || urlSub !== activeSub.key) {
      router.replace(`${pathname}?tab=${activeSection.key}&sub=${activeSub.key}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection?.key, activeSub?.key])

  const goSection = (sectionKey) => {
    const sec = visibleSections.find(s => s.key === sectionKey)
    const firstSub = sec?.subtabs[0]
    router.replace(`${pathname}?tab=${sectionKey}&sub=${firstSub?.key || ''}`, { scroll: false })
  }
  const goSub = (subKey) => {
    router.replace(`${pathname}?tab=${activeSection.key}&sub=${subKey}`, { scroll: false })
  }

  return (
    <div>
      <style>{`
        @media (max-width: 768px) {
          .smm-subtabs { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; white-space: nowrap; flex-wrap: nowrap !important; }
          .smm-subtabs::-webkit-scrollbar { display: none; }
          .smm-sections { flex-wrap: wrap; }
        }
      `}</style>

      {/* Section pills — the top-level content streams */}
      <div className="smm-sections" style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        {visibleSections.map(sec => {
          const isActive = sec.key === activeSection.key
          return (
            <button
              key={sec.key}
              onClick={() => goSection(sec.key)}
              style={{
                padding: '8px 16px', borderRadius: 9999, cursor: 'pointer',
                fontSize: 13, fontWeight: isActive ? 700 : 500, letterSpacing: '-0.01em',
                border: `1px solid ${isActive ? 'var(--palm-pink)' : 'rgba(255,255,255,0.10)'}`,
                background: isActive ? 'rgba(232,160,160,0.12)' : 'transparent',
                color: isActive ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                transition: '0.15s ease',
              }}
            >
              {sec.label}
            </button>
          )
        })}
      </div>

      {/* Sub-tab row — the surfaces within the active section */}
      <div className="smm-subtabs" style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 24 }}>
        {availableSubtabs.map(t => {
          const isActive = t.key === activeSub.key
          return (
            <button
              key={t.key}
              onClick={() => goSub(t.key)}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--foreground)' } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--foreground-muted)' } }}
              style={{
                position: 'relative', padding: '12px 16px', marginBottom: -1,
                fontSize: 13, fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--foreground)' : 'var(--foreground-muted)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                transition: 'color 180ms ease',
              }}
            >
              {t.label}
              <span aria-hidden="true" style={{
                position: 'absolute', left: 12, right: 12, bottom: -1, height: 2,
                background: 'var(--palm-pink)', borderRadius: '2px 2px 0 0',
                transform: isActive ? 'scaleX(1)' : 'scaleX(0)', transformOrigin: 'center',
                transition: 'transform 220ms ease',
              }} />
            </button>
          )
        })}
      </div>

      {/* Active panel — routed through HubSection so every section body is
          full-width and consistent (no per-component maxWidth divergence). */}
      <HubSection>{activeSub.render({ showToast })}</HubSection>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: toast.error ? '#2d1515' : 'rgba(125, 211, 164, 0.08)',
          color: toast.error ? '#E87878' : '#7DD3A4',
          border: `1px solid ${toast.error ? '#5c2020' : 'rgba(125, 211, 164, 0.2)'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

export default function SocialHubPage() {
  // useSearchParams requires a Suspense boundary for static generation.
  return (
    <Suspense fallback={<div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: 24 }}>Loading…</div>}>
      <SocialHubInner />
    </Suspense>
  )
}
