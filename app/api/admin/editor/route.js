export const maxDuration = 60

import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { waitUntil } from '@vercel/functions'
import { requireAdminOrEditor, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { sendPushToAdmins } from '@/lib/sendPushNotifications'
import { triggerAssetMirror } from '@/lib/triggerMirror'

// Build a snapshot of who pressed submit (Clerk identity at the moment of save).
// Stored on the Task record so the submissions feed can render an avatar +
// name without doing a live Clerk lookup per row.
async function getSubmitterSnapshot() {
  try {
    const u = await currentUser()
    if (!u) return null
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
      || u.fullName
      || u.username
      || u.emailAddresses?.[0]?.emailAddress
      || ''
    return {
      'Submitted By ID': u.id,
      'Submitted By Name': name,
      'Submitted By Avatar': u.imageUrl || u.profileImageUrl || '',
    }
  } catch {
    return null
  }
}

// Status mapping: Task Status → Asset Pipeline Status
const TASK_TO_ASSET_STATUS = {
  'In Progress': 'In Editing',
  'Done': 'In Review',
}

// Posting slots: 11 AM and 7 PM Eastern (DST-aware)
const SLOT_HOURS_ET = [11, 19]

// Convert an ET date string + ET hour to a UTC Date, accounting for DST
function etToUTC(etDateStr, etHour) {
  const [year, month, day] = etDateStr.split('-').map(Number)
  // Use noon UTC on that day as a DST-safe reference point
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12))
  const etHourAtNoon = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      hour12: false,
    }).format(noonUTC)
  )
  const offset = 12 - etHourAtNoon // 4 for EDT, 5 for EST
  return new Date(Date.UTC(year, month - 1, day, etHour + offset))
}

// Returns the next available posting slot starting from the ET day the editor submitted.
// existingSlotISOs: all Scheduled Date ISO strings already claimed for this creator.
// submissionISO: task's Completed At (when editor submitted) — determines the target ET day.
// Checks exact slot times so a far-future post doesn't block filling today's empty slots.
function getNextPostingSlot(existingSlotISOs, submissionISO) {
  const existingSet = new Set((existingSlotISOs || []).map(s => new Date(s).toISOString()))

  const now = new Date()
  const submission = submissionISO ? new Date(submissionISO) : now

  // Start from the submission's ET date (the task's day), never earlier than today
  const startFrom = submission > now ? submission : now
  const startDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(startFrom)
  const [sy, sm, sd] = startDateStr.split('-').map(Number)

  for (let dayOffset = 0; dayOffset <= 365; dayOffset++) {
    const iterDate = new Date(Date.UTC(sy, sm - 1, sd + dayOffset))
    const etDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
    }).format(iterDate)

    for (const etHour of SLOT_HOURS_ET) {
      const candidate = etToUTC(etDateStr, etHour)
      // Skip past DAYS entirely, but allow any slot within today
      // (morning slot stays open even if it's afternoon — day ends at midnight ET)
      if (etDateStr < startDateStr) continue
      if (!existingSet.has(candidate.toISOString())) return candidate
    }
  }
  return null
}

// Admin review actions
const ADMIN_ACTIONS = ['approve', 'requestRevision']

// Editor group — set EDITOR_CHAT_ID and EDITOR_THREAD_ID in Vercel env vars
const EDITOR_CHAT_ID = parseInt(process.env.EDITOR_CHAT_ID || '-1003779148361')
const EDITOR_THREAD_ID = parseInt(process.env.EDITOR_THREAD_ID || '2')

