'use client'

import GridPlanner from '@/components/GridPlanner'

export default function SmGridPlannerPage() {
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Grid Planner</h1>
        <p style={{ color: 'var(--foreground-muted)', fontSize: '13px' }}>
          Tap any post to download the video, copy the caption, and mark it scheduled on IG.
        </p>
      </div>
      <GridPlanner smmMode />
    </div>
  )
}
