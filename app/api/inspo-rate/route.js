/**
 * Thumbs up / down on inspo reels — explicit creator preference.
 *
 * action: 'up' | 'down' | 'clear'
 *   'up'    → ensure creator is in Thumbs Up By, remove from Thumbs Down By
 *   'down'  → ensure creator is in Thumbs Down By, remove from Thumbs Up By
 *   'clear' → remove from both
 *
 * After updating the reel, recomputes the creator's centroid embeddings +
 * tag-bump map, caches them on the Palm Creators record so For You scoring
 * doesn't have to recompute from scratch on every page load.
 */

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

const AT_HEADERS = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

function avgVectors(vectors) {
  if (!vectors.length) return null
  const dim = vectors[0].length
  const out = new Array(dim).fill(0)
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i]
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length
  return out
}

async function getRecord(table, id) {
  const r = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${table}/${id}`,
    { headers: AT_HEADERS, cache: 'no-store' },
  )
  if (!r.ok) throw new Error(`Airtable GET ${table}/${id} ${r.status}: ${await r.text()}`)
  return r.json()
}

async function patchRecord(table, id, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${table}/${id}`,
    { method: 'PATCH', headers: AT_HEADERS, body: JSON.stringify({ fields }) },
  )
  if (!r.ok) {
    const err = await r.text()
    const e = new Error(`Airtable PATCH ${table}/${id} ${r.status}: ${err}`)
    e.status = r.status
    e.body = err
    throw e
  }
  return r.json()
}

/**
 * Fetch every reel the creator has currently thumbed (up or down).
 * Returns [{ id, vote: 'up'|'down', tags, embedding }].
 */
async function listCreatorThumbedReels(creatorOpsId) {
  // Match Airtable record link arrays via FIND on ARRAYJOIN.
  const formula = `OR(FIND('${creatorOpsId}', ARRAYJOIN({Thumbs Up By})), FIND('${creatorOpsId}', ARRAYJOIN({Thumbs Down By})))`
  const params = new URLSearchParams({
    filterByFormula: formula,
    pageSize: '100',
    'fields[]': 'Thumbs Up By', // multiple appended below
  })
  // URLSearchParams doesn't natively repeat keys for multi-value; do it manually
  const fields = ['Thumbs Up By', 'Thumbs Down By', 'Tags', 'Suggested Tags', 'Film Format', 'Reel Embedding']
  const url = `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}?` +
    `filterByFormula=${encodeURIComponent(formula)}&pageSize=100&` +
    fields.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&')

  const out = []
  let nextUrl = url
  while (nextUrl) {
    const r = await fetch(nextUrl, { headers: AT_HEADERS, cache: 'no-store' })
    if (!r.ok) throw new Error(`Airtable list ${r.status}: ${await r.text()}`)
    const j = await r.json()
    for (const rec of j.records || []) {
      const f = rec.fields || {}
      const ups = (f['Thumbs Up By'] || []).map((x) => x.id || x)
      const downs = (f['Thumbs Down By'] || []).map((x) => x.id || x)
      const vote = ups.includes(creatorOpsId) ? 'up' : (downs.includes(creatorOpsId) ? 'down' : null)
      if (!vote) continue
      let embedding = null
      try {
        if (f['Reel Embedding']) embedding = JSON.parse(f['Reel Embedding'])
      } catch {}
      out.push({
        id: rec.id,
        vote,
        tags: [...(f['Tags'] || []), ...(f['Suggested Tags'] || []), ...(f['Film Format'] || [])],
        embedding,
      })
    }
    nextUrl = j.offset
      ? `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}?offset=${j.offset}&` +
        `filterByFormula=${encodeURIComponent(formula)}&pageSize=100&` +
        fields.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join('&')
      : null
  }
  return out
}

/**
 * Recompute centroids + tag bumps for a creator and cache on Palm Creators.
 * Failure is non-fatal — we'll just lose the personalized layer for now.
 */
