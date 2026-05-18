import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = 'apify/instagram-reel-scraper'

// Per-account reel cap. Each source can override via its "Max Reels"
// field; blank falls back to DEFAULT, and nothing may exceed HARD_CEIL
// even if mis-set (runaway Apify spend guard).
const DEFAULT_LIMIT = 50
const HARD_CEIL = 100

export const maxDuration = 60

export async function POST(request) {
  try {
    await requireAdmin()

    if (!APIFY_TOKEN) {
      return NextResponse.json({ error: 'APIFY_TOKEN not configured' }, { status: 500 })
    }

    let recordIds = null
    try {
      const body = await request.json()
      recordIds = Array.isArray(body.recordIds) ? body.recordIds : null
    } catch {
      // No body = scrape all Queued sources
    }

    const sources = await fetchAirtableRecords('Recreate Sources', {
      fields: ['Handle', 'Status', 'Max Reels'],
    })

    const toScrape = sources.filter(r => {
      const f = r.fields || {}
      if (!f.Handle?.trim()) return false
      if (recordIds) return recordIds.includes(r.id)
      const status = f.Status?.name || f.Status || ''
      return status === 'Queued'
    })

    if (toScrape.length === 0) {
      return NextResponse.json({ started: [], skipped: [{ reason: 'no Queued sources' }] })
    }

    const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'

    const started = []
    const skipped = []

    for (const source of toScrape) {
      const handle = source.fields.Handle.trim()
      try {
        const rawMax = Number(source.fields['Max Reels']) || DEFAULT_LIMIT
        const limit = Math.min(Math.max(1, rawMax), HARD_CEIL)
        // No `onlyPostsNewerThan` → Apify returns the account's recent reel
        // history capped by resultsLimit. Deliberate difference from the
        // inspo Sources scraper (which uses a lookback window).
        const payload = {
          username: [handle],
          resultsLimit: limit,
          skipPinnedPosts: false,
          includeTranscript: false,
          includeSharesCount: false,
        }

        const callbackUrl = `${baseUrl}/api/admin/recreate-callback?secret=${callbackSecret}&sourceId=${source.id}&handle=${encodeURIComponent(handle)}`
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

        await patchAirtableRecord('Recreate Sources', source.id, {
          Status: 'Scraping',
          'Apify Run ID': runId || '',
          Error: '',
        }, { typecast: true })

        started.push({ handle, runId })
      } catch (err) {
        console.error(`[Recreate Scrape] error for @${handle}:`, err)
        try {
          await patchAirtableRecord('Recreate Sources', source.id, {
            Status: 'Error',
            Error: String(err.message || err).slice(0, 1000),
          }, { typecast: true })
        } catch {}
        skipped.push({ handle, reason: err.message })
      }
    }

    return NextResponse.json({ started, skipped })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[Recreate Scrape] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
