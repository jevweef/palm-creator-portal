import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CONTENT_REQUESTS = 'tblr1QLpcyD7p5HRb'
const CONTENT_REQUEST_ITEMS = 'tblXsW7GsyZrplVkq'
const CONTENT_REQUEST_TEMPLATES = 'tblpvD4cbs8KlbexQ'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

async function fetchAllRecords(table, params = {}) {
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
    if (params.fields) {
      params.fields.forEach(f => query.append('fields[]', f))
    }
    if (params.maxRecords) query.set('maxRecords', String(params.maxRecords))
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

    // Fetch creator name for filtering (linked record fields show names in formulas)
    const creatorRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}?fields%5B%5D=Creator`,
      { headers: airtableHeaders, cache: 'no-store' }
    )
    if (!creatorRes.ok) {
      return NextResponse.json({ request: null, sections: [], templates: [] })
    }
    const creator = await creatorRes.json()
    const creatorName = creator.fields?.['Creator'] || ''

    if (!creatorName) {
      return NextResponse.json({ request: null, sections: [], templates: [] })
    }

    // Find active content request for this creator using creator name
    const requests = await fetchAllRecords(CONTENT_REQUESTS, {
      filterByFormula: `AND({Status}="Active", FIND("${creatorName}", ARRAYJOIN({Creator})))`,
      maxRecords: 1,
    })

    if (!requests.length) {
      return NextResponse.json({ request: null, sections: [], templates: [] })
    }

    const contentRequest = requests[0]

    // Fetch templates and existing items in parallel
    const [templates, existingItems] = await Promise.all([
      fetchAllRecords(CONTENT_REQUEST_TEMPLATES, {
        sort: [{ field: 'Sort Order', direction: 'asc' }],
      }),
      fetchAllRecords(CONTENT_REQUEST_ITEMS, {
        filterByFormula: `AND(FIND("${contentRequest.fields['Title']}", ARRAYJOIN({Content Request})), FIND("${creatorName}", ARRAYJOIN({Creator})))`,
        sort: [
          { field: 'Section Order', direction: 'asc' },
          { field: 'Item Order', direction: 'asc' },
        ],
      }),
    ])

    // Build a lookup of existing items by section+order
    const existingByKey = {}
    for (const item of existingItems) {
      const key = `${item.fields['Section']}|${item.fields['Item Order']}`
      existingByKey[key] = item
    }

    // Build sections from templates, merging in any existing uploaded items
    const sections = []
    const templateInfo = []

    for (const tpl of templates) {
      const f = tpl.fields
      templateInfo.push({
        name: f['Name'],
        description: f['Description'] || '',
        sortOrder: f['Sort Order'] || 0,
        itemType: f['Item Type'] || 'file_upload',
        itemCount: f['Item Count'] || 0,
      })

      if (f['Item Type'] === 'info_only') continue

      const itemCount = f['Item Count'] || 0
      const labelPattern = f['Item Label Pattern'] || f['Name']
      const scripts = f['Script Template'] ? JSON.parse(f['Script Template']) : []
      const sectionItems = []

      for (let i = 1; i <= itemCount; i++) {
        const label = labelPattern.replace('{n}', String(i)).replace('#{n}', `#${i}`)
        const key = `${f['Name']}|${i}`
        const existing = existingByKey[key]

        if (existing) {
          // Use the real Airtable record
          sectionItems.push({
            id: existing.id,
            label: existing.fields['Label'] || label,
            status: existing.fields['Status'] || 'Not Started',
            scriptText: existing.fields['Script Text'] || scripts[i - 1] || '',
            dropboxPath: existing.fields['Dropbox Path'] || '',
            dropboxLink: existing.fields['Dropbox Link'] || '',
            fileName: existing.fields['File Name'] || '',
            fileSize: existing.fields['File Size'] || 0,
            uploadedAt: existing.fields['Uploaded At'] || '',
            creatorNotes: existing.fields['Creator Notes'] || '',
            adminNotes: existing.fields['Admin Notes'] || '',
            acceptedFileTypes: existing.fields['Accepted File Types'] || f['Accepted File Types'] || '',
            sectionOrder: f['Sort Order'] || 0,
            itemOrder: i,
          })
        } else {
          // Virtual item — no Airtable record yet (created on first upload)
          sectionItems.push({
            id: null, // No record yet
            label,
            status: 'Not Started',
            scriptText: scripts[i - 1] || '',
            dropboxPath: '',
            dropboxLink: '',
            fileName: '',
            fileSize: 0,
            uploadedAt: '',
            creatorNotes: '',
            adminNotes: '',
            acceptedFileTypes: f['Accepted File Types'] || '',
            sectionOrder: f['Sort Order'] || 0,
            itemOrder: i,
            // Info needed to create the record on first upload
            _section: f['Name'],
            _requestId: contentRequest.id,
            _creatorOpsId: creatorOpsId,
          })
        }
      }

      sections.push({
        name: f['Name'],
        items: sectionItems,
        order: f['Sort Order'] || 0,
      })
    }

    return NextResponse.json({
      request: {
        id: contentRequest.id,
        title: contentRequest.fields['Title'] || '',
        dueDate: contentRequest.fields['Due Date'] || '',
        status: contentRequest.fields['Status'] || '',
        month: contentRequest.fields['Month'] || '',
      },
      sections,
      templates: templateInfo,
    })
  } catch (err) {
    console.error('[content-request] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
