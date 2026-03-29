import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = 'apify/instagram-reel-scraper'
const COOLDOWN_HOURS = 48

export async function POST(request) {
  try {
    await requireAdmin()

    let handles = null
    try {
      const body = await request.json()
      handles = body.handles || null
    } catch {
      // No body = scrape all enabled
    }

    if (!APIFY_TOKEN) {
      return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })
    }

    // Fetch enabled sources
    const sources = await fetchAirtableRecords('Inspo Sources', {
      fields: ['Handle', 'Platform', 'Enabled', 'Lookback Days', 'Apify Limit', 'Last Scraped At'],
    })

    const enabled = sources.filter(r => {
      const f = r.fields || {}
      if (!f.Enabled) return false
      if ((f.Platform || '').toLowerCase() !== 'instagram') return false
      if (!f.Handle?.trim()) return false
      if (handles && !handles.includes(f.Handle.trim().toLowerCase())) return false
      return true
    })

    const started = []
    const skipped = []
    const now = new Date()

    // Determine the callback URL
    const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'

    for (const source of enabled) {
      const f = source.fields
      const handle = f.Handle.trim()

      // Check cooldown
      if (f['Last Scraped At']) {
        try {
          const lastScrape = new Date(f['Last Scraped At'])
          const hoursSince = (now - lastScrape) / 3600000
          if (hoursSince < COOLDOWN_HOURS) {
            skipped.push({ handle, reason: `cooldown (${Math.round(hoursSince)}h ago)` })
            continue
          }
        } catch {}
      }

      const lookbackDays = f['Lookback Days'] || 180
      const apifyLimit = f['Apify Limit'] || null

      // Determine lookback
      let onlyPostsNewerThan = `${lookbackDays} days`
      if (f['Last Scraped At']) {
        try {
          const lastScrape = new Date(f['Last Scraped At'])
          const daysSince = Math.ceil((now - lastScrape) / 86400000) + 1
          onlyPostsNewerThan = `${daysSince} days`
        } catch {}
      }

      const payload = {
        username: [handle],
        onlyPostsNewerThan,
        skipPinnedPosts: false,
        includeTranscript: false,
        includeSharesCount: true,
        includeDownloadedVideo: false,
      }
      if (apifyLimit) payload.resultsLimit = apifyLimit

      try {
        // Start Apify run with webhook
        const callbackUrl = `${baseUrl}/api/admin/apify-callback?secret=${callbackSecret}&sourceId=${source.id}&handle=${encodeURIComponent(handle)}`

        // Webhooks must be a base64-encoded query param, NOT in the input body
        const webhooksPayload = JSON.stringify([{
          eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
          requestUrl: callbackUrl,
        }])
        const webhooksParam = Buffer.from(webhooksPayload).toString('base64')

        const runRes = await fetch(
          `https://api.apify.com/v2/acts/${ACTOR_ID.replace('/', '~')}/runs?token=${APIFY_TOKEN}&webhooks=${webhooksParam}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        )

        if (!runRes.ok) {
          const errText = await runRes.text()
          throw new Error(`Apify ${runRes.status}: ${errText}`)
        }

        const runData = await runRes.json()
        const runId = runData.data?.id

        // Mark source as processing
        await patchAirtableRecord('Inspo Sources', source.id, {
          'Pipeline Status': 'Processing',
        })

        started.push({ handle, runId })
      } catch (err) {
        console.error(`Scrape error for @${handle}:`, err)
        skipped.push({ handle, reason: err.message })
      }
    }

    return NextResponse.json({ started, skipped })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Scrape error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
