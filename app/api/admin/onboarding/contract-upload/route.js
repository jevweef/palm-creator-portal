import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { patchHqRecord, fetchHqRecord } from '@/lib/hqAirtable'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// Admin uploads an already-signed contract PDF for a creator. Attaches it to the
// HQ Creators 'Contract' field and sets 'Contract Sign Date', which is the single
// flag the creator wizard uses to treat the contract step as already done.
export async function POST(request) {
  try {
    await requireAdmin()

    const formData = await request.formData()
    const hqId = formData.get('hqId')
    const file = formData.get('contract')

    if (!hqId || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'hqId and contract file are required' }, { status: 400 })
    }

    const name = file.name || 'contract.pdf'
    if (!name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Contract must be a PDF file' }, { status: 400 })
    }

    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const creatorName = record.fields?.['Creator'] || 'Creator'
    const filename = `Palm Management - ${creatorName} - Agreement.pdf`

    const arrayBuffer = await file.arrayBuffer()
    const pdfBuffer = Buffer.from(arrayBuffer)

    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    const dropboxPath = `/Palm Ops/Contracts/${filename}`

    await uploadToDropbox(accessToken, rootNs, dropboxPath, pdfBuffer)
    const sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)
    const directUrl = sharedLink.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')

    await patchHqRecord(HQ_CREATORS, hqId, {
      'Contract': [{ url: directUrl, filename }],
      'Contract Sign Date': new Date().toISOString().split('T')[0],
    })

    return NextResponse.json({ success: true, filename })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[admin/onboarding/contract-upload] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
