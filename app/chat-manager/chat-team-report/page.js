'use client'

import { useEffect, useState } from 'react'

// Chat-manager Chat Team Report — the admin Whale Hunting "Chat Team Report"
// tab, mirrored READ-ONLY for the team. Same overnight report (authenticity
// flags, mass-template detection, wins) + the "show conversation" expander,
// team-scoped to the manager's creators. The admin-only "real issue / this is
// fine" training buttons are intentionally omitted — that's Evan's model
// calibration surface, not the manager's.

// Admin "View As <chat manager>" uses the same localStorage contract as the
// photo library / whale-hunting mirror — pass it through so team scoping
// matches whoever is being impersonated.
function viewAsQuery() {
  try {
    const raw = window.localStorage.getItem('superadmin_chatManager')
    const id = raw ? (JSON.parse(raw)?.id || '') : ''
    return id ? `viewAsUserId=${encodeURIComponent(id)}` : ''
  } catch { return '' }
}

function fmtReportDay(d) {
  if (!d) return ''
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function SectionCard({ title, description }) {
  return (
    <div style={{ padding: '20px 24px', background: 'var(--card-bg-solid)', borderRadius: '12px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', border: 'none', marginBottom: '4px' }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '12px', color: 'rgba(240, 236, 232, 0.75)', lineHeight: '1.6' }}>{description}</div>
    </div>
  )
}

