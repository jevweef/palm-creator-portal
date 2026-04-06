import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { patchHqRecord, fetchHqRecord } from '@/lib/hqAirtable'
import { generateContractPdf } from '@/lib/generateContractPdf'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

export async function POST(request) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  const { hqId, signatureDataUrl, signedName } = await request.json()
  if (!hqId || (!signatureDataUrl && !signedName)) {
    return NextResponse.json({ error: 'hqId and signature required' }, { status: 400 })
  }

  if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const c = record.fields || {}
    const creatorName = c['Creator'] || 'creator'

    // Generate signed PDF with both signatures
    const contractData = {
      creatorName,
      commissionPct: c['Commission %'] || 0,
      creatorState: c['Creator State'] || '',
      effectiveDate: c['Onboarding Token Created At'] || new Date().toISOString(),
      signatureDataUrl: signatureDataUrl || null,
      signedName: signedName || '',
      signedDate: new Date().toISOString(),
      agencySignature: c['Agency Signature'] || null,
      agencyName: 'Josh Voto',
      agencySignDate: c['Onboarding Token Created At'] || new Date().toISOString(),
    }

    const pdfBuffer = await generateContractPdf(contractData)
    const filename = `contract-palm-digital-${creatorName.replace(/\s+/g, '-').toLowerCase()}.pdf`

    // Upload to Dropbox
    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    const dropboxPath = `/Palm Ops/Contracts/${filename}`

    await uploadToDropbox(accessToken, rootNs, dropboxPath, pdfBuffer)
    const sharedLink = await createDropboxSharedLink(accessToken, rootNs, dropboxPath)

    // Convert Dropbox shared link to direct download URL for Airtable attachment
    const directUrl = sharedLink.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')

    // Attach to Airtable using the Dropbox URL
    await patchHqRecord(HQ_CREATORS, hqId, {
      'Contract': [{ url: directUrl, filename }],
      'Contract Sign Date': new Date().toISOString().split('T')[0],
    })

    // Return the PDF as base64 so frontend can display the final document
    const pdfBase64 = pdfBuffer.toString('base64')

    return NextResponse.json({ success: true, dropboxUrl: sharedLink, pdfBase64 })
  } catch (err) {
    console.error('[contract/sign] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
