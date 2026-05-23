import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const STAGE_B_OUTPUTS = 'Stage B Outputs'
const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// kind → path-field name. Three slots on a Stage B Output:
//   subject              → 'TJP Output Path'
//   raw_screenshot       → 'Raw Screenshot Path'
//   upscaled_screenshot  → 'Upscaled Screenshot Path'
const KIND_TO_PATH_FIELD = {
  subject:             'TJP Output Path',
  raw_screenshot:      'Raw Screenshot Path',
  upscaled_screenshot: 'Upscaled Screenshot Path',
}

// POST { projectId, kind, dropboxPath }
//
// "Eager attach" — called the moment the editor picks a file in the
// Create Scene panel, before Generate. Stores ONLY the Dropbox path on
// the Stage B Output record (no Airtable attachment; Dropbox is the
// canonical source). The shared link is minted but only returned to the
// client for the in-modal preview — not written to Airtable.
//
// Result: if the editor refreshes mid-flow, the panel re-populates the
// file slot from the record's path field — no lost work.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { projectId, kind, dropboxPath } = await request.json()
    if (!projectId || !/^rec[A-Za-z0-9]{14}$/.test(projectId)) {
      return NextResponse.json({ error: 'Valid projectId required' }, { status: 400 })
    }
    const pathField = KIND_TO_PATH_FIELD[kind]
    if (!pathField) {
      return NextResponse.json({ error: `Invalid kind. Must be one of: ${Object.keys(KIND_TO_PATH_FIELD).join(', ')}` }, { status: 400 })
    }
    if (!dropboxPath || typeof dropboxPath !== 'string') {
      return NextResponse.json({ error: 'dropboxPath required' }, { status: 400 })
    }

    // Mint a shared link so the client can preview the uploaded file.
    // The link is NOT written to Airtable — only the path is — but the
    // client uses it inline to confirm the upload landed.
    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    let sharedUrl = ''
    try { sharedUrl = rawDbx(await createDropboxSharedLink(tok, ns, dropboxPath)) }
    catch (e) { console.warn('[stage-b/attach] shared link:', e.message) }

    // Path-only write — Dropbox is the canonical source.
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}/${projectId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        fields: {
          [pathField]: dropboxPath,
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
