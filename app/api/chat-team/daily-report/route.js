import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox, listDropboxFolder } from '@/lib/dropbox'
import { resolveChatTeamScope, getAkasForTeam } from '@/lib/chatTeamScope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET — the chat-manager view of the overnight whale-intel report
// (?date=YYYY-MM-DD, default: latest). Same file the admin Chat Team Report
// tab reads, but per-creator entries are filtered to the caller's team so a
// manager only sees coaching material for their own creators.
export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    let date = new URL(request.url).searchParams.get('date') || ''
    let available = []
    try {
      const entries = await listDropboxFolder(token, ns, '/Palm Ops/Whale Intel/daily')
      available = (entries || []).map((e) => e.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).map((n) => n.slice(0, 10)).sort().reverse()
    } catch { /* none yet */ }
    if (!date) date = available[0] || ''
    if (!date) return NextResponse.json({ report: null, available: [] })
    const buf = await downloadFromDropbox(token, ns, `/Palm Ops/Whale Intel/daily/${date}.json`)
    if (!buf) return NextResponse.json({ report: null, available })

    const report = JSON.parse(buf.toString('utf8'))
    if (report && Array.isArray(report.perCreator)) {
      if (scope.scoped) {
        // Real chat manager — keep only their own team's creators.
        report.perCreator = report.perCreator.filter((c) => scope.allowedAkas.has(String(c.aka || '').toLowerCase()))
      } else {
        // Admin — optional explicit Team A / Team B filter (All = no filter).
        const teamParam = (new URL(request.url).searchParams.get('team') || '').toUpperCase()
        if (teamParam === 'A' || teamParam === 'B') {
          const akas = await getAkasForTeam(teamParam)
          if (akas) report.perCreator = report.perCreator.filter((c) => akas.has(String(c.aka || '').toLowerCase()))
        }
      }
    }
    // scoped:false → the caller is an admin, so the page shows the A/B toggle.
    return NextResponse.json({ report, available, scoped: scope.scoped })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
