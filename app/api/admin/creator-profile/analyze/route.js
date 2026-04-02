import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, airtableHeaders, OPS_BASE } from '@/lib/adminAuth'
import OpenAI from 'openai'

export const maxDuration = 60

const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'
const TAG_WEIGHTS_TABLE = 'tbljiwFQBknbUCpc6'
const ANALYSIS_MODEL = 'gpt-5.4-mini'

const CANONICAL_TAGS = {
  'Setting / Location': [
    'Beach Girl', 'Car Content', 'City Girl', 'Domestic / At-Home',
    'Kitchen / Food Content', 'Luxury / Elevated Lifestyle', 'Mirror Moment', 'Nature / Outdoors',
  ],
  'Persona / Niche': [
    'Artsy / Creative', 'Bikini / Swim', 'Bookish / Smart Girl', 'Fitness / Gym',
    'Girl Next Door', 'Glam / Beauty', 'Musician / Singer', 'Tattoos',
    'Travel / Adventure', 'Sports', 'Wellness',
  ],
  'Tone / Energy': [
    'Bratty / Mischievous', 'Cute / Sweet Vibe', 'Direct Flirt', 'Dominant Energy',
    'Funny', 'Lifestyle Casual', 'Playful Personality', 'Soft Tease',
    'Submissive / Shy Energy', 'Toxic', 'Wifey', 'Young',
  ],
  'Visual / Body': [
    'Body Focus', 'Boobs', 'Booty', 'Dance', 'Face Card / Pretty Girl',
    'Foot Fetish', 'Lingerie / Sleepwear', 'Outfit Showcase', 'Suggestive Movement', 'Thirst Trap',
  ],
  'Viewer Experience': [
    'Eye Contact Driven', 'Implied Scenario', 'Personal Attention', 'POV', 'Roleplay',
  ],
}

const TAG_TO_CATEGORY = Object.entries(CANONICAL_TAGS).reduce((acc, [cat, tags]) => {
  tags.forEach(t => { acc[t] = cat })
  return acc
}, {})

const TAG_LIST_FOR_PROMPT = Object.entries(CANONICAL_TAGS)
  .map(([cat, tags]) => `  [${cat}]: ${tags.join(', ')}`)
  .join('\n')

const SYSTEM_PROMPT = `You are building a creator profile for an OnlyFans management agency.

The creators make TOP-OF-FUNNEL public social media content (Instagram Reels, TikTok).
Their content stops casual scrollers, creates attraction or curiosity, and funnels viewers to
follow or subscribe. It is NOT explicit — it is scroll-stopping, attractive, and leaves the
viewer wanting more.

You will be given transcripts of voice memos, meeting notes, PDFs, and other documents
that capture this creator's personality, brand, and content preferences.

The 46 canonical content tags (grouped by category):
${TAG_LIST_FOR_PROMPT}

Respond ONLY with valid JSON matching this exact schema:
{
  "profile_summary": "2-4 sentence personality and brand voice summary. Write like a creative director describing a talent — direct, specific, no filler.",
  "brand_voice_notes": "1-3 sentences on how she naturally communicates — tone, humor, directness, vulnerability level. Useful for caption writing.",
  "content_direction_notes": "3-5 sentences on content themes and angles that fit her. What she should film, what scenarios suit her, what she naturally gravitates toward.",
  "do_dont_notes": "Bullet-style list of clear do's and don'ts based on her preferences, comfort level, and brand. Format: '✓ Does: X\\n✗ Avoid: Y'",
  "tag_weights": {
    "Beach Girl": 0, "Car Content": 0, "City Girl": 0, "Domestic / At-Home": 0,
    "Kitchen / Food Content": 0, "Luxury / Elevated Lifestyle": 0, "Mirror Moment": 0, "Nature / Outdoors": 0,
    "Artsy / Creative": 0, "Bikini / Swim": 0, "Bookish / Smart Girl": 0, "Fitness / Gym": 0,
    "Girl Next Door": 0, "Glam / Beauty": 0, "Musician / Singer": 0, "Tattoos": 0,
    "Travel / Adventure": 0, "Sports": 0, "Wellness": 0,
    "Bratty / Mischievous": 0, "Cute / Sweet Vibe": 0, "Direct Flirt": 0, "Dominant Energy": 0,
    "Funny": 0, "Lifestyle Casual": 0, "Playful Personality": 0, "Soft Tease": 0,
    "Submissive / Shy Energy": 0, "Toxic": 0, "Wifey": 0, "Young": 0,
    "Body Focus": 0, "Boobs": 0, "Booty": 0, "Dance": 0, "Face Card / Pretty Girl": 0,
    "Foot Fetish": 0, "Lingerie / Sleepwear": 0, "Outfit Showcase": 0, "Suggestive Movement": 0, "Thirst Trap": 0,
    "Eye Contact Driven": 0, "Implied Scenario": 0, "Personal Attention": 0, "POV": 0, "Roleplay": 0
  }
}

Tag weight scoring: 0 = irrelevant, 1-30 = low, 31-60 = moderate, 61-80 = high, 81-100 = core to her identity.
Score based on what MATCHES this creator's brand and personality — not just what she's mentioned.`

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
  // Fetch existing weight records for this creator
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

  // Batch create (10 at a time)
  for (let i = 0; i < toCreate.length; i += 10) {
    const chunk = toCreate.slice(i, i + 10)
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Creator%20Tag%20Weights`,
      {
        method: 'POST',
        headers: airtableHeaders,
        body: JSON.stringify({ records: chunk }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Tag weights batch create ${res.status}: ${text}`)
    }
  }

  // Batch update (10 at a time)
  for (let i = 0; i < toUpdate.length; i += 10) {
    const chunk = toUpdate.slice(i, i + 10)
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/Creator%20Tag%20Weights`,
      {
        method: 'PATCH',
        headers: airtableHeaders,
        body: JSON.stringify({ records: chunk }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Tag weights batch update ${res.status}: ${text}`)
    }
  }
}

