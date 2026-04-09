import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireAdmin()

    const opsRecords = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `OR({Status} = 'Active', {Status} = 'Onboarding')`,
      fields: ['Creator', 'AKA', 'Status', 'HQ Record ID', 'Profile Analysis Status'],
      sort: [{ field: 'Creator', direction: 'asc' }],
    })

    const creators = opsRecords.map(r => ({
      id: r.id,
      hqId: r.fields?.['HQ Record ID'] || null,
      name: r.fields?.Creator || '',
      aka: r.fields?.AKA || '',
      status: r.fields?.Status?.name || r.fields?.Status || '',
      profileAnalysisStatus: r.fields?.['Profile Analysis Status'] || 'Not Started',
    }))

    // Fetch Management Start Date from HQ Creators table
    const hqIds = creators.map(c => c.hqId).filter(Boolean)
    if (hqIds.length > 0) {
      try {
        const HQ_BASE = 'appL7c4Wtotpz07KS'
        const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
        const hqHeaders = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }
        const params = new URLSearchParams()
        params.set('returnFieldsByFieldId', 'true')
        params.append('fields[]', 'flddRQe5WGegIBomQ') // Management Start Date
        hqIds.forEach(id => params.append('recordIds[]', id))
        const hqRes = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}?${params}`, { headers: hqHeaders, cache: 'no-store' })
        const hqData = await hqRes.json()
        const hqMap = {}
        for (const rec of (hqData.records || [])) {
          hqMap[rec.id] = rec.fields?.['flddRQe5WGegIBomQ'] || null
        }
        for (const c of creators) {
          c.managementStartDate = c.hqId ? (hqMap[c.hqId] || null) : null
        }
      } catch (e) {
        console.error('Failed to fetch HQ dates:', e)
      }
    }

    return NextResponse.json({ creators })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Palm creators GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
