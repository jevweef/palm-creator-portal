import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { patchHqRecord } from '@/lib/hqAirtable'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

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

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/complete] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
