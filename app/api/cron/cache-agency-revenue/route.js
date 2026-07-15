import { NextResponse } from 'next/server'
import { computeAgencyRevenueUTC } from '@/lib/agencyRevenue'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const CACHE_PATH = '/Palm Ops/Cache/agency-revenue-utc.json'

// Every 15 min — recompute the dashboard's UTC-bucketed agency revenue (a heavy
// ~75k-row sheet read that 504s a live request) and cache the small result to
// Dropbox. The dashboard route just reads that file.
export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth && request.headers.get('authorization') !== expectedAuth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const earningsData = await computeAgencyRevenueUTC()
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const payload = { earningsData, cachedAt: new Date().toISOString() }
    await uploadToDropbox(token, ns, CACHE_PATH, Buffer.from(JSON.stringify(payload), 'utf8'), { overwrite: true })
    return NextResponse.json({ ok: true, creators: Object.keys(earningsData).length, cachedAt: payload.cachedAt })
  } catch (err) {
    console.error('[cache-agency-revenue]', err?.message || err)
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}
