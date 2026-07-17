import { NextResponse } from 'next/server'
import { resolveGatedLink } from '@/lib/linkPages'

export const dynamic = 'force-dynamic'

// GET ?slug=&linkId= — returns the real destination URL for a gated link (and
// tallies the click). Called only by the /go interstitial's JS, so the URL
// never lands in server-rendered HTML that a scraper would read.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug') || ''
  const linkId = searchParams.get('linkId') || ''
  if (!slug || !linkId) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  try {
    const url = await resolveGatedLink(slug, linkId)
    if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
