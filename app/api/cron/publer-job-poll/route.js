export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextResponse } from 'next/server'
import {
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { getJobStatus, summarizeJob } from '@/lib/publer'

// Polls Publer for the result of every Submitted post.
//
// Scoping doc §4.2: status='complete' does NOT guarantee success — must
// inspect payload.failures[] even when complete. summarizeJob() returns
// 'ok' / 'partial' / 'failed' / 'pending' so this loop stays simple.
//
// Why a separate cron (vs. polling inside publer-queue): publer-queue submits
// new posts; this one watches in-flight jobs. Decoupling means a single slow
// job-status poll can't starve the submission worker (and vice versa). Each
// runs on its own Vercel function with its own budget.
//
// In Phase 2 (drafts), 'complete' with no failures means "the draft was
// successfully created in Publer" — we map that to Publer Status='Scheduled'
// for consistency with the field naming. Phase 3 will distinguish 'Scheduled'
// vs 'Published' based on the post state we requested.

const MAX_JOBS_PER_TICK = 25
// Hard cap: don't poll posts that have been Submitted for >24h — at that
// point the job is dead or Publer lost it. Mark them Failed and surface for
// admin attention.
const POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const actualAuth = request.headers.get('authorization')
  const isCronCall = expectedAuth && actualAuth === expectedAuth
  if (!isCronCall) {
    try { await requireAdmin() } catch (e) { return e }
  }

  // Pull every post that's still Submitted. Cap at MAX_JOBS_PER_TICK so we
  // don't blow the function budget on a queue spike.
  const submitted = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Publer Status}='Submitted', {Publer Job ID}!='')`,
    fields: ['Publer Job ID', 'Publer Sending Since', 'Publer Status'],
    sort: [{ field: 'Publer Sending Since', direction: 'asc' }],
    maxRecords: MAX_JOBS_PER_TICK,
  })

  if (!submitted.length) {
    return NextResponse.json({ ok: true, polled: 0, message: 'no submitted jobs' })
  }

  const results = []
  for (const post of submitted) {
    const f = post.fields || {}
    const jobId = f['Publer Job ID']
    const sentAt = f['Publer Sending Since'] ? new Date(f['Publer Sending Since']).getTime() : null

    // Timeout escape hatch.
    if (sentAt && (Date.now() - sentAt) > POLL_TIMEOUT_MS) {
      try {
        await patchAirtableRecord('Posts', post.id, {
          'Publer Status': 'Failed',
          'Publer Last Error': `[${new Date().toISOString()}] Polling timed out after 24h — job never reported complete`,
          'Status': 'Publer Send Failed',
        }, { typecast: true })
      } catch (e) {
        console.warn(`[publer-job-poll] failed to mark timeout for ${post.id}:`, e.message)
      }
      results.push({ postId: post.id, status: 'timeout' })
      continue
    }

    try {
      const jobRes = await getJobStatus(jobId)
      const summary = summarizeJob(jobRes)

      if (summary.kind === 'ok') {
        await patchAirtableRecord('Posts', post.id, {
          'Publer Status': 'Scheduled',
          'Publer Last Error': '',
          // Final post status — keep distinct from the cron-internal Publer
          // Status. 'Sent to Publer' is the human-visible equivalent of
          // 'Sent to Telegram'.
          'Status': 'Sent to Publer',
        }, { typecast: true })
        results.push({ postId: post.id, status: 'scheduled' })
      } else if (summary.kind === 'partial' || summary.kind === 'failed') {
        const detail = summary.failures.length
          ? summary.failures.map(x => `${x.account_name || x.account_id}: ${x.message || x.error || 'unknown'}`).join(' | ')
          : (summary.error || 'unknown failure')
        await patchAirtableRecord('Posts', post.id, {
          'Publer Status': 'Failed',
          'Publer Last Error': `[${new Date().toISOString()}] ${detail}`.slice(0, 1000),
          'Status': 'Publer Send Failed',
        }, { typecast: true })
        results.push({ postId: post.id, status: 'failed', failures: summary.failures.length })
      } else {
        // Still pending — leave alone, we'll poll again next tick.
        results.push({ postId: post.id, status: 'pending' })
      }
    } catch (err) {
      // 404 from Publer means the job ID is unknown — could be transient
      // Publer issue or a real "job lost." Don't immediately fail; log and
      // try again next tick. The 24h timeout will catch persistent 404s.
      results.push({ postId: post.id, status: 'poll-error', error: err.message })
      console.warn(`[publer-job-poll] poll error for ${post.id} (job ${jobId}):`, err.message)
    }
  }

  return NextResponse.json({ ok: true, polled: results.length, results })
}
