#!/usr/bin/env node
/**
 * Backfill Cloudflare Images for Inspiration thumbnails.
 *
 * Walks every Inspiration record with a Thumbnail attachment, mirrors the
 * `large` thumbnail variant to Cloudflare Images, and writes the delivery
 * URL back to the record's CDN URL field. Idempotent — record ID is the
 * CF custom image ID, so re-runs skip already-mirrored rows.
 *
 * The cron at /api/cron/mirror-cloudflare also processes Inspiration but
 * caps at INSPIRATION_PER_RUN per 30-min run. This script clears the
 * backlog in one pass.
 *
 * Usage:
 *   cd ~/palm-creator-portal
 *   node --env-file=.env.local scripts/backfill-cf-inspiration.mjs
 *   node --env-file=.env.local scripts/backfill-cf-inspiration.mjs --limit 50    # sample run
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const HASH = process.env.CLOUDFLARE_IMAGES_HASH
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

const OPS_BASE = 'applLIT2t83plMqNx'
const INSPIRATION = 'Inspiration'

function die(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!ACCOUNT_ID || !HASH || !TOKEN) {
  die('Cloudflare env vars missing. Run with: node --env-file=.env.local scripts/backfill-cf-inspiration.mjs')
}
if (!AIRTABLE_PAT) {
  die('AIRTABLE_PAT missing in env.')
}

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

async function airtableFetchAll(table, params = {}) {
  const records = []
  let offset = null
  do {
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.fields) params.fields.forEach(f => query.append('fields[]', f))
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${query}`, {
      headers: airtableHeaders,
    })
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)
  return records
}

async function airtablePatch(table, recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders,
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`Airtable PATCH ${res.status}: ${await res.text()}`)
  return res.json()
}

async function uploadToCloudflareByUrl(sourceUrl, customId) {
  const form = new FormData()
  form.append('url', sourceUrl)
  form.append('id', customId)
  form.append('requireSignedURLs', 'false')
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errs = data?.errors || []
    const isDuplicate = errs.some(e => e.code === 5409 || /already exists/i.test(e.message || ''))
    if (isDuplicate) return { id: customId, alreadyExisted: true }
    throw new Error(errs.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`)
  }
  return { id: data?.result?.id, alreadyExisted: false }
}

function buildDeliveryUrl(imageId, variant = 'public') {
  return `https://imagedelivery.net/${HASH}/${imageId}/${variant}`
}

async function main() {
  console.log(`\nFetching Inspiration records missing CDN URL...`)
  const candidates = await airtableFetchAll(INSPIRATION, {
    filterByFormula: `AND(NOT({Thumbnail}=''),{CDN URL}='')`,
    fields: ['Title', 'Thumbnail', 'CDN URL'],
  })
  const todo = LIMIT ? candidates.slice(0, LIMIT) : candidates
  console.log(`✓ ${candidates.length} record(s) need backfill${LIMIT ? `, processing first ${todo.length}` : ''}\n`)

  if (!todo.length) {
    console.log('Nothing to do.')
    return
  }

  let uploaded = 0, skipped = 0, failed = 0
  for (let i = 0; i < todo.length; i++) {
    const record = todo[i]
    const title = (record.fields.Title || record.id).slice(0, 56).padEnd(56)
    process.stdout.write(`  [${i + 1}/${todo.length}] ${title} `)

    const thumb = (record.fields.Thumbnail || [])[0]
    const sourceUrl = thumb?.thumbnails?.large?.url || thumb?.url
    if (!sourceUrl) {
      skipped++
      console.log('— no thumbnail')
      continue
    }

    try {
      const { id, alreadyExisted } = await uploadToCloudflareByUrl(sourceUrl, record.id)
      const cdnUrl = buildDeliveryUrl(id, 'public')
      await airtablePatch(INSPIRATION, record.id, {
        'CDN URL': cdnUrl,
        'CDN Image ID': id,
      })
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

main().catch(err => {
  console.error(`\nFatal error:`, err)
  process.exit(1)
})
