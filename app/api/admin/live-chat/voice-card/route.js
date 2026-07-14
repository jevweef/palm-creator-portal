import { NextResponse } from 'next/server'
import { requireLiveChatAccess } from '@/lib/adminAuth'
import { guardAccount } from '@/lib/chatTeamScope'
import { buildVoiceCard } from '@/lib/voiceCard'

export const dynamic = 'force-dynamic'

// GET /api/admin/live-chat/voice-card?account=acct_xxx
// Returns the creator's Voice Card (from her onboarding survey) so a human
// chatter sees exactly how she talks — pet names, phrases, emojis, never-say
// words, sample replies. Keyed by the CREATOR, so VIP + Free pages share it.
const OPS_BASE = 'applLIT2t83plMqNx'
const AT = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }

export async function POST(request) { return handle(request) }
export async function GET(request) { return handle(request) }

async function handle(request) {
  try { await requireLiveChatAccess() } catch (e) { return e }
  try {
    let account = ''
    if (request.method === 'POST') {
      const b = await request.json().catch(() => ({}))
      account = String(b.account || '')
    } else {
      account = String(new URL(request.url).searchParams.get('account') || '')
    }
    if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })
    try { await guardAccount(request, account) } catch (e) { return e }

    // Resolve the creator from the OF account id (same match as suggest).
    const r = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?pageSize=100`, { headers: AT, cache: 'no-store' })
    const j = await r.json()
    const crec = (j.records || []).find((c) =>
      String(c.fields?.['OF API Account ID'] || '').split(',').map((s) => s.trim()).filter(Boolean).includes(account))
    const cf = crec?.fields || {}
    const aka = cf.AKA || cf.Creator || null
    const hqId = cf['HQ Record ID'] || null

    const card = await buildVoiceCard(hqId).catch(() => null)
    return NextResponse.json({
      creator: aka,
      hasCard: !!card,
      answerCount: card?.answerCount || 0,
      groups: card?.groups || [],
    })
  } catch (err) {
    console.error('[live-chat voice-card]', err?.message || err)
    return NextResponse.json({ error: err?.message || 'voice-card failed' }, { status: 500 })
  }
}
