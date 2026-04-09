'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import AdminPipeline from '@/app/admin/page'
import AdminSources from '@/app/admin/sources/page'
import AdminReview from '@/app/admin/review/page'
import AdminImport from '@/app/admin/import/page'
import TextTrainingPage from '@/app/admin/training/page'

const TABS = [
  { key: 'pipeline', label: 'Pipeline', icon: '⚡' },
  { key: 'sources', label: 'Sources', icon: '📡' },
  { key: 'review', label: 'Review', icon: '✅' },
  { key: 'import', label: 'Import', icon: '📥' },
  { key: 'training', label: 'Training', icon: '🧠' },
]

export default function InspoBoard() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'pipeline')
  useEffect(() => { const t = searchParams.get('tab'); if (t) setActiveTab(t) }, [searchParams])

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a' }}>Inspo Board</div>
        <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Scrape, promote, review, and import reels for the inspiration board.</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '0' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); router.replace(`${pathname}?tab=${tab.key}`, { scroll: false }) }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', fontSize: '13px', fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#E88FAC' : '#999',
              background: 'none', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #E88FAC' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
              transition: 'color 0.15s',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'pipeline' && <AdminPipeline />}
      {activeTab === 'sources' && <AdminSources />}
      {activeTab === 'review' && <AdminReview />}
      {activeTab === 'import' && <AdminImport />}
      {activeTab === 'training' && <TextTrainingPage />}
    </div>
  )
}
