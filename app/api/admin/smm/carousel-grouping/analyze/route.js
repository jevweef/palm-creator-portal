export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdminOrEditor } from '@/lib/adminAuth'

// Carousel auto-grouping — given a set of creator photos, cluster them by
// visual similarity (same shoot / outfit / setting) so the editor can
// surface candidate carousels without manual scrolling.
//
// Cost model: Claude Haiku 4.5 at ~$0.80/M input + ~$4/M output. We pass
// small thumbnails (Airtable auto-generated small variant ~80-200px) as
// URL references — Claude fetches + tokenizes. Estimated cost per analysis:
//   30 photos × ~600 vision input tokens each + ~3000 prompt tokens
//   = ~21k input tokens × $0.80/M = $0.017
//   + ~1k output tokens × $4/M = $0.004
//   ≈ $0.02 per analysis run. Cheap enough to run on every Carousels-tab
//   visit if needed; the UI gates behind an explicit "Find clusters" click.
//
// Request body:
//   {
//     photos: [{ id, url, name? }],   // operator-selected pool to analyze
//   }
//   Limit: max 30 photos per request. UI batches if more.
//
// Response:
//   {
//     clusters: [{ name, photoIds, rationale }],
//     ungroupedIds: [],
//     model: 'claude-haiku-4-5-20251001',
//     usage: { input_tokens, output_tokens, cost_estimate_usd },
//   }

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_PHOTOS_PER_REQUEST = 30

export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  try {
    const { photos } = await request.json()
    if (!Array.isArray(photos) || photos.length === 0) {
      return NextResponse.json({ error: 'photos array required' }, { status: 400 })
    }
    if (photos.length > MAX_PHOTOS_PER_REQUEST) {
      return NextResponse.json({
        error: `Too many photos (${photos.length}). Max ${MAX_PHOTOS_PER_REQUEST} per request.`,
      }, { status: 400 })
    }

    // Build the multi-image content block. Each image labeled by its index
    // so Claude can reference them in the JSON response without echoing URLs.
    const content = []
    photos.forEach((p, idx) => {
      content.push({ type: 'text', text: `Photo ${idx}:` })
      content.push({
        type: 'image',
        source: { type: 'url', url: p.url },
      })
    })
    content.push({
      type: 'text',
      text: `
You're helping an editor pick carousel posts from a creator's photo library.

Group the ${photos.length} photos above into clusters where every photo in a cluster comes from the SAME shoot — same setting (room/background), same outfit, same time-of-day lighting, similar poses. A carousel post works best with 2-5 photos from one shoot.

Rules:
- Only include a photo in a cluster if it's clearly from the same shoot as the others.
- A cluster needs at least 2 photos. Skip singletons.
- A photo can belong to AT MOST one cluster.
- Be conservative — false-positive clusters waste the editor's time. When in doubt, leave a photo ungrouped.
- Order clusters by your confidence (highest first).

Respond with ONLY valid JSON, no prose, this exact shape:

{
  "clusters": [
    {
      "name": "Short label (max 6 words) — e.g. 'White Bedroom Mirror Set' or 'Beach Sunset Walk'",
      "indices": [0, 3, 7],
      "rationale": "One sentence — what visual cue links these (outfit, setting, pose progression)?"
    }
  ]
}

If no clear clusters exist, return {"clusters": []}.
      `.trim(),
    })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const startedAt = Date.now()
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    })
    const elapsedMs = Date.now() - startedAt

    // Parse Claude's text response.
    const textBlock = message.content.find(c => c.type === 'text')
    const raw = textBlock?.text || ''
    let parsed = null
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
    } catch (e) {
      return NextResponse.json({
        error: 'Could not parse Claude response',
        rawResponse: raw,
      }, { status: 502 })
    }

    // Map indices back to photo IDs + validate.
    const usedIndices = new Set()
    const clusters = (parsed.clusters || [])
      .filter(c => Array.isArray(c.indices) && c.indices.length >= 2)
      .map(c => {
        const photoIds = []
        for (const idx of c.indices) {
          if (typeof idx !== 'number' || idx < 0 || idx >= photos.length) continue
          if (usedIndices.has(idx)) continue
          usedIndices.add(idx)
          photoIds.push(photos[idx].id)
        }
        return { name: c.name || 'Unnamed cluster', photoIds, rationale: c.rationale || '' }
      })
      .filter(c => c.photoIds.length >= 2)

    const ungroupedIds = photos.filter((_, idx) => !usedIndices.has(idx)).map(p => p.id)

    // Rough cost estimate (Haiku 4.5 pricing as of model card).
    const inputTokens = message.usage?.input_tokens || 0
    const outputTokens = message.usage?.output_tokens || 0
    const cost = (inputTokens * 0.80 + outputTokens * 4.00) / 1_000_000

    return NextResponse.json({
      clusters,
      ungroupedIds,
      model: MODEL,
      elapsedMs,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_estimate_usd: Math.round(cost * 10000) / 10000,
      },
    })
  } catch (err) {
    console.error('[carousel-grouping/analyze] error:', err)
    const status = err?.status || 500
    return NextResponse.json({ error: err.message || String(err) }, { status })
  }
}
