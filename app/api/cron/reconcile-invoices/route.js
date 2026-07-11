import { NextResponse } from 'next/server'
import { reconcileInvoices } from '@/lib/invoiceReconcile'
import { isSimplefinConfigured } from '@/lib/simplefin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Daily — auto-match Chase deposits to open invoices and mark them Paid.
// Safe to run repeatedly: only ever flips Sent/Overdue → Paid, so a re-run
// with no new payments is a no-op.
export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth && request.headers.get('authorization') !== expectedAuth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!isSimplefinConfigured()) return NextResponse.json({ ok: true, skipped: 'SimpleFIN not configured' })
  try {
    const result = await reconcileInvoices({ days: 45, dryRun: false })
    return NextResponse.json({ ok: true, matchedCount: result.matchedCount, invoicesPaid: result.invoicesPaid, outstandingTotal: result.outstandingTotal })
  } catch (err) {
    console.error('[reconcile-invoices] fatal:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
