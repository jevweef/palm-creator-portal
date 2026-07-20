export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { buildContentRequestOverview } from '@/lib/contentRequests'
import { resolveChatTeamScope, akaAllowed } from '@/lib/chatTeamScope'

// Team-scoped mirror of the content-request oversight view. A chat manager sees
// ONLY her team's creators (A or B); an admin impersonating via ?viewAsUserId
// sees that manager's team; a plain admin sees everyone. Same data + Dropbox
// links as the admin view — just filtered.
export async function GET(request) {
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const month = new URL(request.url).searchParams.get('month') || undefined
    const data = await buildContentRequestOverview({ month })
    if (scope.scoped) data.creators = data.creators.filter((c) => akaAllowed(scope, c.creator))
    return NextResponse.json(data)
  } catch (err) {
    console.error('[chat-manager/content-requests] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
