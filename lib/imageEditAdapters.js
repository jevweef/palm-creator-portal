// Image-edit model adapters. Three providers behind a common interface,
// all routed through WaveSpeed (the same pattern Stage B uses in
// /api/admin/recreate-rooms/stage-b/route.js). Going through WaveSpeed
// gives us:
//   - One auth path (WAVESPEED_API_KEY only)
//   - Consistent polling
//   - Quality knobs (resolution: '2k', quality: 'high', output_format: 'jpeg')
//   - Looser content moderation than direct OpenAI/Google APIs in practice
//
// Common contract:
//   input  → { model, sourceUrl, refUrls[], prompt, srcW, srcH }
//   output → { outputBuffer, contentType, taskId, providerOutputUrl }
//
// Buffer-out: the carousel-variations route uploads to Dropbox + CF
// Images so the rest of the pipeline is model-agnostic.

import { submitWaveSpeedTask, pollWaveSpeedTask } from '@/lib/wavespeed'

// Model paths on WaveSpeed. Stage B uses these exact paths — keep in sync.
const MODEL_PATHS = {
  wan: 'alibaba/wan-2.7/image-edit-pro',
  nano: 'google/nano-banana-2/edit',
  gpt: 'openai/gpt-image-2/edit',
}

// Wan needs explicit pixel dimensions. Mapping borrowed from Stage B —
// these are the resolutions Wan was trained on and produces cleanest output
// at. Anything outside these ARs falls back to the closest match.
const ASPECT_TO_WAN_SIZE = {
  '1:1':  '1080*1080',
  '3:4':  '1080*1440',
  '4:5':  '1080*1350',
  '9:16': '1080*1920',
}

// Nano-Banana-2 and GPT-Image-2 (via WaveSpeed) take an aspect_ratio string
// instead of explicit pixel dims, and a `resolution: '2k'` knob handles
// quality. Supported aspect_ratio values per WaveSpeed model docs.
const SUPPORTED_ASPECTS = ['1:1', '3:4', '4:5', '9:16', '16:9', '4:3', '2:3', '3:2']

// Derive an aspect_ratio string from source pixel dimensions. Picks the
// closest supported AR (Stage B uses the same four; we add the inverses
// for landscape sources).
function pickAspectRatio(srcW, srcH) {
  if (!srcW || !srcH) return '4:5'
  const ar = srcW / srcH
  const candidates = [
    { ar: 1.0,    name: '1:1'  },
    { ar: 3/4,    name: '3:4'  },
    { ar: 4/5,    name: '4:5'  },
    { ar: 9/16,   name: '9:16' },
    { ar: 16/9,   name: '16:9' },
    { ar: 4/3,    name: '4:3'  },
    { ar: 2/3,    name: '2:3'  },
    { ar: 3/2,    name: '3:2'  },
  ]
  let best = candidates[0]
  let bestDiff = Math.abs(Math.log(ar / best.ar))
  for (const c of candidates) {
    const d = Math.abs(Math.log(ar / c.ar))
    if (d < bestDiff) { bestDiff = d; best = c }
  }
  return best.name
}

// Build the per-model request body — same shape Stage B uses.
function buildBody({ model, images, prompt, srcW, srcH }) {
  const aspect = pickAspectRatio(srcW, srcH)
  if (model === 'wan') {
    return {
      images,
      prompt,
      size: ASPECT_TO_WAN_SIZE[aspect] || ASPECT_TO_WAN_SIZE['4:5'],
      seed: -1,
    }
  }
  if (model === 'nano') {
    // google/nano-banana-2/edit: aspect_ratio + resolution '2k' for quality.
    return {
      images,
      prompt,
      aspect_ratio: aspect,
      resolution: '2k',
      output_format: 'jpeg',
    }
  }
  if (model === 'gpt') {
    // openai/gpt-image-2/edit: aspect_ratio + quality 'high' for quality.
    return {
      images,
      prompt,
      aspect_ratio: aspect,
      resolution: '2k',
      quality: 'high',
    }
  }
  throw new Error(`Unknown model: ${model}`)
}

// Pick the model size used in route logging — primarily for the human-
// readable log line. The actual size is set inside buildBody.
export function pickModelSize(model, srcW, srcH) {
  const aspect = pickAspectRatio(srcW, srcH)
  if (model === 'wan') return ASPECT_TO_WAN_SIZE[aspect] || ASPECT_TO_WAN_SIZE['4:5']
  return `${aspect} @ 2k`
}

// Fetch a remote URL into a Buffer + content-type. Used after the task
// completes — WaveSpeed returns a URL we need to download into bytes so
// the route can persist it to Dropbox + CF Images.
async function fetchToBuffer(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Fetch ${url} failed: HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const ct = r.headers.get('content-type') || 'image/jpeg'
  return { buffer: buf, contentType: ct }
}

// Submit a task on WaveSpeed and poll until completion. Common pattern
// used by all three model adapters — only the path + body shape differ.
async function runWaveSpeedTask({ path, body, maxAttempts = 190, sleepMs = 3000 }) {
  const task = await submitWaveSpeedTask(path, body)
  for (let i = 0; i < maxAttempts; i++) {
    const s = await pollWaveSpeedTask(task.id)
    if (s.status === 'completed') {
      const outputUrl = (s.outputs || [])[0]
      if (!outputUrl) throw new Error(`${path} completed with no output URL`)
      return { taskId: task.id, outputUrl }
    }
    if (s.status === 'failed') {
      const err = s.error || `${path} task failed`
      if (/safety|policy|moderation|content/i.test(String(err))) {
        throw new Error(`${path} refused: ${String(err).slice(0, 300)}`)
      }
      throw new Error(err)
    }
    await new Promise(r => setTimeout(r, sleepMs))
  }
  throw new Error(`${path} polling timed out`)
}

// Single dispatch entry point. Route picks the model; this picks the
// right WaveSpeed path + body shape and returns a Buffer.
export async function generateVariation({ model, sourceUrl, refUrls, prompt, srcW, srcH }) {
  if (!MODEL_PATHS[model]) throw new Error(`Unsupported model: ${model}`)
  const images = [sourceUrl, ...refUrls]
  const body = buildBody({ model, images, prompt, srcW, srcH })
  const { taskId, outputUrl } = await runWaveSpeedTask({ path: MODEL_PATHS[model], body })
  const { buffer, contentType } = await fetchToBuffer(outputUrl)
  return {
    outputBuffer: buffer,
    contentType,
    taskId,
    providerOutputUrl: outputUrl,
  }
}
