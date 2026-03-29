import { NextResponse } from 'next/server'
import { fetchAirtableRecords, batchUpdateRecords } from '@/lib/adminAuth'

function engagementScore(f) {
  const views = f.Views || 0
  if (views === 0) return 0
  const likes = Math.max(0, f.Likes || 0)
  const comments = Math.max(0, f.Comments || 0)
  const shares = Math.max(0, f.Shares || 0)
  const weighted = (likes * 1 + comments * 3 + shares * 5) / views
  return weighted * Math.log10(Math.max(views, 10))
}

// Public endpoint — secured by secret param
export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const expectedSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
    if (secret !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
    }

    const body = await request.json()
    const handle = body.handle
    if (!handle) {
      return NextResponse.json({ error: 'handle required' }, { status: 400 })
    }

    console.log(`[Score-Reels] Starting scoring for @${handle}`)

    // Fetch this handle's Source Reels that are missing scores
    const reels = await fetchAirtableRecords('Source Reels', {
      filterByFormula: `AND({Source Handle} = "${handle}", {Views} > 0, {Performance Score} = BLANK())`,
    })

    console.log(`[Score-Reels] Found ${reels.length} unscored reels for @${handle}`)

    if (reels.length === 0) {
      return NextResponse.json({ scored: 0 })
    }

    // Calculate engagement scores
    const scored = reels.map(r => {
      const f = r.fields || {}
      const score = engagementScore(f)
      const followerCount = f['Follower Count'] || 0
      const views = f.Views || 0

      const update = {
        'Performance Score': Math.round(score * 1e6) / 1e6,
      }

      if (followerCount > 0 && views > 0) {
        update['Normalized Score'] = Math.round((views / followerCount) * 10000) / 10000
      }

      return { record: r, score, update }
    })

    // Calculate z-scores across batch
    const scores = scored.map(s => s.score)
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
    const stdDev = Math.sqrt(variance) || 1

    for (const s of scored) {
      const z = (s.score - mean) / stdDev
      s.update['Z Score'] = Math.round(z * 1000) / 1000

      if (z >= 2.0) s.update.Grade = 'A+'
      else if (z >= 1.5) s.update.Grade = 'A'
      else if (z >= 1.0) s.update.Grade = 'A-'
      else if (z >= 0.5) s.update.Grade = 'B+'
      else if (z >= 0.0) s.update.Grade = 'B'
      else if (z >= -0.5) s.update.Grade = 'B-'
      else if (z >= -1.0) s.update.Grade = 'C+'
      else if (z >= -1.5) s.update.Grade = 'C'
      else if (z >= -2.0) s.update.Grade = 'C-'
      else s.update.Grade = 'D'
    }

    // Batch update
    const updates = scored.map(s => ({
      id: s.record.id,
      fields: s.update,
    }))

    await batchUpdateRecords('Source Reels', updates)

    console.log(`[Score-Reels] Scored ${updates.length} reels for @${handle}. Grades: ${scored.map(s => s.update.Grade).join(', ')}`)

    // Trigger promote as a separate function (don't await — let it run independently)
    const callbackSecret = process.env.APIFY_CALLBACK_SECRET || 'default-secret'
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.palm-mgmt.com'
    try {
      const promoteRes = await fetch(`${baseUrl}/api/admin/promote-handle?secret=${callbackSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      })
      const promoteData = await promoteRes.json()
      console.log(`[Score-Reels] Promote result: ${promoteData.promoted || 0} promoted`)
    } catch (err) {
      console.error(`[Score-Reels] Promote trigger failed:`, err)
    }

    return NextResponse.json({ scored: updates.length })
  } catch (err) {
    console.error('Score-reels error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
