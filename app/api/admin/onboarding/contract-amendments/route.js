import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import { buildContractHtml } from '@/lib/generateContractPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Rough HTML→text so the model reads the contract the way the creator does.
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<li>/gi, '\n- ')
    .replace(/<\/(div|p|ul|ol|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * POST /api/admin/onboarding/contract-amendments
 *   { hqId, mode: 'draft', requestText }  → AI reads the creator's requested
 *     changes against her current contract and returns proposed amendments for
 *     admin review: [{ title, request, current, proposed, kind }].
 *     kind = 'fix' (our template is wrong/unclear) | 'clarification' (restates
 *     intent, costs nothing) | 'concession' (a real business give — admin call).
 *   { hqId, mode: 'save', amendments: [{title, text}] } → store the ACCEPTED
 *     set on the creator record ([] clears). The wizard's contract preview and
 *     the signed PDF both render them as a numbered Amendments section.
 */
export async function POST(request) {
  try {
    await requireAdmin()
    const { hqId, mode, requestText, amendments } = await request.json()
    if (!hqId || !/^rec[A-Za-z0-9]{14}$/.test(hqId)) {
      return NextResponse.json({ error: 'valid hqId required' }, { status: 400 })
    }

    // mode: 'preview' — render the full contract HTML with an arbitrary
    // amendment set, so the admin can see old-vs-new exactly as the creator
    // will (same buildContractHtml the wizard + signed PDF use).
    if (mode === 'preview') {
      const record = await fetchHqRecord(HQ_CREATORS, hqId)
      const c = record.fields || {}
      let commissionTier = null
      try { commissionTier = c['Commission Tier'] ? JSON.parse(c['Commission Tier']) : null } catch {}
      // Explicit array = preview that set; omitted = preview the SAVED state
      // (what the creator sees today) — that's the "old" side of the compare.
      let source = amendments
      if (!Array.isArray(source)) {
        try { source = c['Contract Amendments'] ? JSON.parse(c['Contract Amendments']) : [] } catch { source = [] }
      }
      const list = source
        .map((a) => ({ title: String(a.title || ''), text: String(a.text || '') }))
        .filter((a) => a.title && a.text)
      const html = buildContractHtml({
        amendments: list,
        creatorName: c['Creator'] || '',
        commissionPct: c['Commission %'] || 0,
        commissionTier,
        creatorState: c['Creator State'] || '',
        effectiveDate: c['Onboarding Token Created At'] || new Date().toISOString(),
        agencySignature: c['Agency Signature'] || null,
        agencyName: c['Agency Signer Name'] || 'Josh Voto',
        agencySignDate: c['Onboarding Token Created At'] || new Date().toISOString(),
      })
      return NextResponse.json({ success: true, html })
    }

    if (mode === 'save') {
      if (!Array.isArray(amendments)) {
        return NextResponse.json({ error: 'amendments array required' }, { status: 400 })
      }
      const clean = amendments
        .map((a) => ({ title: String(a.title || '').slice(0, 120), text: String(a.text || '').slice(0, 2000) }))
        .filter((a) => a.title && a.text)
      await patchHqRecord(HQ_CREATORS, hqId, {
        'Contract Amendments': clean.length ? JSON.stringify(clean) : '',
      })
      return NextResponse.json({ success: true, count: clean.length })
    }

    // mode: 'draft'
    const req = String(requestText || '').trim()
    if (!req) return NextResponse.json({ error: 'requestText required' }, { status: 400 })
    if (req.length > 8000) return NextResponse.json({ error: 'requestText too long' }, { status: 400 })

    const record = await fetchHqRecord(HQ_CREATORS, hqId)
    const c = record.fields || {}
    let commissionTier = null
    try { commissionTier = c['Commission Tier'] ? JSON.parse(c['Commission Tier']) : null } catch {}
    const contractText = htmlToText(buildContractHtml({
      creatorName: c['Creator'] || '',
      commissionPct: c['Commission %'] || 0,
      commissionTier,
      creatorState: c['Creator State'] || '',
      effectiveDate: c['Onboarding Token Created At'] || new Date().toISOString(),
      agencyName: c['Agency Signer Name'] || 'Josh Voto',
      agencySignDate: c['Onboarding Token Created At'] || new Date().toISOString(),
    }))

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      system: `You turn a creator's requested contract changes into precise, ready-to-insert amendment clauses for a creator-management agreement. You work for the AGENCY.

For EACH distinct change the creator asks for, output one object:
- "title": short label (e.g. "Governing Law", "Payment Timing")
- "request": one-line summary of what she asked for
- "current": what the contract currently says on this point, quoted or tightly paraphrased ("(not addressed)" if absent)
- "proposed": the exact amendment clause text, written as a complete standalone provision in contract register. It will be inserted verbatim under an "Amendments" section that supersedes conflicting terms. Do not include a number or the title in the text.
- "kind": "fix" if our contract is objectively wrong/incoherent on this point; "clarification" if it just restates existing intent more precisely at no real cost to the agency; "concession" if it gives up or narrows an agency right or adds an agency obligation (payment deadlines, exclusivity limits, ending auto-renewal, audit rights, etc.)

Rules:
- Draft faithful to HER ask, but flag every real give as "concession" — the admin decides those.
- Where her ask is against the agency's interest, still draft it accurately; you may soften only with commercially reasonable qualifiers (e.g. "within one (1) business day" instead of "24 hours" is NOT allowed unless flagged — keep her number and note the alternative in "request" if useful).
- Output STRICT JSON only: an array of the objects above. No prose, no markdown fences.`,
      messages: [{
        role: 'user',
        content: `CURRENT CONTRACT:\n\n${contractText}\n\n---\n\nCREATOR'S REQUESTED CHANGES:\n\n${req}`,
      }],
    })
    const msg = await stream.finalMessage()

    const raw = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    let proposals = null
    try { proposals = JSON.parse(raw) } catch {
      const m = raw.match(/\[[\s\S]*\]/)
      if (m) { try { proposals = JSON.parse(m[0]) } catch { /* fall through */ } }
    }
    if (!Array.isArray(proposals) || !proposals.length) {
      return NextResponse.json({ error: 'Could not parse proposed amendments — try again.' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      proposals: proposals.map((p) => ({
        title: String(p.title || '').slice(0, 120),
        request: String(p.request || '').slice(0, 400),
        current: String(p.current || '').slice(0, 600),
        proposed: String(p.proposed || '').slice(0, 2000),
        kind: ['fix', 'clarification', 'concession'].includes(p.kind) ? p.kind : 'clarification',
      })).filter((p) => p.title && p.proposed),
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[contract-amendments] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
