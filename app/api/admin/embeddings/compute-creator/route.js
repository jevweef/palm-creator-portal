import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, batchUpdateRecords } from '@/lib/adminAuth'
import { embedText, cosineSimilarity, buildCreatorEmbeddingText } from '@/lib/embeddings'

/**
 * POST /api/admin/embeddings/compute-creator
 * Triggered after creator profile is analyzed or refined. Embeds creator profile text,
 * re-scores all reels that have embeddings, updates Semantic Scores on each reel.
 *
 * Body: { creatorId: string }
 */
export async function POST(request) {
  try {
    await requireAdmin()

    const { creatorId } = await request.json()
    if (!creatorId) {
      return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
    }

    // Fetch creator profile fields
    const creatorRecords = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['Creator', 'Profile Summary', 'Brand Voice Notes', 'Content Direction Notes', 'Dos and Donts'],
    })

    if (creatorRecords.length === 0) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }

    const creator = creatorRecords[0]
    const creatorText = buildCreatorEmbeddingText({
      profileSummary: creator.fields['Profile Summary'] || '',
      brandVoiceNotes: creator.fields['Brand Voice Notes'] || '',
      contentDirectionNotes: creator.fields['Content Direction Notes'] || '',
      dosAndDonts: creator.fields['Dos and Donts'] || '',
    })

    if (!creatorText) {
      return NextResponse.json({ error: 'No profile text to embed' }, { status: 400 })
    }

    // Embed the creator profile
    const creatorEmbedding = await embedText(creatorText)

    // Store creator embedding
    await patchAirtableRecord('Palm Creators', creatorId, {
      'Creator Embedding': JSON.stringify(creatorEmbedding),
    })

    // Fetch all reels that have embeddings
    const reels = await fetchAirtableRecords('Inspiration', {
      filterByFormula: "AND({Status} = 'Complete', NOT({Reel Embedding} = ''))",
      fields: ['Reel Embedding', 'Semantic Scores'],
    })

    // Re-score each reel against this creator and batch update
    const updates = []
    for (const reel of reels) {
      try {
        const reelEmbedding = JSON.parse(reel.fields['Reel Embedding'])
        const score = Math.round(cosineSimilarity(creatorEmbedding, reelEmbedding) * 1000) / 1000

        // Merge with existing scores (other creators' scores stay)
        let existingScores = {}
        try {
          existingScores = JSON.parse(reel.fields['Semantic Scores'] || '{}')
        } catch { /* start fresh */ }
        existingScores[creatorId] = score

        updates.push({
          id: reel.id,
          fields: { 'Semantic Scores': JSON.stringify(existingScores) },
        })
      } catch {
        // Skip reels with invalid embeddings
      }
    }

    // Batch update reels (10 at a time per Airtable limits)
    if (updates.length > 0) {
      await batchUpdateRecords('Inspiration', updates)
    }

    return NextResponse.json({
      success: true,
      creatorId,
      reelsScored: updates.length,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Compute creator embedding error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
