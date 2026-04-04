import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, airtableHeaders, OPS_BASE } from '@/lib/adminAuth'
import OpenAI from 'openai'

export const maxDuration = 60

const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const TAG_WEIGHTS_TABLE = 'tbljiwFQBknbUCpc6'
const ANALYSIS_MODEL = 'gpt-5.4-mini'

const TAG_TO_CATEGORY = {
  'Beach Girl': 'Setting / Location', 'Car Content': 'Setting / Location', 'City Girl': 'Setting / Location',
  'Domestic / At-Home': 'Setting / Location', 'Kitchen / Food Content': 'Setting / Location',
  'Luxury / Elevated Lifestyle': 'Setting / Location', 'Mirror Moment': 'Setting / Location',
  'Nature / Outdoors': 'Setting / Location',
  'Artsy / Creative': 'Persona / Niche', 'Bikini / Swim': 'Persona / Niche',
  'Bookish / Smart Girl': 'Persona / Niche', 'Fitness / Gym': 'Persona / Niche',
  'Girl Next Door': 'Persona / Niche', 'Glam / Beauty': 'Persona / Niche',
  'Musician / Singer': 'Persona / Niche', 'Tattoos': 'Persona / Niche',
  'Travel / Adventure': 'Persona / Niche', 'Sports': 'Persona / Niche', 'Wellness': 'Persona / Niche',
  'Bratty / Mischievous': 'Tone / Energy', 'Cute / Sweet Vibe': 'Tone / Energy',
  'Direct Flirt': 'Tone / Energy', 'Dominant Energy': 'Tone / Energy', 'Funny': 'Tone / Energy',
  'Lifestyle Casual': 'Tone / Energy', 'Playful Personality': 'Tone / Energy',
  'Soft Tease': 'Tone / Energy', 'Submissive / Shy Energy': 'Tone / Energy',
  'Toxic': 'Tone / Energy', 'Wifey': 'Tone / Energy', 'Young': 'Tone / Energy',
  'Body Focus': 'Visual / Body', 'Boobs': 'Visual / Body', 'Booty': 'Visual / Body',
  'Dance': 'Visual / Body', 'Face Card / Pretty Girl': 'Visual / Body',
  'Foot Fetish': 'Visual / Body', 'Lingerie / Sleepwear': 'Visual / Body',
  'Outfit Showcase': 'Visual / Body', 'Suggestive Movement': 'Visual / Body',
  'Thirst Trap': 'Visual / Body',
  'Eye Contact Driven': 'Viewer Experience', 'Implied Scenario': 'Viewer Experience',
  'Personal Attention': 'Viewer Experience', 'POV': 'Viewer Experience', 'Roleplay': 'Viewer Experience',
  'Selfie': 'Film Format', 'Tripod/Static': 'Film Format', 'Filmed By Someone Else': 'Film Format',
  'Lip Sync': 'Film Format', 'Talking to Camera': 'Film Format', 'Mirror': 'Film Format',
  '2 or more people': 'Film Format', 'Voice Behind the Camera': 'Film Format',
}

async function patchCreator(creatorId, fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorId}`,
    {
      method: 'PATCH',
      headers: airtableHeaders,
      body: JSON.stringify({ fields }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable PATCH creator ${res.status}: ${text}`)
  }
  return res.json()
}

async function upsertTagWeights(creatorId, tagWeights) {
  const allWeights = await fetchAirtableRecords('Creator Tag Weights', {})
  const existing = allWeights.filter(r =>
    (r.fields['Creator'] || []).some(c => (c.id || c) === creatorId)
  )
  const existingByTag = {}
  existing.forEach(r => { existingByTag[r.fields['Tag']] = r.id })

  const today = new Date().toISOString().split('T')[0]
  const toCreate = []
  const toUpdate = []

  for (const [tag, weight] of Object.entries(tagWeights)) {
    const fields = {
      'Weight': Math.round(Number(weight)),
      'Tag Category': TAG_TO_CATEGORY[tag] || '',
      'Last Updated': today,
    }
    if (existingByTag[tag]) {
      toUpdate.push({ id: existingByTag[tag], fields })
    } else {
      toCreate.push({ fields: { ...fields, 'Tag': tag, 'Creator': [creatorId] } })
    }
  }

  for (let i = 0; i < toCreate.length; i += 10) {
    const chunk = toCreate.slice(i, i + 10)
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Creator%20Tag%20Weights`,
      { method: 'POST', headers: airtableHeaders, body: JSON.stringify({ records: chunk, typecast: true }) }
    )
    if (!res.ok) throw new Error(`Tag weights create ${res.status}: ${await res.text()}`)
  }

  for (let i = 0; i < toUpdate.length; i += 10) {
    const chunk = toUpdate.slice(i, i + 10)
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Creator%20Tag%20Weights`,
      { method: 'PATCH', headers: airtableHeaders, body: JSON.stringify({ records: chunk, typecast: true }) }
    )
    if (!res.ok) throw new Error(`Tag weights update ${res.status}: ${await res.text()}`)
  }
}

