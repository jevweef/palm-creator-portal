'use client'

import { EditorDashboardContent } from '@/components/EditorDashboard'

export { EditorDashboardContent }

export default function EditorDashboardPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div className="px-4 md:px-8" style={{ padding: '20px 32px' }}>
        <EditorDashboardContent />
      </div>
    </div>
  )
}
