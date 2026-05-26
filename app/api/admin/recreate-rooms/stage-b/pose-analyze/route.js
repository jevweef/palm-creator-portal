import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const maxDuration = 30

const PHOTOS_TABLE = 'Photos'

// Pose-mechanics analyzer. Given an image URL (a photo from the Pinterest
// library, usually a pose reference the editor wants to recreate), ask
// Claude to describe ONLY the pose — body position, weight distribution,
// arm/leg/torso/head positions, facial expression. Identity, clothing,
// environment are explicitly excluded so the output is a clean directive
// the Wan 2.7 alt-pose route can drop straight into its prompt as the
// `poseDirection` field.
//
// Output is a single paragraph (50-120 words) optimized for diffusion-
// model interpretation: directional language, specific limb positions,
// avoid abstract qualifiers like "confident" without anchoring them to a
// physical mechanic. Mirrors the flatlay route's describeGarment pattern.
async function analyzePose(imageUrl) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
  if (!imageUrl) throw new Error('imageUrl required')

  const ir = await fetch(imageUrl)
  if (!ir.ok) throw new Error(`Could not fetch source image: HTTP ${ir.status}`)
  const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64')
  const ct = ir.headers.get('content-type') || ''
  const mediaType = (ct.match(/^(image\/[a-z]+)/i)?.[1] || 'image/jpeg').toLowerCase().replace('image/jpg', 'image/jpeg')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text:
            'Describe the POSE of the person in this image, for an image-generation model that will recreate the same pose on a DIFFERENT subject in a DIFFERENT outfit in a DIFFERENT room.\n\n'

          + 'Cover these mechanics, in this order:\n'
          + '• Body position — standing, sitting, leaning, kneeling, lying. If standing: weight on which hip? Feet positioning (parallel, one in front, crossed)?\n'
          + '• Torso angle — squared to camera, angled off-axis (estimate degrees), turned away. Chest direction.\n'
          + '• Arm positions — describe EACH arm separately. Where each hand is (waist, hip, hair, behind back, raised, at side). What each arm is doing (relaxed, bent at elbow, resting on furniture, gesture).\n'
          + '• Leg positions — straight, bent at knee, crossed, one leg forward. Visible from where to where (mid-thigh, knee, mid-calf, ankle, feet).\n'
          + '• Head — direction (toward camera, profile, three-quarter, looking up/down). Chin angle.\n'
          + '• Gaze — eyes on camera, looking off-frame, eyes closed.\n'
          + '• Facial expression — neutral, smiling (subtle / wide), lips parted, biting lip, pouting. Be specific.\n'
          + '• Framing implied by the pose — full body, three-quarter (cropped at thigh/knee), waist-up, close. Mention if the pose REQUIRES the legs to be visible.\n\n'

          + 'RULES:\n'
          + '• Use directional language ("right hand at right hip", "torso angled 15° to camera-left", "left knee slightly bent").\n'
          + '• Refer to the person as "she" / "her" — the target subject is female.\n'
          + '• DO NOT describe: clothing, hair, skin, facial features, the environment, lighting, mood/vibe words, identity.\n'
          + '• DO NOT say things like "confident" or "sexy" or "elegant" without anchoring them to a physical mechanic.\n'
          + '• Return ONE paragraph, 60-120 words. No preamble, no bullet list, no header. Plain prose, ready to drop into another prompt as a directive.'
        },
      ],
    }],
  })

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  if (!text) throw new Error('Claude returned empty pose description')
  return text
}

// POST { photoId? | imageUrl? } — analyze a photo's pose, return the
// description text. Editor picks a photo from the library (usually a
// Pinterest-source carousel image), server hits Claude vision, response
// gets dropped into the alt-pose modal's pose-direction textarea.
//
// Accepts either:
//   - photoId: Airtable Photos record ID (we look up the best image URL)
//   - imageUrl: arbitrary URL (escape hatch for testing / future use)
export async function POST(request) {
  try {
    await requireAdminOrAiEditor()
    const body = await request.json()
    const photoId = String(body.photoId || '').trim()
    const rawUrl = String(body.imageUrl || '').trim()

    let imageUrl = rawUrl
    let photoName = ''
    if (!imageUrl) {
      if (!photoId || !/^rec[A-Za-z0-9]{14}$/.test(photoId)) {
        return NextResponse.json({ error: 'Provide photoId or imageUrl' }, { status: 400 })
      }
      // Prefer the original CDN URL — Claude vision works on the actual
      // photo, not the flatlay derivative. (Flatlay is a clothes-only
      // shot — no pose to analyze.) Fall back to Image attachment.
      const rows = await fetchAirtableRecords(PHOTOS_TABLE, {
        fields: ['Name', 'CDN URL', 'Image'],
        filterByFormula: `RECORD_ID() = ${quoteAirtableString(photoId)}`,
      })
      if (!rows.length) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
      const f = rows[0].fields || {}
      imageUrl = f['CDN URL'] || f.Image?.[0]?.url || ''
      photoName = f.Name || ''
      if (!imageUrl) return NextResponse.json({ error: 'Photo has no CDN URL or image attachment' }, { status: 400 })
    }

    const poseDescription = await analyzePose(imageUrl)
    console.log(`[pose-analyze] ${photoId || '(url)'} ${photoName.slice(0, 40)} → ${poseDescription.length} chars`)
    return NextResponse.json({
      ok: true,
      poseDescription,
      imageUrl,
      photoName,
    })
  } catch (err) {
    if (err instanceof Response) return err
    const msg = typeof err?.message === 'string' ? err.message : String(err)
    console.error('[pose-analyze] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
