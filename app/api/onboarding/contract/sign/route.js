import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { patchHqRecord, fetchHqRecord } from '@/lib/hqAirtable'
import { generateContractPdf } from '@/lib/generateContractPdf'

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

    // Generate signed PDF
    const contractData = {
      creatorName: c['Creator'] || '',
      commissionPct: c['Commission %'] || 0,
      creatorState: c['Creator State'] || '',
      effectiveDate: new Date().toISOString(),
      signatureDataUrl: signatureDataUrl || null,
      signedName: signedName || '',
      signedDate: new Date().toISOString(),
    }

    const pdfBuffer = await generateContractPdf(contractData)

    // Upload PDF as base64 attachment to Airtable
    const base64Pdf = pdfBuffer.toString('base64')
    const filename = `contract-palm-digital-${(c['Creator'] || 'creator').replace(/\s+/g, '-').toLowerCase()}.pdf`

    await patchHqRecord(HQ_CREATORS, hqId, {
      'Contract': [{ url: `data:application/pdf;base64,${base64Pdf}`, filename }],
      'Contract Sign Date': new Date().toISOString().split('T')[0],
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[contract/sign] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
