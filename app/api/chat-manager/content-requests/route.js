export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { buildContentRequestOverview } from '@/lib/contentRequests'
import { resolveChatTeamScope, akaAllowed, getAkasForTeam } from '@/lib/chatTeamScope'

// Team-scoped mirror of the content-request oversight view. A chat manager sees
// ONLY her team's creators (A or B). An admin sees everyone by default and can
// filter to a team with ?team=A|B (a real chat manager stays locked to her own
// team regardless of the param). Same data + Dropbox links as the admin view.
export async function GET(request) {
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const url = new URL(request.url)
    const month = url.searchParams.get('month') || undefined
    const teamParam = (url.searchParams.get('team') || '').toUpperCase()
    const data = await buildContentRequestOverview({ month })
    if (scope.scoped) {
      // Real chat manager: locked to her own team's creators.
      data.creators = data.creators.filter((c) => akaAllowed(scope, c.creator))
    } else if (teamParam === 'A' || teamParam === 'B') {
      // Admin filtering by a chosen team.
      const akas = await getAkasForTeam(teamParam)
      data.creators = akas ? data.creators.filter((c) => akas.has(c.akaLower)) : data.creators
    }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[chat-manager/content-requests] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
