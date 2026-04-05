import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { patchHqRecord } from '@/lib/hqAirtable'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'
    const userHqId = user?.publicMetadata?.airtableHqId

    const { hqId, step, data } = await request.json()
    if (!hqId || !step || !data) {
      return NextResponse.json({ error: 'hqId, step, and data are required' }, { status: 400 })
    }

    // Ownership check: creators can only save their own data
    if (!isAdmin && userHqId !== hqId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Map step data to Airtable fields
    const fields = {}

    if (step === 'basic-info') {
      if (data.name) fields['Creator'] = data.name
      if (data.stageName) fields['AKA'] = data.stageName
      if (data.birthday) fields['Birthday'] = data.birthday
      if (data.location) fields['Address'] = data.location
      if (data.igAccount) fields['IG Account'] = data.igAccount
      fields['Onboarding Status'] = 'In Progress'
    }

    if (Object.keys(fields).length > 0) {
      await patchHqRecord(HQ_CREATORS, hqId, fields)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/save] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
