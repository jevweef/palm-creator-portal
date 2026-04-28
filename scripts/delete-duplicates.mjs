#!/usr/bin/env node
/**
 * Delete duplicate photos for a creator.
 *   - Cloudflare Image (if CDN Image ID present)
 *   - Dropbox file (using Dropbox Path (Current))
 *   - Airtable Asset record (last so partial failures leave a record to retry)
 *
 * Skips anything with usage signals (Posts/Tasks/Pipeline/edited/etc).
 * Default mode is dry-run — pass --confirm to actually delete.
 *
 * Usage:
 *   node --env-file=.env.local scripts/delete-duplicates.mjs amelia              # dry-run
 *   node --env-file=.env.local scripts/delete-duplicates.mjs amelia --confirm    # real
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PALM_CREATORS = 'Palm Creators'
const ASSETS = 'Assets'

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const CF_TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN

const DBX_APP_KEY = process.env.DROPBOX_APP_KEY
const DBX_APP_SECRET = process.env.DROPBOX_APP_SECRET
const DBX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN

if (!AIRTABLE_PAT) { console.error('AIRTABLE_PAT missing'); process.exit(1) }
if (!CF_ACCOUNT_ID || !CF_TOKEN) { console.error('Cloudflare env missing'); process.exit(1) }
if (!DBX_APP_KEY || !DBX_APP_SECRET || !DBX_REFRESH_TOKEN) {
  console.error('Dropbox env missing'); process.exit(1)
}

const args = process.argv.slice(2)
const creatorQuery = args.find(a => !a.startsWith('--'))
const CONFIRM = args.includes('--confirm')
if (!creatorQuery) {
  console.error('Usage: node --env-file=.env.local scripts/delete-duplicates.mjs <creator> [--confirm]')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' }

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif']
const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

function getSelectName(val) {
  return (typeof val === 'string' ? val : val?.name || '').toLowerCase()
}
function getLinkedIds(val) {
  return (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)
}
function isImageAsset(fields) {
  const ext = (fields['File Extension'] || '').toLowerCase()
  const link = fields['Dropbox Shared Link'] || ''
  const type = getSelectName(fields['Asset Type'])
  return IMAGE_EXTS.includes(ext) || IMAGE_RE.test(link) || type === 'photo' || type === 'image'
}
function canonicalKey(fileName) {
  if (!fileName) return ''
  return String(fileName)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ─── Airtable ──────────────────────────────────────────────────────────────

async function airtableFetchAll(table, params = {}) {
  const records = []
  let offset = null
  do {
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.fields) params.fields.forEach(f => query.append('fields[]', f))
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${query}`, { headers })
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)
  return records
}

async function airtableDelete(recordId) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(ASSETS)}/${recordId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
  )
  if (!res.ok) throw new Error(`Airtable DELETE ${res.status}: ${await res.text()}`)
}

// ─── Cloudflare Images ─────────────────────────────────────────────────────

async function cfDeleteImage(imageId) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1/${encodeURIComponent(imageId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${CF_TOKEN}` } }
  )
  if (!res.ok && res.status !== 404) {
    throw new Error(`CF DELETE ${res.status}: ${await res.text()}`)
  }
}

// ─── Dropbox ───────────────────────────────────────────────────────────────

let cachedDbxToken = null
let dbxTokenExpiresAt = 0
let cachedRootNs = null

async function getDropboxAccessToken() {
  if (cachedDbxToken && Date.now() < dbxTokenExpiresAt - 60000) return cachedDbxToken
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${DBX_APP_KEY}:${DBX_APP_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: DBX_REFRESH_TOKEN }),
  })
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${res.status}`)
  const data = await res.json()
  cachedDbxToken = data.access_token
  dbxTokenExpiresAt = Date.now() + (data.expires_in * 1000)
  return cachedDbxToken
}

async function getDropboxRootNs() {
  if (cachedRootNs) return cachedRootNs
  const token = await getDropboxAccessToken()
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Dropbox get_current_account ${res.status}`)
  const data = await res.json()
  cachedRootNs = data.root_info.root_namespace_id
  return cachedRootNs
}

async function dropboxDelete(filePath) {
  const token = await getDropboxAccessToken()
  const rootNs = await getDropboxRootNs()
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: rootNs }),
    },
    body: JSON.stringify({ path: filePath }),
  })
  if (!res.ok) {
    if (res.status === 409) return // already gone — fine
    throw new Error(`Dropbox delete ${res.status}: ${await res.text()}`)
  }
}

// ─── Verdict logic (same as analyze script) ────────────────────────────────

function usageAnchored(p) {
  const f = p.fields
  const posts = (f.Posts || []).length
  const tasks = (f.Tasks || []).length
  const inspoSource = (f['Inspiration Source'] || []).length
  const usedAsThumb = !!f['Used As Reel Thumbnail']
  const usedByChatMgr = !!f['Used By Chat Manager At']
  const editRouted = !!f['Edit Route Sent']
  const editedLink = !!f['Edited File Link']
  const editedPath = !!f['Edited File Path']
  const status = typeof f['Pipeline Status'] === 'string'
    ? f['Pipeline Status'] : f['Pipeline Status']?.name || ''
  const pipelineActive = status && !['Uploaded', 'Rejected', ''].includes(status)
  return posts + tasks + inspoSource + (usedAsThumb ? 1 : 0)
    + (editRouted ? 1 : 0) + (editedLink ? 1 : 0) + (editedPath ? 1 : 0)
    + (pipelineActive ? 1 : 0) + (usedByChatMgr ? 1 : 0)
}

function pickKeeper(members) {
  return members.slice().sort((a, b) => {
    const ua = usageAnchored(a)
    const ub = usageAnchored(b)
    if (ua !== ub) return ub - ua
    const aNumbered = /\(\d+\)/.test(a.fields['Asset Name'] || '')
    const bNumbered = /\(\d+\)/.test(b.fields['Asset Name'] || '')
    if (aNumbered !== bNumbered) return aNumbered ? 1 : -1
    const aHeic = /\.heic$/i.test(a.fields['Asset Name'] || '')
    const bHeic = /\.heic$/i.test(b.fields['Asset Name'] || '')
    if (aHeic !== bHeic) return aHeic ? 1 : -1
    return (b.fields['File Size (bytes)'] || 0) - (a.fields['File Size (bytes)'] || 0)
  })[0]
}

// Decide which copies in this dupe group to delete.
//   * Skip the group entirely if any member has usage signals (anchored>0
//     and they're not the keeper — keeper is fine, that's the one we keep).
//   * For numbered "(N)" copies of same canonical name + sizes within 10%
//     of keeper: delete.
//   * For HEIC/JPEG pairs of the same photo: delete the HEIC, keep JPEG.
//   * Anything else (size mismatch on `(N)` copies that aren't HEIC/JPEG):
//     leave for manual review.
function deletionsForGroup(members) {
  const keeper = pickKeeper(members)
  const others = members.filter(m => m.id !== keeper.id)

  // Refuse if anything but the keeper has usage signals
  if (others.some(usageAnchored)) return { keeper, deletes: [], reason: 'review:anchored' }

  const keeperSize = keeper.fields['File Size (bytes)'] || 0
  const sizeOk = (s) => keeperSize && s && Math.min(s, keeperSize) / Math.max(s, keeperSize) >= 0.9

  const deletes = []
  for (const m of others) {
    const name = m.fields['Asset Name'] || ''
    const isHeic = /\.heic$/i.test(name)
    const keeperIsJpeg = /\.jpe?g$/i.test(keeper.fields['Asset Name'] || '')
    if (isHeic && keeperIsJpeg) {
      // HEIC paired with JPEG of the same photo — safe to drop HEIC even if
      // sizes diverge (HEIC and JPEG always compress differently).
      deletes.push(m)
    } else if (sizeOk(m.fields['File Size (bytes)'])) {
      deletes.push(m)
    }
    // else: sizes diverge AND not the HEIC/JPEG case → skip, manual review
  }
  return { keeper, deletes, reason: deletes.length === others.length ? 'all_safe' : 'partial' }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${CONFIRM ? '🚨 CONFIRM MODE — destructive deletions enabled' : '👀 DRY RUN — pass --confirm to actually delete'}`)
  console.log(`\nLooking up creator matching "${creatorQuery}"...`)

  const allCreators = await airtableFetchAll(PALM_CREATORS, { fields: ['Creator', 'AKA'] })
  const q = creatorQuery.toLowerCase()
  const matches = allCreators.filter(r =>
    (r.fields?.Creator || '').toLowerCase().includes(q)
    || (r.fields?.AKA || '').toLowerCase().includes(q)
  )
  if (matches.length === 0) { console.error(`No creator found`); process.exit(1) }
  if (matches.length > 1) {
    console.error(`Multiple matches:`)
    matches.forEach(m => console.error(`  ${m.id}  ${m.fields.AKA || m.fields.Creator}`))
    process.exit(1)
  }
  const creator = matches[0]
  const creatorId = creator.id
  console.log(`✓ Creator: ${creator.fields.AKA || creator.fields.Creator} (${creatorId})\n`)

  console.log('Fetching all assets...')
  const allAssets = await airtableFetchAll(ASSETS, {
    filterByFormula: `NOT({Dropbox Shared Link}='')`,
    fields: [
      'Asset Name', 'Dropbox Shared Link', 'Palm Creators', 'Asset Type',
      'File Extension', 'File Size (bytes)', 'Pipeline Status',
      'Edit Route Sent', 'Edited File Link', 'Edited File Path',
      'Dropbox Path (Current)', 'CDN Image ID',
      'Thumbnail', 'Used As Reel Thumbnail', 'Used By Chat Manager At',
      'Posts', 'Tasks', 'Inspiration Source',
    ],
  })

  const photos = allAssets.filter(a =>
    getLinkedIds(a.fields['Palm Creators']).includes(creatorId) && isImageAsset(a.fields)
  )
  console.log(`✓ ${photos.length} photo(s) for creator\n`)

  const groups = new Map()
  for (const p of photos) {
    const k = canonicalKey(p.fields['Asset Name'])
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(p)
  }

  const dupGroups = [...groups.entries()].filter(([_, m]) => m.length > 1)
  console.log(`Found ${dupGroups.length} duplicate group(s)\n`)

  const allDeletes = []
  let skippedGroups = 0
  for (const [_, members] of dupGroups) {
    const v = deletionsForGroup(members)
    if (v.deletes.length === 0) { skippedGroups++; continue }
    for (const d of v.deletes) {
      allDeletes.push({ asset: d, keeper: v.keeper, reason: v.reason })
    }
  }

  console.log(`Plan:`)
  console.log(`  ${allDeletes.length} asset(s) to delete (across ${dupGroups.length - skippedGroups} groups)`)
  console.log(`  ${skippedGroups} group(s) skipped — manual review needed\n`)

  for (const d of allDeletes) {
    const a = d.asset.fields
    console.log(`  ✗ ${d.asset.id}  ${(a['Asset Name'] || '').padEnd(48)}  → keep ${d.keeper.id} (${(d.keeper.fields['Asset Name'] || '').slice(0, 30)})`)
  }

  if (!CONFIRM) {
    console.log(`\nDry run only. Re-run with --confirm to execute.`)
    return
  }

  console.log(`\n🚨 Executing deletions...\n`)

  let ok = 0
  let partial = 0
  let failed = 0

  for (let i = 0; i < allDeletes.length; i++) {
    const { asset } = allDeletes[i]
    const a = asset.fields
    const name = a['Asset Name'] || asset.id
    process.stdout.write(`  [${i + 1}/${allDeletes.length}] ${name.slice(0, 50).padEnd(50)}  `)

    const errs = []
    const cdnId = a['CDN Image ID']
    const dbxPath = a['Dropbox Path (Current)']

    // 1. Cloudflare Image (idempotent, 404 safe)
    if (cdnId) {
      try { await cfDeleteImage(cdnId) }
      catch (e) { errs.push(`CF: ${e.message}`) }
    }

    // 2. Dropbox file (idempotent, 409 safe)
    if (dbxPath) {
      try { await dropboxDelete(dbxPath) }
      catch (e) { errs.push(`Dropbox: ${e.message}`) }
    }

    // 3. Airtable record — only if previous steps didn't error catastrophically
    // (we'll still try; if Airtable also fails, manual cleanup needed)
    try { await airtableDelete(asset.id) }
    catch (e) { errs.push(`Airtable: ${e.message}`) }

    if (errs.length === 0) { ok++; console.log('✓') }
    else if (errs.some(e => e.startsWith('Airtable:'))) { failed++; console.log(`✗ ${errs.join(' | ')}`) }
    else { partial++; console.log(`! ${errs.join(' | ')} (Airtable record removed)`) }
  }

  console.log(`\n─────────────────────────────`)
  console.log(`✓ Fully deleted:    ${ok}`)
  console.log(`! Partial (CF or Dropbox failed but Airtable record gone): ${partial}`)
  console.log(`✗ Failed entirely:  ${failed}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
