import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord, batchUpdateRecords, airtableHeaders, OPS_BASE } from '@/lib/adminAuth'
import { embedText, cosineSimilarity, buildCreatorEmbeddingText } from '@/lib/embeddings'
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
// Body: { creatorId, feedback, commit?: boolean }
// Default (commit=false): returns proposed changes without writing to Airtable
// commit=true: writes the provided proposal to Airtable
export async function POST(request) {
  try {
    await requireAdmin()

    const body = await request.json()
    const { creatorId, feedback, commit, proposal } = body
    if (!creatorId) return NextResponse.json({ error: 'creatorId is required' }, { status: 400 })

    // ── COMMIT MODE: write a previously previewed proposal to Airtable ──
    if (commit && proposal) {
      const dosDonts = Array.isArray(proposal.do_dont_notes)
        ? proposal.do_dont_notes.join('\n')
        : (proposal.do_dont_notes || '')

      // Build refinement history entry
      const { changesMade, currentTagWeights } = body
      const tagChanges = []
      if (proposal.tag_weights && currentTagWeights) {
        const allTags = new Set([...Object.keys(currentTagWeights), ...Object.keys(proposal.tag_weights)])
        for (const tag of allTags) {
          const from = currentTagWeights[tag] || 0
          const to = proposal.tag_weights[tag] || 0
          if (from !== to) tagChanges.push({ tag, from, to })
        }
        tagChanges.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
      }

      // Fetch existing history and append
      const creatorRes = await fetch(
        `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorId}`,
        { headers: airtableHeaders }
      )
      let history = []
      if (creatorRes.ok) {
        const existing = (await creatorRes.json()).fields?.['Refinement History'] || ''
        try { history = JSON.parse(existing) } catch { history = [] }
      }
      const today = new Date().toISOString().split('T')[0]
      history.push({
        date: today,
        summary: changesMade || (feedback || '').trim(),
        tagChanges: tagChanges.slice(0, 5),
      })

      await patchCreator(creatorId, {
        'Profile Summary': proposal.profile_summary || '',
        'Brand Voice Notes': proposal.brand_voice_notes || '',
        'Content Direction Notes': proposal.content_direction_notes || '',
        'Dos and Donts': dosDonts,
        'Admin Feedback': (feedback || '').trim(),
        'Profile Analysis Status': 'Complete',
        'Profile Last Analyzed': today,
        'Refinement History': JSON.stringify(history),
      })

      if (proposal.tag_weights) await upsertTagWeights(creatorId, proposal.tag_weights)
      if (proposal.film_format_weights) await upsertTagWeights(creatorId, proposal.film_format_weights)

      // Fire-and-forget: re-compute creator embedding after refinement
      computeCreatorEmbedding(creatorId, {
        profileSummary: proposal.profile_summary || '',
        brandVoiceNotes: proposal.brand_voice_notes || '',
        contentDirectionNotes: proposal.content_direction_notes || '',
        dosAndDonts: dosDonts,
      }).catch(err => console.error('Creator embedding error (non-blocking):', err))

      return NextResponse.json({ success: true, committed: true })
    }

    // ── PREVIEW MODE (default): generate proposed changes, return without writing ──
    if (!feedback?.trim()) return NextResponse.json({ error: 'feedback is required' }, { status: 400 })

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

    // Return proposal + current state for diff display — nothing written yet
    return NextResponse.json({
      success: true,
      preview: true,
      changesMade: result.changes_made || '',
      current: {
        profileSummary: currentProfile.profileSummary,
        brandVoiceNotes: currentProfile.brandVoiceNotes,
        contentDirectionNotes: currentProfile.contentDirectionNotes,
        dosDonts: currentProfile.dosDonts,
        tagWeights: currentTagWeights,
        filmFormatWeights: currentFilmFormatWeights,
      },
      proposed: {
        profile_summary: result.profile_summary || '',
        brand_voice_notes: result.brand_voice_notes || '',
        content_direction_notes: result.content_direction_notes || '',
        do_dont_notes: result.do_dont_notes || '',
        tag_weights: result.tag_weights || {},
        film_format_weights: result.film_format_weights || {},
      },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile refine error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function computeCreatorEmbedding(creatorId, profileFields) {
  const creatorText = buildCreatorEmbeddingText(profileFields)
  if (!creatorText) return

  const creatorEmbedding = await embedText(creatorText)
  if (!creatorEmbedding) return

  await patchAirtableRecord('Palm Creators', creatorId, {
    'Creator Embedding': JSON.stringify(creatorEmbedding),
  })

  const reels = await fetchAirtableRecords('Inspiration', {
    filterByFormula: "AND({Status} = 'Complete', NOT({Reel Embedding} = ''))",
    fields: ['Reel Embedding', 'Semantic Scores'],
  })

  const updates = []
  for (const reel of reels) {
    try {
      const reelEmbedding = JSON.parse(reel.fields['Reel Embedding'])
      const score = Math.round(cosineSimilarity(creatorEmbedding, reelEmbedding) * 1000) / 1000
      let existingScores = {}
      try { existingScores = JSON.parse(reel.fields['Semantic Scores'] || '{}') } catch {}
      existingScores[creatorId] = score
      updates.push({ id: reel.id, fields: { 'Semantic Scores': JSON.stringify(existingScores) } })
    } catch {}
  }

  if (updates.length > 0) await batchUpdateRecords('Inspiration', updates)
  console.log(`[Embeddings] Creator ${creatorId}: re-embedded after refinement, scored ${updates.length} reels`)
}
