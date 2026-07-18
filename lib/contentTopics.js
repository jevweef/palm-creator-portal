/**
 * Delete ALL of a creator's Telegram content-delivery topics in the SMM master
 * group and clear the Airtable fields that point at them:
 *   - the IG / FB / AI channel topics (Telegram IG/FB/AI Topic ID on the Ops
 *     Palm Creators record — Penny / Post Prep / Grid Planner delivery)
 *   - the per-account topics (Telegram Topic ID on each linked Creator
 *     Platform Directory row)
 *
 * Used when Social Media Editing is toggled OFF and during offboarding, so
 * dead creators never leave orphaned topics in the group. Best-effort per
 * topic: one failure doesn't stop the rest; everything is reported back.
 *
 * NOTE: CPD rows are matched to the creator in JS via the link array — a
 * filterByFormula FIND(recId, ARRAYJOIN({Creator})) silently never matches
 * (Airtable joins display values, not record ids).
 */
import { fetchAirtableRecords, patchAirtableRecord } from '@/lib/adminAuth'
import { deleteSmmTopic } from '@/lib/telegramTopics'
import { quoteAirtableString } from '@/lib/airtableFormula'

const CHANNEL_FIELDS = [
  ['Telegram IG Topic ID', 'IG channel'],
  ['Telegram FB Topic ID', 'FB channel'],
  ['Telegram AI Topic ID', 'AI channel'],
]

export async function deleteCreatorContentTopics(opsId) {
  const deleted = []
  const failed = []
  if (!opsId) return { deleted, failed }

  // 1) IG / FB / AI channel topics on the Ops Palm Creators record.
  let rec = null
  try {
    const rows = await fetchAirtableRecords('Palm Creators', {
      filterByFormula: `RECORD_ID() = ${quoteAirtableString(opsId)}`,
      fields: ['Creator', 'AKA', ...CHANNEL_FIELDS.map(([f]) => f)],
    })
    rec = rows[0] || null
  } catch (e) {
    failed.push({ what: 'Palm Creators lookup', error: e.message })
  }
  if (rec) {
    const clear = {}
    for (const [field, label] of CHANNEL_FIELDS) {
      const topicId = rec.fields?.[field]
      if (!topicId) continue
      try {
        await deleteSmmTopic(topicId)
        clear[field] = null
        deleted.push(label)
      } catch (e) {
        failed.push({ what: label, error: e.message })
      }
    }
    if (Object.keys(clear).length) {
      try {
        await patchAirtableRecord('Palm Creators', rec.id, clear)
      } catch (e) {
        failed.push({ what: 'clearing channel topic fields', error: e.message })
      }
    }
  }

  // 2) Per-account topics on linked CPD rows (JS link-match, see NOTE above).
  try {
    const cpdRows = await fetchAirtableRecords('Creator Platform Directory', {
      filterByFormula: `{Telegram Topic ID} != ''`,
      fields: ['Creator', 'Account Name', 'Telegram Topic ID'],
    })
    for (const row of cpdRows) {
      const link = row.fields?.Creator
      if (!Array.isArray(link) || !link.includes(opsId)) continue
      const accName = row.fields?.['Account Name'] || row.id
      try {
        await deleteSmmTopic(row.fields['Telegram Topic ID'])
        await patchAirtableRecord('Creator Platform Directory', row.id, { 'Telegram Topic ID': null })
        deleted.push(accName)
      } catch (e) {
        failed.push({ what: accName, error: e.message })
      }
    }
  } catch (e) {
    failed.push({ what: 'CPD lookup', error: e.message })
  }

  return { deleted, failed }
}
