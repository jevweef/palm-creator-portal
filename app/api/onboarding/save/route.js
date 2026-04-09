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
      if (data.stageName) fields['AKA'] = data.stageName
      if (data.birthday) fields['Birthday'] = data.birthday
      if (data.location) fields['Address'] = data.location
      if (data.igAccount) fields['IG Account'] = data.igAccount
      if (data.timeZone) fields['Time Zone'] = data.timeZone
      if (data.telegram) fields['Telegram'] = data.telegram
      if (data.communication && data.communication.length > 0) {
        fields['Communication'] = data.communication
      }
      fields['Onboarding Status'] = 'In Progress'
    }

    if (step === 'accounts') {
      if (data.ofUrl) fields['Onlyfans URL'] = data.ofUrl
      if (data.ofEmail) fields['OF Email'] = data.ofEmail
      if (data.ofPassword) fields['OF Password'] = data.ofPassword
      if (data.secondOfEmail) fields['2nd OF Email'] = data.secondOfEmail
      if (data.secondOfPassword) fields['2nd OF Password'] = data.secondOfPassword
      if (data.tiktok) fields['TikTok'] = data.tiktok
      if (data.twitter) fields['Twitter'] = data.twitter
      if (data.reddit) fields['Reddit'] = data.reddit
      if (data.youtube) fields['YouTube'] = data.youtube
      if (data.oftv) fields['OFTV'] = data.oftv
      if (data.otherSocials) fields['Other Socials'] = data.otherSocials
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
