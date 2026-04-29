import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { currentUser } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Editor (or admin) opened the project — record the first-touch timestamp.
// Idempotent: only writes if Editor Acknowledged At is empty. This gives
// the admin a "Editor has seen it" signal without bothering the editor
// with any UI — it just fires when the modal mounts.
export async function POST(_request, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }

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

  if (record.fields?.['Editor Acknowledged At']) {
    return NextResponse.json({ ok: true, alreadyAcknowledged: true })
  }

  const user = await currentUser()
  const editorName = (user?.firstName && user?.lastName)
    ? `${user.firstName} ${user.lastName}`
    : (user?.firstName || user?.emailAddresses?.[0]?.emailAddress || 'Editor')

  const fields = {
    'Editor Acknowledged At': new Date().toISOString(),
    'Editor Acknowledged By': editorName,
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
  return NextResponse.json({ ok: true, acknowledgedAt: fields['Editor Acknowledged At'] })
}
