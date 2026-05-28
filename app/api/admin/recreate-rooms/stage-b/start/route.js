import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { nextStageBSequence, stageBSlug } from '@/lib/recreateSlug'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const STAGE_B_OUTPUTS = 'Stage B Outputs'
const PALM_CREATORS = 'Palm Creators'

// POST { creatorId, reelRecordIds: ['rec...', ...], workflowType?: 'Bedroom' | 'Freelance' }
//
// "Start a project" — the moment the editor commits to working on a
// (creator, reel) pair, even before any TJP work has happened. Creates
// a Stage B Output record per reel with Status='Started', so the
// editor sees a project card on /ai-editor as soon as they download.
//
// workflowType drives what the editor's project card asks for next:
//   - 'Bedroom'   → full portal create-scene flow (default for legacy paths)
//   - 'Freelance' → editor produces final reels in TJP; project card
//                   shows "↑ Upload final reels" instead of the TJP-photo
//                   step. No bedroom-scene work is required.
//
// Used by:
//   - ReelCard's ↓ Raw button (single reel, Bedroom)
//   - Pool's Download N as ZIP (multi-select, Bedroom)
//   - NewProjectModal Freelance / Bedroom Content buttons (one or many reels)
//
// Idempotent: if a Stage B Output already exists for a (creator, reel)
// pair, that reel is skipped rather than creating a duplicate.
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const { creatorId, reelRecordIds, workflowType: rawWorkflowType } = await request.json()
    if (!creatorId || !/^rec[A-Za-z0-9]{14}$/.test(creatorId)) {
      return NextResponse.json({ error: 'Valid creatorId required' }, { status: 400 })
    }
    if (!Array.isArray(reelRecordIds) || !reelRecordIds.length) {
      return NextResponse.json({ error: 'reelRecordIds[] required' }, { status: 400 })
    }
    const cleanReels = reelRecordIds.filter(r => /^rec[A-Za-z0-9]{14}$/.test(r))
    if (!cleanReels.length) {
      return NextResponse.json({ error: 'No valid reelRecordIds' }, { status: 400 })
    }
    // Whitelist workflow type. Default to Bedroom so the long-standing
    // ↓ Raw + ZIP callers keep their current behavior without changes.
    const workflowType = rawWorkflowType === 'Freelance' ? 'Freelance' : 'Bedroom'

    // Resolve creator AKA for the slug.
    const cRecs = await fetchAirtableRecords(PALM_CREATORS, {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorId)}`,
      fields: ['AKA'],
      maxRecords: 1,
    })
    if (!cRecs.length) return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    const aka = cRecs[0].fields?.AKA || 'Creator'

    // Find existing projects for this creator so we don't double-up.
    const existing = await fetchAirtableRecords(STAGE_B_OUTPUTS, {
      fields: ['Creator', 'Source Reel', 'Slug', 'Status'],
    })
    const existingByReel = new Map() // reelId -> existing record id
    for (const r of existing) {
      if (!(r.fields?.Creator || []).includes(creatorId)) continue
      const rid = (r.fields?.['Source Reel'] || [])[0]
      if (rid) existingByReel.set(rid, r.id)
    }

    const created = []
    const skipped = []
    for (const reelId of cleanReels) {
      if (existingByReel.has(reelId)) {
        skipped.push({ reelId, existingRecordId: existingByReel.get(reelId), reason: 'already started' })
        continue
      }
      // Compute the slug — sequential per creator. excludeRecordId is
      // irrelevant on creation; we read all existing records each time
      // so concurrent /start calls converge on distinct slugs.
      let slug = null, reelNum = null, stillNum = null
      try {
        const seq = await nextStageBSequence({ creatorId, reelRecordId: reelId })
        reelNum = seq.reelNum
        stillNum = seq.stillNum
        slug = stageBSlug({ aka, reelNum, stillNum })
      } catch (e) {
        console.warn('[stage-b/start] slug compute failed:', e.message)
      }

      const fields = {
        Creator: [creatorId],
        'Source Reel': [reelId],
        Status: 'Started',
        'Workflow Type': workflowType,
        ...(reelNum != null ? { 'Reel #': reelNum } : {}),
        ...(stillNum != null ? { 'Still #': stillNum } : {}),
        ...(slug ? { Slug: slug, Name: slug } : {}),
      }
      try {
        const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(STAGE_B_OUTPUTS)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields }], typecast: true }),
        })
        if (!res.ok) {
          console.warn('[stage-b/start] create failed:', await res.text())
          continue
        }
        const json = await res.json()
        const recId = json.records?.[0]?.id || null
        // Update local cache so the next reel in this batch doesn't
        // pick the same Reel # again (rare in the same loop iteration,
        // but matters for sequence integrity).
        if (recId) existingByReel.set(reelId, recId)
        created.push({ recordId: recId, slug, reelId, reelNum, stillNum })
      } catch (e) {
        console.warn(`[stage-b/start] create error for reel ${reelId}:`, e.message)
      }
    }

    return NextResponse.json({ ok: true, created, skipped })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
