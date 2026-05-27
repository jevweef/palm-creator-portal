'use client'

import { useUser } from '@clerk/nextjs'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useMemo } from 'react'

import SetupTab from './SetupTab'
import WorkflowTab from './WorkflowTab'
import WarmupTab from './WarmupTab'
import StrategyTab from './StrategyTab'

// AI Content — formerly "AI Source." Route stays /admin/recreate-source so
// existing bookmarks and the underlying API contract stay intact (Phase 1+2
// Publer + ai-editor flows reference this path). The page is now a tab strip:
//
//   Workflow  → AI editor's TJP-feeding workspace (placeholder → /ai-editor)
//   Setup     → original AI Source content (per-creator AI toggle, sources)
//   Warm-Up   → per-account 90-day daily tasks (Batch 2)
//   Strategy  → "what's next for [creator]" engine (Batch 3)
//
// Default tab per role: admin → Setup; ai_editor → Workflow.
const TABS = [
  { key: 'workflow', label: 'Workflow', roles: ['admin', 'super_admin', 'ai_editor'] },
  { key: 'setup',    label: 'Setup',    roles: ['admin', 'super_admin'] },
  { key: 'warmup',   label: 'Warm-Up',  roles: ['admin', 'super_admin'] },
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
      <div>
        {active.key === 'workflow' && <WorkflowTab />}
        {active.key === 'setup'    && <SetupTab />}
        {active.key === 'warmup'   && <WarmupTab />}
        {active.key === 'strategy' && <StrategyTab />}
      </div>
    </div>
  )
}
