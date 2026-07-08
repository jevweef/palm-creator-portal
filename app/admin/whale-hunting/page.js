'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import AuditTab from './AuditTab'

export default function WhaleHuntingPage() {
  const router = useRouter()
  const pathname = usePathname()
  const [tab, setTab] = useState('audit')

  // ── Universal keyboard navigation ─────────────────────────────────────────
  // Works over ANY element tagged data-kbrow, in document order — Save List,
  // Dormant Whales, Fan CRM, and whatever gets added later; no per-section
  // wiring. ↑/↓ move the highlight (auto-opens a closed <details>), Enter
  // clicks the row (opens its modal). While a fan modal is open
  // ([data-fan-modal]): ←/→ = prev/next fan, Esc closes.
  useEffect(() => {
    let current = null
    const clear = () => { if (current) { current.style.outline = ''; current.style.backgroundColor = '' } }
    const setCur = (el) => {
      clear(); current = el
      if (el) {
        el.style.outline = '1px solid rgba(160,111,232,0.55)'
        el.style.backgroundColor = 'rgba(160,111,232,0.12)'
        el.scrollIntoView({ block: 'nearest' })
      }
    }
    function onKey(e) {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      const modal = document.querySelector('[data-fan-modal]')
      if (modal) {
        if (e.key === 'Escape') modal.querySelector('[data-kb-close]')?.click()
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); modal.querySelector('[data-kb-next]')?.click() }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); modal.querySelector('[data-kb-prev]')?.click() }
        return
      }
      const list = [...document.querySelectorAll('[data-kbrow]')]
      if (!list.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        let i = current ? list.indexOf(current) : -1
        i = e.key === 'ArrowDown' ? Math.min(i + 1, list.length - 1) : Math.max(i - 1, 0)
        const el = list[i]
        const det = el.closest('details')
        if (det && !det.open) det.open = true
        setCur(el)
      } else if (e.key === 'Enter' && current) {
        current.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clear() }
  }, [])

  // Read tab from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t === 'audit' || t === 'internal' || t === 'team') setTab(t)
  }, [])

  function switchTab(key) {
    setTab(key)
    // Preserve other params (e.g. ?creator= from the Live Audit picker)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', key)
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>🐋 Whale Hunting</h1>
        <p style={{ fontSize: '13px', color: 'rgba(240, 236, 232, 0.75)', margin: '6px 0 0' }}>
          Aggregate reports across analyzed whales. Per-fan briefs live on each creator&apos;s Fans tab.
        </p>
      </div>

      {/* Tab headers */}
      <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '24px' }}>
        {[
          { key: 'audit', label: 'Live Audit' },
          { key: 'internal', label: 'Palm Internal' },
          { key: 'team', label: 'Chat Team Report' },
        ].map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            style={{
              padding: '10px 0', fontSize: '13px', fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--foreground)' : 'var(--foreground-muted)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t.key ? '1px solid var(--palm-pink)' : '2px solid transparent',
              marginBottom: '-1px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'audit' && <AuditTab />}
      {tab === 'internal' && <PalmInternalTab />}
      {tab === 'team' && <ChatTeamTab />}
    </div>
  )
}

// Shared: fetch the latest overnight report once per tab mount
function useDailyReport() {
  const [data, setData] = useState(null)
  const [date, setDate] = useState('')
  useEffect(() => {
    fetch(`/api/admin/whales/daily-report${date ? `?date=${date}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ report: null, available: [] }))
  }, [date])
  return { report: data?.report || null, available: data?.available || [], date, setDate, loading: data === null }
}

function ReportHeader({ report, available, date, setDate, loading }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#A06FE8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overnight report</span>
      {available.length > 0 ? (
        <select value={date || available[0]} onChange={(e) => setDate(e.target.value)}
          style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px 10px', fontSize: '12px' }}>
          {available.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      ) : (
        <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
          {loading ? 'Loading…' : 'No reports yet — the analyst runs every night at ~3am ET and the first report lands tomorrow morning.'}
        </span>
      )}
      {report?.partial && <span style={{ fontSize: '11px', color: '#E8C878' }}>partial — completing on the next pass</span>}
    </div>
  )
}

