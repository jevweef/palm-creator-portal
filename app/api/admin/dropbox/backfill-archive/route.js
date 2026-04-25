export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

// Resolve a Dropbox shared link URL to the actual file's absolute path.
// Used as a fallback when an Asset has Edited File Link but no Edited File Path.
async function resolveSharedLinkToPath({ token, pathRoot }, sharedUrl) {
  if (!sharedUrl) return null
  // Strip raw=1 / dl=1 / dl=0 — the metadata API expects the canonical share URL
  let cleanUrl = sharedUrl
  try {
    const u = new URL(sharedUrl)
    u.searchParams.delete('raw')
    u.searchParams.delete('dl')
    cleanUrl = u.toString()
  } catch {}
  const res = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': pathRoot,
    },
    body: JSON.stringify({ url: cleanUrl }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.path_lower || data.path_display || null
}

async function getDropboxCredentials() {
  const tokenRes = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  if (!tokenRes.ok) throw new Error(`Dropbox token refresh failed: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json()

  const acctRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const { root_info } = await acctRes.json()
  const pathRoot = JSON.stringify({ '.tag': 'root', root: root_info.root_namespace_id })

  return { token: access_token, pathRoot }
}

// Compute the destination path. Default: regex-replace the /XX_FOLDER/
// segment with /{targetFolder}/. Fallback: when the file lives outside the
// per-creator pipeline (e.g. /Palm Ops/Edited Exports/foo.mp4), build the
// canonical creator-folder path from the AKA so the file lands in the right
// place. Returns null if both strategies fail.
function computeNewPath(currentPath, targetFolder, creatorAka) {
  // Standard: replace /XX_STAGE_FOLDER/ inline
  const replaced = currentPath.replace(/\/\d+_[^/]+\//i, `/${targetFolder}/`)
  if (replaced !== currentPath) return replaced
  // Fallback: rebuild path under creator's social media folder
  if (creatorAka) {
    const filename = currentPath.split('/').pop()
    return `/palm ops/creators/${creatorAka.toLowerCase()}/social media/${targetFolder}/${filename}`
  }
  return null
}

// Move a single file in Dropbox into the target stage folder. Handles
// Dropbox rate limits (too_many_write_operations) with exponential backoff,
// and uses computeNewPath for both standard and fallback path layouts.
async function moveOne({ token, pathRoot }, currentPath, targetFolder, creatorAka) {
  if (currentPath.includes(`/${targetFolder}/`)) {
    return { newPath: currentPath, newLink: null, skipped: 'already-in-target' }
  }
  const newPath = computeNewPath(currentPath, targetFolder, creatorAka)
  if (!newPath) {
    throw new Error(`Could not compute target path from: ${currentPath}`)
  }

  const dbxHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Dropbox-API-Path-Root': pathRoot }

  // Retry on too_many_write_operations with exponential backoff
  let moveRes
  for (let attempt = 0; attempt < 4; attempt++) {
    moveRes = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
      method: 'POST',
      headers: dbxHeaders,
      body: JSON.stringify({ from_path: currentPath, to_path: newPath, autorename: false }),
    })
    if (moveRes.ok) break
    const errText = await moveRes.clone().text()
    if (errText.includes('too_many_write_operations')) {
      const waitMs = 800 * Math.pow(2, attempt) // 800, 1600, 3200, 6400
      console.warn(`[backfill] Rate limited on move; waiting ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }
    if (errText.includes('to/conflict')) return { newPath, newLink: null, skipped: 'destination-exists' }
    throw new Error(`Dropbox move failed: ${errText}`)
  }
  if (!moveRes.ok) {
    throw new Error(`Dropbox move failed after retries: ${await moveRes.text()}`)
  }

  // Best-effort fresh shared link
  let newLink = null
  const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: dbxHeaders,
    body: JSON.stringify({ path: newPath, settings: { requested_visibility: 'public' } }),
  })
  if (linkRes.ok) {
    newLink = (await linkRes.json()).url?.replace('dl=0', 'raw=1') || null
  } else {
    const existRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: dbxHeaders,
      body: JSON.stringify({ path: newPath }),
    })
    if (existRes.ok) {
      newLink = (await existRes.json()).links?.[0]?.url?.replace('dl=0', 'raw=1') || null
    }
  }

  return { newPath, newLink, skipped: null }
}

