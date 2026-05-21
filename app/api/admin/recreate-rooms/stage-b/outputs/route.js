import { NextResponse } from 'next/server'
import { requireAdmin, requireAdminOrAiEditor, fetchAirtableRecords, patchAirtableRecord, OPS_BASE } from '@/lib/adminAuth'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OUTPUTS = 'Stage B Outputs'
const REELS = 'Recreate Reels'
const ROOMS = 'Recreate Rooms'

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
          'Pose Time', 'Screenshot Framing', 'Room Framing', 'Status', 'Reject Reason',
          'Reel #', 'Still #', 'Slug'],
      }),
      fetchAirtableRecords(REELS, { fields: ['Reel ID', 'Reel URL', 'Source Handle', 'Stream UID', 'Thumbnail', 'Dropbox Video Link'] }),
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
        image: v.fields?.Image?.[0]?.thumbnails?.large?.url || v.fields?.Image?.[0]?.url || null,
        dropbox: v.fields?.['Dropbox Link'] ? String(v.fields['Dropbox Link']).replace('dl=0', 'dl=1') : null,
        status: v.fields?.Status?.name || v.fields?.Status || 'Pending',
      })
    }
    for (const arr of Object.values(variantsByParent)) {
      arr.sort((a, b) => (a.variantNum || 0) - (b.variantNum || 0))
    }
    const reelById = Object.fromEntries(reels.map(r => [r.id, r.fields || {}]))
    const roomById = Object.fromEntries(rooms.map(r => [r.id, r.fields?.['Room Name'] || '']))
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
    const list = outputs
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
          image: att(f.Image),
          dropbox: f['Dropbox Link'] ? String(f['Dropbox Link']).replace('dl=0', 'dl=1') : null,
          poseTime: f['Pose Time'] ?? null,
          screenshotFraming: sel(f['Screenshot Framing']),
          roomFraming: sel(f['Room Framing']),
          status: sel(f.Status) || 'Pending',
          rejectReason: f['Reject Reason'] || '',
          room: roomId ? roomById[roomId] || '' : '',
          reel: reel ? {
            id: reelId,
            reelId: reel['Reel ID'] || '',
            url: reel['Reel URL'] || '',
            handle: reel['Source Handle'] || '',
            streamUid: reel['Stream UID'] || null,
            thumbnail: Array.isArray(reel.Thumbnail) && reel.Thumbnail[0] ? (reel.Thumbnail[0].thumbnails?.large?.url || reel.Thumbnail[0].url) : null,
            video: (reel['Dropbox Video Link'] || '').replace('dl=0', 'raw=1').replace('dl=1', 'raw=1'),
          } : null,
          variants: variantsByParent[o.id] || [],
          createdTime: o.createdTime,
        }
      })
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
export async function DELETE(request) {
  try {
    await requireAdmin()
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
