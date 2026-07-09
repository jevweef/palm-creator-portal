import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
import { triggerAssetMirror } from '@/lib/triggerMirror'
import { uploadImageBytes, buildDeliveryUrl, isCloudflareImagesConfigured } from '@/lib/cloudflareImages'

export const maxDuration = 60

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

// Finalize ONE bulk-submitted AI reel. The browser already uploaded the
// video to Dropbox via /api/ai-editor/bulk-token. This creates the Asset +
// review Task so it lands in the admin's For Review surface, marked AI
// Generated and linked to the creator — the same destination as the pool
// flow (app/api/ai-editor/upload), but WITHOUT a source pool reel. There's
// no reference reel to join back to, so the For Review card renders it as a
// standalone AI output (no ORIGINAL side).
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { creatorId, dropboxPath, thumbnailBase64, fileName } = await request.json()

    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    if (!dropboxPath) {
      return NextResponse.json({ error: 'dropboxPath required' }, { status: 400 })
    }

    // Shared link for the uploaded reel (best effort — the file is already
    // safely in Dropbox, so a link failure shouldn't strand the submission).
    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    let sharedLink = ''
    try {
      sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)
    } catch (e) {
      console.warn('[ai-editor bulk-submit] shared link failed:', e.message)
    }

    const cleanName = (fileName || '').replace(/\.[^.]+$/, '') || 'Reel'
    const assetName = `AI Reel: ${cleanName}`
    const taskName = `AI Review: ${cleanName}`

    // Create the Asset — AI Generated, straight to In Review (the AI editor
    // IS the producer, so there's no editing step).
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
            'Dropbox Shared Link': sharedLink,
            'Dropbox Path (Current)': dropboxPath,
          },
        }],
      }),
    })
    if (!assetRes.ok) {
      const err = await assetRes.text()
      console.error('[ai-editor bulk-submit] asset create failed:', err)
      return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 })
    }
    const assetId = (await assetRes.json()).records[0].id

    // Thumbnail → Cloudflare Images so the For Review card + Post Prep get
    // the CDN-optimized variant instead of a heavy Airtable attachment.
    // Bulk submit only sends a client-extracted first-frame JPEG (base64,
    // ~500KB), never a source URL — so this is the single upload path.
    let cdnUrl = null
    if (isCloudflareImagesConfigured() && thumbnailBase64) {
      try {
        const bytes = Buffer.from(thumbnailBase64, 'base64')
        const result = await uploadImageBytes(bytes, assetId, 'image/jpeg')
        if (result?.id) {
          cdnUrl = buildDeliveryUrl(result.id, 'public')
          const patchRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: { 'CDN URL': cdnUrl, 'CDN Image ID': result.id, 'Thumbnail': [{ url: cdnUrl }] },
            }),
          })
          if (!patchRes.ok) console.warn('[ai-editor bulk-submit] CDN PATCH failed:', await patchRes.text())
        }
      } catch (e) {
        console.warn('[ai-editor bulk-submit] CF Images thumbnail flow failed:', e.message)
      }
    }

    // Create the review Task — Done (producer = AI editor), Pending Review.
    // Completed At = now so the For Review card shows the "Submitted {date}"
    // timestamp the same way regular editor submissions do.
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
            'Completed At': new Date().toISOString(),
          },
        }],
      }),
    })
    const taskCreated = taskRes.ok
    if (!taskRes.ok) console.warn('[ai-editor bulk-submit] task create failed:', await taskRes.text())

    triggerAssetMirror(assetId)

    return NextResponse.json({ status: 'success', assetId, taskCreated, cdnUrl })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-editor bulk-submit] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
