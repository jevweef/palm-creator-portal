import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { sendPushToAdmins } from '@/lib/sendPushNotifications'

// Status mapping: Task Status → Asset Pipeline Status
const TASK_TO_ASSET_STATUS = {
  'In Progress': 'In Editing',
  'Done': 'In Review',
}

// Posting slots: ~10 AM and ~7 PM Eastern (15:00 / 23:00 UTC)
// 15 UTC = 10 AM EST / 11 AM EDT — 23 UTC = 6 PM EST / 7 PM EDT
const SLOT_HOURS_UTC = [15, 23]

// Returns the next available 12 PM / 9 PM UTC slot after latestSlotISO (or now)
function getNextPostingSlot(latestSlotISO) {
  const now = new Date()
  const searchFrom = latestSlotISO
    ? new Date(Math.max(now.getTime(), new Date(latestSlotISO).getTime()))
    : now

  const startDay = new Date(searchFrom)
  startDay.setUTCHours(0, 0, 0, 0)

  for (let dayOffset = 0; dayOffset <= 365; dayOffset++) {
    for (const hour of SLOT_HOURS_UTC) {
      const candidate = new Date(startDay)
      candidate.setUTCDate(startDay.getUTCDate() + dayOffset)
      candidate.setUTCHours(hour, 0, 0, 0)
      if (candidate > searchFrom) return candidate
    }
  }
  return null
}

// Admin review actions
const ADMIN_ACTIONS = ['approve', 'requestRevision']

const EDITOR_CHAT_ID = -1003779148361
const EDITOR_THREAD_ID = 2

