import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'

// GET — the live chat feed for one connected OF account. Events come from the
// webhook receiver's per-account buffer (messages.received / 1:1 sent / PPV
// unlocks, newest first, last 400). Polled by /admin/live-chat.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const url = new URL(request.url)
    const account = url.searchParams.get('account') || ''
    const creators = await fetchAirtableRecords('Palm Creators', {
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const accounts = creators
      .filter((c) => c.fields?.['OF API Account ID'])
      .map((c) => ({ account: c.fields['OF API Account ID'], aka: c.fields.AKA || c.fields.Creator }))
      .sort((a, b) => a.aka.localeCompare(b.aka))
    let events = []
    if (account) {
      try {
        const token = await getDropboxAccessToken()
        const ns = await getDropboxRootNamespaceId(token)
        const buf = await downloadFromDropbox(token, ns, `/Palm Ops/OF Webhooks/live/${account}.json`)
        if (buf) events = JSON.parse(buf.toString('utf8'))
      } catch { /* no events yet for this account */ }
    }
    return NextResponse.json({ accounts, events })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
