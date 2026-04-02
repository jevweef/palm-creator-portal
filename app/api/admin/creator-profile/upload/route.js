import { NextResponse } from 'next/server'
import { requireAdmin, createAirtableRecord } from '@/lib/adminAuth'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm'])

function getExt(filename) {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx).toLowerCase() : ''
}

function isAudio(filename, fileType) {
  return fileType === 'Audio' || AUDIO_EXTENSIONS.has(getExt(filename))
}

// POST /api/admin/creator-profile/upload
// JSON body: { creatorId, fileType, notes, fileName, dropboxPath }
// File has already been uploaded directly to Dropbox by the browser.
// This route just registers the Airtable record.
// Transcription of audio happens during the analyze step.
export async function POST(request) {
  try {
    await requireAdmin()

    const { creatorId, fileType, notes, fileName, dropboxPath } = await request.json()

    if (!creatorId || !fileName || !dropboxPath) {
      return NextResponse.json({ error: 'creatorId, fileName, and dropboxPath are required' }, { status: 400 })
    }

    const today = new Date().toISOString().split('T')[0]
    const analysisStatus = 'Pending'

    const record = await createAirtableRecord('Creator Profile Documents', {
      'File Name': fileName,
      'File Type': fileType || 'Other',
      'Dropbox Path': dropboxPath,
      'Upload Date': today,
      'Analysis Status': analysisStatus,
      'Extracted Text': '',
      'Notes': notes || '',
      'Creator': [creatorId],
    })

    return NextResponse.json({
      success: true,
      documentId: record.id,
      fileName,
      dropboxPath,
      isAudio: isAudio(fileName, fileType),
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile register error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
