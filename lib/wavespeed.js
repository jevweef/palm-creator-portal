// WaveSpeed API helper.
// API shape (from https://wavespeed.ai/docs/rest-api):
//   POST  https://api.wavespeed.ai/api/v3/{model}        → { data: { id, urls: { get } } }
//   GET   https://api.wavespeed.ai/api/v3/predictions/{id} → { data: { status, outputs: [...] } }
// Auth: Authorization: Bearer ${WAVESPEED_API_KEY}

const WAVESPEED_BASE = 'https://api.wavespeed.ai/api/v3'

function getKey() {
  const key = process.env.WAVESPEED_API_KEY
  if (!key) throw new Error('WAVESPEED_API_KEY is not set')
  return key
}

export async function submitWaveSpeedTask(modelPath, body) {
  const res = await fetch(`${WAVESPEED_BASE}/${modelPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { rawText: text } }
  if (!res.ok || data?.code !== 200) {
    throw new Error(`WaveSpeed submit failed (${res.status}): ${data?.message || text}`)
  }
  // Returns { id, status, urls: { get } }
  return data.data
}

export async function pollWaveSpeedTask(taskId) {
  const res = await fetch(`${WAVESPEED_BASE}/predictions/${taskId}`, {
    headers: { Authorization: `Bearer ${getKey()}` },
    cache: 'no-store',
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { rawText: text } }
  if (!res.ok || data?.code !== 200) {
    throw new Error(`WaveSpeed poll failed (${res.status}): ${data?.message || text}`)
  }
  // Returns { id, status, outputs?, error? }
  // status: 'created' | 'processing' | 'completed' | 'failed'
  return data.data
}