function PalmInternalTab() {
  const { report, available, date, setDate, loading } = useDailyReport()
  const demand = (report?.perCreator || []).flatMap((c) => (c.contentDemand || []).map((d) => ({ ...d, creator: c.aka })))
  const stats = (report?.perCreator || [])
  if (report) return (
    <div>
      <SectionCard
        title="Strategic visibility into whale performance across all creators"
        description="Built nightly from yesterday's live chat data (webhooks — no credits burned)."
      />
      <ReportHeader report={report} available={available} date={date} setDate={setDate} loading={loading} />

      <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '10px' }}>Yesterday at a glance</div>
        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
          <thead><tr style={{ color: 'var(--foreground-muted)', textAlign: 'left' }}><th style={{ padding: '4px 8px' }}>Creator</th><th style={{ textAlign: 'right' }}>Chatter msgs</th><th style={{ textAlign: 'right' }}>Fan msgs</th><th style={{ textAlign: 'right' }}>Fans touched</th><th style={{ textAlign: 'right' }}>Sales</th><th style={{ textAlign: 'right', padding: '4px 8px' }}>$ Sales</th></tr></thead>
          <tbody>
            {stats.map((c) => (
              <tr key={c.aka} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.aka}</td>
                <td style={{ textAlign: 'right' }}>{c.stats?.outbound ?? 0}</td>
                <td style={{ textAlign: 'right' }}>{c.stats?.inbound ?? 0}</td>
                <td style={{ textAlign: 'right' }}>{c.stats?.fansMessaged ?? 0}</td>
                <td style={{ textAlign: 'right' }}>{c.stats?.sales ?? 0}</td>
                <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>${(c.stats?.salesTotal ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--foreground-muted)', marginBottom: '10px' }}>Content demand — what fans asked for yesterday</div>
        {demand.length === 0 && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>No explicit content requests surfaced.</div>}
        {demand.map((d, i) => (
          <div key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', padding: '8px 0' }}>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>{d.theme} <span style={{ color: '#C4A5F7', fontWeight: 400 }}>· {d.creator}</span> <span style={{ color: 'var(--foreground-muted)', fontWeight: 400 }}>×{d.count || 1}</span></div>
            {(d.quotes || []).slice(0, 2).map((q, j) => <div key={j} style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontStyle: 'italic', marginTop: '2px' }}>&ldquo;{q}&rdquo;</div>)}
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div>
      <SectionCard
        title="Strategic visibility into whale performance across all creators"
        description="Built nightly from yesterday's live chat data (webhooks — no credits burned)."
      />
      <ReportHeader report={report} available={available} date={date} setDate={setDate} loading={loading} />
    </div>
  )
}

function PalmInternalTabLegacy() {
  return (
    <div>
      <SectionCard
        title="Strategic visibility into whale performance across all creators"
        description="For Palm leadership. Cross-creator LTV curves, patron-tier churn, archetype distribution, pricing elasticity, content demand clusters, chat team health in aggregate."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '16px' }}>
        <ComingSoonCard
          title="Patron-Tier Retention"
          description="How many $3k+ fans stayed engaged this quarter across all creators. Who slipped, who held."
        />
        <ComingSoonCard
          title="Cross-Creator Revenue Attribution"
          description="Which creators, accounts, and archetype mixes drive revenue. Where the leaks are."
        />
        <ComingSoonCard
          title="Content Demand Clusters"
          description="What content types fans are asking for across all creators. Unmet demand, hot categories, shoot priorities."
        />
        <ComingSoonCard
          title="Pricing Elasticity"
          description="Where fans convert vs where they push back. Optimal PPV bands by archetype."
        />
        <ComingSoonCard
          title="Early Whale Signals"
          description="New subs on patron-tier trajectory based on first 30 days of behavior. Proactive whale identification."
        />
        <ComingSoonCard
          title="Chat Team Health (Aggregate)"
          description="Response times, mass-template usage rate, archetype-match rate, quote-back rate across the entire team."
        />
      </div>

      <div style={{
        marginTop: '32px', padding: '16px 20px', background: 'rgba(232, 200, 120, 0.08)',
        border: '1px solid #FDE68A', borderRadius: '8px', fontSize: '12px', color: '#78350F',
      }}>
        <strong>Phase 1:</strong> Per-fan analysis format has been rebuilt with the new
        classification + dossier + diagnosis + prescription pipeline. This page will populate
        once we&apos;ve accumulated ~10-20 analyses in the new format — the reports aggregate over
        the structured data each brief produces.
      </div>
    </div>
  )
}

