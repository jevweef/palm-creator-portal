export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'

// GET — list ALL Palm Creators with their pipeline flag + readiness indicators.
// Used by the Admin Dashboard "Pipeline Status" panel to add/remove creators
// from the editor pipeline without going into Airtable.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    // Pull Active + Onboarding creators. Churned/Inactive roster entries stay
    // in Airtable for history but shouldn't clutter the admin's live controls.
    const [creators, igAccounts] = await Promise.all([
      fetchAirtableRecords('Palm Creators', {
        filterByFormula: `OR({Status}='Active',{Status}='Onboarding')`,
        fields: [
          'Creator', 'AKA', 'Status', 'Social Media Editing',
          'Weekly Reel Quota', 'Telegram Thread ID',
          'Profile Summary', 'Music DNA Processed',
        ],
      }),
      // Only count accounts that actually exist — i.e. have a real handle.
      // Placeholder rows (Main / Palm IG 1/2/3 created ahead of time but not
      // yet set up on IG by the social media manager) have no handle and no URL,
      // and shouldn't count toward the readiness badge.
      fetchAirtableRecords('Creator Platform Directory', {
        filterByFormula: `AND(
          {Platform}='Instagram',
          {Managed by Palm}=1,
          {Status}!='Does Not Exist',
          OR({Handle Override}!='',{Handle/ Username}!='',{URL}!='')
        )`.replace(/\s+/g, ''),
        fields: ['Creator', 'Platform', 'Account Name', 'Handle/ Username', 'Handle Override', 'URL'],
      }),
    ])

    // Count IG accounts per creator
    const igCountByCreator = {}
    for (const a of igAccounts) {
      for (const cid of a.fields?.Creator || []) {
        igCountByCreator[cid] = (igCountByCreator[cid] || 0) + 1
      }
    }

    const result = creators.map(c => {
      const f = c.fields || {}
      return {
        id: c.id,
        name: f.AKA || f.Creator || '(unnamed)',
        status: f.Status || '',
        socialMediaEditing: !!f['Social Media Editing'],
        hasProfile: !!(f['Profile Summary'] && f['Profile Summary'].trim()),
        hasMusicDna: !!f['Music DNA Processed'],
        telegramThreadId: f['Telegram Thread ID'] || '',
        weeklyQuota: f['Weekly Reel Quota'] || null,
        igAccountCount: igCountByCreator[c.id] || 0,
      }
    }).sort((a, b) => {
      // Active first, then alphabetical
      if (a.socialMediaEditing !== b.socialMediaEditing) return a.socialMediaEditing ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ creators: result })
  } catch (err) {
    console.error('[Pipeline] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — flip Social Media Editing on/off for a creator
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorId, socialMediaEditing } = await request.json()
    if (!creatorId) return NextResponse.json({ error: 'creatorId required' }, { status: 400 })
    if (typeof socialMediaEditing !== 'boolean') {
      return NextResponse.json({ error: 'socialMediaEditing must be boolean' }, { status: 400 })
    }

    await patchAirtableRecord('Palm Creators', creatorId, {
      'Social Media Editing': socialMediaEditing,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Pipeline] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