// POST /api/admin/creator-profile/refine
// Body: { creatorId, feedback }
// Adjusts the existing profile based on admin feedback without re-processing documents
export async function POST(request) {
  try {
    await requireAdmin()

    const { creatorId, feedback } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'creatorId is required' }, { status: 400 })
    if (!feedback?.trim()) return NextResponse.json({ error: 'feedback is required' }, { status: 400 })

    // Mark as analyzing
    await patchCreator(creatorId, { 'Profile Analysis Status': 'Analyzing' })

    // Fetch current profile
    const creatorRes = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorId}`,
      { headers: airtableHeaders }
    )
    if (!creatorRes.ok) throw new Error('Creator not found')
    const creatorData = await creatorRes.json()
    const f = creatorData.fields || {}

    const currentProfile = {
      profileSummary: f['Profile Summary'] || '',
      brandVoiceNotes: f['Brand Voice Notes'] || '',
      contentDirectionNotes: f['Content Direction Notes'] || '',
      dosDonts: f['Dos and Donts'] || '',
    }

    // Fetch current tag weights
    const allWeights = await fetchAirtableRecords('Creator Tag Weights', {})
    const creatorWeights = allWeights.filter(r =>
      (r.fields['Creator'] || []).some(c => (c.id || c) === creatorId)
    )
    const currentTagWeights = {}
    const currentFilmFormatWeights = {}
    creatorWeights.forEach(r => {
      const tag = r.fields['Tag']
      const weight = r.fields['Weight'] ?? 0
      const cat = r.fields['Tag Category'] || TAG_TO_CATEGORY[tag] || ''
      if (cat === 'Film Format') {
        currentFilmFormatWeights[tag] = weight
      } else {
        currentTagWeights[tag] = weight
      }
    })

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const response = await openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are refining an existing creator profile for an OnlyFans management agency based on admin feedback.

You will receive:
1. The CURRENT profile (summary, brand voice, content direction, dos/donts)
2. The CURRENT tag weights (0-100 scale)
3. Admin feedback describing what to adjust

Your job: adjust the profile and tag weights based on the feedback. Do NOT start from scratch. Preserve everything that isn't contradicted by the feedback. Make targeted adjustments only.

Tag weight scoring: 0 = irrelevant, 1-30 = low, 31-60 = moderate, 61-80 = strong, 81-100 = core identity.

Respond ONLY with valid JSON matching this exact schema:
{
  "profile_summary": "...",
  "brand_voice_notes": "...",
  "content_direction_notes": "...",
  "do_dont_notes": "...",
  "tag_weights": { "Tag Name": 0, ... },
  "film_format_weights": { "Tag Name": 0, ... },
  "changes_made": "1-3 sentence summary of what you adjusted and why"
}`
        },
        {
          role: 'user',
          content: `CURRENT PROFILE:
Profile Summary: ${currentProfile.profileSummary}

Brand Voice Notes: ${currentProfile.brandVoiceNotes}

Content Direction Notes: ${currentProfile.contentDirectionNotes}

Dos and Donts: ${currentProfile.dosDonts}

CURRENT TAG WEIGHTS:
${JSON.stringify(currentTagWeights, null, 2)}

CURRENT FILM FORMAT WEIGHTS:
${JSON.stringify(currentFilmFormatWeights, null, 2)}

ADMIN FEEDBACK:
${feedback}`
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    })

    const result = JSON.parse(response.choices[0].message.content)

    const dosDonts = Array.isArray(result.do_dont_notes)
      ? result.do_dont_notes.join('\n')
      : (result.do_dont_notes || '')

    // Write updated profile + save feedback to Airtable
    const today = new Date().toISOString().split('T')[0]
    await patchCreator(creatorId, {
      'Profile Summary': result.profile_summary || currentProfile.profileSummary,
      'Brand Voice Notes': result.brand_voice_notes || currentProfile.brandVoiceNotes,
      'Content Direction Notes': result.content_direction_notes || currentProfile.contentDirectionNotes,
      'Dos and Donts': dosDonts || currentProfile.dosDonts,
      'Admin Feedback': feedback.trim(),
      'Profile Analysis Status': 'Complete',
      'Profile Last Analyzed': today,
    })

    // Upsert adjusted tag weights
    if (result.tag_weights) await upsertTagWeights(creatorId, result.tag_weights)
    if (result.film_format_weights) await upsertTagWeights(creatorId, result.film_format_weights)

    const topTags = Object.entries(result.tag_weights || {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag, weight]) => ({ tag, weight }))

    return NextResponse.json({
      success: true,
      changesMade: result.changes_made || '',
      topTags,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile refine error:', err)
    try {
      const body = await request.clone().json().catch(() => ({}))
      if (body.creatorId) {
        await patchCreator(body.creatorId, { 'Profile Analysis Status': 'Complete' })
      }
    } catch {}
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
