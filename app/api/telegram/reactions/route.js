import { NextResponse } from 'next/server'
import { fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// Telegram reaction webhook for the "Palm Send Posts" bot. When the SMM reacts
// with a 👍 / ❤️ / ✅ to a post's message in its topic, that reel is "used"
// (posted to social) → mark the matching Post as Posted so it drops out of the
// runway buffer. Un-reacting restores it. Requires: the bot is an ADMIN in the
// SMM group, setWebhook with allowed_updates:['message_reaction'], and
// (optionally) a secret token in TELEGRAM_WEBHOOK_SECRET.

// Any of these "used it" reactions count — thumbs-up is the primary one the
// managers use; hearts and check kept as equivalents.
const USED = new Set(['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿', '✅', '☑', '☑️', '✔', '✔️',
  '❤', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💗', '💓', '💞', '💕', '♥', '♥️'])
const hasHeart = (arr) => (arr || []).some((r) => r?.type === 'emoji' && USED.has(r.emoji))

// Posts store 'Telegram Message ID' as a comma-joined string (video msg [+ cover
// photo msg]). FIND() matches substrings, so verify the id is an exact member.
async function findPostByMessageId(msgId) {
  const s = String(msgId)
  const recs = await fetchAirtableRecords('Posts', {
    filterByFormula: `FIND('${s}', {Telegram Message ID})`,
    fields: ['Telegram Message ID', 'Status', 'Posted At', 'Post Name'],
  })
  return recs.find((r) => String(r.fields?.['Telegram Message ID'] || '')
    .split(',').map((x) => x.trim()).includes(s)) || null
}

export async function POST(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let update
  try { update = await request.json() } catch { return NextResponse.json({ ok: true }) }
  const mr = update?.message_reaction
  if (!mr?.message_id) return NextResponse.json({ ok: true }) // not a reaction update

  try {
    const post = await findPostByMessageId(mr.message_id)
    if (!post) return NextResponse.json({ ok: true, matched: false })
    const nowHeart = hasHeart(mr.new_reaction)
    const wasHeart = hasHeart(mr.old_reaction)

    if (nowHeart && !post.fields['Posted At']) {
      await patchAirtableRecord('Posts', post.id, { 'Posted At': new Date().toISOString(), 'Status': 'Posted' }, { typecast: true })
      console.log(`[tg-reactions] ❤️ → Posted: ${post.fields['Post Name']}`)
      return NextResponse.json({ ok: true, marked: 'posted' })
    }
    if (!nowHeart && wasHeart && post.fields['Posted At']) {
      await patchAirtableRecord('Posts', post.id, { 'Posted At': null, 'Status': 'Sent to Telegram' }, { typecast: true })
      console.log(`[tg-reactions] heart removed → back to buffer: ${post.fields['Post Name']}`)
      return NextResponse.json({ ok: true, marked: 'restored' })
    }
    return NextResponse.json({ ok: true, marked: 'noop' })
  } catch (e) {
    console.error('[tg-reactions]', e?.message || e)
    return NextResponse.json({ ok: true }) // always 200 so Telegram doesn't retry-storm
  }
}
