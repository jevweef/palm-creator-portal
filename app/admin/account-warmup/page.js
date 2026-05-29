'use client'

// Account Warm-Up — promoted out of AI Content into its own top-level
// sidebar item (owner directive 2026-05-27). The view itself is the same
// WarmupTab component, but now lives at /admin/account-warmup so the
// operator doesn't have to drill through AI Content to get to it.
//
// The WarmupTab + _warmup/* helpers stay under /admin/recreate-source/
// as a historical artifact — they're co-located with the AI Content page
// they were originally written for. The import path crosses directories
// but that's fine; the components are framework-agnostic.

import WarmupTab from '../recreate-source/WarmupTab'

export default function AccountWarmupPage() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 24px' }}>
      <WarmupTab />
    </div>
  )
}
