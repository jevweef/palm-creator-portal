import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchHqRecord, patchHqRecord } from '@/lib/hqAirtable'
import { buildContractHtml, renderContract } from '@/lib/generateContractPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

function contractDataFor(c) {
  let commissionTier = null
  try { commissionTier = c['Commission Tier'] ? JSON.parse(c['Commission Tier']) : null } catch { /* ignore */ }
  return {
    creatorName: c['Creator'] || '',
    commissionPct: c['Commission %'] || 0,
    commissionTier,
    creatorState: c['Creator State'] || '',
    effectiveDate: c['Onboarding Token Created At'] || new Date().toISOString(),
    agencySignature: c['Agency Signature'] || null,
    agencyName: c['Agency Signer Name'] || 'Josh Voto',
    agencySignDate: c['Onboarding Token Created At'] || new Date().toISOString(),
  }
}

// The document region the model may edit: everything between the intro divider
// and the signature block. Keeps it away from <style>, logo data-URIs, and
// signatures — and keeps the prompt small.
function editableRegion(html) {
  const start = html.indexOf('<div class="section">')
  const end = html.indexOf('<div class="signature-block">')
  if (start === -1 || end === -1) return html
  return html.slice(start, end)
}

/**
 * POST /api/admin/onboarding/contract-amendments
 *   { hqId, mode:'draft', requestText } → AI drafts IN-PLACE edits to the
 *     agreement: [{ title, request, kind, find, replace, applied }] where
 *     `find` is an exact unique substring of the contract HTML and `replace`
 *     is the rewritten clause. Each pair is validated server-side; anything
 *     that doesn't cleanly match falls back to a textual amendment (applied:false).
 *   { hqId, mode:'preview', amendments?, highlight? } → full contract HTML with
 *     the given (or saved, if omitted) amendment set applied in place.
 *   { hqId, mode:'save', amendments } → store the accepted set ([] clears).
 */
export async function POST(request) {
  try {
    await requireAdmin()
    const { hqId, mode, requestText, amendments, highlight } = await request.json()
    if (!hqId || !/^rec[A-Za-z0-9]{14}$/.test(hqId)) {
      return NextResponse.json({ error: 'valid hqId required' }, { status: 400 })
    }

    if (mode === 'preview') {
      const record = await fetchHqRecord(HQ_CREATORS, hqId)
      const c = record.fields || {}
      let source = amendments
      if (!Array.isArray(source)) {
        try { source = c['Contract Amendments'] ? JSON.parse(c['Contract Amendments']) : [] } catch { source = [] }
      }
      const html = renderContract({ ...contractDataFor(c), amendments: source }, { highlight: !!highlight })
      return NextResponse.json({ success: true, html })
    }

    if (mode === 'save') {
      if (!Array.isArray(amendments)) {
        return NextResponse.json({ error: 'amendments array required' }, { status: 400 })
      }
      const clean = amendments
        .map((a) => {
          const title = String(a.title || '').slice(0, 120)
          if (a.find && a.replace) {
            return { title, find: String(a.find).slice(0, 4000), replace: String(a.replace).slice(0, 4000) }
          }
          if (a.text) return { title, text: String(a.text).slice(0, 2000) }
          return null
        })
        .filter((a) => a && a.title)
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
    const baseHtml = buildContractHtml({ ...contractDataFor(c), amendments: [] })
    const region = editableRegion(baseHtml)

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 12000,
      thinking: { type: 'adaptive' },
      system: `You edit a creator-management agreement IN PLACE based on the creator's requested changes. You work for the AGENCY. You will receive the agreement's HTML source; your edits change the original clauses directly — nothing is appended.

For EACH distinct change the creator asks for, output one object:
- "title": short label (e.g. "Governing Law", "Payment Timing")
- "request": one-line summary of what she asked for
- "find": an EXACT, VERBATIM substring copied character-for-character from the provided HTML source — the smallest region that fully contains the text being changed (typically one <li>…</li> or one sentence). It must appear EXACTLY ONCE in the source. Never paraphrase, re-wrap, or fix whitespace inside "find" — copy it byte-for-byte.
- "replace": the replacement HTML for that region, same tag structure (e.g. if find is a full <li>, replace is a full <li>), containing the rewritten clause in contract register.
- "kind": "fix" if the current text is objectively wrong/incoherent; "clarification" if the rewrite restates existing intent more precisely at no real cost to the agency; "concession" if it gives up or narrows an agency right or adds an agency obligation (payment deadlines, exclusivity limits, ending auto-renewal, audit rights, guaranteed access, etc.)

Rules:
- One object per requested change; where a request has no matching clause, choose the closest related clause and rewrite it to incorporate the point (still an in-place edit).
- Draft faithful to HER ask, but tag every real give as "concession" — the admin decides those.
- Output STRICT JSON only: an array of the objects above. No prose, no markdown fences.`,
      messages: [{
        role: 'user',
        content: `AGREEMENT HTML SOURCE (editable region):\n\n${region}\n\n---\n\nCREATOR'S REQUESTED CHANGES:\n\n${req}`,
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
      return NextResponse.json({ error: 'Could not parse proposed edits — try again.' }, { status: 502 })
    }

    // Validate every find/replace against the real document. Valid → in-place
    // edit; invalid → degrade to a textual amendment so nothing is lost.
    const out = proposals.map((p) => {
      const find = String(p.find || '')
      const replace = String(p.replace || '')
      const idx = find ? baseHtml.indexOf(find) : -1
      const applied = idx !== -1 && baseHtml.indexOf(find, idx + find.length) === -1 && !!replace
      return {
        title: String(p.title || '').slice(0, 120),
        request: String(p.request || '').slice(0, 400),
        kind: ['fix', 'clarification', 'concession'].includes(p.kind) ? p.kind : 'clarification',
        find: applied ? find : null,
        replace: applied ? replace : null,
        text: applied ? null : strip(replace) || null, // fallback amendment text
        current: strip(find).slice(0, 500),
        proposed: strip(replace).slice(0, 1200),
        applied,
      }
    }).filter((p) => p.title && (p.applied || p.text))

    if (!out.length) return NextResponse.json({ error: 'No usable edits produced — try again.' }, { status: 502 })
    return NextResponse.json({ success: true, proposals: out })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[contract-amendments] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