async function sendRevisionTelegram({ creatorName, inspoTitle, taskName, feedback, screenshotUrls }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) { console.warn('[Revision Telegram] TELEGRAM_BOT_TOKEN not set'); return }

  const assetName = (taskName || '').replace(/^Edit:\s*/i, '')
  const title = inspoTitle || assetName || 'Unknown task'

  const text = [
    `⚠️ *Revision Needed*`,
    ``,
    `*${title}*`,
    `Creator: ${creatorName || 'Unknown'}`,
    `File: ${assetName}`,
    ``,
    `*Feedback:*`,
    feedback,
  ].join('\n')

  try {
    // Send text message — check Telegram JSON body, not just HTTP status (Telegram always returns HTTP 200)
    const msgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: EDITOR_CHAT_ID,
        message_thread_id: EDITOR_THREAD_ID,
        text,
        parse_mode: 'Markdown',
      }),
    })
    const msgData = await msgRes.json()
    if (!msgData.ok) {
      console.warn('[Revision Telegram] sendMessage failed:', msgData.description, '| chat_id:', EDITOR_CHAT_ID, 'thread:', EDITOR_THREAD_ID)
    } else {
      console.log('[Revision Telegram] Text message sent OK')
    }

    // Send each screenshot as a photo
    for (const url of (screenshotUrls || [])) {
      try {
        const rawUrl = url.replace(/([?&])dl=[01]/, '$1raw=1')
        const imgRes = await fetch(rawUrl)
        if (!imgRes.ok) { console.warn('[Revision Telegram] Could not fetch screenshot:', rawUrl); continue }
        const buffer = await imgRes.arrayBuffer()
        const form = new FormData()
        form.append('chat_id', String(EDITOR_CHAT_ID))
        form.append('message_thread_id', String(EDITOR_THREAD_ID))
        form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'screenshot.jpg')
        const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
        const photoData = await photoRes.json()
        if (!photoData.ok) console.warn('[Revision Telegram] sendPhoto failed:', photoData.description)
        else console.log('[Revision Telegram] Photo sent OK')
      } catch (e) {
        console.warn('[Revision Telegram] Screenshot failed (non-fatal):', e.message)
      }
    }
  } catch (e) {
    console.warn('[Revision Telegram] Non-fatal error:', e.message)
  }
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
          'Asset Name', 'Pipeline Status', 'Dropbox Shared Link', 'Dropbox Path (Current)',
          'Creator Notes', 'Source Type', 'Thumbnail',
        ],
      }) : [],
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA'],
      }) : [],
      inspoIds.length ? fetchAirtableRecords('Inspiration', {
        filterByFormula: recordIdFormula(inspoIds),
        fields: [
          'Title', 'Notes', 'Tags', 'Film Format', 'Content link', 'Thumbnail',
          'Username', 'Audio Type', 'DB Share Link', 'Rating', 'On-Screen Text', 'Transcript',
        ],
      }) : [],
    ])

    // 4. Build lookup maps
    const assetMap = Object.fromEntries(assetRecords.map(r => [r.id, r.fields]))
    const creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    const inspoMap = Object.fromEntries(inspoRecords.map(r => [r.id, r.fields]))

    // 5. Assemble joined response
    const joinedTasks = tasks.map(t => {
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
          dropboxPath: asset['Dropbox Path (Current)'] || '',
          creatorNotes: asset['Creator Notes'] || '',
          sourceType: asset['Source Type'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          dropboxPath: asset['Dropbox Path (Current)'] || '',
        },
        inspo: {
          id: inspoId,
          title: inspo.Title || '',
          notes: inspo.Notes || '',
          tags: inspo.Tags || [],
          filmFormat: inspo['Film Format'] || [],
          contentLink: inspo['Content link'] || '',
          thumbnail: inspo.Thumbnail?.[0]?.thumbnails?.large?.url || inspo.Thumbnail?.[0]?.url || '',
          username: inspo.Username || '',
          audioType: inspo['Audio Type'] || '',
          dbShareLink: inspo['DB Share Link'] || '',
          rating: inspo.Rating || null,
          onScreenText: inspo['On-Screen Text'] || '',
          transcript: inspo.Transcript || '',
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

        // Find the latest future posting slot for this creator
        try {
          const futurePosts = await fetchAirtableRecords('Posts', {
            filterByFormula: `IS_AFTER({Scheduled Date}, NOW())`,
            fields: ['Scheduled Date', 'Creator'],
            sort: [{ field: 'Scheduled Date', direction: 'desc' }],
          })
          const creatorFuturePosts = futurePosts.filter(p =>
            (p.fields?.Creator || []).includes(creatorId)
          )
          const latestSlot = creatorFuturePosts[0]?.fields?.['Scheduled Date'] || null
          scheduledDate = getNextPostingSlot(latestSlot)
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
      await patchAirtableRecord('Tasks', taskId, taskUpdate)
      if (assetId) {
        await patchAirtableRecord('Assets', assetId, { 'Pipeline Status': 'In Editing' })
      }
      console.log(`[Editor] Task ${taskId} sent back for revision`)

      // Send Telegram notification to editor (non-blocking)
      const task = tasks[0]
      const creatorId = (task.fields?.Creator || [])[0] || null
      const inspoId = (task.fields?.Inspiration || [])[0] || null
      const taskName = task.fields?.Name || ''
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
      await sendRevisionTelegram({ creatorName, inspoTitle, taskName, feedback: adminFeedback, screenshotUrls: adminScreenshotUrls })

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
      taskUpdate['Completed At'] = new Date().toISOString()
      taskUpdate['Admin Review Status'] = 'Pending Review'
      // Clear any previous revision feedback when resubmitting
      if (isRevision) taskUpdate['Admin Feedback'] = ''
    }
    if (editorNotes) taskUpdate['Editor Notes'] = editorNotes
    await patchAirtableRecord('Tasks', taskId, taskUpdate)

    if (assetId) {
      const assetUpdate = { 'Pipeline Status': TASK_TO_ASSET_STATUS[newStatus] }
      if (editedFileLink) assetUpdate['Edited File Link'] = editedFileLink
      if (editedFilePath) assetUpdate['Edited File Path'] = editedFilePath
      await patchAirtableRecord('Assets', assetId, assetUpdate)
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
