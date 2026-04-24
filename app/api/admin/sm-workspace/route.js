export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { requireAdminOrSocialMedia, fetchAirtableRecords } from '@/lib/adminAuth'

// GET /api/admin/sm-workspace
// Returns the creator list SMM cares about (anyone Social Media Editing=1) with
// their live + pending IG accounts and latest post per account.
export async function GET() {
  try { await requireAdminOrSocialMedia() } catch (e) { return e }

  try {
    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `{Social Media Editing}=1`,
      fields: ['Creator', 'AKA', 'Status', 'Weekly Reel Quota'],
    })

    const creatorIds = creators.map(c => c.id)
    if (!creatorIds.length) return NextResponse.json({ creators: [] })

    // Pull IG accounts (live + pending) for these creators
    const cpdRecs = await fetchAirtableRecords('Creator Platform Directory', {
      filterByFormula: `AND({Platform}='Instagram',{Managed by Palm}=1,{Status}!='Does Not Exist')`,
      fields: ['Account Name', 'Creator', 'Handle/ Username', 'Handle Override', 'Follower Count', 'Account Type', 'Setup Status', 'Status'],
    })

    // Pull pending setup requests (slots that don't have a live CPD row yet)
    const setupReqs = await fetchAirtableRecords('SM Setup Requests', {
      filterByFormula: `{Status}!='Complete'`,
    })

    // Pull recent posts (last 14 days) to compute cadence
    const recentPosts = await fetchAirtableRecords('Posts', {
      filterByFormula: `IS_AFTER({Posted At}, DATEADD(NOW(), -14, 'days'))`,
      fields: ['Creator', 'Account', 'Posted At', 'SMM Scheduled'],
    })

    const normalized = creators.map(c => {
      const accounts = cpdRecs.filter(a => (a.fields?.Creator || []).includes(c.id)).map(a => {
        const f = a.fields || {}
        const handle = ((f['Handle Override'] || '').trim() || (f['Handle/ Username'] || '').trim()).replace(/^@/, '')
        return {
          id: a.id,
          name: f['Account Name'] || '',
          handle,
          followers: f['Follower Count'] || null,
          accountType: f['Account Type'] || '',
          setupStatus: f['Setup Status'] || '',
          status: f['Status'] || '',
        }
      })

      // Pending slots from the creator's open setup request(s)
      const pending = setupReqs
        .filter(r => (r.fields?.Creator || []).includes(c.id))
        .flatMap(r => {
          const f = r.fields || {}
          return [1, 2, 3]
            .filter(n => !f[`Slot ${n} Done`])
            .map(n => ({
              slot: n,
              candidates: f[`Slot ${n} Username Candidates`] || '',
              handle: f[`Slot ${n} Handle`] || '',
              requestId: r.id,
            }))
        })

      const posts = recentPosts.filter(p => (p.fields?.Creator || []).includes(c.id))
      const postedCount = posts.filter(p => p.fields?.['Posted At']).length

      return {
        id: c.id,
        name: c.fields?.Creator || '',
        aka: c.fields?.AKA || '',
        status: c.fields?.Status || '',
        weeklyQuota: c.fields?.['Weekly Reel Quota'] || null,
        accounts,
        pendingSlots: pending,
        postsLast14d: postedCount,
      }
    }).sort((a, b) => (a.aka || a.name).localeCompare(b.aka || b.name))

    return NextResponse.json({ creators: normalized })
  } catch (err) {
    console.error('[sm-workspace] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
