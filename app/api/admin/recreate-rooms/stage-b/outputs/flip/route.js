import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxSharedLink } from '@/lib/dropbox'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OUTPUTS_TABLE = 'Stage B Outputs'
const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// POST { id }  —  Horizontally mirror the Stage B Output's image in
// place (Dropbox + Airtable attachment refresh). Used when Wan
// produces a left/right-flipped result and the editor wants it
// un-flipped without re-running the whole generation.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { id } = await request.json()
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }

    // Pull the record to learn the Dropbox path of the current image.
    const rRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS_TABLE)}/${id}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
    if (!rRes.ok) {
      return NextResponse.json({ error: `record fetch ${rRes.status}` }, { status: rRes.status })
    }
    const rec = await rRes.json()
    const f = rec.fields || {}
    const dropboxPath = f['Dropbox Path']
    if (!dropboxPath) return NextResponse.json({ error: 'no Dropbox Path on record' }, { status: 400 })

    // Fetch current image from Dropbox shared link, flip horizontally
    // with sharp (.flop is the horizontal mirror), upload back over
    // the same path so existing links keep working.
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    const link = f['Dropbox Link']
    const srcUrl = rawDbx(link)
    if (!srcUrl) return NextResponse.json({ error: 'no Dropbox Link on record' }, { status: 400 })

    const ir = await fetch(srcUrl)
    if (!ir.ok) return NextResponse.json({ error: `image fetch ${ir.status}` }, { status: 502 })
    const buf = Buffer.from(await ir.arrayBuffer())
    const flipped = await sharp(buf).flop().jpeg({ quality: 92 }).toBuffer()

    await uploadToDropbox(tok, ns, dropboxPath, flipped, { overwrite: true })
    // Shared link survives the overwrite; refetch in case Dropbox
    // changed the token on us, but reuse the existing URL otherwise.
    let newLink = link
    try { newLink = await createDropboxSharedLink(tok, ns, dropboxPath) } catch {}
    const newRaw = rawDbx(newLink)

    // Refresh the Airtable attachment URL so the gallery thumbnail
    // updates immediately (the old URL would still point at the old
    // file because Airtable caches its own copy at attach time).
    const upRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS_TABLE)}/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        fields: {
          Image: [{ url: newRaw, filename: `${f.Slug || 'scene'}.jpg` }],
          'Dropbox Link': newLink,
        },
      }),
    })
    if (!upRes.ok) {
      const t = await upRes.text()
      return NextResponse.json({ error: `airtable patch ${upRes.status}: ${t}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, dropboxLink: newLink })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[stage-b/outputs/flip] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
