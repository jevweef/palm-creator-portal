import { NextResponse } from 'next/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const SAVED_BY_FIELD = 'fldkgyDwpctINBnG1'

export async function POST(request) {
  try {
    const { recordId, creatorOpsId, action } = await request.json()

    if (!recordId || !creatorOpsId || !['save', 'unsave'].includes(action)) {
      return NextResponse.json({ error: 'Missing recordId, creatorOpsId, or valid action' }, { status: 400 })
    }

    // Fetch current Saved By values
    const getRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
    )
    if (!getRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch record' }, { status: 500 })
    }
    const record = await getRes.json()
    const currentSaved = record.fields['Saved By'] || []
    const currentIds = currentSaved.map((r) => r.id || r)

    let updatedIds
    if (action === 'save') {
      if (currentIds.includes(creatorOpsId)) {
        return NextResponse.json({ status: 'already_saved' })
      }
      updatedIds = [...currentIds, creatorOpsId]
    } else {
      updatedIds = currentIds.filter((id) => id !== creatorOpsId)
    }

    // Update the record
    const patchRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            'Saved By': updatedIds.map((id) => ({ id })),
          },
        }),
      }
    )

    if (!patchRes.ok) {
      const err = await patchRes.json()
      return NextResponse.json({ error: err }, { status: patchRes.status })
    }

    return NextResponse.json({ status: action === 'save' ? 'saved' : 'unsaved' })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
