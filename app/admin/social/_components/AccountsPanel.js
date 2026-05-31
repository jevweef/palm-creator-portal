'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import EmptyState from './EmptyState'

// AccountsPanel — one home for posting accounts, split by type so real and AI
// never blur. AI-posting accounts come from the AI Account Profile table
// (reusing /api/admin/smm/warmup/accounts). Credentials are NEVER shown here —
// they live in the Bitwarden vault (D4); we only link out.
const STATUS_STYLE = {
  Active:     { bg: 'rgba(125,211,164,0.12)', fg: '#7DD3A4' },
  Graduated:  { bg: 'rgba(125,211,164,0.12)', fg: '#7DD3A4' },
  Warming:    { bg: 'rgba(232,195,106,0.12)', fg: '#E8C36A' },
  Warmup:     { bg: 'rgba(232,195,106,0.12)', fg: '#E8C36A' },
  Paused:     { bg: 'rgba(232,120,120,0.10)', fg: '#E87878' },
  Setup:      { bg: 'rgba(255,255,255,0.06)', fg: 'var(--foreground-muted)' },
}
function statusStyle(s) {
  const key = Object.keys(STATUS_STYLE).find(k => (s || '').toLowerCase().includes(k.toLowerCase()))
  return STATUS_STYLE[key] || STATUS_STYLE.Setup
}

const VAULT_URL = 'https://vault.bitwarden.com'
// Deep-link to a specific Bitwarden item (the stored ID is NOT the secret).
function vaultItemUrl(id) {
  return id ? `${VAULT_URL}/#/vault?itemId=${encodeURIComponent(id)}` : VAULT_URL
}

function SectionHeader({ title, count }) {
  return (
    <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      {title}
      {typeof count === 'number' && (
        <span style={{ padding: '2px 8px', fontSize: 10, fontWeight: 700, borderRadius: 10, background: 'rgba(167,139,250,0.14)', color: '#a78bfa' }}>{count}</span>
      )}
    </h2>
  )
}

export default function AccountsPanel() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/smm/warmup/accounts')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load accounts')
        if (alive) setAccounts(data.accounts || [])
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {/* Credentials policy banner */}
      <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.18)', fontSize: 13, color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>Passwords and logins live in the <strong style={{ color: 'var(--foreground)' }}>Bitwarden vault</strong> — never stored here.</span>
        <a href={VAULT_URL} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 8, background: '#a78bfa', color: '#1a1a1a', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>Open vault</a>
      </div>

      {/* AI-posting accounts */}
      <div>
        <SectionHeader title="AI-Posting Accounts" count={loading ? undefined : accounts.length} />
        {loading ? (
          <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: '24px 0' }}>Loading accounts…</div>
        ) : error ? (
          <div style={{ color: '#E87878', fontSize: 13 }}>{error}</div>
        ) : accounts.length === 0 ? (
          <EmptyState title="No AI accounts yet" message="New AI persona accounts created in Warm-Up will appear here." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {accounts.map(a => {
              const st = statusStyle(a.warmupStatus)
              return (
                <div key={a.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>{a.personaName || '(unnamed)'}</div>
                      {a.personaHandle && <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>@{a.personaHandle.replace(/^@/, '')}</div>}
                    </div>
                    <span style={{ padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{a.warmupStatus || 'Setup'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--foreground-muted)' }}>
                    {a.pixelDevice && <div>Device · {a.pixelDevice}</div>}
                    {a.fbProfileSlot && <div>FB slot · {a.fbProfileSlot}</div>}
                    {Array.isArray(a.publerAccountIds) && a.publerAccountIds.length > 0 && <div>Publer · {a.publerAccountIds.length} linked</div>}
                  </div>
                  {/* Vault items present for this account — each links to the
                      specific Bitwarden item (IDs, never the secret). */}
                  {a.vaultRefs && (a.vaultRefs.ig || a.vaultRefs.fb || a.vaultRefs.gmail || a.vaultRefs.recovery) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
                      <span style={{ color: 'var(--foreground-subtle)' }}>Vault:</span>
                      {[['IG', a.vaultRefs.ig], ['FB', a.vaultRefs.fb], ['Gmail', a.vaultRefs.gmail], ['Recovery', a.vaultRefs.recovery]]
                        .filter(([, id]) => id)
                        .map(([label, id]) => (
                          <a key={label} href={vaultItemUrl(id)} target="_blank" rel="noopener noreferrer" title="Open in Bitwarden vault"
                            style={{ padding: '2px 8px', borderRadius: 9999, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>{label}</a>
                        ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                    {a.beaconsUrl && <a href={a.beaconsUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>Beacons ↗</a>}
                    <a href={VAULT_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--foreground-muted)', textDecoration: 'none', fontWeight: 600 }}>Vault ↗</a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Real-posting accounts */}
      <div>
        <SectionHeader title="Real-Posting Accounts" />
        <div style={{ padding: 20, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', fontSize: 13, color: 'var(--foreground-muted)', lineHeight: 1.6 }}>
          Real creators&apos; own posting accounts are managed per-creator in{' '}
          <Link href="/admin/creators" style={{ color: 'var(--palm-pink)', fontWeight: 600, textDecoration: 'none' }}>Creators</Link>.
          Real content routes to those accounts via the existing Telegram-to-human pipe; it never mixes with AI accounts above.
        </div>
      </div>
    </div>
  )
}
