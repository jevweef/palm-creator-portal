#!/usr/bin/env node
/**
 * Backfill Cloudflare Stream for every Inspiration record's video.
 *
 * One Stream UID per inspo (the DB Share Link or DB Raw = 1 URL). After
 * this runs, every inspo modal / editor inspo cell plays from CF edge
 * instead of Dropbox.
 *
 * Idempotent — skips records that already have Stream UID set.
 *
 * Usage:
 *   cd ~/palm-creator-portal
 *   node --env-file=.env.local scripts/backfill-cf-stream-inspiration.mjs
 *   node --env-file=.env.local scripts/backfill-cf-stream-inspiration.mjs --limit 5
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

const OPS_BASE = 'applLIT2t83plMqNx'
const INSPIRATION = 'Inspiration'

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }

if (!ACCOUNT_ID || !TOKEN) die('Cloudflare env vars missing.')
if (!AIRTABLE_PAT) die('AIRTABLE_PAT missing.')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null

const airtableHeaders = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' }

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

async function streamUpload(url, meta) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/copy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, meta }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const errs = data?.errors || []
    throw new Error(errs.map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`)
  }
  return data?.result?.uid
}

async function main() {
  console.log('\nFetching Inspiration records missing Stream UID...')
  const candidates = await airtableFetchAll(INSPIRATION, {
    filterByFormula: `AND(OR(NOT({DB Share Link}=''),NOT({DB Raw = 1}='')),{Stream UID}='')`,
    fields: ['Title', 'DB Share Link', 'DB Raw = 1', 'Stream UID'],
  })
  const todo = LIMIT ? candidates.slice(0, LIMIT) : candidates
  console.log(`✓ ${candidates.length} record(s) need Stream upload${LIMIT ? `, processing first ${todo.length}` : ''}\n`)
  if (!todo.length) { console.log('Nothing to do.'); return }

  let kicked = 0, skipped = 0, failed = 0
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i]
    const link = r.fields['DB Share Link'] || r.fields['DB Raw = 1']
    const title = (r.fields.Title || r.id).slice(0, 50).padEnd(50)
    process.stdout.write(`  [${i + 1}/${todo.length}] ${title} `)

    if (!link) { skipped++; console.log('— no link'); continue }

    try {
      const uid = await streamUpload(rawDropboxUrl(link), { airtableId: r.id, table: 'Inspiration' })
      await airtablePatch(INSPIRATION, r.id, { 'Stream UID': uid })
      kicked++
      console.log('✓')
    } catch (err) {
      failed++
      console.log(`✗ ${err.message}`)
    }
  }

  console.log(`\n═════════════════════════════`)
  console.log(`  Kicked: ${kicked}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Failed:  ${failed}\n`)
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1) })
