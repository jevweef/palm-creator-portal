import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  getDropboxAccessToken,
  getDropboxRootNamespaceId,
  listDropboxFolder,
  createDropboxSharedLink,
} from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CREATORS_ROOT = '/Palm Ops/Creators'
const IMG_RE = /\.(jpe?g|png|webp|gif|heic)$/i
const rawUrl = (u) => u.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1')

// GET ?name=<creator AKA/name> — lists the creator's Dropbox profile photos as
// picker options for the Multi-Link editor. Fuzzy-matches the creator folder
// under /Palm Ops/Creators, prefers a "Profile Photos" subfolder, and returns
// persistent shared-link image URLs.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e instanceof Response ? e : NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const name = (new URL(request.url).searchParams.get('name') || '').trim()
  if (!name) return NextResponse.json({ error: 'Creator name required' }, { status: 400 })

  try {
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)

    // Find the creator's folder (exact, then fuzzy).
    const roots = (await listDropboxFolder(token, ns, CREATORS_ROOT)).filter((e) => e['.tag'] === 'folder')
    const lower = name.toLowerCase()
    const match =
      roots.find((f) => f.name.toLowerCase() === lower) ||
      roots.find((f) => f.name.toLowerCase().includes(lower) || lower.includes(f.name.toLowerCase()))
    if (!match) return NextResponse.json({ photos: [], note: `No Dropbox folder found for "${name}" under ${CREATORS_ROOT}.` })

    const creatorPath = `${CREATORS_ROOT}/${match.name}`
    // Prefer a photos subfolder ("Profile Pictures" / "Profile Photos"); else
    // the creator folder itself.
    const subs = await listDropboxFolder(token, ns, creatorPath)
    const picSub = subs.find((e) => e['.tag'] === 'folder' && /profile\s*photo|profile\s*pic|photos/i.test(e.name))
    const target = picSub ? `${creatorPath}/${picSub.name}` : creatorPath
    const entries = picSub ? await listDropboxFolder(token, ns, target) : subs

    // Gather image files from the target folder AND one level of subfolders
    // (creators keep them nested, e.g. Profile Pictures/Current). "Current" first.
    const isImg = (e) => e['.tag'] === 'file' && IMG_RE.test(e.name)
    const found = [] // { path }
    for (const e of entries) if (isImg(e)) found.push({ name: e.name, path: `${target}/${e.name}` })
    const childFolders = entries
      .filter((e) => e['.tag'] === 'folder')
      .sort((a, b) => (/current/i.test(b.name) ? 1 : 0) - (/current/i.test(a.name) ? 1 : 0))
    for (const cf of childFolders) {
      if (found.length >= 40) break
      const inner = await listDropboxFolder(token, ns, `${target}/${cf.name}`)
      for (const e of inner) if (isImg(e)) found.push({ name: e.name, path: `${target}/${cf.name}/${e.name}` })
    }

    // Persistent shared links (sequential; folders are usually small).
    const photos = []
    for (const f of found.slice(0, 40)) {
      try {
        const link = await createDropboxSharedLink(token, ns, f.path)
        photos.push({ name: f.name, url: rawUrl(link) })
      } catch { /* skip a file that won't share */ }
    }

    return NextResponse.json({
      photos,
      folder: target,
      note: photos.length ? undefined : `Folder "${match.name}" has no images${picSub ? ` in ${picSub.name}` : ''}.`,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
