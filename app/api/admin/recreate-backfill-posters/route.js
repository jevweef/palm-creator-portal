import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxThumbnailFromLink } from '@/lib/dropbox'
import { uploadVideoByUrl } from '@/lib/cloudflareStream'

export const maxDuration = 300

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const BATCH = 15

function rawDbx(url) {
  if (!url) return ''
  const clean = String(url).replace(/[?&]dl=0/, '').replace(/[?&]dl=1/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

// Re-runnable "optimize library": brings existing pool reels up to the
// fast-loading state — mirrors each to Cloudflare Stream (the real speed
// fix; the grid renders a CDN poster + Stream player off the UID) and
// attaches a Dropbox-generated poster as a fallback for the brief
// pre-transcode window. Needed on the dev preview because Vercel only
// runs the mirror-stream cron on production. Idempotent: skips reels
// already mirrored, so the UI loops it until remaining = 0.
export async function POST() {
  try {
    await requireAdmin()

    const all = await fetchAirtableRecords('Recreate Reels', {
      fields: ['Reel ID', 'Thumbnail', 'Dropbox Video Link', 'Stream UID'],
    })
    const pending = all.filter(
      r => r.fields?.['Dropbox Video Link'] &&
        (!r.fields?.['Stream UID'] || !(r.fields?.Thumbnail?.length))
    )

    if (pending.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0, done: true })
    }

    const accessToken = await getDropboxAccessToken()
    const batch = pending.slice(0, BATCH)
    let processed = 0

    for (const rec of batch) {
      const link = rec.fields['Dropbox Video Link']
      const shortcode = rec.fields['Reel ID'] || rec.id
      const updates = {}

      // 1. Cloudflare Stream mirror (the speed fix)
      if (!rec.fields['Stream UID']) {
        try {
          const { uid } = await uploadVideoByUrl(rawDbx(link), { airtableId: rec.id, kind: 'recreate-reels' })
          if (uid) updates['Stream UID'] = uid
        } catch (e) {
          console.warn(`[backfill] stream ${shortcode}: ${e.message}`)
        }
      }
      if (Object.keys(updates).length) {
        try {
          await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Recreate%20Reels/${rec.id}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: updates }),
          })
        } catch (e) {
          console.warn(`[backfill] patch ${shortcode}: ${e.message}`)
        }
      }

      // 2. Dropbox poster fallback (only if it has none yet)
      if (!(rec.fields?.Thumbnail?.length)) {
        try {
          const jpeg = await getDropboxThumbnailFromLink(accessToken, link, { size: 'w640h640' })
          if (jpeg) {
            await fetch(
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
          }
        } catch (e) {
          console.warn(`[backfill] poster ${shortcode}: ${e.message}`)
        }
      }

      processed++
    }

    return NextResponse.json({
      processed,
      remaining: Math.max(0, pending.length - processed),
      done: pending.length - processed <= 0,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