async function recomputeCreatorCache(creatorOpsId) {
  const reels = await listCreatorThumbedReels(creatorOpsId)
  const upEmbeds = reels.filter((r) => r.vote === 'up' && r.embedding).map((r) => r.embedding)
  const downEmbeds = reels.filter((r) => r.vote === 'down' && r.embedding).map((r) => r.embedding)

  // Tag bumps: + for thumbs-up tags, - for thumbs-down tags
  const bumps = {}
  for (const reel of reels) {
    const sign = reel.vote === 'up' ? 1 : -1
    for (const tag of reel.tags) {
      bumps[tag] = (bumps[tag] || 0) + sign
    }
  }

  const upCentroid = avgVectors(upEmbeds)
  const downCentroid = avgVectors(downEmbeds)

  await patchRecord(PALM_CREATORS_TABLE, creatorOpsId, {
    'Inspo Centroid Up': upCentroid ? JSON.stringify(upCentroid) : '',
    'Inspo Centroid Down': downCentroid ? JSON.stringify(downCentroid) : '',
    'Inspo Tag Bumps': Object.keys(bumps).length ? JSON.stringify(bumps) : '',
  })

  return { ups: upEmbeds.length, downs: downEmbeds.length, tagCount: Object.keys(bumps).length }
}

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recordId, creatorOpsId, action } = await request.json()

    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'
    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!recordId || !creatorOpsId || !['up', 'down', 'clear'].includes(action)) {
      return NextResponse.json({ error: 'Missing recordId, creatorOpsId, or valid action (up/down/clear)' }, { status: 400 })
    }
    if (!/^rec[A-Za-z0-9]{14}$/.test(recordId) || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
      return NextResponse.json({ error: 'Invalid record ID format' }, { status: 400 })
    }

    // Retry loop in case of concurrent rate updates from the same creator
    const MAX_RETRIES = 3
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const reel = await getRecord(INSPIRATION_TABLE, recordId)
      const f = reel.fields || {}
      const ups = (f['Thumbs Up By'] || []).map((x) => x.id || x)
      const downs = (f['Thumbs Down By'] || []).map((x) => x.id || x)

      let nextUps, nextDowns
      if (action === 'up') {
        nextUps = ups.includes(creatorOpsId) ? ups : [...ups, creatorOpsId]
        nextDowns = downs.filter((id) => id !== creatorOpsId)
      } else if (action === 'down') {
        nextUps = ups.filter((id) => id !== creatorOpsId)
        nextDowns = downs.includes(creatorOpsId) ? downs : [...downs, creatorOpsId]
      } else {
        nextUps = ups.filter((id) => id !== creatorOpsId)
        nextDowns = downs.filter((id) => id !== creatorOpsId)
      }

      // Skip the patch if nothing changed
      if (nextUps.length === ups.length && nextDowns.length === downs.length &&
          nextUps.every((id) => ups.includes(id)) && nextDowns.every((id) => downs.includes(id))) {
        return NextResponse.json({ status: 'noop', action })
      }

      try {
        await patchRecord(INSPIRATION_TABLE, recordId, {
          'Thumbs Up By': nextUps,
          'Thumbs Down By': nextDowns,
        })
        // Fire-and-forget centroid refresh; if it fails the next rate click
        // will retry it. Awaited so the client knows when scoring is current.
        let cacheStats = null
        try {
          cacheStats = await recomputeCreatorCache(creatorOpsId)
        } catch (e) {
          console.log('[inspo-rate] cache refresh failed (non-fatal):', e.message)
        }
        return NextResponse.json({ status: 'ok', action, cacheStats })
      } catch (e) {
        if (e.status === 422 && attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)))
          continue
        }
        throw e
      }
    }

    return NextResponse.json({ error: 'Failed after retries' }, { status: 500 })
  } catch (err) {
    console.log('[inspo-rate] Exception:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
