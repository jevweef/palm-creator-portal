import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox, listDropboxFolder } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET — the overnight whale-intel report (?date=YYYY-MM-DD, default: latest).
// Feeds the Palm Internal + Chat Team Report tabs.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
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
    return NextResponse.json({ report: JSON.parse(buf.toString('utf8')), available })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
