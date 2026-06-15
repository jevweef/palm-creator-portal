'use client'

// Content Movement — per-creator view of how REAL content flows through the
// pipeline (uploads → edits → telegram → posted), today vs last 7 days, plus the
// live backlog at each gate. Reads /api/admin/content-movement. AI excluded.

import { useState, useEffect, useCallback } from 'react'

const PINK = '#E8A0A0'
const FG = '#f0ece8'
const MUTED = '#7a7a7a'
const MUTED2 = '#9a9a9a'
const BORDER = 'rgba(255,255,255,0.07)'
const CARD = '#0f0f0f'
const PACE = { good: '#46c46a', behind: '#e0b050', low: '#e0564b', none: 'rgba(255,255,255,0.10)' }

// Format an ISO timestamp as "Jun 4, 2026, 9:45 PM EST" in Eastern time.
function fmtRun(iso) {
  if (!iso) return null
  try {
    const s = new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
    return `${s} EST`
  } catch { return null }
}

function Flow({ cell, reference }) {
  const { today = 0, week = 0 } = cell || {}
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 600, fontSize: 15, color: reference ? MUTED2 : (week ? FG : MUTED) }}>{week}</span>
      {today > 0 && <span style={{ color: PINK, fontSize: 11, marginLeft: 5, fontWeight: 600 }}>+{today}</span>}
    </span>
  )
}

export default function ContentMovement() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/content-movement', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'failed to load')
      setData(j)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const th = { textAlign: 'right', padding: '11px 9px', fontSize: 11, letterSpacing: '0.03em', textTransform: 'uppercase', color: MUTED, fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '11px 9px', fontSize: 14, color: FG, borderTop: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }
  const sep = { borderLeft: `1px solid ${BORDER}` }

  return (
    <div style={{ padding: '28px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <p style={{ margin: 0, color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
          Real content per creator. Big number = <strong style={{ color: MUTED2 }}>last 7 days</strong>, <span style={{ color: PINK, fontWeight: 600 }}>+pink</span> = today. AI content excluded.
        </p>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
          {data?.generatedAt && (
            <span style={{ color: MUTED, fontSize: 11.5, whiteSpace: 'nowrap' }}>
              Last run {fmtRun(data.generatedAt)}
            </span>
          )}
          <button onClick={load} disabled={loading}
            style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED2, borderRadius: 8, padding: '5px 13px', fontSize: 12, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div style={{ color: '#e89090', padding: '16px 0' }}>Error: {err}</div>}
      {loading && !data && <div style={{ color: MUTED, padding: 48, textAlign: 'center' }}>Loading…</div>}

      {data && (
        <>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ ...th, textAlign: 'left' }}>Creator</th>
                    <th style={th}>Videos</th>
                    <th style={th}>Photos</th>
                    <th style={th}>Inspo Ups</th>
                    <th style={th}>Edits</th>
                    <th style={th}>Telegram</th>
                    <th style={{ ...th, ...sep }}>For Review</th>
                    <th style={th}>Post Prep</th>
                    <th style={th}>Ready</th>
                    <th style={{ ...th, ...sep }}>Banked V/P</th>
                    <th style={{ ...th, paddingRight: 22 }}>Runway</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => {
                    const busy = r.videos.week || r.photos.week || r.edits.week || r.telegram.week || r.review || r.prep || r.ready
                    return (
                      <tr key={r.id} style={{ opacity: busy ? 1 : 0.4 }}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 600, borderLeft: `3px solid ${PACE[r.pace] || PACE.none}` }}>
                          {r.name}
                          {r.quota ? <span style={{ color: MUTED, fontWeight: 400, fontSize: 11, marginLeft: 7 }}>{r.telegram.week}/{r.quota}</span> : null}
                        </td>
                        <td style={td}><Flow cell={r.videos} /></td>
                        <td style={td}><Flow cell={r.photos} /></td>
                        <td style={td}><Flow cell={r.inspo} /></td>
                        <td style={td}><Flow cell={r.edits} /></td>
                        <td style={td}><Flow cell={r.telegram} /></td>
                        <td style={{ ...td, ...sep, color: r.review ? PINK : MUTED, fontWeight: r.review ? 700 : 400 }}>{r.review || 0}</td>
                        <td style={{ ...td, color: r.prep ? FG : MUTED }}>{r.prep || 0}</td>
                        <td style={{ ...td, color: r.ready ? FG : MUTED }}>{r.ready || 0}</td>
                        <td style={{ ...td, ...sep, color: MUTED2, fontSize: 13 }}>{r.bankedVideos}<span style={{ color: 'rgba(255,255,255,0.18)' }}> / </span>{r.bankedPhotos}</td>
                        <td style={{ ...td, paddingRight: 22, fontWeight: 600, color: r.runway != null && r.runway < 1.5 ? PACE.low : FG }}>{r.runway != null ? r.runway + 'w' : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ marginTop: 14, color: MUTED, fontSize: 11.5, lineHeight: 1.65 }}>
            Uploads come from Dropbox, split Videos / Photos. <strong style={{ color: MUTED2 }}>Inspo Ups</strong> = clips the creator filmed into a saved inspo record (kept out of Videos). Edits count once per edit, revisions don&rsquo;t add. Telegram counts a reel + its thumbnail as one. The colored bar + number on each name is <strong style={{ color: MUTED2 }}>quota pace</strong> (reels sent to post vs weekly quota): <span style={{ color: PACE.good }}>green</span> hitting it, <span style={{ color: PACE.behind }}>amber</span> behind, <span style={{ color: PACE.low }}>red</span> well behind. <strong style={{ color: MUTED2 }}>Banked V/P</strong> = unposted videos / photos in the unreviewed library; <strong style={{ color: MUTED2 }}>Runway</strong> = weeks of reels left at the current posting rate (red under 1.5w).
          </p>
        </>
      )}
    </div>
  )
}
