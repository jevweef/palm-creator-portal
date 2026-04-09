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

    const body = await request.json()
    const { itemId, dropboxPath, dropboxLink, fileName, fileSize, createNew } = body

    if (!dropboxPath || !dropboxLink) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    let recordId = itemId

    // If no itemId, create a new record (virtual item getting its first upload)
    if (!recordId && createNew) {
      const { label, section, sectionOrder, itemOrder, requestId, creatorOpsId, scriptText, acceptedFileTypes } = createNew

      const createRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${CONTENT_REQUEST_ITEMS}`, {
        method: 'POST',
        headers: airtableHeaders,
        body: JSON.stringify({
          records: [{
            fields: {
              Label: label,
              Section: section,
              'Section Order': sectionOrder,
              'Item Order': itemOrder,
              'Content Request': [requestId],
              Creator: [creatorOpsId],
              Status: 'Draft',
              'Script Text': scriptText || '',
              'Accepted File Types': acceptedFileTypes || '',
              'Dropbox Path': dropboxPath,
              'Dropbox Link': dropboxLink,
              'File Name': fileName || '',
              'File Size': fileSize || 0,
              'Uploaded At': new Date().toISOString(),
            },
          }],
        }),
      })

      if (!createRes.ok) {
        const err = await createRes.text()
        throw new Error(`Airtable create failed: ${createRes.status} ${err}`)
      }

      const createData = await createRes.json()
      recordId = createData.records[0].id

      return NextResponse.json({ success: true, recordId })
    }

    // Update existing record
    if (!recordId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
    }

    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${CONTENT_REQUEST_ITEMS}/${recordId}`, {
      method: 'PATCH',
      headers: airtableHeaders,
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

    return NextResponse.json({ success: true, recordId })
  } catch (err) {
    console.error('[content-request/upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
