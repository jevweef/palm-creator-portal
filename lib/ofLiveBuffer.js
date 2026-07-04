// Race-proof live-event store for the OF webhook receiver + live chat view.
//
// Webhook deliveries arrive CONCURRENTLY (fan msg + chatter reply + two
// registered webhooks both pointing at us) — a read-modify-write on one
// buffer file loses events (seen live: Rex's thread kept 1 of ~6 events,
// 2026-07-04). Pattern here:
//   WRITERS  → one tiny file per event in  live/{account}-pending/   (atomic)
//   READERS  → merge pending files into    live/{account}.json, dedup by id,
//              delete what they merged. Concurrent readers both merge the
//              same pending set → identical result → harmless.

import {
  getDropboxAccessToken, getDropboxRootNamespaceId,
  uploadToDropbox, downloadFromDropbox, createDropboxFolder,
} from './dropbox.js'

const BASE = '/Palm Ops/OF Webhooks/live'

function dbxHeaders(token, ns, json = true) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: ns }),
  }
}

export async function writeLiveEvent(accountId, entry) {
  const token = await getDropboxAccessToken()
  const ns = await getDropboxRootNamespaceId(token)
  await createDropboxFolder(token, ns, '/Palm Ops/OF Webhooks')
  await createDropboxFolder(token, ns, BASE)
  await createDropboxFolder(token, ns, `${BASE}/${accountId}-pending`)
  const name = `${Date.now()}-${String(entry.id).replace(/[^a-zA-Z0-9]/g, '').slice(-14)}-${Math.random().toString(36).slice(2, 6)}.json`
  await uploadToDropbox(token, ns, `${BASE}/${accountId}-pending/${name}`, Buffer.from(JSON.stringify(entry), 'utf8'))
}

export async function readLiveMerged(accountId) {
  const token = await getDropboxAccessToken()
  const ns = await getDropboxRootNamespaceId(token)

  let buf = []
  try {
    const b = await downloadFromDropbox(token, ns, `${BASE}/${accountId}.json`)
    if (b) buf = JSON.parse(b.toString('utf8'))
  } catch { /* none yet */ }

  // Merge + compact pending event files
  let names = []
  try {
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST', headers: dbxHeaders(token, ns),
      body: JSON.stringify({ path: `${BASE}/${accountId}-pending`, limit: 500 }),
    })
    if (res.ok) names = ((await res.json()).entries || []).filter((e) => e['.tag'] === 'file').map((e) => e.name)
  } catch { /* no pending folder yet */ }

  if (names.length) {
    const events = await Promise.all(names.map(async (n) => {
      try {
        const b = await downloadFromDropbox(token, ns, `${BASE}/${accountId}-pending/${n}`)
        return b ? JSON.parse(b.toString('utf8')) : null
      } catch { return null }
    }))
    const have = new Set(buf.map((e) => String(e.id)))
    for (const e of events.filter(Boolean)) {
      if (!have.has(String(e.id))) { buf.push(e); have.add(String(e.id)) }
    }
    buf.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
    buf = buf.slice(0, 400)
    await uploadToDropbox(token, ns, `${BASE}/${accountId}.json`, Buffer.from(JSON.stringify(buf), 'utf8'))
    // Cleanup ONLY files older than 10 minutes. Deleting immediately created
    // a reader-vs-reader race (a slow poll could re-write the buffer WITHOUT
    // events a faster poll had just merged+deleted — conversations visibly
    // vanished, 2026-07-04). Keeping recent files is free: merge dedups by id.
    const cutoff = Date.now() - 10 * 60000
    const stale = names.filter((n) => {
      const ts = parseInt(n.split('-')[0], 10)
      return !isNaN(ts) && ts < cutoff
    })
    await Promise.all(stale.map((n) =>
      fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST', headers: dbxHeaders(token, ns),
        body: JSON.stringify({ path: `${BASE}/${accountId}-pending/${n}` }),
      }).catch(() => {})
    ))
  }
  return buf
}
