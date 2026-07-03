'use client'

// Live Audit tab — the daily check-in for fan spending health + chatter QA.
// Button-triggered everything (no crons yet, per Evan — we train the triggers
// first). Rendered as the first tab of /admin/whale-hunting.
//
// Sections:
//  1. Creator picker — Run Audit works for anyone with sheet data;
//     Chatter QA / Update Fan Data need the OF API connection
//  2. Run Audit — transactions → per-fan personalized cadence → tier flags
//  3. Run Chatter QA — recent chatter-sent messages judged against her voice
//  4. Watchlist — Fan Tracker rows still in play (deep-links to Fans panel)

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const TIER_COLORS = {
  warning: { bg: 'rgba(232, 200, 120, 0.12)', color: '#E8C878' },
  high: { bg: 'rgba(232, 140, 92, 0.12)', color: '#E88C5C' },
  critical: { bg: 'rgba(232, 120, 120, 0.15)', color: '#E87878' },
  dead: { bg: 'rgba(150, 150, 150, 0.12)', color: '#999' },
}
const SEV_COLORS = { low: '#E8C878', medium: '#E88C5C', high: '#E87878' }

export default function AuditTab() {
  const [creators, setCreators] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [showAllWatchlist, setShowAllWatchlist] = useState(false)
  const [creatorId, setCreatorId] = useState('')
  const [loading, setLoading] = useState(true)
  const [audit, setAudit] = useState(null)
  const [auditing, setAuditing] = useState(false)
  const [qa, setQa] = useState(null)
  const [qaRunning, setQaRunning] = useState(false)
  const [sync, setSync] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whales/overview')
      const data = await res.json()
      if (res.ok) {
        setCreators(data.creators || [])
        setWatchlist(data.watchlist || [])
        // Functional update — avoids the stale-closure reset that snapped the
        // picker back to the first creator after every audit.
        const first = (data.creators || []).find((c) => c.connected)
        if (first) setCreatorId((prev) => prev || first.id)
      }
    } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  const selected = creators.find((c) => c.id === creatorId)
  const visibleWatchlist = showAllWatchlist ? watchlist : watchlist.filter((w) => w.creatorId === creatorId)

  async function runAudit() {
    setAuditing(true); setError(null); setAudit(null)
    try {
      const res = await fetch('/api/admin/whales/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Audit failed')
      setAudit(data)
      load() // refresh watchlist with any new flags
    } catch (e) { setError(e.message) } finally { setAuditing(false) }
  }

  async function runQa() {
    setQaRunning(true); setError(null); setQa(null)
    try {
      const res = await fetch('/api/admin/whales/chatter-qa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'QA failed')
      setQa(data)
    } catch (e) { setError(e.message) } finally { setQaRunning(false) }
  }

  // Archive sync — STRICTLY ADDITIVE: appends full-fidelity transactions
  // (fan_id-keyed) + fan snapshots to /Palm Ops/OF Archive/. Never touches
  // the invoice spreadsheet or invoicing flow. Returns rebill-off alerts.
  async function runSync() {
    setSyncing(true); setError(null); setSync(null)
    try {
      const res = await fetch('/api/admin/whales/archive-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorRecordId: creatorId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSync(data)
    } catch (e) { setError(e.message) } finally { setSyncing(false) }
  }

  const card = { background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px' }
  const h2 = { fontSize: '13px', fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }
  const btn = (bg, color, disabled) => ({
    background: bg, color, border: 'none', borderRadius: '8px', padding: '9px 18px',
    fontSize: '13px', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  })

  if (loading) return <div style={{ padding: '40px', color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading whale dashboard…</div>

  return (
    <div style={{ padding: '18px 0', display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <select value={creatorId} onChange={(e) => { setCreatorId(e.target.value); setAudit(null); setQa(null) }}
          style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>{c.aka}{c.connected ? ' ✓' : ' (not connected)'}</option>
          ))}
        </select>
        {selected && !selected.connected && (
          <span style={{ fontSize: '12px', color: '#E8C878' }}>
            Not connected — add her OF account at app.onlyfansapi.com, then set “OF API Account ID” on her creator record.
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={runAudit} disabled={auditing} style={btn('rgba(125, 211, 164, 0.12)', '#7DD3A4', auditing)}>
          {auditing ? 'Auditing…' : 'Run Audit'}
        </button>
        <button onClick={runQa} disabled={qaRunning || !selected?.connected} style={btn('rgba(196, 165, 247, 0.12)', '#A06FE8', qaRunning || !selected?.connected)}>
          {qaRunning ? 'Reviewing chats…' : 'Run Chatter QA'}
        </button>
        <button onClick={runSync} disabled={syncing || !selected?.connected} style={btn('rgba(120, 180, 232, 0.12)', '#78B4E8', syncing || !selected?.connected)}>
          {syncing ? 'Updating fan data…' : 'Update Fan Data'}
        </button>
      </div>

      {error && <div style={{ ...card, borderColor: 'rgba(232,120,120,0.35)', color: '#E87878', fontSize: '13px' }}>{error}</div>}

      {/* Audit results */}
      {audit && (
        <div style={card}>
          <h2 style={h2}>Audit — {audit.creator} ({audit.window})</h2>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
            {audit.transactions} transactions · {audit.fansWithSpend} paying fans · {audit.fansOverMinimum} over minimum ·
            flagged {audit.triggered.length} · tracker: +{audit.tracker.created} new, {audit.tracker.updated} updated ·
            {audit.source ? ` source: ${audit.source}` : ''}
          </div>
          {audit.triggered.length > 0 && (
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginBottom: '14px' }}>
              <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Fan</th><th>Tier</th><th>Lifetime</th><th>Rhythm</th><th>Silent</th><th>30d</th><th>Last buy</th>
              </tr></thead>
              <tbody>
                {audit.triggered.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{t.fanName}{t.ofUsername ? <span style={{ color: 'var(--foreground-muted)' }}> @{t.ofUsername}</span> : null}</td>
                    <td><span style={{ ...TIER_COLORS[t.tier] ? { background: TIER_COLORS[t.tier].bg, color: TIER_COLORS[t.tier].color } : {}, padding: '2px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>{t.tier}</span></td>
                    <td>${Math.round(t.lifetime)}</td>
                    <td>every ~{t.medianGap}d</td>
                    <td>{t.currentGap}d ({t.gapRatio}×)</td>
                    <td>${Math.round(t.rolling30)}</td>
                    <td>{t.lastPurchaseDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary style={{ fontSize: '12px', color: 'var(--foreground-muted)', cursor: 'pointer' }}>Top spenders ({audit.topSpenders.length})</summary>
            <div style={{ fontSize: '12px', color: 'var(--foreground)', marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '6px' }}>
              {audit.topSpenders.map((t, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--background)', borderRadius: '6px' }}>
                  <b>${Math.round(t.lifetime)}</b> — {t.fanName}
                  <span style={{ color: 'var(--foreground-muted)' }}> · {t.purchases} buys{t.tier ? ` · ${t.tier}` : ''}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Chatter QA results */}
      {qa && (
        <div style={card}>
          <h2 style={h2}>Chatter QA — {qa.creator} (last {qa.days}d)</h2>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
            {qa.chatsScanned} chats · {qa.messagesReviewed} chatter messages reviewed ·
            {qa.hasVoiceProfile ? ' judged against her voice profile' : ' no voice profile on file (generic judgment)'} ·
            {qa.findings.length === 0 ? ' no problems found ✓' : ` ${qa.findings.length} flagged`}
          </div>
          {qa.findings.map((fd, i) => (
            <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 4px', fontSize: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                <b style={{ color: SEV_COLORS[fd.severity] || 'var(--foreground)' }}>{(fd.severity || '').toUpperCase()}</b>
                {(fd.issues || []).map((iss) => (
                  <span key={iss} style={{ background: 'rgba(232,120,120,0.1)', color: '#E87878', padding: '1px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{iss}</span>
                ))}
                <span style={{ color: 'var(--foreground-muted)' }}>to {fd.fan} · {fd.at ? new Date(fd.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''} ET</span>
              </div>
              <div style={{ color: 'var(--foreground)', marginBottom: '3px' }}>“{fd.message}”</div>
              <div style={{ color: 'var(--foreground-muted)' }}>{fd.why}</div>
              {fd.better && <div style={{ color: '#7DD3A4', marginTop: '3px' }}>↳ better: “{fd.better}”</div>}
            </div>
          ))}
        </div>
      )}

      {/* Archive sync + rebill-off alerts */}
      {sync && (
        <div style={card}>
          <h2 style={h2}>Fan Data — {sync.creator}</h2>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '12px' }}>
            {sync.fanCount} active fans snapshotted (spend, sub price, auto-renew, last seen) · saved to Dropbox {sync.archivePath}
          </div>
          <h2 style={{ ...h2, marginTop: '6px' }}>Rebill OFF — save these subs ({sync.rebillOff?.length ?? 0})</h2>
          {(sync.rebillOff || []).length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>No high-value fans set to expire. ✓</div>
          ) : (
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Fan</th><th>Lifetime</th><th>Tips</th><th>PPV</th><th>Expires</th><th>Last seen</th><th></th>
              </tr></thead>
              <tbody>
                {sync.rebillOff.map((f) => (
                  <tr key={f.fanId} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                      {f.name}{f.username ? <span style={{ color: 'var(--foreground-muted)' }}> @{f.username}</span> : null}
                      {f.newThisSync && <span style={{ marginLeft: '6px', background: 'rgba(232,120,120,0.15)', color: '#E87878', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>NEW</span>}
                    </td>
                    <td>${Math.round(f.total)}</td>
                    <td>${Math.round(f.tips)}</td>
                    <td>${Math.round(f.messages)}</td>
                    <td>{f.expireDate ? new Date(f.expireDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td style={{ color: 'var(--foreground-muted)' }}>{f.lastSeen ? new Date(f.lastSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td>
                      <Link href={'/admin/creators?creator=' + encodeURIComponent(sync.creator) + '&tab=fans'} style={{ color: '#A06FE8', fontSize: '11px' }}>open in Fans →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Watchlist — follows the selected creator; toggle to see everyone */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={h2}>
            Watchlist — {showAllWatchlist ? 'all creators' : (selected?.aka || 'this creator')} ({visibleWatchlist.length})
          </h2>
          <label style={{ fontSize: '11px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', marginBottom: '12px' }}>
            <input type="checkbox" checked={showAllWatchlist} onChange={(e) => setShowAllWatchlist(e.target.checked)} />
            show all creators
          </label>
        </div>
        {visibleWatchlist.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)' }}>
            {showAllWatchlist ? 'Nothing flagged anywhere. Run an audit to scan a creator.' : `Nothing flagged for ${selected?.aka || 'this creator'} yet — run an audit, or tick "show all creators".`}
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px' }}>Fan</th><th>Creator</th><th>Status</th><th>Lifetime</th><th>Alerts</th><th>Last result</th><th></th>
            </tr></thead>
            <tbody>
              {visibleWatchlist.map((w) => (
                <tr key={w.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'var(--foreground)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{w.fanName}{w.ofUsername ? <span style={{ color: 'var(--foreground-muted)' }}> @{w.ofUsername}</span> : null}</td>
                  <td>{w.creator}</td>
                  <td><span style={{ background: w.status === 'Going Cold' ? 'rgba(232,200,120,0.12)' : 'rgba(125,211,164,0.1)', color: w.status === 'Going Cold' ? '#E8C878' : '#7DD3A4', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>{w.status}</span></td>
                  <td>${Math.round(w.lifetime)}</td>
                  <td>{w.alertCount || 0}</td>
                  <td style={{ color: 'var(--foreground-muted)' }}>{w.effectiveness || '—'}</td>
                  <td>
                    <Link href={`/admin/creators?creator=${encodeURIComponent(w.creator)}&tab=fans`} style={{ color: '#A06FE8', fontSize: '11px' }}>
                      open in Fans →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
