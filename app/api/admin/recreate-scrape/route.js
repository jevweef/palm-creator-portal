import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = 'apify/instagram-reel-scraper'

// Per-account reel cap. Each source can override via its "Max Reels"
// field; blank falls back to DEFAULT, and nothing may exceed HARD_CEIL
// even if mis-set (runaway Apify spend guard).
const DEFAULT_LIMIT = 50
const HARD_CEIL = 500

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

    // Concurrency guard: a handle already mid-scrape (this row OR any other
    // row with the same handle) must NOT get a second Apify run. Overlapping
    // chunked callbacks for the same handle can't see each other's in-flight
    // inserts → duplicate reels. This is the duplicate-reel root cause.
    const scrapingHandles = new Set(
      sources
        .filter(r => (r.fields?.Status?.name || r.fields?.Status) === 'Scraping')
        .map(r => (r.fields?.Handle || '').trim().toLowerCase())
        .filter(Boolean)
    )

    const skippedBusy = []
    const toScrape = sources.filter(r => {
      const f = r.fields || {}
      const handle = (f.Handle || '').trim()
      if (!handle) return false
      const selected = recordIds ? recordIds.includes(r.id) : (f.Status?.name || f.Status) === 'Queued'
      if (!selected) return false
      // Concurrency guard is ABSOLUTE — never bypassed. A handle already
      // 'Scraping' is never given a second run (that was the dup cause).
      if (scrapingHandles.has(handle.toLowerCase())) {
        skippedBusy.push({ handle, reason: 'already scraping' })
        return false
      }
      return true
    })

    if (toScrape.length === 0) {
      return NextResponse.json({ started: [], skipped: skippedBusy.length ? skippedBusy : [{ reason: 'no Queued sources' }] })
    }

    const callbackSecret = process.env.APIFY_CALLBACK_SECRET

    if (!callbackSecret) {

      throw new Error('APIFY_CALLBACK_SECRET is not configured')

    }
    // Derive the callback base from THIS request's origin, not a hardcoded
    // env. A scrape triggered on the dev preview must call back to that
    // same preview deployment — otherwise the Apify webhook fires to
    // production (which doesn't have this code) and silently 404s.
    const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const fwdProto = request.headers.get('x-forwarded-proto') || 'https'
    const baseUrl = fwdHost
      ? `${fwdProto}://${fwdHost}`
      : (process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com')

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