function CreatorSelect({ value, onChange, options }) {
  return (
    <select value={options.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}
      style={{ background: 'var(--card-bg-solid)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px 10px', fontSize: '12px' }}>
      <option value="">All creators</option>
      {options.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  )
}

function ReportHeader({ report, available, date, setDate, loading }) {
  const gen = report?.generatedAt
    ? new Date(report.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0', flexWrap: 'wrap' }}>
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
      {report?.date && (
        <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>
          covers {fmtReportDay(report.date)}, 12:00 AM – 11:59 PM ET{gen ? ` · generated ${gen} ET` : ''}
        </span>
      )}
      {report?.partial && <span style={{ fontSize: '11px', color: '#E8C878' }}>partial — completing on the next pass</span>}
    </div>
  )
}

// Read a query param on first render (SSR-safe).
function initParam(key) {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get(key) || ''
}

export default function ChatManagerChatTeamReport() {
  const [data, setData] = useState(null)
  // date + creator + team filters persist in the URL so a refresh keeps the view.
  const [date, setDate] = useState(() => initParam('date'))
  const [creatorFilter, setCreatorFilter] = useState(() => initParam('creator'))
  const [team, setTeam] = useState(() => initParam('team') || 'All')
  const [ctx, setCtx] = useState({}) // flagKey -> { loading, thread, error }

  // Keep ?date, ?creator & ?team in the URL without adding history entries.
  const writeUrl = (nextDate, nextCreator, nextTeam) => {
    try {
      const p = new URLSearchParams(window.location.search)
      if (nextDate) p.set('date', nextDate); else p.delete('date')
      if (nextCreator) p.set('creator', nextCreator); else p.delete('creator')
      if (nextTeam && nextTeam !== 'All') p.set('team', nextTeam); else p.delete('team')
      window.history.replaceState(null, '', `${window.location.pathname}${p.toString() ? '?' + p : ''}`)
    } catch { /* SSR */ }
  }
  const changeDate = (v) => { setDate(v); writeUrl(v, creatorFilter, team) }
  const changeCreator = (v) => { setCreatorFilter(v); writeUrl(date, v, team) }
  // Switching teams changes the creator list, so clear the creator filter.
  const changeTeam = (v) => { setTeam(v); setCreatorFilter(''); writeUrl(date, '', v) }

  useEffect(() => {
    const q = [date ? `date=${date}` : '', team && team !== 'All' ? `team=${team}` : '', viewAsQuery()].filter(Boolean).join('&')
    fetch(`/api/chat-team/daily-report${q ? `?${q}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData({ report: null, available: [] }))
  }, [date, team])

  const report = data?.report || null
  const available = data?.available || []
  const loading = data === null
  const repDate = report?.date

  const flagKey = (f) => `${repDate}|${f.creator}|${f.fan}|${String(f.message || '').slice(0, 60)}`
  const toggleContext = async (f) => {
    const k = flagKey(f)
    if (ctx[k]) { setCtx((m) => { const n = { ...m }; delete n[k]; return n }); return }
    setCtx((m) => ({ ...m, [k]: { loading: true } }))
    try {
      const q = [`date=${repDate}`, `creator=${encodeURIComponent(f.creator)}`, `fan=${encodeURIComponent(f.fan)}`, viewAsQuery()].filter(Boolean).join('&')
      const r = await fetch(`/api/chat-team/chat-context?${q}`)
      const j = await r.json()
      setCtx((m) => ({ ...m, [k]: r.ok ? { thread: j.thread || [] } : { error: j.error || 'failed' } }))
    } catch (e) {
      setCtx((m) => ({ ...m, [k]: { error: e.message } }))
    }
  }

  const SEV = { high: '#E87878', medium: '#E8C878' }

  const rows = (report?.perCreator || []).filter((c) => !creatorFilter || c.aka === creatorFilter)
  const flags = rows.flatMap((c) => (c.authenticity || []).map((a) => ({ ...a, creator: c.aka })))
  const templates = rows.flatMap((c) => (c.massTemplates || []).map((t) => ({ ...t, creator: c.aka })))
  const wins = rows.flatMap((c) => (c.wins || []).map((w) => ({ ...w, creator: c.aka })))

  return (
    <div style={{ width: '100%' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '10px' }}>Chat Team Report</h1>
      <SectionCard
        title="What gets sent to you"
        description="Pattern-level observations from yesterday's chats for your creators. Focuses on behaviors, not individuals — use it as coaching material."
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <ReportHeader report={report} available={available} date={date} setDate={changeDate} loading={loading} />
        {/* Team A / B split — only for admins (real chat managers are already
            scoped to their own team, so the toggle would be pointless). */}
        {data?.scoped === false && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--foreground-muted)' }}>Team</span>
            {['All', 'A', 'B'].map((t) => (
              <button key={t} onClick={() => changeTeam(t)}
                style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', cursor: 'pointer', border: '1px solid ' + (team === t ? 'var(--palm-pink)' : 'rgba(255,255,255,0.12)'), background: team === t ? 'var(--palm-pink)' : 'transparent', color: team === t ? '#060606' : 'var(--foreground-muted)' }}>
                {t === 'All' ? 'All' : `Team ${t}`}
              </button>
            ))}
          </div>
        )}
        {report && <CreatorSelect value={creatorFilter} onChange={changeCreator} options={(report.perCreator || []).map((c) => c.aka)} />}
      </div>

      {!report ? null : (
        <>
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
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                  <button onClick={() => toggleContext(f)}
                    style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--foreground-muted)', borderRadius: '6px', padding: '2px 9px', fontSize: '11px', cursor: 'pointer' }}>
                    {ctx[flagKey(f)] ? 'hide conversation' : 'show conversation'}
                  </button>
                </div>
                {ctx[flagKey(f)] && (
                  <div style={{ marginTop: '8px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '10px 12px', maxHeight: '320px', overflowY: 'auto' }}>
                    {ctx[flagKey(f)].loading && <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>Loading conversation…</div>}
                    {ctx[flagKey(f)].error && <div style={{ fontSize: '11px', color: '#E87878' }}>{ctx[flagKey(f)].error}</div>}
                    {(ctx[flagKey(f)].thread || []).length === 0 && !ctx[flagKey(f)].loading && !ctx[flagKey(f)].error &&
                      <div style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>No messages found for this fan on {repDate}.</div>}
                    {(ctx[flagKey(f)].thread || []).map((m, j) => {
                      const flagged = f.message && m.text && m.text.slice(0, 80) === String(f.message).replace(/\s+/g, ' ').slice(0, 80)
                      return m.dir === 'sale' ? (
                        <div key={j} style={{ fontSize: '11px', color: '#7DD3A4', fontWeight: 700, padding: '3px 0' }}>💰 {m.time} — purchased ${m.price}</div>
                      ) : (
                        <div key={j} style={{ display: 'flex', justifyContent: m.dir === 'out' ? 'flex-end' : 'flex-start', padding: '2px 0' }}>
                          <div style={{ maxWidth: '75%', background: flagged ? 'rgba(232,120,120,0.22)' : m.dir === 'out' ? 'rgba(196,165,247,0.12)' : 'rgba(255,255,255,0.06)', border: flagged ? '1px solid rgba(232,120,120,0.5)' : '1px solid transparent', borderRadius: '8px', padding: '4px 9px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>{m.dir === 'out' ? f.creator : f.fan} · {m.time}</div>
                            <div style={{ fontSize: '12px' }}>{m.text}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
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
        </>
      )}
    </div>
  )
}
