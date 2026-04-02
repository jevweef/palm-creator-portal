import { NextResponse } from 'next/server'
import { requireAdmin, createAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox } from '@/lib/dropbox'
import OpenAI from 'openai'

export const maxDuration = 60

const PROFILE_DOCS_TABLE = 'tblzRPH4149dUg0SL'
const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm'])

function getExt(filename) {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx).toLowerCase() : ''
}

function isAudio(filename, fileType) {
  return fileType === 'Audio' || AUDIO_EXTENSIONS.has(getExt(filename))
}

// POST /api/admin/creator-profile/upload
// Multipart form: creatorId, creatorName, fileType, notes, file
export async function POST(request) {
  try {
    await requireAdmin()

    const formData = await request.formData()
    const creatorId = formData.get('creatorId')
    const creatorName = formData.get('creatorName') || 'unknown'
    const fileType = formData.get('fileType') || 'Other'
    const notes = formData.get('notes') || ''
    const file = formData.get('file')

    if (!creatorId || !file) {
      return NextResponse.json({ error: 'creatorId and file are required' }, { status: 400 })
    }

    const fileName = file.name
    const fileBuffer = Buffer.from(await file.arrayBuffer())

    // Upload to Dropbox
    const token = await getDropboxAccessToken()
    const namespaceId = await getDropboxRootNamespaceId(token)
    const safeName = creatorName.replace(/[^a-zA-Z0-9 _-]/g, '_')
    const dropboxPath = `/Palm Ops/Creator Profiles/${safeName}/${fileName}`

    const dropboxResult = await uploadToDropbox(token, namespaceId, dropboxPath, fileBuffer)
    const storedPath = dropboxResult.path_display || dropboxPath

    // Transcribe audio inline so it's ready for analysis
    let extractedText = ''
    let analysisStatus = 'Pending'

    if (isAudio(fileName, fileType)) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        const ext = getExt(fileName) || '.mp3'

        const transcript = await openai.audio.transcriptions.create({
          model: TRANSCRIPTION_MODEL,
          file: new File([fileBuffer], fileName, { type: `audio/${ext.replace('.', '')}` }),
          response_format: 'text',
        })

        extractedText = typeof transcript === 'string' ? transcript.trim() : (transcript.text || '').trim()
        analysisStatus = 'Analyzed'
        console.log(`Transcribed ${fileName}: ${extractedText.length} chars`)
      } catch (transcribeErr) {
        console.error('Transcription failed:', transcribeErr.message)
        // Don't fail the upload — just leave text empty, Python script can retry
      }
    }

    // Create Airtable record
    const today = new Date().toISOString().split('T')[0]
    const record = await createAirtableRecord('Creator Profile Documents', {
      'File Name': fileName,
      'File Type': fileType,
      'Dropbox Path': storedPath,
      'Upload Date': today,
      'Analysis Status': analysisStatus,
      'Extracted Text': extractedText,
      'Notes': notes,
      'Creator': [creatorId],
    })

    return NextResponse.json({
      success: true,
      documentId: record.id,
      fileName,
      dropboxPath: storedPath,
      transcribed: analysisStatus === 'Analyzed',
      extractedLength: extractedText.length,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
