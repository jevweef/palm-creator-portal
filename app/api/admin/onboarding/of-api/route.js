import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { fetchHqRecord, fetchHqRecords, patchHqRecord, createHqRecord } from '@/lib/hqAirtable'
import { ofApi } from '@/lib/onlyfansApi'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_REVENUE_ACCOUNTS = 'Revenue Accounts'
const OPS_PALM_CREATORS = 'Palm Creators'

// POST — per-ACCOUNT OnlyFansAPI wiring from the onboarding board.
//
// The connect decision lives on each HQ Revenue Accounts record ('OF API
// Connect' = Connect | Skip, 'OF API Account ID' = acct_…), because a creator
// can have a Free and a VIP account and "we're not connecting that one" is a
// real decision worth recording. The runtime still reads the comma list on ops
// Palm Creators 'OF API Account ID' (Free first, VIP second) — this route
// rebuilds that list from the per-account records after every change, so the
// two never drift.
//
// Actions:
//   { hqId, action:'create-account', accountType:'Free OF'|'VIP OF' }
//   { hqId, action:'set-decision', revenueAccountId, decision:'Skip'|'' }
//   { hqId, action:'connect', revenueAccountId, acctId }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { hqId, action, accountType, revenueAccountId, decision, acctId } = await request.json()
    if (!hqId || !action) return NextResponse.json({ error: 'hqId and action required' }, { status: 400 })

    const creator = await fetchHqRecord(HQ_CREATORS, hqId)
    const cf = creator.fields || {}
    const aka = cf['AKA'] || cf['Creator'] || ''
    if (!aka) return NextResponse.json({ error: 'Creator has no AKA/name yet — save Basic info first' }, { status: 400 })

    if (action === 'create-account') {
      if (!['Free OF', 'VIP OF'].includes(accountType)) {
        return NextResponse.json({ error: 'accountType must be "Free OF" or "VIP OF"' }, { status: 400 })
      }
      const name = `${aka} - ${accountType}`
      const existing = await myOfAccounts(aka)
      if (existing.some((r) => String(r.fields['Account Name'] || '').toLowerCase() === name.toLowerCase())) {
        return NextResponse.json({ error: `${name} already exists` }, { status: 409 })
      }
      await createHqRecord(HQ_REVENUE_ACCOUNTS, {
        'Account Name': name,
        'Platform': 'OnlyFans',
        'Account Type': accountType === 'VIP OF' ? 'VIP' : 'Free',
        'Status': 'Active',
        'Creator': [hqId],
        'Management Start Date': cf['Management Start Date'] || new Date().toISOString().slice(0, 10),
      })
      return NextResponse.json({ ok: true, created: name })
    }

    if (action === 'set-decision') {
      if (!revenueAccountId) return NextResponse.json({ error: 'revenueAccountId required' }, { status: 400 })
      if (!['Skip', ''].includes(decision || '')) return NextResponse.json({ error: 'decision must be "Skip" or empty' }, { status: 400 })
      await patchHqRecord(HQ_REVENUE_ACCOUNTS, revenueAccountId, { 'OF API Connect': decision || null })
      const synced = await syncOpsAccountIds(hqId, cf, aka)
      return NextResponse.json({ ok: true, opsList: synced })
    }

    if (action === 'connect') {
      if (!revenueAccountId) return NextResponse.json({ error: 'revenueAccountId required' }, { status: 400 })
      const id = String(acctId || '').trim()
      if (!/^acct_[0-9a-f]{16,40}$/i.test(id)) {
        return NextResponse.json({ error: 'That doesn’t look like an account ID — it should start with acct_ (copy it from app.onlyfansapi.com)' }, { status: 400 })
      }
      // Verify against the live API before saving (1 credit) — a typo here
      // would otherwise surface days later as a mystery 404 in a cron.
      let username = ''
      try {
        const me = await ofApi(`/${id}/me`, { timeoutMs: 20000 })
        username = me?.data?.username || me?.data?.name || ''
      } catch (e) {
        return NextResponse.json({ error: `onlyfansapi.com doesn’t recognize that ID (${e.message}). Check it’s copied exactly and the account is authenticated there.` }, { status: 400 })
      }
      await patchHqRecord(HQ_REVENUE_ACCOUNTS, revenueAccountId, {
        'OF API Connect': 'Connect',
        'OF API Account ID': id,
      })
      const synced = await syncOpsAccountIds(hqId, cf, aka)
      return NextResponse.json({ ok: true, username, opsList: synced })
    }

    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[onboarding/of-api] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// All OnlyFans Revenue Accounts whose name starts "<AKA> - " (the same prefix
