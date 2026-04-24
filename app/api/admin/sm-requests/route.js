export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchHqRecords } from '@/lib/hqAirtable'

const SM_SETUP_REQUESTS_TABLE = 'SM Setup Requests'
const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

// GET /api/admin/sm-requests
// Returns all SM Setup Requests, enriched with creator HQ data (profile photos, birthday).
export async function GET() {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const requests = await fetchAirtableRecords(SM_SETUP_REQUESTS_TABLE, {
      sort: [{ field: 'Status', direction: 'asc' }, { field: 'Requested At', direction: 'desc' }],
    })

    // Get all linked HQ Creator IDs via the Palm Creators (Ops) link. The
    // request links to Ops; HQ Record ID is stored on the Ops record.
    const opsCreatorIds = [...new Set(requests.flatMap(r => r.fields?.Creator || []).filter(Boolean))]

    const opsCreators = opsCreatorIds.length ? await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `OR(${opsCreatorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
      fields: ['Creator', 'AKA', 'HQ Record ID'],
    }) : []
    const opsToHq = Object.fromEntries(opsCreators.map(c => [c.id, c.fields?.['HQ Record ID'] || null]))

    const hqIds = [...new Set(Object.values(opsToHq).filter(Boolean))]
    const hqRecords = hqIds.length ? await fetchHqRecords(HQ_CREATORS_TABLE, {
      filterByFormula: `OR(${hqIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
      fields: ['Creator', 'AKA', 'Birthday', 'Profile Photos'],
    }) : []
    const hqMap = Object.fromEntries(hqRecords.map(r => [r.id, r.fields || {}]))

    const normalized = requests.map(r => {
      const f = r.fields || {}
      const opsId = (f.Creator || [])[0] || null
      const hqId = opsId ? opsToHq[opsId] : null
      const hq = hqId ? (hqMap[hqId] || {}) : {}
      // Photos come from HQ Creators (canonical), fall back to request's own Profile Pics
      const photos = (hq['Profile Photos'] || f['Profile Pics'] || []).map(p => ({
        id: p.id, url: p.url, filename: p.filename, thumbnail: p.thumbnails?.large?.url || p.url,
      }))
      return {
        id: r.id,
        fullName: f['Full Name'] || hq['Creator'] || '',
        aka: f['AKA'] || hq['AKA'] || '',
        dob: f['DOB'] || hq['Birthday'] || null,
        opsCreatorId: opsId,
        hqCreatorId: hqId,
        status: f['Status'] || 'Pending',
        requestedAt: f['Requested At'] || null,
        completedAt: f['Completed At'] || null,
        notes: f['Notes'] || '',
        photos,
        slots: [1, 2, 3].map(n => ({
          n,
          candidates: f[`Slot ${n} Username Candidates`] || '',
          handle: f[`Slot ${n} Handle`] || '',
          done: !!f[`Slot ${n} Done`],
        })),
      }
    })

    return NextResponse.json({ requests: normalized })
  } catch (err) {
    console.error('[sm-requests] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
