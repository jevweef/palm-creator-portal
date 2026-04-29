#!/usr/bin/env node
/**
 * Backfill Cloudflare Stream for active-task video Assets.
 *
 * Targets the same scope the user actually browses today: assets attached
 * to a Task that is in editing / in review / pending post-prep, plus
 * Approved tasks that are still in the post pipeline. Skips ancient or
 * Posted tasks since we don't display those videos anywhere live.
 *
 * For each in-scope Asset, uploads BOTH the raw clip (Dropbox Shared Link)
 * and the editor's edit (Edited File Link, if present) to Cloudflare
 * Stream. The For Review section displays them as separate RAW / EDIT
 * cells so they need separate Stream UIDs.
 *
 * Idempotent — checks Stream Edit ID / Stream Raw ID before uploading.
 * Re-runs only do new work.
 *
 * Polling is sequential and slow (each transcode takes 10–30s) but the
 * script runs locally so timeouts don't matter. Run once, let it churn.
 *
 * Usage:
 *   cd ~/palm-creator-portal
 *   node --env-file=.env.local scripts/backfill-cf-stream.mjs
 *   node --env-file=.env.local scripts/backfill-cf-stream.mjs --limit 5
 *   node --env-file=.env.local scripts/backfill-cf-stream.mjs --no-wait
 *     ↑ skips polling for ready; just kicks off the uploads. Useful when
 *     the queue is large and you want to fire+forget. Status fills in as
 *     CF transcodes.
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = process.env.CLOUDFLARE_IMAGES_TOKEN
const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const CUSTOMER_CODE = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || 's6evvwyakoxbda2u'

const OPS_BASE = 'applLIT2t83plMqNx'
const ASSETS = 'Assets'
const TASKS = 'Tasks'

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1) }

if (!ACCOUNT_ID || !TOKEN) die('Cloudflare env vars missing.')
if (!AIRTABLE_PAT) die('AIRTABLE_PAT missing.')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null
const NO_WAIT = args.includes('--no-wait')

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

async function streamPoll(uid, { intervalMs = 4000, timeoutMs = 300_000 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${uid}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`poll HTTP ${r.status}`)
    const result = data?.result
    const state = result?.status?.state
    if (result?.readyToStream || state === 'ready') return result
    if (state === 'error') {
      const reason = result?.status?.errorReasonText || result?.status?.errorReasonCode || 'unknown'
      throw new Error(`encoding failed: ${reason}`)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('poll timeout')
}

async function main() {
  // Find tasks in the live editing pipeline. Status = 'In Progress' (in editing),
  // or Status = 'Done' with Admin Review Status in Pending Review / Approved
  // / Needs Revision (in review or post-prep). Skip far history.
  console.log('\nFetching active tasks (in editing / in review / post prep)...')
  const tasks = await airtableFetchAll(TASKS, {
    filterByFormula: `OR({Status}='In Progress',AND({Status}='Done',OR({Admin Review Status}='Pending Review',{Admin Review Status}='Approved',{Admin Review Status}='Needs Revision')))`,
    fields: ['Name', 'Status', 'Asset', 'Admin Review Status'],
  })
  const assetIds = [...new Set(tasks.flatMap(t => t.fields?.Asset || []).filter(Boolean))]
  console.log(`✓ ${tasks.length} active task(s), ${assetIds.length} unique asset(s)`)

  if (!assetIds.length) { console.log('\nNothing to do.'); return }

  // Pull the asset records for those tasks
  console.log('Fetching asset records...')
  const recordIdFormula = `OR(${assetIds.map(id => `RECORD_ID()='${id}'`).join(',')})`
  const allAssets = await airtableFetchAll(ASSETS, {
    filterByFormula: recordIdFormula,
    fields: ['Asset Name', 'Asset Type', 'Edited File Link', 'Dropbox Shared Link', 'Stream Edit ID', 'Stream Raw ID'],
  })

  // Filter to videos that have at least one missing Stream ID
  const isVideo = a => {
    const t = a.fields?.['Asset Type']
    const name = (typeof t === 'object' ? t?.name : t) || ''
    return name.toLowerCase() === 'video'
  }
  const todo = allAssets
    .filter(isVideo)
    .filter(a => {
      const f = a.fields
      const wantsEdit = !!f['Edited File Link'] && !f['Stream Edit ID']
      const wantsRaw = !!f['Dropbox Shared Link'] && !f['Stream Raw ID']
      return wantsEdit || wantsRaw
    })
  const slice = LIMIT ? todo.slice(0, LIMIT) : todo
  console.log(`✓ ${todo.length} video asset(s) need Stream upload${LIMIT ? `, processing first ${slice.length}` : ''}\n`)

  if (!slice.length) { console.log('Nothing to do.'); return }

  let uploadsKicked = 0, uploadsSkipped = 0, uploadsFailed = 0, polled = 0, pollFailed = 0

  // Phase 1: kick off all uploads (fast — CF returns immediately, transcode
  // happens server-side). Collect the UIDs to poll afterward.
  console.log('━━━ Phase 1: kicking off uploads ━━━')
  const pendingPolls = []
  for (let i = 0; i < slice.length; i++) {
    const a = slice[i]
    const f = a.fields
    const name = (f['Asset Name'] || a.id).slice(0, 50).padEnd(50)
    const updates = {}

    if (f['Edited File Link'] && !f['Stream Edit ID']) {
      try {
        const uid = await streamUpload(rawDropboxUrl(f['Edited File Link']), { airtableId: a.id, kind: 'edit' })
        updates['Stream Edit ID'] = uid
        pendingPolls.push({ uid, kind: 'edit', name: f['Asset Name'] })
        uploadsKicked++
      } catch (err) {
        uploadsFailed++
        console.log(`  ✗ [${i+1}/${slice.length}] ${name} edit: ${err.message}`)
      }
    } else if (f['Stream Edit ID']) {
      uploadsSkipped++
    }

    if (f['Dropbox Shared Link'] && !f['Stream Raw ID']) {
      try {
        const uid = await streamUpload(rawDropboxUrl(f['Dropbox Shared Link']), { airtableId: a.id, kind: 'raw' })
        updates['Stream Raw ID'] = uid
        pendingPolls.push({ uid, kind: 'raw', name: f['Asset Name'] })
        uploadsKicked++
      } catch (err) {
        uploadsFailed++
        console.log(`  ✗ [${i+1}/${slice.length}] ${name} raw: ${err.message}`)
      }
    } else if (f['Stream Raw ID']) {
      uploadsSkipped++
    }

    if (Object.keys(updates).length) {
      try {
        await airtablePatch(ASSETS, a.id, updates)
        const parts = []
        if (updates['Stream Edit ID']) parts.push('edit')
        if (updates['Stream Raw ID']) parts.push('raw')
        console.log(`  ✓ [${i+1}/${slice.length}] ${name} kicked: ${parts.join(' + ')}`)
      } catch (err) {
        console.log(`  ⚠ [${i+1}/${slice.length}] ${name} airtable patch failed: ${err.message}`)
      }
    }
  }

  console.log(`\n  Kicked: ${uploadsKicked}  Skipped: ${uploadsSkipped}  Failed: ${uploadsFailed}\n`)

  if (NO_WAIT) {
    console.log('--no-wait: skipping the poll phase. CF will keep transcoding in the background.')
    console.log('Run again later (without --no-wait) to verify status, or just check the dashboard.')
    return
  }

  // Phase 2: poll each kicked upload until ready (or fail). Sequential to
  // keep CF API load polite; transcode parallelism is server-side anyway.
  if (!pendingPolls.length) return
  console.log(`━━━ Phase 2: polling ${pendingPolls.length} upload(s) for ready ━━━`)
  for (let i = 0; i < pendingPolls.length; i++) {
    const p = pendingPolls[i]
    const label = `[${i+1}/${pendingPolls.length}] ${p.kind.padEnd(4)} ${(p.name || p.uid).slice(0, 40).padEnd(40)}`
    process.stdout.write(`  ${label} ...`)
    try {
      const result = await streamPoll(p.uid)
      const dur = (result.duration || 0).toFixed(1)
      console.log(` ✓ ready (${dur}s)`)
      polled++
    } catch (err) {
      console.log(` ✗ ${err.message}`)
      pollFailed++
    }
  }

  console.log(`\n═════════════════════════════`)
  console.log(`  Uploads kicked: ${uploadsKicked}`)
  console.log(`  Uploads skipped (already done): ${uploadsSkipped}`)
  console.log(`  Upload failures: ${uploadsFailed}`)
  console.log(`  Polled to ready: ${polled}`)
  console.log(`  Poll failures: ${pollFailed}\n`)
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1) })
