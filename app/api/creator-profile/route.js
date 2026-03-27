import { NextResponse } from 'next/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'
const HQ_INVOICES = 'tblKbU8VkdlOHXoJj'

const headers = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

async function fetchAirtable(base, table, params = '') {
  const res = await fetch(
    `https://api.airtable.com/v0/${base}/${table}${params}`,
    { headers, next: { revalidate: 300 } }
  )
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    // For testing, allow passing a record ID. In production, this comes from Clerk metadata.
    const hqId = searchParams.get('hqId') || 'recd0HgtW0XCcSwMd' // Default: Raya

    // Step 1: Fetch creator profile to get their name (needed for linked record filters)
    const creatorData = await fetchAirtable(HQ_BASE, HQ_CREATORS, `/${hqId}`)
    const creatorName = creatorData.fields?.['Creator'] || ''

    // Step 2: Use creator name to filter onboarding + invoices in parallel
    const nameFilter = encodeURIComponent(`FIND("${creatorName}", {Creator})`)
    const [onboardingData, invoicesData] = await Promise.all([
      fetchAirtable(HQ_BASE, HQ_ONBOARDING, `?filterByFormula=${nameFilter}&maxRecords=1`),
      fetchAirtable(HQ_BASE, HQ_INVOICES, `?filterByFormula=${nameFilter}&sort%5B0%5D%5Bfield%5D=Period+End&sort%5B0%5D%5Bdirection%5D=desc`),
    ])

    // Parse creator profile
    const c = creatorData.fields || {}
    const profile = {
      name: c['Creator'] || '',
      aka: c['AKA'] || '',
      status: c['Status'] || '',
      commission: c['Commission %'] || 0,
      onlyfansUrl: c['Onlyfans URL'] || '',
      igAccount: c['IG Account'] || '',
      managementStartDate: c['Management Start Date'] || '',
      telegram: c['Telegram'] || '',
      previousMonthTR: c['Previous Month TR'] || 0,
      contractUrl: c['Contract']?.[0]?.url || null,
      contractFilename: c['Contract']?.[0]?.filename || null,
      communicationEmail: c['Communication Email'] || '',
      ofEmail: c['OF Email'] || '',
    }

    // Parse onboarding (Dropbox links)
    const ob = onboardingData.records?.[0]?.fields || {}
    const uploads = {
      socialUploadUrl: ob['Social File Request URL'] || '',
      longformUploadUrl: ob['Longform File Request URL'] || '',
      dropboxRootPath: ob['Dropbox Creator Root Path'] || '',
    }

    // Parse invoices
    const invoices = (invoicesData.records || []).map((rec) => {
      const f = rec.fields || {}
      return {
        id: rec.id,
        label: f['Period Label'] || '',
        periodStart: f['Period Start'] || '',
        periodEnd: f['Period End'] || '',
        earnings: f['Earnings (TR)'] || 0,
        commissionPct: f['Commission % (Snapshot)'] || 0,
        chatTeamPct: f['Chat Team Fee % (Snapshot)'] || 0,
        netCommissionPct: f['Net Commission %'] || 0,
        totalCommission: f['Total Commission'] || 0,
        chatTeamCost: f['Chat Team Cost'] || 0,
        netProfit: f['Net Profit'] || 0,
        dueDate: f['Due Date'] || '',
        invoicePdfUrl: f['Chat Team Invoice']?.[0]?.url || null,
        invoiceFilename: f['Chat Team Invoice']?.[0]?.filename || null,
      }
    })

    return NextResponse.json({ profile, uploads, invoices })
  } catch (err) {
    console.error('Creator profile API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
