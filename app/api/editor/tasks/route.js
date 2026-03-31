export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'

const TASKS_TABLE = 'tblXMh2UznOJMgxl6'
const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'

export async function POST(req) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { assetId, creatorId } = await req.json()

    if (!assetId || !creatorId) {
      return NextResponse.json({ error: 'assetId and creatorId are required' }, { status: 400 })
    }

    // Fetch the asset to get its name
    const assetRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
      { headers: airtableHeaders }
    )
    if (!assetRes.ok) {
      const text = await assetRes.text()
      throw new Error(`Failed to fetch asset: ${text}`)
    }
    const assetRecord = await assetRes.json()
    const assetName = assetRecord.fields?.['fldRYYzl5OjSMnSBt'] || assetRecord.fields?.['Asset Name'] || 'Untitled'
    const existingTasks = assetRecord.fields?.['fld4CCeJODpSsV9Fs'] || assetRecord.fields?.['Tasks'] || []
    const inspoSourceIds = assetRecord.fields?.['fld5CDjdr9Xy0tQyw'] || assetRecord.fields?.['Inspiration Source'] || []

    // Create a new Task record
    const createRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}`,
      {
        method: 'POST',
        headers: airtableHeaders,
        body: JSON.stringify({
          fields: {
            fldewc1Wffh8WQsGg: `Edit: ${assetName}`,
            fldCSCps8fliHfmZV: 'To Do',
            fldtRiiDWYBuQFetr: [creatorId],
            fldUGXeqxXMvedl9z: [assetId],
            ...(inspoSourceIds.length ? { fldGcodJMsxLA9uvT: inspoSourceIds } : {}),
          },
        }),
      }
    )
    if (!createRes.ok) {
      const text = await createRes.text()
      throw new Error(`Failed to create task: ${text}`)
    }
    const newRecord = await createRes.json()
    const taskId = newRecord.id

    // PATCH the asset: set Pipeline Status to "In Editing" and add task to Tasks field
    const updatedTasks = [...new Set([...existingTasks, taskId])]
    const patchRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`,
      {
        method: 'PATCH',
        headers: airtableHeaders,
        body: JSON.stringify({
          fields: {
            fld96IKrBmR1d5qdz: 'In Editing',
            fld4CCeJODpSsV9Fs: updatedTasks,
          },
        }),
      }
    )
    if (!patchRes.ok) {
      const text = await patchRes.text()
      throw new Error(`Failed to update asset: ${text}`)
    }

    return NextResponse.json({ taskId })
  } catch (err) {
    console.error('[Editor Tasks] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
