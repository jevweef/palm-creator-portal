import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { currentUser } from '@clerk/nextjs/server'
import { STATUSES } from '@/lib/oftvWorkflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Admin approves the editor's final cut and releases it to the creator.
// Only valid from `Final Submitted`. Sets `Sent to Creator` + timestamps +
// reviewer name. Creator now sees the project in their "Ready for Review"
// bucket and can either approve-close or request changes.
export async function POST(_request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const user = await currentUser()
  const reviewerName = (user?.firstName && user?.lastName)
    ? `${user.firstName} ${user.lastName}`
    : (user?.firstName || user?.emailAddresses?.[0]?.emailAddress || 'Admin')

  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const record = await recRes.json()
  const currentStatus = record.fields?.['Status'] || ''
  if (currentStatus !== STATUSES.FINAL_SUBMITTED) {
    return NextResponse.json({
      error: `Cannot approve from status "${currentStatus}". Project must be Final Submitted.`,
    }, { status: 409 })
  }

  const now = new Date().toISOString()
  const fields = {
    'Status': STATUSES.SENT_TO_CREATOR,
    'Admin Reviewed At': now,
    'Sent to Creator At': now,
    'Reviewed By': reviewerName,
  }

  const patchRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields }),
    }
  )
  if (!patchRes.ok) {
    return NextResponse.json({ error: 'Patch failed', detail: await patchRes.text() }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status: STATUSES.SENT_TO_CREATOR })
}
