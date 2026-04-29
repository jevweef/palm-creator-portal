import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { STATUSES } from '@/lib/oftvWorkflow'
import { notifyOftv, lookupCreatorAka } from '@/lib/oftvTelegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Creator requests changes on the final cut. Feedback is required —
// without specifics the editor can't act on it. Bumps revision count and
// kicks the project back to Creator Revision (editor's queue).
export async function POST(request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body = {}
  try { body = await request.json() } catch {}
  const feedback = (body.feedback || '').toString().trim()
  if (!feedback) {
    return NextResponse.json({ error: 'Feedback is required' }, { status: 400 })
  }

  const recRes = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!recRes.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const record = await recRes.json()

  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  const ownerOpsId = user?.publicMetadata?.airtableOpsId
  const isOwner = (record.fields?.['Creator'] || []).includes(ownerOpsId)
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const currentStatus = record.fields?.['Status'] || ''
  if (currentStatus !== STATUSES.SENT_TO_CREATOR) {
    return NextResponse.json({
      error: `Project must be in "Sent to Creator" to request revision. Currently "${currentStatus}".`,
    }, { status: 409 })
  }

  const prevCount = record.fields?.['Revision Count'] || 0
  const fields = {
    'Status': STATUSES.CREATOR_REVISION,
    'Creator Feedback': feedback,
    'Creator Feedback At': new Date().toISOString(),
    'Revision Count': prevCount + 1,
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

  const creatorOpsId = (record.fields?.['Creator'] || [])[0]
  const aka = await lookupCreatorAka(creatorOpsId)
  notifyOftv({
    event: 'creator_revision_requested',
    creator: aka,
    projectName: record.fields?.['Project Name'],
    assignedEditor: record.fields?.['Assigned Editor'],
    notes: feedback,
    revisionCount: prevCount + 1,
  }).catch(() => {})

  return NextResponse.json({ ok: true, status: STATUSES.CREATOR_REVISION })
}
