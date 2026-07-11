import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getOutstandingInvoices } from '@/lib/invoiceReconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET — open (Sent/Overdue) invoices for the dashboard's outstanding section:
// total unpaid + who they're for.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }
  try {
    return NextResponse.json(await getOutstandingInvoices())
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
