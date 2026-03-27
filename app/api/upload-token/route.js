import { NextResponse } from 'next/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'

export async function POST(request) {
  try {
    const { creatorHqId } = await request.json()

    if (!creatorHqId) {
      return NextResponse.json({ error: 'Missing creatorHqId' }, { status: 400 })
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

    return NextResponse.json({
      accessToken,
      rootNamespaceId,
      uploadFolder: `${rootPath}/Social Media/20_NEEDS_EDIT`,
    })
  } catch (err) {
    console.error('[upload-token] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
