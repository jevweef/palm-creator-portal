import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { resolveFanId, fetchChatHistory, toParsedChat, createDataExport, waitForDataExport, downloadExportCsv, getDataExport, startDataExport, cancelDataExport, waitForExportEstimate } from '@/lib/onlyfansApi'
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
// Map export CSV rows → the raw message shape toParsedChat/mergeMessages use.
function csvToMessages(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const split = (line) => {
    const out = []; let cur = ''; let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
      else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur); return out
  }
  const headers = split(lines[0])
  return lines.slice(1).map((l) => {
    const r = Object.fromEntries(headers.map((h, i) => [h, split(l)[i] ?? '']))
    if (!r.message_id) return null
    const created = (r.onlyfans_created_at || '').trim()
    return {
      id: r.message_id,
      text: r.message_text || '',
      price: parseFloat(r.price || '0') || 0,
      isOpened: r.is_opened === 'true' || r.is_opened === '1',
      isTip: r.is_tip === 'true' || r.is_tip === '1',
      tipAmount: parseFloat(r.tip_amount || '0') || 0,
      isFromQueue: r.is_from_queue === 'true' || r.is_from_queue === '1',
      mediaCount: parseInt(r.media_count || '0', 10) || 0,
      isSentByMe: r.sent_by === 'creator',
      fromUser: { id: r.sent_by === 'creator' ? 0 : (r.fan_id || '') },
      createdAt: created ? (created.includes('T') ? created : created.replace(' ', 'T') + (created.includes('+') ? '' : 'Z')) : null,
    }
  }).filter(Boolean)
}

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
    const { creatorRecordId, fanUsername, fanName, sinceDate, maxPages, fromArchive, confirmBig, acceptPartial } = await request.json()
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

    // ── Fetch strategy (per onlyfansapi support, 2026-07-04) ────────────────
    // BACKFILL (no archive, or archive known-incomplete): a chat_messages
    // DATA EXPORT scoped to this fan via options.chatIds — guaranteed
    // 1 credit / 20 messages, complete history in one shot, no page-trickle
    // (the live endpoint returns 8-90 msgs/page but bills per REQUEST) and
    // no 40-page truncation. TOP-UP (archive complete): the paginated
    // endpoint with sinceDate — 1-3 credits.
    let fresh = [], pages = 0, credits = 0
    let lastExportId = null
    let historyComplete = archive ? !!archive.historyComplete : false

    // A previous pull may have left a big export still running — ATTACH to it
    // instead of starting (and paying for) a second one.
    if (archive?.pendingExportId) {
      try {
        const pending = await getDataExport(archive.pendingExportId)
        if (pending?.status === 'completed') {
          const csv = await downloadExportCsv(pending)
          const got = csvToMessages(csv)
          const { merged: m2 } = mergeMessages(archive.messages, got)
          const last2 = m2[m2.length - 1]
          await saveChatArchive(creatorName, fanName, fanUsername, {
            fanId: String(archive.fanId), fanUsername: archive.fanUsername || '', fanName: archive.fanName || '',
            lastMessageAt: last2?.createdAt || null, lastMessageId: last2?.id ?? null,
            historyComplete: true, pendingExportId: null,
            updatedAt: new Date().toISOString(), messages: m2,
          })
          const parsed2 = toParsedChat(m2, archive.fanId)
          return NextResponse.json({ parsed: parsed2, fan: { id: archive.fanId, username: archive.fanUsername, name: archive.fanName }, pages: 0, credits: pending.credit_cost ?? 0, newMessages: m2.length - archive.messages.length, totalStored: m2.length, incremental: true, historyComplete: true, pulledAt: new Date().toISOString() })
        }
        if (pending?.status && !['failed', 'cancelled'].includes(pending.status)) {
          // Same cost gate on the way back in: if the running export has
          // grown past the limit and the user hasn't confirmed, cancel it
          // (free until completion) and ask.
          const projected = pending.credit_cost ?? (pending.total_rows != null ? Math.ceil(pending.total_rows / 20) : null)
          if (projected != null && projected > 150 && !confirmBig) {
            await cancelDataExport(archive.pendingExportId)
            try { await saveChatArchive(creatorName, fanName, fanUsername, { ...archive, pendingExportId: null, updatedAt: new Date().toISOString() }) } catch {}
            return NextResponse.json({
              needsConfirm: true, estimatedCredits: projected, estimatedMessages: pending.total_rows ?? null,
              error: `His history export reached ~${pending.total_rows?.toLocaleString?.() || '?'} messages ≈ ${projected} credits — cancelled before billing. Confirm to re-run it, or keep recent-only.`,
            }, { status: 402 })
          }
          return NextResponse.json({ error: `His full history export is still running at OF (${pending.progress_percentage ?? 0}% of ${pending.total_rows ?? '?'} rows) — try again in a few minutes. No credits spent on this click.` }, { status: 202 })
        }
      } catch { /* stale pending id — fall through to a fresh backfill */ }
    }

    // "Keep recent only": Evan declined a pricey full-history export — accept
    // the partial archive as complete so every future pull is a cheap top-up.
    if (acceptPartial && archive) {
      archive.historyComplete = true
      archive.pendingExportId = null
    }

    if (!archive || !archive.historyComplete) {
      try {
        // NEVER re-buy messages we already have (exports bill per row):
        // export ONLY the missing OLDER window — from 2 years back up to the
        // archive's oldest stored message (+1 day of dedup overlap). Fans
        // with no archive get the full window.
        const startIso = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 19) + 'Z'
        let endIso = new Date().toISOString().slice(0, 19) + 'Z'
        const oldestStored = archive?.messages?.[0]
        if (oldestStored?.createdAt) {
          endIso = new Date(new Date(oldestStored.createdAt).getTime() + 86400000).toISOString().slice(0, 19) + 'Z'
        }
        if (new Date(endIso) <= new Date(startIso)) {
          // Archive already reaches the 2-year horizon — nothing older to buy.
          historyComplete = true
        } else {
          // Cost gate: chat exports only reveal their size once scraping
          // starts (pre-start estimates come back null). So: start, PEEK at
          // the discovered row count, and CANCEL (proven free mid-scrape) if
          // it's over the limit and unconfirmed. Billing happens only at
          // completion, so we get the whole scrape window to bail.
          const AUTO_SPEND_LIMIT = 150
          const exp = await createDataExport({
            type: 'chat_messages',
            accountIds: [accountId],
            startDate: startIso,
            endDate: endIso,
            options: { chatIds: [Number(fan.id)], maxMessages: 1000000 },
          })
          lastExportId = exp?.id || null
          let est = null
          for (let i = 0; i < 15; i++) {
            est = await getDataExport(exp.id)
            if (est?.total_rows != null || est?.status === 'completed' || est?.failed_at) break
            await new Promise((r) => setTimeout(r, 6000))
          }
          const estCredits = est?.credit_cost ?? (est?.total_rows != null ? Math.ceil(est.total_rows / 20) : null)
          if (estCredits != null && estCredits > AUTO_SPEND_LIMIT && !confirmBig && est?.status !== 'completed') {
            await cancelDataExport(exp.id)
            return NextResponse.json({
              needsConfirm: true,
              estimatedCredits: estCredits,
              estimatedMessages: est?.total_rows ?? null,
              error: `This fan's history is ~${est?.total_rows?.toLocaleString?.() || '?'}+ messages ≈ ${estCredits}+ credits. Confirm to pull it, or keep recent-only.`,
            }, { status: 402 })
          }
          const done = est?.status === 'completed' ? est : await waitForDataExport(exp.id, { maxWaitMs: 170000 })
          const csv = await downloadExportCsv(done)
          fresh = csvToMessages(csv)
          credits = done.credit_cost ?? Math.ceil(fresh.length / 20)
          historyComplete = true
        }
        // Front end of the thread: new messages since the last pull — cheap
        // paginated top-up (only when an archive exists; first pulls covered
        // everything via the export window above).
        if (archive?.lastMessageAt) {
          const fwd = await fetchChatHistory(accountId, fan.id, { sinceDate: since, maxPages: 20 })
          fresh = fresh.concat(fwd.messages)
          pages += fwd.pages
          credits += fwd.credits
        }
      } catch (e) {
        // Big threads outlive the wait — the export keeps running at OF. Park
        // its id on the archive so the NEXT click attaches to it (no second
        // export, no pagination burn), and tell the user to come back.
        if (/timed out/i.test(e.message) && lastExportId) {
          const stub = archive || { fanId: String(fan.id), fanUsername: fan.username || '', fanName: fan.name || '', messages: [], lastMessageAt: null, lastMessageId: null }
          try {
            await saveChatArchive(creatorName, fanName, fanUsername, { ...stub, historyComplete: false, pendingExportId: lastExportId, updatedAt: new Date().toISOString() })
          } catch {}
          return NextResponse.json({ error: 'His chat history is big — OF is still building the export. Try again in a few minutes; the next click will pull it in (already paid for, no double charge).' }, { status: 202 })
        }
        console.warn('[pull-chat] export backfill failed, falling back to pagination:', e.message)
        const fb = await fetchChatHistory(accountId, fan.id, { sinceDate: since, maxPages: Math.min(Number(maxPages) || 40, 80) })
        fresh = fb.messages; pages = fb.pages; credits = fb.credits
        historyComplete = archive ? !!archive.historyComplete : fb.complete
      }
    } else {
      const fwd = await fetchChatHistory(accountId, fan.id, { sinceDate: since, maxPages: Math.min(Number(maxPages) || 40, 80) })
      fresh = fwd.messages; pages = fwd.pages; credits = fwd.credits
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
        historyComplete, pendingExportId: null,
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
