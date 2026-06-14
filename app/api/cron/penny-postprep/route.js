export const dynamic = 'force-dynamic'
// Each reel costs ~45s (caption ~20s + thumbnail read ~15s + frame grab/upload
// ~10s). Cap the batch so we stay well under the function budget; the cron runs
// every 30 min so a backlog drains over a few ticks.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord, requireAdminOrSocialMedia } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { generateCaptions, suggestThumbnail } from '@/lib/captionEngine'
import { extractFrameJpeg, uploadThumbnailToDropbox, rawDropboxUrl } from '@/lib/pennyThumbnail'

// How many naked reels to process per tick. Keeps a single run under maxDuration.
const POSTS_PER_RUN = 5

const strOf = (v) => (typeof v === 'string' ? v : (v?.name || ''))
const linkedIds = (val) => (val || []).map((c) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)

// ── channel assignment (mirror of grid-planner distributeQueue) ──────────────
// Round-robin every unchanneled, unsent post for this creator to IG / FB. One
// Post per source clip (no fan-out). Requires both Telegram topic IDs so the
// daily Telegram send can resolve a topic. Returns {assigned, skipped?}.
async function assignChannels(creatorId, creatorFields) {
  if (!creatorFields['Telegram IG Topic ID'] || !creatorFields['Telegram FB Topic ID']) {
    return { assigned: 0, skipped: 'missing Telegram IG/FB Topic ID' }
  }
  const allRecent = await fetchAirtableRecords('Posts', {
    filterByFormula: `OR(IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days')), {Scheduled Date}=BLANK())`,
    fields: ['Creator', 'Channel', 'Telegram Sent At', 'Posted At'],
  })
  const creatorPosts = allRecent.filter((p) =>
    linkedIds(p.fields?.Creator).includes(creatorId) &&
    !p.fields?.['Telegram Sent At'] && !p.fields?.['Posted At']
  )
  const queue = creatorPosts.filter((p) => !strOf(p.fields?.Channel))
  if (!queue.length) return { assigned: 0 }

  const count = { IG: 0, FB: 0 }
  for (const p of creatorPosts) {
    const ch = strOf(p.fields?.Channel)
    if (ch === 'IG' || ch === 'FB') count[ch]++
  }
  let next = count.IG <= count.FB ? 'IG' : 'FB'
  const baseTs = Date.now()
  let assigned = 0
  for (let i = 0; i < queue.length; i++) {
    await patchAirtableRecord('Posts', queue[i].id, {
      'Channel': next,
      'Scheduled Date': new Date(baseTs + i * 1000).toISOString(),
    }, { typecast: true })
    next = next === 'IG' ? 'FB' : 'IG'
    assigned++
  }
  return { assigned }
}

