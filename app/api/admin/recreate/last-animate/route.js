import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, listDropboxFolder, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// GET /api/admin/recreate/last-animate?creatorId=...&shortcode=...
// Lists the creator's recreations/{shortcode} folder and returns the most
// recent animated-*.mp4 file. Rehydrates Step 7's result on page refresh
// without re-running Kling. Note shortcode here is the START shortcode
// (not {shortcode}-end since end-frame Step 5 swaps go to a different
// folder but the muxed video lands under the start shortcode).
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { searchParams } = new URL(request.url)
    const creatorId = searchParams.get('creatorId')
    const shortcode = searchParams.get('shortcode')
    if (!creatorId || !shortcode) {
      return NextResponse.json({ error: 'Missing creatorId or shortcode' }, { status: 400 })
    }

    const records = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = '${creatorId}'`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!records.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = records[0].fields.AKA
    if (!aka) return NextResponse.json({ error: 'Creator missing AKA' }, { status: 400 })

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)
    const folder = `/Palm Ops/Creators/${aka}/recreations/${shortcode}`

    let entries = []
    try {
      entries = await listDropboxFolder(accessToken, rootNamespaceId, folder)
    } catch (e) {
      return NextResponse.json({ ok: true, output: null })
    }

    // Find most recent animated-*.mp4
    const videos = entries
      .filter(e => e['.tag'] === 'file')
      .filter(e => /^animated-\d+\.mp4$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    const latest = videos[videos.length - 1]
    if (!latest) return NextResponse.json({ ok: true, output: null })

    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, `${folder}/${latest.name}`)
    const url = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    return NextResponse.json({
      ok: true,
      output: { url, filename: latest.name, savedAt: latest.server_modified || null },
      total: videos.length,
    })
  } catch (err) {
    console.error('[recreate/last-animate] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
