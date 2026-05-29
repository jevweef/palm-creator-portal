import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'

// POST { taskId } — let the AI editor UNDO a submission they just made
// (e.g. uploaded the wrong video to a project). Deletes the review Task +
// its Asset so the card leaves For Review and the editor's project view.
//
// Distinct from /api/ai-editor/discard (which only acts on rejected
// "Needs Revision" tasks). This one covers the fresh-mistake case:
// allowed while the submission is still PENDING REVIEW or NEEDS REVISION —
// i.e. the admin hasn't approved it. Once approved (a Post has been created
// and may be queued to go out), the editor can't silently yank it; they're
// told to ask an admin. Guarded to Source Type = AI Generated so a button
// click can never touch a human editor's work.
//
// The Dropbox file is intentionally left in place (disk is cheap; the file
// is a useful archive of what was uploaded).
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { taskId } = await request.json()
    if (!taskId || !/^rec[A-Za-z0-9]{14}$/.test(taskId)) {
      return NextResponse.json({ error: 'Valid taskId required' }, { status: 400 })
    }

    const tRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!tRes.ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const tf = (await tRes.json()).fields || {}

    const reviewStatus = tf['Admin Review Status']?.name || tf['Admin Review Status'] || null
    if (reviewStatus === 'Approved') {
      return NextResponse.json(
        { error: 'This video was already approved by an admin — ask them to remove it.' },
        { status: 409 }
      )
    }
    // Belt-and-suspenders: if a Post was already spun up off this task, it's
    // past the point an editor should be undoing it unilaterally.
    if (Array.isArray(tf.Posts) && tf.Posts.length > 0) {
      return NextResponse.json(
        { error: 'This video is already queued as a post — ask an admin to remove it.' },
        { status: 409 }
      )
    }

    const assetId = (tf.Asset || [])[0] || null
    if (assetId) {
      const aRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
      if (aRes.ok) {
        const af = (await aRes.json()).fields || {}
        if (af['Source Type'] !== 'AI Generated') {
          return NextResponse.json({ error: 'Cancel is for AI Generated uploads only' }, { status: 400 })
        }
      }
    }

    // Delete the Task first, then the Asset. Dropbox file left in place.
    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
      .catch(e => console.warn('[ai-editor cancel-upload] task delete:', e.message))

    if (assetId) {
      await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
        .catch(e => console.warn('[ai-editor cancel-upload] asset delete:', e.message))
    }

    return NextResponse.json({ ok: true, taskId, assetId })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-editor cancel-upload] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
