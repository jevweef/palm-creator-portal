import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { embedText, cosineSimilarity, buildReelEmbeddingText } from '@/lib/embeddings'

/**
 * POST /api/admin/embeddings/compute-reel
 * Triggered after a reel is analyzed. Embeds reel text, computes semantic scores
 * against all creators with embeddings, stores both on the reel record.
 *
 * Body: { reelId: string }
 *
 * Can also be called without auth for internal pipeline triggers by passing
 * { reelId, internalSecret } where internalSecret matches EMBEDDING_INTERNAL_SECRET env var.
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { reelId, internalSecret } = body

    // Allow either admin auth or internal secret (for Python pipeline)
    if (internalSecret) {
      if (internalSecret !== process.env.EMBEDDING_INTERNAL_SECRET) {
        return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
      }
    } else {
      await requireAdmin()
    }

    if (!reelId) {
      return NextResponse.json({ error: 'reelId required' }, { status: 400 })
    }

    // Fetch the reel record
    const reelRecords = await fetchAirtableRecords('Inspiration', {
      filterByFormula: `RECORD_ID() = '${reelId}'`,
      fields: ['Title', 'Notes', 'On-Screen Text'],
    })

    if (reelRecords.length === 0) {
      return NextResponse.json({ error: 'Reel not found' }, { status: 404 })
    }

    const reel = reelRecords[0]
    const reelText = buildReelEmbeddingText({
      title: reel.fields['Title'] || '',
      notes: reel.fields['Notes'] || '',
      onScreenText: reel.fields['On-Screen Text'] || '',
    })

    if (!reelText) {
      return NextResponse.json({ error: 'No text to embed' }, { status: 400 })
    }

    // Embed the reel text
    const reelEmbedding = await embedText(reelText)

    // Fetch all creators that have embeddings
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: "NOT({Creator Embedding} = '')",
      fields: ['Creator', 'Creator Embedding'],
    })

    // Compute similarity scores against each creator
    const scores = {}
    for (const creator of creators) {
      try {
        const creatorEmbedding = JSON.parse(creator.fields['Creator Embedding'])
        scores[creator.id] = Math.round(cosineSimilarity(reelEmbedding, creatorEmbedding) * 1000) / 1000
      } catch {
        // Skip creators with invalid embeddings
      }
    }

    // Store embedding + scores on the reel
    await patchAirtableRecord('Inspiration', reelId, {
      'Reel Embedding': JSON.stringify(reelEmbedding),
      'Semantic Scores': JSON.stringify(scores),
    })

    return NextResponse.json({
      success: true,
      reelId,
      creatorsScored: Object.keys(scores).length,
      scores,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Compute reel embedding error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
