'use client'

// Research tab — OFM competitive-intelligence knowledge base.
//
// Three views: (1) Department overview — cards per agency department with finding
// counts + consensus mix; (2) Department detail — findings grouped by sub-topic;
// (3) global search across all findings. Plus a "Today" daily-brief view when briefs
// exist. Every finding shows consensus (how many independent creators agree),
// applicability (real-creator / ai-only / both), and source video cards with
// thumbnail, subscriber count, age, and jump-to-timestamp links.
//
// Data from /api/admin/research (server reads research/knowledge/*.json + meta).
import { useEffect, useMemo, useState } from 'react'

const fmtNum = n => n == null ? '—'
  : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n)

const fmtSeconds = s => {
  if (s == null) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function ageLabel(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null
  const then = new Date(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8))
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days < 0) return null
  if (days < 31) return { text: `${days}d ago`, stale: false }
  const months = Math.floor(days / 30)
  if (months < 12) return { text: `${months}mo ago`, stale: months >= 9 }
  return { text: `${(days / 365).toFixed(1).replace(/\.0$/, '')}y ago`, stale: true }
}

const CONSENSUS = {
  high: { c: '#7FE0C0', label: 'High consensus' },
  medium: { c: '#FFD27F', label: 'Medium consensus' },
  low: { c: '#9AA4B2', label: 'Single source' },
}
const APPLIC = {
  'real-creator': { c: '#7FE0C0', label: 'Real creator' },
  'ai-only': { c: '#C0A0FF', label: 'AI-only (future)' },
  both: { c: '#7CC4FF', label: 'Both' },
  unknown: { c: '#9AA4B2', label: '—' },
}

function Badge({ color, children, title }) {
  return <span title={title} style={{
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
    color, background: `${color}1a`, border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 7px',
  }}>{children}</span>
}

function SourceChip({ src, stats }) {
  const v = stats[src.video_id] || {}
  const url = `https://www.youtube.com/watch?v=${src.video_id}&t=${src.timestamp_seconds || 0}s`
  const age = ageLabel(v.upload_date)
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', textDecoration: 'none',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 8, padding: 8, color: 'var(--foreground)', minWidth: 0,
    }}>
      {v.thumbnail
        ? <img src={v.thumbnail} alt="" width={96} height={54} style={{ borderRadius: 5, objectFit: 'cover', flexShrink: 0, background: '#000' }} />
        : <div style={{ width: 96, height: 54, borderRadius: 5, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{v.title || src.video_id}</div>
        <div style={{ fontSize: 10.5, color: 'var(--foreground-muted)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--palm-pink)' }}>{v.channel || '—'}</span>
          <span>{fmtNum(v.channel_followers)} subs</span>
          {age && <span style={{ color: age.stale ? '#E8A06A' : 'var(--foreground-muted)' }}>{age.stale ? '⚠ ' : ''}{age.text}</span>}
        </div>
        <div style={{ fontSize: 11, marginTop: 3, color: 'var(--palm-pink)', fontWeight: 600 }}>▶ Jump to {fmtSeconds(src.timestamp_seconds)}</div>
      </div>
    </a>
  )
}

function Row({ label, text, color }) {
  if (!text) return null
  return <div style={{ marginBottom: 6 }}>
    <span style={{ fontSize: 11, fontWeight: 700, marginRight: 8, color: color || 'var(--foreground-muted)' }}>{label}:</span>
    <span style={{ fontSize: 13, lineHeight: 1.5 }}>{text}</span>
  </div>
}

// Minimal markdown renderer for the mentor report — handles the features the report
// actually uses: # / ## / ### headings, **bold**, [text](url) links, - bullets,
// --- rules, and paragraphs. Deliberately tiny (no dependency) and safe (no raw HTML).
function mdInline(text, keyPrefix) {
  // Split on **bold** and [label](url); render the rest as plain text.
  const parts = []
  let rest = text
  let i = 0
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)/
  let m
  while ((m = rest.match(re))) {
    if (m.index > 0) parts.push(rest.slice(0, m.index))
    if (m[1] != null) {
      parts.push(<strong key={`${keyPrefix}-b${i}`}>{m[1]}</strong>)
    } else {
      parts.push(<a key={`${keyPrefix}-a${i}`} href={m[3]} target="_blank" rel="noreferrer"
        style={{ color: 'var(--palm-pink)' }}>{m[2]}</a>)
    }
    rest = rest.slice(m.index + m[0].length)
    i++
  }
  if (rest) parts.push(rest)
  return parts
}

function Markdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const out = []
  let bullets = null
  const flush = () => {
    if (bullets) {
      out.push(<ul key={`ul-${out.length}`} style={{ margin: '6px 0 12px', paddingLeft: 20 }}>
        {bullets.map((b, j) => <li key={j} style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 4 }}>{mdInline(b, `li${out.length}-${j}`)}</li>)}
      </ul>)
      bullets = null
    }
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (/^\s*-\s+/.test(line)) { (bullets ||= []).push(line.replace(/^\s*-\s+/, '')); return }
    flush()
    if (!line.trim()) return
    if (line.startsWith('### ')) out.push(<h3 key={idx} style={{ fontSize: 15, fontWeight: 800, margin: '18px 0 6px' }}>{mdInline(line.slice(4), `h3${idx}`)}</h3>)
    else if (line.startsWith('## ')) out.push(<h2 key={idx} style={{ fontSize: 17, fontWeight: 800, margin: '22px 0 8px' }}>{mdInline(line.slice(3), `h2${idx}`)}</h2>)
    else if (line.startsWith('# ')) out.push(<h1 key={idx} style={{ fontSize: 20, fontWeight: 800, margin: '0 0 10px' }}>{mdInline(line.slice(2), `h1${idx}`)}</h1>)
    else if (line.trim() === '---') out.push(<hr key={idx} style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.1)', margin: '16px 0' }} />)
    else out.push(<p key={idx} style={{ fontSize: 13.5, lineHeight: 1.65, margin: '0 0 10px' }}>{mdInline(line, `p${idx}`)}</p>)
  })
  flush()
  return <div>{out}</div>
}

