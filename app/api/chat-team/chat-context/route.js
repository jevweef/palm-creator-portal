import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { readLiveMany } from '@/lib/ofLiveBuffer'
import { resolveChatTeamScope } from '@/lib/chatTeamScope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OPS_BASE = 'applLIT2t83plMqNx'
const ET = 'America/New_York'

// GET ?date=YYYY-MM-DD&creator=AKA&fan=name — the chat-manager view of the
// full conversation with a fan on that ET day, powering the "show
// conversation" expander on report flags. Mirror of the admin chat-context
// route, but gated for the chat team + scoped so a manager can only pull
// conversations for their OWN creators.
export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const url = new URL(request.url)
    const date = url.searchParams.get('date') || ''
    const creator = (url.searchParams.get('creator') || '').toLowerCase()
    const fan = (url.searchParams.get('fan') || '').toLowerCase().trim()
    if (!date || !creator || !fan) return NextResponse.json({ error: 'date, creator, fan required' }, { status: 400 })

    // A scoped (real chat-manager) caller may only read their own creators.
    if (scope.scoped && !scope.allowedAkas.has(creator)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    // OF auto-generates an incoming "message" reading "I sent you a $X tip"
    // whenever a fan tips — it's not typed by the fan, and the tip is already
    // captured as its own sale event (the 💰 line). Drop it so the thread
    // isn't polluted with fake fan messages.
    const isTipSystemMsg = (e) =>
      e.dir === 'in' && /^\s*i sent you a \$[\d,]+(\.\d{1,2})?\s*tip\b/i.test(String(e.text || '').replace(/<[^>]+>/g, ' '))
    const thread = events
      .filter((e) => e.at && dayOf(e.at) === date && matchFan(e) && !isTipSystemMsg(e))
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
