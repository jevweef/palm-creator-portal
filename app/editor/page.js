'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { EditorDashboardContent, EditorRevisionsView } from '@/components/EditorDashboard'
import OftvProjectsQueue from '@/components/OftvProjectsQueue'
import LongFormUpload from '@/components/LongFormUpload'

export { EditorDashboardContent }

export default function EditorDashboardPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'dashboard')
  const [toast, setToast] = useState(null)
  // Lightweight poll just for the revisions count badge — same endpoint the
  // dashboard already hits, so no real cost at the API layer.
  const [revisionCount, setRevisionCount] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/editor/dashboard')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const total = (data.creators || []).reduce((sum, c) => sum + (c.needsRevision?.length || 0), 0)
        setRevisionCount(total)
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [activeTab])

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
    { key: 'revisions', label: '⚠ Revisions', badge: revisionCount },
    { key: 'oftv', label: '🎬 OFTV Projects' },
    { key: 'longform', label: '⬆️ Long Form Upload' },
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
                display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}>
              {tab.label}
              {tab.badge ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: '18px', height: '18px', padding: '0 6px', borderRadius: '9px',
                  fontSize: '10px', fontWeight: 700, letterSpacing: 0,
                  background: 'rgba(232, 120, 120, 0.15)', color: '#E87878',
                }}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && <EditorDashboardContent />}
        {activeTab === 'revisions' && <EditorRevisionsView />}
        {activeTab === 'oftv' && <OftvProjectsQueue showToast={showToast} />}
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
