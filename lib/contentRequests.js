// Shared builder for the Content Request oversight view (admin + team-scoped
// chat-manager mirror). Groups upload progress by CREATOR for a given month, so
// the UI can show one compact card per creator (with % uploaded) and expand each
// content request into a modal. No content preview — just counts, times, links,
// and the upload-error log. Self-contained Airtable access (server PAT).

const OPS_BASE = 'applLIT2t83plMqNx'
const H = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

async function fetchAll(table, params = {}) {
  let out = []
  const p = new URLSearchParams(params)
  p.set('pageSize', '100')
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${p}`, { headers: H, cache: 'no-store' })
    const j = await res.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

// Returns { month, availableMonths:[...], creators:[...] }.
// Each creator: { creator, creatorId, akaLower, totalRequired, totalUploaded,
//   errorCount, requests:[ { requestId, account, title, month, status, dueDate,
//   totalRequired, totalUploaded, lastUploadAt, sections:[...], errors:[...] } ] }
export async function buildContentRequestOverview({ month } = {}) {
  const [requests, items, templates, creators, errors] = await Promise.all([
    fetchAll('Content Requests'),
    fetchAll('Content Request Items'),
    fetchAll('Content Request Templates'),
    fetchAll('Palm Creators'),
    fetchAll('Portal Upload Errors'),
  ])

  const creatorName = Object.fromEntries(creators.map((c) => [c.id, c.fields?.AKA || c.fields?.Creator || 'Unknown']))

  // Distinct months, newest first; default to the newest present.
  const availableMonths = [...new Set(requests.map((r) => r.fields?.Month).filter(Boolean))].sort().reverse()
  const activeMonth = month && availableMonths.includes(month) ? month : (availableMonths[0] || '')

  const monthRequests = requests.filter((r) => (r.fields?.Month || '') === activeMonth)

  // Required-count-per-section from templates (skip info-only sections).
  const sectionOrder = {}, sectionRequired = {}
  for (const t of templates) {
    const name = t.fields?.Name
    if (!name || t.fields?.['Item Type'] === 'info_only') continue
    sectionOrder[name] = t.fields?.['Sort Order'] ?? 999
    sectionRequired[name] = t.fields?.['Item Count'] || 0
  }

  const itemsByRequest = {}
  for (const it of items) {
    const reqId = (it.fields?.['Content Request'] || [])[0]
    if (!reqId) continue
    ;(itemsByRequest[reqId] ||= []).push(it.fields || {})
  }

  const errorsByCreator = {}
  for (const e of errors) {
    const key = String(e.fields?.Creator || '').trim().toLowerCase()
    ;(errorsByCreator[key] ||= []).push({
      error: e.fields?.Error || '', details: e.fields?.Details || '',
      section: e.fields?.Section || '', fileName: e.fields?.['File Name'] || '',
      fileSize: e.fields?.['File Size'] || 0, stage: e.fields?.Stage || '',
      page: e.fields?.Page || '', reportedAt: e.fields?.['Reported At'] || '',
    })
  }

  // Build one object per request (account), then group by creator.
  const perRequest = monthRequests.map((r) => {
    const f = r.fields || {}
    const crId = (f.Creator || [])[0] || null
    const name = crId ? creatorName[crId] : (f.Title || 'Unknown')
    const reqItems = itemsByRequest[r.id] || []

    const bySection = {}
    for (const it of reqItems) { const s = it.Section || 'Other'; (bySection[s] ||= []).push(it) }
    const allNames = [...new Set([...Object.keys(sectionRequired), ...Object.keys(bySection)])]
    const sections = allNames.map((s) => {
      const its = (bySection[s] || []).filter((i) => i['Dropbox Link'])
      return {
        name: s, order: sectionOrder[s] ?? 999, required: sectionRequired[s] || 0, uploaded: its.length,
        items: its.map((i) => ({
          fileName: i['File Name'] || '', fileSize: i['File Size'] || 0,
          dropboxLink: i['Dropbox Link'] || '', dropboxPath: i['Dropbox Path'] || '',
          uploadedAt: i['Uploaded At'] || '', status: i.Status || '',
        })).sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)),
      }
    }).sort((a, b) => a.order - b.order)

    const totalRequired = sections.reduce((n, s) => n + s.required, 0)
    const totalUploaded = sections.reduce((n, s) => n + s.uploaded, 0)
    const lastUploadAt = sections.flatMap((s) => s.items).map((i) => i.uploadedAt).filter(Boolean).sort().slice(-1)[0] || ''

    return {
      requestId: r.id, creatorId: crId, creator: name, akaLower: String(name).toLowerCase(),
      account: f.Account || '', title: f.Title || '', month: f.Month || '', status: f.Status || '',
      dueDate: f['Due Date'] || '', totalRequired, totalUploaded, lastUploadAt, sections,
      errors: errorsByCreator[String(name).toLowerCase()] || [],
    }
  })

  // Group by creator (Free + VIP accounts share one card).
  const byCreator = {}
  for (const req of perRequest) {
    const key = req.creatorId || req.creator
    if (!byCreator[key]) {
      byCreator[key] = {
        creator: req.creator, creatorId: req.creatorId, akaLower: req.akaLower,
        totalRequired: 0, totalUploaded: 0, errorCount: 0, requests: [],
      }
    }
    const g = byCreator[key]
    g.requests.push(req)
    g.totalRequired += req.totalRequired
    g.totalUploaded += req.totalUploaded
    g.errorCount += req.errors.length
  }

  const list = Object.values(byCreator).sort((a, b) => a.creator.localeCompare(b.creator))
  return { month: activeMonth, availableMonths, creators: list }
}
