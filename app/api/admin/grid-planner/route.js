export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

// GET /api/admin/grid-planner
//   - No params: returns list of creators who have managed IG accounts
//   - ?creatorId=rec...: returns that creator's accounts + all their posts grouped by account
//
// Grid planner shows 1 creator at a time. Each creator has up to 4 IG accounts
// (Main + Palm IG 1/2/3). Posts with no Account field set show in an "Unassigned"
// bucket so the admin can drag them into an account grid.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const creatorId = searchParams.get('creatorId')

    // Fetch ALL managed creators (anyone with at least one active IG account in CPD)
    const allAccounts = await fetchAirtableRecords('Creator Platform Directory', {
      filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
      fields: ['Account Name', 'Creator', 'Platform', 'Status', 'Handle/ Username', 'URL', 'Follower Count', 'Account Type'],
    })

    // Extract unique creator IDs + fetch their names
    const creatorIds = [...new Set(allAccounts.flatMap(a => a.fields?.Creator || []).filter(Boolean))]
    if (!creatorIds.length) {
      return NextResponse.json({ creators: [], selectedCreator: null, accounts: [], posts: [] })
    }

    const creatorRecs = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `OR(${creatorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
      fields: ['Creator', 'AKA'],
    })
    const creatorMap = Object.fromEntries(creatorRecs.map(r => [r.id, r.fields?.AKA || r.fields?.Creator || '(unnamed)']))

    // Count IG accounts per creator to flag which ones are actually editable
    const accountsPerCreator = {}
    for (const acc of allAccounts) {
      for (const cid of acc.fields?.Creator || []) {
        if (!accountsPerCreator[cid]) accountsPerCreator[cid] = 0
        accountsPerCreator[cid]++
      }
    }

    const creators = Object.entries(creatorMap)
      .map(([id, name]) => ({ id, name, accountCount: accountsPerCreator[id] || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (!creatorId) {
      return NextResponse.json({ creators })
    }

    // Fetch this creator's accounts + all their posts in parallel
    const creatorAccounts = allAccounts.filter(a => (a.fields?.Creator || []).includes(creatorId))

    // Pull posts in window (last 60 days + future), filter to this creator in memory.
    // Can't filter by Creator record ID in Airtable formula — ARRAYJOIN returns
    // display names, not IDs. Fetch-then-filter is fine at this scale (tens of posts).
    const allRecentPosts = await fetchAirtableRecords('Posts', {
      filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(NOW(), -60, 'days'))`,
      fields: [
        'Post Name', 'Creator', 'Account', 'Asset', 'Task',
        'Status', 'Platform', 'Caption', 'Thumbnail',
        'Scheduled Date', 'Telegram Sent At', 'Posted At', 'Post Link',
      ],
    })
    const posts = allRecentPosts.filter(p => (p.fields?.Creator || []).includes(creatorId))

    // Pull asset thumbnails (fallback when Post doesn't have its own thumb yet)
    const assetIds = [...new Set(posts.flatMap(p => p.fields?.Asset || []).filter(Boolean))]
    const assetMap = {}
    if (assetIds.length) {
      const assets = await fetchAirtableRecords('Assets', {
        filterByFormula: `OR(${assetIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['Asset Name', 'Thumbnail', 'Edited File Link', 'Dropbox Shared Link'],
      })
      for (const a of assets) assetMap[a.id] = a.fields || {}
    }

    // Normalize accounts
    const accounts = creatorAccounts.map(a => {
      const f = a.fields || {}
      const rawUrl = (f['URL'] || '').trim()
      const handle = (f['Handle/ Username'] || '').trim().replace(/^@/, '')
      return {
        id: a.id,
        name: f['Account Name'] || '',
        handle,
        url: rawUrl.startsWith('http') ? rawUrl : (rawUrl ? `https://${rawUrl}` : (handle ? `https://instagram.com/${handle}` : '')),
        followers: f['Follower Count'] || null,
        accountType: f['Account Type'] || '',
        status: f['Status'] || '',
      }
    }).sort((a, b) => {
      // Main first, then numbered Palm IGs in order
      const order = s => {
        if (s.accountType === 'Main') return 0
        const m = s.name.match(/Palm IG (\d+)/i)
        return m ? parseInt(m[1]) : 99
      }
      return order(a) - order(b)
    })

    // Normalize posts + bucket by account
    const normalized = posts.map(p => {
      const f = p.fields || {}
      const assetId = (f.Asset || [])[0]
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const thumb = (f.Thumbnail?.[0]?.thumbnails?.large?.url) || (f.Thumbnail?.[0]?.url) ||
        (asset.Thumbnail?.[0]?.thumbnails?.large?.url) || (asset.Thumbnail?.[0]?.url) || ''
      const accountId = (f.Account || [])[0] || null
      return {
        id: p.id,
        name: f['Post Name'] || '',
        status: f.Status || '',
        accountId,
        scheduledDate: f['Scheduled Date'] || null,
        telegramSentAt: f['Telegram Sent At'] || null,
        postedAt: f['Posted At'] || null,
        postLink: f['Post Link'] || '',
        thumbnail: thumb,
        platform: f.Platform || [],
        caption: f.Caption || '',
      }
    })

    return NextResponse.json({
      creators,
      selectedCreator: { id: creatorId, name: creatorMap[creatorId] || '' },
      accounts,
      posts: normalized,
    })
  } catch (err) {
    console.error('[Grid Planner] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/grid-planner
//   body: { action: 'swap', postA: 'rec...', postB: 'rec...' }
//     → swaps the Scheduled Date between two posts
//
//   body: { action: 'assign', postId: 'rec...', accountIds: ['rec...'] }
//     → sets/replaces the Account field on one post
//
//   body: { action: 'setDate', postId: 'rec...', scheduledDate: 'ISO' }
//     → updates a single post's scheduled time directly
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'swap') {
      const { postA, postB } = body
      if (!postA || !postB) {
        return NextResponse.json({ error: 'postA and postB required' }, { status: 400 })
      }
      // Fetch both posts to get their current Scheduled Dates
      const posts = await fetchAirtableRecords('Posts', {
        filterByFormula: `OR(RECORD_ID()='${postA}', RECORD_ID()='${postB}')`,
        fields: ['Scheduled Date'],
      })
      const a = posts.find(p => p.id === postA)
      const b = posts.find(p => p.id === postB)
      if (!a || !b) return NextResponse.json({ error: 'One or both posts not found' }, { status: 404 })
      const dateA = a.fields?.['Scheduled Date'] || null
      const dateB = b.fields?.['Scheduled Date'] || null
      // Swap. Use null-safe patches — can't write undefined.
      await Promise.all([
        patchAirtableRecord('Posts', postA, { 'Scheduled Date': dateB }),
        patchAirtableRecord('Posts', postB, { 'Scheduled Date': dateA }),
      ])
      return NextResponse.json({ ok: true, swapped: { [postA]: dateB, [postB]: dateA } })
    }

    if (action === 'assign') {
      const { postId, accountIds } = body
      if (!postId || !Array.isArray(accountIds)) {
        return NextResponse.json({ error: 'postId and accountIds[] required' }, { status: 400 })
      }
      await patchAirtableRecord('Posts', postId, { 'Account': accountIds })
      return NextResponse.json({ ok: true })
    }

    if (action === 'setDate') {
      const { postId, scheduledDate } = body
      if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
      await patchAirtableRecord('Posts', postId, { 'Scheduled Date': scheduledDate || null })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[Grid Planner] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
