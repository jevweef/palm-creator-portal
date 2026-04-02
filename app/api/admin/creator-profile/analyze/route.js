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

--- THE OF CREATOR LENS ---
These creators make TOP-OF-FUNNEL public social media content (Instagram Reels, TikTok).
Their content stops casual scrollers, creates attraction or curiosity, and funnels viewers to
follow or subscribe. It is NOT explicit — it is scroll-stopping, attractive, and leaves the
viewer wanting more.

Every tag weight decision should be filtered through this lens:
- Would a man casually scrolling stop for this creator? Why?
- Does her content make him want to follow or find out more?
- What is it about her that stops the scroll — a body attribute, a personality, a vibe, a scenario she creates?
- What type of content is she naturally suited for based on who she is and how she presents?

The goal: stop the scroll → create attraction or curiosity → funnel to follow/subscribe.

--- INPUT HIERARCHY ---
You will be given transcripts of voice memos, meeting notes, PDFs, surveys, and other documents
that capture this creator's personality, brand, and content preferences.

When signals conflict, follow this priority:
1. OBSERVED BEHAVIOR — what she actually posts, how she presents visually, what content she's already made (highest weight)
2. TEAM OBSERVATIONS — notes from managers or the chat team about what works for her
3. STATED PREFERENCES — what she says she wants to do or is interested in (lower weight — aspirations don't always match brand fit)

If she says she wants to do fitness content but everything about her presentation is glam/beauty, weight the tags toward what actually fits, not just what she aspires to.

--- THE 46 CANONICAL CONTENT TAGS ---
These are the SAME tags used to analyze inspiration reels on the inspo board. Creator tag weights
must use the same definitions so that matching works correctly. A creator who scores high on a tag
should genuinely match reels tagged with that same tag.

${TAG_LIST_FOR_PROMPT}

--- TAG DEFINITIONS (use these exact standards) ---

Setting / Location tags — score based on where she naturally films or would film:
- Beach Girl: she regularly films at beaches or pools, or beach/coastal settings are central to her aesthetic.
- Car Content: she regularly films in or around vehicles. Do not score this high just because she drives — it must be a content setting.
- City Girl: urban environments, city nightlife, downtown settings are her natural backdrop.
- Domestic / At-Home: she primarily films at home — bedroom, living room, kitchen. Most creators score moderate-to-high here.
- Kitchen / Food Content: cooking, kitchen activities, or food content is a recurring theme.
- Luxury / Elevated Lifestyle: high-end settings, designer items, luxury travel. Mutually exclusive with Lifestyle Casual — do not score both high.
- Mirror Moment: she regularly uses physical mirrors in her content (mirror selfies, getting-ready-in-mirror shots). Not just any selfie.
- Nature / Outdoors: hiking, parks, outdoor settings are recurring in her content.

Persona / Niche tags — score based on her brand identity and content lane:
- Artsy / Creative: art, photography, creative expression is central to her brand.
- Bikini / Swim: swimwear content is a regular part of her feed. Not just owning a bikini — it must be a content lane.
- Bookish / Smart Girl: intellectual, studious, or "smart girl" persona is part of her brand.
- Fitness / Gym: gym, weight training, athletic content. Do NOT conflate with Wellness. Score high if gym settings or workout content are part of her lane.
- Girl Next Door: approachable, sweet, everyday appeal. If she leans into domestic/relationship/partner content, use Wifey instead — do not score both high on the same creator.
- Glam / Beauty: beauty, makeup, polished glamour presentation is central to her brand. Not just being attractive — glam must be the lane.
- Musician / Singer: music, singing, or musical performance is part of her identity.
- Tattoos: tattoos are a primary visual feature of her brand. Do not score high just because she has a small tattoo.
- Travel / Adventure: travel content is a recurring theme.
- Sports: sports participation or sports-adjacent content is part of her brand.
- Wellness: yoga, meditation, wellness lifestyle. Do NOT conflate with Fitness / Gym — they are separate tags.

Tone / Energy tags — score based on her natural personality and how she communicates:
- Bratty / Mischievous: playful defiance, bratty humor, mischief is her natural tone.
- Cute / Sweet Vibe: sweetness, warmth, soft energy is her default.
- Direct Flirt: she actively and overtly flirts at the camera. Not just being attractive — she must deliberately engage the viewer flirtatiously.
- Dominant Energy: commanding, assertive, in-charge energy.
- Funny: humor is a real part of her content — jokes, comedic timing, making people laugh.
- Lifestyle Casual: relaxed, everyday, unpolished vibe. Mutually exclusive with Luxury / Elevated Lifestyle.
- Playful Personality: lighthearted, fun energy without being specifically bratty or flirtatious.
- Soft Tease: subtle, implied teasing. Not a catch-all for any attractive creator. Do NOT score high if her primary content is humor, scripted scenarios, or personality-driven — Soft Tease is about suggestive subtlety specifically.
- Submissive / Shy Energy: quiet, shy, or submissive energy is part of her persona.
- Toxic: antagonistic, petty, or provocative energy directed outward. Not just attitude — the content must have clear adversarial energy.
- Wifey: domestic, homemaker, relationship-adjacent persona — cooking, cleaning, caring for home, teasing a partner.
- Young: ONLY for creators whose brand is specifically centered around the "barely legal" niche where youth/age is the hook. Do NOT score high just because the creator is young.

Visual / Body tags — score based on what she shows and how she presents physically:
- Body Focus: her content regularly centers on her body as the primary visual subject.
- Boobs: chest/cleavage is a primary visual feature in her content.
- Booty: butt/backside is a primary visual feature in her content.
- Dance: dance is a real content format for her — choreography or freestyle. Swaying or rhythmic movement is NOT dance.
- Face Card / Pretty Girl: her face and beauty are the primary draw. Score high only if "pretty girl" content is her main lane — not just because she's attractive.
- Foot Fetish: foot content is an intentional part of her brand.
- Lingerie / Sleepwear: lingerie, sleepwear, or intimate clothing is a regular content format.
- Outfit Showcase: fashion and styling content where the outfit itself is the focus. Being in a bikini = Bikini/Swim, not Outfit Showcase.
- Suggestive Movement: movement that implies or suggests without being explicit.
- Thirst Trap: she regularly produces content with significant skin — bikini, lingerie, underwear, or clothed-to-unclothed transitions. A low-cut top is NOT a thirst trap. Score high only if revealing content is a core part of her feed.

Viewer Experience tags — score based on the dynamics she creates with her audience:
- Eye Contact Driven: direct, sustained eye contact with the camera is a primary element of her content style.
- Implied Scenario: she builds specific viewer-perspective narratives — "POV: your girlfriend getting ready," "caught watching her," etc. Sexual subtext alone does NOT qualify. There must be a specific narrative frame.
- Personal Attention: she directs energy specifically at the viewer as an individual — intimate direct address, "just for you" energy. Different from POV (which is about camera angle).
- POV: she creates content from the viewer's perspective — the viewer feels they are a participant in the scene, not just watching.
- Roleplay: she creates content around specific characters, scenarios, or role-based fantasies.

--- SCORING RULES ---
Tag weight scoring: 0 = irrelevant, 1-30 = low relevance, 31-60 = moderate fit, 61-80 = strong fit, 81-100 = core to her identity.

- Score based on what MATCHES this creator's brand, personality, and visual presentation — not just what she's mentioned in passing.
- Most creators should have 5-10 tags scoring above 50. Not every tag needs a score — use 0 liberally for tags that don't fit.
- A tag scoring 80+ should mean: if you searched the inspo board for reels with this tag, most of them would be relevant to her.
- Do not inflate scores. A creator who mentions she "likes the beach" once in a voice memo should not score 70 on Beach Girl unless beach content is genuinely part of her brand.

--- THINK BEFORE SCORING ---
Before outputting tag weights, ask yourself for each tag:
1. If I filtered the inspo board to only show reels with this tag, would most of them be content this creator should see?
2. Is this based on observed behavior / visual presentation, or just something she mentioned once?
3. Am I applying the same standard the inspo board uses for this tag?

--- OUTPUT FORMAT ---
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

--- WRITING STYLE ---
- Write like a creative director describing a talent — direct, specific, no filler.
- Do not use AI-sounding compound phrases. Write like a human.
- Do not soften or sanitize. If her brand is built on sexual appeal, say that plainly.
- The team reading this profile manages OF creators — they understand the content. Be direct.`

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
