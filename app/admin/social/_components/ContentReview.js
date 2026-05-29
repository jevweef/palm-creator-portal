'use client'

import { useState } from 'react'
import { ForReview } from '@/app/admin/editor/page'
import CarouselSubmissionsReview from '@/app/admin/editor/CarouselSubmissionsReview'
import RealAiToggle from './RealAiToggle'
import { Segmented } from './FilterBar'

// ContentReview — the Real/AI × Reel/Carousel review surface. Two orthogonal
// segmented controls (Real/AI toggle + Reel/Carousel selector) render exactly
// ONE quadrant at a time, so real and AI never appear together and there are
// no messy nested stacked tabs.
//
//   Real Reels    → ForReview (sourceFilter='real')
//   AI Reels      → ForReview (sourceFilter='ai')
//   Real Carousel → CarouselSubmissionsReview (source='real')
//   AI Carousel   → CarouselSubmissionsReview (source='ai')
export default function ContentReview({ showToast }) {
  const [mode, setMode] = useState('real')      // 'real' | 'ai'
  const [medium, setMedium] = useState('reels') // 'reels' | 'carousel'

  const modeLabel = mode === 'ai' ? 'AI' : 'Real'
  const mediumLabel = medium === 'carousel' ? 'Carousels' : 'Reels'
  const accent = mode === 'ai' ? '#a78bfa' : 'var(--palm-pink)'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        <RealAiToggle value={mode} onChange={setMode} />
        <Segmented
          value={medium}
          onChange={setMedium}
          ariaLabel="Reels or carousels"
          options={[{ value: 'reels', label: 'Reels' }, { value: 'carousel', label: 'Carousels' }]}
        />
      </div>

      {/* Explicit, unmistakable state line — what you're looking at right now. */}
      <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginBottom: 20 }}>
        Reviewing <strong style={{ color: accent, fontWeight: 800 }}>{modeLabel} {mediumLabel}</strong>
      </div>

      {medium === 'reels'
        ? <ForReview showToast={showToast} sourceFilter={mode} />
        : <CarouselSubmissionsReview showToast={showToast} sourceFilter={mode} embedded />}
    </div>
  )
}
