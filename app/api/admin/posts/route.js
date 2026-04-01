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
        fields: ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'Thumbnail', 'Asset Type'],
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
    const { postId, fields } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    const allowedFields = ['Post Name', 'Status', 'Platform', 'Caption', 'Hashtags', 'Scheduled Date', 'Telegram Sent At', 'Posted At', 'Post Link', 'Admin Notes', 'Telegram Message ID']
    const update = Object.fromEntries(
      Object.entries(fields).filter(([k]) => allowedFields.includes(k))
    )

    await patchAirtableRecord('Posts', postId, update)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Posts] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
