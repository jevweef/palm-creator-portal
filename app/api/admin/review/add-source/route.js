import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

const BASE_ID = 'applLIT2t83plMqNx'
const SOURCES_TABLE = 'tblH0K1xMsBonqmMx'

export async function POST(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const { handle } = await request.json()
    if (!handle) return NextResponse.json({ error: 'Missing handle' }, { status: 400 })

    const clean = handle.trim().replace(/^@/, '')

    // Check if already exists
    const checkRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${SOURCES_TABLE}?filterByFormula=${encodeURIComponent(`{Handle}='${clean}'`)}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } }
    )
    const checkData = await checkRes.json()
    if (checkData.records?.length > 0) {
      return NextResponse.json({ ok: true, alreadyExists: true })
    }

    const createRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${SOURCES_TABLE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: { Handle: clean, Platform: 'Instagram' } }),
      }
    )
    if (!createRes.ok) throw new Error(`Airtable ${createRes.status}`)
    return NextResponse.json({ ok: true, alreadyExists: false })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
