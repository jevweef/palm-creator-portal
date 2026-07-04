import { NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  sheetsClient, ensureTab, ensureExtraHeaders, getLastFingerprints, txnFingerprint,
  insertRowsAtTop, updateCutoffBanner, utcToEtDateTime, mapType, stripHtmlText,
  fetchRevenueAccountNames,
} from '@/lib/transactionsSheet'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxFolder } from '@/lib/dropbox'
import { writeLiveEvent } from '@/lib/ofLiveBuffer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── onlyfansapi.com webhook receiver ─────────────────────────────────────────
// Everything that arrives gets USED (Evan, 2026-07-04):
//   transactions.new        → sheet row (real-time earnings) + fan tracker
//                             auto-update from fanData.spending (live lifetime)
//   messages.ppv.unlocked   → fan tracker auto-update + live chat buffer
//   messages.received       → live chat buffer + tracker lastReply signal
//   messages.sent (1:1 only)→ live chat buffer (mass-queue blasts skipped)
//   accounts.*              → Telegram ops alert (connection is the lifeline)
//   everything              → sampled to Dropbox while schemas harden
// STRICTNESS: sheet rows only when net+amount+created present (invoicing
// correctness); tracker updates only for fans ALREADY tracked (no row spam).

const CACHE = { accounts: null, accountsAt: 0, tracker: null, trackerAt: 0 }
const OPS_BASE = 'applLIT2t83plMqNx'

export async function GET() {
  return NextResponse.json({ ok: true, receiver: 'onlyfansapi', at: new Date().toISOString() })
}

export async function POST(request) {
  let raw = ''
  try {
    raw = await request.text()

    // Signature — OBSERVE-ONLY until their scheme is confirmed from traffic.
    const secret = process.env.ONLYFANSAPI_WEBHOOK_SECRET
    if (secret) {
      const candidates = ['x-signature', 'x-webhook-signature', 'x-onlyfansapi-signature', 'signature', 'x-hub-signature-256']
      const found = candidates.map((h) => [h, request.headers.get(h)]).filter(([, v]) => v)
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
      const match = found.some(([, v]) => String(v).replace(/^sha256=/, '') === expected)
      console.log(`[of-webhook] sig headers: ${found.map(([h, v]) => `${h}=${String(v).slice(0, 16)}…`).join(' ') || 'none'} | hmac ${match ? 'MATCH' : 'no match'}`)
    }

    const body = JSON.parse(raw)
    const event = body?.event || body?.type || 'unknown'
    const accountId = body?.account_id || body?.accountId || ''
    const payload = body?.payload || body?.data || {}

    console.log(`[of-webhook] ${event} account=${accountId} keys=${Object.keys(payload).join(',').slice(0, 200)}`)

    // Sampling: confirmed schemas sample sparsely; unseen types at 100%.
    const sampleRate = (event === 'messages.sent' || event === 'messages.received') ? 0.05
      : event === 'transactions.new' ? 0.1 : 1
    if (Math.random() < sampleRate) saveSample(event, raw).catch(() => {})

    if (event === 'transactions.new') {
      await handleNewTransaction(accountId, payload)
      await updateFanSignals(accountId, payload.fan || payload.user, payload.fanData).catch((e) => console.warn('[of-webhook] fan update failed:', e.message))
    } else if (event === 'messages.ppv.unlocked') {
      await updateFanSignals(accountId, payload.fan || payload.user, payload.fanData).catch(() => {})
      await appendLive(accountId, 'unlock', payload).catch(() => {})
    } else if (event === 'messages.received') {
      await appendLive(accountId, 'in', payload).catch(() => {})
      await updateFanSignals(accountId, payload.fan || payload.fromUser || payload.user, payload.fanData, { lastReplyAt: new Date().toISOString() }).catch(() => {})
    } else if (event === 'messages.sent') {
      // 1:1 only — mass-queue sends would flood the buffer
      if (!(payload.isFromQueue || payload.is_from_queue || payload.queueId || payload.queue_id)) {
        await appendLive(accountId, 'out', payload).catch(() => {})
      }
    } else if (event.startsWith('accounts.')) {
      await opsAlert(accountId, event).catch(() => {})
    }

    // Always 200 — retries would double-bill events.
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[of-webhook] error:', err.message, raw.slice(0, 300))
    return NextResponse.json({ ok: true, noted: err.message })
  }
}

