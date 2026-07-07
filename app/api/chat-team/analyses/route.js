import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET — recent whale analyses for the chat-team view (/chat-team).
// Role-gated: admins and chat managers (Juan & co) only. Returns the manager
// brief + full analysis text straight from Airtable — replaces the low-res
// PDF-in-Telegram flow.

const OPS_BASE = 'applLIT2t83plMqNx'
const FAN_ANALYSIS_TABLE = 'tblNMtOEg2AIzvLDK'
const HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

async function requireChatTeam() {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (!['admin', 'super_admin', 'chat_manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function GET() {
  const denied = await requireChatTeam()
  if (denied) return denied
  try {
    // creator id → display name (analyses link Creator records)
    const cres = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?pageSize=100&fields%5B%5D=AKA&fields%5B%5D=Creator`,
      { headers: HEADERS, cache: 'no-store' },
    )
    const creators = (await cres.json()).records || []
    const nameById = Object.fromEntries(creators.map((r) => [r.id, r.fields?.AKA || r.fields?.Creator || '']))

    // Only fans whose alert was actually SENT to the team are visible here —
    // unsent analyses stay admin-only until Evan sends them.
    const tparams = new URLSearchParams()
    tparams.set('pageSize', '100')
    for (const f of ['Fan Name', 'OF Username', 'Last Alert Sent', 'First Flagged']) tparams.append('fields[]', f)
    tparams.set('filterByFormula', '{Last Alert Sent} != BLANK()')
    let sent = []
    for (let page = 0; page < 5; page++) {
      const tres = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Fan Tracker')}?${tparams}`, { headers: HEADERS, cache: 'no-store' })
      const tdata = await tres.json()
      sent = sent.concat(tdata.records || [])
      if (!tdata.offset) break
      tparams.set('offset', tdata.offset)
    }
    const sentByKey = new Map()
    for (const r of sent) {
      const f = r.fields || {}
      const meta = { firstFlagged: f['First Flagged'] || null, lastAlert: f['Last Alert Sent'] || null }
      if (f['OF Username']) sentByKey.set(String(f['OF Username']).toLowerCase(), meta)
      if (f['Fan Name']) sentByKey.set(String(f['Fan Name']).toLowerCase(), meta)
    }

    const params = new URLSearchParams()
    params.set('pageSize', '60')
    params.set('sort[0][field]', 'Analyzed Date')
    params.set('sort[0][direction]', 'desc')
    for (const f of ['Fan Name', 'OF Username', 'Creator', 'Analyzed Date', 'Manager Brief', 'Full Analysis', 'Analysis Type', 'Message Count']) {
      params.append('fields[]', f)
    }
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${FAN_ANALYSIS_TABLE}?${params}`, {
      headers: HEADERS, cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ error: `Airtable ${res.status}` }, { status: 502 })
    const data = await res.json()
    const analyses = (data.records || []).map((r) => {
      const f = r.fields || {}
      // Creator is a text field on some rows, a linked record on others
      const creator = Array.isArray(f.Creator) ? (nameById[f.Creator[0]] || '') : (f.Creator || '')
      const sentMeta = sentByKey.get(String(f['OF Username'] || '').toLowerCase()) || sentByKey.get(String(f['Fan Name'] || '').toLowerCase()) || null
      return {
        id: r.id,
        fanName: f['Fan Name'] || '',
        ofUsername: f['OF Username'] || '',
        creator,
        analyzedAt: f['Analyzed Date'] || '',
        type: f['Analysis Type']?.name || f['Analysis Type'] || '',
        managerBrief: f['Manager Brief'] || '',
        fullAnalysis: f['Full Analysis'] || '',
        messageCount: f['Message Count'] || 0,
        firstFlagged: sentMeta?.firstFlagged || null,
        sent: !!sentMeta,
      }
    }).filter((a) => (a.managerBrief || a.fullAnalysis) && a.sent)
    return NextResponse.json({ analyses })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
