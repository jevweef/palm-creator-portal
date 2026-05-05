import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord, HQ_BASE, hqHeaders } from '@/lib/hqAirtable'
import { getDropboxAccessToken, getDropboxRootNamespaceId, moveDropboxItem, createDropboxFolder } from '@/lib/dropbox'
import { closeDropboxFileRequest } from '@/lib/dropboxFileRequests'
import { deleteSmmTopic } from '@/lib/telegramTopics'

export const dynamic = 'force-dynamic'
// Telegram + Dropbox + Clerk all involve external calls; raise the default 10s.
export const maxDuration = 60

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const REVENUE_ACCOUNTS = 'tblQqPWlsjiyJA0ba'
const HQ_ONBOARDING = 'tbl4nFzgH6nJHr3q6'

const ARCHIVE_ROOT = '/Palm Ops/Archive/Creators'
const LIVE_ROOT = '/Palm Ops/Creators'

// Sanitize for Dropbox path — match what creatorSetup.js produces.
const sanitizeForDropbox = (s) => String(s || '').trim()

// GET — preview what offboarding will affect
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { searchParams } = new URL(request.url)
  const hqId = searchParams.get('hqId')
  if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })

  try {
    const hq = await fetchHqRecord(HQ_CREATORS, hqId)
    const f = hq.fields || {}
    const revenueAccountIds = f['Revenue Accounts'] || []

    const accounts = []
    for (const id of revenueAccountIds) {
      try {
        const res = await fetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS}/${id}`,
          { headers: hqHeaders, cache: 'no-store' }
        )
        if (res.ok) {
          const rec = await res.json()
          accounts.push({
            id: rec.id,
            name: rec.fields?.['Account Name'] || '(unnamed)',
            status: rec.fields?.Status || '',
          })
        }
      } catch {}
    }

    // Look up Ops record + linked CPD accounts (for Telegram topic count)
    let opsRecord = null
    let cpdTopicCount = 0
    try {
      const opsRows = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `{HQ Record ID} = '${hqId}'`,
        fields: ['Creator', 'AKA', 'Status', 'HQ Record ID', 'Telegram Thread ID', 'Social Media Editing'],
        maxRecords: 1,
      })
      opsRecord = opsRows[0] || null
      if (opsRecord) {
        const cpdRows = await fetchAirtableRecords('Creator Platform Directory', {
          filterByFormula: `FIND('${opsRecord.id}', ARRAYJOIN({Creator}))`,
          fields: ['Account Name', 'Telegram Topic ID'],
        })
        cpdTopicCount = cpdRows.filter(r => r.fields?.['Telegram Topic ID']).length
      }
    } catch (e) {
      console.warn('[Offboard preview] Ops/CPD lookup failed:', e.message)
    }

    return NextResponse.json({
      creator: {
        id: hq.id,
        name: f.Creator || '',
        aka: f.AKA || '',
        status: f.Status || '',
        communicationEmail: f['Communication Email'] || '',
      },
      revenueAccounts: accounts,
      opsRecordId: opsRecord?.id || null,
      cpdTopicCount,
      hasCreatorTelegramThread: !!opsRecord?.fields?.['Telegram Thread ID'],
    })
  } catch (err) {
    console.error('[Offboard] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — execute offboarding
//   Body: { hqId, confirmAka }
//
// Cascade order (each step is independent — failures get logged but don't
// abort the rest, so a flaky external service doesn't leave the creator
// half-offboarded). We collect a `summary` and return it so the admin sees
// exactly what happened.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const summary = {
    hqStatus: null,
    opsStatus: null,
    socialMediaEditingCleared: false,
    revenueAccountsDeactivated: [],
    smmTopicsDeleted: [],
    smmTopicsFailed: [],
    creatorTelegramThreadCleared: false,
    clerkUserBanned: null,
    clerkUserError: null,
    fileRequestsClosed: [],
    fileRequestErrors: [],
    dropboxMoved: null,
    dropboxError: null,
    errors: [],
  }

  try {
    const body = await request.json()
    const { hqId, confirmAka, reason } = body || {}
    if (!hqId) return NextResponse.json({ error: 'hqId required' }, { status: 400 })
    const reasonText = (reason || '').toString().trim().slice(0, 2000)

    const hq = await fetchHqRecord(HQ_CREATORS, hqId)
    const f = hq.fields || {}
    const aka = f.AKA || ''
    const name = f.Creator || ''
    const email = f['Communication Email'] || ''

    if (!confirmAka || confirmAka.trim().toLowerCase() !== aka.trim().toLowerCase()) {
      return NextResponse.json(
        { error: `Confirmation does not match. Type the creator's AKA (${aka}) to confirm.` },
        { status: 400 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)

    // 1. HQ Creators: flip Status + stamp Offboarded Date + reason
    try {
      const hqPatch = {
        Status: 'Offboarded',
        'Offboarded Date': today,
      }
      if (reasonText) hqPatch['Offboarded Reason'] = reasonText
      await patchHqRecord(HQ_CREATORS, hqId, hqPatch)
      summary.hqStatus = 'Offboarded'
      summary.reason = reasonText || null
    } catch (e) {
      summary.errors.push(`HQ status update failed: ${e.message}`)
    }

    // 2. Revenue Accounts: deactivate
    const revenueAccountIds = f['Revenue Accounts'] || []
    for (const id of revenueAccountIds) {
      try {
        const getRes = await fetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS}/${id}`,
          { headers: hqHeaders, cache: 'no-store' }
        )
        if (!getRes.ok) continue
        const rec = await getRes.json()
        const accName = rec.fields?.['Account Name'] || id
        if (rec.fields?.Status === 'Inactive') continue
        const patchRes = await fetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS}/${id}`,
          {
            method: 'PATCH', headers: hqHeaders,
            body: JSON.stringify({ fields: { Status: 'Inactive' } }),
          }
        )
        if (patchRes.ok) summary.revenueAccountsDeactivated.push(accName)
      } catch (e) {
        summary.errors.push(`Revenue Account ${id} failed: ${e.message}`)
      }
    }

    // 3. Look up the Ops Palm Creators row, linked CPD accounts
    let opsRecord = null
    let cpdRows = []
    try {
      const opsRows = await fetchAirtableRecords('Palm Creators', {
        filterByFormula: `{HQ Record ID} = '${hqId}'`,
        fields: ['Creator', 'AKA', 'Status', 'HQ Record ID', 'Telegram Thread ID', 'Social Media Editing'],
        maxRecords: 1,
      })
      opsRecord = opsRows[0] || null
    } catch (e) {
      summary.errors.push(`Ops Palm Creators lookup failed: ${e.message}`)
    }

    if (opsRecord) {
      // 3a. Flip Ops status + clear Social Media Editing + clear Telegram Thread ID
      try {
        const opsPatch = {
          Status: 'Offboarded',
          'Social Media Editing': false,
        }
        if (opsRecord.fields?.['Telegram Thread ID']) {
          opsPatch['Telegram Thread ID'] = null
          summary.creatorTelegramThreadCleared = true
        }
        await patchAirtableRecord('Palm Creators', opsRecord.id, opsPatch)
        summary.opsStatus = 'Offboarded'
        summary.socialMediaEditingCleared = true
      } catch (e) {
        summary.errors.push(`Ops Palm Creators patch failed: ${e.message}`)
      }

      // 3b. CPD per-account Telegram topics
      try {
        cpdRows = await fetchAirtableRecords('Creator Platform Directory', {
          filterByFormula: `FIND('${opsRecord.id}', ARRAYJOIN({Creator}))`,
          fields: ['Account Name', 'Telegram Topic ID'],
        })
      } catch (e) {
        summary.errors.push(`CPD lookup failed: ${e.message}`)
      }

      for (const row of cpdRows) {
        const topicId = row.fields?.['Telegram Topic ID']
        if (!topicId) continue
        const accName = row.fields?.['Account Name'] || row.id
        try {
          await deleteSmmTopic(topicId)
          // Clear the Topic ID on CPD so it doesn't get re-used / linger.
          await patchAirtableRecord('Creator Platform Directory', row.id, { 'Telegram Topic ID': null })
          summary.smmTopicsDeleted.push(accName)
        } catch (e) {
          summary.smmTopicsFailed.push({ account: accName, error: e.message })
        }
      }
    }

    // 4. Clerk: ban the user (lookup by email — reversible via unban)
    if (email) {
      try {
        const client = await clerkClient()
        const list = await client.users.getUserList({ emailAddress: [email], limit: 5 })
        const users = list?.data || list || []
        for (const u of users) {
          try {
            await client.users.banUser(u.id)
            summary.clerkUserBanned = u.id
          } catch (e) {
            summary.clerkUserError = `Found user ${u.id} but ban failed: ${e.message}`
          }
        }
        if (users.length === 0) {
          summary.clerkUserError = `No Clerk user found for ${email}`
        }
      } catch (e) {
        summary.clerkUserError = `Clerk lookup failed: ${e.message}`
      }
    } else {
      summary.clerkUserError = 'No Communication Email on HQ Creators record — skipped Clerk ban.'
    }

    // 5. Dropbox: close file requests FIRST so no new uploads come in mid-move,
    //    then move /Palm Ops/Creators/{aka}/ → /Palm Ops/Archive/Creators/{aka}/.
    //    Closing the file requests is what actually stops Make.com ingest at
    //    the source — no new files arrive, so no orphan creator-name lookups.
    if (aka) {
      try {
        const accessToken = await getDropboxAccessToken()
        const rootNs = await getDropboxRootNamespaceId(accessToken)

        // 5a. Close Dropbox file requests recorded on the Onboarding row
        try {
          const onboardingRows = await fetch(
            `https://api.airtable.com/v0/${HQ_BASE}/${HQ_ONBOARDING}?filterByFormula=${encodeURIComponent(`FIND('${hqId}', ARRAYJOIN({Creator}))`)}&maxRecords=1`,
            { headers: hqHeaders, cache: 'no-store' }
          ).then(r => r.json())
          const ob = onboardingRows.records?.[0]
          if (ob) {
            const socialReqId = ob.fields?.['Social File Request ID']
            const longformReqId = ob.fields?.['Longform File Request ID']
            for (const [label, id] of [['social', socialReqId], ['longform', longformReqId]]) {
              if (!id) continue
              try {
                await closeDropboxFileRequest(accessToken, rootNs, id)
                summary.fileRequestsClosed.push(label)
              } catch (e) {
                // file_request_id_not_found is fine — already closed/deleted
                if (/not_found|disabled_for_team/i.test(e.message)) {
                  summary.fileRequestsClosed.push(`${label} (already closed)`)
                } else {
                  summary.fileRequestErrors.push(`${label}: ${e.message}`)
                }
              }
            }
          }
        } catch (e) {
          summary.fileRequestErrors.push(`Onboarding lookup failed: ${e.message}`)
        }

        // 5b. Move the live folder to archive
        const fromPath = `${LIVE_ROOT}/${sanitizeForDropbox(aka)}`
        const toPath = `${ARCHIVE_ROOT}/${sanitizeForDropbox(aka)}`
        await createDropboxFolder(accessToken, rootNs, '/Palm Ops/Archive')
        await createDropboxFolder(accessToken, rootNs, ARCHIVE_ROOT)
        const result = await moveDropboxItem(accessToken, rootNs, fromPath, toPath)
        if (result?.skipped) {
          summary.dropboxMoved = `skipped (${result.reason})`
        } else {
          summary.dropboxMoved = `${fromPath} → ${toPath}`
        }
      } catch (e) {
        summary.dropboxError = e.message
      }
    } else {
      summary.dropboxError = 'No AKA on HQ record — skipped Dropbox archive + file request close.'
    }

    return NextResponse.json({
      ok: true,
      creator: { id: hqId, name, aka },
      offboardedDate: today,
      ...summary,
    })
  } catch (err) {
    console.error('[Offboard] POST error:', err)
    return NextResponse.json({ error: err.message, partial: summary }, { status: 500 })
  }
}
