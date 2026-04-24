import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import OpenAI from 'openai'

export const maxDuration = 60

const INSPIRATION_TABLE = 'tblnQhATaMtpoYErb'
const PALM_CREATORS_TABLE = 'tbls2so6pHGbU4Uhh'

const MODE_BRIEFS = {
  'Scenario / Fantasy': {
    summary: 'Text places the viewer into a specific situation or fantasy. The visual alone is generic — the text creates the whole concept.',
    rules: [
      'Use POV framing or "when he/you/we…" setups',
      'Create a forbidden, flirty, or wish-fulfillment scenario the viewer is placed into',
      'Text should work even on a simple visual — the situation is what stops the scroll',
      'Avoid being too explicit — imply, don\'t state',
    ],
  },
  'Controversy / Opinion': {
    summary: 'Text makes a bold claim or hot take that people argue about in the comments. The video is a pretty girl — the text is the engagement driver.',
    rules: [
      'Make a provocative claim, ranking, or opinion',
      'Should invite disagreement or strong reaction in comments',
      'Work on any thirst-trap-style visual',
      'Short, declarative, confident tone',
    ],
  },
  'Relationship / Conversation': {
    summary: 'Text styled as a conversation — iMessage bubbles, him-vs-me dialogue, quoted lines + comeback.',
    rules: [
      'Use quoted dialogue format or "him: / me:" structure',
      'Create a flirty, sharp, or unexpected comeback',
      'The conversation format itself is part of the concept',
      'Feel spontaneous and real, not scripted',
    ],
  },
  'Visual Callout': {
    summary: 'Text directly references or amplifies what\'s happening on screen, adding a flirty or provocative spin.',
    rules: [
      'Reference a specific element visible in the clip (body part, setting, outfit, activity)',
      'Turn the literal visual into something suggestive or funny',
      'Short, punchy, caption-like',
    ],
  },
  'Relatable / Lifestyle': {
    summary: 'Relatable moment, routine caption, lifestyle statement, or engagement question. Makes viewers nod, comment, or tag a friend.',
    rules: [
      'Casual, conversational, not performative',
      'Can be a direct question to the viewer (engagement farming)',
      'Feels like a real thought, not copy',
    ],
  },
  'Mood / Reflective': {
    summary: 'Reflective, philosophical, or emotional statement paired with a generic pretty-girl visual. The caption gives the reel substance.',
    rules: [
      'Introspective, quote-like, emotionally resonant',
      'Something a viewer would screenshot or save',
      'Don\'t be preachy — feel like a private thought said out loud',
    ],
  },
}

function parseNotes(notes) {
  if (!notes) return { inspoDirection: '', whatMattersMost: '' }
  const inspoMatch = notes.match(/Inspo direction:\n?([\s\S]*?)(?=What matters most:|$)/i)
  const wmmMatch = notes.match(/What matters most:\n?([\s\S]*?)$/i)
  return {
    inspoDirection: inspoMatch ? inspoMatch[1].trim() : '',
    whatMattersMost: wmmMatch ? wmmMatch[1].trim() : '',
  }
}

