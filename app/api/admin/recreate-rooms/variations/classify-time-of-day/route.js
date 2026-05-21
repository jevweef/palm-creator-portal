import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, OPS_BASE } from '@/lib/adminAuth'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VARS = 'Recreate Room Variations'
const CHOICES = ['Morning', 'Daytime', 'Golden Hour', 'Evening', 'Night']

// One-off backfill endpoint. Classifies the Time of Day of each
// Approved Recreate Room Variation that doesn't already have one,
// using Claude Sonnet vision. Processes up to ?limit= records per
// call (default 8) so a single request stays within the function
// timeout. Hit it repeatedly until { remaining: 0 } to backfill
// everything.
//
// Usage: POST /api/admin/recreate-rooms/variations/classify-time-of-day?limit=8
export async function POST(request) {
  try {
    await requireAdmin()
    const limit = Math.min(20, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '8', 10)))

    const rows = await fetchAirtableRecords(VARS, {
      fields: ['Variation', 'Status', 'Image', 'Dropbox Link', 'Time of Day'],
      filterByFormula: `AND({Status}='Approved', {Time of Day}='')`,
    })
    const targets = rows.slice(0, limit)
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, done: 0, remaining: 0, total: rows.length })
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const classify = async (imgUrl) => {
      const ir = await fetch(imgUrl)
      if (!ir.ok) throw new Error(`image fetch ${ir.status}`)
      const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64')
      const ct = ir.headers.get('content-type') || ''
      const m = ct.match(/^(image\/[a-z]+)/i)
      const mediaType = m ? m[1].toLowerCase().replace('image/jpg', 'image/jpeg') : 'image/jpeg'
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        tools: [{
          name: 'submit_time_of_day',
          description: 'Classify the time of day in this empty room photo.',
          input_schema: {
            type: 'object',
            properties: {
              time_of_day: {
                type: 'string',
                enum: CHOICES,
                description: 'Morning = soft cool light, early sun; Daytime = bright midday natural light through windows; Golden Hour = warm orange/pink sunset light; Evening = dim warm light after sunset, some lamps on; Night = dark, primarily artificial lighting from lamps.',
              },
            },
            required: ['time_of_day'],
          },
        }],
        tool_choice: { type: 'tool', name: 'submit_time_of_day' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: 'Classify the time of day in this room. Use submit_time_of_day.' },
          ],
        }],
      })
      const t = resp.content.find(b => b.type === 'tool_use')
      const v = t?.input?.time_of_day
      return CHOICES.includes(v) ? v : null
    }

    let done = 0, failed = 0
    const results = []
    for (const row of targets) {
      const f = row.fields || {}
      const att = f.Image
      const dbxLink = f['Dropbox Link']
      let imgUrl = ''
      if (Array.isArray(att) && att[0]) imgUrl = att[0].url
      if (!imgUrl && dbxLink) imgUrl = String(dbxLink).replace('dl=0', 'raw=1').replace('dl=1', 'raw=1')
      if (!imgUrl) { failed++; results.push({ id: row.id, error: 'no image' }); continue }
      try {
        const tod = await classify(imgUrl)
        if (!tod) { failed++; results.push({ id: row.id, error: 'no classification' }); continue }
        const upRes = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(VARS)}/${row.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { 'Time of Day': tod }, typecast: true }),
        })
        if (!upRes.ok) throw new Error(`patch ${upRes.status}`)
        done++
        results.push({ id: row.id, variation: f.Variation || '', timeOfDay: tod })
      } catch (e) {
        failed++
        results.push({ id: row.id, error: e.message })
      }
    }

    return NextResponse.json({
      ok: true,
      processed: targets.length,
      done,
      failed,
      remaining: Math.max(0, rows.length - done),
      results,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' && err.message ? err.message : String(err)
    console.error('[classify-time-of-day] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
