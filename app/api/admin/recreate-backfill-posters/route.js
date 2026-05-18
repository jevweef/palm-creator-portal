import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxThumbnailFromLink } from '@/lib/dropbox'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BATCH = 20

// One-off / re-runnable: attach a poster to Recreate Reels rows that
// don't have one (reels scraped before the ffmpeg-poster change, where
// the IG thumbnail URL 403'd). Uses Dropbox's own video thumbnail API —
// no mp4 re-download, no ffmpeg. Idempotent: skips rows that already
// have a Thumbnail, so the UI can loop it until remaining = 0.
export async function POST() {
  try {
    await requireAdmin()

    const all = await fetchAirtableRecords('Recreate Reels', {
      fields: ['Reel ID', 'Thumbnail', 'Dropbox Video Link'],
    })
    const missing = all.filter(
      r => !(r.fields?.Thumbnail?.length) && r.fields?.['Dropbox Video Link']
    )

    if (missing.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0, done: true })
    }

    const accessToken = await getDropboxAccessToken()
    const batch = missing.slice(0, BATCH)
    let processed = 0

    for (const rec of batch) {
      const link = rec.fields['Dropbox Video Link']
      const shortcode = rec.fields['Reel ID'] || rec.id
      try {
        const jpeg = await getDropboxThumbnailFromLink(accessToken, link, { size: 'w640h640' })
        if (!jpeg) continue
        const res = await fetch(
          `https://content.airtable.com/v0/${OPS_BASE}/${rec.id}/Thumbnail/uploadAttachment`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contentType: 'image/jpeg',
              filename: `${shortcode}.jpg`,
              file: Buffer.from(jpeg).toString('base64'),
            }),
          }
        )
        if (res.ok) processed++
        else console.warn(`[backfill-posters] attach failed ${shortcode}: ${res.status}`)
      } catch (e) {
        console.warn(`[backfill-posters] ${shortcode}: ${e.message}`)
      }
    }

    return NextResponse.json({
      processed,
      remaining: Math.max(0, missing.length - processed),
      done: missing.length - processed <= 0,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
