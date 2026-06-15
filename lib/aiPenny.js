// lib/aiPenny.js — the AI parallel pipeline ("Penny for AI").
//
// Real content (Penny) and AI content run on SEPARATE tracks. This handles AI:
// AI reels (Pipeline Target='AI', linked Asset Source Type='AI Generated') get a
// caption + a thumbnail pulled from the creator's AI thumbnail queue, then sit
// Staged in the AI grid tab until the AI push queues them. They route to the
// creator's single AI Telegram topic (by Source Type) — NO IG/FB channel.
//
// Reuses the same caption engine + helpers as Penny; only the thumbnail source
// (AI queue, not the real pool / frame grab) and the no-channel send differ.

import { fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { generateCaptions } from '@/lib/captionEngine'
import { rawDropboxUrl } from '@/lib/pennyThumbnail'
import { strOf, linkedIds, pickAutoCaption } from '@/lib/penny'

// Pick a cover from the creator's AI thumbnail queue (Assets 'AI Approved
// Thumbnail'=1). Returns { url, assetId } or null if the queue is empty (Evan
// fills it; empty → leave the thumbnail blank).
export async function pickAiThumbnail(creatorId) {
  const pool = await fetchAirtableRecords('Assets', {
    filterByFormula: `{AI Approved Thumbnail}=1`,
    fields: ['Palm Creators', 'Dropbox Shared Link'],
  })
  const tiles = pool
    .filter((a) => linkedIds(a.fields?.['Palm Creators']).includes(creatorId))
    .map((a) => ({ id: a.id, link: a.fields?.['Dropbox Shared Link'] || '' }))
    .filter((t) => t.link)
  if (!tiles.length) return null
  const pick = tiles[Math.floor(Math.random() * tiles.length)]
  return { url: rawDropboxUrl(pick.link), assetId: pick.id }
}

// Process ONE naked AI reel: caption + AI-queue thumbnail + Stage. Never throws.
export async function processOneAiPost(post, { dryRun = false, log = () => {} } = {}) {
  const f = post.fields || {}
  const postId = post.id
  const creatorId = linkedIds(f.Creator)[0]
  const assetId = linkedIds(f.Asset)[0]
  const result = { postId, name: f['Post Name'] || '', creatorId }
  if (!creatorId || !assetId) return { ...result, error: 'missing Creator or Asset link' }

  const [assetList, creatorList] = await Promise.all([
    fetchAirtableRecords('Assets', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(assetId)}`,
      fields: ['Edited File Link', 'Dropbox Shared Link', 'Source Type'],
    }),
    fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'AKA', 'AI Name'],
    }),
  ])
  const af = assetList[0]?.fields || {}
  // Defensive: this lib only handles AI content.
  if (strOf(af['Source Type']) !== 'AI Generated') return { ...result, error: 'not AI content (Source Type)' }
  const videoLink = rawDropboxUrl(af['Edited File Link'] || af['Dropbox Shared Link'] || '')
  if (!videoLink) return { ...result, error: 'asset has no file link' }
  const cf = creatorList[0]?.fields || {}
  // Caption in the AI persona's voice when present (e.g. "Brielle"), else AKA.
  const creatorName = cf['AI Name'] || cf.AKA || cf.Creator || ''

  // 1. Caption (same engine as Penny; auto-pick the best, bio-capped).
  let caption = ''
  try {
    log('caption: calling Gemini…')
    const caps = await generateCaptions({
      videoUrl: videoLink,
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

  // 2. Thumbnail — from the creator's AI thumbnail queue (Evan fills it). Empty
  //    queue → leave blank (he'll add covers, or set one in the AI grid).
  const patch = {}
  if (caption) patch['Caption'] = caption
  const tile = await pickAiThumbnail(creatorId)
  if (tile) {
    patch['Thumbnail'] = [{ url: tile.url }]
    patch['Thumbnail Source'] = 'ai-pool'
    patch['Thumbnail Asset'] = tile.assetId
    result.thumbnail = 'from AI queue'
  } else {
    result.thumbnail = 'AI queue empty — left blank'
  }

  // 3. Stage it (sits in the AI grid tab until the AI push sends it).
  patch['Status'] = 'Staged'
  if (dryRun) return { ...result, dryRun: true, wouldPatch: Object.keys(patch) }
  await patchAirtableRecord('Posts', postId, patch, { typecast: true })
  result.staged = true
  log('staged')
  return result
}
