import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { STATUSES } from '@/lib/oftvWorkflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Creator gives final thumbs up — terminal Approved state. Project becomes
// inactive and stops appearing in default queues. Only valid from
// `Sent to Creator`. Admins may also call this on behalf of a creator.
export async function POST(_request, { params }) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
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
      error: `Project must be in "Sent to Creator" to approve. Currently "${currentStatus}".`,
    }, { status: 409 })
  }

  const fields = {
    'Status': STATUSES.APPROVED,
    'Approved At': new Date().toISOString(),
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
  return NextResponse.json({ ok: true, status: STATUSES.APPROVED })
}
