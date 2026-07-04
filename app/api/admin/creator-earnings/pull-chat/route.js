import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { resolveFanId, fetchChatHistory, toParsedChat } from '@/lib/onlyfansApi'
import { loadChatArchive, saveChatArchive, mergeMessages } from '@/lib/chatArchive'

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
// GET — archive metadata for a fan (0 credits, Dropbox read): when we last
// pulled from OF, how many messages are stored, through what date. Feeds the
// "Last pulled from OF" line on the fan card.
export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const url = new URL(request.url)
    const creatorRecordId = url.searchParams.get('creatorRecordId') || ''
    const fanUsername = url.searchParams.get('fanUsername') || ''
    const fanName = url.searchParams.get('fanName') || ''
    if (!creatorRecordId || (!fanUsername && !fanName)) return NextResponse.json({ archive: null })
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA'],
    })
    const creatorName = creators[0]?.fields?.Creator || creators[0]?.fields?.AKA || ''
    const archive = await loadChatArchive(creatorName, fanName, fanUsername)
    if (!archive) return NextResponse.json({ archive: null })
    return NextResponse.json({
      archive: {
        historyComplete: !!archive.historyComplete,
        totalStored: archive.messages.length,
        firstMessageAt: archive.messages[0]?.createdAt || null,
        lastMessageAt: archive.lastMessageAt || null,
        pulledAt: archive.updatedAt || null,
      },
    })
  } catch { return NextResponse.json({ archive: null }) }
}

export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (role !== 'admin' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  try {
    const { creatorRecordId, fanUsername, fanName, sinceDate, maxPages, fromArchive } = await request.json()
    if (!creatorRecordId || (!fanUsername && !fanName)) {
      return NextResponse.json({ error: 'creatorRecordId and fanUsername or fanName required' }, { status: 400 })
    }

    // Creator → connected OF API account
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const accountId = creators[0]?.fields?.['OF API Account ID']
    if (!accountId) {
      return NextResponse.json({
        error: `${creators[0]?.fields?.AKA || 'This creator'} isn't connected to the OnlyFans API yet — connect her account at app.onlyfansapi.com, then set 'OF API Account ID' on her Palm Creators record.`,
      }, { status: 400 })
    }

    const creatorName = creators[0]?.fields?.Creator || creators[0]?.fields?.AKA || ''

    // ── Incremental: the Dropbox archive remembers what we already have ─────
    // (0 credits to read). We only fetch messages NEWER than its last message,
    // and the archived fanId skips the resolveFanId lookup on repeat pulls.
    const archive = await loadChatArchive(creatorName, fanName, fanUsername)

    // Load-from-archive: no API call, no credits — just parse what we have
    // (the Analyze button path for an already-pulled fan).
    if (fromArchive) {
      if (!archive?.messages?.length) {
        return NextResponse.json({ error: 'No archived chat for this fan yet — use Pull from OF first' }, { status: 404 })
      }
      const parsedArc = toParsedChat(archive.messages, archive.fanId)
      return NextResponse.json({
        parsed: parsedArc,
        fan: { id: archive.fanId, username: archive.fanUsername, name: archive.fanName },
        pages: 0, credits: 0, newMessages: 0, totalStored: archive.messages.length,
        incremental: true, pulledAt: archive.updatedAt || null,
      })
    }

    let fan
    if (archive?.fanId) {
      fan = { id: archive.fanId, username: archive.fanUsername || fanUsername, name: archive.fanName || fanName }
    } else {
      fan = await resolveFanId(accountId, { username: fanUsername, name: fanName })
      if (!fan) {
        return NextResponse.json({ error: `Couldn't find fan "${fanUsername || fanName}" on this OF account` }, { status: 404 })
      }
    }

    // Overlap the boundary by a minute — dedup by id makes it harmless.
    const since = archive?.lastMessageAt
      ? new Date(new Date(archive.lastMessageAt).getTime() - 60000).toISOString()
      : (sinceDate || null)

    const pageBudget = Math.min(Number(maxPages) || 40, 80)
    const fwd = await fetchChatHistory(accountId, fan.id, {
      sinceDate: since,
      maxPages: pageBudget,
    })
    let { messages: fresh, pages, credits } = fwd

    // Deepen truncated archives: long threads hit the page cap on their first
    // pull (the API trickles ~8-90 msgs/page), leaving the oldest history
    // missing. If the archive isn't marked complete, spend the remaining page
    // budget digging BACKWARD from the oldest stored message. Each successive
    // pull keeps chipping until the true thread start is reached.
    let historyComplete = archive ? !!archive.historyComplete : fwd.complete
    const oldestStored = archive?.messages?.[0]
    if (archive && !archive.historyComplete && oldestStored?.id && pages < pageBudget) {
      const deep = await fetchChatHistory(accountId, fan.id, {
        maxPages: pageBudget - pages,
        startCursor: oldestStored.id,
      })
      fresh = fresh.concat(deep.messages)
      pages += deep.pages
      credits += deep.credits
      historyComplete = deep.complete
    }

    const { merged, added } = mergeMessages(archive?.messages, fresh)
    if (!merged.length) {
      return NextResponse.json({ error: 'No messages found in this chat' }, { status: 404 })
    }

    // Persist the updated archive (non-fatal — the pull still works without it)
    const last = merged[merged.length - 1]
    try {
      await saveChatArchive(creatorName, fanName, fanUsername, {
        fanId: String(fan.id), fanUsername: fan.username || '', fanName: fan.name || '',
        lastMessageAt: last?.createdAt || null, lastMessageId: last?.id ?? null,
        historyComplete,
        updatedAt: new Date().toISOString(), messages: merged,
      })
    } catch (e) { console.warn('[pull-chat] archive save failed:', e.message) }

    // Parse the FULL archive — analysis always sees the whole conversation.
    const parsed = toParsedChat(merged, fan.id)
    console.log(`[pull-chat] ${accountId} fan ${fan.id} (${fan.username || fan.name}): ${parsed.messageCount} total (${added} new), ${pages} pages, ~${credits || pages} credits`)
    return NextResponse.json({ parsed, fan, pages, credits: credits || pages, newMessages: added, totalStored: merged.length, incremental: !!archive, historyComplete, pulledAt: new Date().toISOString() })
  } catch (err) {
    console.error('[pull-chat] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
