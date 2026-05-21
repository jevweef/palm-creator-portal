'use client'

// Legacy URL — Create Scene is now a tab on /ai-editor itself, not a
// separate page. This component just redirects, preserving any
// query params (creator / reel / project) so old links keep working.

import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

export default function AiEditorRecreateRedirect() {
  const sp = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(sp.toString())
    params.delete('tab') // strip any legacy ?tab=stageb / ?tab=outfit
    params.set('tab', 'create')
    router.replace(`/ai-editor?${params.toString()}`)
  }, [sp, router])

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>Redirecting to AI Recreate…</div>
    </div>
  )
}
