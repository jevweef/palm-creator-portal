#!/usr/bin/env node
/**
 * Backfill Cloudflare Images for video Asset poster frames.
 *
 * Runs ffmpeg locally (this script, not Vercel) to extract a frame from each
 * video Asset that doesn't yet have a CDN URL, uploads the JPEG to Cloudflare
 * Images, and writes the delivery URL back to the Asset record. Same custom-
 * ID-equals-record-ID idempotency model as the photo and inspo backfills.
 *
 * Local execution avoids Vercel's per-function timeout — videos can take 10–
 * 20s each and a few hundred adds up fast. Run once, let it churn.
 *
 * The hourly cron at /api/cron/mirror-video-frames keeps the table healthy
 * for new edits going forward; this script clears the existing backlog.
 *
 * Usage:
 *   cd ~/palm-creator-portal
 *   node --env-file=.env.local scripts/backfill-cf-video-frames.mjs
 *   node --env-file=.env.local scripts/backfill-cf-video-frames.mjs --limit 5
 */

import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { writeFile, readFile, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const HASH = process.env.CLOUDFLARE_IMAGES_HASH
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS = 'Assets'

function die(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!ACCOUNT_ID || !HASH || !TOKEN) die('Cloudflare env vars missing.')
if (!AIRTABLE_PAT) die('AIRTABLE_PAT missing.')
if (!ffmpegPath) die('ffmpeg-static failed to resolve a binary.')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '').replace(/[?&]dl=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

async function airtableFetchAll(table, params = {}) {
  const records = []
  let offset = null
  do {
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.fields) params.fields.forEach(f => query.append('fields[]', f))
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${query}`, { headers: airtableHeaders })
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)
  return records
}

async function airtablePatch(table, recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH', headers: airtableHeaders, body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`Airtable PATCH ${res.status}: ${await res.text()}`)
  return res.json()
}

function runFfmpeg(args, outputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, args, { timeout: 30000 }, async (err, _stdout, stderr) => {
      const s = await stat(outputPath).catch(() => null)
      resolve({ ok: !!s && s.size > 0, size: s?.size || 0, err, stderr: stderr || '' })
    })
  })
}

async function extractFrame(videoUrl) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const inputPath = join(tmpdir(), `vbf_${id}.mp4`)
  const outputPath = join(tmpdir(), `vbf_${id}.jpg`)
  try {
    const dl = await fetch(rawDropboxUrl(videoUrl), { redirect: 'follow' })
    if (!dl.ok) throw new Error(`download ${dl.status}`)
    const buf = Buffer.from(await dl.arrayBuffer())
    if (buf.slice(0, 100).toString('utf8').includes('<!DOCTYPE html')) {
      throw new Error('Dropbox returned HTML — share link probably restricted')
    }
    await writeFile(inputPath, buf)
    const baseFilters = '-vf format=yuv420p -pix_fmt yuvj420p -q:v 3'.split(' ')
    const strategies = [
      ['-y', '-i', inputPath, '-ss', '1', '-frames:v', '1', '-update', '1', ...baseFilters, outputPath],
      ['-y', '-ss', '1', '-i', inputPath, '-frames:v', '1', '-update', '1', ...baseFilters, outputPath],
      ['-y', '-i', inputPath, '-frames:v', '1', '-update', '1', ...baseFilters, outputPath],
    ]
    for (const a of strategies) {
      await unlink(outputPath).catch(() => {})
      const r = await runFfmpeg(a, outputPath)
      if (r.ok) return await readFile(outputPath)
    }
    throw new Error('all ffmpeg strategies failed')
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}

async function uploadToCloudflareBytes(bytes, customId) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'frame.jpg')
  form.append('id', customId)
  form.append('requireSignedURLs', 'false')
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errs = data?.errors || []
    const isDup = errs.some(e => e.code === 5409 || /already exists/i.test(e.message || ''))
    if (isDup) return { id: customId, alreadyExisted: true }
    throw new Error(errs.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`)
  }
  return { id: data?.result?.id, alreadyExisted: false }
}

function buildDeliveryUrl(imageId, variant = 'public') {
  return `https://imagedelivery.net/${HASH}/${imageId}/${variant}`
}

async function main() {
  console.log('\nFetching video Assets missing CDN URL...')
  const candidates = await airtableFetchAll(ASSETS, {
    filterByFormula: `AND({Asset Type}='Video',OR(NOT({Edited File Link}=''),NOT({Dropbox Shared Link}='')),{CDN URL}='')`,
    fields: ['Asset Name', 'Edited File Link', 'Dropbox Shared Link', 'CDN URL'],
  })
  const todo = LIMIT ? candidates.slice(0, LIMIT) : candidates
  console.log(`✓ ${candidates.length} video(s) need backfill${LIMIT ? `, processing first ${todo.length}` : ''}\n`)
  if (!todo.length) { console.log('Nothing to do.'); return }

  let uploaded = 0, skipped = 0, failed = 0
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i]
    const f = r.fields
    const link = f['Edited File Link'] || f['Dropbox Shared Link']
    const name = (f['Asset Name'] || r.id).slice(0, 50).padEnd(50)
    process.stdout.write(`  [${i + 1}/${todo.length}] ${name} `)

    if (!link) { skipped++; console.log('— no link'); continue }

    try {
      const bytes = await extractFrame(link)
      const { id, alreadyExisted } = await uploadToCloudflareBytes(bytes, r.id)
      const cdnUrl = buildDeliveryUrl(id, 'public')
      await airtablePatch(ASSETS, r.id, { 'CDN URL': cdnUrl, 'CDN Image ID': id })
      uploaded++
      console.log(alreadyExisted ? '✓ (existed)' : '✓')
    } catch (err) {
      failed++
      console.log(`✗ ${err.message}`)
    }
  }

  console.log(`\n═════════════════════════════`)
  console.log(`  Uploaded: ${uploaded}`)
  console.log(`  Skipped:  ${skipped}`)
  console.log(`  Failed:   ${failed}\n`)
}

main().catch(err => { console.error('\nFatal error:', err); process.exit(1) })
