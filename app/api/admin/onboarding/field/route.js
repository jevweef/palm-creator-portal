import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { patchHqRecord } from '@/lib/hqAirtable'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const OPS_PALM_CREATORS = 'Palm Creators'

// PATCH — tiny whitelisted field writes so board cards can edit values inline
// instead of deep-linking away. STRICT whitelist per target; anything else 400s.
//
// Body: { hqId, target: 'ops'|'hq', field, value }
//   ops  → the creator's ops Palm Creators record (resolved via HQ Record ID)
//   hq   → the HQ Creators record itself
const WHITELIST = {
  ops: {
    'Music DNA Input': (v) => typeof v === 'string',
    'Weekly Reel Quota': (v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 50),
  },
  hq: {
    // Stored as a DECIMAL (0.45 = 45%) — the card sends the decimal.
    'Commission %': (v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1),
  },
}

export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { hqId, target, field, value } = await request.json()
    if (!hqId || !target || !field) return NextResponse.json({ error: 'hqId, target and field required' }, { status: 400 })
    const check = WHITELIST[target]?.[field]
    if (!check) return NextResponse.json({ error: `Field not editable here: ${target}/${field}` }, { status: 400 })
    if (!check(value)) return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 })

    if (target === 'hq') {
      await patchHqRecord(HQ_CREATORS, hqId, { [field]: value === null ? null : Number(value) })
      return NextResponse.json({ ok: true })
    }

    // ops — resolve via HQ Record ID back-link, then name fallback
    const hq = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `{HQ Record ID}='${hqId}'`, maxRecords: 1,
    }).catch(() => [])
    let ops = hq[0]
    if (!ops) {
      const creator = await (await import('@/lib/hqAirtable')).fetchHqRecord(HQ_CREATORS, hqId)
      const cf = creator.fields || {}
      const clauses = []
      if (cf['Creator']) clauses.push(`{Creator}=${quoteAirtableString(cf['Creator'])}`)
      if (cf['AKA']) clauses.push(`{AKA}=${quoteAirtableString(cf['AKA'])}`)
      const byName = clauses.length ? await fetchAirtableRecords(OPS_PALM_CREATORS, {
        filterByFormula: `OR(${clauses.join(',')})`, maxRecords: 1,
      }).catch(() => []) : []
      ops = byName[0]
    }
    if (!ops) return NextResponse.json({ error: 'No ops Palm Creators record for this creator' }, { status: 404 })

    const coerced = field === 'Weekly Reel Quota' ? (value === null ? null : Number(value)) : value
    await patchAirtableRecord(OPS_PALM_CREATORS, ops.id, { [field]: coerced }, { typecast: true })
    return NextResponse.json({ ok: true, opsId: ops.id })
  } catch (err) {
    console.error('[onboarding/field] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
