import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import { currentUser } from '@clerk/nextjs/server'
import { STATUSES } from '@/lib/oftvWorkflow'
import { notifyOftv, lookupCreatorAka } from '@/lib/oftvTelegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

// Editor clicked "Download from Dropbox" — treat that as the start of
// editing. Flips status Files Uploaded → In Editing, stamps Editor Started
// At, and fires an admin Telegram so Josh sees "editor is now working" in
// real time. Idempotent on subsequent clicks (timestamp doesn't move).
//
// Why download = start: opening the modal alone could just be a quick
// glance. Pulling the source files is the real commitment signal — once
// they're on her drive she's actively working on the cut.
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

  // No-op if already past Files Uploaded — editor's already working,
  // already delivered, or in a revision loop. We don't want to overwrite.
  const currentStatus = record.fields?.['Status'] || ''
  const alreadyStarted = !!record.fields?.['Editor Started At']
  if (alreadyStarted && currentStatus !== STATUSES.FILES_UPLOADED) {
    return NextResponse.json({ ok: true, alreadyStarted: true, currentStatus })
  }

  const user = await currentUser()
  const editorName = (user?.firstName && user?.lastName)
    ? `${user.firstName} ${user.lastName}`
    : (user?.firstName || user?.emailAddresses?.[0]?.emailAddress || 'Editor')

  const fields = {}
  // Stamp Started At only on first click (don't reset across revision cycles).
  if (!alreadyStarted) fields['Editor Started At'] = new Date().toISOString()
  // Also mark acknowledged if it slipped through (e.g. editor opened the
  // modal in a context that didn't fire acknowledge).
  if (!record.fields?.['Editor Acknowledged At']) {
    fields['Editor Acknowledged At'] = new Date().toISOString()
    fields['Editor Acknowledged By'] = editorName
  }
  // Promote Files Uploaded → In Editing so the queue reflects real state.
  let flippedStatus = false
  if (currentStatus === STATUSES.FILES_UPLOADED) {
    fields['Status'] = STATUSES.IN_EDITING
    flippedStatus = true
  }

  if (Object.keys(fields).length > 0) {
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
  }

  // Fire Telegram only when the status actually flipped to In Editing —
  // otherwise we'd spam the thread every time the editor re-clicks
  // download to grab a missing file.
  if (flippedStatus) {
    const creatorOpsId = (record.fields?.['Creator'] || [])[0]
    const aka = await lookupCreatorAka(creatorOpsId)
    notifyOftv({
      event: 'editor_started',
      creator: aka,
      projectName: record.fields?.['Project Name'],
      projectId: id,
      assignedEditor: editorName,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, flippedStatus, currentStatus: flippedStatus ? STATUSES.IN_EDITING : currentStatus })
}
