import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { ofApi, pickOfAccountId } from '@/lib/onlyfansApi'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/admin/link-pages/tracking-link
 * Body: { creatorId (Ops Palm Creators rec id), name }
 *
 * Creates an OnlyFans TRACKING LINK on the creator's account and returns its
 * campaign URL — the Multi-Link builder inserts it as a gated OnlyFans link so
 * every multi-link click is attributable, and IG's scraper never sees the URL.
 *
 * NOTE: deliberate exception to the OF read-only policy (lib/onlyfansApi.js).
 * Evan approved this one write (2026-07-21): creating a tracking link is a
 * settings-level, non-content write with negligible ban surface.
 */
export async function POST(request) {
  try {
    await requireAdmin()
    const { creatorId, name } = await request.json()
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
    }
    const cleanName = String(name || '').trim().slice(0, 100)
    if (!cleanName) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const recs = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const acct = pickOfAccountId(recs[0]?.fields?.['OF API Account ID'])
    if (!acct) {
      return NextResponse.json({ error: 'This creator has no OnlyFans API account connected.' }, { status: 400 })
    }

    const res = await ofApi(`/${acct}/tracking-links`, { method: 'POST', body: { name: cleanName } })
    const t = res?.data || {}
    const url = t.campaignUrl || t.url
    if (!url) return NextResponse.json({ error: 'Tracking link created but no URL returned — check OF.' }, { status: 502 })

    return NextResponse.json({ success: true, name: t.campaignName || cleanName, url })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[link-pages/tracking-link] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
