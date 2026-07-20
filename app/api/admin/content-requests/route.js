export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

// Admin oversight of content-request (Content Snare replacement) uploads.
// NO content preview by design — just the numbers: uploads vs required per
// section, upload times, direct Dropbox links, and the upload-error log.
// Aggregated per creator (per their Active request).
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const [requests, items, templates, creators, errors] = await Promise.all([
      fetchAirtableRecords('Content Requests', {
        filterByFormula: `{Status}='Active'`,
        fields: ['Title', 'Creator', 'Due Date', 'Status', 'Month', 'Account'],
      }),
      fetchAirtableRecords('Content Request Items', {
        fields: ['Section', 'Content Request', 'Creator', 'Status', 'Dropbox Path', 'Dropbox Link', 'File Name', 'File Size', 'Uploaded At'],
      }),
      fetchAirtableRecords('Content Request Templates', {
        fields: ['Name', 'Sort Order', 'Item Count', 'Item Type'],
      }),
      fetchAirtableRecords('Palm Creators', { fields: ['Creator', 'AKA'] }),
      fetchAirtableRecords('Portal Upload Errors', {
        fields: ['Error', 'Details', 'Creator', 'Creator HQ ID', 'Section', 'File Name', 'File Size', 'Stage', 'Reported At', 'Page'],
      }),
    ])

    const creatorName = Object.fromEntries(creators.map(c => [c.id, c.fields?.AKA || c.fields?.Creator || 'Unknown']))

    // Required-count-per-section from the templates (skip info-only sections).
    const sectionOrder = {}
    const sectionRequired = {}
    for (const t of templates) {
      const name = t.fields?.Name
      if (!name || t.fields?.['Item Type'] === 'info_only') continue
      sectionOrder[name] = t.fields?.['Sort Order'] ?? 999
      sectionRequired[name] = t.fields?.['Item Count'] || 0
    }

    // Group uploaded items by content-request id, then by section.
    const itemsByRequest = {}
    for (const it of items) {
      const reqId = (it.fields?.['Content Request'] || [])[0]
      if (!reqId) continue
      ;(itemsByRequest[reqId] ||= []).push(it.fields || {})
    }

    // Errors keyed by lowercased creator name for a loose match.
    const errorsByCreator = {}
    for (const e of errors) {
      const key = String(e.fields?.Creator || '').trim().toLowerCase()
      ;(errorsByCreator[key] ||= []).push({
        error: e.fields?.Error || '',
        details: e.fields?.Details || '',
        section: e.fields?.Section || '',
        fileName: e.fields?.['File Name'] || '',
        fileSize: e.fields?.['File Size'] || 0,
        stage: e.fields?.Stage || '',
        page: e.fields?.Page || '',
        reportedAt: e.fields?.['Reported At'] || '',
      })
    }

    const result = requests.map(r => {
      const f = r.fields || {}
      const crId = (f.Creator || [])[0] || null
      const name = crId ? creatorName[crId] : (f.Title || 'Unknown')
      const reqItems = itemsByRequest[r.id] || []

      // Build section rows: required (template) vs uploaded (items with a link).
      const bySection = {}
      for (const it of reqItems) {
        const s = it.Section || 'Other'
        ;(bySection[s] ||= []).push(it)
      }
      const allSectionNames = [...new Set([...Object.keys(sectionRequired), ...Object.keys(bySection)])]
      const sections = allSectionNames
        .map(s => {
          const its = (bySection[s] || []).filter(i => i['Dropbox Link'])
          return {
            name: s,
            order: sectionOrder[s] ?? 999,
            required: sectionRequired[s] || 0,
            uploaded: its.length,
            items: its
              .map(i => ({
                fileName: i['File Name'] || '',
                fileSize: i['File Size'] || 0,
                dropboxLink: i['Dropbox Link'] || '',
                dropboxPath: i['Dropbox Path'] || '',
                uploadedAt: i['Uploaded At'] || '',
                status: i.Status || '',
              }))
              .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)),
          }
        })
        .sort((a, b) => a.order - b.order)

      const totalRequired = sections.reduce((n, s) => n + s.required, 0)
      const totalUploaded = sections.reduce((n, s) => n + s.uploaded, 0)
      const lastUploadAt = sections.flatMap(s => s.items).map(i => i.uploadedAt).filter(Boolean).sort().slice(-1)[0] || ''

      return {
        requestId: r.id,
        creatorId: crId,
        creator: name,
        account: f.Account || '',
        title: f.Title || '',
        month: f.Month || '',
        dueDate: f['Due Date'] || '',
        status: f.Status || '',
        totalRequired,
        totalUploaded,
        lastUploadAt,
        sections,
        errors: errorsByCreator[String(name).toLowerCase()] || [],
      }
    }).sort((a, b) => a.creator.localeCompare(b.creator))

    return NextResponse.json({ creators: result })
  } catch (err) {
    console.error('[admin/content-requests] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