// POST /api/admin/creator-profile/analyze
// Body: { creatorId, creatorName }
export async function POST(request) {
  try {
    await requireAdmin()

    const { creatorId, creatorName } = await request.json()
    if (!creatorId) {
      return NextResponse.json({ error: 'creatorId is required' }, { status: 400 })
    }

    // Mark as analyzing
    await patchCreator(creatorId, { 'Profile Analysis Status': 'Analyzing' })

    // Fetch all documents for this creator
    const allDocRecords = await fetchAirtableRecords('Creator Profile Documents', {})
    const docRecords = allDocRecords.filter(r =>
      (r.fields['Creator'] || []).some(c => (c.id || c) === creatorId)
    )

    // Transcribe any audio docs that don't yet have extracted text
    const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm'])
    const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'
    const { getDropboxAccessToken } = await import('@/lib/dropbox')

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    let dropboxToken = null

    for (const doc of docRecords) {
      const fields = doc.fields
      const existingText = (fields['Extracted Text'] || '').trim()
      if (existingText) continue // already transcribed

      const fileName = fields['File Name'] || ''
      const fileType = fields['File Type'] || ''
      const dropboxPath = (fields['Dropbox Path'] || '').trim()
      const ext = fileName.lastIndexOf('.') >= 0 ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : ''
      const isAudio = fileType === 'Audio' || AUDIO_EXTENSIONS.has(ext)

      if (!isAudio || !dropboxPath) continue

      try {
        if (!dropboxToken) dropboxToken = await getDropboxAccessToken()

        // Download audio from Dropbox
        const dlRes = await fetch('https://content.dropboxapi.com/2/files/download', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${dropboxToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
          },
        })
        if (!dlRes.ok) { console.error(`Dropbox download failed for ${fileName}: ${dlRes.status}`); continue }

        const audioBuffer = await dlRes.arrayBuffer()
        const audioFile = new File([audioBuffer], fileName, { type: `audio/${ext.replace('.', '') || 'mpeg'}` })

        const transcript = await openai.audio.transcriptions.create({
          model: TRANSCRIPTION_MODEL,
          file: audioFile,
          response_format: 'text',
        })
        const text = typeof transcript === 'string' ? transcript.trim() : (transcript.text || '').trim()

        // Store transcript back to Airtable
        await fetch(`https://api.airtable.com/v0/${OPS_BASE}/Creator%20Profile%20Documents/${doc.id}`, {
          method: 'PATCH',
          headers: airtableHeaders,
          body: JSON.stringify({ fields: { 'Extracted Text': text, 'Analysis Status': 'Analyzed' } }),
        })
        // Update the in-memory record so it's included in the prompt below
        doc.fields['Extracted Text'] = text
        console.log(`Transcribed ${fileName}: ${text.length} chars`)
      } catch (e) {
        console.error(`Transcription failed for ${fileName}:`, e.message)
      }
    }

    const documents = docRecords
      .map(r => ({
        fileName: r.fields['File Name'] || '',
        fileType: r.fields['File Type'] || '',
        text: (r.fields['Extracted Text'] || '').trim(),
        notes: r.fields['Notes'] || '',
      }))
      .filter(d => d.text.length > 0)

    // Build prompt
    const lines = [`Creator: ${creatorName || creatorId}\n`]
    if (documents.length === 0) {
      lines.push('No documents with extracted text are available. Generate a minimal placeholder profile.')
    } else {
      documents.forEach((doc, i) => {
        let label = `[Document ${i + 1}: ${doc.fileName} — ${doc.fileType}]`
        if (doc.notes) label += ` (Context: ${doc.notes})`
        lines.push(label)
        lines.push(doc.text)
        lines.push('')
      })
    }

    const response = await openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: lines.join('\n') },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    })

    const profile = JSON.parse(response.choices[0].message.content)

    // Write profile back to Palm Creators
    const today = new Date().toISOString().split('T')[0]
    await patchCreator(creatorId, {
      'Profile Summary': profile.profile_summary || '',
      'Brand Voice Notes': profile.brand_voice_notes || '',
      'Content Direction Notes': profile.content_direction_notes || '',
      'Do / Don\'t Notes': profile.do_dont_notes || '',
      'Profile Analysis Status': 'Complete',
      'Profile Last Analyzed': today,
    })

    // Upsert tag weights
    if (profile.tag_weights) {
      await upsertTagWeights(creatorId, profile.tag_weights)
    }

    // Build top tags summary for response
    const topTags = Object.entries(profile.tag_weights || {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag, weight]) => ({ tag, weight }))

    return NextResponse.json({
      success: true,
      documentsAnalyzed: documents.length,
      profileSummary: profile.profile_summary || '',
      topTags,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Creator profile analyze error:', err)
    // Reset status on failure
    try {
      const { creatorId } = await request.json().catch(() => ({}))
      if (creatorId) {
        await fetch(
          `https://api.airtable.com/v0/${OPS_BASE}/${PALM_CREATORS_TABLE}/${creatorId}`,
          {
            method: 'PATCH',
            headers: airtableHeaders,
            body: JSON.stringify({ fields: { 'Profile Analysis Status': 'Not Started' } }),
          }
        )
      }
    } catch {}
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