// ── transactions → sheet (confirmed schema, live-verified 2026-07-04) ───────
async function handleNewTransaction(accountId, t) {
  const gross = num(t.amount)
  const net = num(t.net ?? t.net_amount)
  const fee = num(t.fee ?? t.fee_amount)
  const created = t.createdAt || t.created_at || t.onlyfans_created_at || null
  if (gross == null || net == null || !created) {
    console.log('[of-webhook] transactions.new missing essentials — sampled, not written')
    return
  }
  const status = String(t.status || '').toLowerCase()
  if (['failed', 'cancelled', 'canceled', 'refunded', 'error'].includes(status)) return

  const acct = await resolveAccount(accountId)
  if (!acct?.accountName) {
    console.warn(`[of-webhook] no creator mapped for ${accountId} — skipped`)
    return
  }

  const sheets = sheetsClient()
  const { tabName } = await ensureTab(sheets, acct.accountName, 'Sales')
  await ensureExtraHeaders(sheets, tabName)

  const desc = t.description || ''
  const fan = t.fan || t.user || {}
  const displayName = stripHtmlText(String(desc).replace(/^.*?from\s+/i, '')) || (fan.display_name || fan.displayName || fan.name || '')
  const dateTimeEt = utcToEtDateTime(String(created).replace('+00:00', 'Z'))
  if (!dateTimeEt) return

  const fps = await getLastFingerprints(sheets, tabName)
  if (fps.has(txnFingerprint(dateTimeEt, net, displayName))) {
    console.log(`[of-webhook] duplicate txn skipped (${displayName} ${dateTimeEt})`)
    return
  }

  const row = [
    dateTimeEt, gross, fee ?? '', net, mapType(t.type), displayName,
    fan.username || '', '', stripHtmlText(desc),
    fan.id != null ? String(fan.id) : '', t.vatAmount ?? t.vat_amount ?? '', 'Webhook',
  ]
  await insertRowsAtTop(sheets, tabName, [row])
  const dt = new Date(dateTimeEt.replace(' ', 'T') + ':00')
  if (!isNaN(dt)) await updateCutoffBanner(sheets, tabName, dt)
  console.log(`[of-webhook] ✓ wrote ${tabName}: ${displayName} net $${net} @ ${dateTimeEt}`)
}

// ── fan tracker auto-update from fanData (zero credits, real-time) ──────────
// Only fans ALREADY in the tracker get updated — events never create rows.
async function updateFanSignals(accountId, fan, fanData, extra = {}) {
  if (!fan || (!fan.username && !fan.name && !fan.display_name)) return
  const acct = await resolveAccount(accountId)
  if (!acct?.recordId) return
  const row = await findTrackerRow(acct.recordId, fan.username, fan.display_name || fan.name)
  if (!row) return

  const patch = {}
  const spendTotal = num(fanData?.spending?.total)
  if (spendTotal != null && spendTotal > (row.fields['Lifetime Spend'] || 0)) {
    patch['Lifetime Spend'] = spendTotal
  }
  let cad = {}
  try { cad = JSON.parse(row.fields.Cadence || '{}') } catch { /* fresh */ }
  cad.live = {
    ...(cad.live || {}),
    ...(spendTotal != null ? { spendingTotal: spendTotal, spendingBreakdown: fanData.spending } : {}),
    ...(extra.lastReplyAt ? { lastReplyAt: extra.lastReplyAt.slice(0, 10) } : {}),
    updatedAt: new Date().toISOString(),
  }
  patch['Cadence'] = JSON.stringify(cad)
  const res = await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Fan Tracker')}/${row.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: patch, typecast: true }),
  })
  if (res.ok) console.log(`[of-webhook] ✓ tracker updated: ${fan.username || fan.name} (${Object.keys(patch).join(',')})`)
}

