import { auth } from '@clerk/nextjs/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'

export const maxDuration = 30

// Dashboard Agency Revenue chart data — UTC-bucketed to match OnlyFans + our
// invoices. The heavy sheet read (~75k rows) 504s a live request, so a cron
// (/api/cron/cache-agency-revenue) precomputes it to Dropbox and we just read
// that small file here. Shape: { earningsData: { creator: { dailyData } } }.

const CACHE_PATH = '/Palm Ops/Cache/agency-revenue-utc.json'

// 5-min in-memory cache on top of the Dropbox file (warm requests skip Dropbox).
let mem = null

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (mem && Date.now() - mem.t < 5 * 60 * 1000) return Response.json(mem.data)

  try {
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const buf = await downloadFromDropbox(token, ns, CACHE_PATH)
    if (!buf) {
      // Cache not populated yet — return empty (the cron runs every 15 min).
      return Response.json({ earningsData: {}, note: 'cache warming up — refresh shortly' })
    }
    const data = JSON.parse(buf.toString('utf8'))
    mem = { t: Date.now(), data }
    return Response.json(data)
  } catch (err) {
    console.error('[agency-revenue]', err?.message || err)
    return Response.json({ earningsData: {}, error: String(err?.message || err) })
  }
}
