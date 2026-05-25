import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'
import { uploadVideoByUrl } from '@/lib/cloudflareStream'
import { waitUntil } from '@vercel/functions'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const REELS_TABLE = 'Recreate Reels'

function rawDbx(url) {
  if (!url) return ''
  const clean = String(url).replace(/[?&]dl=0/, '').replace(/[?&]dl=1/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

// Step 2 of the editor's local-reel upload flow. After the browser
// has direct-uploaded the bytes to Dropbox using the token from
// /api/ai-editor/upload-local-reel/token, this route:
//
//   1. Mints a public Dropbox shared link for the uploaded file
//   2. Creates a Recreate Reel record so the file appears in the
//      editor's Fresh Inspo grid (same lifecycle as admin scrapes:
//      Status='Available', no Produced For yet, Added Via='Editor Upload')
//   3. Kicks off the Cloudflare Stream mirror in the background so
//      the reel card transitions from "Dropbox first-frame thumbnail"
//      to the proper Stream player within ~30s
//
// Synthesized Reel ID: 'editor-{shortid}' — locally-uploaded reels
// don't have an Instagram shortcode, but Reel ID is the merge key
// on the Recreate Reels table so we need something unique. Editor
// handle defaults to the email prefix (e.g. 'yassine' from
// 'yassine@palm-mgmt.com') so the card still shows a meaningful "@".
//
// Body: { dropboxPath, shortid, caption?, handle? }
export async function POST(request) {
  try {
    const user = await requireAdminOrAiEditor()
    const userEmail = (user?.emailAddresses?.[0]?.emailAddress || user?.primaryEmailAddress?.emailAddress || '').toLowerCase()
    const { dropboxPath, shortid, caption, handle } = await request.json()

    if (!dropboxPath || typeof dropboxPath !== 'string') {
      return NextResponse.json({ error: 'dropboxPath required' }, { status: 400 })
    }
    if (!shortid || typeof shortid !== 'string') {
      return NextResponse.json({ error: 'shortid required (same one returned by the token route)' }, { status: 400 })
    }

    // Mint shared link for the freshly uploaded video.
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    let sharedLink = ''
    try { sharedLink = await createDropboxSharedLink(tok, ns, dropboxPath) }
    catch (e) { console.warn('[upload-local-reel/finalize] shared link failed:', e.message) }

    if (!sharedLink) {
      return NextResponse.json({ error: 'Uploaded to Dropbox but could not mint shared link' }, { status: 502 })
    }

    // Synthesize the handle from the editor's email (e.g. 'yassine@palm-mgmt.com'
    // → 'yassine') so reel cards still show "@yassine" not "@". Editor can
    // override via the `handle` body param if they want a different label.
    const fallbackHandle = userEmail.split('@')[0] || 'editor'
    const sourceHandle = (handle || '').trim().replace(/^@/, '') || fallbackHandle
    const reelId = `editor-${shortid}`

    // Upsert by Reel ID — idempotent if the finalize is somehow called
    // twice for the same shortid (network retry, etc.). Won't duplicate.
    const fields = {
      'Reel ID': reelId,
      'Source Handle': sourceHandle,
      'Reel URL': '',  // no IG URL for local uploads
      Caption: String(caption || '').trim(),
      'Dropbox Video Path': dropboxPath,
      'Dropbox Video Link': sharedLink,
      Status: 'Available',
      'Added Via': 'Editor Upload',
      ...(userEmail ? { 'Added By': userEmail } : {}),
    }
    const upRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(REELS_TABLE)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ['Reel ID'] },
        records: [{ fields }],
      }),
    })
    if (!upRes.ok) {
      const t = await upRes.text()
      return NextResponse.json({ error: `Airtable upsert failed: ${upRes.status} ${t.slice(0, 300)}` }, { status: 502 })
    }
    const upJson = await upRes.json()
    const recordId = upJson?.records?.[0]?.id

    // Mirror to Cloudflare Stream in the background — same pattern as the
    // admin scrape callback. Non-fatal; the mirror-stream cron is the
    // safety net for any that fail here.
    if (recordId && sharedLink) {
      waitUntil((async () => {
        try {
          const { uid } = await uploadVideoByUrl(rawDbx(sharedLink), { airtableId: recordId, kind: 'recreate-reels' })
          if (uid) {
            await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(REELS_TABLE)}/${recordId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { 'Stream UID': uid } }),
            })
          }
        } catch (e) {
          console.warn(`[upload-local-reel/finalize] Stream mirror failed for ${reelId}: ${e.message}`)
        }
      })())
    }

    return NextResponse.json({
      ok: true,
      reelRecordId: recordId,
      reelId,
      handle: sourceHandle,
      dropboxPath,
      sharedLink,
      streamMirroring: !!(recordId && sharedLink),
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[upload-local-reel/finalize] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
