import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi } from '@/lib/onlyfansApi'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST — "Update Fan Data" for one creator. Snapshots every active fan
// (spend totals, sub price, auto-renew state, last seen) to Dropbox:
//   /Palm Ops/OF Archive/<creator>/fans.json       (latest snapshot)
//   /Palm Ops/OF Archive/<creator>/fans-prev.json  (previous, for diffs)
// and returns REBILL-OFF alerts: fans with auto-renew off + real lifetime
// spend — the "decided to leave but hasn't left yet" save list.
//
// Transaction data is NOT handled here — it lives in ONE place, the invoice
// sheet (HTML upload or the OF API pull on Invoicing → Raw Data Upload).
//
// Body: { creatorRecordId, minSpendForAlert?=50 }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { creatorRecordId, minSpendForAlert = 50 } = await request.json()
    if (!creatorRecordId) return NextResponse.json({ error: 'creatorRecordId required' }, { status: 400 })

    const creators = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Creator', 'AKA', 'OF API Account ID'],
    })
    const cf = creators[0]?.fields || {}
    const accountId = cf['OF API Account ID']
    if (!accountId) {
      return NextResponse.json({ error: `${cf.AKA || 'This creator'} isn't connected to the OnlyFans API yet` }, { status: 400 })
    }
    const safeName = (cf.AKA || cf.Creator || accountId).replace(/[\\/:*?"<>|]/g, '_')
    const dir = `/Palm Ops/OF Archive/${safeName}`

    const accessToken = await getDropboxAccessToken()
    const rootNs = await getDropboxRootNamespaceId(accessToken)
    const readFile = async (path) => {
      try { return await downloadFromDropbox(accessToken, rootNs, path) } catch { return null }
    }

    // Transactions now live in ONE place — the invoice sheet (filled by the
    // HTML upload or the OF API pull on the invoicing page). This route only
    // maintains FAN data: snapshot + rebill-off alerts.
    const summary = {}

    // ── Fan snapshot (rebill status, totals) ──────────────────────────────
    const fans = []
    let offset = 0
    for (let page = 0; page < 50; page++) {
      const json = await ofApi(`/${accountId}/fans/active?limit=20&offset=${offset}`)
      const batch = json?.data?.list || json?.data || []
      const arr = Array.isArray(batch) ? batch : []
      for (const u of arr) {
        const sub = u.subscribedOnData || {}
        const currentSub = (sub.subscribes || []).find((s) => s.isCurrent) || null
        // Rebill state comes from the LIVE fan object, not the docs' `status`
        // field (empirically null): subscribedByAutoprolong=false, a cancelDate
        // on the current sub, or an 'expire' status all mean auto-renew is off.
        const rebillOff = u.subscribedByAutoprolong === false
          || !!currentSub?.cancelDate
          || /expire/i.test(sub.status || '')
        fans.push({
          fanId: String(u.id),
          username: u.username || '',
          name: u.name || '',
          total: sub.totalSumm ?? 0,
          tips: sub.tipsSumm ?? 0,
          messages: sub.messagesSumm ?? 0,
          subs: sub.subscribesSumm ?? 0,
          subStatus: sub.status || '',
          rebillOff,
          autoRenew: u.subscribedByAutoprolong ?? null,
          expireDate: u.subscribedByExpireDate || sub.expiredAt || null,
          renewedAt: sub.renewedAt || null,
          subscribeAt: sub.subscribeAt || null,
          subPrice: u.currentSubscribePrice ?? sub.price ?? null,
          lastSeen: u.lastSeen || null,
          lastReplyAt: u.lastReplyAt || null,
        })
      }
      if (arr.length < 20) break
      offset += 20
    }
    const fansCapped = fans.length >= 1000

    // Rotate snapshots: current → prev, new → current (nothing deleted).
    const prevRaw = await readFile(`${dir}/fans.json`)
    if (prevRaw) {
      await uploadToDropbox(accessToken, rootNs, `${dir}/fans-prev.json`, Buffer.from(prevRaw), { overwrite: true })
    }
    const snapshot = { takenAt: new Date().toISOString(), accountId, fans }
    await uploadToDropbox(accessToken, rootNs, `${dir}/fans.json`, Buffer.from(JSON.stringify(snapshot, null, 1), 'utf8'), { overwrite: true })

    // ── 3) Rebill-off alerts ─────────────────────────────────────────────────
    // "Set to Expire" = auto-renew off — they've decided to leave but are still
    // here. High-LTV ones are the save-now list.
    const prev = prevRaw ? JSON.parse(String(prevRaw)) : null
    const prevById = Object.fromEntries((prev?.fans || []).map((f) => [f.fanId, f]))
    const rebillOff = fans
      .filter((f) => f.rebillOff)
      .filter((f) => (f.total || 0) >= minSpendForAlert)
      .map((f) => ({
        ...f,
        newThisSync: prevById[f.fanId] ? !prevById[f.fanId].rebillOff : true,
      }))
      .sort((a, b) => (b.total || 0) - (a.total || 0))

    return NextResponse.json({
      ok: true,
      creator: cf.AKA || cf.Creator,
      archive: summary,
      fanCount: fans.length,
      fansCapped,
      rebillOff,
      archivePath: dir,
    })
  } catch (err) {
    console.error('[whales/archive-sync] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

