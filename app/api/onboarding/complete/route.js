import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { patchHqRecord } from '@/lib/hqAirtable'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const OPS_BASE = 'applLIT2t83plMqNx'
const OPS_CREATORS = 'tbls2so6pHGbU4Uhh'
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

async function linkOpsToHq(opsId, hqId) {
  if (!opsId || !hqId) return
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${OPS_CREATORS}/${opsId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { 'HQ Record ID': hqId } }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ops HQ Record ID PATCH ${res.status}: ${text}`)
  }
}

export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  const { hqId } = await request.json()
  if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

  if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await patchHqRecord(HQ_CREATORS, hqId, {
      'Onboarding Status': 'Completed',
      'Onboarding Date': new Date().toISOString().split('T')[0],
    })

    const opsId = user?.publicMetadata?.airtableOpsId
    if (opsId) {
      try {
        await linkOpsToHq(opsId, hqId)
      } catch (linkErr) {
        console.error('[onboarding/complete] Failed to link Ops → HQ:', linkErr.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/complete] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
