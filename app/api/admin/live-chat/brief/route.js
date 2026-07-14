import { NextResponse } from 'next/server'
import { requireLiveChatAccess } from '@/lib/adminAuth'
import { guardAccount } from '@/lib/chatTeamScope'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

// Whale-brief lookup for the live-chat sidebar. Given the fan the operator has
// open, resolve his latest full-history analysis (Manager Brief = the CHATTER
// CARD, plus the key stats) so it can render alongside the thread. Same robust
// username-first resolution the Suggest endpoint uses (name match is a fallback
// and skips when it's ambiguous across usernames — the Chris/Bren trap).

const OPS_BASE = 'applLIT2t83plMqNx'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const AT = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

async function atAll(table, params = {}, pages = 1) {
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

// Resolve the creator (AKA/name list) from the OF account id — used to scope a
// name-based fan match to the right creator.
async function resolveCreator(account) {
  const creators = await atAll('Palm Creators', {}, 2)
  const crec = creators.find((c) =>
    String(c.fields?.['OF API Account ID'] || '').split(',').map((s) => s.trim()).filter(Boolean).includes(account))
  const cf = crec?.fields || {}
  return [cf.AKA, cf.Creator].filter(Boolean)
}

// Find this fan's latest analysis record. Exported so /ask reuses it.
export async function resolveFanAnalysis({ account, fan, fanName }) {
  const creatorNames = account ? await resolveCreator(account) : []
  const tryQueries = []
  if (fan) tryQueries.push({ q: `{OF Username} = ${quoteAirtableString(fan)}`, byName: false })
  const nm = fanName || fan
  if (nm) tryQueries.push({ q: `{Fan Name} = ${quoteAirtableString(nm)}`, byName: true })
  for (const { q, byName } of tryQueries) {
    const recs = await atAll(FAN_ANALYSIS_TABLE, { filterByFormula: q, 'sort[0][field]': 'Analyzed Date', 'sort[0][direction]': 'desc' }, 1)
    const withAny = recs.filter((r) => r.fields['Manager Brief'] || r.fields['Full Analysis'])
    if (!withAny.length) continue
    const sameCreator = creatorNames.length
      ? withAny.filter((r) => creatorNames.some((n) => String(r.fields['Creator'] || '').toLowerCase() === String(n).toLowerCase()))
      : []
    const pool = sameCreator.length ? sameCreator : withAny
    if (byName) {
      const usernames = new Set(pool.map((r) => String(r.fields['OF Username'] || '').toLowerCase()).filter(Boolean))
      if (usernames.size > 1) continue // ambiguous name → don't guess
    }
    return pool[0].fields
  }
  return null
}

export async function POST(request) {
  try { await requireLiveChatAccess() } catch (e) { return e }
  try {
    const body = await request.json()
    const account = String(body.account || '')
    const fan = String(body.fan || '')
    const fanName = String(body.fanName || '')
    if (!fan) return NextResponse.json({ error: 'fan required' }, { status: 400 })
    try { await guardAccount(request, account) } catch (e) { return e }

    const f = await resolveFanAnalysis({ account, fan, fanName })
    if (!f) return NextResponse.json({ hasAnalysis: false })

    return NextResponse.json({
      hasAnalysis: true,
      fanName: f['Fan Name'] || '',
      username: f['OF Username'] || '',
      creator: f['Creator'] || '',
      brief: f['Manager Brief'] || '',
      fullAnalysis: f['Full Analysis'] || '',
      analyzedDate: f['Analyzed Date'] || null,
      stats: {
        lifetime: f['Lifetime Spend'] ?? null,
        currentGap: f['Current Gap (days)'] ?? null,
        medianGap: f['Median Gap (days)'] ?? null,
        lastPurchase: f['Last Purchase'] || null,
        lastMessage: f['Last Message Date'] || null,
      },
    })
  } catch (err) {
    console.error('[live-chat brief]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'brief failed' }, { status: 500 })
  }
}