export async function POST(request) {
  try {
    await requireAdminOrEditor()
  } catch (res) {
    return res
  }

  try {
    const body = await request.json()
    const { thumbnailUrl, mode, creatorId, count = 5 } = body

    if (!thumbnailUrl || !mode) {
      return NextResponse.json({ error: 'thumbnailUrl and mode required' }, { status: 400 })
    }

    const brief = MODE_BRIEFS[mode]
    if (!brief) {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
    }

    // 1. Fetch approved training examples for this mode
    const escapedMode = mode.replace(/'/g, "\\'")
    const examples = await fetchAirtableRecords(INSPIRATION_TABLE, {
      filterByFormula: `AND({Text Training Approved}, {Text Training Mode}='${escapedMode}')`,
      fields: ['On-Screen Text', 'Notes', 'Thumbnail', 'Tags', 'Username'],
      maxRecords: 8,
    })

    const trainingExamples = examples
      .map(r => {
        const thumb = r.fields['Thumbnail']?.[0]?.url
        if (!thumb) return null
        const { inspoDirection, whatMattersMost } = parseNotes(r.fields['Notes'] || '')
        return {
          thumbnail: thumb,
          text: r.fields['On-Screen Text'] || '',
          tags: r.fields['Tags'] || [],
          inspoDirection,
          whatMattersMost,
          username: r.fields['Username'] || '',
        }
      })
      .filter(Boolean)

    if (trainingExamples.length === 0) {
      return NextResponse.json({
        error: `No approved training examples found for mode "${mode}". Approve some reels in the training panel first.`,
      }, { status: 400 })
    }

    // 2. Optionally fetch creator DNA
    let creatorContext = ''
    if (creatorId) {
      try {
        const creatorRecs = await fetchAirtableRecords(PALM_CREATORS_TABLE, {
          filterByFormula: `RECORD_ID()='${creatorId}'`,
          fields: ['AKA', 'Creator Profile', 'Top Tags'],
          maxRecords: 1,
        })
        if (creatorRecs[0]) {
          const f = creatorRecs[0].fields
          const aka = f['AKA'] || 'the creator'
          const profile = (f['Creator Profile'] || '').slice(0, 1200)
          const topTags = (f['Top Tags'] || []).slice(0, 10).join(', ')
          creatorContext = `\n\nCreator: ${aka}\nTop tags: ${topTags}\nProfile summary: ${profile}`
        }
      } catch (e) {
        console.warn('[suggest-text] Failed to fetch creator DNA:', e.message)
      }
    }

    // 3. Build the OpenAI prompt
    const systemPrompt = `You are a viral caption writer for OnlyFans creators' Instagram and TikTok reels. Your job is to generate on-screen text overlay suggestions for a raw creator clip.

MODE: ${mode}
${brief.summary}

RULES FOR THIS MODE:
${brief.rules.map(r => `- ${r}`).join('\n')}

CORE PRINCIPLE (always):
These reels are top-of-funnel public content. The goal is to stop the scroll of a man on his For You page and make him want to follow or subscribe — not to deliver explicit content. The text should create attraction, curiosity, or engagement.

You will be shown:
1. Training examples (approved reels that worked, with their frames + the text that was on screen)
2. A target clip (one frame) that needs text suggestions${creatorContext ? '\n3. The creator\'s profile + DNA' : ''}

Your job: generate ${count} distinct on-screen text suggestions for the target clip. Each should work for this specific visual while following the mode rules.

Output a JSON object with a "suggestions" array. Each suggestion is an object with:
  - "text": the on-screen text (1-3 short lines, exactly as it should appear)
  - "reasoning": one sentence on why this works for this clip

Do not copy the training example texts. Generate fresh ideas tailored to the target clip's visual.`

    const userContent = []

    // Training examples block
    userContent.push({
      type: 'text',
      text: `Here are ${trainingExamples.length} approved training examples for mode "${mode}":`,
    })

    trainingExamples.forEach((ex, i) => {
      userContent.push({ type: 'image_url', image_url: { url: ex.thumbnail, detail: 'low' } })
      userContent.push({
        type: 'text',
        text: `Example ${i + 1} (@${ex.username}):\n  ON-SCREEN TEXT: "${ex.text}"\n  CONCEPT: ${ex.whatMattersMost || ex.inspoDirection || '(no analysis)'}\n  TAGS: ${ex.tags.join(', ')}`,
      })
    })

    // Target clip
    userContent.push({
      type: 'text',
      text: `\n---\nNow here is the TARGET CLIP that needs ${count} text suggestions:${creatorContext}`,
    })
    userContent.push({ type: 'image_url', image_url: { url: thumbnailUrl, detail: 'high' } })

    userContent.push({
      type: 'text',
      text: `\nGenerate ${count} on-screen text suggestions for the target clip. Return JSON only.`,
    })

    // 4. Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.9,
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response', raw }, { status: 500 })
    }

    return NextResponse.json({
      mode,
      suggestions: parsed.suggestions || [],
      trainingExampleCount: trainingExamples.length,
      usage: completion.usage,
    })
  } catch (err) {
    console.error('[suggest-text] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
