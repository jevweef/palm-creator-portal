import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { readLiveMany } from '@/lib/ofLiveBuffer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OPS_BASE = 'applLIT2t83plMqNx'
const ET = 'America/New_York'

// GET ?date=YYYY-MM-DD&creator=AKA&fan=name — the full conversation with that
// fan on that ET day, from the live-events log. Powers the "show conversation"
// expander on report flags (Evan: "All I really see is a single message and
// then an AI summary").
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const url = new URL(request.url)
    const date = url.searchParams.get('date') || ''
    const creator = (url.searchParams.get('creator') || '').toLowerCase()
    const fan = (url.searchParams.get('fan') || '').toLowerCase().trim()
    if (!date || !creator || !fan) return NextResponse.json({ error: 'date, creator, fan required' }, { status: 400 })

    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?pageSize=100`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store',
    })
    const recs = (await res.json()).records || []
    const rec = recs.find((r) => (r.fields?.AKA || r.fields?.Creator || '').toLowerCase() === creator)
    if (!rec?.fields?.['OF API Account ID']) return NextResponse.json({ error: `no OF account for ${creator}` }, { status: 404 })
    const ids = String(rec.fields['OF API Account ID']).split(',').map((x) => x.trim()).filter(Boolean)

    const byAccount = await readLiveMany(ids, { limit: 20000 })
    const events = ids.flatMap((id) => byAccount[id] || [])
    const dayOf = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
    const matchFan = (e) => {
      const n = (e.fan?.name || '').toLowerCase().trim()
      const u = (e.fan?.username || '').toLowerCase().trim()
      return n === fan || u === fan || (fan.length > 3 && (n.includes(fan) || u.includes(fan)))
    }
    const thread = events
      .filter((e) => e.at && dayOf(e.at) === date && matchFan(e))
      .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      .map((e) => ({
        at: e.at,
        time: new Date(e.at).toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }),
        dir: e.dir,
        text: String(e.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        price: e.price || null,
      }))
    return NextResponse.json({ thread, fan, creator: rec.fields.AKA || rec.fields.Creator, date })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
