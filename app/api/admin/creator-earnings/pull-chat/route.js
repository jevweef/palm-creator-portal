import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { resolveFanId, fetchChatHistory, toParsedChat, createDataExport, waitForDataExport, downloadExportCsv, getDataExport, startDataExport, cancelDataExport, waitForExportEstimate } from '@/lib/onlyfansApi'
import { loadChatArchive, saveChatArchive, mergeMessages, saveChunkShard, finalizeChunks } from '@/lib/chatArchive'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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
    const { creatorRecordId, fanUsername, fanName, fanId, sinceDate, maxPages, fromArchive, confirmBig, acceptPartial, lifetime, light, chunked, cursor, finalize, complete, exportWindow, accountId: bodyAccountId } = await request.json()
    // Auto-spend scales with the fan's value: ~2% of lifetime in credits
    // (lifetime/50), floor 15, cap 250. A \$2,500 fan auto-approves 50cr;
    // a \$14k whale up to 250 (Evan: flat 150 was too much for a \$2,500 fan).
    const AUTO_SPEND_LIMIT = Math.max(15, Math.min(250, Math.round((Number(lifetime) || 0) / 50) || 15))
    if (!creatorRecordId || (!fanUsername && !fanName && !fanId)) {
      return NextResponse.json({ error: 'creatorRecordId and fanUsername, fanName, or fanId required' }, { status: 400 })
    }

    // Creator → connected OF API account
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    // Multi-account creators (Taby Free+VIP) store comma-separated ids — the
    // raw field in a URL 404s everything (the audit false-Deleted disaster).
    // A fan's chat lives on ONE page: probe each account for him, then keep
    // using that account (chunk clients echo it back via body.accountId).
    const accountIds = String(creators[0]?.fields?.['OF API Account ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
    let accountId = accountIds.includes(bodyAccountId) ? bodyAccountId : accountIds[0]
    if (!accountId) {
      return NextResponse.json({
        error: `${creators[0]?.fields?.AKA || 'This creator'} isn't connected to the OnlyFans API yet — connect her account at app.onlyfansapi.com, then set 'OF API Account ID' on her Palm Creators record.`,
      }, { status: 400 })
    }

    const creatorName = creators[0]?.fields?.Creator || creators[0]?.fields?.AKA || ''

    // ── Incremental: the Dropbox archive remembers what we already have ─────
    // (0 credits to read). We only fetch messages NEWER than its last message,
    // and the archived fanId skips the resolveFanId lookup on repeat pulls.
    // Cursor chunks and finalize NEVER read the merged archive here — that
    // multi-MB read per request is exactly what made big pulls time out.
    // (finalizeChunks does its own single read; cursor chunks get fanId from
    // the client.)
    const archive = ((chunked && cursor) || finalize) ? null : await loadChatArchive(creatorName, fanName, fanUsername)

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
        historyComplete: !!archive.historyComplete,
        coverage: {
          oldestMessageAt: archive.messages[0]?.createdAt || null,
          newestMessageAt: archive.messages[archive.messages.length - 1]?.createdAt || null,
          historyComplete: !!archive.historyComplete,
        },
      })
    }

    let fan
    if (archive?.fanId) {
      fan = { id: archive.fanId, username: archive.fanUsername || fanUsername, name: archive.fanName || fanName }
    } else if (fanId) {
      // Known OF fan id (from the sheet / audit) — no lookup needed. Covers
      // dormant fans with no username (deleted accounts, pre-lookup rows).
      fan = { id: String(fanId), username: fanUsername || '', name: fanName || '' }
    } else {
      for (const acc of accountIds) {
        fan = await resolveFanId(acc, { username: fanUsername, name: fanName }).catch(() => null)
        if (fan?.id) { accountId = acc; break }
      }
      if (!fan) {
        const plural = accountIds.length > 1 ? `any of her ${accountIds.length} OF accounts` : 'this OF account'
        return NextResponse.json({ error: `Couldn't find "${fanUsername || fanName}" on ${plural}${fanUsername ? ' — a 404 on a known @username almost always means he DELETED his OF account (his chat is gone with it)' : ' — he may have been renamed; try pulling from his fan card after a fresh audit'}` }, { status: 404 })
      }
    }

    // Fan known but account not yet pinned (archive/audit fanId path) on a
    // multi-account creator: pin the page he actually lives on once, so chat
    // fetches don't quietly hit the wrong account.
    if (accountIds.length > 1 && !accountIds.includes(bodyAccountId) && (fan?.username || fanUsername || fanName)) {
      for (const acc of accountIds) {
        const hit = await resolveFanId(acc, { username: fan?.username || fanUsername, name: fan?.name || fanName }).catch(() => null)
        if (hit?.id) { accountId = acc; if (!fan?.id) fan = hit; break }
      }
    }

    // Overlap the boundary by a minute — dedup by id makes it harmless.
    const since = archive?.lastMessageAt
      ? new Date(new Date(archive.lastMessageAt).getTime() - 60000).toISOString()
      : (sinceDate || null)

    // ── SHARD PROTOCOL (2026-07-07): timeout-proof by construction ──────────
    // Every chunk request does ONLY pagination + one small shard write — it
    // never reads or rewrites the (multi-MB) merged archive, so its runtime is
    // bounded no matter how big the fan's history gets. FINALIZE merges all
    // shards into messages.json once at the end.
    if (finalize) {
      const merged = await finalizeChunks(creatorName, fanName, fanUsername, {
        fanId: fanId || fan?.id || '', historyComplete: complete === true ? true : complete === false ? false : undefined,
      })
      if (!merged.messages.length) {
        return NextResponse.json({ error: 'No messages found in this chat' }, { status: 404 })
      }
      const parsedFin = light ? undefined : toParsedChat(merged.messages, merged.fanId)
      return NextResponse.json({
        parsed: parsedFin,
        fan: { id: merged.fanId, username: merged.fanUsername, name: merged.fanName },
        totalStored: merged.messages.length,
        historyComplete: !!merged.historyComplete,
        coverage: {
          oldestMessageAt: merged.messages[0]?.createdAt || null,
          newestMessageAt: merged.messages[merged.messages.length - 1]?.createdAt || null,
          historyComplete: !!merged.historyComplete,
        },
        pulledAt: merged.updatedAt,
      })
    }

    if (chunked) {
      // ── DORMANT-FAN TARGETED EXPORT ────────────────────────────────────────
      // Walking backward through a dead fan's chat wastes credits on months of
      // unanswered mass blasts (Chris: 83cr of blasts, never reached his
      // spending era). When the client passes exportWindow {start,end} (his
      // buying period from the sheet), use a chat EXPORT instead: date-bounded,
      // skipMassMessages, chatIds-scoped — only his REAL conversation, only
      // the months that matter. Runs async at OF; each chunk call polls status
      // (free) so the client loop stays timeout-proof.
      if (exportWindow?.start) {
        const arcX = await loadChatArchive(creatorName, fanName, fanUsername)
        const pendingId = arcX?.pendingExportId || null
        if (pendingId) {
          const st = await getDataExport(pendingId).catch(() => null)
          if (st?.status === 'completed') {
            const csv = await downloadExportCsv(st)
            const got = csvToMessages(csv)
            if (got.length) await saveChunkShard(creatorName, fanName, fanUsername, got)
            await saveChatArchive(creatorName, fanName, fanUsername, { ...arcX, pendingExportId: null, updatedAt: new Date().toISOString() })
            return NextResponse.json({ fan, accountId, pages: 0, credits: st.credit_cost ?? Math.ceil(got.length / 20), capCredits: AUTO_SPEND_LIMIT, fetchedCount: got.length, storedCount: arcX?.messages?.length || 0, oldestAt: got[0]?.createdAt || null, morePages: false, historyComplete: true })
          }
          if (st && !['failed', 'cancelled'].includes(st.status)) {
            const projected = st.credit_cost ?? (st.total_rows != null ? Math.ceil(st.total_rows / 20) : null)
            if (projected != null && projected > AUTO_SPEND_LIMIT && !confirmBig) {
              await cancelDataExport(pendingId).catch(() => {})
              await saveChatArchive(creatorName, fanName, fanUsername, { ...arcX, pendingExportId: null, updatedAt: new Date().toISOString() })
              return NextResponse.json({
                needsConfirm: true, estimatedCredits: projected, estimatedMessages: st.total_rows ?? null,
                error: `His spending-era export is ~${st.total_rows?.toLocaleString?.() || '?'} messages ≈ ${projected} credits (cap ${AUTO_SPEND_LIMIT}) — cancelled free. Approve below to pull it anyway.`,
              }, { status: 402 })
            }
            return NextResponse.json({ fan, accountId, pages: 0, credits: 0, capCredits: AUTO_SPEND_LIMIT, fetchedCount: 0, storedCount: arcX?.messages?.length || 0, oldestAt: null, morePages: true, waiting: true, progress: st.progress_percentage ?? 0, rowsFound: st.total_rows ?? null })
          }
          // failed/cancelled — clear and start fresh below
          await saveChatArchive(creatorName, fanName, fanUsername, { ...arcX, pendingExportId: null, updatedAt: new Date().toISOString() })
        }
        const exp = await createDataExport({
          type: 'chat_messages',
          accountIds: [accountId],
          startDate: new Date(exportWindow.start).toISOString().slice(0, 19) + 'Z',
          endDate: new Date(exportWindow.end || Date.now()).toISOString().slice(0, 19) + 'Z',
          options: { chatIds: [Number(fan.id)], maxMessages: 1000000, skipMassMessages: true },
        })
        const stub = arcX || { fanId: String(fan.id), fanUsername: fan.username || '', fanName: fan.name || '', messages: [], lastMessageAt: null, lastMessageId: null, historyComplete: false }
        await saveChatArchive(creatorName, fanName, fanUsername, { ...stub, pendingExportId: exp?.id || null, updatedAt: new Date().toISOString() })
        return NextResponse.json({ fan, accountId, pages: 0, credits: 0, capCredits: AUTO_SPEND_LIMIT, fetchedCount: 0, storedCount: stub.messages.length, oldestAt: null, morePages: true, waiting: true, progress: 0 })
      }

      const deadline = Date.now() + 45000
      const budget = Math.min(Number(maxPages) || 25, 30)
      let fresh = [], pages = 0, credits = 0, reachedStart = false
      let storedCount = 0
      let backCursor = cursor || null
      if (!cursor) {
        // FIRST chunk: one archive read to find where to resume + what's new.
        const arc0 = await loadChatArchive(creatorName, fanName, fanUsername)
        storedCount = arc0?.messages?.length || 0
        if (arc0?.historyComplete && !acceptPartial) reachedStart = true
        if (arc0?.pendingExportId) { try { await cancelDataExport(arc0.pendingExportId) } catch {} }
        if (arc0?.lastMessageAt) {
          const fwd = await fetchChatHistory(accountId, fan.id, {
            sinceDate: new Date(new Date(arc0.lastMessageAt).getTime() - 60000).toISOString(),
            maxPages: 10, deadline,
          })
          fresh = fresh.concat(fwd.messages); pages += fwd.pages; credits += fwd.credits
        }
        backCursor = arc0?.messages?.[0]?.id ?? null
      }
      if (!reachedStart && pages < budget) {
        const back = await fetchChatHistory(accountId, fan.id, {
          maxPages: budget - pages, startCursor: backCursor, deadline,
        })
        fresh = fresh.concat(back.messages); pages += back.pages; credits += back.credits
        if (back.messages.length) backCursor = back.messages[0].id
        // Only a real empty/terminal page means the chat start; a deadline
        // stop mid-run must NOT be mistaken for completion.
        if (back.complete && Date.now() <= deadline) reachedStart = true
      }
      if (fresh.length) await saveChunkShard(creatorName, fanName, fanUsername, fresh)
      return NextResponse.json({
        fan, accountId, cursor: backCursor, pages, credits: credits || pages, capCredits: AUTO_SPEND_LIMIT,
        fetchedCount: fresh.length, storedCount,
        oldestAt: fresh[0]?.createdAt || null,
        morePages: !reachedStart, historyComplete: reachedStart,
      })
    }

    // ── Fetch strategy v3 (2026-07-07): PAGINATED, CHUNKED ──────────────────
    // OF-side chat exports proved unreliable (stuck for hours at 0-2%) and
    // pagination is cheaper anyway (1 credit/request, ~50-100 msgs/page vs
    // 1 credit/20 export rows). Each request does at most CHUNK_PAGES pages so
    // it never hits the function timeout; the response says morePages and the
    // client loops — live progress, no dead ends:
    //   newer: top-up since lastMessageAt (always, a few pages)
    //   older: deepen backward from the oldest stored message
    let fresh = [], pages = 0, credits = 0
    let historyComplete = archive ? !!archive.historyComplete : false

    // Legacy: a previous run may have parked an export on the archive.
    // Completed → ingest it (already paid, download is free). Anything else →
    // cancel it (free before completion) and continue with pagination.
    if (archive?.pendingExportId) {
      try {
        const pending = await getDataExport(archive.pendingExportId)
        if (pending?.status === 'completed') {
          const csv = await downloadExportCsv(pending)
          fresh = fresh.concat(csvToMessages(csv))
        } else if (pending?.status && !['failed', 'cancelled'].includes(pending.status)) {
          await cancelDataExport(archive.pendingExportId).catch(() => {})
        }
      } catch { /* stale id — ignore */ }
      archive.pendingExportId = null
    }

    // "Keep recent only": accept the partial archive as complete so every
    // future pull is a cheap top-up.
    if (acceptPartial && archive) {
      archive.historyComplete = true
      historyComplete = true
    }

    const CHUNK_PAGES = Math.min(Number(maxPages) || 25, 40)
    // Hard time-box on pagination: flaky upstream pages + retries can push a
    // chunk past the gateway window (batch saw 504s) — stop at ~60s and hand
    // back a partial chunk; the client loop simply continues.
    const deadline = Date.now() + 60000

    // 1) newer messages since the last pull
    if (archive?.lastMessageAt) {
      const fwd = await fetchChatHistory(accountId, fan.id, { sinceDate: since, maxPages: 10, deadline })
      fresh = fresh.concat(fwd.messages); pages += fwd.pages; credits += fwd.credits
    }

    // 2) deepen backward while this chunk's budget remains
    if (!historyComplete && pages < CHUNK_PAGES) {
      const back = await fetchChatHistory(accountId, fan.id, {
        maxPages: CHUNK_PAGES - pages,
        startCursor: archive?.messages?.[0]?.id ?? null,
        deadline,
      })
      fresh = fresh.concat(back.messages); pages += back.pages; credits += back.credits
      if (back.complete) historyComplete = true
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

    const coverage = {
      oldestMessageAt: merged[0]?.createdAt || null,
      newestMessageAt: merged[merged.length - 1]?.createdAt || null,
      historyComplete,
    }
    // light: mid-loop chunks skip the parsed payload (an 11k-message parse is
    // ~MBs) — the client asks for parsed only on its final call.
    const parsed = light ? undefined : toParsedChat(merged, fan.id)
    console.log(`[pull-chat] ${accountId} fan ${fan.id} (${fan.username || fan.name}): ${merged.length} total (${added} new), ${pages} pages, ~${credits || pages} credits, complete=${historyComplete}`)
    return NextResponse.json({ parsed, fan, accountId, pages, credits: credits || pages, capCredits: AUTO_SPEND_LIMIT, newMessages: added, totalStored: merged.length, incremental: !!archive, historyComplete, morePages: !historyComplete, coverage, pulledAt: new Date().toISOString() })
  } catch (err) {
    console.error('[pull-chat] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
