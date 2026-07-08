export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { OPS_BASE, airtableHeaders, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, deleteDropboxPath } from '@/lib/dropbox'
import { quoteAirtableString } from '@/lib/airtableFormula'

const ITEMS = 'Content Request Items'

// DELETE — remove one uploaded content-request item: its Airtable record AND
// the Dropbox file. A creator can only delete their OWN uploads (ownership
// checked against the item's linked Creator); admins/editors can delete any.
// "Replace" on the client = delete then upload again.
export async function DELETE(request) {
  try {
    const { userId } = auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { itemId } = await request.json()
    if (!itemId || !/^rec[A-Za-z0-9]{14}$/.test(itemId)) {
      return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 })
    }

    const user = await currentUser()
    const role = user?.publicMetadata?.role
    const isStaff = role === 'admin' || role === 'super_admin' || role === 'editor'
    const myOps = user?.publicMetadata?.airtableOpsId

    // Ownership check — fetch the item and confirm it's this creator's (unless staff).
    const [item] = await fetchAirtableRecords(ITEMS, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(itemId)}`,
      fields: ['Creator', 'Dropbox Path'],
    })
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    const owner = (item.fields?.Creator || []).includes(myOps)
    if (!isStaff && !owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // ALWAYS use the STORED path — never a client-supplied one. The shared team
    // namespace means a caller-controlled path could delete any file in Dropbox.
    const path = item.fields?.['Dropbox Path'] || ''

    // Delete the Airtable record (the validated one) — this clears it from the UI.
    const del = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ITEMS)}/${item.id}`, {
      method: 'DELETE', headers: airtableHeaders,
    })
    if (!del.ok) {
      console.error('[content-request/item DELETE] airtable delete failed:', del.status, await del.text().catch(() => ''))
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
    }

    // Delete the Dropbox file too (best effort — record removal already succeeded).
    if (path) {
      try {
        const token = await getDropboxAccessToken()
        const ns = await getDropboxRootNamespaceId(token)
        await deleteDropboxPath(token, ns, path)
      } catch (e) {
        console.warn('[content-request/item DELETE] dropbox delete failed (non-fatal):', e.message)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[content-request/item DELETE]', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
