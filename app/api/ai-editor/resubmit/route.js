import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
import { triggerAssetMirror } from '@/lib/triggerMirror'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'

// POST { taskId, dropboxPath, thumbnailBase64? } — resubmit a revised
// AI Generated video for an existing Task that's sitting in Needs
// Revision. Updates the EXISTING Asset (new Dropbox link + clears
// Stream Edit ID so CF Stream re-mirrors the new file) + Task (flips
// status back to Pending Review, clears Admin Feedback so the admin
// reviewing the resubmit sees a clean slate — but Revision History is
// preserved so they can see all prior rounds of feedback).
//
// Pairs with /api/ai-editor/revisions on the GET side.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { taskId, dropboxPath, thumbnailBase64 } = await request.json()

    if (!taskId || !/^rec[A-Za-z0-9]{14}$/.test(taskId)) {
      return NextResponse.json({ error: 'Valid taskId required' }, { status: 400 })
    }
    if (!dropboxPath) {
      return NextResponse.json({ error: 'dropboxPath required' }, { status: 400 })
    }

    // Load the task to find its Asset + verify it's actually a
    // Needs-Revision AI Generated task (so we don't accidentally
    // resubmit a human editor's task through this path).
    const tRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!tRes.ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const tf = (await tRes.json()).fields || {}
    const reviewStatus = tf['Admin Review Status']?.name || tf['Admin Review Status']
    if (reviewStatus !== 'Needs Revision') {
      return NextResponse.json({ error: `Task is not in Needs Revision (current: ${reviewStatus || 'none'})` }, { status: 400 })
    }
    const assetId = (tf.Asset || [])[0]
    if (!assetId) return NextResponse.json({ error: 'Task has no linked Asset' }, { status: 400 })

    // Verify the Asset is AI Generated — extra guard.
    const aRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!aRes.ok) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    const af = (await aRes.json()).fields || {}
    if (af['Source Type'] !== 'AI Generated') {
      return NextResponse.json({ error: 'Resubmit is for AI Generated assets only' }, { status: 400 })
    }

    // Refresh the Dropbox shared link to point at the just-uploaded file.
    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    let sharedLink = ''
    try { sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath) }
    catch (e) { console.warn('[ai-editor resubmit] shared link failed:', e.message) }

    // Update the Asset. Clearing Stream Edit ID forces mirrorAsset to
    // re-upload to Cloudflare Stream — without it, the For Review card
    // would keep showing the previous (rejected) Stream video.
    await patchAirtableRecord('Assets', assetId, {
      'Dropbox Path (Current)': dropboxPath,
      'Dropbox Shared Link': sharedLink,
      'Pipeline Status': 'In Review',
      'Stream Edit ID': '',
    }, { typecast: true })

    // Optionally replace the thumbnail. uploadAttachment overwrites the
    // existing array, which is what we want here.
    if (thumbnailBase64) {
      try {
        await fetch(
          `https://content.airtable.com/v0/${OPS_BASE}/${assetId}/Thumbnail/uploadAttachment`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentType: 'image/jpeg', filename: 'ai-thumbnail.jpg', file: thumbnailBase64 }),
          }
        )
      } catch (e) { console.warn('[ai-editor resubmit] thumbnail attach failed:', e.message) }
    }

    // Flip the task back to Pending Review. Keep Revision History (it's
    // append-only); just clear the active Admin Feedback so the admin
    // sees a clean review surface on the next round.
    await patchAirtableRecord('Tasks', taskId, {
      'Status': 'Done',
      'Admin Review Status': 'Pending Review',
      'Admin Feedback': '',
      'Completed At': new Date().toISOString(),
    }, { typecast: true })

    // Re-mirror to Cloudflare Stream so the new file plays in admin's
    // For Review card. Fire-and-forget via waitUntil under the hood.
    triggerAssetMirror(assetId)

    return NextResponse.json({ ok: true, assetId, taskId })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-editor resubmit] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
