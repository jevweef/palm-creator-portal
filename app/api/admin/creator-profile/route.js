import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, airtableHeaders, OPS_BASE } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const PROFILE_DOCS_TABLE = 'tblzRPH4149dUg0SL'
const TAG_WEIGHTS_TABLE = 'tbljiwFQBknbUCpc6'

// GET /api/admin/creator-profile?creatorId=recXXX
// Returns profile fields, documents, and tag weights for one creator
export async function GET(request) {
  try {
    await requireAdmin()

    const { searchParams } = new URL(request.url)
    const creatorId = searchParams.get('creatorId')
    if (!creatorId) {
      return NextResponse.json({ error: 'creatorId is required' }, { status: 400 })
    }

    // Fetch creator record
    const creatorRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorId}`,
      { headers: airtableHeaders }
    )
    if (!creatorRes.ok) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }
    const creatorData = await creatorRes.json()
    const f = creatorData.fields || {}

    const creator = {
      id: creatorData.id,
      name: f['Creator'] || '',
      aka: f['AKA'] || '',
      status: f['Status'] || '',
      profileSummary: f['Profile Summary'] || '',
      brandVoiceNotes: f['Brand Voice Notes'] || '',
      contentDirectionNotes: f['Content Direction Notes'] || '',
      dosDonts: f['Dos and Donts'] || '',
      profileAnalysisStatus: f['Profile Analysis Status'] || 'Not Started',
      profileLastAnalyzed: f['Profile Last Analyzed'] || null,
      adminFeedback: f['Admin Feedback'] || '',
      refinementHistory: (() => { try { return JSON.parse(f['Refinement History'] || '[]') } catch { return [] } })(),
      musicDnaInput: f['Music DNA Input'] || '',
      musicDnaType: f['Music DNA Type'] || '',
      musicDnaProcessed: (() => { try { return JSON.parse(f['Music DNA Processed'] || 'null') } catch { return null } })(),
    }

    // Fetch documents for this creator
    // Note: filterByFormula on linked record fields matches primary field value (name), not record ID.
    // Fetch all and filter in JS by record ID instead.
    const allDocRecords = await fetchAirtableRecords('Creator Profile Documents', {
      sort: [{ field: 'Upload Date', direction: 'desc' }],
    })
    const docRecords = allDocRecords.filter(r =>
      (r.fields['Creator'] || []).some(c => (c.id || c) === creatorId)
    )
    const documents = docRecords.map(r => ({
      id: r.id,
      fileName: r.fields['File Name'] || '',
      fileType: r.fields['File Type'] || '',
      dropboxPath: r.fields['Dropbox Path'] || '',
      uploadDate: r.fields['Upload Date'] || '',
      analysisStatus: r.fields['Analysis Status'] || 'Pending',
      hasExtractedText: !!(r.fields['Extracted Text'] || '').trim(),
      notes: r.fields['Notes'] || '',
    }))

    // Fetch tag weights for this creator
    const allWeightRecords = await fetchAirtableRecords('Creator Tag Weights', {
      sort: [{ field: 'Weight', direction: 'desc' }],
    })
    const weightRecords = allWeightRecords.filter(r =>
      (r.fields['Creator'] || []).some(c => (c.id || c) === creatorId)
    )
    const tagWeights = weightRecords.map(r => ({
      id: r.id,
      tag: r.fields['Tag'] || '',
      category: r.fields['Tag Category'] || '',
      weight: r.fields['Weight'] ?? 0,
      lastUpdated: r.fields['Last Updated'] || '',
    }))

    return NextResponse.json({ creator, documents, tagWeights })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
