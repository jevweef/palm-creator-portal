'use client'

import { useState, useCallback } from 'react'
import { ForReview } from '@/app/admin/editor/page'
import CarouselSubmissionsReview from '@/app/admin/editor/CarouselSubmissionsReview'
import RealAiToggle from './RealAiToggle'
import CreatorPicker from './CreatorPicker'
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
  // Creator selection is lifted here so it sits up top-left with the toggles
  // and persists across the Real/AI + Reel/Carousel switches.
  const [creator, setCreator] = useState('all')
  const [creatorOptions, setCreatorOptions] = useState([])
  const handleCreatorOptions = useCallback((opts) => setCreatorOptions(opts || []), [])

  const modeLabel = mode === 'ai' ? 'AI' : 'Real'
  const mediumLabel = medium === 'carousel' ? 'Carousels' : 'Reels'
  const accent = mode === 'ai' ? '#a78bfa' : 'var(--palm-pink)'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        <RealAiToggle value={mode} onChange={(m) => { setMode(m); if (m === 'real') setMedium('reels') }} />
        {/* Reels/Carousels selector only for AI. Real carousels don't route
            through this review queue yet, so 'Real + Carousels' was a permanent
            dead-end — for Real, only Reels exists, so no selector is shown. */}
        {mode === 'ai' && (
          <Segmented
            value={medium}
            onChange={setMedium}
            ariaLabel="Reels or carousels"
            options={[{ value: 'reels', label: 'Reels' }, { value: 'carousel', label: 'Carousels' }]}
          />
        )}
        {/* Creator filter — left, next to the toggles. Reels only (carousel
            submissions aren't creator-filterable yet). */}
        {medium === 'reels' && (
          <CreatorPicker value={creator} onChange={setCreator} creators={creatorOptions} />
        )}
      </div>

      {/* Explicit, unmistakable state line — what you're looking at right now. */}
      <div style={{ fontSize: 13, color: 'var(--foreground-muted)', marginBottom: 20 }}>
        Reviewing <strong style={{ color: accent, fontWeight: 800 }}>{modeLabel} {mediumLabel}</strong>
      </div>

      {medium === 'reels'
        ? <ForReview showToast={showToast} sourceFilter={mode} creatorId={creator} onCreatorOptions={handleCreatorOptions} />
        : <CarouselSubmissionsReview showToast={showToast} sourceFilter={mode} embedded />}
    </div>
  )
}
