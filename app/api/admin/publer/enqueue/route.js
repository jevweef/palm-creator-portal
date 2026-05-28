export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import {
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

// POST /api/admin/publer/enqueue
//   body: { postIds: ['recXXX', ...] }
//
// Bulk-marks Posts with Status='Queued for Publer' and Pipeline Target='Publer'.
// The publer-queue cron drains these one-at-a-time and submits to Publer.
//
// Routing validation (scoping doc §6.5):
//   A Post's destination is derived from the Channel + Creator pair, looking
//   up the matching Publer Accounts row's Account Type. AI → Publer, Real →
//   Telegram. Mixed-Channel within a single Post isn't possible in this
//   codebase (Channel is a singleSelect, not a list) so the "mixed" guard
//   from the scoping doc collapses to "the Publer Account for this Creator+
//   Channel must be Account Type='AI' AND Status='Active'." A Post pointing
//   at a Real-type account gets rejected — that one belongs in the Telegram
//   enqueue, not Publer.
//
// typecast=true on the PATCH so 'Queued for Publer', 'Publer' (Pipeline
// Target) and 'Pending' (Publer Status) singleSelect options auto-create on
// first use.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { postIds } = await request.json()
    if (!Array.isArray(postIds) || !postIds.length) {
      return NextResponse.json({ error: 'postIds[] required' }, { status: 400 })
    }

    // Fetch the posts so we can validate Channel + Creator before flipping
    // status. One Airtable OR-of-RECORD_ID() call instead of N — much cheaper.
    const postFilter = `OR(${postIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`
    const posts = await fetchAirtableRecords('Posts', {
      filterByFormula: postFilter,
      fields: ['Post Name', 'Status', 'Channel', 'Creator', 'Pipeline Target'],
    })
    const postById = Object.fromEntries(posts.map(p => [p.id, p]))

    // Pull all Active Publer Accounts in one query and index by Creator+Channel.
    // For routing we only care about Active rows — Reauth Required / Disabled
    // shouldn't accept new posts.
    const publerAccounts = await fetchAirtableRecords('Publer Accounts', {
      filterByFormula: `{Status}='Active'`,
      fields: ['Publer Account ID', 'Account Name', 'Channel', 'Creator', 'Account Type'],
    }).catch(err => {
      if (err.message?.includes('NOT_FOUND') || err.message?.includes('404')) {
        const e = new Error('Publer Accounts table not found — create it per scoping doc §3.1.2 first.')
        e.status = 412
        throw e
      }
      throw err
    })

    // Key: `${creatorRecId}|${channel}` → publer account row
    const acctByCreatorChannel = new Map()
    for (const a of publerAccounts) {
      const f = a.fields || {}
      const creatorId = (f.Creator || [])[0]
      const channel = f.Channel
      if (!creatorId || !channel) continue
      acctByCreatorChannel.set(`${creatorId}|${channel}`, { id: a.id, fields: f })
    }

    const channelOf = (p) => {
      const c = p.fields?.Channel
      return typeof c === 'string' ? c : (c?.name || null)
    }

    const enqueued = []
    const rejected = []

    for (const postId of postIds) {
      const post = postById[postId]
      if (!post) { rejected.push({ postId, reason: 'post not found' }); continue }

      const ch = channelOf(post)
      const creatorId = (post.fields?.Creator || [])[0]
      if (!ch) { rejected.push({ postId, reason: 'post has no Channel set' }); continue }
      if (!creatorId) { rejected.push({ postId, reason: 'post has no Creator link' }); continue }

      const acct = acctByCreatorChannel.get(`${creatorId}|${ch}`)
      if (!acct) {
        rejected.push({ postId, reason: `no Active Publer account for Creator+Channel=${ch} — sync + map first` })
        continue
      }
      const acctType = acct.fields['Account Type']
      if (acctType !== 'AI') {
        rejected.push({
          postId,
          reason: `target Publer account is Account Type='${acctType || 'unset'}', not AI — use Telegram enqueue for Real accounts`,
        })
        continue
      }

      try {
        await patchAirtableRecord('Posts', postId, {
          'Status': 'Queued for Publer',
          'Pipeline Target': 'Publer',
          'Publer Status': 'Pending',
          // Clear any prior error message so the operator doesn't see a stale
          // failure next to a freshly-queued post.
          'Publer Last Error': '',
        }, { typecast: true })
        enqueued.push(postId)
      } catch (e) {
        rejected.push({ postId, reason: `patch failed: ${e.message}` })
      }
    }

    return NextResponse.json({
      ok: true,
      queued: enqueued.length,
      enqueued,
      rejected,
    })
  } catch (err) {
    console.error('[admin/publer/enqueue] error:', err)
    return NextResponse.json(
      { error: err.message },
      { status: err.status && err.status < 500 ? err.status : 500 }
    )
  }
}
