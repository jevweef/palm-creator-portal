import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Brett's webhook endpoint (wh_f607c221…, registered 2026-06-06 for his site
// rebuild). WE DO NOT CONSUME IT — Palm's own webhook (wh_cd975aee…) delivers
// to /api/webhooks/of, which is the only path our pipeline processes. This
// stub just acknowledges deliveries so his webhook doesn't error while his
// system is elsewhere. (Evan, 2026-07-04: "we're not supposed to be using
// Brett's webhook — I made my own so we get the data separately.")

export async function GET() {
  return NextResponse.json({ ok: true, receiver: 'brett-passthrough (not consumed by Palm)' })
}

export async function POST() {
  return NextResponse.json({ ok: true })
}