async function sendRevisionTelegram({ creatorName, creatorId, inspoTitle, taskName, feedback, screenshotUrls }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) { console.warn('[Revision Telegram] TELEGRAM_BOT_TOKEN not set'); return }

  const assetName = (taskName || '').replace(/^Edit:\s*/i, '')
  const title = inspoTitle || assetName || 'Unknown task'
  const portalLink = creatorId ? `https://app.palm-mgmt.com/editor/${creatorId}` : null

  const caption = [
    `⚠️ Revision Needed`,
    ``,
    title,
    `Creator: ${creatorName || 'Unknown'}`,
    `File: ${assetName}`,
    ``,
    `Feedback:`,
    feedback,
    ...(portalLink ? [``, portalLink] : []),
  ].join('\n')

  try {
    const photoUrl = (screenshotUrls || [])[0]

    if (photoUrl) {
      // Send screenshot as photo with revision text as caption — one clean message
      const rawUrl = photoUrl.replace(/([?&])dl=[01]/, '$1raw=1')
      const imgRes = await fetch(rawUrl)
      if (!imgRes.ok) throw new Error(`Could not fetch screenshot: ${imgRes.status}`)
      const buffer = await imgRes.arrayBuffer()
      const form = new FormData()
      form.append('chat_id', String(EDITOR_CHAT_ID))
      form.append('message_thread_id', String(EDITOR_THREAD_ID))
      form.append('caption', caption.slice(0, 1024))
      form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'screenshot.jpg')
      const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
      const photoData = await photoRes.json()
      if (!photoData.ok) {
        console.warn('[Revision Telegram] sendPhoto failed:', photoData.description, '— falling back to text only')
        await sendRevisionText(token, EDITOR_CHAT_ID, EDITOR_THREAD_ID, caption)
      } else {
        console.log('[Revision Telegram] Photo + caption sent OK')
      }
    } else {
      await sendRevisionText(token, EDITOR_CHAT_ID, EDITOR_THREAD_ID, caption)
    }
  } catch (e) {
    console.error('[Revision Telegram] FAILED:', e.name, '|', e.message)
  }
}

async function sendRevisionText(token, chatId, threadId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_thread_id: threadId, text }),
  })
  const data = await res.json()
  if (!data.ok) console.warn('[Revision Telegram] sendMessage failed:', data.description)
  else console.log('[Revision Telegram] Text sent OK')
}

