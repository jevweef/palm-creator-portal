import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CONTENT_REQUESTS = 'tblr1QLpcyD7p5HRb'
const CONTENT_REQUEST_ITEMS = 'tblXsW7GsyZrplVkq'
const CONTENT_REQUEST_TEMPLATES = 'tblpvD4cbs8KlbexQ'

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

async function fetchRecords(table, params = {}) {
  const records = []
  let offset = null
  do {
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.sort) {
      params.sort.forEach((s, i) => {
        query.set(`sort[${i}][field]`, s.field)
        if (s.direction) query.set(`sort[${i}][direction]`, s.direction)
      })
    }
    const url = `https://api.airtable.com/v0/${OPS_BASE}/${table}?${query}`
    const res = await fetch(url, { headers: airtableHeaders, cache: 'no-store' })
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)
  return records
}

export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await currentUser()
    const opsId = user?.publicMetadata?.airtableOpsId
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'

    const { searchParams } = new URL(request.url)
    const creatorOpsId = isAdmin ? (searchParams.get('creatorOpsId') || opsId) : opsId

    if (!creatorOpsId) {
      return NextResponse.json({ error: 'No creator profile linked' }, { status: 400 })
    }

    // Fetch templates (fast — defines the page structure)
    const templates = await fetchRecords(CONTENT_REQUEST_TEMPLATES, {
      sort: [{ field: 'Sort Order', direction: 'asc' }],
    })

    // Try to find active content request for this creator
    let contentRequest = null
    let uploadedFiles = []
    try {
      const allActive = await fetchRecords(CONTENT_REQUESTS, {
        filterByFormula: `{Status}="Active"`,
      })
      contentRequest = allActive.find(r => {
        const links = r.fields['Creator'] || []
        return links.includes(creatorOpsId)
      })

      // Fetch uploaded files for this request
      if (contentRequest) {
        const allItems = await fetchRecords(CONTENT_REQUEST_ITEMS, {})
        uploadedFiles = allItems
          .filter(item => {
            const reqLinks = item.fields['Content Request'] || []
            return reqLinks.includes(contentRequest.id)
          })
          .map(item => ({
            id: item.id,
            section: item.fields['Section'] || '',
            fileName: item.fields['File Name'] || '',
            fileSize: item.fields['File Size'] || 0,
            dropboxLink: item.fields['Dropbox Link'] || '',
            dropboxPath: item.fields['Dropbox Path'] || '',
            uploadedAt: item.fields['Uploaded At'] || '',
            status: item.fields['Status'] || 'Draft',
          }))
      }
    } catch (err) {
      console.warn('[content-request] Could not fetch request/items:', err.message)
    }

    // Build sections from templates
    const sections = templates
      .filter(t => t.fields['Item Type'] !== 'info_only')
      .map(t => {
        const f = t.fields
        const sectionName = f['Name']
        const sectionFiles = uploadedFiles.filter(file => file.section === sectionName)
        let scripts = []
        try {
          scripts = f['Script Template'] ? JSON.parse(f['Script Template']) : []
        } catch (e) { /* ignore */ }

        return {
          name: sectionName,
          description: f['Description'] || '',
          sortOrder: f['Sort Order'] || 0,
          minCount: f['Item Count'] || 0,
          acceptedFileTypes: f['Accepted File Types'] || '',
          itemType: f['Item Type'] || 'file_upload',
          scripts,
          files: sectionFiles,
          uploadedCount: sectionFiles.length,
        }
      })

    // Instructions section (info_only)
    const instructions = templates.find(t => t.fields['Item Type'] === 'info_only')

    return NextResponse.json({
      request: contentRequest ? {
        id: contentRequest.id,
        title: contentRequest.fields['Title'] || 'Content Request',
        dueDate: contentRequest.fields['Due Date'] || '',
        status: contentRequest.fields['Status'] || 'Active',
        month: contentRequest.fields['Month'] || '',
      } : {
        id: null,
        title: 'Content Request Preview',
        dueDate: '',
        status: 'Active',
        month: new Date().toISOString().slice(0, 7),
      },
      sections,
      instructions: instructions ? instructions.fields['Description'] || '' : '',
    })
  } catch (err) {
    console.error('[content-request] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
