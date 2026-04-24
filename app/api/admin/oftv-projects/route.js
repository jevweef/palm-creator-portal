import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const PROJECTS_TABLE = 'tbl7DTdRooCsAns7j'

export async function GET(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const creatorId = searchParams.get('creatorId')
  const sinceDays = Number(searchParams.get('sinceDays') || '0')

  // Status + date can filter via formula. Creator filter done client-side because
  // ARRAYJOIN on linked records returns names not IDs.
  const formulaParts = []
  if (status) formulaParts.push(`{Status} = '${status.replace(/'/g, "\\'")}'`)
  if (sinceDays > 0) {
    formulaParts.push(`IS_AFTER({Created At}, DATEADD(NOW(), -${sinceDays}, 'days'))`)
  }
  const filterByFormula = formulaParts.length === 1
    ? formulaParts[0]
    : formulaParts.length > 1 ? `AND(${formulaParts.join(', ')})` : undefined

  const allRecords = await fetchAirtableRecords(PROJECTS_TABLE, {
    filterByFormula,
    sort: [{ field: 'Created At', direction: 'desc' }],
  })
  const records = creatorId
    ? allRecords.filter(r => (r.fields?.['Creator'] || []).includes(creatorId))
    : allRecords

  const projects = records.map(r => {
    const f = r.fields || {}
    return {
      id: r.id,
      projectName: f['Project Name'] || '',
      creatorIds: f['Creator'] || [],
      status: f['Status'] || 'Awaiting Upload',
      instructions: f['Instructions'] || '',
      fileRequestUrl: f['Dropbox File Request URL'] || '',
      folderLink: f['Dropbox Folder Link'] || '',
      folderPath: f['Dropbox Folder Path'] || '',
      fileCount: f['File Count'] || 0,
      totalSize: f['Total Size (bytes)'] || 0,
      lastUploadedAt: f['Last File Uploaded At'] || null,
      assignedEditor: f['Assigned Editor'] || '',
      editorNotes: f['Editor Notes'] || '',
      editedFileLink: f['Edited File Link'] || '',
      adminFeedback: f['Admin Feedback'] || '',
      createdAt: f['Created At'] || null,
    }
  })

  return NextResponse.json({ projects })
}
