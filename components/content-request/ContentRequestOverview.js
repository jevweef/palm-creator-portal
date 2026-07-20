'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'

function fmtDateTime(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return s }
}
function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
function fmtMonth(m) {
  if (!m) return '—'
  const [y, mo] = m.split('-').map(Number)
  if (!y || !mo) return m
  return new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
const shortAccount = (acct) => (acct ? acct.split(' - ').slice(1).join(' - ') || acct : '')
const pctOf = (u, r) => (r > 0 ? Math.round((u / r) * 100) : 0)
const barColor = (u, r) => (r > 0 && u >= r ? '#7DD3A4' : u > 0 ? 'var(--palm-pink)' : 'rgba(255,255,255,0.12)')

// Shared oversight view (admin + team-scoped chat-manager mirror). `apiBase` is
// the data endpoint; `viewAsUserId` lets an admin preview a chat manager's team.
export default function ContentRequestOverview({ apiBase, viewAsUserId, showTeamFilter }) {
  const { user } = useUser()
  const isAdmin = ['admin', 'super_admin'].includes(user?.publicMetadata?.role)
  const teamFilterOn = showTeamFilter && isAdmin
  const [team, setTeam] = useState('All')
  const [data, setData] = useState(null)
  const [month, setMonth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalReq, setModalReq] = useState(null)     // the request object shown in the modal
  const [modalCreator, setModalCreator] = useState('')
  const [openSection, setOpenSection] = useState({}) // section name -> bool (inside modal)

  useEffect(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (month) qs.set('month', month)
    if (viewAsUserId) qs.set('viewAsUserId', viewAsUserId)
    if (teamFilterOn && team !== 'All') qs.set('team', team)
    fetch(`${apiBase}${qs.toString() ? `?${qs}` : ''}`)
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error || 'Failed')))))
      .then((d) => { setData(d); if (!month) setMonth(d.month); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [apiBase, month, viewAsUserId, teamFilterOn, team])

  const openModal = (creator, req) => { setModalCreator(creator); setModalReq(req); setOpenSection({}) }

  if (loading && !data) return <div style={{ padding: 40, color: 'var(--foreground-muted)' }}>Loading content requests…</div>
  if (error) return <div style={{ padding: 40, color: '#E87878' }}>Error: {error}</div>

  const creators = data?.creators || []
  const months = data?.availableMonths || []

  return (
    <div style={{ padding: '4px 4px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Content Requests</h1>
          <div style={{ fontSize: 12, color: 'var(--foreground-muted)', marginTop: 2 }}>One card per creator — click a request to see files, Dropbox links, and errors.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {teamFilterOn && (
            <select value={team} onChange={(e) => setTeam(e.target.value)}
              style={{ padding: '8px 12px', fontSize: 13, background: 'var(--card-bg-solid, #1a1a1a)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}>
              <option value="All">All teams</option>
              <option value="A">A Team</option>
              <option value="B">B Team</option>
            </select>
          )}
          <select value={month || ''} onChange={(e) => setMonth(e.target.value)}
            style={{ padding: '8px 12px', fontSize: 13, background: 'var(--card-bg-solid, #1a1a1a)', color: 'var(--foreground)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer' }}>
            {months.length === 0 && <option value="">No months</option>}
            {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
        </div>
      </div>

      {creators.length === 0 && <div style={{ color: 'var(--foreground-muted)', padding: '40px 0', textAlign: 'center' }}>No content requests for {fmtMonth(month)}.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {creators.map((c) => {
          const pct = pctOf(c.totalUploaded, c.totalRequired)
          const met = c.totalRequired > 0 && c.totalUploaded >= c.totalRequired
          return (
            <div key={c.creatorId || c.creator} style={{ background: 'var(--card-bg-solid)', borderRadius: 14, padding: '16px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)' }}>{c.creator}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: met ? '#7DD3A4' : c.totalUploaded > 0 ? '#E8C878' : '#999' }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: barColor(c.totalUploaded, c.totalRequired) }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginBottom: 12 }}>
                {c.totalUploaded} / {c.totalRequired} uploaded
                {c.errorCount > 0 && <span style={{ color: '#E87878', fontWeight: 600 }}> · {c.errorCount} error{c.errorCount > 1 ? 's' : ''}</span>}
              </div>

              {/* Per-account request rows — click to open the modal */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {c.requests.map((req) => {
                  const rpct = pctOf(req.totalUploaded, req.totalRequired)
                  const rmet = req.totalRequired > 0 && req.totalUploaded >= req.totalRequired
                  const label = shortAccount(req.account) || req.title || 'Content request'
                  const isVip = /vip/i.test(req.account)
                  return (
                    <button key={req.requestId} onClick={() => openModal(c.creator, req)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer',
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 9, padding: '8px 10px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
                        color: isVip ? '#C9A2E8' : '#7FB4E4', background: isVip ? 'rgba(201,162,232,0.12)' : 'rgba(127,180,228,0.12)', padding: '2px 7px', borderRadius: 5 }}>
                        {label}
                      </span>
                      <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${rpct}%`, background: barColor(req.totalUploaded, req.totalRequired) }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, flexShrink: 0, color: rmet ? '#7DD3A4' : req.totalUploaded > 0 ? '#E8C878' : '#777' }}>
                        {req.totalUploaded}/{req.totalRequired}
                      </span>
                      <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0, fontSize: 12 }}>›</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {modalReq && (
        <RequestModal creator={modalCreator} req={modalReq} openSection={openSection} setOpenSection={setOpenSection} onClose={() => setModalReq(null)} />
      )}
    </div>
  )
}

function RequestModal({ creator, req, openSection, setOpenSection, onClose }) {
  const pct = pctOf(req.totalUploaded, req.totalRequired)
  const met = req.totalRequired > 0 && req.totalUploaded >= req.totalRequired
  const toggle = (name) => setOpenSection((p) => ({ ...p, [name]: !p[name] }))
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--background, #0d0d0f)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: '100%', maxWidth: 620, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--foreground)' }}>{creator}</span>
              {req.account && <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: /vip/i.test(req.account) ? '#C9A2E8' : '#7FB4E4' }}>{shortAccount(req.account)}</span>}
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--foreground-subtle)', marginTop: 8 }}>
            <span style={{ fontWeight: 700, color: met ? '#7DD3A4' : req.totalUploaded > 0 ? '#E8C878' : '#999' }}>{req.totalUploaded} / {req.totalRequired} · {pct}%</span>
            <span>Due {req.dueDate || '—'}</span>
            <span>Last upload {fmtDateTime(req.lastUploadAt)}</span>
          </div>
        </div>

        <div style={{ padding: '8px 20px 20px', overflowY: 'auto' }}>
          {req.sections.map((s) => {
            const secMet = s.required > 0 && s.uploaded >= s.required
            const canOpen = s.items.length > 0
            return (
              <div key={s.name} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '9px 0' }}>
                <div onClick={() => canOpen && toggle(s.name)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: canOpen ? 'pointer' : 'default' }}>
                  <span style={{ fontSize: 13, color: 'rgba(240,236,232,0.85)' }}>
                    {canOpen && <span style={{ color: 'var(--foreground-subtle)', marginRight: 6 }}>{openSection[s.name] ? '▾' : '▸'}</span>}
                    {s.name}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: secMet ? '#7DD3A4' : s.uploaded > 0 ? '#E8C878' : '#777' }}>{s.uploaded} / {s.required}</span>
                </div>
                {openSection[s.name] && canOpen && (
                  <div style={{ marginTop: 8, marginLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {s.items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--foreground-muted)' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.fileName || 'file'}</span>
                        <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>{fmtSize(it.fileSize)}</span>
                        <span style={{ color: 'var(--foreground-subtle)', flexShrink: 0 }}>{fmtDateTime(it.uploadedAt)}</span>
                        {it.dropboxLink && <a href={it.dropboxLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--palm-pink)', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>Dropbox ↗</a>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {req.errors.length > 0 && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(232,120,120,0.06)', border: '1px solid rgba(232,120,120,0.25)', borderRadius: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#E87878', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Upload errors ({req.errors.length})</div>
              {req.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--foreground-muted)', padding: '4px 0' }}>
                  <span style={{ color: '#E87878', fontWeight: 600 }}>{e.error}</span>{e.stage && <span style={{ color: 'var(--foreground-subtle)' }}> · at {e.stage}</span>}
                  <div style={{ fontSize: 11, color: 'var(--foreground-subtle)', marginTop: 2 }}>{e.section && `${e.section} · `}{e.fileName && `${e.fileName} · `}{fmtDateTime(e.reportedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
