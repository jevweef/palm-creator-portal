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
    <div style={{ minHeight: '100vh', background: '#FFF5F7', color: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 32px' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid rgba(0,0,0,0.04)', marginBottom: '24px' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => switchTab(tab.key)}
              style={{
                padding: '6px 16px', fontSize: '13px', fontWeight: activeTab === tab.key ? 700 : 400,
                color: activeTab === tab.key ? '#1a1a1a' : '#bbb', background: 'none', border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid #E88FAC' : '2px solid transparent',
                cursor: 'pointer', marginBottom: '-2px', transition: 'all 0.15s',
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
            background: toast.error ? '#fef2f2' : '#dcfce7',
            color: toast.error ? '#ef4444' : '#22c55e',
            border: `1px solid ${toast.error ? '#fecaca' : '#bbf7d0'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  )
}
