import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CONTENT_REQUEST_ITEMS = 'tblXsW7GsyZrplVkq'

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { requestId, creatorOpsId, section, dropboxPath, dropboxLink, fileName, fileSize } = await request.json()

    if (!dropboxPath || !dropboxLink || !section) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Create a new item record for this uploaded file
    const fields = {
      Label: fileName || 'Upload',
      Section: section,
      Status: 'Draft',
      'Dropbox Path': dropboxPath,
      'Dropbox Link': dropboxLink,
      'File Name': fileName || '',
      'File Size': fileSize || 0,
      'Uploaded At': new Date().toISOString(),
    }

    // Link to content request and creator if provided
    if (requestId) fields['Content Request'] = [requestId]
    if (creatorOpsId) fields['Creator'] = [creatorOpsId]

    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${CONTENT_REQUEST_ITEMS}`, {
      method: 'POST',
      headers: airtableHeaders,
      body: JSON.stringify({ records: [{ fields }] }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Airtable create failed: ${res.status} ${err}`)
    }

    const data = await res.json()
    const recordId = data.records[0].id

    return NextResponse.json({ success: true, recordId })
  } catch (err) {
    console.error('[content-request/upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
