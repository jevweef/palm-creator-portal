import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// GET ?domain=<name> — check availability + price via the Vercel Domains API.
// Needs VERCEL_TOKEN (a Vercel API token) + optional VERCEL_TEAM_ID in env.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const token = process.env.VERCEL_TOKEN
  if (!token) {
    return NextResponse.json({ configured: false, message: 'Add VERCEL_TOKEN to env to enable domain search + purchase.' })
  }
  const domain = (new URL(request.url).searchParams.get('domain') || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return NextResponse.json({ error: 'Enter a full domain, e.g. juliafilippo.vip' }, { status: 400 })
  }
  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${process.env.VERCEL_TEAM_ID}` : ''
  const H = { Authorization: `Bearer ${token}` }
  try {
    const [statusRes, priceRes] = await Promise.all([
      fetch(`https://api.vercel.com/v4/domains/status?name=${encodeURIComponent(domain)}${team}`, { headers: H, cache: 'no-store' }),
      fetch(`https://api.vercel.com/v4/domains/price?name=${encodeURIComponent(domain)}&type=new${team}`, { headers: H, cache: 'no-store' }),
    ])
    const status = await statusRes.json().catch(() => ({}))
    const price = await priceRes.json().catch(() => ({}))
    return NextResponse.json({
      configured: true,
      domain,
      available: !!status.available,
      price: price?.price ?? null,
      period: price?.period ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