// convention every reader uses). Formula can't match linked records by ID, so
// prefix-match the text name.
async function myOfAccounts(aka) {
  const rows = await fetchHqRecords(HQ_REVENUE_ACCOUNTS, {
    filterByFormula: `{Platform}='OnlyFans'`,
    fields: ['Account Name', 'Account Type', 'Status', 'OF API Connect', 'OF API Account ID'],
  })
  const prefix = `${aka.toLowerCase()} - `
  return rows.filter((r) => String(r.fields?.['Account Name'] || '').toLowerCase().startsWith(prefix))
}

// Rebuild ops Palm Creators 'OF API Account ID' from the per-account records:
// Active + decision=Connect + id, non-VIP first then VIP (pickOfAccountId and
// every consumer assume Free first, VIP second).
async function syncOpsAccountIds(hqId, cf, aka) {
  const accounts = await myOfAccounts(aka)
  const val = (v) => (typeof v === 'string' ? v : v?.name || '')
  const active = accounts.filter((r) => val(r.fields?.['Status']) === 'Active')
  const connected = active.filter((r) => {
    const f = r.fields || {}
    return val(f['OF API Connect']) === 'Connect' && String(f['OF API Account ID'] || '').trim()
  })
  const isVip = (r) => /vip/i.test(String(r.fields?.['Account Name'] || ''))
  connected.sort((a, b) => (isVip(a) ? 1 : 0) - (isVip(b) ? 1 : 0))
  const list = connected.map((r) => String(r.fields['OF API Account ID']).trim()).join(',')

  // NEVER wipe a working runtime list on incomplete data: an empty rebuild is
  // only trustworthy when every active account carries an EXPLICIT decision
  // (all Skip = deliberate disconnect). If any account is still undecided /
  // unmigrated, leave the ops list alone — a routine Skip on one account must
  // not blank a legacy creator's ids (reviewer finding, 2026-07-17).
  if (!list && active.some((r) => !val(r.fields?.['OF API Connect']))) {
    console.warn('[onboarding/of-api] empty rebuild with undecided accounts — ops list preserved')
    return null
  }

  const ops = await findOpsCreator(hqId, cf['Creator'], aka)
  if (!ops) {
    console.warn('[onboarding/of-api] no ops Palm Creators record — list not synced')
    return list
  }
  await patchAirtableRecord(OPS_PALM_CREATORS, ops.id, { 'OF API Account ID': list })
  return list
}

// Same resolution as the board route: HQ Record ID back-link, then name/AKA.
async function findOpsCreator(hqId, name, aka) {
  try {
    const byLink = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `{HQ Record ID}=${quoteAirtableString(hqId)}`,
      maxRecords: 1,
    })
    if (byLink[0]) return byLink[0]
  } catch { /* fall through */ }
  const clauses = []
  if (name) clauses.push(`{Creator}=${quoteAirtableString(name)}`)
  if (aka) clauses.push(`{AKA}=${quoteAirtableString(aka)}`)
  if (!clauses.length) return null
  try {
    const byName = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `OR(${clauses.join(',')})`,
      maxRecords: 1,
    })
    return byName[0] || null
  } catch { return null }
}
