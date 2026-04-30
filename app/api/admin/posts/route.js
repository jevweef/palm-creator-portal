export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'

function recordIdFormula(ids) {
  if (!ids.length) return 'FALSE()'
  return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`
}

// GET — list posts in active states (Prepping, Sent to Telegram, Ready to Post)
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const posts = await fetchAirtableRecords('Posts', {
      filterByFormula: "OR({Status}='Prepping',{Status}='Sent to Telegram',{Status}='Ready to Post')",
      fields: [
        'Post Name', 'Status', 'Platform', 'Caption', 'Hashtags',
        'Thumbnail', 'Scheduled Date', 'Telegram Sent At', 'Admin Notes',
        'Creator', 'Asset', 'Task',
      ],
      sort: [{ field: 'Scheduled Date', direction: 'asc' }],
    })

    if (!posts.length) return NextResponse.json({ posts: [], total: 0 })

    const creatorIds = [...new Set(posts.flatMap(p => p.fields?.Creator || []))]
    const assetIds = [...new Set(posts.flatMap(p => p.fields?.Asset || []))]

    const [creatorRecords, assetRecords] = await Promise.all([
      creatorIds.length ? fetchAirtableRecords('Palm Creators', {
        filterByFormula: recordIdFormula(creatorIds),
        fields: ['Creator', 'AKA', 'Telegram Thread ID'],
      }) : [],
      assetIds.length ? fetchAirtableRecords('Assets', {
        filterByFormula: recordIdFormula(assetIds),
        fields: ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'Thumbnail', 'CDN URL', 'Asset Type', 'Stream Edit ID', 'Stream Raw ID'],
      }) : [],
    ])

    const creatorMap = Object.fromEntries(creatorRecords.map(r => [r.id, r.fields]))
    const assetMap = Object.fromEntries(assetRecords.map(r => [r.id, r.fields]))

    const result = posts.map(p => {
      const f = p.fields || {}
      const creatorId = (f.Creator || [])[0] || null
      const assetId = (f.Asset || [])[0] || null
      const creator = creatorId ? (creatorMap[creatorId] || {}) : {}
      const asset = assetId ? (assetMap[assetId] || {}) : {}

      return {
        id: p.id,
        name: f['Post Name'] || '',
        status: f.Status || 'Prepping',
        platform: f.Platform || [],
        caption: f.Caption || '',
        hashtags: f.Hashtags || '',
        thumbnail: f.Thumbnail || [],
        scheduledDate: f['Scheduled Date'] || null,
        telegramSentAt: f['Telegram Sent At'] || null,
        adminNotes: f['Admin Notes'] || '',
        creator: {
          id: creatorId,
          name: creator.AKA || creator.Creator || '',
          telegramThreadId: creator['Telegram Thread ID'] || null,
        },
        asset: {
          id: assetId,
          name: asset['Asset Name'] || '',
          editedFileLink: asset['Edited File Link'] || '',
          dropboxLink: asset['Dropbox Shared Link'] || '',
          thumbnail: asset.Thumbnail?.[0]?.thumbnails?.large?.url || asset.Thumbnail?.[0]?.url || '',
          cdnUrl: asset['CDN URL'] || null,
          streamEditId: asset['Stream Edit ID'] || null,
          streamRawId: asset['Stream Raw ID'] || null,
          assetType: asset['Asset Type'] || '',
        },
      }
    })

    // Fetch all active creators for the historical post form
    const allCreators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: '{Social Media Editing}=1',
      fields: ['Creator', 'AKA'],
      sort: [{ field: 'AKA', direction: 'asc' }],
    })
    const creators = allCreators.map(c => ({ id: c.id, name: c.fields?.AKA || c.fields?.Creator || '' }))

    return NextResponse.json({ posts: result, total: result.length, creators })
  } catch (err) {
    console.error('[Posts] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — create a historical post record
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, postName, date, slot } = await request.json()
    if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

    const [year, month, day] = date.split('-').map(Number)
    const hour = slot === 'evening' ? 23 : 15
    const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, 0, 0))

    await createAirtableRecord('Posts', {
      'Post Name': postName || `Historical post – ${date}`,
      ...(creatorId ? { 'Creator': [creatorId] } : {}),
      'Status': 'Posted',
      'Scheduled Date': scheduledDate.toISOString(),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Posts] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — update a post record
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { postId, fields, typecast } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    const allowedFields = ['Post Name', 'Status', 'Platform', 'Caption', 'Hashtags', 'Scheduled Date', 'Telegram Sent At', 'Posted At', 'Post Link', 'Admin Notes', 'Telegram Message ID', 'Thumbnail']
    const update = Object.fromEntries(
      Object.entries(fields).filter(([k]) => allowedFields.includes(k))
    )

    // Thumbnail fan-out: a single Asset/Task fans out into N sibling Post
    // records (one per managed IG account). Updating the Thumbnail on just
    // the one Post the user is editing leaves the siblings (and the
    // Unassigned Tray's samplePost preview) showing the OLD image, even
    // though they're the "same" reel. So when Thumbnail is in the patch,
    // mirror it to every sibling Post sharing this Post's Task — and
    // also update Asset.Thumbnail so future fan-outs use the new image.
    let targetIds = [postId]
    let assetIdForFanout = null
    if ('Thumbnail' in update) {
      const sourceList = await fetchAirtableRecords('Posts', {
        filterByFormula: `RECORD_ID()='${postId}'`,
        fields: ['Task', 'Asset'],
      })
      const source = sourceList[0]?.fields || {}
      const taskId = (source.Task || [])[0] || null
      assetIdForFanout = (source.Asset || [])[0] || null
      if (taskId) {
        const siblings = await fetchAirtableRecords('Posts', {
          filterByFormula: `FIND('${taskId}', ARRAYJOIN({Task}))`,
          fields: ['Task'],
        })
        const ids = siblings.map(s => s.id).filter(Boolean)
        if (ids.length) targetIds = Array.from(new Set([postId, ...ids]))
      }
      // Force filename: 'thumbnail.jpg' on the attachment so Airtable stores
      // it with a usable extension. Without it, ingest sometimes lands a
      // typeless attachment that browsers refuse to render.
      if (Array.isArray(update.Thumbnail)) {
        update.Thumbnail = update.Thumbnail.map(att => ({
          ...att,
          filename: att.filename || 'thumbnail.jpg',
        }))
      }
    }

    // Patch all targets in parallel — small fan-out (≤4 accounts), well
    // under Airtable's 5/sec cap.
    await Promise.all(targetIds.map(id =>
      patchAirtableRecord('Posts', id, update, typecast ? { typecast: true } : {})
    ))

    // Best-effort Asset.Thumbnail mirror so future Post clones inherit the
    // new image. Failure here doesn't roll back the Post updates.
    if (assetIdForFanout && Array.isArray(update.Thumbnail)) {
      try {
        await patchAirtableRecord('Assets', assetIdForFanout, { 'Thumbnail': update.Thumbnail })
      } catch (e) {
        console.warn('[Posts] Asset.Thumbnail mirror failed:', e.message)
      }
    }

    return NextResponse.json({ ok: true, updatedPostIds: targetIds })
  } catch (err) {
    console.error('[Posts] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
