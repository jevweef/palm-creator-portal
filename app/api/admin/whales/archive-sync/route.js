import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'
import { ofApi, createDataExport, waitForDataExport, downloadExportCsv } from '@/lib/onlyfansApi'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST — Archive sync for one creator. STRICTLY ADDITIVE:
//   - Never touches the Google Sheet (the invoice pipeline).
//   - Never touches the invoicing page or Revenue Accounts coverage fields.
//   - Only APPENDS to its own archive files on Dropbox:
//       /Palm Ops/OF Archive/<creator>/transactions.csv   (fan_id-keyed, full API columns)
//       /Palm Ops/OF Archive/<creator>/chargebacks.csv
//       /Palm Ops/OF Archive/<creator>/fans.json          (latest fan snapshot w/ rebill)
//       /Palm Ops/OF Archive/<creator>/fans-prev.json     (previous snapshot, for diffs)
//   - Dedup by the transaction's own onlyfans_id — re-runs can never double-add,
//     and existing rows are never rewritten or removed.
//
// Also returns REBILL-OFF alerts: fans set to expire (auto-renew off) with real
// lifetime spend — the "decided to leave but hasn't left yet" list.
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

    // ── 1) Transactions + chargebacks: incremental, dedup by onlyfans_id ────
    const summary = {}
    for (const type of ['transactions', 'chargebacks']) {
      const path = `${dir}/${type}.csv`
      const existingRaw = await readFile(path)
      const existing = existingRaw ? String(existingRaw) : null
      const knownIds = new Set()
      let latestTs = null
      let header = null
      if (existing) {
        const lines = existing.split(/\r?\n/).filter((l) => l.trim())
        header = lines[0]
        const idIdx = header.split(',').indexOf('onlyfans_id')
        const tsIdx = header.split(',').findIndex((h) => h.includes('created_at'))
        for (const l of lines.slice(1)) {
          const cols = splitCsvLine(l)
          if (cols[idIdx]) knownIds.add(cols[idIdx])
          const ts = cols[tsIdx]
          if (ts && (!latestTs || ts > latestTs)) latestTs = ts
        }
      }
      // Window: since last archived timestamp (minus 3d overlap for stragglers),
      // or a full year on first run. API timestamps are UTC.
      const end = new Date()
      const start = latestTs
        ? new Date(new Date(latestTs.replace(' ', 'T') + 'Z').getTime() - 3 * 86400000)
        : new Date(end.getTime() - 365 * 86400000)
      const exp = await createDataExport({
        type,
        accountIds: [accountId],
        startDate: start.toISOString().slice(0, 10) + 'T00:00:00Z',
        endDate: end.toISOString().slice(0, 19) + 'Z',
      })
      const doneExp = await waitForDataExport(exp.id)
      const csv = await downloadExportCsv(doneExp)
      const lines = csv.split(/\r?\n/).filter((l) => l.trim())
      if (!header) header = lines[0]
      const newHeader = lines[0]
      const idIdx = newHeader.split(',').indexOf('onlyfans_id')
      const fresh = lines.slice(1).filter((l) => {
        const id = splitCsvLine(l)[idIdx]
        return id && !knownIds.has(id)
      })
      // APPEND-ONLY: existing content is preserved verbatim; new rows added.
      const merged = existing
        ? existing.replace(/\n+$/, '') + (fresh.length ? '\n' + fresh.join('\n') : '') + '\n'
        : newHeader + '\n' + lines.slice(1).join('\n') + '\n'
      await uploadToDropbox(accessToken, rootNs, path, Buffer.from(merged, 'utf8'), { overwrite: true })
      summary[type] = { archived: existing ? knownIds.size : 0, added: existing ? fresh.length : lines.length - 1, credits: doneExp.credit_cost ?? null }
    }

    // ── 2) Fan snapshot (rebill status, totals) ──────────────────────────────
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
      rebillOff,
      archivePath: dir,
    })
  } catch (err) {
    console.error('[whales/archive-sync] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}
