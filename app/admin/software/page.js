'use client'

// Software Stack — the agency's subscription ledger (HQ "Software Stack" table,
// the same one Scrooge audits each morning). Grouped by status, with the
// can't-tell-if-still-billing ones flagged for review, Fixed vs Variable cost,
// and unsubscribed software stacked at the bottom with cancellation dates.
//
// NOTE: exact last-paid amount + monthly average for VARIABLE subs come from the
// Chase transaction feed (the next build) — until then we show the estimate +
// the notes range.

import { useState, useEffect } from 'react'

const FG = 'var(--foreground)'
const MUTED = 'var(--foreground-muted)'
const CARD = 'var(--card-bg-solid)'
const BORDER = '1px solid rgba(255,255,255,0.07)'

const STATUS_COLOR = {
  Active: { bg: 'rgba(70,196,106,0.12)', fg: '#46c46a' },
  Evaluating: { bg: 'rgba(224,176,80,0.12)', fg: '#e0b050' },
  Paused: { bg: 'rgba(224,138,74,0.12)', fg: '#e08a4a' },
  Cancelled: { bg: 'rgba(255,255,255,0.05)', fg: '#9a9a9a' },
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

function Pill({ text, color }) {
  const c = STATUS_COLOR[text] || { bg: 'rgba(255,255,255,0.05)', fg: MUTED }
  return <span style={{ background: color?.bg || c.bg, color: color?.fg || c.fg, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{text}</span>
}

function Row({ t }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.7fr 1fr 0.85fr 2.1fr', gap: 12, alignItems: 'center', padding: '11px 14px', borderTop: BORDER, fontSize: 13, color: FG }}>
      <div style={{ fontWeight: 600 }}>{t.name}
        {t.uncertain && <span title="Active but no recent charge — verify" style={{ marginLeft: 7, color: '#e0b050', fontWeight: 800 }}>⚠</span>}
      </div>
      <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(t.monthlyCost)}<span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}>/mo</span></div>
      <div><span style={{ fontSize: 11, fontWeight: 600, color: t.costType === 'Variable' ? '#6aa8ff' : MUTED }}>{t.costType}</span></div>
      <div style={{ color: t.uncertain ? '#e0b050' : MUTED }}>
        {t.lastPayment ? fmtDate(t.lastPayment) : 'none on record'}
        {t.daysSincePayment != null && <span style={{ color: MUTED, fontSize: 11 }}> · {t.daysSincePayment}d</span>}
      </div>
      <div style={{ color: MUTED, fontSize: 12 }}>{t.card || '—'}</div>
      <div style={{ color: MUTED, fontSize: 11.5, lineHeight: 1.4 }}>{t.category}{t.notes ? <span> · {t.notes}</span> : ''}</div>
    </div>
  )
}

function Section({ title, sub, tools, accent }) {
  if (!tools.length) return null
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent || MUTED, fontWeight: 800 }}>{title}</h2>
        <span style={{ color: MUTED, fontSize: 12 }}>{tools.length}{sub ? ` · ${sub}` : ''}</span>
      </div>
      <div style={{ background: CARD, border: BORDER, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.7fr 1fr 0.85fr 2.1fr', gap: 12, padding: '8px 14px', fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: MUTED, fontWeight: 700, background: 'rgba(255,255,255,0.02)' }}>
          <div>Tool</div><div>Cost</div><div>Type</div><div>Last charge</div><div>Card</div><div>Category / notes</div>
        </div>
        {tools.map(t => <Row key={t.id} t={t} />)}
      </div>
    </div>
  )
}

export default function SoftwarePage() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/software-stack')
      .then(r => r.json())
      .then(j => { if (j.error) setErr(j.error); else setData(j) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const tools = data?.tools || []
  const totals = data?.totals || {}
  const uncertain = tools.filter(t => t.uncertain)
  const active = tools.filter(t => t.status === 'Active')
  const evaluating = tools.filter(t => t.status === 'Evaluating')
  const paused = tools.filter(t => t.status === 'Paused')
  const cancelled = tools.filter(t => t.status === 'Cancelled')

  return (
    <div style={{ color: FG, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '4px 0', maxWidth: 1240 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Software Stack</h1>
        {data && (
          <div style={{ display: 'flex', gap: 22, fontSize: 13, color: MUTED }}>
            <span><b style={{ color: FG, fontSize: 18 }}>{money(totals.monthlyBurn)}</b>/mo</span>
            <span><b style={{ color: FG }}>{money(totals.annualBurn)}</b>/yr</span>
            <span><b style={{ color: FG }}>{totals.activeCount}</b> active</span>
          </div>
        )}
      </div>
      <p style={{ color: MUTED, fontSize: 12.5, margin: '6px 0 0' }}>
        Every subscription on the books. <strong style={{ color: '#e0b050' }}>⚠ flagged</strong> = active but no charge seen in 45d — verify you still want it or that it's cancelled.
        Variable-cost exact spend (last paid + monthly average) lands once the Chase feed is wired.
      </p>

      {loading && <div style={{ color: MUTED, padding: 40, textAlign: 'center' }}>Loading…</div>}
      {err && <div style={{ color: '#e87878', padding: 16 }}>Error: {err}</div>}

      {data && uncertain.length > 0 && (
        <div style={{ marginTop: 18, background: 'rgba(224,176,80,0.07)', border: '1px solid rgba(224,176,80,0.3)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ color: '#e0b050', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Check these — can't tell if they're still billing ({uncertain.length})</div>
          <div style={{ color: MUTED, fontSize: 12.5, marginBottom: 8 }}>Active subscriptions with no charge on record in the last 45 days. Confirm you still want each, or that it's actually been unsubscribed.</div>
          {uncertain.map(t => (
            <div key={t.id} style={{ fontSize: 13, color: FG, padding: '3px 0' }}>
              • <b>{t.name}</b> ({money(t.monthlyCost)}/mo) — {t.lastPayment ? `last charge ${fmtDate(t.lastPayment)} (${t.daysSincePayment}d ago)` : 'no charge ever recorded'}
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <Section title="Active" tools={active} accent="#46c46a" />
          <Section title="Evaluating" sub="decide keep or cut" tools={evaluating} accent="#e0b050" />
          <Section title="Paused" tools={paused} accent="#e08a4a" />
          {cancelled.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, fontWeight: 800 }}>Unsubscribed</h2>
                <span style={{ color: MUTED, fontSize: 12 }}>{cancelled.length} · kept for the record</span>
              </div>
              <div style={{ background: CARD, border: BORDER, borderRadius: 12, overflow: 'hidden', opacity: 0.85 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1.2fr 1.6fr', gap: 12, padding: '8px 14px', fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: MUTED, fontWeight: 700, background: 'rgba(255,255,255,0.02)' }}>
                  <div>Tool</div><div>Was</div><div>Cancelled</div><div>Category / notes</div>
                </div>
                {cancelled.map(t => (
                  <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1.2fr 1.6fr', gap: 12, alignItems: 'center', padding: '10px 14px', borderTop: BORDER, fontSize: 13, color: MUTED }}>
                    <div style={{ fontWeight: 600, color: FG, textDecoration: 'line-through', textDecorationColor: 'rgba(255,255,255,0.25)' }}>{t.name}</div>
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>{money(t.monthlyCost)}/mo</div>
                    <div style={{ color: t.cancelDate ? '#e0564b' : MUTED, fontWeight: t.cancelDate ? 600 : 400 }}>{t.cancelDate ? fmtDate(t.cancelDate) : 'date not set'}</div>
                    <div style={{ fontSize: 11.5 }}>{t.category}{t.notes ? ` · ${t.notes}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
