import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const STAGE_B_OUTPUTS = 'Stage B Outputs'
const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// kind → field-name pairs. Three slots on a Stage B Output:
//   subject              → 'TJP Output' attachment + 'TJP Output Path'
//   raw_screenshot       → 'Raw Screenshot' attachment + 'Raw Screenshot Path'
//   upscaled_screenshot  → 'Upscaled Screenshot' attachment + 'Upscaled Screenshot Path'
const KIND_TO_FIELDS = {
  subject:             { attachment: 'TJP Output',          path: 'TJP Output Path' },
  raw_screenshot:      { attachment: 'Raw Screenshot',      path: 'Raw Screenshot Path' },
  upscaled_screenshot: { attachment: 'Upscaled Screenshot', path: 'Upscaled Screenshot Path' },
}

// POST { projectId, kind, dropboxPath }
//
// "Eager attach" — called the moment the editor picks a file in the
// Create Scene panel, before Generate. Creates a Dropbox shared link
// for the path and PATCHes the Stage B Output record:
//   • Sets the multipleAttachments field (so Airtable mirrors the
//     image and it shows in the table)
//   • Sets the matching path text field (so the route can re-use the
//     same Dropbox file at Generate time without re-uploading)
//
// Why both: Airtable attachment URLs expire after a few hours; the
// path field gives us a stable reference for WaveSpeed at generation.
//
// Result: if the editor refreshes mid-flow, the panel can re-populate
// the file slot from the record — no lost work.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { projectId, kind, dropboxPath } = await request.json()
    if (!projectId || !/^rec[A-Za-z0-9]{14}$/.test(projectId)) {
      return NextResponse.json({ error: 'Valid projectId required' }, { status: 400 })
    }
    const fields = KIND_TO_FIELDS[kind]
    if (!fields) {
      return NextResponse.json({ error: `Invalid kind. Must be one of: ${Object.keys(KIND_TO_FIELDS).join(', ')}` }, { status: 400 })
    }
    if (!dropboxPath || typeof dropboxPath !== 'string') {
      return NextResponse.json({ error: 'dropboxPath required' }, { status: 400 })
    }

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    let sharedUrl = ''
    try { sharedUrl = rawDbx(await createDropboxSharedLink(tok, ns, dropboxPath)) }
    catch (e) { console.warn('[stage-b/attach] shared link:', e.message) }
    if (!sharedUrl) {
      return NextResponse.json({ error: 'Could not create shared link for the uploaded file' }, { status: 500 })
    }

    // Mirror to Airtable: attachment by URL + path text. typecast keeps
    // the path field happy (singleLineText auto-coercion).
    const filename = dropboxPath.split('/').pop() || `${kind}.jpg`
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}/${projectId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        fields: {
          [fields.attachment]: [{ url: sharedUrl, filename }],
          [fields.path]: dropboxPath,
        },
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      console.error('[stage-b/attach] PATCH failed:', t)
      return NextResponse.json({ error: `Airtable PATCH ${res.status}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, kind, dropboxPath, sharedUrl })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
