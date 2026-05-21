import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'

// POST { taskId } — discard a rejected AI Recreate Task + its Asset.
// Used when the AI editor takes the "🎨 Re-do Stage B" path from a
// Needs Revision card: they're going to produce a brand-new still
// (different pose / different identity refs) rather than just
// re-uploading a tweak. Without this, the original rejected task
// stays in Needs Revision forever, polluting the section.
//
// Only acts on Tasks whose linked Asset is Source Type = AI Generated
// AND Admin Review Status = Needs Revision — extra guard so a button
// click can't accidentally nuke a human editor's work.
//
// Note: the Dropbox file is intentionally left in place. Disk is
// cheap and the file is useful as a tuning archive (what went wrong).
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { taskId } = await request.json()
    if (!taskId || !/^rec[A-Za-z0-9]{14}$/.test(taskId)) {
      return NextResponse.json({ error: 'Valid taskId required' }, { status: 400 })
    }

    // Verify state
    const tRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!tRes.ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const tf = (await tRes.json()).fields || {}
    const reviewStatus = tf['Admin Review Status']?.name || tf['Admin Review Status']
    if (reviewStatus !== 'Needs Revision') {
      return NextResponse.json({ error: `Task is not in Needs Revision (current: ${reviewStatus || 'none'})` }, { status: 400 })
    }
    const assetId = (tf.Asset || [])[0]
    if (assetId) {
      const aRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
      if (aRes.ok) {
        const af = (await aRes.json()).fields || {}
        if (af['Source Type'] !== 'AI Generated') {
          return NextResponse.json({ error: 'Discard is for AI Generated assets only' }, { status: 400 })
        }
      }
    }

    // Delete the Task first, then the Asset. Dropbox file is left in
    // place (the rejected file is useful as a tuning archive).
    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
      .catch(e => console.warn('[ai-editor discard] task delete:', e.message))

    if (assetId) {
      await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
        .catch(e => console.warn('[ai-editor discard] asset delete:', e.message))
    }

    return NextResponse.json({ ok: true, taskId, assetId })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[ai-editor discard] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
