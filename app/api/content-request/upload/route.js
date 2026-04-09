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

    const { itemId, dropboxPath, dropboxLink, fileName, fileSize } = await request.json()

    if (!itemId || !dropboxPath || !dropboxLink) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Update the item record
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${CONTENT_REQUEST_ITEMS}/${itemId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Dropbox Path': dropboxPath,
          'Dropbox Link': dropboxLink,
          'File Name': fileName || '',
          'File Size': fileSize || 0,
          'Uploaded At': new Date().toISOString(),
          Status: 'Draft',
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Airtable update failed: ${res.status} ${err}`)
    }

    const updated = await res.json()
    return NextResponse.json({ success: true, record: updated })
  } catch (err) {
    console.error('[content-request/upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