function AskMentor({ stats }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)

  const ask = async () => {
    if (!q.trim() || busy) return
    setBusy(true); setErr(null); setRes(null)
    try {
      const r = await fetch('/api/admin/research/ask', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setRes(d)
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  const examples = [
    'How should we price PPVs?',
    'What are top agencies doing for retention that we aren’t?',
    'How do the best operators sign new creators?',
    'What should we change about how we run Instagram?',
  ]

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') ask() }}
          placeholder="Ask your OFM mentor anything — answers cite real source videos…"
          style={{ flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 14,
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)' }} />
        <button onClick={ask} disabled={busy || !q.trim()} style={{
          padding: '0 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
          color: '#0a0a0a', background: 'var(--palm-pink)', border: 'none', opacity: busy || !q.trim() ? 0.5 : 1 }}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {!res && !busy && !err && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {examples.map(x => (
            <button key={x} onClick={() => setQ(x)} style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground-muted)', cursor: 'pointer' }}>
              {x}
            </button>
          ))}
        </div>
      )}

      {err && <div style={{ color: '#FF9F9F', fontSize: 13, marginTop: 8 }}>Error: {err}</div>}

      {res && (
        <div style={{ marginTop: 6 }}>
          {res.answer && (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6, padding: 16,
              background: 'rgba(232,160,160,0.06)', border: '1px solid rgba(232,160,160,0.22)', borderRadius: 12 }}>
              {res.answer}
            </div>
          )}
          {res.retrievalOnly && (
            <div style={{ fontSize: 12.5, color: '#E8A06A', padding: 12, border: '1px solid rgba(232,160,106,0.25)', borderRadius: 10 }}>
              Showing the most relevant findings below (live AI answer unavailable right now).
            </div>
          )}
          {Array.isArray(res.findings) && res.findings.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-muted)', marginBottom: 8 }}>
                Based on these findings
              </div>
              {res.findings.map((f, i) => <Finding key={i} f={f} stats={stats} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Finding({ f, stats }) {
  const [open, setOpen] = useState(false)
  const cons = CONSENSUS[f.consensus?.label] || CONSENSUS.low
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1, minWidth: 200 }}>{f.title}</span>
        <Badge color={cons.c} title={`${f.consensus?.creators || 0} independent creator(s) assert this`}>
          {cons.label}{f.consensus?.creators > 1 ? ` ·${f.consensus.creators}` : ''}
        </Badge>
        {(f.applicability || []).map(a => <Badge key={a} color={(APPLIC[a] || APPLIC.unknown).c}>{(APPLIC[a] || APPLIC.unknown).label}</Badge>)}
        {f.consensus?.contested && <Badge color="#FF9F9F">Contested</Badge>}
        <span style={{ fontSize: 16, color: 'var(--foreground-muted)' }}>{open ? '−' : '+'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <Row label="What they do" text={f.variants?.[0]?.what_they_do} />
          <Row label="Vs. us" text={f.palm_comparison?.vs_us} color="#E8A06A" />
          <Row label="What we could change" text={f.palm_comparison?.recommendation} color="#7FE0C0" />
          {f.creators?.length > 1 && (
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)', margin: '6px 0' }}>
              Asserted by {f.creators.length} creators: {f.creators.join(', ')}
            </div>
          )}
          {f.sources?.length > 0 && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {f.sources.map((s, i) => <SourceChip key={i} src={s} stats={stats} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ResearchPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [dept, setDept] = useState(null)   // selected department key, or null = overview
  const [q, setQ] = useState('')
  const [view, setView] = useState('mentor')  // 'mentor' = advisory report, 'today' = brief, 'browse' = full KB

  useEffect(() => {
    let cancel = false
    fetch('/api/admin/research')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancel) setData(d) })
      .catch(e => { if (!cancel) setError(e.message) })
    return () => { cancel = true }
  }, [])

  const findings = data?.findings || []
  const taxonomy = data?.taxonomy || []
  const stats = data?.stats || {}

  const byDept = useMemo(() => {
    const m = {}
    for (const f of findings) (m[f.department] ||= []).push(f)
    return m
  }, [findings])

  const needle = q.trim().toLowerCase()
  const searchHits = useMemo(() => {
    if (!needle) return null
    return findings.filter(f => [f.title, f.topic, f.department, f.palm_comparison?.vs_us,
      f.palm_comparison?.recommendation, f.variants?.[0]?.what_they_do, ...(f.creators || [])]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [needle, findings])

  const Header = (
    <div style={{ marginBottom: 18 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Research</h1>
      <p style={{ fontSize: 13, color: 'var(--foreground-muted)', marginTop: 4, maxWidth: 760 }}>
        How other OFM agencies operate, synthesized from their YouTube content and compared to how
        Palm works. Confidence rises when multiple independent creators say the same thing. Each
        finding links to the exact moment in the source video.
        {data && <> · <strong>{data.corpus?.findings || 0}</strong> findings from <strong>{data.corpus?.creators || 0}</strong> creators</>}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['mentor', 'Mentor'], ['ask', 'Ask the mentor'], ['today', 'Today’s Brief'], ['browse', 'Browse all']].map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); setDept(null); setQ('') }}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              color: view === v ? '#0a0a0a' : 'var(--foreground-muted)',
              background: view === v ? 'var(--palm-pink)' : 'rgba(255,255,255,0.04)',
              border: '1px solid ' + (view === v ? 'var(--palm-pink)' : 'rgba(255,255,255,0.1)'),
            }}>
            {label}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search all findings, topics, creators…"
          style={{ flex: 1, minWidth: 220, maxWidth: 440, padding: '7px 12px', borderRadius: 8, fontSize: 13,
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: 'var(--foreground)' }} />
      </div>
    </div>
  )

  if (error) return <div style={{ width: '100%' }}>{Header}<div style={{ color: '#FF9F9F', fontSize: 13 }}>Couldn’t load research: {error}</div></div>
  if (!data) return <div style={{ width: '100%' }}>{Header}<div style={{ padding: 40, textAlign: 'center', color: 'var(--foreground-muted)' }}>Loading…</div></div>

  // MENTOR — the headline advisory: what to fix and why (default view). Search overrides it.
  if (view === 'mentor' && !needle) {
    return <div style={{ width: '100%' }}>{Header}
      {data.mentorReport
        ? <div style={{ maxWidth: 820, background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '24px 28px' }}>
            <Markdown text={data.mentorReport} />
          </div>
        : <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-muted)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12 }}>
            No mentor report yet. Generate it with <code>scripts</code> + the synthesis pipeline.
          </div>}
    </div>
  }

  // ASK THE MENTOR — Q&A over the corpus. A search overrides it.
  if (view === 'ask' && !needle) {
    return <div style={{ width: '100%' }}>{Header}<AskMentor stats={stats} /></div>
  }

  // TODAY'S BRIEF — the daily "what's new" digest. A search overrides it.
  if (view === 'today' && !needle) {
    const brief = (data.daily || [])[0]
    if (!brief) {
      return <div style={{ width: '100%' }}>{Header}
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-muted)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12 }}>
          No brief yet. Run <code>scripts/daily_brief.py</code> to generate one.
        </div>
      </div>
    }
    const risers = brief.consensus_risers || []
    const fresh = brief.new_findings || []
    return <div style={{ width: '100%' }}>{Header}
      <div style={{ marginBottom: 14, padding: '12px 16px', background: 'rgba(127,224,192,0.06)', border: '1px solid rgba(127,224,192,0.22)', borderRadius: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#7FE0C0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {brief.kind === 'inaugural' ? 'Research brief · launch' : `Daily brief · ${brief.date}`}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{brief.headline}</div>
      </div>

      {risers.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#FFD27F', margin: '0 0 8px' }}>
            ▲ Rose in consensus (another agency now agrees)
          </h3>
          {risers.map((f, i) => <Finding key={i} f={f} stats={stats} />)}
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-muted)', margin: '0 0 8px' }}>
          {brief.kind === 'inaugural' ? 'Top findings to know' : 'New findings'}
        </h3>
        {fresh.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--foreground-muted)' }}>Nothing new since the last run. Switch to <strong>Browse all</strong> for the full library.</div>
          : fresh.map((f, i) => <Finding key={i} f={f} stats={stats} />)}
      </section>
    </div>
  }

  // SEARCH MODE
  if (needle) {
    return <div style={{ width: '100%' }}>{Header}
      <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginBottom: 10 }}>{searchHits.length} result(s) for “{q}”</div>
      {searchHits.map(f => <Finding key={f.id} f={f} stats={stats} />)}
    </div>
  }

  // DEPARTMENT DETAIL
  if (dept) {
    const d = taxonomy.find(t => t.key === dept) || { key: dept, label: dept }
    const items = byDept[dept] || []
    const topics = {}
    for (const f of items) (topics[f.topic || 'general'] ||= []).push(f)
    return <div style={{ width: '100%' }}>{Header}
      <button onClick={() => setDept(null)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--foreground-muted)', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', marginBottom: 14 }}>← All departments</button>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 2px' }}>{d.label}</h2>
      {d.blurb && <p style={{ fontSize: 12.5, color: 'var(--foreground-muted)', margin: '0 0 4px' }}>{d.blurb}</p>}
      {d.palm_section && <p style={{ fontSize: 11.5, color: '#E8A06A', margin: '0 0 16px' }}>Palm baseline: {d.palm_section}</p>}
      {items.length === 0 && <div style={{ color: 'var(--foreground-muted)', fontSize: 13 }}>No findings here yet.</div>}
      {Object.entries(topics).map(([t, fs]) => (
        <section key={t} style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-muted)', margin: '0 0 8px' }}>{t}</h3>
          {fs.map(f => <Finding key={f.id} f={f} stats={stats} />)}
        </section>
      ))}
    </div>
  }

  // OVERVIEW
  const depts = taxonomy.filter(t => (byDept[t.key] || []).length > 0)
  const empty = taxonomy.filter(t => (byDept[t.key] || []).length === 0)
  return <div style={{ width: '100%' }}>{Header}
    {findings.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-muted)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12 }}>No findings yet — run the synthesis pipeline.</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {depts.map(t => {
        const items = byDept[t.key]
        const mix = { high: 0, medium: 0, low: 0 }
        for (const f of items) mix[f.consensus?.label || 'low']++
        return (
          <button key={t.key} onClick={() => setDept(t.key)} style={{ textAlign: 'left', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, cursor: 'pointer', color: 'var(--foreground)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{t.label}</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--palm-pink)' }}>{items.length}</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--foreground-muted)', margin: '6px 0 10px', lineHeight: 1.4 }}>{t.blurb}</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {mix.high > 0 && <Badge color={CONSENSUS.high.c}>{mix.high} high</Badge>}
              {mix.medium > 0 && <Badge color={CONSENSUS.medium.c}>{mix.medium} med</Badge>}
              {mix.low > 0 && <Badge color={CONSENSUS.low.c}>{mix.low} single</Badge>}
            </div>
          </button>
        )
      })}
    </div>
    {empty.length > 0 && (
      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--foreground-muted)' }}>
        No findings yet in: {empty.map(t => t.label).join(', ')}.
      </div>
    )}
  </div>
}
