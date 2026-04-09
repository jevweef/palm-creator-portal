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

    if (!isAdmin && userHqId !== hqId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const fields = {}

    if (step === 'basic-info') {
      if (data.name) fields['Creator'] = data.name
      if (data.stageName !== undefined) fields['AKA'] = data.stageName
      if (data.birthday) fields['Birthday'] = data.birthday
      if (data.location !== undefined) fields['Address'] = data.location
      if (data.igAccount !== undefined) fields['IG Account'] = data.igAccount
      if (data.timeZone !== undefined) fields['Time Zone'] = data.timeZone
      if (data.telegram !== undefined) fields['Telegram'] = data.telegram
      if (data.communication && data.communication.length > 0) {
        fields['Communication'] = data.communication
      }
      fields['Onboarding Status'] = 'In Progress'
    }

    if (step === 'accounts') {
      // Platform credentials
      if (data.ofUrl !== undefined) fields['Onlyfans URL'] = data.ofUrl
      if (data.ofEmail !== undefined) fields['OF Email'] = data.ofEmail
      if (data.ofPassword) fields['OF Password'] = data.ofPassword
      if (data.secondOfUrl !== undefined) fields['2nd OF URL'] = data.secondOfUrl
      if (data.secondOfEmail !== undefined) fields['2nd OF Email'] = data.secondOfEmail
      if (data.secondOfPassword) fields['2nd OF Password'] = data.secondOfPassword
      if (data.fanslyUsername !== undefined) fields['Fansly Username'] = data.fanslyUsername
      if (data.fanslyEmail !== undefined) fields['Fansly Email'] = data.fanslyEmail
      if (data.fanslyPassword) fields['Fansly Password'] = data.fanslyPassword
      // Social handles
      if (data.tiktok !== undefined) fields['TikTok'] = data.tiktok
      if (data.twitter !== undefined) fields['Twitter'] = data.twitter
      if (data.reddit !== undefined) fields['Reddit'] = data.reddit
      if (data.youtube !== undefined) fields['YouTube'] = data.youtube
      if (data.oftv !== undefined) fields['OFTV'] = data.oftv
      if (data.otherSocials !== undefined) fields['Other Socials'] = data.otherSocials
      // Track which platforms were selected
      if (data.selectedPlatforms) fields['Selected Platforms'] = JSON.stringify(data.selectedPlatforms)
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
