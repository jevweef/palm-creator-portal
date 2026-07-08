import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox, createDropboxFolder } from '@/lib/dropbox'
import { readLiveMany } from '@/lib/ofLiveBuffer'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Nightly whale-intel analyst (runs on Vercel cron — no laptop needed).
// Reads YESTERDAY's chats from the live-events log (webhook data — zero OF
// credits), judges chatter authenticity against each creator's voice profile
// + the OFM research playbook, detects mass-template scripts hitting whales,
// and extracts what fans are ASKING FOR (content demand → shoot priorities).
// Output: /Palm Ops/Whale Intel/daily/YYYY-MM-DD.json (rendered on the
// whale-hunting Palm Internal + Chat Team Report tabs) + a Telegram summary.
//
// Timeout-first: creators are processed until an internal deadline; the run
// is idempotent per day (skips creators already in today's file), and the
// cron fires twice a night so a partial first pass completes on the second.

const OPS_BASE = 'applLIT2t83plMqNx'
const AT_HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` }
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ET = 'America/New_York'
function yesterdayEt() {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: ET }))
  et.setDate(et.getDate() - 1)
  return et.toISOString().slice(0, 10)
}
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const normTemplate = (s) => strip(s).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()

async function fetchAll(table, params = {}) {
  let out = []
  const p = new URLSearchParams(params)
  p.set('pageSize', '100')
  for (let page = 0; page < 12; page++) {
    const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(table)}?${p}`, { headers: AT_HEADERS, cache: 'no-store' })
    const j = await res.json()
    out = out.concat(j.records || [])
    if (!j.offset) break
    p.set('offset', j.offset)
  }
  return out
}

