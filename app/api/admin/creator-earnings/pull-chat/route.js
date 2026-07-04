import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { resolveFanId, fetchChatHistory, toParsedChat } from '@/lib/onlyfansApi'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST — pull a fan's chat straight from OnlyFans (via onlyfansapi.com) and
// return it in the EXACT shape the whale-analysis pipeline consumes (the same
// parsed fields FansPanel produces client-side from an HTML upload). Replaces
// the scroll-the-chat → save HTML → upload dance. Read-only.
//
// Body: { creatorRecordId, fanUsername?, fanName?, sinceDate?, maxPages? }
// Returns: { parsed: {conversation, messages, ...}, fan: {id, username, name},
//            pages, credits }
export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (role !== 'admin' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  try {
    const { creatorRecordId, fanUsername, fanName, sinceDate, maxPages } = await request.json()
    if (!creatorRecordId || (!fanUsername && !fanName)) {
      return NextResponse.json({ error: 'creatorRecordId and fanUsername or fanName required' }, { status: 400 })
    }

    // Creator → connected OF API account
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const accountId = String(creators[0]?.fields?.['OF API Account ID'] || '').split(',')[0].trim()
    if (!accountId) {
      return NextResponse.json({
        error: `${creators[0]?.fields?.AKA || 'This creator'} isn't connected to the OnlyFans API yet — connect her account at app.onlyfansapi.com, then set 'OF API Account ID' on her Palm Creators record.`,
      }, { status: 400 })
    }

    // Fan username/name → OF user id
    const fan = await resolveFanId(accountId, { username: fanUsername, name: fanName })
    if (!fan) {
      return NextResponse.json({ error: `Couldn't find fan "${fanUsername || fanName}" on this OF account` }, { status: 404 })
    }

    // Pull history (capped pages = capped credits; ~1 credit per page)
    const { messages, pages, credits } = await fetchChatHistory(accountId, fan.id, {
      sinceDate: sinceDate || null,
      maxPages: Math.min(Number(maxPages) || 40, 80),
    })
    if (!messages.length) {
      return NextResponse.json({ error: 'No messages found in this chat' }, { status: 404 })
    }

    const parsed = toParsedChat(messages, fan.id)
    console.log(`[pull-chat] ${accountId} fan ${fan.id} (${fan.username || fan.name}): ${parsed.messageCount} msgs, ${pages} pages, ~${credits || pages} credits`)
    return NextResponse.json({ parsed, fan, pages, credits: credits || pages })
  } catch (err) {
    console.error('[pull-chat] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
