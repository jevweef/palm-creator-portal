import { NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  sheetsClient, ensureTab, ensureExtraHeaders, getLastFingerprints, txnFingerprint,
  insertRowsAtTop, updateCutoffBanner, utcToEtDateTime, mapType, stripHtmlText,
  fetchRevenueAccountNames,
} from '@/lib/transactionsSheet'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, createDropboxFolder } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── onlyfansapi.com webhook receiver ─────────────────────────────────────────
// The webhook (wh_f607c221…, created 2026-06-06) has pointed here for a month
// with no receiver — every event 404'd. This endpoint:
//   • transactions.new → normalizes into the SAME Google Sheet row format the
//     pull/backfill/HTML flows write (fingerprint-deduped, newest-first, cutoff
//     banner) — the sheet stays the single source of truth, now real-time.
//   • every event type → raw sample saved to Dropbox (/Palm Ops/OF Webhooks/
//     samples/) while payload schemas are undocumented, so mappings can be
//     hardened against reality.
// STRICTNESS RULE: a sheet row is only written when the payload carries the
// exact fields we trust (net + amount + createdAt). Anything ambiguous is
// sampled and skipped — the Update button remains the correctness net.
// Signature: verified when ONLYFANSAPI_WEBHOOK_SECRET is set (HMAC-SHA256 of
// the raw body, hex, from the x-signature header); tolerated when absent.

const KNOWN_ACCOUNT_CACHE = { map: null, at: 0 }

export async function GET() {
  return NextResponse.json({ ok: true, receiver: 'onlyfansapi', at: new Date().toISOString() })
}

export async function POST(request) {
  let raw = ''
  try {
    raw = await request.text()

    // Optional signature verification
    const secret = process.env.ONLYFANSAPI_WEBHOOK_SECRET
    if (secret) {
      const sig = request.headers.get('x-signature') || request.headers.get('x-webhook-signature') || ''
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
      if (!sig || !crypto.timingSafeEqual(Buffer.from(sig.padEnd(expected.length).slice(0, expected.length)), Buffer.from(expected))) {
        console.warn('[of-webhook] signature mismatch — rejecting')
        return NextResponse.json({ error: 'bad signature' }, { status: 401 })
      }
    }

    const body = JSON.parse(raw)
    const event = body?.event || body?.type || 'unknown'
    const accountId = body?.account_id || body?.accountId || ''
    const payload = body?.payload || body?.data || {}

    console.log(`[of-webhook] ${event} account=${accountId} keys=${Object.keys(payload).join(',').slice(0, 200)}`)

    // Sample the raw event to Dropbox (schemas are undocumented — these
    // samples are how the mappings get hardened). Non-fatal.
    saveSample(event, raw).catch(() => {})

    if (event === 'transactions.new') {
      await handleNewTransaction(accountId, payload)
    }

    // Always 200 — webhook retries would double-bill events.
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[of-webhook] error:', err.message, raw.slice(0, 300))
    return NextResponse.json({ ok: true, noted: err.message })
  }
}

async function handleNewTransaction(accountId, t) {
  // STRICT field contract — mirrors the /transactions endpoint object the
  // event most likely carries. Missing essentials → sample-only, no write.
  const gross = num(t.amount)
  const net = num(t.net ?? t.net_amount)
  const fee = num(t.fee ?? t.fee_amount)
  const created = t.createdAt || t.created_at || t.onlyfans_created_at || null
  if (gross == null || net == null || !created) {
    console.log('[of-webhook] transactions.new payload missing essentials — sampled, not written')
    return
  }
  const status = String(t.status || '').toLowerCase()
  if (['failed', 'cancelled', 'canceled', 'refunded', 'error'].includes(status)) return

  const accountName = await resolveAccountName(accountId)
  if (!accountName) {
    console.warn(`[of-webhook] no creator mapped for ${accountId} — skipped`)
    return
  }

  const sheets = sheetsClient()
  const { tabName } = await ensureTab(sheets, accountName, 'Sales')
  await ensureExtraHeaders(sheets, tabName)

  const desc = t.description || ''
  const displayName = stripHtmlText(String(desc).replace(/^.*?from\s+/i, '')) || (t.user?.displayName || t.user?.name || '')
  const dateTimeEt = utcToEtDateTime(String(created).replace('+00:00', 'Z'))
  if (!dateTimeEt) return

  // Dedup against the tab's newest rows (same fingerprint as every other path)
  const fps = await getLastFingerprints(sheets, tabName)
  if (fps.has(txnFingerprint(dateTimeEt, net, displayName))) {
    console.log(`[of-webhook] duplicate txn skipped (${displayName} ${dateTimeEt})`)
    return
  }

  const row = [
    dateTimeEt, gross, fee ?? '', net, mapType(t.type), displayName,
    t.user?.username || '', '', stripHtmlText(desc),
    t.user?.id != null ? String(t.user.id) : '', t.vatAmount ?? t.vat_amount ?? '', 'Webhook',
  ]
  await insertRowsAtTop(sheets, tabName, [row])
  const dt = new Date(dateTimeEt.replace(' ', 'T') + ':00')
  if (!isNaN(dt)) await updateCutoffBanner(sheets, tabName, dt)
  console.log(`[of-webhook] ✓ wrote ${tabName}: ${displayName} net $${net} @ ${dateTimeEt}`)
}

/** acct_… → "<AKA> - Free OF" via Palm Creators (cached 10 min). */
async function resolveAccountName(accountId) {
  if (!accountId) return null
  const now = Date.now()
  if (!KNOWN_ACCOUNT_CACHE.map || now - KNOWN_ACCOUNT_CACHE.at > 600000) {
    const res = await fetch(
      `https://api.airtable.com/v0/applLIT2t83plMqNx/${encodeURIComponent('Palm Creators')}?pageSize=100&fields%5B%5D=AKA&fields%5B%5D=Creator&fields%5B%5D=OF%20API%20Account%20ID`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` } },
    )
    if (!res.ok) return null
    const data = await res.json()
    const map = {}
    for (const r of data.records || []) {
      const acct = r.fields?.['OF API Account ID']
      if (acct) map[acct] = r.fields?.AKA || r.fields?.Creator
    }
    KNOWN_ACCOUNT_CACHE.map = map
    KNOWN_ACCOUNT_CACHE.at = now
  }
  const aka = KNOWN_ACCOUNT_CACHE.map[accountId]
  if (!aka) return null
  const names = await fetchRevenueAccountNames(aka)
  return names[0] || `${aka} - Free OF`
}

async function saveSample(event, raw) {
  // Keep a rolling set of raw payloads per event type for schema work.
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