// ── live chat buffer — one FILE PER EVENT (concurrent webhook deliveries
// were clobbering a shared buffer; see lib/ofLiveBuffer.js) ─────────────────
async function appendLive(accountId, dir, p) {
  const f = p.fan || p.fromUser || p.from_user || p.user || {}
  const entry = {
    id: p.id || p.message_id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dir, // 'in' | 'out' | 'unlock'
    at: p.createdAt || p.created_at || new Date().toISOString(),
    text: stripHtmlText(String(p.text || '')).slice(0, 600),
    price: num(p.price) || 0,
    media: p.mediaCount ?? p.media_count ?? (Array.isArray(p.media) ? p.media.length : 0),
    fan: { id: f.id != null ? String(f.id) : '', username: f.username || '', name: f.display_name || f.name || '' },
  }
  await writeLiveEvent(accountId, entry)
}

// ── ops alert: creator connection problems go straight to Telegram ──────────
async function opsAlert(accountId, event) {
  const acct = await resolveAccount(accountId).catch(() => null)
  const who = acct?.aka || accountId
  const label = {
    'accounts.session_expired': 'OF session EXPIRED — data has stopped flowing',
    'accounts.authentication_failed': 'OF re-login FAILED',
    'accounts.otp_code_required': 'OF is asking for an OTP code',
    'accounts.face_otp_required': 'OF is asking for FACE verification',
  }[event] || event
  console.warn(`[of-webhook] ACCOUNT ALERT: ${who} — ${label}`)
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_OPS_CHAT_ID || process.env.TELEGRAM_SMM_GROUP_CHAT_ID
  if (!token || !chatId) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `⚠️ ${who}: ${label}\nFix at app.onlyfansapi.com → Accounts.` }),
  })
}

// ── lookups (cached) ─────────────────────────────────────────────────────────
async function resolveAccount(accountId) {
  if (!accountId) return null
  const now = Date.now()
  if (!CACHE.accounts || now - CACHE.accountsAt > 600000) {
    const res = await fetch(
      `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Palm Creators')}?pageSize=100&fields%5B%5D=AKA&fields%5B%5D=Creator&fields%5B%5D=OF%20API%20Account%20ID`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } },
    )
    if (!res.ok) return null
    const data = await res.json()
    const map = {}
    for (const r of data.records || []) {
      const acct = r.fields?.['OF API Account ID']
      if (acct) map[acct] = { aka: r.fields?.AKA || r.fields?.Creator, name: r.fields?.Creator, recordId: r.id }
    }
    CACHE.accounts = map
    CACHE.accountsAt = now
  }
  const hit = CACHE.accounts[accountId]
  if (!hit) return null
  if (!hit.accountName) {
    const names = await fetchRevenueAccountNames(hit.aka)
    hit.accountName = names[0] || `${hit.aka} - Free OF`
  }
  return hit
}

async function findTrackerRow(creatorRecordId, username, fanName) {
  const now = Date.now()
  if (!CACHE.tracker || now - CACHE.trackerAt > 300000) {
    const rows = []
    let offset = null
    do {
      const u = `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent('Fan Tracker')}?pageSize=100&fields%5B%5D=Fan%20Name&fields%5B%5D=OF%20Username&fields%5B%5D=Creator&fields%5B%5D=Lifetime%20Spend&fields%5B%5D=Cadence${offset ? `&offset=${offset}` : ''}`
      const res = await fetch(u, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } })
      if (!res.ok) return null
      const data = await res.json()
      rows.push(...(data.records || []))
      offset = data.offset
    } while (offset)
    CACHE.tracker = rows
    CACHE.trackerAt = now
  }
  const un = (username || '').toLowerCase()
  const fn = (fanName || '').toLowerCase()
  return CACHE.tracker.find((r) =>
    (r.fields?.Creator || []).includes(creatorRecordId) &&
    ((un && (r.fields?.['OF Username'] || '').toLowerCase() === un) ||
     (fn && (r.fields?.['Fan Name'] || '').toLowerCase() === fn))
  ) || null
}

async function saveSample(event, raw) {
  const token = await getDropboxAccessToken()
  const ns = await getDropboxRootNamespaceId(token)
  await createDropboxFolder(token, ns, '/Palm Ops/OF Webhooks')
  await createDropboxFolder(token, ns, '/Palm Ops/OF Webhooks/samples')
  const name = `${event.replace(/[^a-z.]/gi, '')}-${Date.now()}.json`
  await uploadToDropbox(token, ns, `/Palm Ops/OF Webhooks/samples/${name}`, Buffer.from(raw, 'utf8'))
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}
