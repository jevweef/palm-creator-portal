'use client'

import { useEffect } from 'react'

// Merged into the chat-manager view — this route survives only so older
// Telegram alert links keep working.
export default function ChatTeamRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('tab', 'analyses')
    window.location.replace(`/photo-library?${params}`)
  }, [])
  return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Opening the chat team view…</div>
}
