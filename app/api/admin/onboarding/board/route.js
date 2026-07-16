import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { fetchHqRecord, fetchHqRecords } from '@/lib/hqAirtable'
import { getOrCreateOnboardingRecord } from '@/lib/creatorSetup'
import { computePhase1 } from '@/lib/onboarding/checklist'
import { computeBoard } from '@/lib/onboarding/board'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const HQ_REVENUE_ACCOUNTS = 'Revenue Accounts'
const OPS_PALM_CREATORS = 'Palm Creators'
const OPS_CPD = 'Creator Platform Directory'
const OPS_PUBLER = 'Publer Accounts'
const OPS_SM_SETUP = 'SM Setup Requests'

// Resolve the Ops Palm Creators record for an HQ creator. Prefer the HQ Record
// ID back-link (set by the Clerk webhook / onboarding-complete); fall back to a
// name match. Linked-record fields can't be matched by ID via formula, so we
// only filter on text fields here.
async function findOpsCreator(hqId, name, aka) {
  try {
    const byLink = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `{HQ Record ID}='${hqId}'`,
      maxRecords: 1,
    })
    if (byLink[0]) return byLink[0]
  } catch { /* fall through */ }

  const clauses = []
  if (name) clauses.push(`{Creator}=${quoteAirtableString(name)}`)
  if (aka) clauses.push(`{AKA}=${quoteAirtableString(aka)}`)
  if (!clauses.length) return null
  try {
    const byName = await fetchAirtableRecords(OPS_PALM_CREATORS, {
      filterByFormula: `OR(${clauses.join(',')})`,
      maxRecords: 1,
    })
    return byName[0] || null
  } catch {
    return null
  }
}

