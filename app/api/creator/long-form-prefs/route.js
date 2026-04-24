import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

async function resolveAuth(request) {
  const { userId } = auth()
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'editor'

  const { searchParams } = new URL(request.url)
  const creatorOpsId = searchParams.get('creatorOpsId')
  if (!creatorOpsId || !/^rec[A-Za-z0-9]{14}$/.test(creatorOpsId)) {
    return { error: NextResponse.json({ error: 'Invalid creatorOpsId' }, { status: 400 }) }
  }
  if (!isAdmin && user?.publicMetadata?.airtableOpsId !== creatorOpsId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { creatorOpsId, isAdmin }
}

export async function GET(request) {
  const { error, creatorOpsId } = await resolveAuth(request)
  if (error) return error

  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
  const data = await res.json()
  return NextResponse.json({
    longFormPrefs: data.fields?.['Long-Form Editing Preferences'] || '',
  })
}

export async function PATCH(request) {
  const { error, creatorOpsId } = await resolveAuth(request)
  if (error) return error

  const body = await request.json()
  const prefs = typeof body.longFormPrefs === 'string' ? body.longFormPrefs : ''

  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${CREATORS_TABLE}/${creatorOpsId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Long-Form Editing Preferences': prefs } }),
    }
  )
  if (!res.ok) {
    return NextResponse.json({ error: 'Update failed', detail: await res.text() }, { status: 500 })
  }
  return NextResponse.json({ ok: true, longFormPrefs: prefs })
}