function ChatTeamTab() {
  const { report, available, date, setDate, loading } = useDailyReport()
  if (report) {
    const rows = report.perCreator || []
    const flags = rows.flatMap((c) => (c.authenticity || []).map((a) => ({ ...a, creator: c.aka })))
    const templates = rows.flatMap((c) => (c.massTemplates || []).map((t) => ({ ...t, creator: c.aka })))
    const wins = rows.flatMap((c) => (c.wins || []).map((w) => ({ ...w, creator: c.aka })))
    const SEV = { high: '#E87878', medium: '#E8C878' }
    return (
      <div>
        <SectionCard
          title="What gets sent to the chat manager"
          description="Pattern-level observations from yesterday's chats. Focuses on behaviors, not individuals."
        />
        <ReportHeader report={report} available={available} date={date} setDate={setDate} loading={loading} />

        <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#E87878', marginBottom: '10px' }}>Authenticity flags — doesn&apos;t sound like her</div>
          {flags.length === 0 && <div style={{ fontSize: '12px', color: '#7DD3A4' }}>No authenticity problems flagged yesterday.</div>}
          {flags.map((f, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', padding: '9px 0' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ color: SEV[f.severity] || 'var(--foreground)', fontSize: '11px', textTransform: 'uppercase' }}>{f.severity}</b>
                {(f.issues || []).map((iss) => <span key={iss} style={{ background: 'rgba(232,120,120,0.1)', color: '#E87878', padding: '1px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>{iss}</span>)}
                <span style={{ fontSize: '11px', color: '#C4A5F7' }}>{f.creator}</span>
                <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>to {f.fan}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--foreground)', marginTop: '3px', fontStyle: 'italic' }}>&ldquo;{f.message}&rdquo;</div>
              {f.note && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px' }}>{f.note}</div>}
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#E8C878', marginBottom: '10px' }}>Mass-template detection — same script, many fans</div>
          {templates.length === 0 && <div style={{ fontSize: '12px', color: '#7DD3A4' }}>No repeated scripts in 1:1 chats yesterday.</div>}
          {templates.map((t, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', padding: '9px 0' }}>
              <div style={{ fontSize: '12px' }}><b>{t.fanCount} fans</b> <span style={{ color: '#C4A5F7' }}>· {t.creator}</span>{t.whalesHit?.length ? <span style={{ color: '#E87878', fontWeight: 700 }}> · hit {t.whalesHit.length} whale{t.whalesHit.length > 1 ? 's' : ''}: {t.whalesHit.join(', ')}</span> : null}</div>
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontStyle: 'italic', marginTop: '2px' }}>&ldquo;{t.text}&rdquo;</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px 18px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7DD3A4', marginBottom: '10px' }}>Wins to replicate</div>
          {wins.length === 0 && <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>None surfaced yesterday.</div>}
          {wins.map((w, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none', padding: '8px 0', fontSize: '12px' }}>
              <b style={{ color: '#C4A5F7' }}>{w.creator}</b> · {w.fan}: <span style={{ color: 'var(--foreground)' }}>{w.note}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div>
      <SectionCard
        title="What gets sent to the chat manager"
        description="Pattern-level observations from yesterday's chats. Focuses on behaviors, not individuals."
      />
      <ReportHeader report={report} available={available} date={date} setDate={setDate} loading={loading} />
    </div>
  )
}

function ChatTeamTabLegacy() {
  return (
    <div>
      <SectionCard
        title="What gets sent to the chat manager"
        description="Pattern-level observations across the chat team's work. Diplomatic — focuses on behaviors, not individuals. Meant to give the manager evidence-backed coaching material."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '16px' }}>
        <ComingSoonCard
          title="Mass-Template Detection"
          description="Same script sent to multiple fans — including known whales. Which scripts, how many fans, revenue at risk."
        />
        <ComingSoonCard
          title="Pricing-vs-Budget Audit"
          description="Fans who stated a budget ceiling + got priced above it. Exact quotes, dates, pricing gaps."
        />
        <ComingSoonCard
          title="Archetype-Script Mismatches"
          description="Specific scripts sent to the wrong fan types (e.g. hardcore to romantic, humiliation to praise-seekers)."
        />
        <ComingSoonCard
          title="Quote-Back Rate"
          description="Creator messages that echo the fan's words without adding substance. Engagement-killer for relationship fans."
        />
        <ComingSoonCard
          title="Wins to Replicate"
          description="Where the team nailed it this period — specific interactions that converted. Training material."
        />
        <ComingSoonCard
          title="Anonymized Case Studies"
          description="2-3 deep-dives per period — what happened, what could have gone differently, lesson extracted. No individual chatter names."
        />
      </div>

      <div style={{
        marginTop: '32px', padding: '16px 20px', background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#374151',
      }}>
        <strong>Cadence:</strong> Weekly digest + monthly retrospective. Output is a single
        downloadable PDF/doc the chat manager can read on their own and use for coaching conversations.
      </div>
    </div>
  )
}

function SectionCard({ title, description }) {
  return (
    <div style={{
      padding: '20px 24px', background: 'var(--card-bg-solid)', borderRadius: '12px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.04)', border: 'none',
    }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.6' }}>{description}</div>
    </div>
  )
}

function ComingSoonCard({ title, description }) {
  return (
    <div style={{
      padding: '16px 18px', background: 'var(--card-bg-solid)', borderRadius: '10px',
      border: '1px dashed rgba(255,255,255,0.08)', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: '10px', right: '12px', fontSize: '9px', fontWeight: 700,
        color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>Coming Soon</div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '11px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.5' }}>{description}</div>
    </div>
  )
}
