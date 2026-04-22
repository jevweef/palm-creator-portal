'use client'

import { useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { EditorDashboardContent } from '@/components/EditorDashboard'
import LongFormUpload from '@/components/LongFormUpload'

export { EditorDashboardContent }

export default function EditorDashboardPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'dashboard')
  const [toast, setToast] = useState(null)

  const switchTab = (key) => {
    setActiveTab(key)
    router.replace(`${pathname}?tab=${key}`, { scroll: false })
  }

  const showToast = (msg, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3000)
  }

  const TABS = [
    { key: 'dashboard', label: '📋 Dashboard' },
    { key: 'longform', label: '🎬 Long Form' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)' }}>
      {/* Mobile-only overrides — desktop untouched */}
      <style>{`
        @media (max-width: 768px) {
          .editor-page-inner { padding: 14px 14px !important; }
          .editor-page-tabs {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            white-space: nowrap;
            flex-wrap: nowrap !important;
            margin: 0 -14px 18px !important;
            padding: 0 14px !important;
          }
          .editor-page-tabs::-webkit-scrollbar { display: none; }
          .editor-page-tabs button { flex-shrink: 0; }
        }
      `}</style>
      <div className="editor-page-inner" style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 32px' }}>
        {/* Tab bar */}
        <div className="editor-page-tabs" style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--card-border)', marginBottom: '32px' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => switchTab(tab.key)}
              style={{
                padding: '10px 20px', fontSize: '12px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: activeTab === tab.key ? 'var(--foreground)' : 'var(--foreground-muted)', background: 'none', border: 'none',
                borderBottom: activeTab === tab.key ? '1px solid var(--palm-pink)' : '1px solid transparent',
                cursor: 'pointer', marginBottom: '-1px', transition: 'all 0.3s var(--ease-stripe)',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && <EditorDashboardContent />}
        {activeTab === 'longform' && <LongFormUpload showToast={showToast} />}

        {toast && (
          <div style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 100,
            padding: '12px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
            background: toast.error ? 'rgba(232, 120, 120, 0.06)' : 'rgba(125, 211, 164, 0.08)',
            color: toast.error ? '#E87878' : '#7DD3A4',
            border: `1px solid ${toast.error ? 'rgba(232, 120, 120, 0.2)' : 'rgba(125, 211, 164, 0.2)'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  )
}
