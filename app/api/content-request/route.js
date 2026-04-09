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
  const query = new URLSearchParams()
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
  return data.records || []
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

    // Step 1: Fetch templates (fast, always works — this is the structure)
    const templates = await fetchRecords(CONTENT_REQUEST_TEMPLATES, {
      sort: [{ field: 'Sort Order', direction: 'asc' }],
    })

    // Step 2: Try to find an active content request for this creator
    let contentRequest = null
    let existingItems = []
    try {
      const allActive = await fetchRecords(CONTENT_REQUESTS, {
        filterByFormula: `{Status}="Active"`,
      })
      // REST API linked records are plain arrays of record IDs
      contentRequest = allActive.find(r => {
        const links = r.fields['Creator'] || []
        return links.includes(creatorOpsId)
      })

      // Step 3: If we have a request, fetch any existing uploaded items
      if (contentRequest) {
        const allItems = await fetchRecords(CONTENT_REQUEST_ITEMS, {})
        existingItems = allItems.filter(item => {
          const reqLinks = item.fields['Content Request'] || []
          return reqLinks.includes(contentRequest.id)
        })
      }
    } catch (err) {
      // If content request / items fetch fails, still show structure from templates
      console.warn('[content-request] Could not fetch request/items:', err.message)
    }

    // Build lookup of existing items
    const existingByKey = {}
    for (const item of existingItems) {
      const key = `${item.fields['Section']}|${item.fields['Item Order']}`
      existingByKey[key] = item
    }

    // Build sections from templates
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
      let scripts = []
      try {
        scripts = f['Script Template'] ? JSON.parse(f['Script Template']) : []
      } catch (e) { /* ignore parse errors */ }

      const sectionItems = []

      for (let i = 1; i <= itemCount; i++) {
        const label = labelPattern.replace('{n}', String(i)).replace('#{n}', `#${i}`)
        const key = `${f['Name']}|${i}`
        const existing = existingByKey[key]

        if (existing) {
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
          sectionItems.push({
            id: null,
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
            _section: f['Name'],
            _requestId: contentRequest?.id || '',
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
      request: contentRequest ? {
        id: contentRequest.id,
        title: contentRequest.fields['Title'] || 'Content Request',
        dueDate: contentRequest.fields['Due Date'] || '',
        status: contentRequest.fields['Status'] || 'Active',
        month: contentRequest.fields['Month'] || '',
      } : {
        // Fallback so the UI still renders the structure
        id: null,
        title: 'Content Request Preview',
        dueDate: '',
        status: 'Active',
        month: '',
      },
      sections,
      templates: templateInfo,
    })
  } catch (err) {
    console.error('[content-request] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
