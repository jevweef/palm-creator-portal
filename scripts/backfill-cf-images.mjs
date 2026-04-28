#!/usr/bin/env node
/**
 * Backfill Cloudflare Images for a creator's photo library.
 *
 * One-time (or rerunnable) script: walks every Asset linked to a creator,
 * uploads each photo to Cloudflare Images via upload-by-URL (Cloudflare
 * fetches the Dropbox file directly — we don't stream bytes through here),
 * and writes the delivery URL back to the Asset's CDN URL field.
 *
 * Idempotent. Custom image ID = Airtable record ID, so re-runs skip already-
 * uploaded assets and recover from partial failures.
 *
 * Usage:
 *   cd ~/palm-creator-portal
 *   node --env-file=.env.local scripts/backfill-cf-images.mjs sunny     # one creator
 *   node --env-file=.env.local scripts/backfill-cf-images.mjs --all     # everyone Active or Onboarding
 *
 * Pass any substring of the creator's name or AKA, or --all. Will pick the first match.
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const HASH = process.env.CLOUDFLARE_IMAGES_HASH
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

const OPS_BASE = 'applLIT2t83plMqNx'
const PALM_CREATORS = 'Palm Creators'
const ASSETS = 'Assets'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif']
const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

function die(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!ACCOUNT_ID || !HASH || !TOKEN) {
  die('Cloudflare env vars missing. Run with: node --env-file=.env.local scripts/backfill-cf-images.mjs sunny')
}
if (!AIRTABLE_PAT) {
  die('AIRTABLE_PAT missing in env.')
}

const creatorQuery = (process.argv[2] || '').trim()
const ALL_MODE = creatorQuery === '--all'
if (!creatorQuery) {
  die('Usage: node --env-file=.env.local scripts/backfill-cf-images.mjs <creator name | --all>')
}

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

function getSelectName(val) {
  return (typeof val === 'string' ? val : val?.name || '').toLowerCase()
}

function isImageAsset(fields) {
  const ext = (fields['File Extension'] || '').toLowerCase()
  const link = fields['Dropbox Shared Link'] || ''
  const type = getSelectName(fields['Asset Type'])
  return IMAGE_EXTS.includes(ext) || IMAGE_RE.test(link) || type === 'photo' || type === 'image'
}

function getLinkedIds(val) {
  return (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)
}

async function airtableFetchAll(table, params = {}) {
  const records = []
  let offset = null
  do {
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.fields) params.fields.forEach(f => query.append('fields[]', f))
    if (params.sort) {
      params.sort.forEach((s, i) => {
        query.set(`sort[${i}][field]`, s.field)
        if (s.direction) query.set(`sort[${i}][direction]`, s.direction)
      })
    }
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${query}`, {
      headers: airtableHeaders,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable ${res.status}: ${text}`)
    }
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
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable PATCH ${res.status}: ${text}`)
  }
  return res.json()
}

async function uploadToCloudflareByUrl(sourceUrl, customId) {
  const form = new FormData()
  form.append('url', sourceUrl)
  form.append('id', customId)
  form.append('requireSignedURLs', 'false')

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    }
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

// ─── Per-creator backfill ──────────────────────────────────────────────────

async function backfillCreator(creator, allAssets) {
  const creatorId = creator.id
  const creatorName = creator.fields.AKA || creator.fields.Creator

  const photos = allAssets.filter(a => {
    if (!getLinkedIds(a.fields['Palm Creators']).includes(creatorId)) return false
    return isImageAsset(a.fields)
  })

  const todo = photos.filter(a => !a.fields['CDN URL'])
  const skipping = photos.length - todo.length

  console.log(`\n─── ${creatorName} (${creatorId}) ───`)
  console.log(`  ${photos.length} photo(s) total · ${skipping} already on CDN · ${todo.length} to upload`)

  if (todo.length === 0) return { creatorName, uploaded: 0, failed: 0, skipped: skipping }

  let uploaded = 0
  let failed = 0
  let i = 0

  for (const asset of todo) {
    i++
    const name = asset.fields['Asset Name'] || asset.id
    const sourceUrl = rawDropboxUrl(asset.fields['Dropbox Shared Link'])
    process.stdout.write(`  [${i}/${todo.length}] ${name.slice(0, 56).padEnd(56)} `)

    try {
      const { id, alreadyExisted } = await uploadToCloudflareByUrl(sourceUrl, asset.id)
      const cdnUrl = buildDeliveryUrl(id, 'public')
      await airtablePatch(ASSETS, asset.id, {
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

  return { creatorName, uploaded, failed, skipped: skipping }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nFetching creators...`)
  const allCreators = await airtableFetchAll(PALM_CREATORS, {
    fields: ['Creator', 'AKA', 'Status'],
  })

  let creatorsToProcess = []

  if (ALL_MODE) {
    // Active + Onboarding only — skip paused/old creators
    creatorsToProcess = allCreators.filter(r => {
      const status = typeof r.fields?.Status === 'string'
        ? r.fields.Status
        : (r.fields?.Status?.name || '')
      return status === 'Active' || status === 'Onboarding'
    })
    creatorsToProcess.sort((a, b) => {
      const an = (a.fields.AKA || a.fields.Creator || '').toLowerCase()
      const bn = (b.fields.AKA || b.fields.Creator || '').toLowerCase()
      return an.localeCompare(bn)
    })
    console.log(`✓ Found ${creatorsToProcess.length} active/onboarding creator(s)`)
  } else {
    const q = creatorQuery.toLowerCase()
    const matches = allCreators.filter(r => {
      const name = (r.fields?.Creator || '').toLowerCase()
      const aka = (r.fields?.AKA || '').toLowerCase()
      return name.includes(q) || aka.includes(q)
    })
    if (matches.length === 0) die(`No creator found matching "${creatorQuery}"`)
    if (matches.length > 1) {
      console.log(`Multiple matches:`)
      matches.forEach(m => console.log(`  ${m.id}  ${m.fields.AKA || m.fields.Creator}`))
      die('Be more specific.')
    }
    creatorsToProcess = matches
    console.log(`✓ Creator: ${creatorsToProcess[0].fields.AKA || creatorsToProcess[0].fields.Creator}`)
  }

  // Fetch the asset table once and reuse across all creators — Assets
  // table scan is the slow part, no point repeating it per creator.
  console.log(`\nFetching all assets (one-time scan)...`)
  const allAssets = await airtableFetchAll(ASSETS, {
    filterByFormula: `NOT({Dropbox Shared Link}='')`,
    fields: [
      'Asset Name',
      'Dropbox Shared Link',
      'Palm Creators',
      'Asset Type',
      'File Extension',
      'CDN URL',
      'CDN Image ID',
    ],
  })
  console.log(`✓ Fetched ${allAssets.length} asset(s) total`)

  const summary = []
  for (const creator of creatorsToProcess) {
    try {
      const result = await backfillCreator(creator, allAssets)
      summary.push(result)
    } catch (err) {
      console.error(`  ✗ Fatal error for creator: ${err.message}`)
      summary.push({
        creatorName: creator.fields.AKA || creator.fields.Creator,
        uploaded: 0,
        failed: -1,
        skipped: 0,
      })
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n═════════════════════════════`)
  console.log(`Backfill complete.\n`)
  let totalUp = 0, totalFail = 0, totalSkip = 0
  for (const s of summary) {
    const prefix = s.failed === -1 ? '✗' : s.failed > 0 ? '!' : '✓'
    console.log(`  ${prefix} ${s.creatorName.padEnd(24)} uploaded ${s.uploaded}, skipped ${s.skipped}${s.failed > 0 ? `, failed ${s.failed}` : ''}`)
    totalUp += s.uploaded
    totalSkip += s.skipped
    if (s.failed > 0) totalFail += s.failed
  }
  console.log(`\n  Total uploaded: ${totalUp}`)
  console.log(`  Total skipped:  ${totalSkip}`)
  console.log(`  Total failed:   ${totalFail}`)
}

main().catch(err => {
  console.error(`\nFatal error:`, err)
  process.exit(1)
})
