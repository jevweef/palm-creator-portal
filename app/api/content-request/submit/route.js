import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CONTENT_REQUEST_ITEMS = 'tblXsW7GsyZrplVkq'

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { itemId, action, notes } = await request.json()

    if (!itemId || !action) {
      return NextResponse.json({ error: 'Missing itemId or action' }, { status: 400 })
    }

    const fields = {}
    if (action === 'submit') {
      fields.Status = 'Submitted'
    } else if (action === 'save_draft') {
      fields.Status = 'Draft'
    } else if (action === 'revise') {
      // Creator wants to revise a submitted item
      fields.Status = 'Draft'
    }

    if (notes !== undefined) {
      fields['Creator Notes'] = notes
    }

    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${CONTENT_REQUEST_ITEMS}/${itemId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Airtable update failed: ${res.status} ${err}`)
    }

    const updated = await res.json()
    return NextResponse.json({ success: true, record: updated })
  } catch (err) {
    console.error('[content-request/submit] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
