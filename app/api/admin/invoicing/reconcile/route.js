import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { reconcileInvoices } from '@/lib/invoiceReconcile'
import { isSimplefinConfigured } from '@/lib/simplefin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET  — DRY RUN: preview what would be marked paid (no writes).
// POST — EXECUTE: match Chase deposits → open invoices and mark them Paid.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  if (!isSimplefinConfigured()) return NextResponse.json({ error: 'SimpleFIN not configured' }, { status: 400 })
  try {
    const days = Number(new URL(request.url).searchParams.get('days')) || 45
    return NextResponse.json(await reconcileInvoices({ days, dryRun: true }))
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  if (!isSimplefinConfigured()) return NextResponse.json({ error: 'SimpleFIN not configured' }, { status: 400 })
  try {
    const body = await request.json().catch(() => ({}))
    const days = Number(body.days) || 45
    return NextResponse.json(await reconcileInvoices({ days, dryRun: false }))
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
