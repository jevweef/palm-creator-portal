import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, listDropboxFolder, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'

const PALM_CREATORS = 'Palm Creators'

function rawDropboxUrl(url) {
  if (!url) return ''
  return url.replace(/[?&]dl=0/, '').replace(/([?&]raw=1)?$/, '') + (url.includes('?') ? '&raw=1' : '?raw=1')
}

// GET /api/admin/recreate/last-swap?creatorId=...&shortcode=...
// Lists the creator's recreations/{shortcode} folder in Dropbox and returns
// the most recent swap-*.png/jpg/etc. file as a public URL. Used to
// rehydrate Step 5's result on page refresh without re-running Wan 2.7.
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
      // Folder might not exist yet — no swap done
      return NextResponse.json({ ok: true, output: null })
    }

    // Find the most recent swap-*.{png,jpg,jpeg,webp} file (filename has
    // a millis timestamp so sorting lexicographically gives newest last)
    const swaps = entries
      .filter(e => e['.tag'] === 'file')
      .filter(e => /^swap-\d+\.(png|jpe?g|webp)$/i.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    const latest = swaps[swaps.length - 1]
    if (!latest) return NextResponse.json({ ok: true, output: null })

    const sharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, `${folder}/${latest.name}`)
    const url = `${rawDropboxUrl(sharedLink)}&t=${Date.now()}`

    return NextResponse.json({
      ok: true,
      output: { url, filename: latest.name, savedAt: latest.server_modified || null },
      total: swaps.length,
    })
  } catch (err) {
    console.error('[recreate/last-swap] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
