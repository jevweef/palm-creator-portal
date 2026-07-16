import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecords } from '@/lib/hqAirtable'

export const dynamic = 'force-dynamic'

// HQ base "Software Stack" — the agency's subscription ledger, the same table
// Scrooge (the software-cost monitor) audits each morning.
const SOFTWARE_STACK = 'tblaRUtlRQcVLV5aM'

const sel = (v) => (v && typeof v === 'object' ? v.name : (v || ''))

export async function GET() {
  try { await requireAdmin() } catch (e) { return e instanceof Response ? e : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const recs = await fetchHqRecords(SOFTWARE_STACK, {
      fields: ['Name', 'Status', 'Category', 'Monthly Cost', 'Last Payment', 'Card', 'Cancellation Date', 'Purpose', 'Notes'],
    })
    const today = new Date()
    const daysSince = (d) => { if (!d) return null; return Math.floor((today - new Date(d)) / 86400000) }
    const tools = recs.map(r => {
      const f = r.fields || {}
      const status = sel(f['Status'])
      const blob = `${f['Notes'] || ''} ${f['Purpose'] || ''}`.toLowerCase()
      // Variable = notes/purpose hint at usage-based or a price range; else Fixed.
      const variable = /\bvariable\b|pay[\s-]?per[\s-]?use|pay[\s-]?as[\s-]?you[\s-]?go|per[ -]use|usage[\s-]?based|\$\s?\d[\d,]*\s*[–\-—]|\bto\b\s*\$?\s?\d/.test(blob)
      const ds = daysSince(f['Last Payment'])
      // "Can't tell if still billing" — Active but no recent charge on record.
      // Skip Variable (credits/pay-per-use) subs: infrequent charges are NORMAL
      // for them, so a stale last-charge date isn't a zombie signal.
      const uncertain = status === 'Active' && !variable && (ds === null || ds > 45)
      return {
        id: r.id,
        name: f['Name'] || '',
        status,
        category: sel(f['Category']),
        monthlyCost: Number(f['Monthly Cost'] || 0),
        costType: variable ? 'Variable' : 'Fixed',
        lastPayment: f['Last Payment'] || null,
        daysSincePayment: ds,
        uncertain,
        card: sel(f['Card']),
        cancelDate: f['Cancellation Date'] || null,
        purpose: f['Purpose'] || '',
        notes: f['Notes'] || '',
      }
    }).sort((a, b) => b.monthlyCost - a.monthlyCost)

    const active = tools.filter(t => t.status === 'Active')
    const burn = active.reduce((s, t) => s + t.monthlyCost, 0)
    const byStatus = tools.reduce((m, t) => { m[t.status || 'Unknown'] = (m[t.status || 'Unknown'] || 0) + 1; return m }, {})
    return NextResponse.json({
      tools,
      totals: { monthlyBurn: burn, annualBurn: burn * 12, activeCount: active.length, byStatus },
    })
  } catch (err) {
    console.error('[software-stack] GET error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
