import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchHqRecord } from '@/lib/hqAirtable'
import { buildContractHtml } from '@/lib/generateContractPdf'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

export async function GET(request) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const hqId = searchParams.get('hqId')
  if (!hqId) {
    return NextResponse.json({ error: 'hqId required' }, { status: 400 })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const c = record.fields || {}

    let commissionTier = null
    try { commissionTier = c['Commission Tier'] ? JSON.parse(c['Commission Tier']) : null } catch {}

    const contractData = {
      creatorName: c['Creator'] || '',
      commissionPct: c['Commission %'] || 0,
      commissionTier,
      creatorState: c['Creator State'] || '',
      effectiveDate: c['Onboarding Token Created At'] || new Date().toISOString(),
      agencySignature: c['Agency Signature'] || null,
      agencyName: c['Agency Signer Name'] || 'Josh Voto',
      agencySignDate: c['Onboarding Token Created At'] || new Date().toISOString(),
    }

    // Check if already signed
    const contractSignDate = c['Contract Sign Date'] || null
    const contractAttachment = c['Contract'] // array of attachment objects
    const alreadySigned = !!contractSignDate
    let contractUrl = null
    let contractFilename = null
    if (alreadySigned && contractAttachment && contractAttachment.length > 0) {
      contractUrl = contractAttachment[0].url
      contractFilename = contractAttachment[0].filename || `Palm Management - ${c['Creator'] || 'Creator'} - Agreement.pdf`
    }

    // Return the contract HTML for in-browser preview
    const html = buildContractHtml(contractData)

    return NextResponse.json({
      html,
      contractData,
      alreadySigned,
      contractSignDate,
      contractUrl,
      contractFilename,
    })
  } catch (err) {
    console.error('[contract/generate] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
