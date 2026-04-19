import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'

export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { creatorHqId } = await request.json()

    if (!creatorHqId) {
      return NextResponse.json({ error: 'Missing creatorHqId' }, { status: 400 })
    }

    // Ownership check — creators can only get their own upload token
    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isAdmin = role === 'admin' || role === 'super_admin'
    const isEditor = role === 'editor'
    if (!isAdmin && !isEditor && user?.publicMetadata?.airtableHqId !== creatorHqId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get creator name from HQ
    const creatorRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}/${creatorHqId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!creatorRes.ok) throw new Error('Failed to fetch creator record')
    const creator = await creatorRes.json()
    const creatorName = creator.fields['Creator'] || ''

    // Find onboarding record for Dropbox path
    const nameFilter = encodeURIComponent(`FIND("${creatorName}", {Creator})`)
    const onboardingRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_ONBOARDING}?filterByFormula=${nameFilter}&maxRecords=1`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!onboardingRes.ok) throw new Error('Failed to fetch onboarding record')
    const onboarding = await onboardingRes.json()

    if (!onboarding.records?.length) {
      throw new Error('No onboarding record found')
    }

    const rootPath = onboarding.records[0].fields['Dropbox Creator Root Path']
    if (!rootPath) throw new Error('No Dropbox root path configured')

    // Get Dropbox access token and namespace
    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const aka = creator.fields['AKA'] || creatorName

    return NextResponse.json({
      accessToken,
      rootNamespaceId,
      uploadFolder: `${rootPath}/Social Media/20_NEEDS_EDIT`,
      creatorName: aka,
    })
  } catch (err) {
    console.error('[upload-token] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
