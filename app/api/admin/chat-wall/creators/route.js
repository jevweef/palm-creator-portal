export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrChatManager, fetchAirtableRecords } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// GET /api/admin/chat-wall/creators
// Returns active Palm Creators (Ops) joined with Chat Team from HQ Creators.
// Used by the chat manager UI to filter creators by A / B team.
export async function GET() {
  try {
    await requireAdminOrChatManager()
  } catch (e) {
    return e
  }

  try {
    // Active Ops creators
    const opsRecords = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `OR({Status} = 'Active', {Status} = 'Onboarding')`,
      fields: ['Creator', 'AKA', 'Status', 'HQ Record ID'],
      sort: [{ field: 'Creator', direction: 'asc' }],
    })

    const creators = opsRecords.map(r => ({
      id: r.id,
      hqId: r.fields?.['HQ Record ID'] || null,
      name: r.fields?.Creator || '',
      aka: r.fields?.AKA || '',
      status: typeof r.fields?.Status === 'string' ? r.fields.Status : (r.fields?.Status?.name || ''),
      chatTeam: null,
    }))

    // Pull Chat Team for each from HQ
    const hqIds = creators.map(c => c.hqId).filter(Boolean)
    if (hqIds.length > 0) {
      const headers = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }
      const params = new URLSearchParams()
      params.set('returnFieldsByFieldId', 'true')
      params.append('fields[]', 'fld4wToCuDZmVmFHb') // Chat Team
      hqIds.forEach(id => params.append('recordIds[]', id))
      const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}?${params}`, { headers, cache: 'no-store' })
      const data = await res.json()
      const map = {}
      for (const rec of (data.records || [])) {
        const v = rec.fields?.['fld4wToCuDZmVmFHb']
        map[rec.id] = typeof v === 'string' ? v : (v?.name || null)
      }
      for (const c of creators) {
        c.chatTeam = c.hqId ? (map[c.hqId] || null) : null
      }
    }

    return NextResponse.json({ creators })
  } catch (err) {
    console.error('[chat-wall/creators] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
