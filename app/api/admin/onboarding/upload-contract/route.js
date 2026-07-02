import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { patchHqRecord, fetchHqRecord } from '@/lib/hqAirtable'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// Admin-only: attach an ALREADY-SIGNED custom contract for a specific creator.
// Uploads the PDF to Dropbox and sets the creator's Contract attachment +
// Contract Sign Date, which marks the onboarding contract step done and makes
// the portal show THIS file instead of the auto-generated template. No in-portal
// signing — the creator's already signed it offline.
export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  if (role !== 'admin' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  try {
    const form = await request.formData()
    const hqId = form.get('hqId')
    const file = form.get('file')
    if (!hqId || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'hqId and a contract file are required' }, { status: 400 })
    }
    if (!/\.pdf$/i.test(file.name || '')) {
      return NextResponse.json({ error: 'Contract must be a PDF' }, { status: 400 })
    }

    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const creatorName = record.fields?.['Creator'] || 'creator'
    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = `Palm Management - ${creatorName} - Signed Agreement.pdf`

    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    const dropboxPath = `/Palm Ops/Contracts/${filename}`
    await uploadToDropbox(accessToken, rootNs, dropboxPath, buffer, { overwrite: true })
    const sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)
    const directUrl = sharedLink.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')

    // Populate the same fields the e-sign flow does → onboarding marks the
    // contract step done and shows this uploaded file.
    await patchHqRecord(HQ_CREATORS, hqId, {
      'Contract': [{ url: directUrl, filename }],
      'Contract Sign Date': new Date().toISOString().split('T')[0],
    })

    return NextResponse.json({ success: true, filename, url: sharedLink })
  } catch (err) {
    console.error('[admin/onboarding/upload-contract] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
