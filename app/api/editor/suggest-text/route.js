import { NextResponse } from 'next/server'
import { requireAdminOrEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import OpenAI from 'openai'
import ffmpegStatic from 'ffmpeg-static'
import { writeFile, readFile, unlink, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rawDropboxUrl(url) {
  if (!url) return ''
  const clean = url.replace(/[?&]dl=0/, '').replace(/[?&]raw=1/, '')
  return clean + (clean.includes('?') ? '&raw=1' : '?raw=1')
}

function runFfmpeg(args, outputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegStatic, args, { timeout: 25000 }, async (err, _stdout, stderr) => {
      const s = await stat(outputPath).catch(() => null)
      resolve({ ok: !!s && s.size > 0, size: s?.size || 0, err, stderr: stderr || '' })
    })
  })
}

// Download a Dropbox video and extract a representative frame via ffmpeg.
// Returns a JPEG buffer, or throws.
async function extractFrameFromVideo(videoUrl) {
  const id = Date.now()
  const inputPath = join(tmpdir(), `suggest_in_${id}.mp4`)
  const outputPath = join(tmpdir(), `suggest_out_${id}.jpg`)
  try {
    const rawUrl = rawDropboxUrl(videoUrl)
    const dlRes = await fetch(rawUrl, { redirect: 'follow' })
    if (!dlRes.ok) throw new Error(`video download failed: ${dlRes.status}`)
    const ct = dlRes.headers.get('content-type') || ''
    const videoBuffer = Buffer.from(await dlRes.arrayBuffer())
    const head = videoBuffer.slice(0, 100).toString('utf8')
    if (ct.includes('text/html') || head.includes('<!DOCTYPE html') || head.includes('<html')) {
      throw new Error('Dropbox returned HTML instead of video — share link may not be public')
    }
    await writeFile(inputPath, videoBuffer)

    // Try extracting a frame around 1s in (avoids black first frames)
    const mkArgs = (pre, post) => [
      '-y', ...pre, '-i', inputPath, ...post,
      '-frames:v', '1', '-update', '1', '-q:v', '2', outputPath,
    ]
    const strategies = [
      mkArgs(['-ss', '1'], []),       // output seek ~1s (fast, keyframe-aligned)
      mkArgs([], ['-ss', '1']),       // input seek ~1s (slow, precise)
      mkArgs([], []),                 // first frame
      mkArgs(['-sseof', '-0.5'], []), // last decodable frame
    ]
    for (const args of strategies) {
      await unlink(outputPath).catch(() => {})
      const r = await runFfmpeg(args, outputPath)
      if (r.ok) {
        return await readFile(outputPath)
      }
    }
    throw new Error('all ffmpeg strategies failed')
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
  }
}

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
    const { thumbnailUrl, videoUrl, mode, creatorId, count = 5 } = body

    if (!mode) {
      return NextResponse.json({ error: 'mode required' }, { status: 400 })
    }
    if (!thumbnailUrl && !videoUrl) {
      return NextResponse.json({ error: 'thumbnailUrl or videoUrl required' }, { status: 400 })
    }

    const brief = MODE_BRIEFS[mode]
    if (!brief) {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
    }

    // Resolve the image source to feed OpenAI
    // 1. If caller provided thumbnailUrl (direct image URL or data URL), use it
    // 2. Otherwise extract a frame from the Dropbox video via their thumbnail API
    let targetImageSource = thumbnailUrl
    if (!targetImageSource && videoUrl) {
      try {
        const frameBuf = await extractFrameFromVideo(videoUrl)
        targetImageSource = `data:image/jpeg;base64,${frameBuf.toString('base64')}`
      } catch (e) {
        console.warn('[suggest-text] frame extract failed:', e.message)
        return NextResponse.json({
          error: `Could not extract a frame from the video: ${e.message}`,
        }, { status: 400 })
      }
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
    userContent.push({ type: 'image_url', image_url: { url: targetImageSource, detail: 'high' } })

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