// POST /api/admin/dropbox/backfill-archive
// Sweeps every Asset that's linked to at least one Post in "Sent to Telegram"
// status and moves its file to 50_POSTED_ARCHIVE. Resolves missing
// `Edited File Path` from `Edited File Link` via shared-link metadata, then
// performs the move. Idempotent — safe to run multiple times.
export async function POST() {
  try { await requireAdmin() } catch (e) { return e }

  const TARGET = '50_POSTED_ARCHIVE'
  const results = { processed: [], skipped: [], failed: [], pathsResolved: 0 }

  try {
    const dbx = await getDropboxCredentials()

    // Find every Post that's been sent to Telegram, deduped by Asset
    const sentPosts = await fetchAirtableRecords('Posts', {
      filterByFormula: `{Status}='Sent to Telegram'`,
      fields: ['Asset', 'Telegram Sent At', 'Post Name'],
    })
    const assetIds = [...new Set(sentPosts.flatMap(p => p.fields?.Asset || []))]

    if (!assetIds.length) {
      return NextResponse.json({ ok: true, message: 'No sent posts found', ...results })
    }

    // Pull all those assets in batches of 50 (Airtable formula length cap)
    const assetMap = {}
    for (let i = 0; i < assetIds.length; i += 50) {
      const chunk = assetIds.slice(i, i + 50)
      const formula = `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(',')})`
      const recs = await fetchAirtableRecords('Assets', {
        filterByFormula: formula,
        fields: ['Asset Name', 'Edited File Path', 'Edited File Link', 'Palm Creators', 'AKA (from Palm Creators)'],
      })
      for (const r of recs) assetMap[r.id] = r
    }

    for (const assetId of assetIds) {
      const asset = assetMap[assetId]
      if (!asset) {
        results.skipped.push({ assetId, reason: 'asset record not found' })
        continue
      }
      const name = asset.fields?.['Asset Name'] || assetId
      let path = (asset.fields?.['Edited File Path'] || '').trim()
      const link = (asset.fields?.['Edited File Link'] || '').trim()

      // Resolve path from shared link if missing
      if (!path && link) {
        try {
          const resolved = await resolveSharedLinkToPath(dbx, link)
          if (resolved) {
            path = resolved
            await patchAirtableRecord('Assets', assetId, { 'Edited File Path': resolved })
            results.pathsResolved++
          }
        } catch (err) {
          results.failed.push({ assetId, name, step: 'resolve-path', error: err.message })
          continue
        }
      }

      if (!path) {
        results.skipped.push({ assetId, name, reason: 'no path or link' })
        continue
      }
      if (path.includes(`/${TARGET}/`)) {
        results.skipped.push({ assetId, name, reason: 'already in archive' })
        continue
      }

      // Pull the creator AKA for the path-rebuild fallback (Edited Exports etc)
      const creatorAka = (asset.fields?.['AKA (from Palm Creators)'] || [])[0] || null

      // Move it
      try {
        const moveOut = await moveOne(dbx, path, TARGET, creatorAka)
        const updates = { 'Edited File Path': moveOut.newPath }
        if (moveOut.newLink) updates['Edited File Link'] = moveOut.newLink
        await patchAirtableRecord('Assets', assetId, updates)
        results.processed.push({ assetId, name, oldPath: path, newPath: moveOut.newPath, ...(moveOut.skipped ? { note: moveOut.skipped } : {}) })
      } catch (err) {
        // If Dropbox says the source file isn't where we think it is, try
        // re-resolving the path from the shared link (handles cases where
        // the asset's stored path is stale from a manual move).
        if (err.message.includes('from_lookup/not_found') && link) {
          try {
            const fresh = await resolveSharedLinkToPath(dbx, link)
            if (fresh && fresh !== path) {
              await patchAirtableRecord('Assets', assetId, { 'Edited File Path': fresh })
              const moveOut2 = await moveOne(dbx, fresh, TARGET, creatorAka)
              const updates = { 'Edited File Path': moveOut2.newPath }
              if (moveOut2.newLink) updates['Edited File Link'] = moveOut2.newLink
              await patchAirtableRecord('Assets', assetId, updates)
              results.processed.push({ assetId, name, oldPath: fresh, newPath: moveOut2.newPath, note: 'path-was-stale' })
              await new Promise(r => setTimeout(r, 250))
              continue
            }
          } catch (retryErr) {
            results.failed.push({ assetId, name, step: 'move-retry', error: retryErr.message })
            continue
          }
        }
        results.failed.push({ assetId, name, step: 'move', error: err.message })
      }
      // Throttle: ~250ms between moves to avoid Dropbox's
      // too_many_write_operations on the same parent folder.
      await new Promise(r => setTimeout(r, 250))
    }

    return NextResponse.json({
      ok: true,
      summary: {
        totalAssets: assetIds.length,
        processed: results.processed.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
        pathsResolved: results.pathsResolved,
      },
      ...results,
    })
  } catch (err) {
    console.error('[backfill-archive] error:', err)
    return NextResponse.json({ error: err.message, partial: results }, { status: 500 })
  }
}
