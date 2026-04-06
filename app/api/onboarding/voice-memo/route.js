import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// GET — check if voice memo already exists
export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const hqId = searchParams.get('hqId')
  if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const c = record.fields || {}
    const voiceMemo = c['Voice Memo']
    const hasVoiceMemo = !!(voiceMemo && voiceMemo.length > 0)

    return NextResponse.json({
      hasVoiceMemo,
      voiceMemoUrl: hasVoiceMemo ? voiceMemo[0].url : null,
      voiceMemoFilename: hasVoiceMemo ? voiceMemo[0].filename : null,
    })
  } catch (err) {
    console.error('[voice-memo/GET] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — upload voice memo to Dropbox + save to Airtable
export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  try {
    const formData = await request.formData()
    const hqId = formData.get('hqId')
    const audioFile = formData.get('audio')
    const confirmed = formData.get('confirmed') // "true" if they already sent it

    if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

    if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // If they just confirmed they already sent it, mark it in Airtable
    if (confirmed === 'true') {
      // No file to upload — just mark completion
      return NextResponse.json({ success: true, confirmed: true })
    }

    if (!audioFile) {
      return NextResponse.json({ error: 'Audio file required' }, { status: 400 })
    }

    // Get creator name for filename
    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const creatorName = record.fields?.['Creator'] || 'creator'
    const safeName = creatorName.replace(/\s+/g, '-').toLowerCase()

    // Determine extension from mime type
    const mime = audioFile.type || 'audio/webm'
    const extMap = {
      'audio/webm': 'webm',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'video/mp4': 'mp4',
    }
    const ext = extMap[mime] || 'webm'
    const filename = `voice-memo-${safeName}-${Date.now()}.${ext}`

    // Convert to buffer
    const arrayBuffer = await audioFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Dropbox
    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    const dropboxPath = `/Palm Ops/Voice Memos/${filename}`

    await uploadToDropbox(accessToken, rootNs, dropboxPath, buffer)
    const sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)
    const directUrl = sharedLink.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')

    // Save to Airtable
    await patchHqRecord(HQ_CREATORS, hqId, {
      'Voice Memo': [{ url: directUrl, filename }],
    })

    return NextResponse.json({ success: true, filename, dropboxUrl: sharedLink })
  } catch (err) {
    console.error('[voice-memo/POST] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
