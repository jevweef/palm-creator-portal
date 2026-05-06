export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
const TELEGRAM_SMM_GROUP_CHAT_ID = process.env.TELEGRAM_SMM_GROUP_CHAT_ID

// Bulk unsend + requeue. For when the cron's broken and shipped duplicate
// messages to Telegram. Takes a creatorId + window, finds all Posts marked
// Sent to Telegram inside that window, deletes the Telegram messages, and
// flips the Posts back to 'Queued for Telegram' so the cron resends them
// fresh. Telegram bots can only delete their own messages within ~48h, so
// don't pass a window larger than that.
//
// Body: { creatorId: 'recXXX', sinceMinutes: 60 }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  if (!TELEGRAM_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }

  try {
    const { creatorId, sinceMinutes = 60 } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })

    const sinceISO = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString()

    // Find all Posts marked Sent to Telegram in the window, then filter to
    // this creator client-side. We can't filter on Creator in the formula
    // because ARRAYJOIN({Creator}) returns the linked records' primary field
    // text (e.g. "Grace Collins"), not their record IDs — so FIND with a
    // 'rec...' ID never matches.
    const allPosts = await fetchAirtableRecords('Posts', {
      filterByFormula: `AND({Status}='Sent to Telegram', IS_AFTER({Telegram Sent At}, '${sinceISO}'))`,
      fields: ['Post Name', 'Account', 'Creator', 'Telegram Message ID', 'Telegram Sent At'],
    })
    const posts = allPosts.filter(p =>
      (p.fields?.Creator || []).includes(creatorId)
    )

    if (!posts.length) {
      return NextResponse.json({ ok: true, found: 0, message: 'No posts in window' })
    }

    // Build a map: accountId → smmTopicId (so we know which chat each Post went to)
    const accountIds = [...new Set(posts.flatMap(p => p.fields?.Account || []).filter(Boolean))]
    const accountMap = {}
    if (accountIds.length) {
      const accs = await fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `OR(${accountIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
        fields: ['Telegram Topic ID'],
      })
      for (const a of accs) accountMap[a.id] = a.fields?.['Telegram Topic ID'] || null
    }

    // Creator's Telegram Thread ID (for non-SMM sends)
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID()='${creatorId}'`,
      fields: ['Telegram Thread ID'],
    })
    const creatorThreadId = creators[0]?.fields?.['Telegram Thread ID'] || null

    const results = { found: posts.length, deleted: 0, deleteFailed: 0, requeued: 0, errors: [] }

    for (const p of posts) {
      const f = p.fields || {}
      const messageId = f['Telegram Message ID']
      const accountId = (f.Account || [])[0] || null
      const smmTopicId = accountId ? accountMap[accountId] : null

      // Pick chat ID the same way the send route did. SMM topic wins over
      // creator thread if both exist.
      const useSmm = !!smmTopicId
      const chatId = useSmm ? TELEGRAM_SMM_GROUP_CHAT_ID : TELEGRAM_CHAT_ID

      // Try to delete the Telegram message. If we don't have a Message ID
      // (older sends pre-dating that field, or media-group sends where the
      // ID wasn't captured), skip the delete and just requeue — operator
      // will need to manually delete from Telegram.
      if (messageId && chatId) {
        try {
          const delRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: parseInt(messageId) }),
          })
          const delData = await delRes.json()
          if (delData.ok) {
            results.deleted++
          } else {
            // Common failures: 'message to delete not found' (already deleted),
            // 'message can't be deleted' (older than 48h). Either way, proceed
            // to requeue — the message either isn't there or we can't touch it.
            results.deleteFailed++
            results.errors.push({ postId: p.id, kind: 'delete', error: delData.description || 'unknown' })
          }
        } catch (e) {
          results.deleteFailed++
          results.errors.push({ postId: p.id, kind: 'delete', error: e.message })
        }
      } else {
        results.deleteFailed++
        results.errors.push({ postId: p.id, kind: 'delete', error: 'no message ID stored' })
      }

      // Requeue regardless of delete outcome — the operator can manually
      // remove any leftover Telegram messages, but we want the Airtable
      // state reset so the cron picks these up again.
      try {
        await patchAirtableRecord('Posts', p.id, {
          'Status': 'Queued for Telegram',
          'Telegram Sent At': null,
          'Telegram Message ID': null,
        })
        results.requeued++
      } catch (e) {
        results.errors.push({ postId: p.id, kind: 'requeue', error: e.message })
      }
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (err) {
    console.error('[bulk-unsend] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
