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

    const contractData = {
      creatorName: c['Creator'] || '',
      commissionPct: c['Commission %'] || 0,
      creatorState: c['Creator State'] || '',
      effectiveDate: new Date().toISOString(),
    }

    // Return the contract HTML for in-browser preview
    const html = buildContractHtml(contractData)

    return NextResponse.json({
      html,
      contractData,
    })
  } catch (err) {
    console.error('[contract/generate] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
