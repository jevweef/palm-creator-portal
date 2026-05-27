'use client'

import { useEffect, useState, useCallback } from 'react'

// Publer mapping admin page.
// Phase 1 surface: sync Publer's live account list into Airtable + let admin
// pair each Publer account with a Palm Creator and tag it Real/AI.
//
// Layout intentionally bare — no fancy components. Adds value only because the
// data lives behind a Publer API key + an Airtable table that needs human
// curation. Phase 3 (live scheduling) will get a real dashboard.

export default function PublerAdminPage() {
  const [mappings, setMappings] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [lastSyncMsg, setLastSyncMsg] = useState('')
  // Local edit state, keyed by mapping row id. Lets the admin tweak several
  // dropdowns before clicking Save — avoids one PATCH per keystroke.
  const [edits, setEdits] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/publer/mappings')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `mappings ${res.status}`)
      setMappings(data.mappings || [])
      setCreators(data.creators || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const sync = async () => {
    setSyncing(true)
    setError('')
    setLastSyncMsg('')
    try {
      const res = await fetch('/api/admin/publer/sync-accounts', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `sync ${res.status}`)
      setLastSyncMsg(`Synced ${data.synced} (${data.created?.length || 0} new, ${data.updated?.length || 0} updated, ${data.skipped?.length || 0} skipped)`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const updateRow = (id, key, value) => {
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }))
  }

  const saveRow = async (row) => {
    const draft = edits[row.id] || {}
    if (!Object.keys(draft).length) return
    setError('')
    try {
      const updates = {}
      if ('creatorId' in draft) updates.creatorId = draft.creatorId || null
      if ('accountType' in draft) updates.accountType = draft.accountType || null
      if ('status' in draft) updates.status = draft.status || 'Active'
      if ('aiConsentOnFile' in draft) updates.aiConsentOnFile = draft.aiConsentOnFile || ''

      const res = await fetch('/api/admin/publer/mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, updates }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `patch ${res.status}`)
      setEdits(prev => { const n = { ...prev }; delete n[row.id]; return n })
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const cellVal = (row, key) => {
    if (edits[row.id] && key in edits[row.id]) return edits[row.id][key]
    if (key === 'creatorId') return row.creatorId || ''
    if (key === 'accountType') return row.accountType || ''
    if (key === 'status') return row.status || 'Active'
    if (key === 'aiConsentOnFile') return row.aiConsentOnFile || ''
    return ''
  }

  const isDirty = (rowId) => !!edits[rowId] && Object.keys(edits[rowId]).length > 0

  return (
    <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', color: 'var(--foreground)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Publer Accounts</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--foreground-muted)', fontSize: 13 }}>
            Map each Publer-connected social account to a Palm Creator. Tag AI-content accounts so the publish pipeline routes correctly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={loading} style={btn}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={sync} disabled={syncing} style={{ ...btn, background: 'var(--palm-pink)', color: '#fff', borderColor: 'var(--palm-pink)' }}>
            {syncing ? 'Syncing…' : 'Sync from Publer'}
          </button>
        </div>
      </header>

      {lastSyncMsg && (
        <div style={{ ...banner, background: 'rgba(125, 211, 164, 0.15)', borderColor: '#7DD3A4', color: '#0f4d2c' }}>
          {lastSyncMsg}
        </div>
      )}
      {error && (
        <div style={{ ...banner, background: 'rgba(239, 68, 68, 0.12)', borderColor: '#ef4444', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--background-alt)', textAlign: 'left' }}>
              <th style={th}>Account</th>
              <th style={th}>Channel</th>
              <th style={th}>Creator</th>
              <th style={th}>Account Type</th>
              <th style={th}>Status</th>
              <th style={th}>AI Consent (link)</th>
              <th style={th}>Last Synced</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map(row => {
              const dirty = isDirty(row.id)
              const nextType = cellVal(row, 'accountType')
              const nextConsent = cellVal(row, 'aiConsentOnFile')
              const aiNeedsConsent = nextType === 'AI' && !nextConsent?.trim()
              return (
                <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {row.picture && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.picture} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{row.accountName || '(unnamed)'}</div>
                        <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>{row.provider} · {row.publerAccountId.slice(0, 12)}…</div>
                      </div>
                    </div>
                  </td>
                  <td style={td}>{row.channel || '—'}</td>
                  <td style={td}>
                    <select
                      value={cellVal(row, 'creatorId')}
                      onChange={e => updateRow(row.id, 'creatorId', e.target.value)}
                      style={select}
                    >
                      <option value="">— pick creator —</option>
                      {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <select
                      value={cellVal(row, 'accountType')}
                      onChange={e => updateRow(row.id, 'accountType', e.target.value)}
                      style={select}
                    >
                      <option value="">—</option>
                      <option value="Real">Real</option>
                      <option value="AI">AI</option>
                    </select>
                  </td>
                  <td style={td}>
                    <select
                      value={cellVal(row, 'status')}
                      onChange={e => updateRow(row.id, 'status', e.target.value)}
                      style={select}
                    >
                      <option value="Active">Active</option>
                      <option value="Reauth Required">Reauth Required</option>
                      <option value="Disabled">Disabled</option>
                    </select>
                  </td>
                  <td style={td}>
                    <input
                      type="text"
                      placeholder={nextType === 'AI' ? 'REQUIRED for AI' : 'optional'}
                      value={cellVal(row, 'aiConsentOnFile')}
                      onChange={e => updateRow(row.id, 'aiConsentOnFile', e.target.value)}
                      style={{ ...select, width: 220, borderColor: aiNeedsConsent ? '#ef4444' : 'var(--border)' }}
                    />
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--foreground-muted)' }}>
                    {row.lastSynced ? new Date(row.lastSynced).toLocaleString() : '—'}
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => saveRow(row)}
                      disabled={!dirty || aiNeedsConsent}
                      style={{ ...btn, padding: '4px 10px', fontSize: 12, opacity: dirty && !aiNeedsConsent ? 1 : 0.4 }}
                      title={aiNeedsConsent ? 'AI accounts require AI Consent on File' : ''}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              )
            })}
            {!mappings.length && !loading && (
              <tr>
                <td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32, color: 'var(--foreground-muted)' }}>
                  No Publer accounts yet. Click <b>Sync from Publer</b> after connecting at least one account in the Publer dashboard.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: 'var(--foreground-muted)' }}>
        Tip: AI-tagged accounts require a non-empty AI Consent on File reference (TGP record ID, doc link, anything traceable). The publish pipeline blocks AI rows without one.
      </p>
    </div>
  )
}

const btn = {
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--background)',
  color: 'var(--foreground)',
  cursor: 'pointer',
}
const banner = {
  border: '1px solid',
  borderRadius: 6,
  padding: '10px 14px',
  marginBottom: 16,
  fontSize: 13,
}
const th = { padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }
const td = { padding: '10px 12px', verticalAlign: 'middle' }
const select = {
  padding: '4px 8px',
  fontSize: 13,
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--background)',
  color: 'var(--foreground)',
  minWidth: 120,
}
