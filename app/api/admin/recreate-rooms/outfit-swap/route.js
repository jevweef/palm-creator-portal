import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OUTFIT_CLOSET = 'Outfit Closet'
const STAGE_B_SEED = 77777
const rawDbx = (u) => u ? String(u).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1') : ''

// Same models as Stage B; all take images[] + prompt (verified schemas).
const MODELS = {
  wan: { path: 'alibaba/wan-2.7/image-edit-pro',
    body: (images, prompt) => ({ images, prompt, size: '1080*1920', seed: STAGE_B_SEED }) },
  nano: { path: 'google/nano-banana-2/edit',
    body: (images, prompt) => ({ images, prompt, aspect_ratio: '9:16', resolution: '2k', output_format: 'jpeg' }) },
  gpt: { path: 'openai/gpt-image-2/edit',
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

// GET (no id) → active outfit presets for the dropdown.
// GET ?id=<predictionId> → poll WaveSpeed for that job's result.
export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const id = new URL(request.url).searchParams.get('id')
    if (id) {
      const d = await pollWaveSpeedTask(id)
      const status = d?.status
      if (status === 'completed') return NextResponse.json({ status, out: (d.outputs || [])[0] || null })
      if (status === 'failed') {
        const e = typeof d.error === 'string' && d.error ? d.error : d.error ? JSON.stringify(d.error) : 'failed'
        return NextResponse.json({ status, error: e })
      }
      return NextResponse.json({ status: status || 'processing' })
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

// POST { imageDropboxPath, outfit, model? } — submit the outfit swap,
// return the prediction id immediately (client polls GET ?id=).
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { imageDropboxPath, outfit, model } = await request.json()
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

    const prompt = buildOutfitPrompt(String(outfit).trim())
    const task = await submitWaveSpeedTask(mdl.path, mdl.body([imageUrl], prompt))
    const predictionId = task?.id
    if (!predictionId) return NextResponse.json({ error: 'WaveSpeed did not return a prediction id' }, { status: 502 })
    return NextResponse.json({ ok: true, predictionId, prompt })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
