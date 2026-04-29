import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  createDropboxFolder,
  listDropboxFolder,
  getDropboxTempLink,
  deleteDropboxPath,
} from '@/lib/dropbox'
import { createDropboxFileRequest } from '@/lib/dropboxFileRequests'
import { STATUSES, STATUSES_THAT_AUTO_FLIP_TO_FINAL } from '@/lib/oftvWorkflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

async function loadProject(id) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  return res.json()
}

async function patchProject(id, fields) {
  return fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PROJECTS_TABLE}/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typecast: true, fields }),
    }
  )
}

async function ensureFinalSetup(record) {
  const f = record.fields || {}
  const projectFolder = f['Dropbox Folder Path']
  if (!projectFolder) throw new Error('Project has no Dropbox folder')

  const existingPath = f['Final Folder Path']
  const existingUrl = f['Final File Request URL']
  if (existingPath && existingUrl) {
    return { folderPath: existingPath, fileRequestUrl: existingUrl, fileRequestId: f['Final File Request ID'] || '' }
  }

  const folderPath = existingPath || `${projectFolder}/_Final`
  const projectName = f['Project Name'] || 'Untitled'

  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)

  if (!existingPath) {
    try { await createDropboxFolder(token, rootNs, folderPath) } catch (err) {
      console.warn('[oftv/final] folder create failed:', err.message)
    }
  }

  let fileRequestUrl = existingUrl || ''
  let fileRequestId = f['Final File Request ID'] || ''
  if (!fileRequestUrl) {
    try {
      const fr = await createDropboxFileRequest(token, rootNs, {
        title: `Final Cut: ${projectName}`.slice(0, 140),
        destination: folderPath,
      })
      fileRequestUrl = fr.url
      fileRequestId = fr.id
    } catch (err) {
      console.warn('[oftv/final] file request create failed:', err.message)
    }
  }

  await patchProject(record.id, {
    'Final Folder Path': folderPath,
    'Final File Request URL': fileRequestUrl,
    'Final File Request ID': fileRequestId,
  })

  return { folderPath, fileRequestUrl, fileRequestId }
}

// GET — list final files + ensure folder/request exist
// GET ?path=... — return temp link for previewing one file
export async function GET(request, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const record = await loadProject(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const previewPath = searchParams.get('path')

  let setup
  try {
    setup = await ensureFinalSetup(record)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNamespaceId(token)

  if (previewPath) {
    if (!previewPath.startsWith(setup.folderPath + '/')) {
      return NextResponse.json({ error: 'Path not in final folder' }, { status: 400 })
    }
    try {
      const link = await getDropboxTempLink(token, rootNs, previewPath)
      return NextResponse.json({ link })
    } catch (err) {
      return NextResponse.json({ error: 'Temp link failed', detail: err.message }, { status: 500 })
    }
  }

  let files = []
  try {
    const entries = await listDropboxFolder(token, rootNs, setup.folderPath)
    files = (entries || [])
      .filter(e => e['.tag'] === 'file')
      .map(e => ({ name: e.name, size: e.size, modified: e.client_modified || e.server_modified, path: e.path_display }))
      .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''))
  } catch (err) {
    console.warn('[oftv/final] list failed:', err.message)
  }

  // Auto-flip status when a fresh final cut shows up. We only flip from
  // editor-active states — never from Sent to Creator or Approved (admin
  // already approved an earlier cut). If the editor needs to send a new
  // version after creator approval, they can manually re-open via revision.
  const currentStatus = record.fields?.['Status'] || ''
  let statusFlipped = false
  if (files.length > 0 && STATUSES_THAT_AUTO_FLIP_TO_FINAL.includes(currentStatus)) {
    const newest = files[0]?.modified || new Date().toISOString()
    const lastSubmittedAt = record.fields?.['Final Submitted At'] || null
    // Only flip if there's a new file modified after the last submission,
    // OR we're moving from a non-Final-Submitted state for the first time.
    if (!lastSubmittedAt || newest > lastSubmittedAt) {
      const prevCount = record.fields?.['Revision Count'] || 0
      const wasRevision = currentStatus === STATUSES.ADMIN_REVISION || currentStatus === STATUSES.CREATOR_REVISION
      const updates = {
        'Status': STATUSES.FINAL_SUBMITTED,
        'Final Submitted At': newest,
      }
      // Coming from a revision state means this submission addresses prior
      // feedback — don't double-count (revision counter was already bumped
      // when the kick-back happened).
      try {
        await patchProject(record.id, updates)
        statusFlipped = true
      } catch (err) {
        console.warn('[oftv/final] auto-flip failed:', err.message)
      }
    }
  }

  return NextResponse.json({
    folderPath: setup.folderPath,
    fileRequestUrl: setup.fileRequestUrl,
    files,
    statusFlipped,
    currentStatus: statusFlipped ? STATUSES.FINAL_SUBMITTED : currentStatus,
  })
}

// DELETE ?path=... — remove a final file (admin/editor only, scoped)
export async function DELETE(request, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { id } = params
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const record = await loadProject(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const folderPath = record.fields?.['Final Folder Path']
  if (!folderPath || !path.startsWith(folderPath + '/')) {
    return NextResponse.json({ error: 'Path not in final folder' }, { status: 400 })
  }

  try {
    const token = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(token)
    await deleteDropboxPath(token, rootNs, path)
  } catch (err) {
    return NextResponse.json({ error: 'Delete failed', detail: err.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
