import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
import { triggerAssetMirror } from '@/lib/triggerMirror'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'

function getWeekStart() {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return monday.toISOString().split('T')[0]
}

// Finalize: the browser already uploaded the AI reel to Dropbox via the
// token route. This creates the Asset + Task so it lands in the existing
// For Review surface (Source Type = AI Generated, straight to review since
// the AI editor IS the producer — no editing step), attaches the
// thumbnail, carries the original scraped reel as the side-by-side
// reference, and marks the pool reel Produced.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { reelRecordId, creatorId, dropboxPath, thumbnailBase64, slug } = await request.json()

    if (!reelRecordId || !/^rec[A-Za-z0-9]{14}$/.test(reelRecordId)) {
      return NextResponse.json({ error: 'Valid reelRecordId required' }, { status: 400 })
    }
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    if (!dropboxPath || !thumbnailBase64) {
      return NextResponse.json({ error: 'dropboxPath and thumbnailBase64 required' }, { status: 400 })
    }

    // Load the pool reel
    const reelRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels/${reelRecordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!reelRes.ok) return NextResponse.json({ error: 'Reel not found' }, { status: 404 })
    const rf = (await reelRes.json()).fields || {}
    const originalUrl = rf['Reel URL'] || ''
    const handle = rf['Source Handle'] || ''
    const reelId = rf['Reel ID'] || reelRecordId

    // Shared link for the uploaded AI reel
    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    let sharedLink = ''
    try {
      sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)
    } catch (e) {
      console.warn('[ai-editor upload] shared link failed:', e.message)
    }

    // When a slug is provided, use it for the Asset + Task name so the
    // canonical identifier travels into the admin's For Review surface
    // and downstream Post records.
    const assetName = slug ? slug : `AI Recreate: @${handle} ${reelId}`
    const taskName = slug ? `AI Review: ${slug}` : `AI Review: @${handle} ${reelId}`

    // Create the Asset — goes straight to In Review
    const assetRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        records: [{
          fields: {
            'Asset Name': assetName,
            'Palm Creators': [creatorId],
            'Source Type': 'AI Generated',
            'Source': 'Dropbox',
            'Pipeline Status': 'In Review',
            'Asset Type': 'Video',
            'Upload Week': getWeekStart(),
            'Reference Source URL': originalUrl,
            'Dropbox Shared Link': sharedLink,
            'Dropbox Path (Current)': dropboxPath,
          },
        }],
      }),
    })
    if (!assetRes.ok) {
      const err = await assetRes.text()
      console.error('[ai-editor upload] asset create failed:', err)
      return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 })
    }
    const assetId = (await assetRes.json()).records[0].id

    // Attach thumbnail
    try {
      await fetch(
        `https://content.airtable.com/v0/${OPS_BASE}/${assetId}/Thumbnail/uploadAttachment`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: 'image/jpeg', filename: 'ai-thumbnail.jpg', file: thumbnailBase64 }),
        }
      )
    } catch (e) {
      console.warn('[ai-editor upload] thumbnail attach failed:', e.message)
    }

    // Create the review Task — Done (producer = AI editor), Pending Review
    const taskRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        records: [{
          fields: {
            'Name': taskName,
            'Status': 'Done',
            'Admin Review Status': 'Pending Review',
            'Asset': [assetId],
            'Creator': [creatorId],
          },
        }],
      }),
    })
    let taskCreated = taskRes.ok
    if (!taskRes.ok) console.warn('[ai-editor upload] task create failed:', await taskRes.text())

    // Append this creator to the reel's Produced For + link the new
    // asset. The PATCH is wrapped in a small retry loop because batch
    // upload runs 3 concurrent requests against the same reel — without
    // a re-read, two concurrent writes would both base off the same
    // snapshot and the second would drop the first's assetId. Re-read
    // on every retry so the union is correct under contention.
    const patchProducedFor = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const cur = await fetch(
            `https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels/${reelRecordId}`,
            { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
          )
          if (!cur.ok) return
          const cf = (await cur.json()).fields || {}
          const curProducedFor = Array.isArray(cf['Produced For']) ? cf['Produced For'] : []
          const curProducedAsset = Array.isArray(cf['Produced Asset']) ? cf['Produced Asset'] : []
          if (curProducedFor.includes(creatorId) && curProducedAsset.includes(assetId)) return
          const pRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels/${reelRecordId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              typecast: true,
              fields: {
                'Produced For': Array.from(new Set([...curProducedFor, creatorId])),
                'Produced Asset': Array.from(new Set([...curProducedAsset, assetId])),
              },
            }),
          })
          if (pRes.ok) return
          // 422 from Airtable on concurrent writes — back off briefly and re-read.
          await new Promise(r => setTimeout(r, 200 + attempt * 200))
        } catch (e) {
          console.warn(`[ai-editor upload] Produced For attempt ${attempt + 1} failed:`, e.message)
        }
      }
      console.warn(`[ai-editor upload] gave up updating Produced For after retries for ${reelRecordId}`)
    }
    await patchProducedFor()

    // Stamp the matching Stage B Output with Uploaded At so the
    // workflow gallery can show "✓ Uploaded" badges + the "project
    // complete" indicator when every scene under a reel has been
    // uploaded. Matched by Slug since that's the canonical bridge.
    if (slug) {
      try {
        const sbList = await fetch(
          `https://api.airtable.com/v0/${OPS_BASE}/Stage%20B%20Outputs?filterByFormula=${encodeURIComponent(`{Slug} = '${slug.replace(/'/g, "\\'")}'`)}&maxRecords=1`,
          { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
        )
        if (sbList.ok) {
          const sbId = (await sbList.json()).records?.[0]?.id
          if (sbId) {
            await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Stage%20B%20Outputs/${sbId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ typecast: true, fields: { 'Uploaded At': new Date().toISOString() } }),
            })
          }
        }
      } catch (e) {
        console.warn('[ai-editor upload] Uploaded At stamp failed:', e.message)
      }
    }

    triggerAssetMirror(assetId)

    return NextResponse.json({ status: 'success', assetId, taskCreated, slug: slug || null })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-editor upload] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