// Build OR formula for batch record lookup by ID
function recordIdFormula(ids) {
  if (!ids.length) return ''
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// GET — fetch editor task queue with joined inspo + creator + asset data
export async function GET() {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    // 1. Fetch active tasks — now with proper linked record fields
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: "OR({Status}='To Do',{Status}='In Progress')",
    })

    if (!tasks.length) {
      return NextResponse.json({ tasks: [], total: 0 })
    }

    // 2. Collect linked record IDs from tasks (proper linked records now)
    const assetIds = [...new Set(tasks.flatMap(t => t.fields?.Asset || []).filter(Boolean))]
    const creatorIds = [...new Set(tasks.flatMap(t => t.fields?.Creator || []).filter(Boolean))]
    const inspoIds = [...new Set(tasks.flatMap(t => t.fields?.Inspiration || []).filter(Boolean))]

    // 3. Batch-fetch all linked records in parallel
    const [assetRecords, creatorRecords, inspoRecords] = await Promise.all([
      assetIds.length ? fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(assetIds),
        fields: [
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Edited File Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Source Type', 'Thumbnail', 'CDN URL', 'Stream Edit ID', 'Stream Raw ID',
        ],
      }) : [],
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA', 'Status'],
      }) : [],
      inspoIds.length ? fetchAirtableRecords('Inspiration', {
        filterByFormula: recordIdFormula(inspoIds),
        fields: [
          'Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail', 'CDN URL',
          'Username', 'Audio Type', 'DB Share Link', 'Stream UID', 'Rating', 'On-Screen Text', 'Transcript',
          'Identified Song', 'Identified Song Data',
        ],
      }) : [],
    ])

    // 4. Build lookup maps
    const assetMap = Object.fromEntries(assetRecords.map(r => [r.id, r.fields]))
    const creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // Drop tasks whose linked creator has been offboarded — keeps the editor queue clean.
    const offboardedCreatorIds = new Set(
      creatorRecords.filter(r => (r.fields?.Status === 'Offboarded' || r.fields?.Status?.name === 'Offboarded')).map(r => r.id)
    )
    const visibleTasks = offboardedCreatorIds.size > 0
      ? tasks.filter(t => !((t.fields?.Creator || []).some(cid => offboardedCreatorIds.has(cid))))
      : tasks

    // 5. Assemble joined response
    const joinedTasks = visibleTasks.map(t => {
      const f = t.fields || {}
      const assetId = (f.Asset || [])[0] || null
      const creatorId = (f.Creator || [])[0] || null
      const inspoId = (f.Inspiration || [])[0] || null
      const asset = assetId ? (assetMap[assetId] || {}) : {}
      const creator = creatorId ? (creatorMap[creatorId] || {}) : {}
      const inspo = inspoId ? (inspoMap[inspoId] || {}) : {}

      return {
        id: t.id,
        name: f.Name || '',
        status: f.Status || 'To Do',
        creatorNotes: f['Creator Notes'] || '',
        editorNotes: f['Editor Notes'] || '',
        creator: {
          id: creatorId,
          name: creator.AKA || creator.Creator || '',
        },
        asset: {
          id: assetId,
          name: asset['Asset Name'] || '',
          pipelineStatus: asset['Pipeline Status'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          dropboxLinks: (asset['Dropbox Shared Link'] || '').split('\n').filter(Boolean),
          editedFileLink: asset['Edited File Link'] || '',
          dropboxPath: asset['Dropbox Path (Current)'] || '',
          creatorNotes: asset['Creator Notes'] || '',
          sourceType: asset['Source Type'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          cdnUrl: asset['CDN URL'] || null,
          streamEditId: asset['Stream Edit ID'] || null,
          streamRawId: asset['Stream Raw ID'] || null,
        },
        inspo: {
          id: inspoId,
          title: inspo.Title || '',
          notes: inspo.Notes || '',
          tags: inspo.Tags || [],
          filmFormat: inspo['Film Format'] || [],
          contentLink: inspo['Content link'] || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          cdnUrl: inspo['CDN URL'] || null,
          username: inspo.Username || '',
          audioType: inspo['Audio Type'] || '',
          dbShareLink: inspo['DB Share Link'] || '',
          streamUid: inspo['Stream UID'] || null,
          rating: inspo.Rating || null,
          onScreenText: inspo['On-Screen Text'] || '',
          transcript: inspo.Transcript || '',
          identifiedSong: inspo['Identified Song'] || '',
          identifiedSongData: (() => { try { return JSON.parse(inspo['Identified Song Data'] || 'null') } catch { return null } })(),
        },
      }
    })

    // Sort: In Progress first, then To Do
    joinedTasks.sort((a, b) => {
      const order = { 'In Progress': 0, 'To Do': 1 }
      return (order[a.status] ?? 2) - (order[b.status] ?? 2)
    })

    return NextResponse.json({ tasks: joinedTasks, total: joinedTasks.length })
  } catch (err) {
    console.error('[Editor] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — update task + asset status, or admin review actions
export async function PATCH(request) {
  try {
    await requireAdminOrEditor()
  } catch (e) { return e }

  try {
    const body = await request.json()
    const { taskId, newStatus, editedFileLink, editedFilePath, editorNotes, isRevision, action, adminFeedback, adminScreenshotUrls } = body

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    }

    // Fetch the task to get linked Asset ID
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: `RECORD_ID()='${taskId}'`,
    })
    if (!tasks.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const assetId = (tasks[0].fields?.Asset || [])[0] || null

    // ── Admin: Approve ──────────────────────────────────────────────────────────
    if (action === 'approve') {
      await patchAirtableRecord('Tasks', taskId, { 'Admin Review Status': 'Approved' })

      // Auto-create a Post record for prep
      let scheduledDate = null
      try {
        const task = tasks[0]
        const creatorId = (task.fields?.Creator || [])[0] || null
        const taskName = task.fields?.Name || ''
        const assetName = taskName.replace(/^Edit:\s*/i, '')

        // Fetch creator AKA for post name
        let creatorAKA = ''
        if (creatorId) {
          const creators = await fetchAirtableRecords('Palm Creators', {
            filterByFormula: `RECORD_ID()='${creatorId}'`,
            fields: ['AKA', 'Creator'],
          })
          creatorAKA = creators[0]?.fields?.AKA || creators[0]?.fields?.Creator || ''
        }

        const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const postName = [creatorAKA, assetName || dateStr].filter(Boolean).join(' – ')

        // Find next open posting slot for this creator, anchored to submission ET day
        try {
          const allRecentPosts = await fetchAirtableRecords('Posts', {
            filterByFormula: `IS_AFTER({Scheduled Date}, DATEADD(NOW(), -30, 'days'))`,
            fields: ['Scheduled Date', 'Creator'],
          })
          const creatorPosts = allRecentPosts.filter(p =>
            (p.fields?.Creator || []).includes(creatorId)
          )
          const existingSlotISOs = creatorPosts
            .map(p => p.fields?.['Scheduled Date'])
            .filter(Boolean)
          const submissionISO = tasks[0].fields?.['Completed At'] || null
          scheduledDate = getNextPostingSlot(existingSlotISOs, submissionISO)
        } catch (slotErr) {
          console.error('[Editor] Failed to compute posting slot:', slotErr.message)
        }

        await createAirtableRecord('Posts', {
          'Post Name': postName,
          ...(creatorId ? { 'Creator': [creatorId] } : {}),
          ...(assetId ? { 'Asset': [assetId] } : {}),
          'Task': [taskId],
          'Status': 'Prepping',
          ...(scheduledDate ? { 'Scheduled Date': scheduledDate.toISOString() } : {}),
        })
        console.log(`[Editor] Post record created for task ${taskId}`)
      } catch (postErr) {
        console.error('[Editor] Failed to create Post record:', postErr.message)
        // Don't fail the approval if post creation fails
      }

      return NextResponse.json({ ok: true, action: 'approve', scheduledDate: scheduledDate?.toISOString() || null })
    }

    // ── Admin: Request Revision ─────────────────────────────────────────────────
    if (action === 'requestRevision') {
      const taskUpdate = {
        'Admin Review Status': 'Needs Revision',
        'Status': 'In Progress',
      }
      if (adminFeedback) taskUpdate['Admin Feedback'] = adminFeedback
      if (adminScreenshotUrls?.length) {
        taskUpdate['Admin Screenshots'] = adminScreenshotUrls.map(url => ({ url }))
      }

      // Append this revision request to the task's Revision History so the
      // admin can see all prior feedback when reviewing a resubmission.
      // Active Admin Feedback gets cleared when the editor resubmits, but
      // Revision History is append-only and survives.
      try {
        const existingRaw = (tasks[0].fields?.['Revision History'] || '').trim()
        const history = existingRaw ? JSON.parse(existingRaw) : []
        history.push({
          date: new Date().toISOString(),
          feedback: adminFeedback || '',
          screenshots: adminScreenshotUrls || [],
        })
        taskUpdate['Revision History'] = JSON.stringify(history)
      } catch (e) {
        // Corrupt history JSON — start fresh with just this entry rather
        // than blocking the revision request.
        console.warn(`[Editor] Could not parse Revision History for ${taskId}, starting fresh:`, e.message)
        taskUpdate['Revision History'] = JSON.stringify([{
          date: new Date().toISOString(),
          feedback: adminFeedback || '',
          screenshots: adminScreenshotUrls || [],
        }])
      }

      await patchAirtableRecord('Tasks', taskId, taskUpdate)
      if (assetId) {
        await patchAirtableRecord('Assets', assetId, { 'Pipeline Status': 'In Editing' })
      }
      console.log(`[Editor] Task ${taskId} sent back for revision`)

      // Send Telegram notification to editor in the background. The fetch
      // chain (Dropbox screenshot → buffer → Telegram sendPhoto) can run
      // 5–15s on a phone-sized PNG, which is enough to bump up against the
      // function timeout and trip a Vercel HTML error page instead of our
      // JSON response. waitUntil lets the response return immediately while
      // Vercel keeps the function warm for the Telegram round-trip.
      const task = tasks[0]
      const creatorId = (task.fields?.Creator || [])[0] || null
      const inspoId = (task.fields?.Inspiration || [])[0] || null
      const taskName = task.fields?.Name || ''
      const telegramWork = (async () => {
        let creatorName = '', inspoTitle = ''
        try {
          const [creatorRecs, inspoRecs] = await Promise.all([
            creatorId ? fetchAirtableRecords('Palm Creators', { filterByFormula: `RECORD_ID()='${creatorId}'`, fields: ['AKA', 'Creator'] }) : [],
            inspoId ? fetchAirtableRecords('Inspiration', { filterByFormula: `RECORD_ID()='${inspoId}'`, fields: ['Title'] }) : [],
          ])
          creatorName = creatorRecs[0]?.fields?.AKA || creatorRecs[0]?.fields?.Creator || ''
          inspoTitle = inspoRecs[0]?.fields?.Title || ''
        } catch (e) {
          console.warn('[Revision Telegram] Failed to fetch creator/inspo names:', e.message)
        }
        await sendRevisionTelegram({ creatorName, creatorId, inspoTitle, taskName, feedback: adminFeedback, screenshotUrls: adminScreenshotUrls })
      })().catch(err => {
        console.warn('[Revision Telegram] background work failed:', err.message)
      })
      try { waitUntil(telegramWork) } catch { /* not in Vercel runtime — let it fire-and-forget */ }

      return NextResponse.json({ ok: true, action: 'requestRevision' })
    }

    // ── Editor: Start Editing / Submit ──────────────────────────────────────────
    if (!newStatus) {
      return NextResponse.json({ error: 'newStatus or action required' }, { status: 400 })
    }
    if (!TASK_TO_ASSET_STATUS[newStatus]) {
      return NextResponse.json({ error: `Invalid status: ${newStatus}` }, { status: 400 })
    }

    const taskUpdate = { Status: newStatus }
    if (newStatus === 'In Progress') {
      taskUpdate['Started At'] = new Date().toISOString()
    }
    if (newStatus === 'Done') {
      // Preserve original first-submit timestamp on revision resubmits.
      // Daily slots pin to the day a task was originally completed; bumping
      // Completed At on every save would shuffle a Sunday-completed task to
      // whatever day the revision resubmit happened, leaving a gap on Sunday
      // and an extra fill on the resubmit day.
      const existingCompletedAt = tasks[0]?.fields?.['Completed At'] || null
      taskUpdate['Completed At'] = existingCompletedAt || new Date().toISOString()
      taskUpdate['Admin Review Status'] = 'Pending Review'
      // Clear any previous revision feedback when resubmitting
      if (isRevision) taskUpdate['Admin Feedback'] = ''
      // Snapshot who pressed submit (could be the editor OR an admin filling
      // in for them) so the submissions feed can render an avatar.
      const submitter = await getSubmitterSnapshot()
      if (submitter) Object.assign(taskUpdate, submitter)
    }
    if (editorNotes) taskUpdate['Editor Notes'] = editorNotes
    await patchAirtableRecord('Tasks', taskId, taskUpdate)

    if (assetId) {
      const assetUpdate = { 'Pipeline Status': TASK_TO_ASSET_STATUS[newStatus] }
      if (editedFileLink) {
        assetUpdate['Edited File Link'] = editedFileLink
        // A new edited file means the old CF Stream copy is now stale — the
        // For Review card plays Stream Edit ID, so without this it would
        // keep showing the PREVIOUS revision's video even though Download
        // Edit (which uses Edited File Link) points to the new one. Clear
        // the UID so mirrorAsset's `!Stream Edit ID` guard re-uploads the
        // new file. The card falls back to its poster during the ~1min
        // transcode window, which is correct rather than wrong-video.
        assetUpdate['Stream Edit ID'] = ''
      }
      if (editedFilePath) assetUpdate['Edited File Path'] = editedFilePath
      await patchAirtableRecord('Assets', assetId, assetUpdate)

      // Re-mirror so the new edit lands on CF Stream. triggerAssetMirror
      // handles its own waitUntil — fire-and-forget here.
      if (editedFileLink) triggerAssetMirror(assetId)
    }

    // Push notification to admin when editor submits for review
    if (newStatus === 'Done') {
      const taskName = tasks[0]?.fields?.Name || ''
      const assetName = taskName.replace(/^Edit:\s*/i, '')
      await sendPushToAdmins({
        title: 'New Edit Ready for Review',
        body: assetName,
        url: '/admin/editor',
      })
    }

    console.log(`[Editor] Task ${taskId}: ${newStatus}, Asset ${assetId}: ${TASK_TO_ASSET_STATUS[newStatus]}`)
    return NextResponse.json({ ok: true, taskId, newStatus, assetPipelineStatus: TASK_TO_ASSET_STATUS[newStatus] })
  } catch (err) {
    console.error('[Editor] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