// ── thumbnail-queue fill for the BLANK ones (the risqué reels Penny skipped) ──
// Only touches channeled, unsent posts that have NO thumbnail at all — never
// reshuffles a thumbnail Penny or a human already set. Pulls from the creator's
// Approved Thumbnail pool (Assets). No pool → leave blank (Telegram makes its
// own poster).
async function fillBlankThumbnails(creatorId) {
  const poolAssets = await fetchAirtableRecords('Assets', {
    filterByFormula: `{Approved Thumbnail}=1`,
    fields: ['Palm Creators', 'Dropbox Shared Link'],
  })
  const pool = poolAssets
    .filter((a) => linkedIds(a.fields?.['Palm Creators']).includes(creatorId))
    .map((a) => ({ id: a.id, link: a.fields?.['Dropbox Shared Link'] || '' }))
    .filter((p) => p.link)
  if (!pool.length) return { filled: 0, poolEmpty: true }

  const posts = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Channel}!='', {Telegram Sent At}='', {Posted At}='')`,
    fields: ['Creator', 'Thumbnail'],
  })
  const blanks = posts.filter((p) =>
    linkedIds(p.fields?.Creator).includes(creatorId) && !(p.fields?.Thumbnail || []).length
  )
  if (!blanks.length) return { filled: 0 }

  // Shuffle pool once, assign without replacement where possible.
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  let filled = 0
  for (let i = 0; i < blanks.length; i++) {
    const tile = shuffled[i % shuffled.length]
    try {
      await patchAirtableRecord('Posts', blanks[i].id, {
        'Thumbnail': [{ url: rawDropboxUrl(tile.link) }],
        'Thumbnail Source': 'pool',
        'Thumbnail Asset': tile.id,
      }, { typecast: true })
      filled++
    } catch { /* skip individual failures */ }
  }
  return { filled }
}

// Process ONE naked reel: caption + thumbnail decision + stage. Returns a
// per-post result object. Never throws — caller collects results.
async function processPost(post, { dryRun }) {
  const f = post.fields || {}
  const postId = post.id
  const creatorId = linkedIds(f.Creator)[0]
  const assetId = linkedIds(f.Asset)[0]
  const result = { postId, name: f['Post Name'] || '', creatorId }
  if (!creatorId || !assetId) return { ...result, error: 'missing Creator or Asset link' }

  // Resolve the asset's edited (caption: reads on-screen text) and original
  // (thumbnail: no burned-in text) video links + the creator name.
  const [assetList, creatorList] = await Promise.all([
    fetchAirtableRecords('Assets', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(assetId)}`,
      fields: ['Edited File Link', 'Dropbox Shared Link'],
    }),
    fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'AKA'],
    }),
  ])
  const af = assetList[0]?.fields || {}
  // Convert Dropbox share links (?dl=0) to direct-download (?raw=1) — the caption
  // engine + suggestThumbnail fetch the URL as-is and would otherwise pull
  // Dropbox's HTML preview page (→ Gemini "invalid argument"). extractFrameJpeg
  // also converts internally, so double-applying here is harmless.
  const editedLink = rawDropboxUrl(af['Edited File Link'] || af['Dropbox Shared Link'] || '')
  const originalLink = rawDropboxUrl(af['Dropbox Shared Link'] || af['Edited File Link'] || '')
  if (!editedLink) return { ...result, error: 'asset has no file link' }
  const creatorName = creatorList[0]?.fields?.Creator || creatorList[0]?.fields?.AKA || ''

  // 1. Caption — auto-pick the model's self-ranked best.
  let caption = ''
  try {
    const caps = await generateCaptions({
      videoUrl: editedLink,
      creatorNotes: creatorName ? `Creator: ${creatorName}` : '',
    })
    caption = caps.best?.text || caps.captions?.[0]?.text || ''
    result.caption = caption
    result.captionCost = caps.usage?.estCost || 0
  } catch (e) {
    return { ...result, error: `caption: ${e.message}` }
  }

  // 2. Thumbnail — grab the best safe frame, or leave BLANK if too risqué so
  // the grid thumbnail-pool fills it instead (Evan's exact manual rule).
  const patch = {}
  if (caption) patch['Caption'] = caption
  let thumbNote = ''
  try {
    const th = await suggestThumbnail({ videoUrl: originalLink })
    if (th.tooRisque || th.best == null) {
      thumbNote = `left blank (too risqué${th.reason ? `: ${th.reason}` : ''})`
      // No thumbnail / no source → fillBlankThumbnails picks it up.
    } else if (!dryRun) {
      const jpeg = await extractFrameJpeg({ videoUrl: originalLink, timestamp: th.best })
      const url = await uploadThumbnailToDropbox({ buffer: jpeg, postId })
      patch['Thumbnail'] = [{ url }]
      patch['Thumbnail Source'] = 'post-prep'   // protect from pool reshuffle
      thumbNote = `frame @ ${th.best}s`
    } else {
      thumbNote = `would grab frame @ ${th.best}s`
    }
  } catch (e) {
    // Thumbnail failure must NOT block the caption/stage — leave blank, pool fills.
    thumbNote = `thumbnail error (left blank): ${e.message}`
  }
  result.thumbnail = thumbNote

  // 3. Stage it (leaves Post-Prep, enters the grid).
  patch['Status'] = 'Staged'
  if (dryRun) return { ...result, dryRun: true, wouldPatch: Object.keys(patch) }
  await patchAirtableRecord('Posts', postId, patch, { typecast: true })
  result.staged = true
  return result
}

export async function GET(request) {
  // Vercel cron bearer OR admin/social-media (manual drain on preview).
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  const isCronCall = expectedAuth && request.headers.get('authorization') === expectedAuth
  if (!isCronCall) {
    try { await requireAdminOrSocialMedia() } catch (e) { return e }
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1'
  const limit = Math.max(1, Math.min(Number(searchParams.get('limit')) || POSTS_PER_RUN, 10))

  // Naked real-content reels sitting in Post-Prep: approved (Ready to Go), no
  // caption yet, not yet channeled. Exclude AI (Pipeline Target='Publer') — that
  // routes to Publer, never Telegram. Oldest first.
  const naked = await fetchAirtableRecords('Posts', {
    filterByFormula: `AND({Type}='Reel', {Status}='Ready to Go', {Caption}='', {Channel}='', {Pipeline Target}!='Publer')`,
    fields: ['Post Name', 'Creator', 'Asset', 'Caption', 'Channel'],
    sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    maxRecords: limit,
  })

  if (!naked.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'no naked reels in post-prep' })
  }

  // Process each reel (sequential — keeps Gemini + ffmpeg load sane).
  const results = []
  const affectedCreators = new Set()
  for (const post of naked) {
    const r = await processPost(post, { dryRun })
    results.push(r)
    if (r.staged && r.creatorId) affectedCreators.add(r.creatorId)
  }

  // Per affected creator: assign channels (IG/FB) then fill blank thumbnails
  // from the pool. Skipped entirely on a dry run.
  const creatorOps = []
  if (!dryRun) {
    for (const creatorId of affectedCreators) {
      const cRec = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
        fields: ['Creator', 'Telegram IG Topic ID', 'Telegram FB Topic ID'],
      })
      const cf = cRec[0]?.fields || {}
      const channels = await assignChannels(creatorId, cf)
      const thumbs = await fillBlankThumbnails(creatorId)
      creatorOps.push({ creatorId, name: cf.Creator || '', ...channels, ...thumbs })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    processed: results.filter((r) => r.staged || r.dryRun).length,
    errors: results.filter((r) => r.error).length,
    results,
    creatorOps,
  })
}
