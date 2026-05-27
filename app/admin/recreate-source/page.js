'use client'

import { useUser } from '@clerk/nextjs'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useMemo } from 'react'

import SetupTab from './SetupTab'
import WorkflowTab from './WorkflowTab'
import StrategyTab from './StrategyTab'

// AI Content — formerly "AI Source." Route stays /admin/recreate-source so
// existing bookmarks and the underlying API contract stay intact (Phase 1+2
// Publer + ai-editor flows reference this path).
//
// Tab order (owner-set 2026-05-27):
//   Setup     → per-creator AI toggle, recreate-source sub-tabs (reel
//               library, rooms, avatar photos, scene, freeform)
//   Workflow  → embedded AI editor body — same view ai_editor users see
//   Strategy  → "what's next for [creator]" engine (Batch 3, placeholder)
//
// Warm-Up moved out of AI Content per owner — it's social-media account
// management, not AI content. Now lives at /admin/account-warmup.
//
// Default tab per role: admin → Setup; ai_editor → Workflow.
const TABS = [
  { key: 'setup',    label: 'Setup',    roles: ['admin', 'super_admin'] },
  { key: 'workflow', label: 'Workflow', roles: ['admin', 'super_admin', 'ai_editor'] },
  { key: 'strategy', label: 'Strategy', roles: ['admin', 'super_admin'] },
]

export default function AiContentPage() {
  const { user, isLoaded } = useUser()
  const role = user?.publicMetadata?.role
  const isAiEditor = role === 'ai_editor'

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const visibleTabs = useMemo(() => TABS.filter(t => t.roles.includes(role)), [role])
  const defaultKey = isAiEditor ? 'workflow' : 'setup'
  const requested = searchParams.get('tab')
  const active = (visibleTabs.find(t => t.key === requested) || visibleTabs.find(t => t.key === defaultKey) || visibleTabs[0])

  const goTab = (key) => {
    const sp = new URLSearchParams(Array.from(searchParams.entries()))
    sp.set('tab', key)
    router.replace(`${pathname}?${sp.toString()}`)
  }

  if (!isLoaded || !active) {
    return (
      <div style={{ padding: 40, color: 'var(--foreground-muted)', fontSize: 13 }}>Loading…</div>
    )
  }

  return (
    <div>
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '16px 24px 0' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--foreground)' }}>AI Content</h1>
        <div style={{ display: 'flex', gap: 2, marginTop: 14 }}>
          {visibleTabs.map(t => {
            const isActive = active.key === t.key
            return (
              <button
                key={t.key}
                onClick={() => goTab(t.key)}
                style={{
                  padding: '10px 18px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? 'var(--palm-pink)' : 'transparent'}`,
                  color: isActive ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                  fontWeight: isActive ? 600 : 400,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: '0.15s ease',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      {/* Uniform body wrapper so every tab renders at the same width
          (1200px max, centered, consistent padding). Setup's inner TabBar
          gets extra top padding because the double-tab-strip is otherwise
          crowded. */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 24px' }}>
        {active.key === 'workflow' && <WorkflowTab />}
        {active.key === 'setup'    && <SetupTab />}
        {active.key === 'strategy' && <StrategyTab />}
      </div>
    </div>
  )
}
