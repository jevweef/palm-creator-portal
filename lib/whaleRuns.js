// Last-run stamps for the whale-tab actions, kept as JSON on the creator's
// Palm Creators record ('Whale Runs'): { sales, audit, fanData, qa: ISO }.
// Read by the whales overview; stamped by each route on success. Non-fatal
// by design — a stamp failure never breaks the action it decorates.

import { fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

export async function stampWhaleRun(creatorRecordId, key) {
  try {
    const recs = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(creatorRecordId)}`,
      fields: ['Whale Runs'],
    })
    if (!recs.length) return
    let runs = {}
    try { runs = JSON.parse(recs[0].fields?.['Whale Runs'] || '{}') } catch {}
    runs[key] = new Date().toISOString()
    await patchAirtableRecord('Palm Creators', creatorRecordId, { 'Whale Runs': JSON.stringify(runs) })
  } catch (e) {
    console.warn(`[whaleRuns] stamp ${key} failed:`, e.message)
  }
}

export function parseWhaleRuns(raw) {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}
