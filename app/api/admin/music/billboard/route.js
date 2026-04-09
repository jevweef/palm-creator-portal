export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { getBillboardHot100 } from '@/lib/spotify'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

export async function GET() {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    // Try Airtable cache first
    const cacheRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/tbl0k3UErL1JRObHD?filterByFormula={Step}='Billboard Chart Cache'&maxRecords=1`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (cacheRes.ok) {
      const cacheData = await cacheRes.json()
      const record = cacheData.records?.[0]
      if (record?.fields?.Notes) {
        try {
          const cached = JSON.parse(record.fields.Notes)
          const age = Date.now() - new Date(cached.scrapedAt).getTime()
          if (age < 48 * 60 * 60 * 1000 && cached.tracks?.length > 0) {
            return NextResponse.json({ ok: true, tracks: cached.tracks, cached: true })
          }
        } catch {}
      }
    }

    // Fallback: scrape live
    const tracks = await getBillboardHot100()
    return NextResponse.json({ ok: true, tracks })
  } catch (err) {
    console.error('[Billboard] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
