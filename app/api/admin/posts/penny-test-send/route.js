export const dynamic = 'force-dynamic'
// Generous budget: caption ~20s + thumbnail ~15s + frame grab ~10s + the
// Telegram send (download + maybe ffmpeg compress + upload) up to a few minutes.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { processOnePostPrep, strOf, linkedIds } from '@/lib/penny'

// IMMEDIATE single-reel test — run the FULL Penny pipeline on ONE post right now
// and (optionally) deliver it to Telegram, without waiting for the 30-min Penny
// cron or the daily push. Returns a detailed step-by-step log so any failure is
// visible at exactly the step it happened.
//
//   GET /api/admin/posts/penny-test-send?postId=rec...        → process only
//   GET /api/admin/posts/penny-test-send?postId=rec...&send=1 → process + send
//
// Admin/social-media only. The internal Telegram send call forwards your session
// cookie so it runs under your auth — works on localhost and production alike.
export async function GET(request) {
  // Admin/social-media session (Evan in the browser) OR cron-bearer (so it can
  // be triggered/validated headlessly). When called with the bearer, the
  // internal Telegram send falls back to x-cron-secret instead of cookies.
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const steps = []
  const t0 = Date.now()
  // Each step is logged to BOTH the response and the server console, so a failure
  // is debuggable from the browser response or the Vercel/terminal logs.
  const step = (name, ok, detail) => {
    const entry = { step: name, ok, detail, atMs: Date.now() - t0 }
    steps.push(entry)
    const line = `[penny-test] ${ok ? 'OK ' : 'ERR'} ${name}${detail ? ` — ${detail}` : ''}`
    if (ok) console.log(line); else console.error(line)
  }

  try {
    const { searchParams } = new URL(request.url)
    const postId = searchParams.get('postId')
    const doSend = searchParams.get('send') === '1'
    const force = searchParams.get('force') === '1'
    if (!postId) return NextResponse.json({ error: 'postId required (?postId=rec...)' }, { status: 400 })

    // ── Fetch + validate the post ────────────────────────────────────────────
    const postList = await fetchAirtableRecords('Posts', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(postId)}`,
      fields: ['Post Name', 'Status', 'Type', 'Creator', 'Asset', 'Caption', 'Channel', 'Pipeline Target'],
    })
    const post = postList[0]
    if (!post) { step('fetch post', false, 'post not found'); return done(steps, 404) }
    const f = post.fields || {}
    step('fetch post', true, `${f['Post Name'] || postId} (Status=${strOf(f.Status)})`)

    if (strOf(f.Type) !== 'Reel') { step('validate', false, `Type=${strOf(f.Type)} (only Reel supported)`); return done(steps, 400) }
    if (strOf(f['Pipeline Target']) === 'Publer') { step('validate', false, 'Pipeline Target=Publer (AI → Publer, not Telegram)'); return done(steps, 400) }
    const creatorId = linkedIds(f.Creator)[0]
    if (!creatorId || !linkedIds(f.Asset)[0]) { step('validate', false, 'missing Creator or Asset link'); return done(steps, 400) }
    step('validate', true, 'real-content reel, ok to process')

    // Idempotency guard: refuse to re-send a reel that's already on its way out,
    // so a re-run (or a double-click) can't duplicate it in Telegram. Override
    // with &force=1 if you really mean to re-process + re-send.
    if (doSend && !force && ['Queued for Telegram', 'Sending', 'Sent to Telegram'].includes(strOf(f.Status))) {
      step('guard', false, `already ${strOf(f.Status)} — refusing to re-send (add &force=1 to override and risk a duplicate)`)
      return done(steps, 409)
    }

    // ── 1. Penny processing: caption + thumbnail decision + stage ─────────────
    const proc = await processOnePostPrep(post, { dryRun: false, log: (m) => step('process', true, m) })
    if (proc.error) { step('process', false, proc.error); return done(steps, 500) }
    step('process done', true, `caption="${proc.caption}" | thumbnail=${proc.thumbnail}`)

    // ── 2. Assign a single Telegram channel (IG preferred, else FB) ───────────
    const cRec = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'AKA', 'Telegram Thread ID', 'Telegram IG Topic ID', 'Telegram FB Topic ID'],
    })
    const creator = cRec[0]?.fields || {}
    const channel = creator['Telegram IG Topic ID'] ? 'IG' : (creator['Telegram FB Topic ID'] ? 'FB' : null)
    if (!channel) { step('assign channel', false, 'creator has no Telegram IG/FB Topic ID set'); return done(steps, 400) }
    await patchAirtableRecord('Posts', postId, {
      'Channel': channel,
      'Scheduled Date': new Date().toISOString(),
    }, { typecast: true })
    const smmTopicId = channel === 'IG' ? creator['Telegram IG Topic ID'] : creator['Telegram FB Topic ID']
    step('assign channel', true, `${channel} (topic ${smmTopicId})`)

    if (!doSend) {
      step('send', true, 'skipped (add &send=1 to deliver to Telegram)')
      return done(steps, 200)
    }

    // ── 3. Re-read the freshly-staged post + asset, build the send body ───────
    const fresh = (await fetchAirtableRecords('Posts', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(postId)}`,
      fields: ['Caption', 'Hashtags', 'Platform', 'Thumbnail', 'Thumbnail Asset', 'Scheduled Date', 'Asset'],
    }))[0]?.fields || {}
    const assetId = linkedIds(fresh.Asset)[0] || linkedIds(f.Asset)[0]
    const asset = (await fetchAirtableRecords('Assets', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(assetId)}`,
      fields: ['Compressed File Link', 'Edited File Link', 'Dropbox Shared Link'],
    }))[0]?.fields || {}
    const editedFileLink = asset['Compressed File Link'] || asset['Edited File Link'] || asset['Dropbox Shared Link']
    if (!editedFileLink) { step('build send', false, 'asset has no file link'); return done(steps, 500) }
    const thumbnailUrl = (fresh.Thumbnail || [])[0]?.url || ''
    step('build send', true, `file=${editedFileLink.slice(0, 60)}… | thumb=${thumbnailUrl ? 'yes' : 'none (Telegram auto-poster)'}`)

    // ── 4. Flip to Queued, then call the proven send route on THIS origin ─────
    await patchAirtableRecord('Posts', postId, { 'Status': 'Queued for Telegram' }, { typecast: true })
    step('queue', true, 'Status → Queued for Telegram')

    const origin = new URL(request.url).origin
    const sendUrl = `${origin}/api/telegram/send`
    step('send', true, `calling ${sendUrl} (wait=true)…`)
    let sendData = {}
    try {
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward the caller's session so the send route's admin auth passes
          // (same origin → same cookies). Also pass the cron secret if present.
          cookie: request.headers.get('cookie') || '',
          ...(process.env.CRON_SECRET ? { 'x-cron-secret': process.env.CRON_SECRET } : {}),
        },
        body: JSON.stringify({
          postId,
          type: 'Reel',
          assetId,
          editedFileLink,
          thumbnailUrl,
          thumbnailAssetId: fresh['Thumbnail Asset'] || null,
          caption: fresh.Caption || '',
          hashtags: fresh.Hashtags || '',
          platform: fresh.Platform || ['Instagram Reel'],
          scheduledDate: fresh['Scheduled Date'] || null,
          creatorId,
          threadId: creator['Telegram Thread ID'] || null,
          smmTopicId,
          wait: true,
        }),
      })
      const text = await res.text()
      try { sendData = JSON.parse(text) } catch { sendData = { raw: text.slice(0, 400) } }
      if (!res.ok) {
        step('send', false, `HTTP ${res.status}: ${sendData.error || sendData.raw || 'send failed'}`)
        return done(steps, 502, { sendData })
      }
      step('send', true, `delivered to Telegram (${channel})`)
    } catch (e) {
      step('send', false, `send call threw: ${e.message}`)
      return done(steps, 502)
    }

    return done(steps, 200, { sendData, delivered: true })
  } catch (err) {
    step('fatal', false, err.message)
    return done(steps, 500)
  }
}

function done(steps, status, extra = {}) {
  const failed = steps.find((s) => !s.ok)
  return NextResponse.json({ ok: status === 200 && !failed, status, steps, ...extra }, { status })
}
