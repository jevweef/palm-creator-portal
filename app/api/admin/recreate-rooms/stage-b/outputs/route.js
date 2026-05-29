import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'
import { recreateImageUrl, toDropboxRaw } from '@/lib/recreateImageUrl'
import { quoteAirtableString } from '@/lib/airtableFormula'

const ASSETS = 'tblAPl8Pi5v1qmMNM'
const TASKS = 'tblXMh2UznOJMgxl6'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OUTPUTS = 'Stage B Outputs'
const REELS = 'Recreate Reels'
const ROOMS = 'Recreate Rooms'

// Legacy attachment-only helper, kept for the few fields that DON'T have
// Dropbox-path twins yet (the upload-artifact wrappers carry filename so
// we can't just use the URL). New consumers should use recreateImageUrl().
const att = a => (Array.isArray(a) && a[0] ? (a[0].thumbnails?.large?.url || a[0].url) : null)
const sel = v => (v?.name || v || null)

// GET ?creatorId= — Stage B results, newest first, joined with the
// source reel + room so the gallery can show provenance.
export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const creatorId = new URL(request.url).searchParams.get('creatorId')
    const [outputs, reels, rooms, outfitVariants] = await Promise.all([
      fetchAirtableRecords(OUTPUTS, {
        fields: ['Name', 'Creator', 'Source Reel', 'Room', 'Image', 'Dropbox Link', 'Dropbox Path',
          'Pose Time', 'Screenshot Framing', 'Room Framing', 'Time of Day', 'Status', 'Reject Reason',
          'Reel #', 'Still #', 'Slug', 'Uploaded At', 'Workflow Type',
          'Raw Screenshot', 'Upscaled Screenshot', 'TJP Output',
          'Raw Screenshot Path', 'Upscaled Screenshot Path', 'TJP Output Path'],
      }),
      fetchAirtableRecords(REELS, { fields: ['Reel ID', 'Reel URL', 'Source Handle', 'Stream UID', 'Thumbnail', 'Dropbox Video Link', 'Selected Outfits'] }),
      fetchAirtableRecords(ROOMS, { fields: ['Room Name'] }),
      fetchAirtableRecords('Outfit Swap Outputs', {
        fields: ['Stage B Parent', 'Variant #', 'Outfit', 'Image', 'Dropbox Link', 'Slug', 'Status'],
      }),
    ])
    // Group outfit variants under their parent so each Stage B card
    // knows how many fan-outs exist + their statuses.
    const variantsByParent = {}
    for (const v of outfitVariants) {
      const pid = (v.fields?.['Stage B Parent'] || [])[0]
      if (!pid) continue
      ;(variantsByParent[pid] ||= []).push({
        id: v.id,
        variantNum: v.fields?.['Variant #'] || null,
        slug: v.fields?.Slug || '',
        outfit: v.fields?.Outfit || '',
        // Dropbox-first per the canonical-source policy. recreateImageUrl
        // returns the raw Dropbox URL when Dropbox Link is set, falling
        // back to the legacy Airtable attachment only for old rows.
        image: recreateImageUrl(v.fields),
        dropbox: v.fields?.['Dropbox Link'] ? String(v.fields['Dropbox Link']).replace('dl=0', 'dl=1') : null,
        status: v.fields?.Status?.name || v.fields?.Status || 'Pending',
      })
    }
    for (const arr of Object.values(variantsByParent)) {
      arr.sort((a, b) => (a.variantNum || 0) - (b.variantNum || 0))
    }
    const reelById = Object.fromEntries(reels.map(r => [r.id, r.fields || {}]))
    const roomById = Object.fromEntries(rooms.map(r => [r.id, r.fields?.['Room Name'] || '']))

    // For outputs that already have an uploaded video, look up the matching
    // Asset (Asset Name = Slug) so the gallery card can swap the bedroom-
    // scene image for the actual uploaded video's CDN thumbnail. Single
    // batched filterByFormula query; falls back silently to the scene
    // image if the lookup fails or the Asset has no thumbnail yet.
    const rawLink = (s) => s ? String(s).split('\n')[0].replace(/([?&])dl=[01]/, '$1raw=1') : null
    const uploadedSlugs = [...new Set(
      outputs
        .filter(o => o.fields?.['Uploaded At'] && o.fields?.Slug)
        .map(o => o.fields.Slug)
    )]
    const slugToUploadedThumb = {}
    // Admin's review status for each submitted video, keyed by slug. Lets
    // the editor surface tell apart "submitted, admin still reviewing" from
    // "admin approved → truly done." A scene is only Completed (from the
    // editor's perspective) once this is 'Approved'. Falls back to null
    // when the task hasn't been reviewed yet or the lookup fails.
    const slugToAdminReview = {}
    // Every uploaded variation per project, keyed by parent slug. A freelance
    // project gets ONE Stage B Output but the editor can submit several AI
    // videos against it — each becomes its own Asset named "{slug}_O{nn}".
    // The card renders one carousel slide per entry here (with a per-upload
    // Remove button driven by taskId + reviewStatus).
    const uploadsBySlug = {}
    if (uploadedSlugs.length > 0) {
      try {
        // Match by PREFIX so a project's slug catches both a bare upload
        // (Amelia_R046_S01) and every variation (Amelia_R046_S01_O01, _O02…).
        // FIND(slug, name)=1 ⇒ the asset/task name starts with slug.
        const assetFormula = `OR(${uploadedSlugs.map(s => `FIND(${quoteAirtableString(s)}, {Asset Name})=1`).join(',')})`
        const taskFormula = `OR(${uploadedSlugs.map(s => `FIND(${quoteAirtableString('AI Review: ' + s)}, {Name})=1`).join(',')})`
        const [assets, tasks] = await Promise.all([
          fetchAirtableRecords(ASSETS, {
            fields: ['Asset Name', 'CDN URL', 'Thumbnail', 'Dropbox Shared Link', 'Source Type', 'Pipeline Status'],
            filterByFormula: assetFormula,
          }),
          fetchAirtableRecords(TASKS, {
            fields: ['Name', 'Admin Review Status'],
            filterByFormula: taskFormula,
          }),
        ])
        // Review status + task id keyed by the asset NAME the task reviews
        // (tasks are named "AI Review: {assetName}" per the upload route).
        const taskByAssetName = {}
        for (const t of tasks) {
          const nm = t.fields?.Name || ''
          const an = nm.startsWith('AI Review: ') ? nm.slice('AI Review: '.length) : null
          if (an) taskByAssetName[an] = { taskId: t.id, reviewStatus: sel(t.fields?.['Admin Review Status']) }
        }
        // Longest slug first so a variation maps to its true parent.
        const slugsByLen = [...uploadedSlugs].sort((a, b) => b.length - a.length)
        for (const a of assets) {
          const name = a.fields?.['Asset Name']
          if (!name) continue
          if (a.fields?.['Source Type'] !== 'AI Generated') continue
          if (sel(a.fields?.['Pipeline Status']) === 'Discarded') continue
          const parent = slugsByLen.find(s => name === s || name.startsWith(s + '_O'))
          if (!parent) continue
          const cdn = a.fields?.['CDN URL']
          const thumb = att(a.fields?.Thumbnail)
          const t = taskByAssetName[name] || {}
          ;(uploadsBySlug[parent] ||= []).push({
            assetId: a.id,
            taskId: t.taskId || null,
            name,
            video: rawLink(a.fields?.['Dropbox Shared Link']),
            thumbnail: cdn || thumb || null,
            reviewStatus: t.reviewStatus || null,
          })
          // Back-compat: first upload feeds the scene's single thumb/status.
          if (!(parent in slugToUploadedThumb) && (cdn || thumb)) slugToUploadedThumb[parent] = cdn || thumb
          if (!(parent in slugToAdminReview) && t.reviewStatus) slugToAdminReview[parent] = t.reviewStatus
        }
        // Stable order: bare first, then _O01, _O02…
        for (const k of Object.keys(uploadsBySlug)) {
          uploadsBySlug[k].sort((x, y) => x.name.localeCompare(y.name))
        }
      } catch (e) {
        console.warn('[stage-b outputs] uploaded asset/task lookup failed:', e.message)
      }
    }
    // 1-based index per creator, oldest = 1 (stable label that matches
    // the ZIP filename).
    const idxById = {}
    const byCreator = {}
    for (const o of outputs) {
      const cid = (o.fields?.Creator || [])[0] || '_'
      ;(byCreator[cid] ||= []).push(o)
    }
    for (const cid of Object.keys(byCreator)) {
      byCreator[cid]
        .sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || ''))
        .forEach((o, i) => { idxById[o.id] = i + 1 })
    }
    // Bedroom scenes — what Stage B Outputs become for the editor's
    // Projects tab. Custom Edit submissions (uploaded via Direct Upload
    // with no slug) are emitted below as synthetic scenes alongside
    // these, so editors can see both workflows in one list.
    const bedroomList = outputs
      .filter(o => !creatorId || (o.fields?.Creator || []).includes(creatorId))
      .map(o => {
        const f = o.fields || {}
        const reelId = (f['Source Reel'] || [])[0]
        const reel = reelId ? reelById[reelId] : null
        const roomId = (f.Room || [])[0]
        return {
          id: o.id,
          index: idxById[o.id] || null,
          name: f.Name || '',
          slug: f.Slug || '',
          reelNum: f['Reel #'] || null,
          stillNum: f['Still #'] || null,
          dropboxPath: f['Dropbox Path'] || '',
          // Dropbox-first; attachment fallback is transitional until Phase 4.
          image: recreateImageUrl(f),
          dropbox: f['Dropbox Link'] ? String(f['Dropbox Link']).replace('dl=0', 'dl=1') : null,
          poseTime: f['Pose Time'] ?? null,
          screenshotFraming: sel(f['Screenshot Framing']),
          roomFraming: sel(f['Room Framing']),
          timeOfDay: sel(f['Time of Day']),
          status: sel(f.Status) || 'Pending',
          rejectReason: f['Reject Reason'] || '',
          uploadedAt: f['Uploaded At'] || null,
          // CDN URL of the uploaded video's first-frame thumbnail (only
          // populated once the editor has uploaded a finished video for
          // this slug). Gallery card prefers this over the scene image
          // so editors see what they actually shipped, not the bedroom
          // scene generation that preceded it.
          uploadedThumbnail: (f['Uploaded At'] && f.Slug) ? (slugToUploadedThumb[f.Slug] || null) : null,
          // Admin's review status on the submitted video, null until the
          // editor uploads (or the lookup misses). Editor's perspective:
          // 'Pending Review' = submitted, admin hasn't decided.
          // 'Approved' = truly done.
          // 'Rejected' = needs revision (already surfaces in /revisions).
          adminReviewStatus: (f['Uploaded At'] && f.Slug) ? (slugToAdminReview[f.Slug] || null) : null,
          // Every AI video the editor submitted against this project (bare +
          // _O variations), each with its own video/thumb/review status and
          // the taskId the card needs to offer a per-upload Remove button.
          uploadedVariations: (f['Uploaded At'] && f.Slug) ? (uploadsBySlug[f.Slug] || []) : [],
          room: roomId ? roomById[roomId] || '' : '',
          reel: reel ? {
            id: reelId,
            reelId: reel['Reel ID'] || '',
            url: reel['Reel URL'] || '',
            handle: reel['Source Handle'] || '',
            streamUid: reel['Stream UID'] || null,
            thumbnail: Array.isArray(reel.Thumbnail) && reel.Thumbnail[0] ? (reel.Thumbnail[0].thumbnails?.large?.url || reel.Thumbnail[0].url) : null,
            video: (reel['Dropbox Video Link'] || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1'),
            selectedOutfits: Array.isArray(reel['Selected Outfits']) ? reel['Selected Outfits'] : [],
          } : null,
          variants: variantsByParent[o.id] || [],
          // Eager-uploaded artifacts. The panel restores its file slots
          // from these on mount so refreshing mid-flow doesn't lose work.
          // Preview URL preference: legacy attachment (if still present)
          // → in-app Dropbox proxy (works for authenticated admin views,
          // which is the only context where this UI renders). These
          // sub-fields don't have their own Dropbox Link columns, just
          // paths, so the proxy is the only public-ish fallback.
          uploads: (() => {
            const proxyUrl = (path) => path ? `/api/admin/photos/image?path=${encodeURIComponent(path)}` : null
            return {
              rawScreenshot: f['Raw Screenshot Path'] ? {
                path: f['Raw Screenshot Path'],
                url: att(f['Raw Screenshot']) || proxyUrl(f['Raw Screenshot Path']),
                filename: f['Raw Screenshot']?.[0]?.filename || '',
              } : null,
              upscaledScreenshot: f['Upscaled Screenshot Path'] ? {
                path: f['Upscaled Screenshot Path'],
                url: att(f['Upscaled Screenshot']) || proxyUrl(f['Upscaled Screenshot Path']),
                filename: f['Upscaled Screenshot']?.[0]?.filename || '',
              } : null,
              tjpOutput: f['TJP Output Path'] ? {
                path: f['TJP Output Path'],
                url: att(f['TJP Output']) || proxyUrl(f['TJP Output Path']),
                filename: f['TJP Output']?.[0]?.filename || '',
              } : null,
            }
          })(),
          source: 'bedroom',
          // Project workflow type. Drives the project-card CTA:
          //   'Bedroom'   → existing Continue → upload TJP photo flow
          //   'Freelance' → ↑ Upload final reels modal (no portal scene step)
          // Defaults to 'Bedroom' when the field is unset so older records
          // render exactly as they did before the field existed.
          workflowType: sel(f['Workflow Type']) || 'Bedroom',
          createdTime: o.createdTime,
        }
      })

    // ── Custom Edit projects ──────────────────────────────────────────
    // The Direct Upload path in the New Project modal creates an Asset +
    // Task per uploaded video but no Stage B Output (no Bedroom scene
    // backing). Without this block the editor's Projects tab couldn't
    // see anything they submitted via Custom Edit until admin rejected
    // it. We surface those Tasks as synthetic scenes with
    // `source: 'custom-edit'`, joined back to a source reel via the
    // Asset's Reference Source URL.
    //
    // Slug-collision rule: a Task whose name parses to a slug that
    // ALREADY appears as a Stage B Output's Slug is skipped — those are
    // Bedroom uploads (the Asset+Task is the receipt; the Stage B Output
    // is the canonical project record).
    const bedroomSlugs = new Set(
      outputs
        .filter(o => o.fields?.Slug && (!creatorId || (o.fields?.Creator || []).includes(creatorId)))
        .map(o => o.fields.Slug)
    )

    let customList = []
    if (creatorId) {
      try {
        // Filter: AI Generated tasks for this creator that have an Asset
        // attached. The creator linked record stores an array of record
        // IDs; FIND() against the comma-joined string is the cheapest
        // formula-side check.
        const taskFormula = `AND({Source Type}='AI Generated', FIND(${quoteAirtableString(creatorId)}, ARRAYJOIN({Creator}))>0)`
        const aiTasks = await fetchAirtableRecords(TASKS, {
          fields: ['Name', 'Status', 'Admin Review Status', 'Admin Feedback', 'Completed At', 'Asset', 'Creator'],
          filterByFormula: taskFormula,
        })

        // Collect linked Asset IDs (each Task has exactly one Asset per
        // the upload finalize route — line 184). Batch-fetch them so
        // we can read CDN URL, Dropbox link, Reference Source URL for
        // each.
        const assetIds = [...new Set(
          aiTasks
            .map(t => (t.fields?.Asset || [])[0])
            .filter(Boolean)
        )]
        let assetById = {}
        if (assetIds.length > 0) {
          // Fetch in chunks of 100 to keep filterByFormula sane.
          const chunks = []
          for (let i = 0; i < assetIds.length; i += 100) chunks.push(assetIds.slice(i, i + 100))
          const all = await Promise.all(chunks.map(c => {
            const formula = `OR(${c.map(id => `RECORD_ID()=${quoteAirtableString(id)}`).join(',')})`
            return fetchAirtableRecords(ASSETS, {
              fields: ['Asset Name', 'CDN URL', 'Thumbnail', 'Dropbox Shared Link', 'Reference Source URL'],
              filterByFormula: formula,
            })
          }))
          for (const batch of all) {
            for (const a of batch) assetById[a.id] = a.fields || {}
          }
        }

        // Index reels by Reel URL so we can join Custom Edit Tasks back
        // to their source reel (Asset.Reference Source URL == Reel.Reel
        // URL by convention).
        const reelByUrl = {}
        for (const r of reels) {
          const url = r.fields?.['Reel URL']
          if (url) reelByUrl[url] = { id: r.id, fields: r.fields }
        }

        customList = aiTasks
          .map(t => {
            const tf = t.fields || {}
            const assetId = (tf.Asset || [])[0]
            const af = assetId ? assetById[assetId] : null
            if (!af) return null  // task without an asset — skip, can't show usefully

            // Parse slug out of "AI Review: <slug>" or "AI Review: @<handle> <reelId>".
            const taskName = tf.Name || ''
            const slug = taskName.startsWith('AI Review: ')
              ? taskName.slice('AI Review: '.length)
              : ''
            if (slug && bedroomSlugs.has(slug)) return null  // Bedroom upload — already represented by its Stage B Output

            const adminReview = tf['Admin Review Status']?.name || tf['Admin Review Status'] || null
            // Mimic Stage B Output's Status field so the frontend's existing
            // sceneStep can handle it once we add the source-aware branch.
            //   Pending Review → Approved (the variation-approval; sceneStep
            //     uses uploadedAt+adminReviewStatus to derive awaiting-admin)
            //   Approved → Approved (sceneStep flips to 'complete' from
            //     adminReviewStatus)
            //   Needs Revision → Rejected (matches the Bedroom flow's
            //     rejected state)
            const mimicStatus = adminReview === 'Needs Revision' ? 'Rejected' : 'Approved'

            const sourceUrl = af['Reference Source URL'] || ''
            const matchedReel = sourceUrl ? reelByUrl[sourceUrl] : null
            const reelObj = matchedReel ? {
              id: matchedReel.id,
              reelId: matchedReel.fields['Reel ID'] || '',
              url: matchedReel.fields['Reel URL'] || sourceUrl,
              handle: matchedReel.fields['Source Handle'] || '',
              streamUid: matchedReel.fields['Stream UID'] || null,
              thumbnail: Array.isArray(matchedReel.fields.Thumbnail) && matchedReel.fields.Thumbnail[0]
                ? (matchedReel.fields.Thumbnail[0].thumbnails?.large?.url || matchedReel.fields.Thumbnail[0].url)
                : null,
              video: (matchedReel.fields['Dropbox Video Link'] || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1'),
              selectedOutfits: Array.isArray(matchedReel.fields['Selected Outfits']) ? matchedReel.fields['Selected Outfits'] : [],
            } : (sourceUrl ? {
              // Fallback when the Recreate Reel record doesn't exist for
              // this source URL — usually means the editor submitted a
              // Custom Edit on a reel that was never imported as inspo.
              // ID is keyed off the source URL (not the Asset ID) so
              // multiple Custom Edit submissions on the same untracked
              // reel cluster into one card on the editor's Projects tab.
              id: `__url_${sourceUrl}`,
              reelId: '',
              url: sourceUrl,
              handle: (sourceUrl.match(/instagram\.com\/([^/?]+)/) || [])[1] || '',
              streamUid: null,
              thumbnail: null,
              video: '',
              selectedOutfits: [],
            } : null)

            const cdn = af['CDN URL'] || att(af.Thumbnail) || null
            return {
              id: t.id,
              source: 'custom-edit',
              slug,
              name: taskName,
              status: mimicStatus,
              uploadedAt: tf['Completed At'] || t.createdTime || null,
              adminReviewStatus: adminReview,
              image: cdn,
              uploadedThumbnail: cdn,
              dropbox: af['Dropbox Shared Link']
                ? String(af['Dropbox Shared Link']).replace('dl=0', 'dl=1')
                : null,
              rejectReason: tf['Admin Feedback'] || '',
              reel: reelObj,
              // Bedroom-specific fields kept empty so the frontend's
              // existing renderers don't choke on undefined access.
              reelNum: null,
              stillNum: null,
              dropboxPath: '',
              poseTime: null,
              screenshotFraming: null,
              roomFraming: null,
              timeOfDay: null,
              room: '',
              variants: [],
              uploads: { rawScreenshot: null, upscaledScreenshot: null, tjpOutput: null },
              createdTime: t.createdTime,
            }
          })
          .filter(Boolean)
      } catch (e) {
        console.warn('[stage-b outputs] custom-edit fetch failed:', e.message)
      }
    }

    const list = [...bedroomList, ...customList]
      .sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
    return NextResponse.json({ outputs: list })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH { id, status, reason? } — approve / reject (reason kept as a
// tuning signal, never deleted).
export async function PATCH(request) {
  try {
    await requireAdminOrAiEditor()
    const { id, status, reason } = await request.json()
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return NextResponse.json({ error: 'status must be Pending|Approved|Rejected' }, { status: 400 })
    }
    await patchAirtableRecord(OUTPUTS, id, {
      Status: status,
      ...(status === 'Rejected' && reason ? { 'Reject Reason': reason } : {}),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE ?id= — remove a Stage B output record (Airtable only;
// Dropbox copy left in place, cheap and useful as a tuning archive).
// ai_editor allowed: their workflow includes deleting their own
// rejected/unwanted generations as a normal step (the 🗑 button on
// scene cards). Gating to admin-only made that button silently 403
// for editor users.
export async function DELETE(request) {
  try {
    await requireAdminOrAiEditor()
    const id = new URL(request.url).searchParams.get('id')
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
    }
    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(OUTPUTS)}/${id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