export async function GET(request) {
  try {
    await requireAdmin()

    const hqId = new URL(request.url).searchParams.get('hqId')
    if (!hqId) return NextResponse.json({ error: 'hqId is required' }, { status: 400 })

    const creator = await fetchHqRecord(HQ_CREATORS, hqId)
    const cf = creator.fields || {}
    const name = cf['Creator'] || ''
    const aka = cf['AKA'] || name

    // Onboarding record + Ops creator first — many lookups key off opsId.
    const [ob, opsCreator] = await Promise.all([
      getOrCreateOnboardingRecord(hqId, name || aka),
      findOpsCreator(hqId, name, aka),
    ])
    const of = ob.fields || {}
    const ops = opsCreator?.fields || {}
    const opsId = opsCreator?.id || null

    // Secondary signal sources — all best-effort and parallel. A failure in any
    // one degrades that tile to "todo" rather than breaking the whole board.
    const [cpdCount, revenueLinked, publerActive, smSetup, surveyAnswerCount, profileDocs] = await Promise.all([
      countCpd(opsId),
      isRevenueLinked(aka),
      isPublerActive(opsId),
      loadSmSetup(opsId, name),
      countSurveyAnswers(hqId),
      loadProfileDocs(opsId),
    ])

    const phase1 = computePhase1(cf, of)
    const board = computeBoard({ cf, of, ops, phase1, cpdCount, revenueLinked, publerActive, smSetup, surveyAnswerCount, profileDocs, creator: { id: hqId, opsId } })

    return NextResponse.json({
      creator: {
        id: hqId,
        opsId,
        name,
        aka: cf['AKA'] || '',
        status: cf['Status'] || '',
        onboardingStatus: cf['Onboarding Status'] || '',
        managementStartDate: cf['Management Start Date'] || null,
        email: cf['Communication Email'] || '',
        chatTeam: cf['Chat Team'] || '',
        tjpEnabled: ops['TJP Enabled'] === true,
      },
      onboardingId: ob.id,
      ...board,
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[onboarding/board GET] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Count Creator Platform Directory rows for this creator (managed, not flagged
// "Does Not Exist"). Linked Creator can't be matched by ID via formula, so we
// narrow by managed/status, then JS-match the Creator link array.
async function countCpd(opsId) {
  if (!opsId) return 0
  try {
    const rows = await fetchAirtableRecords(OPS_CPD, {
      filterByFormula: `AND({Managed by Palm}=1,{Status}!='Does Not Exist')`,
      fields: ['Creator', 'Platform', 'Handle/ Username', 'Handle Override', 'URL'],
    })
    return rows.filter((r) => {
      const link = r.fields?.['Creator']
      if (!Array.isArray(link) || !link.includes(opsId)) return false
      const f = r.fields || {}
      return f['Handle/ Username'] || f['Handle Override'] || f['URL']
    }).length
  } catch (e) {
    console.warn('[board] countCpd failed:', e.message)
    return 0
  }
}

// Revenue Accounts live in the HQ base, linked to a creator by Account-Name
// prefix (AKA), Platform=OnlyFans, Status=Active.
async function isRevenueLinked(aka) {
  if (!aka) return false
  try {
    const rows = await fetchHqRecords(HQ_REVENUE_ACCOUNTS, {
      filterByFormula: `AND({Platform}='OnlyFans',{Status}='Active')`,
      fields: ['Account Name', 'Platform', 'Status'],
    })
    const a = aka.toLowerCase()
    return rows.some((r) => String(r.fields?.['Account Name'] || '').toLowerCase().startsWith(a))
  } catch (e) {
    console.warn('[board] isRevenueLinked failed:', e.message)
    return false
  }
}

async function isPublerActive(opsId) {
  if (!opsId) return false
  try {
    const rows = await fetchAirtableRecords(OPS_PUBLER, {
      filterByFormula: `{Status}='Active'`,
      fields: ['Creator', 'Status', 'Account Type'],
    })
    return rows.some((r) => Array.isArray(r.fields?.['Creator']) && r.fields['Creator'].includes(opsId))
  } catch (e) {
    console.warn('[board] isPublerActive failed:', e.message)
    return false
  }
}

async function loadSmSetup(opsId, name) {
  try {
    const rows = await fetchAirtableRecords(OPS_SM_SETUP, {
      fields: ['Status', 'Creator', 'Full Name'],
    })
    const mine = rows.filter((r) => {
      const link = r.fields?.['Creator']
      if (opsId && Array.isArray(link) && link.includes(opsId)) return true
      return name && r.fields?.['Full Name'] === name
    })
    if (!mine.length) return { exists: false }
    const complete = mine.some((r) => r.fields?.['Status'] === 'Complete')
    return { exists: true, complete, status: mine[0].fields?.['Status'] || 'Pending' }
  } catch (e) {
    console.warn('[board] loadSmSetup failed:', e.message)
    return { exists: false }
  }
}

// Survey answers (Ops base 'Onboarding Survey Responses', keyed by HQ Creator ID
// text). The count tells us how much they filled in even if they never hit Submit.
async function countSurveyAnswers(hqId) {
  try {
    const rows = await fetchAirtableRecords('Onboarding Survey Responses', {
      filterByFormula: `{HQ Creator ID} = ${quoteAirtableString(hqId)}`,
      fields: ['Question Key'],
    })
    return rows.filter((r) => r.fields?.['Question Key']).length
  } catch (e) {
    console.warn('[board] countSurveyAnswers failed:', e.message)
    return 0
  }
}

// DNA profile documents (Ops base, linked to the Ops creator). Lets a voice memo
// / doc uploaded from the DNA → Documents tab also reflect on the board.
async function loadProfileDocs(opsId) {
  if (!opsId) return { count: 0, hasAudio: false }
  try {
    const rows = await fetchAirtableRecords('Creator Profile Documents', {
      fields: ['File Name', 'File Type', 'Creator'],
    })
    const AUDIO = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm']
    const mine = rows.filter((r) => Array.isArray(r.fields?.['Creator']) && r.fields['Creator'].includes(opsId))
    const hasAudio = mine.some((r) => {
      const ft = r.fields?.['File Type']
      const fn = String(r.fields?.['File Name'] || '').toLowerCase()
      return ft === 'Audio' || AUDIO.some((ext) => fn.endsWith(ext))
    })
    return { count: mine.length, hasAudio }
  } catch (e) {
    console.warn('[board] loadProfileDocs failed:', e.message)
    return { count: 0, hasAudio: false }
  }
}
