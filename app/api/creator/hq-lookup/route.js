export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

// Look up the linked HQ Creator id for a given Ops creator.
// Used by /creator/[id]/* pages as a fallback when the URL is missing
// the ?hqId= query param (e.g. an admin viewing as a creator clicked
// an internal link that didn't propagate hqId). Without this fallback
// the page would fall back to the signed-in user's clerk metadata,
// which for an admin points to a different creator and shows the
// wrong dashboard.
export async function GET(req) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const opsId = searchParams.get('opsId')
  if (!opsId) return NextResponse.json({ error: 'Missing opsId' }, { status: 400 })

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/applLIT2t83plMqNx/Palm%20Creators/${opsId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
        },
        cache: 'no-store',
      }
    )
    if (!res.ok) {
      const t = await res.text()
      return NextResponse.json({ error: `Airtable ${res.status}: ${t}` }, { status: res.status })
    }
    const data = await res.json()
    const hqId = data?.fields?.['HQ Record ID'] || null
    return NextResponse.json({ opsId, hqId })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
