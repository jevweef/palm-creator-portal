import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BASE_ID = 'applLIT2t83plMqNx'
const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { recordId, creatorOpsId, action } = await request.json()

    // Ownership check — creators can only save/unsave as themselves
    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'
    if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate record ID format
    if (!recordId || !creatorOpsId || !['save', 'unsave'].includes(action)) {
      return NextResponse.json({ error: 'Missing recordId, creatorOpsId, or valid action' }, { status: 400 })
    }

    if (!/^rec[A-Za-z0-9]{14}$/.test(recordId) || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
      return NextResponse.json({ error: 'Invalid record ID format' }, { status: 400 })
    }

    // Retry loop to handle concurrent save/unsave race conditions
    const MAX_RETRIES = 3
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
        return NextResponse.json({ error: 'Failed to fetch record', detail: getErr }, { status: 500 })
      }
      const record = await getRes.json()
      const currentSaved = record.fields['Saved By'] || []
      const currentIds = currentSaved.map((r) => (typeof r === 'string' ? r : r.id || r))

      let updatedIds
      if (action === 'save') {
        if (currentIds.includes(creatorOpsId)) {
          return NextResponse.json({ status: 'already_saved' })
        }
        updatedIds = [...currentIds, creatorOpsId]
      } else {
        updatedIds = currentIds.filter((id) => id !== creatorOpsId)
      }

      const patchRes = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${INSPIRATION_TABLE}/${recordId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${AIRTABLE_PAT}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: { 'Saved By': updatedIds } }),
        }
      )

      if (patchRes.ok) {
        return NextResponse.json({ status: action === 'save' ? 'saved' : 'unsaved' })
      }

      const err = await patchRes.json()
      // If it's a conflict/validation error likely from stale data, retry
      if (patchRes.status === 422 && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)))
        continue
      }
      return NextResponse.json({ error: err }, { status: patchRes.status })
    }

    return NextResponse.json({ error: 'Failed after retries' }, { status: 500 })
  } catch (err) {
    console.log('[inspo-save] Exception:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
