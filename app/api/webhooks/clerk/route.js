import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const HQ_BASE = 'appL7c4Wtotpz07KS'
const OPS_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

const atHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

async function findCreatorByEmail(email) {
  if (!email) return null

  const lower = email.toLowerCase()

  // Search HQ Creators by Communication Email and OF Email
  const hqUrl = `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS_TABLE}?filterByFormula=OR(LOWER({Communication Email})="${lower}",LOWER({OF Email})="${lower}")&maxRecords=1`
  const hqRes = await fetch(hqUrl, { headers: atHeaders })
  const hqData = await hqRes.json()
  const hqRecord = hqData.records?.[0]

  if (!hqRecord) return null

  // Found in HQ — now find matching Ops record by creator name
  const creatorName = hqRecord.fields['Creator'] || ''
  const aka = hqRecord.fields['AKA'] || ''

  let opsRecord = null
  if (creatorName) {
    const opsUrl = `https://api.airtable.com/v0/${OPS_BASE}/${OPS_CREATORS_TABLE}?filterByFormula=OR({Creator}="${creatorName}",{AKA}="${aka}")&maxRecords=1`
    const opsRes = await fetch(opsUrl, { headers: atHeaders })
    const opsData = await opsRes.json()
    opsRecord = opsData.records?.[0]
  }

  return {
    hqId: hqRecord.id,
    opsId: opsRecord?.id || null,
    name: creatorName,
    aka,
  }
}

// POST /api/webhooks/clerk
// Clerk sends user.created events here
export async function POST(request) {
  try {
    const payload = await request.json()
    const { type, data } = payload

    // Only handle user.created events
    if (type !== 'user.created') {
      return NextResponse.json({ received: true })
    }

    // Get the user's email addresses
    const emails = (data.email_addresses || []).map(e => e.email_address)
    if (emails.length === 0) {
      console.log('[clerk-webhook] No email addresses on user, skipping')
      return NextResponse.json({ received: true })
    }

    // Try to match each email against Airtable
    let match = null
    for (const email of emails) {
      match = await findCreatorByEmail(email)
      if (match) break
    }

    if (!match) {
      console.log(`[clerk-webhook] No Airtable match for emails: ${emails.join(', ')}`)
      return NextResponse.json({ received: true, matched: false })
    }

    console.log(`[clerk-webhook] Matched ${emails[0]} → ${match.name} (HQ: ${match.hqId}, Ops: ${match.opsId})`)

    // Set public metadata on the Clerk user
    const metadata = {
      userType: 'creator',
      airtableHqId: match.hqId,
    }
    if (match.opsId) {
      metadata.airtableOpsId = match.opsId
    }

    await clerkClient.users.updateUserMetadata(data.id, {
      publicMetadata: metadata,
    })

    console.log(`[clerk-webhook] Set metadata for ${match.name}: ${JSON.stringify(metadata)}`)

    return NextResponse.json({ received: true, matched: true, creator: match.name })
  } catch (err) {
    console.error('[clerk-webhook] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
