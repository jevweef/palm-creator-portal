import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const SOURCE_REELS_TABLE = 'Source Reels'

const SHORTCODE_RE = /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/

function extractShortcode(url) {
  const m = url?.match(SHORTCODE_RE)
  return m ? m[1] : null
}

// Look up an inspo reel by IG URL or shortcode and return its Dropbox video,
// thumbnail, and metadata so the frontend can pull a frame without re-uploading.
export async function GET(request) {
  try {
    await requireAdmin()
  } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url') || ''
  const shortcode = searchParams.get('shortcode') || extractShortcode(url)

  if (!shortcode) {
    return NextResponse.json({ error: 'Missing url or shortcode' }, { status: 400 })
  }

  try {
    // Try Inspiration table first — these are reviewed reels with full pipeline data.
    // SEARCH is case-insensitive and tolerates URL format differences (/reel/ vs /reels/).
    const inspoRecords = await fetchAirtableRecords(INSPIRATION_TABLE, {
      filterByFormula: `SEARCH("${shortcode}", {Content link})`,
      fields: ['Content link', 'Username', 'Title', 'Thumbnail', 'DB Share Link', 'DB Raw = 1', 'DB Embed Code', 'On-Screen Text', 'Notes', 'Tags', 'Film Format', 'Kling Prompt', 'Status', 'Recreate Scene Prompt', 'Recreate Scene Negative', 'Recreate Shot Type', 'Recreate Motion Prompt', 'Recreate Motion Negative', 'Recreate Notes', 'Recreate Source Frame URL', 'Recreate End Frame URL'],
      maxRecords: 1,
    })

    if (inspoRecords.length) {
      const r = inspoRecords[0]
      return NextResponse.json({
        source: 'Inspiration',
        id: r.id,
        url: r.fields['Content link'] || '',
        username: r.fields['Username'] || '',
        title: r.fields['Title'] || '',
        onScreenText: r.fields['On-Screen Text'] || '',
        notes: r.fields['Notes'] || '',
        tags: r.fields['Tags'] || [],
        filmFormat: r.fields['Film Format'] || [],
        klingPrompt: r.fields['Kling Prompt'] || '',
        thumbnail: r.fields['Thumbnail']?.[0]?.url || null,
        dbShareLink: r.fields['DB Share Link'] || '',
        dbRawLink: r.fields['DB Raw = 1'] || '',
        dbEmbedCode: r.fields['DB Embed Code'] || '',
        status: r.fields['Status'] || '',
        shortcode,
        // Cached Recreate prompts (creator-agnostic — same scene/motion
        // regardless of which creator is doing the swap)
        recreateScenePrompt: r.fields['Recreate Scene Prompt'] || '',
        recreateSceneNegative: r.fields['Recreate Scene Negative'] || '',
        recreateShotType: r.fields['Recreate Shot Type']?.name || r.fields['Recreate Shot Type'] || '',
        recreateMotionPrompt: r.fields['Recreate Motion Prompt'] || '',
        recreateMotionNegative: r.fields['Recreate Motion Negative'] || '',
        recreateNotes: r.fields['Recreate Notes'] || '',
        recreateSourceFrameUrl: r.fields['Recreate Source Frame URL'] || '',
        recreateEndFrameUrl: r.fields['Recreate End Frame URL'] || '',
      })
    }

    // Fall back to Source Reels (not yet promoted to Inspiration)
    const srRecords = await fetchAirtableRecords(SOURCE_REELS_TABLE, {
      filterByFormula: `SEARCH("${shortcode}", {Reel URL})`,
      fields: ['Reel URL', 'Username', 'Source Handle', 'Caption'],
      maxRecords: 1,
    })

    if (srRecords.length) {
      const r = srRecords[0]
      return NextResponse.json({
        source: 'Source Reels',
        id: r.id,
        url: r.fields['Reel URL'] || '',
        username: r.fields['Username'] || r.fields['Source Handle'] || '',
        caption: r.fields['Caption'] || '',
        thumbnail: null,
        dbShareLink: '',
        dbRawLink: '',
        dbEmbedCode: '',
        shortcode,
      })
    }

    return NextResponse.json({ source: null, shortcode })
  } catch (err) {
    console.error('[recreate/lookup] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
