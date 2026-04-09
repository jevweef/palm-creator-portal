import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CONTENT_REQUESTS = 'tblr1QLpcyD7p5HRb'
const CONTENT_REQUEST_ITEMS = 'tblXsW7GsyZrplVkq'
const CONTENT_REQUEST_TEMPLATES = 'tblpvD4cbs8KlbexQ'

const headers = {
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
    const url = `https://api.airtable.com/v0/${OPS_BASE}/${table}?${query}`
    const res = await fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)
  return records
}

async function createItemsFromTemplates(requestId, creatorOpsId) {
  // Fetch all templates sorted by order
  const templates = await fetchAllRecords(CONTENT_REQUEST_TEMPLATES, {
    sort: [{ field: 'Sort Order', direction: 'asc' }],
  })

  const itemsToCreate = []

  for (const tpl of templates) {
    const f = tpl.fields
    if (f['Item Type'] === 'info_only') continue // Skip info-only sections (Instructions)

    const itemCount = f['Item Count'] || 0
    const labelPattern = f['Item Label Pattern'] || f['Name']
    const scripts = f['Script Template'] ? JSON.parse(f['Script Template']) : []
    const sectionOrder = f['Sort Order'] || 0

    for (let i = 1; i <= itemCount; i++) {
      const label = labelPattern.replace('{n}', String(i)).replace('#{n}', `#${i}`)
      itemsToCreate.push({
        fields: {
          Label: label,
          Section: f['Name'],
          'Section Order': sectionOrder,
          'Item Order': i,
          'Content Request': [requestId],
          Creator: [creatorOpsId],
          Status: 'Not Started',
          'Script Text': scripts[i - 1] || '',
          'Accepted File Types': f['Accepted File Types'] || '',
        },
      })
    }
  }

  // Create in batches of 10
  for (let i = 0; i < itemsToCreate.length; i += 10) {
    const batch = itemsToCreate.slice(i, i + 10)
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${CONTENT_REQUEST_ITEMS}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ records: batch }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`[content-request] Failed to create items batch ${i}:`, err)
    }
  }

  // Re-fetch items to return them
  return fetchAllRecords(CONTENT_REQUEST_ITEMS, {
    filterByFormula: `{Content Request}="${requestId}"`,
    sort: [
      { field: 'Section Order', direction: 'asc' },
      { field: 'Item Order', direction: 'asc' },
    ],
  })
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

    // Allow admin to pass creatorOpsId as query param
    const { searchParams } = new URL(request.url)
    const creatorOpsId = isAdmin ? (searchParams.get('creatorOpsId') || opsId) : opsId

    if (!creatorOpsId) {
      return NextResponse.json({ error: 'No creator profile linked' }, { status: 400 })
    }

    // Find active content request for this creator
    const filter = `AND({Status}="Active", FIND("${creatorOpsId}", ARRAYJOIN({Creator})))`
    const requests = await fetchAllRecords(CONTENT_REQUESTS, {
      filterByFormula: filter,
    })

    if (!requests.length) {
      return NextResponse.json({ request: null, items: [], sections: [], templates: [] })
    }

    const contentRequest = requests[0]

    // Fetch items for this request
    let items = await fetchAllRecords(CONTENT_REQUEST_ITEMS, {
      filterByFormula: `FIND("${contentRequest.id}", ARRAYJOIN({Content Request}))`,
      sort: [
        { field: 'Section Order', direction: 'asc' },
        { field: 'Item Order', direction: 'asc' },
      ],
    })

    // If no items exist yet, generate them from templates
    if (items.length === 0) {
      items = await createItemsFromTemplates(contentRequest.id, creatorOpsId)
    }

    // Fetch templates for section descriptions
    const templates = await fetchAllRecords(CONTENT_REQUEST_TEMPLATES, {
      sort: [{ field: 'Sort Order', direction: 'asc' }],
    })

    // Group items by section
    const sectionMap = {}
    for (const item of items) {
      const section = item.fields['Section'] || 'Other'
      if (!sectionMap[section]) {
        sectionMap[section] = { name: section, items: [], order: item.fields['Section Order'] || 99 }
      }
      sectionMap[section].items.push({
        id: item.id,
        label: item.fields['Label'] || '',
        status: item.fields['Status'] || 'Not Started',
        scriptText: item.fields['Script Text'] || '',
        dropboxPath: item.fields['Dropbox Path'] || '',
        dropboxLink: item.fields['Dropbox Link'] || '',
        fileName: item.fields['File Name'] || '',
        fileSize: item.fields['File Size'] || 0,
        uploadedAt: item.fields['Uploaded At'] || '',
        creatorNotes: item.fields['Creator Notes'] || '',
        adminNotes: item.fields['Admin Notes'] || '',
        acceptedFileTypes: item.fields['Accepted File Types'] || '',
        sectionOrder: item.fields['Section Order'] || 0,
        itemOrder: item.fields['Item Order'] || 0,
      })
    }

    const sections = Object.values(sectionMap).sort((a, b) => a.order - b.order)

    // Build template info for section descriptions
    const templateInfo = templates.map(t => ({
      name: t.fields['Name'],
      description: t.fields['Description'] || '',
      sortOrder: t.fields['Sort Order'] || 0,
      itemType: t.fields['Item Type'] || 'file_upload',
      itemCount: t.fields['Item Count'] || 0,
    }))

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
