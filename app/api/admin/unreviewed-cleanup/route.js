export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, createDropboxSharedLink } from '@/lib/dropbox'

// One-shot cleanup: find raw clips that were assigned to an edit task but
// never got moved out of 10_UNREVIEWED_LIBRARY (the pre-fix field-ID bug).
// For each, move the Dropbox file to 20_NEEDS_EDIT and flip Airtable Pipeline
// Status to 'In Editing'.
//
// GET  → dry run (no changes, returns list of what WOULD happen)
// POST → executes the moves, returns per-record results
//
// Safe to re-run — only touches assets that still match the "stuck" criteria.

const FROM_STAGE = '10_UNREVIEWED_LIBRARY'
const TO_STAGE = '20_NEEDS_EDIT'

async function dropboxMoveFile(token, rootNamespaceId, fromPath, toPath) {
  const pathRoot = JSON.stringify({ '.tag': 'root', root: rootNamespaceId })
  const res = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': pathRoot,
    },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath, autorename: false }),
  })
  if (!res.ok) {
    const err = await res.text()
    // If the file's already at the destination (e.g. partial previous run),
    // don't treat that as fatal.
    if (res.status === 409 && err.includes('to/conflict/file')) {
      return { alreadyMoved: true }
    }
    if (res.status === 409 && err.includes('from_lookup/not_found')) {
      return { sourceMissing: true }
    }
    throw new Error(`Dropbox move failed (${res.status}): ${err.slice(0, 200)}`)
  }
  return { moved: true }
}

async function findStuckAssets() {
  // Must be Uploaded (still showing in library) AND have tasks linked
  // AND live in the 10_UNREVIEWED_LIBRARY folder.
  const assets = await fetchAirtableRecords('Assets', {
    filterByFormula: `AND({Pipeline Status}='Uploaded', NOT({Tasks}=''), FIND('${FROM_STAGE}', {Dropbox Path (Current)}))`,
    fields: [
      'Asset Name', 'Pipeline Status', 'Tasks', 'Palm Creators',
      'Dropbox Path (Current)', 'Dropbox Parent Folder', 'Dropbox Shared Link',
    ],
  })
  return assets
}

async function buildCreatorNameMap(assets) {
  const creatorIds = [...new Set(assets.flatMap(a => a.fields?.['Palm Creators'] || []).filter(Boolean))]
  if (!creatorIds.length) return {}
  const records = await fetchAirtableRecords('Palm Creators', {
    filterByFormula: `OR(${creatorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`,
    fields: ['Creator', 'AKA'],
  })
  return Object.fromEntries(records.map(r => [r.id, r.fields?.AKA || r.fields?.Creator || '']))
}

// Shared shape builder so GET (dry) and POST return same keys
function buildPlan(asset, creatorMap) {
  const f = asset.fields || {}
  const currentPath = (f['Dropbox Path (Current)'] || '').trim()
  const newPath = currentPath.replace(`/${FROM_STAGE}/`, `/${TO_STAGE}/`)
  const currentParent = (f['Dropbox Parent Folder'] || '').trim()
  const newParent = currentParent.replace(`/${FROM_STAGE}`, `/${TO_STAGE}`)
  const creatorId = (f['Palm Creators'] || [])[0] || null
  return {
    assetId: asset.id,
    assetName: f['Asset Name'] || '',
    creatorName: creatorId ? (creatorMap[creatorId] || '') : '',
    taskCount: (f['Tasks'] || []).length,
    currentPath,
    newPath,
    currentParent,
    newParent,
    pathWillChange: currentPath !== newPath && currentPath.includes(`/${FROM_STAGE}/`),
  }
}

export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const assets = await findStuckAssets()
    const creatorMap = await buildCreatorNameMap(assets)
    const plans = assets.map(a => buildPlan(a, creatorMap))

    // Group by creator for readability
    const byCreator = {}
    for (const p of plans) {
      const key = p.creatorName || '(no creator)'
      if (!byCreator[key]) byCreator[key] = []
      byCreator[key].push(p)
    }

    return NextResponse.json({
      mode: 'dry-run',
      totalStuck: plans.length,
      byCreator,
      plans,
      note: 'POST to this endpoint to actually execute the moves.',
    })
  } catch (err) {
    console.error('[Unreviewed Cleanup] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const assets = await findStuckAssets()
    const creatorMap = await buildCreatorNameMap(assets)
    const plans = assets.map(a => buildPlan(a, creatorMap))

    if (!plans.length) {
      return NextResponse.json({ ok: true, moved: 0, skipped: 0, failed: 0, results: [], note: 'Nothing to clean up.' })
    }

    const accessToken = await getDropboxAccessToken()
    const rootNamespaceId = await getDropboxRootNamespaceId(accessToken)

    const results = []
    let moved = 0, skipped = 0, failed = 0

    for (const plan of plans) {
      // Skip anything where the path doesn't actually contain the source stage
      if (!plan.pathWillChange) {
        skipped++
        results.push({ ...plan, status: 'skipped', reason: 'Path does not contain 10_UNREVIEWED_LIBRARY' })
        continue
      }

      try {
        // 1. Move Dropbox file
        const moveResult = await dropboxMoveFile(accessToken, rootNamespaceId, plan.currentPath, plan.newPath)

        // 2. Regenerate shared link at the new location (old link dies after move)
        let newSharedLink = ''
        try {
          newSharedLink = await createDropboxSharedLink(accessToken, rootNamespaceId, plan.newPath)
        } catch (linkErr) {
          console.warn(`[Cleanup] Share link failed for ${plan.assetId}:`, linkErr.message)
        }

        // 3. Update Airtable — Pipeline Status + path fields
        const update = {
          'Pipeline Status': 'In Editing',
          'Dropbox Path (Current)': plan.newPath,
          'Dropbox Parent Folder': plan.newParent,
        }
        if (newSharedLink) update['Dropbox Shared Link'] = newSharedLink
        await patchAirtableRecord('Assets', plan.assetId, update)

        moved++
        results.push({
          ...plan,
          status: moveResult.alreadyMoved ? 'airtable-only' : 'moved',
          newSharedLink: newSharedLink ? newSharedLink.slice(0, 80) : null,
        })
        console.log(`[Cleanup] ${plan.creatorName} / ${plan.assetName} → 20_NEEDS_EDIT`)
      } catch (err) {
        failed++
        results.push({ ...plan, status: 'failed', error: err.message })
        console.error(`[Cleanup] Failed for ${plan.assetId}:`, err.message)
      }
    }

    // Summary grouped by creator
    const byCreator = {}
    for (const r of results) {
      const key = r.creatorName || '(no creator)'
      if (!byCreator[key]) byCreator[key] = { moved: 0, skipped: 0, failed: 0 }
      if (r.status === 'moved' || r.status === 'airtable-only') byCreator[key].moved++
      else if (r.status === 'skipped') byCreator[key].skipped++
      else if (r.status === 'failed') byCreator[key].failed++
    }

    return NextResponse.json({
      ok: true,
      total: plans.length,
      moved, skipped, failed,
      byCreator,
      results,
    })
  } catch (err) {
    console.error('[Unreviewed Cleanup] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
