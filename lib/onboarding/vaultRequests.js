/**
 * Standing per-ACCOUNT vault content requests (2026-07-20, per Evan).
 *
 * Every creator uploads VAULT content (the content-request page's sections are
 * OF vault material: PPVs, sexting sets, etc.), and a creator with a Free AND
 * a VIP page needs one intake per ACCOUNT — so the unit is the Revenue
 * Account, not the creator. This helper ensures one Active Content Request per
 * active OnlyFans Revenue Account:
 *   - an Active request whose Account matches → already covered, skip
 *   - a single-account creator with a LEGACY Active request (no Account) →
 *     stamp the account name onto it instead of duplicating
 *   - otherwise create "Vault — <Free OF|VIP OF>" with Account = full name
 *
 * Used by /api/admin/onboarding/vault-requests (board card + backfill) and
 * fired automatically when the board creates a Revenue Account record.
 */

import { fetchAirtableRecords, patchAirtableRecord, createAirtableRecord } from '@/lib/adminAuth'
import { fetchHqRecord, fetchHqRecords } from '@/lib/hqAirtable'
import { quoteAirtableString } from '@/lib/airtableFormula'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_REVENUE_ACCOUNTS = 'Revenue Accounts'
const OPS_PALM_CREATORS = 'Palm Creators'
const CONTENT_REQUESTS = 'Content Requests'

const val = (v) => (typeof v === 'string' ? v : v?.name || '')

export async function ensureVaultRequests(hqId) {
  const creator = await fetchHqRecord(HQ_CREATORS, hqId)
  const cf = creator.fields || {}
  const aka = cf['AKA'] || cf['Creator'] || ''
  if (!aka) throw new Error('Creator has no AKA/name yet')

  const ops = await findOpsCreator(hqId, cf['Creator'], aka)
  if (!ops) throw new Error('No ops Palm Creators record for this creator')

  // Active OnlyFans accounts by the AKA prefix convention.
  const accountRows = await fetchHqRecords(HQ_REVENUE_ACCOUNTS, {
    filterByFormula: `{Platform}='OnlyFans'`,
    fields: ['Account Name', 'Status'],
  })
  const prefix = `${aka.toLowerCase()} - `
  const accounts = accountRows
    .filter((r) => String(r.fields?.['Account Name'] || '').toLowerCase().startsWith(prefix))
    .filter((r) => val(r.fields?.['Status']) === 'Active')
    .map((r) => r.fields['Account Name'])

  // This creator's Active requests (JS-match the Creator link — formulas can't).
  const activeRequests = (await fetchAirtableRecords(CONTENT_REQUESTS, {
    filterByFormula: `{Status}='Active'`,
    fields: ['Title', 'Creator', 'Account', 'Month'],
  })).filter((r) => (r.fields?.Creator || []).includes(ops.id))

  const month = new Date().toISOString().slice(0, 7)
  const result = { created: [], stamped: [], covered: [], accounts }

  for (const accountName of accounts) {
    const covered = activeRequests.find(
      (r) => String(r.fields?.Account || '').toLowerCase() === accountName.toLowerCase()
    )
    if (covered) { result.covered.push(accountName); continue }

    const legacy = activeRequests.find((r) => !String(r.fields?.Account || '').trim())
    if (legacy && accounts.length === 1) {
      await patchAirtableRecord(CONTENT_REQUESTS, legacy.id, { 'Account': accountName })
      legacy.fields.Account = accountName
      result.stamped.push(accountName)
      continue
    }

    const shortType = accountName.split(' - ').slice(1).join(' - ') || accountName
    const rec = await createAirtableRecord(CONTENT_REQUESTS, {
      'Title': `Vault — ${shortType}`,
      'Status': 'Active',
      'Month': month,
      'Creator': [ops.id],
      'Account': accountName,
    }, { typecast: true })
    activeRequests.push({ id: rec.id, fields: { Account: accountName } })
    result.created.push(accountName)
  }

  return result
}

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
