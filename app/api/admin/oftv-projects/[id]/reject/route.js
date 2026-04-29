import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { currentUser } from '@clerk/nextjs/server'
import { STATUSES } from '@/lib/oftvWorkflow'
import { notifyOftv, lookupCreatorAka } from '@/lib/oftvTelegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Admin sends the editor's final cut back for revision.
// Only valid from `Final Submitted`. Notes are optional — admin may just
// want to ping the editor without writing anything if there was a quick
// verbal sync.
export async function POST(request, { params }) {
  try { await requireAdmin() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body = {}
  try { body = await request.json() } catch {}
  const notes = (body.notes || '').toString().trim()

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
      error: `Cannot reject from status "${currentStatus}". Project must be Final Submitted.`,
    }, { status: 409 })
  }

  const prevCount = record.fields?.['Revision Count'] || 0
  const now = new Date().toISOString()
  const fields = {
    'Status': STATUSES.ADMIN_REVISION,
    'Admin Reviewed At': now,
    'Reviewed By': reviewerName,
    'Revision Count': prevCount + 1,
  }
  if (notes) fields['Admin Revision Notes'] = notes

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

  const creatorOpsId = (record.fields?.['Creator'] || [])[0]
  const aka = await lookupCreatorAka(creatorOpsId)
  notifyOftv({
    event: 'admin_revision_requested',
    creator: aka,
    projectName: record.fields?.['Project Name'],
    projectId: id,
    assignedEditor: record.fields?.['Assigned Editor'],
    notes,
    revisionCount: prevCount + 1,
  }).catch(() => {})

  return NextResponse.json({ ok: true, status: STATUSES.ADMIN_REVISION })
}
