import { NextResponse } from 'next/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function POST(request) {
  try {
    const { recordId, creatorOpsId, action } = await request.json()
    console.log('[inspo-save] Request:', { recordId, creatorOpsId, action })

    if (!recordId || !creatorOpsId || !['save', 'unsave'].includes(action)) {
      console.log('[inspo-save] Bad request — missing params')
      return NextResponse.json({ error: 'Missing recordId, creatorOpsId, or valid action' }, { status: 400 })
    }

    // Fetch current Saved By values
    const getRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
        cache: 'no-store',
      }
    )
    if (!getRes.ok) {
      const getErr = await getRes.text()
      console.log('[inspo-save] GET failed:', getRes.status, getErr)
      return NextResponse.json({ error: 'Failed to fetch record', detail: getErr }, { status: 500 })
    }
    const record = await getRes.json()
    const currentSaved = record.fields['Saved By'] || []
    const currentIds = currentSaved.map((r) => (typeof r === 'string' ? r : r.id || r))
    console.log('[inspo-save] Current saved IDs:', currentIds)

    let updatedIds
    if (action === 'save') {
      if (currentIds.includes(creatorOpsId)) {
        console.log('[inspo-save] Already saved')
        return NextResponse.json({ status: 'already_saved' })
      }
      updatedIds = [...currentIds, creatorOpsId]
    } else {
      updatedIds = currentIds.filter((id) => id !== creatorOpsId)
    }

    console.log('[inspo-save] Writing IDs:', updatedIds)

    // Update the record
    const patchBody = {
      fields: {
        'Saved By': updatedIds,
      },
    }
    console.log('[inspo-save] PATCH body:', JSON.stringify(patchBody))

    const patchRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patchBody),
      }
    )

    if (!patchRes.ok) {
      const err = await patchRes.json()
      console.log('[inspo-save] PATCH failed:', patchRes.status, JSON.stringify(err))
      return NextResponse.json({ error: err }, { status: patchRes.status })
    }

    console.log('[inspo-save] Success:', action)
    return NextResponse.json({ status: action === 'save' ? 'saved' : 'unsaved' })
  } catch (err) {
    console.log('[inspo-save] Exception:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
