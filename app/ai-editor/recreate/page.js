'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { ModalHost, OutfitSwapPanel, StageBPanel } from '@/components/recreate/panels'

const TABS = [
  { key: 'stageb', label: 'Stage B' },
  { key: 'outfit', label: 'Outfit Swap' },
]

function TabBar({ tab, setTab }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 }}>
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          style={{
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: tab === t.key ? 'var(--foreground)' : 'var(--foreground-muted)',
            background: 'none',
            border: 'none',
            borderBottom: tab === t.key ? '2px solid var(--palm-pink)' : '2px solid transparent',
            cursor: 'pointer',
            marginBottom: -1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function AiEditorRecreatePage() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tabParam = sp.get('tab')
  const tab = tabParam === 'outfit' ? 'outfit' : 'stageb'
  const setTab = (k) => router.replace(`${pathname}?tab=${k}`, { scroll: false })

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', padding: '24px 32px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <TabBar tab={tab} setTab={setTab} />
        {tab === 'stageb' ? <StageBPanel /> : <OutfitSwapPanel />}
        <ModalHost />
      </div>
    </div>
  )
}
