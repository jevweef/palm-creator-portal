'use client'

import { EditorDashboardContent } from '@/components/EditorDashboard'

export { EditorDashboardContent }

export default function EditorDashboardPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Editor Dashboard</h1>
          <p style={{ fontSize: '13px', color: '#71717a', margin: '4px 0 0' }}>Palm Management</p>
        </div>
        <EditorDashboardContent />
      </div>
    </div>
  )
}
