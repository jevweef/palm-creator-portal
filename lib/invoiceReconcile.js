import { HQ_BASE, hqHeaders, patchHqRecord } from '@/lib/hqAirtable'
import { fetchDeposits } from '@/lib/simplefin'

// Auto-reconcile creator payments (Chase deposits via SimpleFIN) against the
// invoices Palm sent them, marking matches Paid. Matching is by EXACT amount
// (invoices are penny-specific, so effectively unique); the payer name only
// breaks the rare tie where two open invoices share the same amount. A single
// transfer can cover several of one creator's invoices (combined payment).

const INVOICES_TABLE = 'tblKbU8VkdlOHXoJj'
const F = {
  status: 'fldQEjYB0DxpNWxhU',      // Invoice Status (single select)
  amount: 'fldk9uXcTQmkb897y',      // formula: gross * commission = owed to Palm
  amountPaid: 'fldo1wsLtnfpK8wZr',  // Amount Paid (currency)
  invoiceName: 'fldBaIZAsl08bJoCq', // "RealName | AKA | Account | dates"
  due: 'fldOTpRmDWDfwz8FH',         // Due Date (formula)
}
const OPEN_STATUSES = new Set(['Sent', 'Overdue'])
const CENT = 0.011 // amount-match tolerance (rounding slop)

// Fetch every invoice with the fields we need, keyed by field ID (the amount
// is a formula with no stable name). Creator identity comes from the Invoice
// Name text ("RealName | AKA | ...") so we don't need to join HQ Creators.
async function fetchInvoices() {
  const fields = [F.status, F.amount, F.amountPaid, F.invoiceName, F.due]
  let out = []
  let offset = null
  do {
    const q = new URLSearchParams()
    q.set('returnFieldsByFieldId', 'true')
    q.set('pageSize', '100')
    fields.forEach((f) => q.append('fields[]', f))
    if (offset) q.set('offset', offset)
    const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${INVOICES_TABLE}?${q}`, { headers: hqHeaders, cache: 'no-store' })
    if (!res.ok) throw new Error(`Airtable HQ ${res.status}: ${await res.text().catch(() => '')}`)
    const d = await res.json()
    out.push(...(d.records || []))
    offset = d.offset || null
  } while (offset)
  return out.map((r) => {
    const f = r.fields || {}
    const status = typeof f[F.status] === 'string' ? f[F.status] : f[F.status]?.name || ''
    const parts = String(f[F.invoiceName] || '').split(' | ')
    return {
      id: r.id,
      status,
      amount: Number(f[F.amount]) || 0,
      realName: (parts[0] || '').trim(),
      aka: (parts[1] || '').trim(),
      invoiceName: f[F.invoiceName] || '',
      dueDate: f[F.due] || null,
    }
  })
}

function openInvoices(all) {
  return all.filter((inv) => OPEN_STATUSES.has(inv.status) && inv.amount > 0.005)
}

const nameTokens = (inv) =>
  [...new Set(`${inv.realName} ${inv.aka}`.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3))]
const nameMatches = (payer, inv) => {
  const P = String(payer || '').toUpperCase()
  return nameTokens(inv).some((tok) => P.includes(tok))
}

// The list the dashboard shows: open invoices, biggest first.
export async function getOutstandingInvoices() {
  const open = openInvoices(await fetchInvoices())
  const invoices = open
    .map((inv) => ({ id: inv.id, name: inv.aka || inv.realName, amount: inv.amount, dueDate: inv.dueDate, status: inv.status }))
    .sort((a, b) => b.amount - a.amount)
  return { total: invoices.reduce((a, b) => a + b.amount, 0), count: invoices.length, invoices }
}

// Match deposits → open invoices and (unless dryRun) mark matches Paid.
export async function reconcileInvoices({ days = 45, dryRun = false } = {}) {
  const open = openInvoices(await fetchInvoices())
  const deposits = await fetchDeposits({ days })

  // Candidates: each open invoice (single), plus each creator's full open set
  // (one transfer covering several invoices). Group by real name (fall back AKA).
  const byCreator = new Map()
  for (const inv of open) {
    const key = (inv.realName || inv.aka || inv.id).toLowerCase()
    if (!byCreator.has(key)) byCreator.set(key, [])
    byCreator.get(key).push(inv)
  }
  const candidates = open.map((inv) => ({ amount: inv.amount, invoices: [inv], creator: inv }))
  for (const invs of byCreator.values()) {
    if (invs.length > 1) candidates.push({ amount: invs.reduce((a, b) => a + b.amount, 0), invoices: invs, creator: invs[0], isSum: true })
  }

  const matched = []
  const unmatched = []
  const used = new Set()
  // Oldest deposit first — deterministic when several could match.
  for (const dep of [...deposits].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const cands = candidates.filter((c) => Math.abs(c.amount - dep.amount) < CENT && c.invoices.every((inv) => !used.has(inv.id)))
    if (cands.length === 0) { unmatched.push({ at: dep.at, amount: dep.amount, payerName: dep.payerName, reason: 'no matching invoice' }); continue }
    let chosen
    if (cands.length === 1) chosen = cands[0]
    else {
      const named = cands.filter((c) => nameMatches(dep.payerName, c.creator))
      if (named.length === 1) chosen = named[0]
      else { unmatched.push({ at: dep.at, amount: dep.amount, payerName: dep.payerName, reason: `ambiguous — ${cands.length} open invoices at $${dep.amount}` }); continue }
    }
    chosen.invoices.forEach((inv) => used.add(inv.id))
    matched.push({
      depositAt: dep.at, depositAmount: dep.amount, payerName: dep.payerName,
      invoices: chosen.invoices.map((inv) => ({ id: inv.id, name: inv.invoiceName, amount: inv.amount })),
    })
  }

  if (!dryRun) {
    for (const m of matched) {
      for (const inv of m.invoices) {
        try {
          await patchHqRecord(INVOICES_TABLE, inv.id, { 'Invoice Status': 'Paid', 'Amount Paid': inv.amount })
        } catch (e) { m.error = (m.error ? m.error + '; ' : '') + e.message }
      }
    }
  }

  const stillOpen = open.filter((inv) => !used.has(inv.id))
  return {
    dryRun,
    matchedCount: matched.length,
    invoicesPaid: matched.reduce((a, m) => a + m.invoices.length, 0),
    matched,
    unmatchedDeposits: unmatched,
    outstandingTotal: stillOpen.reduce((a, b) => a + b.amount, 0),
    stillOutstanding: stillOpen.map((inv) => ({ id: inv.id, name: inv.aka || inv.realName, amount: inv.amount, dueDate: inv.dueDate, status: inv.status })),
  }
}
