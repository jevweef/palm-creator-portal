export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { requireAdminOrEditor, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'

const ASSETS_TABLE = 'tblAPl8Pi5v1qmMNM'
const TASKS_TABLE = 'tblXMh2UznOJMgxl6'

// Snapshot the Clerk user who pressed Submit so the admin Submissions feed can
// show an avatar + name. Stored on the Task record (latest submission only).
async function getSubmitterSnapshot() {
  try {
    const u = await currentUser()
    if (!u) return null
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
      || u.fullName
      || u.username
      || u.emailAddresses?.[0]?.emailAddress
      || ''
    return {
      'Submitted By ID': u.id,
      'Submitted By Name': name,
      'Submitted By Avatar': u.imageUrl || u.profileImageUrl || '',
    }
  } catch {
    return null
  }
}

export async function POST(req) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { assetId, taskId, editedFileLink } = await req.json()

  if (!editedFileLink) {
    return NextResponse.json({ error: 'editedFileLink is required' }, { status: 400 })
  }

  const submitter = await getSubmitterSnapshot()

  const results = await Promise.all([
    // Save URL to asset's Edited File Link
    assetId ? fetch(`https://api.airtable.com/v0/${OPS_BASE}/${ASSETS_TABLE}/${assetId}`, {
      method: 'PATCH',
      headers: airtableHeaders,
      body: JSON.stringify({ fields: { 'Edited File Link': editedFileLink } }),
    }) : null,

    // Mark task as Done + Pending Review + capture submitter
    taskId ? fetch(`https://api.airtable.com/v0/${OPS_BASE}/${TASKS_TABLE}/${taskId}`, {
      method: 'PATCH',
      headers: airtableHeaders,
      body: JSON.stringify({
        fields: {
          Status: 'Done',
          'Admin Review Status': 'Pending Review',
          'Completed At': new Date().toISOString(),
          ...(submitter || {}),
        },
      }),
    }) : null,
  ])

  for (const res of results) {
    if (res && !res.ok) {
      const text = await res.text()
      console.error('[Save Edit] Airtable error:', text)
      return NextResponse.json({ error: `Airtable update failed: ${text}` }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
