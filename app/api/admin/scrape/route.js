import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = 'apify/instagram-reel-scraper'
const COOLDOWN_HOURS = 48

export const maxDuration = 120

export async function POST(request) {
  try {
    await requireAdmin()

    let handles = null
    let bypassCooldown = false
    let deepRefetch = false
    try {
      const body = await request.json()
      handles = body.handles || null
      // `force` is the legacy flag — it meant "ignore cooldown AND use the
      // full lookback window (for limit changes)". Splitting it lets the
      // Rescrape button bypass cooldown without paying Apify to re-fetch
      // every reel we already have.
      if (body.force) { bypassCooldown = true; deepRefetch = true }
      if (body.bypassCooldown) bypassCooldown = true
      if (body.deepRefetch) deepRefetch = true
    } catch {
      // No body = scrape all enabled
    }

    if (!APIFY_TOKEN) {
      return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })
    }

    // Fetch enabled sources
    const sources = await fetchAirtableRecords('Inspo Sources', {
      fields: ['Handle', 'Platform', 'Enabled', 'Lookback Days', 'Apify Limit', 'Last Scraped At', 'Account Status'],
    })

    const enabled = sources.filter(r => {
      const f = r.fields || {}
      if (!f.Enabled) return false
      const status = f['Account Status']?.name || f['Account Status'] || 'Active'
      if (status !== 'Active') return false
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

      // Check cooldown — skipped when bypassCooldown is set (e.g. user
      // clicked Rescrape) so we don't pointlessly wait 48h.
      if (!bypassCooldown && f['Last Scraped At']) {
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

      // Determine lookback. Only deepRefetch (after a limit change) requests
      // the full `lookbackDays` window from Apify. Normal rescrapes use the
      // "days since latest reel" calculation so Apify only returns posts
      // newer than what we already have — saves money on every Rescrape click.
      let onlyPostsNewerThan = `${lookbackDays} days`
      if (!deepRefetch && f['Last Scraped At']) {
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
