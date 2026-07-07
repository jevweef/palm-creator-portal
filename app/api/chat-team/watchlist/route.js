import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET — the chat-manager Save List: same rows the admin whale-hunting grid
// shows, filtered to fans whose alert was actually SENT to the team. Backed
// by the same Fan Tracker data as /api/admin/whales/overview.

const OPS_BASE = 'applLIT2t83plMqNx'
const HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

async function fetchAll(table, params) {
  let out = []
  const p = new URLSearchParams(params)
  p.set('pageSize', '100')
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${p}`, { headers: HEADERS, cache: 'no-store' })
    const j = await res.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

export async function GET() {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (!['admin', 'super_admin', 'chat_manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const [creators, tracker] = await Promise.all([
      fetchAll('Palm Creators', {}),
      fetchAll('Fan Tracker', { filterByFormula: '{Last Alert Sent} != BLANK()' }),
    ])
    const creatorList = creators
      .filter((c) => {
        const status = typeof c.fields?.Status === 'string' ? c.fields.Status : c.fields?.Status?.name
        return status === 'Active' || !!c.fields?.['OF API Account ID']
      })
      .map((c) => ({ id: c.id, name: c.fields?.Creator || '', aka: c.fields?.AKA || c.fields?.Creator || '' }))
      .sort((a, b) => a.aka.localeCompare(b.aka))
    const nameById = Object.fromEntries(creatorList.map((c) => [c.id, c.aka]))

    const watchlist = tracker
      .map((r) => {
        const f = r.fields || {}
        const creatorId = (f.Creator || [])[0] || null
        const status = typeof f.Status === 'string' ? f.Status : f.Status?.name
        return {
          id: r.id,
          fanName: f['Fan Name'] || '',
          ofUsername: f['OF Username'] || '',
          creatorId,
          creator: nameById[creatorId] || '',
          status: status || '',
          lifetime: f['Lifetime Spend'] || 0,
          firstFlagged: f['First Flagged'] || null,
          lastAlert: f['Last Alert Sent'] || null,
          cadence: (() => { try { return JSON.parse(f.Cadence || 'null') } catch { return null } })(),
        }
      })
      .filter((w) => w.status && !['Banned', 'Deleted'].includes(w.status))
      .sort((a, b) => b.lifetime - a.lifetime)

    return NextResponse.json({ creators: creatorList, watchlist })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
