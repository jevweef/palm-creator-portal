import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

// Get Monday of the current week (ISO week starts Monday)
function getWeekStart() {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1 // days since Monday
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return monday.toISOString().split('T')[0]
}

const MAX_PAGES = 50

async function fetchAllRecords(tableId, params) {
  const allRecords = []
  let offset = null
  let pages = 0

  do {
    if (++pages > MAX_PAGES) {
      console.warn(`[fetchAllRecords] Hit max pagination limit for table ${tableId}`)
      break
    }

    const p = new URLSearchParams(params)
    if (offset) p.set('offset', offset)

    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${p}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Airtable fetch failed: ${res.status} ${err}`)
    }

    const data = await res.json()
    allRecords.push(...data.records)
    offset = data.offset || null
  } while (offset)

  return allRecords
}

export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'

    const { searchParams } = new URL(request.url)
    const creatorOpsId = searchParams.get('creatorOpsId')

    if (!creatorOpsId) {
      return NextResponse.json({ error: 'Missing creatorOpsId' }, { status: 400 })
    }

    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch in parallel: saved inspo, assets, and creator quota
    const inspoParams = new URLSearchParams({
      filterByFormula: "{Status} = 'Complete'",
    })
    ;['Title', 'Thumbnail', 'CDN URL', 'Tags', 'Username', 'Views', 'Likes', 'Comments',
      'Shares', 'Content link', 'Engagement Score', 'Notes', 'On-Screen Text',
      'Film Format', 'Saved By', 'DB Share Link', 'DB Raw = 1', 'DB Embed Code',
      'Creator Posted Date', 'Transcript', 'Suggested Tags',
    ].forEach((f) => inspoParams.append('fields[]', f))

    const assetParams = new URLSearchParams()
    ;['Asset Name', 'Palm Creators', 'Inspiration Source', 'Pipeline Status',
      'Creator Notes', 'Upload Week', 'Source Type', 'Dropbox Shared Link',
      'Dropbox Path (Current)', 'Asset Type', 'Thumbnail', 'CDN URL',
    ].forEach((f) => assetParams.append('fields[]', f))

    const [inspoRecords, assetRecords, creatorRes] = await Promise.all([
      fetchAllRecords(INSPIRATION_TABLE, inspoParams),
      fetchAllRecords(ASSETS_TABLE, assetParams),
      fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${CREATORS_TABLE}/${creatorOpsId}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
          cache: 'no-store',
        }
      ),
    ])

    // Get creator quota
    let weeklyQuota = 5
    if (creatorRes.ok) {
      const creatorData = await creatorRes.json()
      weeklyQuota = creatorData.fields['Weekly Reel Quota'] || 5
    }

    // Filter inspo to this creator's saved reels
    const savedInspo = inspoRecords.filter((r) => {
      const savedBy = r.fields['Saved By'] || []
      return savedBy.includes(creatorOpsId)
    })

    // Filter assets to this creator's inspo uploads
    const myAssets = assetRecords.filter((r) => {
      const creators = r.fields['Palm Creators'] || []
      const sourceType = r.fields['Source Type']
      return creators.includes(creatorOpsId) && sourceType === 'Inspo Upload'
    })

    // Build a set of inspo IDs that already have uploads
    const inspoIdsWithUploads = new Set()
    myAssets.forEach((a) => {
      const sources = a.fields['Inspiration Source'] || []
      sources.forEach((id) => inspoIdsWithUploads.add(id))
    })

    // Map inspo records for the "Saved" tab — only those WITHOUT uploads yet
    const saved = savedInspo
      .filter((r) => !inspoIdsWithUploads.has(r.id))
      .map((r) => {
        const thumb = r.fields['Thumbnail']
        return {
          id: r.id,
          title: r.fields['Title'] || 'Untitled',
          thumbnail: thumb && thumb.length > 0 ? thumb[0].url : null,
          cdnUrl: r.fields['CDN URL'] || null,
          tags: r.fields['Tags'] || [],
          suggestedTags: r.fields['Suggested Tags'] || [],
          username: r.fields['Username'] || '',
          views: r.fields['Views'] || 0,
          likes: r.fields['Likes'] || 0,
          comments: r.fields['Comments'] || 0,
          shares: r.fields['Shares'] || 0,
          contentLink: r.fields['Content link'] || '',
          engagementScore: r.fields['Engagement Score'] || 0,
          notes: r.fields['Notes'] || '',
          onScreenText: r.fields['On-Screen Text'] || '',
          filmFormat: r.fields['Film Format'] || [],
          dbShareLink: r.fields['DB Share Link'] || '',
          dbRawLink: r.fields['DB Raw = 1'] || '',
          dbEmbedCode: r.fields['DB Embed Code'] || '',
          transcript: r.fields['Transcript'] || '',
          creatorPostedDate: r.fields['Creator Posted Date'] || '',
        }
      })

    // Group assets by Pipeline Status
    const uploaded = []
    const editing = []
    const scheduled = []
    const posted = []

    myAssets.forEach((a) => {
      const status = a.fields['Pipeline Status']
      const inspoSourceIds = a.fields['Inspiration Source'] || []

      // Find the matching inspo record for context
      const inspoRecord = inspoSourceIds.length > 0
        ? savedInspo.find((i) => i.id === inspoSourceIds[0]) ||
          inspoRecords.find((i) => i.id === inspoSourceIds[0])
        : null

      const inspoThumb = inspoRecord?.fields['Thumbnail']
      const assetThumb = a.fields['Thumbnail']

      const item = {
        assetId: a.id,
        assetName: a.fields['Asset Name'] || '',
        pipelineStatus: status || 'Uploaded',
        creatorNotes: a.fields['Creator Notes'] || '',
        dropboxLink: a.fields['Dropbox Shared Link'] || '',
        cdnUrl: a.fields['CDN URL'] || null,
        // Creator's uploaded clip thumbnail (what the card should show)
        assetThumbnail: assetThumb && assetThumb.length > 0 ? assetThumb[0].url : null,
        inspoId: inspoSourceIds[0] || null,
        inspoTitle: inspoRecord?.fields['Title'] || '',
        inspoThumbnail: inspoThumb && inspoThumb.length > 0 ? inspoThumb[0].url : null,
        inspoCdnUrl: inspoRecord?.fields['CDN URL'] || null,
        inspoTags: inspoRecord?.fields['Tags'] || [],
        inspoUsername: inspoRecord?.fields['Username'] || '',
        inspoDbShareLink: inspoRecord?.fields['DB Share Link'] || '',
        inspoNotes: inspoRecord?.fields['Notes'] || '',
      }

      if (status === 'In Editing') editing.push(item)
      else if (status === 'In Review') editing.push(item) // show In Review in editing tab
      else if (status === 'Scheduled') scheduled.push(item)
      else if (status === 'Posted') posted.push(item)
      else uploaded.push(item) // default: Uploaded or no status
    })

    // Quota: count this week's uploads
    const weekStart = getWeekStart()
    const weekUploads = myAssets.filter((a) => {
      const uploadWeek = a.fields['Upload Week']
      return uploadWeek === weekStart
    }).length

    return NextResponse.json({
      saved,
      uploaded,
      editing,
      scheduled,
      posted,
      quota: {
        used: weekUploads,
        target: weeklyQuota,
        weekStart,
      },
    })
  } catch (err) {
    console.error('[content-pipeline] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
