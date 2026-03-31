import { NextResponse } from 'next/server'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'
import { requireAdminOrEditor, OPS_BASE, airtableHeaders } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'
const OPS_CREATORS = 'tbls2so6pHGbU4Uhh'

export async function POST(request) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  try {
    const { creatorId } = await request.json().catch(() => ({}))

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    // If no creatorId, fall back to legacy flat folder
    if (!creatorId) {
      return NextResponse.json({ accessToken, rootNamespaceId, uploadFolder: '/Palm Ops/Edited Exports' })
    }

    // Look up creator name from OPS base
    const creatorRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${OPS_CREATORS}/${creatorId}`,
      { headers: airtableHeaders, cache: 'no-store' }
    )
    if (!creatorRes.ok) throw new Error('Failed to fetch creator')
    const creator = await creatorRes.json()
    const creatorName = creator.fields?.['Creator'] || ''

    // Find onboarding record for Dropbox root path
    const nameFilter = encodeURIComponent(`FIND("${creatorName}", {Creator})`)
    const onboardingRes = await fetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_ONBOARDING}?filterByFormula=${nameFilter}&maxRecords=1`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }, cache: 'no-store' }
    )
    if (!onboardingRes.ok) throw new Error('Failed to fetch onboarding record')
    const onboarding = await onboardingRes.json()

    const rootPath = onboarding.records?.[0]?.fields?.['Dropbox Creator Root Path']
    if (!rootPath) throw new Error(`No Dropbox root path configured for ${creatorName}`)

    return NextResponse.json({
      accessToken,
      rootNamespaceId,
      uploadFolder: `${rootPath}/Social Media/35_FINALS_FOR_REVIEW`,
    })
  } catch (err) {
    console.error('[editor-upload-token] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
