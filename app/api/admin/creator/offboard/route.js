import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord, HQ_BASE, hqHeaders } from '@/lib/hqAirtable'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const REVENUE_ACCOUNTS = 'tblQqPWlsjiyJA0ba'

// GET — preview what offboarding will affect (revenue account names + count)
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const hqId = searchParams.get('hqId')
  if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

  try {
    const hq = await fetchHqRecord(HQ_CREATORS, hqId)
    const f = hq.fields || {}
    const revenueAccountIds = f['Revenue Accounts'] || []

    const accounts = []
    for (const id of revenueAccountIds) {
      try {
        const res = await fetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS}/${id}`,
          { headers: hqHeaders, cache: 'no-store' }
        )
        if (res.ok) {
          const rec = await res.json()
          accounts.push({
            id: rec.id,
            name: rec.fields?.['Account Name'] || '(unnamed)',
            status: rec.fields?.Status || '',
          })
        }
      } catch {}
    }

    return NextResponse.json({
      creator: {
        id: hq.id,
        name: f.Creator || '',
        aka: f.AKA || '',
        status: f.Status || '',
      },
      revenueAccounts: accounts,
    })
  } catch (err) {
    console.error('[Offboard] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — execute offboarding
//   Body: { hqId, confirmAka }
//   - HQ Creators: Status = "Offboarded", Offboarded Date = today (UTC date)
//   - Revenue Accounts (linked, currently Active/Paused): Status = "Inactive"
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const { hqId, confirmAka } = body || {}
    if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

    const hq = await fetchHqRecord(HQ_CREATORS, hqId)
    const f = hq.fields || {}
    const aka = f.AKA || ''
    const name = f.Creator || ''

    // Confirmation gate — must type the AKA (case-insensitive) to proceed.
    if (!confirmAka || confirmAka.trim().toLowerCase() !== aka.trim().toLowerCase()) {
      return NextResponse.json(
        { error: `Confirmation does not match. Type the creator's AKA (${aka}) to confirm.` },
        { status: 400 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)

    // 1. Flip HQ status + stamp date
    await patchHqRecord(HQ_CREATORS, hqId, {
      Status: 'Offboarded',
      'Offboarded Date': today,
    })

    // 2. Deactivate all linked Revenue Accounts (skip if already Inactive)
    const revenueAccountIds = f['Revenue Accounts'] || []
    const deactivated = []
    for (const id of revenueAccountIds) {
      try {
        const getRes = await fetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS}/${id}`,
          { headers: hqHeaders, cache: 'no-store' }
        )
        if (!getRes.ok) continue
        const rec = await getRes.json()
        const accName = rec.fields?.['Account Name'] || id
        if (rec.fields?.Status === 'Inactive') continue

        const patchRes = await fetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS}/${id}`,
          {
            method: 'PATCH',
            headers: hqHeaders,
            body: JSON.stringify({ fields: { Status: 'Inactive' } }),
          }
        )
        if (patchRes.ok) deactivated.push(accName)
      } catch (e) {
        console.error('[Offboard] revenue account update failed:', id, e)
      }
    }

    return NextResponse.json({
      ok: true,
      creator: { id: hqId, name, aka },
      offboardedDate: today,
      revenueAccountsDeactivated: deactivated,
    })
  } catch (err) {
    console.error('[Offboard] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
