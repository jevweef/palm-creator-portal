#!/usr/bin/env node
/**
 * Analyze a creator's photo library for likely duplicates.
 * READ-ONLY — does not modify anything. Run this first, review the report,
 * then run a separate delete script when you're confident.
 *
 * Detects two patterns:
 *  1. Numbered duplicates:   IMG_2502.JPG  vs  IMG_2502 (1).JPG
 *  2. Format duplicates:     IMG_3497.HEIC vs  IMG_3497.JPG  (same photo,
 *     different format — usually iPhone HEIC + auto-converted JPEG)
 *
 * Grouping key: strip extension, strip trailing `(N)`, normalize whitespace,
 * lowercase. For each group of size > 1, lists every member with safety info
 * (linked Posts, Tasks, Thumbnail-used flag) so you can see what would be
 * affected if you deleted any.
 *
 * Usage:
 *   cd ~/palm-creator-portal
 *   node --env-file=.env.local scripts/analyze-duplicates.mjs amelia
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const PALM_CREATORS = 'Palm Creators'
const ASSETS = 'Assets'

if (!AIRTABLE_PAT) {
  console.error('AIRTABLE_PAT missing in env.')
  process.exit(1)
}

const creatorQuery = (process.argv[2] || '').trim()
if (!creatorQuery) {
  console.error('Usage: node --env-file=.env.local scripts/analyze-duplicates.mjs <creator name>')
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

async function airtableFetchAll(table, params = {}) {
  const records = []
  let offset = null
  do {
    const query = new URLSearchParams()
    if (offset) query.set('offset', offset)
    if (params.filterByFormula) query.set('filterByFormula', params.filterByFormula)
    if (params.fields) params.fields.forEach(f => query.append('fields[]', f))
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${query}`, {
      headers,
    })
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`)
    const data = await res.json()
    records.push(...(data.records || []))
    offset = data.offset || null
  } while (offset)
  return records
}

// Strip extension, strip trailing ` (N)` count suffix, normalize whitespace.
// Examples:
//   "Amelia - IMG_2502 (1).JPG" → "amelia - img_2502"
//   "Amelia - IMG_2502.JPG"     → "amelia - img_2502"
//   "IMG_3497.HEIC"             → "img_3497"
//   "IMG_3497.JPG"              → "img_3497"
function canonicalKey(fileName) {
  if (!fileName) return ''
  let s = String(fileName)
  // strip extension
  s = s.replace(/\.[a-z0-9]{2,5}$/i, '')
  // strip trailing " (N)"
  s = s.replace(/\s*\(\d+\)\s*$/, '')
  // collapse whitespace, lowercase
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

function bytesToMB(bytes) {
  if (!bytes) return '?'
  return (bytes / 1024 / 1024).toFixed(1)
}

async function main() {
  console.log(`\nLooking up creator matching "${creatorQuery}"...`)

  const allCreators = await airtableFetchAll(PALM_CREATORS, { fields: ['Creator', 'AKA'] })
  const q = creatorQuery.toLowerCase()
  const matches = allCreators.filter(r => {
    const name = (r.fields?.Creator || '').toLowerCase()
    const aka = (r.fields?.AKA || '').toLowerCase()
    return name.includes(q) || aka.includes(q)
  })
  if (matches.length === 0) {
    console.error(`No creator found matching "${creatorQuery}"`)
    process.exit(1)
  }
  if (matches.length > 1) {
    console.log(`Multiple matches:`)
    matches.forEach(m => console.log(`  ${m.id}  ${m.fields.AKA || m.fields.Creator}`))
    process.exit(1)
  }

  const creator = matches[0]
  const creatorId = creator.id
  const creatorName = creator.fields.AKA || creator.fields.Creator
  console.log(`✓ Creator: ${creatorName} (${creatorId})\n`)

  console.log('Fetching all assets...')
  // Pull every signal that hints at usage. If ANY of these are non-default
  // for a duplicate copy, it stays in the "needs review" bucket — never
  // auto-deleted.
  const allAssets = await airtableFetchAll(ASSETS, {
    filterByFormula: `NOT({Dropbox Shared Link}='')`,
    fields: [
      'Asset Name',
      'Dropbox Shared Link',
      'Palm Creators',
      'Asset Type',
      'File Extension',
      'File Size (bytes)',
      'Pipeline Status',
      'Review Status',
      'Quality Rating',
      'Content Decision',
      'Edit Route Sent',
      'Edited File Link',
      'Edited File Path',
      'CDN URL',
      'Thumbnail',
      'Used As Reel Thumbnail',
      'Used By Chat Manager At',
      'Posts',
      'Tasks',
      'Inspiration Source',
      'Asset Created Date',
    ],
  })

  const photos = allAssets.filter(a => {
    if (!getLinkedIds(a.fields['Palm Creators']).includes(creatorId)) return false
    return isImageAsset(a.fields)
  })

  console.log(`✓ ${creatorName} has ${photos.length} photo(s) total\n`)

  // Group by canonical key
  const groups = new Map()
  for (const p of photos) {
    const key = canonicalKey(p.fields['Asset Name'])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const duplicateGroups = [...groups.entries()].filter(([_, members]) => members.length > 1)
  duplicateGroups.sort((a, b) => b[1].length - a[1].length)

  // Stats
  const totalDupes = duplicateGroups.reduce((sum, [_, m]) => sum + m.length, 0)
  const totalRedundant = duplicateGroups.reduce((sum, [_, m]) => sum + (m.length - 1), 0)
  const groupsWithLinks = duplicateGroups.filter(([_, m]) =>
    m.some(p =>
      (p.fields.Posts || []).length > 0
      || (p.fields.Tasks || []).length > 0
      || (p.fields.Thumbnail || []).length > 0
      || p.fields['Used As Reel Thumbnail']
      || (p.fields['Inspiration Source'] || []).length > 0
    )
  )

  console.log(`═══════════════════════════════════════════════════════`)
  console.log(`  Found ${duplicateGroups.length} duplicate group(s)`)
  console.log(`  Total photos in those groups: ${totalDupes}`)
  console.log(`  Redundant copies (could potentially delete): ${totalRedundant}`)
  console.log(`  Groups with linked Posts/Tasks/Thumbnails: ${groupsWithLinks.length}`)
  console.log(`═══════════════════════════════════════════════════════\n`)

  if (duplicateGroups.length === 0) {
    console.log('No duplicate name patterns detected.')
    return
  }

  // Helper — surface every signal that suggests an asset is "in use".
  // If anchored=0 the asset is not referenced anywhere we can detect.
  function usageSignals(p) {
    const f = p.fields
    const posts = (f.Posts || []).length
    const tasks = (f.Tasks || []).length
    const inspoSource = (f['Inspiration Source'] || []).length
    const usedAsThumb = !!f['Used As Reel Thumbnail']
    const usedByChatMgr = !!f['Used By Chat Manager At']
    const editRouted = !!f['Edit Route Sent']
    const editedLink = !!f['Edited File Link']
    const editedPath = !!f['Edited File Path']
    // Pipeline values like 'Approved', 'Posted', 'In Editing' mean active
    // workflow. Treat 'Uploaded' (default for unprocessed) and blank as
    // not-anchored.
    const status = typeof f['Pipeline Status'] === 'string'
      ? f['Pipeline Status']
      : f['Pipeline Status']?.name || ''
    const pipelineActive = status && !['Uploaded', 'Rejected', ''].includes(status)
    const flags = []
    if (posts > 0) flags.push(`Posts:${posts}`)
    if (tasks > 0) flags.push(`Tasks:${tasks}`)
    if (usedAsThumb) flags.push('UsedAsReelThumb')
    if (inspoSource > 0) flags.push('InspoSource')
    if (editRouted) flags.push('EditRouted')
    if (editedLink) flags.push('hasEditedLink')
    if (editedPath) flags.push('hasEditedPath')
    if (pipelineActive) flags.push(`Pipeline:${status}`)
    if (usedByChatMgr) flags.push('ChatManagerUsed')
    const anchored = posts + tasks + inspoSource + (usedAsThumb ? 1 : 0)
      + (editRouted ? 1 : 0) + (editedLink ? 1 : 0) + (editedPath ? 1 : 0)
      + (pipelineActive ? 1 : 0) + (usedByChatMgr ? 1 : 0)
    return { anchored, flags }
  }

  // Pick which member of a duplicate group should be kept.
  // Priority:
  //  1. The most anchored copy (any usage signal).
  //  2. The non-numbered file (e.g. "IMG.JPG" over "IMG (1).JPG").
  //  3. JPEG/JPG over HEIC (browser-friendly).
  //  4. Largest file size (typically highest quality).
  function pickKeeper(members) {
    return members.slice().sort((a, b) => {
      const ua = usageSignals(a).anchored
      const ub = usageSignals(b).anchored
      if (ua !== ub) return ub - ua

      const an = a.fields['Asset Name'] || ''
      const bn = b.fields['Asset Name'] || ''
      const aNumbered = /\(\d+\)/.test(an)
      const bNumbered = /\(\d+\)/.test(bn)
      if (aNumbered !== bNumbered) return aNumbered ? 1 : -1

      const aHeic = /\.heic$/i.test(an)
      const bHeic = /\.heic$/i.test(bn)
      if (aHeic !== bHeic) return aHeic ? 1 : -1

      const as = a.fields['File Size (bytes)'] || 0
      const bs = b.fields['File Size (bytes)'] || 0
      return bs - as
    })[0]
  }

  // Verdict per group:
  //  KEEP_ALL    — every copy has usage signals, never auto-delete
  //  AUTO_DELETE — exactly one copy is the keeper, rest have NO usage and
  //                file sizes are within 10% of the keeper (probable true dupes)
  //  REVIEW      — sizes diverge by >10% so might be different photos,
  //                or some-but-not-all members are anchored
  function verdictFor(group) {
    const enriched = group.map(p => ({ p, sig: usageSignals(p), size: p.fields['File Size (bytes)'] || 0 }))
    const anyAnchored = enriched.some(e => e.sig.anchored > 0)
    const allAnchored = enriched.every(e => e.sig.anchored > 0)
    if (allAnchored) return { code: 'KEEP_ALL', keeper: null, deletes: [] }

    const keeper = pickKeeper(group)
    const others = enriched.filter(e => e.p.id !== keeper.id)
    const keeperSize = keeper.fields['File Size (bytes)'] || 0

    // Any non-keeper anchored anywhere → manual review (don't risk it)
    if (others.some(e => e.sig.anchored > 0)) {
      return { code: 'REVIEW_anchored', keeper, deletes: [] }
    }

    // All non-keepers must be similar size — within 10% of keeper.
    const sizeOk = (a, b) => {
      if (!a || !b) return false
      const ratio = Math.min(a, b) / Math.max(a, b)
      return ratio >= 0.9
    }
    if (!others.every(e => sizeOk(e.size, keeperSize))) {
      return { code: 'REVIEW_size_mismatch', keeper, deletes: [] }
    }

    return { code: 'AUTO_DELETE', keeper, deletes: others.map(e => e.p) }
  }

  // Bucket every group, then print.
  const buckets = { AUTO_DELETE: [], REVIEW_size_mismatch: [], REVIEW_anchored: [], KEEP_ALL: [] }
  const verdicts = duplicateGroups.map(([key, members]) => {
    const v = verdictFor(members)
    buckets[v.code].push({ key, members, ...v })
    return { key, members, ...v }
  })

  function printGroup(g, includeVerdict = true) {
    console.log(`  ━━━ "${g.key}" — ${g.members.length} copies${includeVerdict ? `  [${g.code}]` : ''}`)
    const ranked = g.members.slice().sort((a, b) => usageSignals(b).anchored - usageSignals(a).anchored)
    for (const p of ranked) {
      const f = p.fields
      const sig = usageSignals(p)
      const isKeeper = g.keeper?.id === p.id
      const willDelete = g.deletes.some(d => d.id === p.id)
      const marker = isKeeper ? '✓ KEEP  ' : willDelete ? '✗ DELETE' : '·       '
      const ext = (f['File Extension'] || '').toLowerCase() || (f['Asset Name']?.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase()
      const sizeMB = bytesToMB(f['File Size (bytes)'])
      const flagStr = sig.flags.length ? ` [${sig.flags.join(', ')}]` : ''
      console.log(`     ${marker}  ${p.id}  ${(f['Asset Name'] || '').padEnd(48)} .${ext.padEnd(5)} ${sizeMB}MB${flagStr}`)
    }
  }

  if (buckets.AUTO_DELETE.length) {
    console.log(`\n──── Safe to auto-delete: ${buckets.AUTO_DELETE.length} group(s) ────\n`)
    for (const g of buckets.AUTO_DELETE) printGroup(g)
  }
  if (buckets.REVIEW_size_mismatch.length) {
    console.log(`\n──── Manual review — file sizes diverge: ${buckets.REVIEW_size_mismatch.length} group(s) ────\n`)
    for (const g of buckets.REVIEW_size_mismatch) printGroup(g)
  }
  if (buckets.REVIEW_anchored.length) {
    console.log(`\n──── Manual review — non-keeper has usage signals: ${buckets.REVIEW_anchored.length} group(s) ────\n`)
    for (const g of buckets.REVIEW_anchored) printGroup(g)
  }
  if (buckets.KEEP_ALL.length) {
    console.log(`\n──── Keep all (every copy is in use): ${buckets.KEEP_ALL.length} group(s) ────\n`)
    for (const g of buckets.KEEP_ALL) printGroup(g)
  }

  // Also break down by pattern: numbered (X (1).ext), format-pair (X.heic + X.jpg), other
  let numberedCnt = 0
  let formatPairCnt = 0
  let otherCnt = 0
  for (const [_, members] of duplicateGroups) {
    const names = members.map(p => p.fields['Asset Name'] || '')
    const exts = new Set(members.map(p => (p.fields['File Extension'] || '').toLowerCase()))
    const hasNumbered = names.some(n => /\(\d+\)/.test(n))
    if (hasNumbered) numberedCnt++
    else if (exts.size > 1) formatPairCnt++
    else otherCnt++
  }

  console.log(`\n─── Pattern breakdown ───`)
  console.log(`  Numbered "(N)" duplicates:     ${numberedCnt} groups`)
  console.log(`  Format-pair (HEIC+JPEG etc):   ${formatPairCnt} groups`)
  console.log(`  Other same-name:               ${otherCnt} groups`)

  console.log(`\n─── Verdict summary ───`)
  console.log(`  AUTO_DELETE             ${buckets.AUTO_DELETE.length.toString().padStart(3)} groups (${buckets.AUTO_DELETE.reduce((s, g) => s + g.deletes.length, 0)} assets to delete)`)
  console.log(`  REVIEW (size mismatch)  ${buckets.REVIEW_size_mismatch.length.toString().padStart(3)} groups`)
  console.log(`  REVIEW (anchored)       ${buckets.REVIEW_anchored.length.toString().padStart(3)} groups`)
  console.log(`  KEEP_ALL (in use)       ${buckets.KEEP_ALL.length.toString().padStart(3)} groups`)

  console.log(`\nNo changes made. To delete the AUTO_DELETE list, run:`)
  console.log(`  node --env-file=.env.local scripts/delete-duplicates.mjs ${creatorQuery}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
