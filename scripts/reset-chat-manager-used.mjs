#!/usr/bin/env node
/**
 * One-off: clear "Used By Chat Manager" fields for a specific creator,
 * optionally narrowed to records marked within the last N minutes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reset-chat-manager-used.mjs <creator> [--minutes=N] [--confirm]
 *
 * Defaults to a dry-run unless --confirm is passed.
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'

if (!AIRTABLE_PAT) { console.error('AIRTABLE_PAT missing'); process.exit(1) }

const args = process.argv.slice(2)
const creatorQuery = args.find(a => !a.startsWith('--'))
const CONFIRM = args.includes('--confirm')
const minutesArg = args.find(a => a.startsWith('--minutes='))
const MINUTES = minutesArg ? parseInt(minutesArg.split('=')[1], 10) : null

if (!creatorQuery) {
  console.error('Usage: node --env-file=.env.local scripts/reset-chat-manager-used.mjs <creator> [--minutes=60] [--confirm]')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' }

const getLinkedIds = (val) => (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)

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

async function main() {
  console.log(`\n${CONFIRM ? '🚨 CONFIRM MODE' : '👀 DRY RUN — pass --confirm to execute'}\n`)

  // Find creator
  const creators = await airtableFetchAll('Palm Creators', { fields: ['Creator', 'AKA'] })
  const q = creatorQuery.toLowerCase()
  const matches = creators.filter(r =>
    (r.fields?.Creator || '').toLowerCase().includes(q)
    || (r.fields?.AKA || '').toLowerCase().includes(q)
  )
  if (matches.length === 0) { console.error(`No creator found matching "${creatorQuery}"`); process.exit(1) }
  if (matches.length > 1) {
    console.error(`Multiple matches:`)
    matches.forEach(m => console.error(`  ${m.id}  ${m.fields.AKA || m.fields.Creator}`))
    process.exit(1)
  }
  const creator = matches[0]
  const creatorName = creator.fields.AKA || creator.fields.Creator
  console.log(`Creator: ${creatorName} (${creator.id})\n`)

  // Find marked-used assets
  const assets = await airtableFetchAll('Assets', {
    filterByFormula: `NOT({Used By Chat Manager At}='')`,
    fields: ['Asset Name', 'Palm Creators', 'Used By Chat Manager At'],
  })
  let marked = assets.filter(a => getLinkedIds(a.fields?.['Palm Creators']).includes(creator.id))

  if (MINUTES != null) {
    const cutoff = Date.now() - MINUTES * 60 * 1000
    marked = marked.filter(a => {
      const t = a.fields?.['Used By Chat Manager At']
      return t && new Date(t).getTime() >= cutoff
    })
  }

  if (marked.length === 0) {
    console.log('Nothing to clear.')
    return
  }

  console.log(`Will clear "Used" markings on ${marked.length} record(s):`)
  for (const m of marked.slice(0, 20)) {
    console.log(`  · ${m.id}  ${(m.fields['Asset Name'] || '').slice(0, 60).padEnd(60)} ${m.fields['Used By Chat Manager At']}`)
  }
  if (marked.length > 20) console.log(`  ... and ${marked.length - 20} more`)

  if (!CONFIRM) {
    console.log(`\nDry run only.`)
    return
  }

  console.log(`\nClearing in batches of 10...`)
  let cleared = 0
  for (let i = 0; i < marked.length; i += 10) {
    const chunk = marked.slice(i, i + 10)
    const body = {
      records: chunk.map(m => ({
        id: m.id,
        fields: {
          'Used By Chat Manager At': null,
          'Used By Chat Manager': '',
          'Used By Chat Manager For': null,
        },
      })),
    }
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Assets`, {
      method: 'PATCH', headers, body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`  ✗ chunk ${i / 10 + 1}: ${res.status} ${text}`)
      continue
    }
    cleared += chunk.length
    process.stdout.write(`\r  cleared ${cleared}/${marked.length}`)
  }
  console.log(`\n\n✓ Cleared ${cleared} record(s).`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
