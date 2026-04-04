import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, batchCreateRecords } from '@/lib/adminAuth'

const SOURCE_FIELDS = [
  'Handle', 'Platform', 'Enabled', 'Pipeline Status', 'Last Scraped At',
  'Reels Scraped', 'Too New Skipped', 'Source Reels Added', 'Follower Count',
  'Lookback Days', 'Apify Limit', 'Palm Creators', 'Notes', 'Age Restricted', 'Added By', 'Date Added', 'Account Status',
]

export async function GET() {
  try {
    await requireAdmin()

    const records = await fetchAirtableRecords('Inspo Sources', {
      fields: SOURCE_FIELDS,
    })

    const sources = records.map(r => ({
      id: r.id,
      handle: r.fields?.Handle || '',
      platform: r.fields?.Platform || 'Instagram',
      enabled: !!r.fields?.Enabled,
      pipelineStatus: r.fields?.['Pipeline Status'] || '',
      lastScrapedAt: r.fields?.['Last Scraped At'] || null,
      reelsScraped: r.fields?.['Reels Scraped'] || 0,
      tooNewSkipped: r.fields?.['Too New Skipped'] || 0,
      sourceReelsAdded: r.fields?.['Source Reels Added'] || 0,
      followerCount: r.fields?.['Follower Count'] || null,
      lookbackDays: r.fields?.['Lookback Days'] || 180,
      apifyLimit: r.fields?.['Apify Limit'] || null,
      palmCreators: r.fields?.['Palm Creators'] || [],
      notes: r.fields?.Notes || '',
      ageRestricted: !!r.fields?.['Age Restricted'],
      addedBy: r.fields?.['Added By'] || '',
      dateAdded: r.fields?.['Date Added'] || null,
      accountStatus: r.fields?.['Account Status']?.name || r.fields?.['Account Status'] || 'Active',
    }))

    // Sort: enabled first, then by handle
    sources.sort((a, b) => {
      if (a.enabled !== b.enabled) return b.enabled - a.enabled
      return a.handle.localeCompare(b.handle)
    })

    return NextResponse.json({ sources })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Sources GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const user = await requireAdmin()

    const body = await request.json()
    const { handle, platform, lookbackDays, apifyLimit, palmCreators } = body

    if (!handle?.trim()) {
      return NextResponse.json({ error: 'Handle is required' }, { status: 400 })
    }

    const addedBy = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.emailAddresses?.[0]?.emailAddress || ''

    // Bulk add: { sources: [{ handle, palmCreators }, ...] }
    if (body.sources && Array.isArray(body.sources)) {
      const records = body.sources.map(s => ({
        fields: {
          Handle: (s.handle || '').trim().toLowerCase(),
          Platform: 'Instagram',
          Enabled: s.accountStatus === 'Dead' ? false : true,
          'Lookback Days': 180,
          'Added By': addedBy,
          'Date Added': new Date().toISOString().split('T')[0],
          ...(s.palmCreators?.length ? { 'Palm Creators': s.palmCreators } : {}),
          ...(s.accountStatus ? { 'Account Status': s.accountStatus } : { 'Account Status': 'Active' }),
        },
      }))
      const created = await batchCreateRecords('Inspo Sources', records)
      return NextResponse.json({ sources: created })
    }

    // Single add
    const fields = {
      Handle: handle.trim().toLowerCase(),
      Platform: platform || 'Instagram',
      Enabled: true,
      'Lookback Days': lookbackDays || 180,
      'Added By': addedBy,
      'Date Added': new Date().toISOString().split('T')[0],
    }
    if (apifyLimit) fields['Apify Limit'] = apifyLimit
    if (palmCreators?.length) fields['Palm Creators'] = palmCreators

    const created = await batchCreateRecords('Inspo Sources', [{ fields }])

    return NextResponse.json({ source: created[0] })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Sources POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    await requireAdmin()

    const body = await request.json()
    const { id, fields } = body

    if (!id) {
      return NextResponse.json({ error: 'Record ID is required' }, { status: 400 })
    }

    // Only allow updating specific fields
    const allowed = ['Enabled', 'Lookback Days', 'Apify Limit', 'Palm Creators', 'Notes', 'Pipeline Status', 'Account Status']
    const cleanFields = {}
    for (const key of allowed) {
      if (key in fields) cleanFields[key] = fields[key]
    }

    const updated = await patchAirtableRecord('Inspo Sources', id, cleanFields)

    return NextResponse.json({ source: updated })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Sources PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
