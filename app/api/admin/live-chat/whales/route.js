import { NextResponse } from 'next/server'
import { requireLiveChatAccess } from '@/lib/adminAuth'
import { guardAccount } from '@/lib/chatTeamScope'

export const dynamic = 'force-dynamic'

// Whales list for the live-chat left column "Whales" tab: every fan of the
// selected creator who has a full-history analysis on file (i.e. we've scraped
// + analyzed him), newest-analysis-per-fan, biggest spender first. Clicking one
// opens his thread + the whale brief sidebar.

const OPS_BASE = 'applLIT2t83plMqNx'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const AT = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

async function atAll(table, params = {}, pages = 4) {
  let out = []
  const p = new URLSearchParams(params)
  p.set('pageSize', '100')
  for (let i = 0; i < pages; i++) {
    const r = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${p}`, { headers: AT, cache: 'no-store' })
    const j = await r.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

export async function GET(request) {
  try { await requireLiveChatAccess() } catch (e) { return e }
  try {
    const account = new URL(request.url).searchParams.get('account') || ''
    if (!account) return NextResponse.json({ whales: [] })
    try { await guardAccount(request, account) } catch (e) { return e }

    // Resolve the creator's names from the OF account id.
    const creators = await atAll('Palm Creators', {}, 2)
    const crec = creators.find((c) =>
      String(c.fields?.['OF API Account ID'] || '').split(',').map((s) => s.trim()).filter(Boolean).includes(account))
    const names = [crec?.fields?.AKA, crec?.fields?.Creator].filter(Boolean).map((s) => String(s).toLowerCase())
    if (!names.length) return NextResponse.json({ whales: [] })

    const rows = await atAll(FAN_ANALYSIS_TABLE, {
      'sort[0][field]': 'Analyzed Date', 'sort[0][direction]': 'desc',
    }, 4)

    // Keep this creator's fans; dedup to the latest analysis per fan.
    const byFan = new Map()
    for (const r of rows) {
      const f = r.fields || {}
      if (!names.includes(String(f['Creator'] || '').toLowerCase())) continue
      const key = String(f['OF Username'] || '').toLowerCase() || ('name:' + String(f['Fan Name'] || '').toLowerCase())
      if (!key || byFan.has(key)) continue // rows are newest-first, so first seen = latest
      byFan.set(key, {
        fanName: f['Fan Name'] || '',
        username: f['OF Username'] || '',
        lifetime: f['Lifetime Spend'] ?? null,
        currentGap: f['Current Gap (days)'] ?? null,
        analyzedDate: f['Analyzed Date'] || null,
      })
    }
    const whales = [...byFan.values()].sort((a, b) => (b.lifetime || 0) - (a.lifetime || 0))
    return NextResponse.json({ whales })
  } catch (err) {
    console.error('[live-chat whales]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'whales failed', whales: [] }, { status: 500 })
  }
}
