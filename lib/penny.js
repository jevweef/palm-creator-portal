// lib/penny.js — shared core for the Penny post-prep automation.
//
// Used by:
//   - /api/cron/penny-postprep        (every 30m batch)
//   - /api/admin/posts/penny-test-send (immediate single-reel test)
// so the cron and the manual test exercise IDENTICAL processing logic.

import { fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { generateCaptions, suggestThumbnail } from '@/lib/captionEngine'
import { extractFrameJpeg, uploadThumbnailToDropbox, rawDropboxUrl } from '@/lib/pennyThumbnail'

export const strOf = (v) => (typeof v === 'string' ? v : (v?.name || ''))
export const linkedIds = (val) => (val || []).map((c) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)

// "check my bio" / "tap my bio" / "link in bio" all contain the word "bio".
const mentionsBio = (t) => /\bbios?\b/i.test(t || '')
// Deterministic 0..1 from a string — same post always decides the same way.
function seedFraction(s) {
  let h = 0
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}
// Pick the caption Penny auto-posts. The model's best_index over-favors the
// "check my bio" CTA, so cap bio-mentioning captions at ~1 in 10 (deterministic
// by postId) — otherwise the feed becomes a wall of "check my bio". When a bio
// caption is suppressed, fall back to the best non-bio option the model returned.
export function pickAutoCaption(caps, seed) {
  const list = caps?.captions || []
  const best = caps?.best || list[caps?.bestIndex] || list[0]
  if (!best) return ''
  if (!mentionsBio(best.text)) return best.text
  if (seedFraction(seed) < 0.1) return best.text   // allow ~10% of the time
  const nonBio = list.find((c) => !mentionsBio(c.text))
  return (nonBio || best).text
}

// Process ONE naked reel: caption (auto-pick best) + thumbnail decision + stage.
// Never throws — returns a per-post result object (with .error on failure).
// `log` is an optional (msg) => void for step-by-step tracing (the test route
// passes one; the cron leaves it as a no-op).
export async function processOnePostPrep(post, { dryRun = false, log = () => {} } = {}) {
  const f = post.fields || {}
  const postId = post.id
  const creatorId = linkedIds(f.Creator)[0]
  const assetId = linkedIds(f.Asset)[0]
  const result = { postId, name: f['Post Name'] || '', creatorId }
  if (!creatorId || !assetId) return { ...result, error: 'missing Creator or Asset link' }

  // Resolve the asset's edited (caption: reads on-screen text) + original
  // (thumbnail: no burned-in text) video links + the creator name.
  const [assetList, creatorList] = await Promise.all([
    fetchAirtableRecords('Assets', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(assetId)}`,
      fields: ['Edited File Link', 'Dropbox Shared Link', 'Source Type'],
    }),
    fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'AKA'],
    }),
  ])
  const af = assetList[0]?.fields || {}
  // Belt-and-suspenders: AI content runs on its OWN parallel track — Penny (real
  // content) must NEVER caption/stage it, even if a Post slipped through unstamped.
  // AI-ness lives on the linked Asset's Source Type.
  if (strOf(af['Source Type']) === 'AI Generated') return { ...result, skippedAi: true }
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
    log('caption: calling Gemini…')
    const caps = await generateCaptions({
      videoUrl: editedLink,
      creatorNotes: creatorName ? `Creator: ${creatorName}` : '',
    })
    caption = pickAutoCaption(caps, postId)
    result.caption = caption
    result.captionCost = caps.usage?.estCost || 0
    log(`caption: "${caption}"`)
  } catch (e) {
    log(`caption FAILED: ${e.message}`)
    return { ...result, error: `caption: ${e.message}` }
  }

  // 2. Thumbnail — 60/40 mix: ~60% of posts get a safe video frame (screenshot),
  // ~40% are left BLANK on purpose so the grid pool fills them with a PICKED
  // PHOTO — variety, so not every thumbnail is a screenshot. Risqué reels are
  // always left blank (can't screenshot them safely) regardless of the roll.
  const patch = {}
  if (caption) patch['Caption'] = caption
  let thumbNote = ''
  const usePickedPhoto = Math.random() < 0.40 // 40% → picked photo from the pool
  try {
    if (usePickedPhoto) {
      thumbNote = 'left blank (photo pick — 40% mix) → grid fills from pool'
      log(`thumbnail: ${thumbNote}`)
    } else {
      log('thumbnail: asking Gemini for a safe frame…')
      const th = await suggestThumbnail({ videoUrl: originalLink })
      if (th.tooRisque || th.best == null) {
        thumbNote = `left blank (too risqué${th.reason ? `: ${th.reason}` : ''})`
        log(`thumbnail: ${thumbNote} → grid will fill from queue`)
      } else if (!dryRun) {
        log(`thumbnail: grabbing frame @ ${th.best}s`)
        const jpeg = await extractFrameJpeg({ videoUrl: originalLink, timestamp: th.best })
        const url = await uploadThumbnailToDropbox({ buffer: jpeg, postId })
        patch['Thumbnail'] = [{ url }]
        patch['Thumbnail Source'] = 'post-prep'   // protect from pool reshuffle
        thumbNote = `frame @ ${th.best}s`
        log(`thumbnail: uploaded ${url}`)
      } else {
        thumbNote = `would grab frame @ ${th.best}s`
      }
    }
  } catch (e) {
    // Thumbnail failure must NOT block the caption/stage — leave blank, pool fills.
    thumbNote = `thumbnail error (left blank): ${e.message}`
    log(`thumbnail FAILED (left blank): ${e.message}`)
  }
  result.thumbnail = thumbNote

  // 3. Stage it (leaves Post-Prep, enters the grid).
  patch['Status'] = 'Staged'
  if (dryRun) return { ...result, dryRun: true, wouldPatch: Object.keys(patch) }
  await patchAirtableRecord('Posts', postId, patch, { typecast: true })
  result.staged = true
  log('staged')
  return result
}

// Round-robin every unchanneled, unsent post for this creator to IG / FB.
// Requires both Telegram topic IDs. Returns {assigned, skipped?}.
export async function assignChannels(creatorId, creatorFields) {
  if (!creatorFields['Telegram IG Topic ID'] || !creatorFields['Telegram FB Topic ID']) {
    return { assigned: 0, skipped: 'missing Telegram IG/FB Topic ID' }
  }
  const allRecent = await fetchAirtableRecords('Posts', {
    filterByFormula: `OR(IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days')), {Scheduled Date}=BLANK())`,
    fields: ['Creator', 'Channel', 'Status', 'Pipeline Target', 'Telegram Sent At', 'Posted At'],
  })
  const creatorPosts = allRecent.filter((p) =>
    linkedIds(p.fields?.Creator).includes(creatorId) &&
    !p.fields?.['Telegram Sent At'] && !p.fields?.['Posted At'] &&
    strOf(p.fields?.['Pipeline Target']) !== 'AI'   // AI content has its own grid; never channel it here
  )
  // ONLY channel posts Penny has already STAGED. Critical: if we channeled a
  // still-'Ready to Go' post, Penny's naked query ({Channel}='') would skip it
  // forever → orphaned with a channel but no caption. So restrict the queue to
  // Staged. (Existing-channeled posts still feed the IG/FB balance count below.)
  const queue = creatorPosts.filter((p) => !strOf(p.fields?.Channel) && strOf(p.fields?.Status) === 'Staged')
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

// Fill thumbnail-queue photos into channeled, unsent posts that have NO
// thumbnail (the risqué reels Penny left blank). Never reshuffles an existing
// thumbnail. No pool → leave blank.
export async function fillBlankThumbnails(creatorId) {
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
    filterByFormula: `AND({Channel}!='', {Telegram Sent At}='', {Posted At}='', {Pipeline Target}!='Publer', {Pipeline Target}!='AI')`,
    fields: ['Creator', 'Thumbnail'],
  })
  const blanks = posts.filter((p) =>
    linkedIds(p.fields?.Creator).includes(creatorId) && !(p.fields?.Thumbnail || []).length
  )
  if (!blanks.length) return { filled: 0 }

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
