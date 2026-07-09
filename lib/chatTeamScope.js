import { currentUser, clerkClient } from '@clerk/nextjs/server'

// Shared team-scoping for the chat-manager mirror routes (whale-hunting +
// chat-team report). Resolves which creators the caller may see:
//   - admin / super_admin (no ?viewAsUserId) → sees EVERYTHING (scoped:false)
//   - chat_manager → ONLY their team's creators (publicMetadata.chatTeam
//     "A"|"B"), fail closed to an empty set if the team is missing
//   - admin impersonating via ?viewAsUserId=<clerkId> → scoped to that
//     manager's team, same as the photo library / watchlist contract.
// AKAs are returned lowercased so callers can match the report's per-creator
// entries (which key on AKA) and the chat-context creator param directly.

const OPS_BASE = 'applLIT2t83plMqNx'
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const CHAT_TEAM_FIELD = 'fld4wToCuDZmVmFHb' // HQ Creators "Chat Team" (single-select)
const HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

async function fetchAll(base, table, params = {}) {
  let out = []
  const p = new URLSearchParams(params)
  p.set('pageSize', '100')
  for (let page = 0; page < 12; page++) {
    const res = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${p}`, { headers: HEADERS, cache: 'no-store' })
    const j = await res.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

// Returns:
//   { allowed:false }                                — not a chat-team role, reject
//   { allowed:true, scoped:false, allowedAkas:null } — admin, sees all
//   { allowed:true, scoped:true, allowedAkas:Set }   — scoped to a team (lowercased AKAs)
export async function resolveChatTeamScope(request) {
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (!['admin', 'super_admin', 'chat_manager'].includes(role)) return { allowed: false }

  const isAdmin = role === 'admin' || role === 'super_admin'
  let isRealChatManager = role === 'chat_manager'
  let userTeam = (user?.publicMetadata?.chatTeam || '').toString().toUpperCase()

  const viewAsUserId = isAdmin ? new URL(request.url).searchParams.get('viewAsUserId') : null
  if (viewAsUserId) {
    try {
      const client = await clerkClient()
      const target = await client.users.getUser(viewAsUserId)
      if (target?.publicMetadata?.role === 'chat_manager') {
        isRealChatManager = true
        userTeam = (target?.publicMetadata?.chatTeam || '').toString().toUpperCase()
      }
    } catch { /* fall back to admin's full view */ }
  }

  if (!isRealChatManager) return { allowed: true, scoped: false, allowedAkas: null }
  if (!userTeam) return { allowed: true, scoped: true, allowedAkas: new Set() } // fail closed

  // Resolve the team's creators: Palm Creators (AKA + HQ back-link) joined to
  // HQ Creators' Chat Team field. Same join the watchlist route uses.
  const creators = await fetchAll(OPS_BASE, 'Palm Creators')
  const creatorList = creators
    .filter((c) => {
      const status = typeof c.fields?.Status === 'string' ? c.fields.Status : c.fields?.Status?.name
      return status === 'Active' || !!c.fields?.['OF API Account ID']
    })
    .map((c) => ({ aka: (c.fields?.AKA || c.fields?.Creator || ''), hqId: c.fields?.['HQ Record ID'] || null }))

  // Pull Chat Team for every HQ record (paginated, indexed by record id).
  const hqRecords = await fetchAll(HQ_BASE, HQ_CREATORS, { returnFieldsByFieldId: 'true', 'fields[]': CHAT_TEAM_FIELD })
  const teamByHq = {}
  for (const rec of hqRecords) {
    const v = rec.fields?.[CHAT_TEAM_FIELD]
    teamByHq[rec.id] = (typeof v === 'string' ? v : v?.name || '').replace(/\s*Team$/i, '').trim().toUpperCase()
  }

  const allowedAkas = new Set(
    creatorList
      .filter((c) => c.hqId && teamByHq[c.hqId] === userTeam)
      .map((c) => c.aka.toLowerCase())
  )
  return { allowed: true, scoped: true, allowedAkas }
}
