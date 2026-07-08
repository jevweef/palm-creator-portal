export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { auth, currentUser } from '@clerk/nextjs/server'
import { OPS_BASE, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId } from '@/lib/dropbox'
import { quoteAirtableString } from '@/lib/airtableFormula'

const ITEMS = 'Content Request Items'
const SIZES = { sm: 'w256h256', lg: 'w1024h768' }

// GET ?itemId=rec...&size=sm|lg — server-side Dropbox thumbnail for an uploaded
// PHOTO. Dropbox converts HEIC/HEIF (iPhone default) → JPEG and resizes, so the
// creator can actually SEE their photos on any browser (a raw <img src> can't
// decode HEIC outside Safari). Ownership-scoped: a creator only gets their own.
export async function GET(request) {
  try {
    const { userId } = auth()
    if (!userId) return new Response('Unauthorized', { status: 401 })

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId') || ''
    const size = SIZES[searchParams.get('size')] || SIZES.sm
    if (!/^rec[A-Za-z0-9]{14}$/.test(itemId)) return new Response('Bad itemId', { status: 400 })

    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isStaff = role === 'admin' || role === 'super_admin' || role === 'editor'
    const myOps = user?.publicMetadata?.airtableOpsId

    const [item] = await fetchAirtableRecords(ITEMS, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(itemId)}`,
      fields: ['Creator', 'Dropbox Path'],
    })
    if (!item) return new Response('Not found', { status: 404 })
    if (!isStaff && !(item.fields?.Creator || []).includes(myOps)) return new Response('Forbidden', { status: 403 })
    const path = item.fields?.['Dropbox Path'] || ''
    if (!path) return new Response('No path', { status: 404 })

    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const res = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: ns }),
        'Dropbox-API-Arg': JSON.stringify({
          resource: { '.tag': 'path', path },
          format: { '.tag': 'jpeg' },
          size: { '.tag': size },
          mode: { '.tag': 'fitone_bestfit' },
        }),
      },
    })
    if (!res.ok) {
      // Non-image (e.g. a video) or too large for a thumbnail — caller falls back
      // to a placeholder tile. Not an error worth surfacing.
      const t = await res.text().catch(() => '')
      console.warn('[content-request/thumbnail] dropbox', res.status, t.slice(0, 120))
      return new Response('No thumbnail', { status: 502 })
    }
    const buf = await res.arrayBuffer()
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        // Private (creator's own content) but cacheable so the grid doesn't
        // re-fetch on every render.
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[content-request/thumbnail]', err)
    return new Response('Error', { status: 500 })
  }
}
