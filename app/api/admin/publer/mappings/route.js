export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import {
  requireAdmin,
  fetchAirtableRecords,
  patchAirtableRecord,
} from '@/lib/adminAuth'

// GET /api/admin/publer/mappings
//   Returns every row in the Publer Accounts table + the list of Palm Creators
//   eligible to be paired with one (creators with Social Media Editing or
//   active status). The admin mapping UI binds these together — drop down to
//   pick Creator, drop down for Account Type, save → PATCH.
//
// Deliberately separate from /accounts (which proxies Publer's live data) —
// /mappings is the Airtable side. The admin UI shows BOTH: Publer's live list
// (via /accounts) so they can spot accounts not yet synced, and the Airtable
// side (via /mappings) for accounts already imported.
export async function GET() {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const [rows, creators] = await Promise.all([
      fetchAirtableRecords('Publer Accounts', {
        fields: [
          'Publer Account ID', 'Account Name', 'Channel', 'Publer Provider', 'Publer Picture',
          'Creator', 'Account Type', 'Status', 'AI Consent on File',
          'Connected At', 'Last Synced',
        ],
      }).catch(err => {
        if (err.message?.includes('NOT_FOUND') || err.message?.includes('404')) return null
        throw err
      }),
      fetchAirtableRecords('Palm Creators', {
        filterByFormula: `{Status}='Active'`,
        fields: ['Creator', 'AKA'],
      }),
    ])

    if (rows === null) {
      return NextResponse.json({
        ok: false,
        error: 'Publer Accounts table does not exist yet. Create it in Airtable per scoping doc §3.1.2.',
      }, { status: 412 })
    }

    const creatorOptions = creators
      .map(r => ({
        id: r.id,
        name: r.fields?.AKA || r.fields?.Creator || '(unnamed)',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const mappings = rows
      .map(r => {
        const f = r.fields || {}
        return {
          id: r.id,
          publerAccountId: f['Publer Account ID'] || '',
          accountName: f['Account Name'] || '',
          channel: f['Channel'] || null,
          provider: f['Publer Provider'] || '',
          picture: f['Publer Picture'] || '',
          creatorId: (f['Creator'] || [])[0] || null,
          accountType: f['Account Type'] || null,
          status: f['Status'] || 'Active',
          aiConsentOnFile: f['AI Consent on File'] || '',
          connectedAt: f['Connected At'] || null,
          lastSynced: f['Last Synced'] || null,
        }
      })
      .sort((a, b) => (a.accountName || '').localeCompare(b.accountName || ''))

    return NextResponse.json({ ok: true, mappings, creators: creatorOptions })
  } catch (err) {
    console.error('[admin/publer/mappings] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/admin/publer/mappings
//   body: { id: 'recXXX', updates: { creatorId, accountType, status, aiConsentOnFile } }
//
// Updates one Publer Accounts row. Validates that an AI-type row requires
// AI Consent on File — per scoping doc §6, AI accounts can't go live without
// documented consent. Returns 400 if violated.
export async function PATCH(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const body = await request.json()
    const { id, updates = {} } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Pull the current row so we can validate cross-field invariants
    // (e.g. AI-type + missing consent).
    const current = await fetchAirtableRecords('Publer Accounts', {
      filterByFormula: `RECORD_ID() = '${id}'`,
      fields: ['Publer Account ID', 'Account Type', 'AI Consent on File', 'Creator'],
    })
    if (!current.length) return NextResponse.json({ error: 'Publer Accounts row not found' }, { status: 404 })
    const cur = current[0].fields || {}

    // Compute next state after the patch — for the AI-consent check.
    const nextAccountType = 'accountType' in updates ? updates.accountType : cur['Account Type']
    const nextConsent = 'aiConsentOnFile' in updates ? updates.aiConsentOnFile : (cur['AI Consent on File'] || '')
    if (nextAccountType === 'AI' && !nextConsent?.trim()) {
      return NextResponse.json({
        error: 'Account Type=AI requires AI Consent on File. Add a link/reference to the TGP consent record first.',
      }, { status: 400 })
    }

    // Build Airtable patch from the camelCase updates input.
    const fields = {}
    if ('creatorId' in updates) {
      fields['Creator'] = updates.creatorId ? [updates.creatorId] : []
    }
    if ('accountType' in updates) fields['Account Type'] = updates.accountType || ''
    if ('status' in updates) fields['Status'] = updates.status || 'Active'
    if ('aiConsentOnFile' in updates) fields['AI Consent on File'] = updates.aiConsentOnFile || ''

    if (!Object.keys(fields).length) {
      return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
    }

    await patchAirtableRecord('Publer Accounts', id, fields, { typecast: true })
    return NextResponse.json({ ok: true, updated: id, fields })
  } catch (err) {
    console.error('[admin/publer/mappings] PATCH error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