export async function GET(request) {
  const expectedAuth = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null
  if (expectedAuth && request.headers.get('authorization') !== expectedAuth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const deadline = Date.now() + 230000 // leave headroom under maxDuration
  try {
    const date = new URL(request.url).searchParams.get('date') || yesterdayEt()

    // Existing report for today → idempotent second pass
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const reportPath = `/Palm Ops/Whale Intel/daily/${date}.json`
    let report = { date, window: `${date} 12:00 AM \u2013 11:59 PM ET`, generatedAt: new Date().toISOString(), perCreator: [] }
    try {
      const buf = await downloadFromDropbox(token, ns, reportPath)
      if (buf) report = JSON.parse(buf.toString('utf8'))
    } catch { /* first pass */ }
    // aiFailed creators are NOT done — the second nightly pass redoes them
    const doneAkas = new Set(report.perCreator.filter((c) => !c.aiFailed).map((c) => c.aka))

    // Creators + accounts
    const creators = (await fetchAll('Palm Creators')).filter((c) => c.fields?.['OF API Account ID'])
    // Whale roster (watch fans, keyed by username) for tagging
    const tracker = await fetchAll('Fan Tracker', { filterByFormula: '{Lifetime Spend} >= 400' })
    const whaleByUsername = new Map()
    for (const r of tracker) {
      const u = (r.fields?.['OF Username'] || '').toLowerCase()
      if (u) whaleByUsername.set(u, { name: r.fields['Fan Name'], lifetime: r.fields['Lifetime Spend'] || 0 })
    }

    // Playbook slice for the judge prompt
    let playbook = ''
    try { playbook = fs.readFileSync(path.join(process.cwd(), 'research', 'knowledge', 'whale-playbook.md'), 'utf8').slice(0, 2500) } catch { /* optional */ }

    // Yesterday's events per account (webhook log — free)
    const allAccountIds = creators.flatMap((c) => String(c.fields['OF API Account ID']).split(',').map((x) => x.trim()).filter(Boolean))
    // FULL day, not the live-chat tail — the 500-row default silently cut
    // busy accounts' mornings (Caitie Rosie's 7 sales looked like $0 on 7/7).
    const eventsByAccount = await readLiveMany(allAccountIds, { limit: 20000 })

    for (const c of creators) {
      if (Date.now() > deadline) { report.partial = true; break }
      const aka = c.fields.AKA || c.fields.Creator
      if (doneAkas.has(aka)) continue
      const ids = String(c.fields['OF API Account ID']).split(',').map((x) => x.trim()).filter(Boolean)
      const events = ids.flatMap((id) => (eventsByAccount[id] || []))
        .filter((e) => {
          const at = new Date(e.at)
          const etDay = new Date(at.toLocaleString('en-US', { timeZone: ET })).toISOString?.() // not reliable — use formatter
          const day = new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
          return day === date
        })
      const outbound = events.filter((e) => e.dir === 'out' && (e.text || '').trim())
      const inbound = events.filter((e) => e.dir === 'in' && (e.text || '').trim())
      const sales = events.filter((e) => e.dir === 'sale')
      const stats = {
        outbound: outbound.length, inbound: inbound.length, sales: sales.length,
        salesTotal: Math.round(sales.reduce((s, e) => s + (e.price || 0), 0)),
        fansMessaged: new Set(outbound.map((e) => (e.fan?.username || e.fan?.name || '').toLowerCase()).filter(Boolean)).size,
      }

      // ── Mass-template detection (pure JS, free) ──────────────────────────
      const byTemplate = new Map()
      for (const e of outbound) {
        const key = normTemplate(e.text)
        if (key.length < 40) continue
        if (!byTemplate.has(key)) byTemplate.set(key, { text: strip(e.text).slice(0, 220), fans: new Set() })
        byTemplate.get(key).fans.add(e.fan?.username || e.fan?.name || '?')
      }
      const massTemplates = [...byTemplate.values()]
        .filter((t) => t.fans.size >= 3)
        .map((t) => ({
          text: t.text, fanCount: t.fans.size,
          whalesHit: [...t.fans].filter((f) => whaleByUsername.has(String(f).toLowerCase())).map((f) => whaleByUsername.get(String(f).toLowerCase()).name),
        }))
        .sort((a, b) => b.fanCount - a.fanCount).slice(0, 10)

      // ── AI pass: authenticity + content demand + wins (one Sonnet call) ──
      let ai = { authenticity: [], contentDemand: [], wins: [] }
      let aiOk = true
      const hasMaterial = outbound.length >= 5 || inbound.length >= 5
      if (hasMaterial && Date.now() < deadline) {
        aiOk = false
        const cf = c.fields
        const voice = [
          cf['Profile Summary'] ? `PERSONALITY: ${cf['Profile Summary']}` : '',
          cf['Brand Voice Notes'] ? `VOICE: ${cf['Brand Voice Notes']}` : '',
          cf['Dos and Donts'] ? `DOS & DON'TS: ${cf['Dos and Donts']}` : '',
        ].filter(Boolean).join('\n')
        const outLines = outbound.slice(0, 250).map((e) => {
          const u = (e.fan?.username || '').toLowerCase()
          const whale = whaleByUsername.get(u)
          return `[to ${e.fan?.name || e.fan?.username || '?'}${whale ? ` — WHALE $${Math.round(whale.lifetime)}` : ''} @ ${e.at.slice(11, 16)}] ${strip(e.text).slice(0, 300)}`
        }).join('\n')
        const inLines = inbound.slice(0, 250).map((e) => `[from ${e.fan?.name || e.fan?.username || '?'}] ${strip(e.text).slice(0, 300)}`).join('\n')
        const prompt = `You are the overnight chat-quality analyst for an OnlyFans agency. Below are YESTERDAY's 1:1 messages for creator "${aka}" (mass blasts excluded). Chatters type AS the creator.

${voice ? `HER VOICE PROFILE:\n${voice}\n` : ''}${playbook ? `AGENCY PLAYBOOK EXCERPT (standards we coach toward):\n${playbook}\n` : ''}
CHATTER-SENT MESSAGES (what "she" said):
${outLines}

FAN MESSAGES (what fans said):
${inLines}

Return STRICT JSON only, no prose, shaped exactly:
{
 "authenticity": [{"fan":"name","message":"the exact chatter message","issues":["broken-english"|"robotic"|"off-voice"|"persona-break"|"canned-spam"|"ignored-fan"],"severity":"high"|"medium","note":"one plain sentence"}],
 "contentDemand": [{"theme":"short label e.g. 'feet content'","quotes":["short fan quote"],"count":N}],
 "wins": [{"fan":"name","note":"one sentence on what the chatter did well and why it worked"}]
}
Rules: authenticity flags only for REAL problems a manager should coach (max 8, prioritize WHALE conversations); persona-break = talking about the creator in third person or admitting to being staff. contentDemand only for explicit fan asks/requests (max 6 themes). wins max 3. Empty arrays are fine.`
          // .slice(0,300) can cut an emoji in half, leaving a lone surrogate
          // that makes the JSON body invalid ("no low surrogate" 400s for
          // Raya + Caitie on 7/7). Strip unpaired surrogates from the prompt.
          .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
        // Six back-to-back ~50k-token calls trip the rate limit — Raya and
        // Caitie came back silently empty on 7/7. Retry through 429/5xx.
        for (let attempt = 0; attempt < 3 && !aiOk; attempt++) {
          try {
            const resp = await anthropic.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2000,
              messages: [{ role: 'user', content: prompt }],
            })
            const text = resp.content?.map((b) => b.text || '').join('') || '{}'
            const m = text.match(/\{[\s\S]*\}/)
            ai = { authenticity: [], contentDemand: [], wins: [], ...(m ? JSON.parse(m[0]) : {}) }
            aiOk = true
            // self-diagnosis: an all-empty result with material present is
            // suspicious — keep the raw reply so we can see WHY from the report
            if (!ai.authenticity.length && !ai.contentDemand.length && !ai.wins.length) {
              ai.aiRaw = `${resp.stop_reason || '?'}: ${text.slice(0, 300)}`
            }
          } catch (e) {
            const status = e?.status || e?.response?.status
            console.warn(`[whale-intel] AI pass failed for ${aka} (attempt ${attempt + 1}, ${status}):`, e.message)
            const retryable = status === 429 || status === 529 || (status >= 500 && status < 600)
            if (!retryable || attempt === 2 || Date.now() + 30000 > deadline) break
            await new Promise((r) => setTimeout(r, 25000 * (attempt + 1)))
          }
        }
      }

      // replace any earlier aiFailed entry for this creator
      report.perCreator = report.perCreator.filter((x) => x.aka !== aka)
      report.perCreator.push({ aka, stats, massTemplates, ...ai, aiFailed: aiOk ? undefined : true, analyzedAt: new Date().toISOString() })
      report.generatedAt = new Date().toISOString()
      // save incrementally — a timeout can't lose finished creators
      await createDropboxFolder(token, ns, '/Palm Ops/Whale Intel')
      await createDropboxFolder(token, ns, '/Palm Ops/Whale Intel/daily')
      await uploadToDropbox(token, ns, reportPath, Buffer.from(JSON.stringify(report), 'utf8'), { overwrite: true })
    }
    report.partial = report.partial && report.perCreator.length < creators.length ? true : undefined
    await uploadToDropbox(token, ns, reportPath, Buffer.from(JSON.stringify(report), 'utf8'), { overwrite: true })

    // Telegram morning summary (once, when the report is complete)
    const tgToken = process.env.TELEGRAM_BOT_TOKEN
    const tgChat = process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_SMM_GROUP_CHAT_ID
    if (tgToken && tgChat && !report.partial && !report.summarySent) {
      const flags = report.perCreator.reduce((s, cr) => s + (cr.authenticity?.length || 0), 0)
      const highFlags = report.perCreator.flatMap((cr) => (cr.authenticity || []).filter((a) => a.severity === 'high').map((a) => `${cr.aka}: ${a.issues?.join('/')} → ${a.fan}`))
      const templates = report.perCreator.reduce((s, cr) => s + (cr.massTemplates?.length || 0), 0)
      const whaleTemplateHits = report.perCreator.flatMap((cr) => (cr.massTemplates || []).flatMap((t) => t.whalesHit || []))
      const lines = [
        `🌙 Overnight chat report — ${date}`,
        `${flags} authenticity flags (${highFlags.length} high) · ${templates} mass-template scripts${whaleTemplateHits.length ? ` · templates hit ${whaleTemplateHits.length} WHALES` : ''}`,
        ...highFlags.slice(0, 5).map((l) => `⚠ ${l}`),
        `Full report: https://app.palm-mgmt.com/admin/whale-hunting?tab=team`,
      ]
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: lines.join('\n'), disable_web_page_preview: true }),
      }).catch(() => {})
      report.summarySent = true
      await uploadToDropbox(token, ns, reportPath, Buffer.from(JSON.stringify(report), 'utf8'), { overwrite: true })
    }

    return NextResponse.json({ ok: true, date, creators: report.perCreator.length, partial: !!report.partial })
  } catch (err) {
    console.error('[whale-intel] fatal:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
