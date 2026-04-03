'use client'

import { EditorDashboardContent } from '@/components/EditorDashboard'

export { EditorDashboardContent }

export default function EditorDashboardPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#FFF5F7', color: '#1a1a1a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 32px' }}>
        <EditorDashboardContent />
      </div>
    </div>
  )
}
