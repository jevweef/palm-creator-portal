import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, batchUpdateRecords } from '@/lib/adminAuth'
import { embedText, cosineSimilarity, buildReelEmbeddingText, buildCreatorEmbeddingText } from '@/lib/embeddings'

export const maxDuration = 300 // 5 minutes for bulk processing

/**
 * POST /api/admin/embeddings/backfill
 * One-time backfill: embeds all reels and creators that don't have embeddings yet,
 * then computes all cross-scores.
 *
 * Body: { type: 'reels' | 'creators' | 'all' }
 */
export async function POST(request) {
  try {
    await requireAdmin()

    const { type = 'all' } = await request.json().catch(() => ({}))
    const results = { reelsEmbedded: 0, creatorsEmbedded: 0, scoresComputed: 0 }

    // Step 1: Embed creators without embeddings
    if (type === 'creators' || type === 'all') {
      const creators = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: "AND(NOT({Profile Summary} = ''), OR({Creator Embedding} = '', {Creator Embedding} = BLANK()))",
        fields: ['Creator', 'Profile Summary', 'Brand Voice Notes', 'Content Direction Notes', 'Dos and Donts'],
      })

      for (const creator of creators) {
        const text = buildCreatorEmbeddingText({
          profileSummary: creator.fields['Profile Summary'] || '',
          brandVoiceNotes: creator.fields['Brand Voice Notes'] || '',
          contentDirectionNotes: creator.fields['Content Direction Notes'] || '',
          dosAndDonts: creator.fields['Dos and Donts'] || '',
        })
        if (!text) continue

        const embedding = await embedText(text)
        if (!embedding) continue

        await batchUpdateRecords('Palm Creators', [{
          id: creator.id,
          fields: { 'Creator Embedding': JSON.stringify(embedding) },
        }])
        results.creatorsEmbedded++
      }
    }

    // Step 2: Embed reels without embeddings
    if (type === 'reels' || type === 'all') {
      const reels = await fetchAirtableRecords('Inspiration', {
        filterByFormula: "AND({Status} = 'Complete', NOT({Notes} = ''), OR({Reel Embedding} = '', {Reel Embedding} = BLANK()))",
        fields: ['Title', 'Notes', 'On-Screen Text'],
      })

      const batchSize = 20
      for (let i = 0; i < reels.length; i += batchSize) {
        const batch = reels.slice(i, i + batchSize)
        const updates = []

        for (const reel of batch) {
          const text = buildReelEmbeddingText({
            title: reel.fields['Title'] || '',
            notes: reel.fields['Notes'] || '',
            onScreenText: reel.fields['On-Screen Text'] || '',
          })
          if (!text) continue

          const embedding = await embedText(text)
          if (!embedding) continue

          updates.push({
            id: reel.id,
            fields: { 'Reel Embedding': JSON.stringify(embedding) },
          })
          results.reelsEmbedded++
        }

        if (updates.length > 0) {
          await batchUpdateRecords('Inspiration', updates)
        }
      }
    }

    // Step 3: Compute cross-scores for all embedded reels × creators
    if (type === 'all') {
      const allCreators = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: "NOT({Creator Embedding} = '')",
        fields: ['Creator Embedding'],
      })

      const creatorEmbeddings = {}
      for (const c of allCreators) {
        try {
          creatorEmbeddings[c.id] = JSON.parse(c.fields['Creator Embedding'])
        } catch {}
      }

      const allReels = await fetchAirtableRecords('Inspiration', {
        filterByFormula: "AND({Status} = 'Complete', NOT({Reel Embedding} = ''))",
        fields: ['Reel Embedding'],
      })

      const scoreUpdates = []
      for (const reel of allReels) {
        try {
          const reelEmb = JSON.parse(reel.fields['Reel Embedding'])
          const scores = {}
          for (const [creatorId, creatorEmb] of Object.entries(creatorEmbeddings)) {
            scores[creatorId] = Math.round(cosineSimilarity(reelEmb, creatorEmb) * 1000) / 1000
          }
          scoreUpdates.push({
            id: reel.id,
            fields: { 'Semantic Scores': JSON.stringify(scores) },
          })
          results.scoresComputed++
        } catch {}
      }

      if (scoreUpdates.length > 0) {
        await batchUpdateRecords('Inspiration', scoreUpdates)
      }
    }

    return NextResponse.json({ success: true, ...results })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Embedding backfill error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
