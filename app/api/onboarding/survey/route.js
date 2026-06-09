import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'
import { patchHqRecord } from '@/lib/hqAirtable'
import { getOrCreateOnboardingRecord } from '@/lib/creatorSetup'
import { quoteAirtableString } from '@/lib/airtableFormula'

const SURVEY_TABLE = 'Onboarding Survey Responses'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'

// GET — load all saved answers for a creator
export async function GET(request) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const hqId = searchParams.get('hqId')
  if (!hqId) {
    return NextResponse.json({ error: 'hqId required' }, { status: 400 })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'
  if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const records = await fetchAirtableRecords(SURVEY_TABLE, {
      filterByFormula: `{HQ Creator ID} = ${quoteAirtableString(hqId)}`,
    })

    const answers = {}
    for (const rec of records) {
      const key = rec.fields['Question Key']
      if (key) {
        answers[key] = {
          recordId: rec.id,
          answer: rec.fields['Answer'] || '',
        }
      }
    }

    return NextResponse.json({ answers })
  } catch (err) {
    console.error('[survey GET] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — save/update answers (batch)
export async function POST(request) {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await currentUser()
  const role = user?.publicMetadata?.role
  const isAdmin = role === 'admin' || role === 'super_admin'

  const { hqId, opsId, answers, completed } = await request.json()
  // answers: [{ key, text, answer, section, teamTag, recordId? }]

  if (!hqId || !answers || !Array.isArray(answers)) {
    return NextResponse.json({ error: 'hqId and answers[] required' }, { status: 400 })
  }

  if (!isAdmin && user?.publicMetadata?.airtableHqId !== hqId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const results = []

    for (const a of answers) {
      if (!a.key || a.answer === undefined) continue

      if (a.recordId) {
        // Update existing
        await patchAirtableRecord(SURVEY_TABLE, a.recordId, {
          'Answer': a.answer,
        })
        results.push({ key: a.key, action: 'updated' })
      } else {
        // Create new
        const fields = {
          'Response ID': `${hqId}-${a.key}`,
          'HQ Creator ID': hqId,
          'Question Key': a.key,
          'Question Text': a.text || '',
          'Answer': a.answer,
          'Team Tag': a.teamTag || [],
          'Section': a.section || '',
        }
        if (opsId) {
          fields['Creator'] = [opsId]
        }
        const created = await createAirtableRecord(SURVEY_TABLE, fields)
        results.push({ key: a.key, action: 'created', recordId: created.id })
      }
    }

    // Mark the survey done on the onboarding record once the client signals all
    // questions are answered. Previously NOTHING wrote "Survey Completed", so the
    // board + Olive showed every creator's survey as not submitted. Non-blocking.
    if (completed === true) {
      try {
        const ob = await getOrCreateOnboardingRecord(hqId, '')
        if (ob?.id) {
          await patchHqRecord(HQ_ONBOARDING, ob.id, {
            'Survey Completed': true,
            'Survey Completed At': new Date().toISOString(),
          })
        }
      } catch (e) {
        console.error('[survey POST] mark-complete failed:', e.message)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (err) {
    console.error('[survey POST] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
