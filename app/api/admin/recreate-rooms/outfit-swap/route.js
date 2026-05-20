import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { submitWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OUTFIT_CLOSET = 'Outfit Closet'
const OUTPUTS = 'Outfit Swap Outputs'
const STAGE_B_SEED = 77777
const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// Same models as Stage B; all take images[] + prompt (verified schemas).
const MODELS = {
  wan: { path: 'alibaba/wan-2.7/image-edit-pro', label: 'Wan 2.7 image-edit-pro',
    body: (images, prompt) => ({ images, prompt, size: '1080*1920', seed: STAGE_B_SEED }) },
  nano: { path: 'google/nano-banana-2/edit', label: 'Nano-Banana 2',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '9:16', resolution: '2k', output_format: 'jpeg' }) },
  gpt: { path: 'openai/gpt-image-2/edit', label: 'GPT-Image-2',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '9:16', resolution: '2k', quality: 'high' }) },
}

// SHORT prompt on purpose — long outfit prompts shift the creator's
// pose/framing (proven). Keep it one line + a tight keep-clause.
function buildOutfitPrompt(outfit) {
  return (
    `Change ONLY the woman's clothing to ${outfit}. Keep her exact face, `
    + 'hair, body, skin, pose, hands, expression, position and distance '
    + 'from the camera, and the entire background, unchanged. Photorealistic, '
    + 'no added text, logos or watermark.'
  )
}

async function createOutputRecord(fields) {
  const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  })
  if (!res.ok) throw new Error(`Outfit output create ${res.status}: ${await res.text()}`)
  return res.json()
}

// GET (no params) → active outfit presets for the dropdown.
// GET ?creatorId=<id> → list this creator's outfit-swap outputs (joined).
// GET ?id=<recordId> → fetch a single output record (still used by older
//   client paths; the resolver below fully finishes a record, so the
//   client doesn't need to poll WaveSpeed directly anymore).
export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const sp = new URL(request.url).searchParams
    const creatorId = sp.get('creatorId')
    const recordId = sp.get('id')

    if (recordId) {
      if (!/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
        return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
      }
      const r = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS)}/${recordId}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }, cache: 'no-store' })
      if (!r.ok) return NextResponse.json({ error: 'Output not found' }, { status: 404 })
      const f = (await r.json()).fields || {}
      return NextResponse.json({ status: f.Status?.name || f.Status, out: (f.Image?.[0]?.url) || rawDbx(f['Dropbox Link']) || null })
    }

    if (creatorId) {
      const rows = await fetchAirtableRecords(OUTPUTS, {
        fields: ['Name', 'Creator', 'Outfit', 'Source Image Link', 'Image', 'Dropbox Link', 'Status', 'Reject Reason', 'Model'],
      })
      const list = rows
        .filter(o => (o.fields?.Creator || []).includes(creatorId))
        .map(o => {
          const f = o.fields || {}
          return {
            id: o.id,
            name: f.Name || '',
            outfit: f.Outfit || '',
            sourceLink: f['Source Image Link'] || '',
            image: f.Image?.[0]?.thumbnails?.large?.url || f.Image?.[0]?.url || null,
            dropbox: f['Dropbox Link'] ? String(f['Dropbox Link']).replace('dl=0', 'dl=1') : null,
            status: f.Status?.name || f.Status || 'Pending',
            rejectReason: f['Reject Reason'] || '',
            model: f.Model || '',
            createdTime: o.createdTime,
          }
        })
        .sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
      return NextResponse.json({ outputs: list })
    }

    const rows = await fetchAirtableRecords(OUTFIT_CLOSET, { fields: ['Name', 'Prompt', 'Active', 'Sort'] })
    const outfits = rows
      .filter(r => r.fields?.Active && r.fields?.Prompt)
      .map(r => ({ id: r.id, name: r.fields?.Name || 'Outfit', prompt: r.fields.Prompt, sort: r.fields?.Sort ?? 999 }))
      .sort((a, b) => a.sort - b.sort)
    return NextResponse.json({ outfits })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

// POST { imageDropboxPath, outfit, model?, creatorId? } — submit the
// outfit swap, persist a Generating record (so the result is captured
// even if the editor navigates away), return the new record + prediction
// id immediately. The /resolve route picks it up later and finalizes.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { imageDropboxPath, outfit, model, creatorId } = await request.json()
    if (!imageDropboxPath || typeof imageDropboxPath !== 'string') {
      return NextResponse.json({ error: 'imageDropboxPath required' }, { status: 400 })
    }
    if (!outfit || !String(outfit).trim()) {
      return NextResponse.json({ error: 'Pick or type an outfit' }, { status: 400 })
    }
    const mdl = MODELS[model] || MODELS.wan

    const tok = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(tok)
    let imageUrl = ''
    try { imageUrl = rawDbx(await createDropboxSharedLink(tok, ns, imageDropboxPath)) } catch {}
    if (!imageUrl) return NextResponse.json({ error: 'Could not resolve the uploaded image' }, { status: 400 })

    const outfitStr = String(outfit).trim()
    const prompt = buildOutfitPrompt(outfitStr)
    const task = await submitWaveSpeedTask(mdl.path, mdl.body([imageUrl], prompt))
    const predictionId = task?.id
    if (!predictionId) return NextResponse.json({ error: 'WaveSpeed did not return a prediction id' }, { status: 502 })

    const fields = {
      Name: `Outfit · ${outfitStr.slice(0, 40)} · [${mdl.label}] · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      Outfit: outfitStr,
      'Source Image Path': imageDropboxPath,
      'Source Image Link': imageUrl,
      'Prediction ID': predictionId,
      'Prompt Used': prompt,
      Model: model || 'wan',
      Status: 'Generating',
    }
    if (creatorId && /^rec[A-Za-z0-9]{14}$/.test(creatorId)) fields.Creator = [creatorId]
    const created = await createOutputRecord(fields)

    return NextResponse.json({
      ok: true,
      generating: true,
      recordId: created?.records?.[0]?.id || null,
      predictionId,
      prompt,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

// PATCH { id, status, reason? } — approve / reject (mirrors Stage B).
export async function PATCH(request) {
  try {
    await requireAdminOrAiEditor()
    const { id, status, reason } = await request.json()
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return NextResponse.json({ error: 'status must be Pending|Approved|Rejected' }, { status: 400 })
    }
    await patchAirtableRecord(OUTPUTS, id, {
      Status: status,
      ...(status === 'Rejected' && reason ? { 'Reject Reason': reason } : {}),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?id= — admin only.
export async function DELETE(request) {
  try {
    await requireAdmin()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS)}/${id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
