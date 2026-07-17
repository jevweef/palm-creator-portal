'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ── tiny inline icons (no emoji per house style) ──
function CheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#43A047" opacity="0.18" />
      <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#43A047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function WarnIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#F9A825" opacity="0.18" />
      <path d="M10 5.5v5" stroke="#F9A825" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="#F9A825" />
    </svg>
  )
}
function NaIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke="var(--foreground-subtle)" strokeWidth="1.5" strokeDasharray="2 2.5" />
    </svg>
  )
}
// Neutral "to-do" marker (an unchecked circle) — NOT a warning. Used for any
// incomplete tile; the "Next" badge/border is what signals where to start.
function ToDoIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" stroke="var(--foreground-muted)" strokeWidth="1.5" />
    </svg>
  )
}

const CHAT_TEAMS = ['A Team', 'B Team']

export default function OnboardingWorkspace() {
  const params = useParams()
  const router = useRouter()
  const hqId = params?.creatorId

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)        // action key in flight
  const [toast, setToast] = useState(null)
  const [showAll, setShowAll] = useState(false) // default: only what's left to do

  const load = useCallback(async () => {
    if (!hqId) return
    setError(null)
    try {
      const res = await fetch(`/api/admin/onboarding/board?hqId=${hqId}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [hqId])

  useEffect(() => { load() }, [load])

  const flash = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }, [])

  const creator = data?.creator
  const onboardingId = data?.onboardingId

  // Dispatch a tile action. Returns nothing; refreshes the board after writes.
  const runAction = useCallback(async (tile) => {
    const a = tile.action
    if (!a) return

    if (a.type === 'link') {
      if (a.external) window.open(a.href, '_blank', 'noopener')
      else router.push(a.href)
      return
    }

    const key = `${tile.key}:${a.type}`
    setBusy(key)
    try {
      if (a.type === 'run-setup') {
        const res = await fetch('/api/admin/onboarding/run-setup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorRecordId: hqId }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Setup failed')
        flash('Setup ran')
        await load()
      } else if (a.type === 'check') {
        const next = tile.status !== 'done'
        const res = await fetch('/api/admin/onboarding/checklist', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onboardingId, fields: { [a.field]: next } }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed')
        await load()
      } else if (a.type === 'analyze-dna') {
        const res = await fetch('/api/admin/creator-profile/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorId: creator?.opsId, creatorName: creator?.name }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Profile build failed')
        flash('Profile builder ran')
        await load()
      } else if (a.type === 'go-live') {
        const res = await fetch('/api/admin/onboarding/go-live', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hqId }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.missing ? `Still missing: ${json.missing.join(', ')}` : (json.error || 'Go-live failed'))
        flash('Creator is live')
        await load()
      } else if (a.type === 'reminder') {
        const res = await fetch('/api/admin/onboarding/resend', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hqId }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json.onboardingUrl) {
          try { await navigator.clipboard.writeText(json.onboardingUrl) } catch { /* clipboard blocked */ }
          flash('Onboarding link copied — send it to the creator')
        }
      }
    } catch (err) {
      flash(err.message)
    } finally {
      setBusy(null)
    }
  }, [hqId, onboardingId, creator, load, flash, router])

  const setChatTeam = useCallback(async (value) => {
    setBusy('chat-team')
    // optimistic
    setData((d) => d ? { ...d, creator: { ...d.creator, chatTeam: value || '' } } : d)
    try {
      const res = await fetch('/api/admin/onboarding/chat-team', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, chatTeam: value || null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed')
      await load()
    } catch (err) {
      flash(err.message)
      await load()
    } finally {
      setBusy(null)
    }
  }, [hqId, load, flash])

  // ── render (all hooks above this line) ──
  if (loading) {
    return <div style={{ padding: '40px', color: 'var(--foreground-muted)', fontSize: '14px' }}>Loading onboarding workspace…</div>
  }
  if (error) {
    return (
      <div style={{ padding: '40px' }}>
        <button onClick={() => router.push('/admin/onboarding')} style={backLink}>← Onboarding</button>
        <div style={{ color: '#C25450', fontSize: '14px', marginTop: '16px' }}>{error}</div>
      </div>
    )
  }

  const { groups = [], counts = { done: 0, total: 0 }, readiness, nextKey } = data || {}
  const isActive = creator?.status === 'Active'
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0
  const nextTile = nextKey ? groups.flatMap((g) => g.tiles).find((t) => t.key === nextKey) : null

  return (
    <div style={{ paddingBottom: '60px' }}>
      <button onClick={() => router.push('/admin/onboarding')} style={backLink}>← Onboarding</button>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', margin: '14px 0 22px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '4px' }}>
            {creator?.name || '—'}
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {creator?.aka && <span>{creator.aka}</span>}
            {creator?.aka && <span style={{ opacity: 0.4 }}>·</span>}
            <span style={{ color: isActive ? '#43A047' : '#F9A825', fontWeight: 600 }}>{creator?.status || 'Onboarding'}</span>
            {creator?.email && <><span style={{ opacity: 0.4 }}>·</span><span>{creator.email}</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: '180px' }}>
          <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '6px' }}>
            {counts.done} / {counts.total} ready
          </div>
          <div style={{ height: '8px', width: '180px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden', marginLeft: 'auto' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#43A047' : 'var(--palm-pink)', transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      {/* do this next */}
      {!isActive && nextTile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
          background: 'rgba(232,160,160,0.10)', border: '1px solid rgba(232,160,160,0.3)',
          borderRadius: '12px', padding: '14px 16px', marginBottom: '22px',
        }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--palm-pink)', background: 'rgba(232,160,160,0.16)', padding: '3px 9px', borderRadius: '999px', flexShrink: 0,
          }}>Do this next</span>
          <div style={{ flex: 1, minWidth: '180px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>{nextTile.label}</div>
            {nextTile.instructions && (
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px', lineHeight: 1.45 }}>{nextTile.instructions}</div>
            )}
          </div>
          {nextTile.action && nextTile.action.type !== 'set-chat-team' && (
            <button
              onClick={() => runAction(nextTile)}
              disabled={busy === `${nextTile.key}:${nextTile.action.type}`}
              style={{
                flexShrink: 0, padding: '9px 16px', fontSize: '13px', fontWeight: 700, borderRadius: '8px', border: 'none',
                background: 'var(--palm-pink)', color: '#060606',
                cursor: busy === `${nextTile.key}:${nextTile.action.type}` ? 'default' : 'pointer',
                opacity: busy === `${nextTile.key}:${nextTile.action.type}` ? 0.6 : 1,
              }}
            >
              {busy === `${nextTile.key}:${nextTile.action.type}` ? 'Working…' : actionLabel(nextTile)}
            </button>
          )}
        </div>
      )}

      {/* what's-left / show-all toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
          {showAll ? 'Showing every step' : `Showing what’s left (${counts.total - counts.done} to do)`}
        </span>
        <button
          onClick={() => setShowAll((s) => !s)}
          style={{
            padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '999px', cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)',
          }}
        >
          {showAll ? 'Show only what’s left' : 'Show all steps'}
        </button>
      </div>

      {/* groups */}
      {groups.map((g) => {
        const vis = showAll ? g.tiles : g.tiles.filter((t) => t.status !== 'done' && t.status !== 'na')
        const showGoLive = g.key === 'golive' && !isActive
        if (vis.length === 0 && !showGoLive) return null   // hide fully-done phases when only showing what's left
        return (
          <section key={g.key} style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{g.title}</h2>
              <span style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>{g.subtitle}</span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: g.done === g.total ? '#43A047' : 'var(--foreground-muted)', fontWeight: 600 }}>
                {g.done}/{g.total}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
              {vis.map((t) => (
                <Tile
                  key={t.key}
                  tile={t}
                  busy={busy}
                  onAction={() => runAction(t)}
                  chatTeam={creator?.chatTeam}
                  onChatTeam={setChatTeam}
                  hqId={hqId}
                  onboardingId={onboardingId}
                  creatorAka={creator?.aka}
                  opsId={creator?.opsId}
                  onRefresh={load}
                  flash={flash}
                />
              ))}
              {showGoLive && (
                <GoLiveTile isActive={isActive} readiness={readiness} busy={busy === 'golive:go-live'} onGo={() => runAction({ key: 'golive', action: { type: 'go-live' } })} startDate={creator?.managementStartDate} />
              )}
            </div>
          </section>
        )
      })}

      {/* nothing-left state (only-what's-left mode, everything done) */}
      {!showAll && counts.done === counts.total && isActive && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '14px' }}>
          All steps complete — nothing left to do. <button onClick={() => setShowAll(true)} style={{ ...backLink, color: 'var(--palm-pink)' }}>Show all</button>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 999,
          background: '#1a1f1c', border: '1px solid rgba(110,180,130,0.5)', borderLeft: '4px solid #6EB482',
          borderRadius: '10px', padding: '12px 18px', fontSize: '13px', color: 'var(--foreground)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)', maxWidth: '420px',
        }}>{toast}</div>
      )}
    </div>
  )
}

function Tile({ tile, busy, onAction, chatTeam, onChatTeam, hqId, onboardingId, creatorAka, opsId, onRefresh, flash }) {
  const a = tile.action
  const isNa = tile.status === 'na'
  const blocked = tile.blocked
  const Icon = tile.status === 'done' ? CheckIcon : isNa ? NaIcon : ToDoIcon
  const actionBusy = a && busy === `${tile.key}:${a.type}`

  return (
    <div style={{
      background: 'var(--card-bg-solid)',
      border: `1px solid ${tile.isNext ? 'var(--palm-pink)' : tile.status === 'done' ? 'rgba(67,160,71,0.25)' : 'rgba(255,255,255,0.06)'}`,
      boxShadow: tile.isNext ? '0 0 0 1px var(--palm-pink)' : 'none',
      borderRadius: '12px', padding: '12px 13px', opacity: isNa ? 0.55 : blocked ? 0.7 : 1,
      display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '92px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <Icon />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {tile.label}
            {tile.isNext && (
              <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--palm-pink)', background: 'rgba(232,160,160,0.16)', padding: '1px 6px', borderRadius: '4px' }}>Next</span>
            )}
          </div>
          {tile.detail && a?.type !== 'of-login' && (
            <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tile.detail}>
              {tile.detail}
            </div>
          )}
          {tile.instructions && (
            <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginTop: '5px', lineHeight: 1.4 }}>
              {tile.instructions}
            </div>
          )}
        </div>
      </div>

      {/* action row */}
      <div style={{ marginTop: 'auto' }}>
        {blocked ? (
          <div style={{ fontSize: '11px', color: '#F9A825', padding: '5px 0' }}>
            Waiting on: {tile.blockedBy.join(', ')}
          </div>
        ) : a?.type === 'set-chat-team' ? (
          <select
            value={chatTeam || ''}
            onChange={(e) => onChatTeam(e.target.value)}
            disabled={busy === 'chat-team'}
            style={{
              width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)',
            }}
          >
            <option value="">Unassigned</option>
            {CHAT_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : a?.type === 'of-login' ? (
          <OfLoginAction tile={tile} hqId={hqId} onboardingId={onboardingId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'survey-send' ? (
          <SurveySendAction tile={tile} hqId={hqId} onboardingId={onboardingId} sentToTeam={a.sentToTeam} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'toggle-social' ? (
          <SocialToggleAction tile={tile} opsId={opsId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'contract-amend' ? (
          <ContractAmendAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'telegram-assign' ? (
          <TelegramAssignAction tile={tile} hqId={hqId} onboardingId={onboardingId} creatorAka={creatorAka} onRefresh={onRefresh} flash={flash} />
        ) : a ? (
          <button
            onClick={onAction}
            disabled={actionBusy}
            style={{
              width: '100%', padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px',
              border: 'none', cursor: actionBusy ? 'default' : 'pointer',
              background: tile.status === 'done' && a.type !== 'link' ? 'rgba(255,255,255,0.05)' : 'rgba(232,160,160,0.12)',
              color: tile.status === 'done' && a.type !== 'link' ? 'var(--foreground-muted)' : 'var(--palm-pink)',
              opacity: actionBusy ? 0.6 : 1,
            }}
          >
            {actionBusy ? 'Working…' : actionLabel(tile)}
          </button>
        ) : null}
      </div>
    </div>
  )
}

// OF-login card: 4 editable credential boxes (free + paid email/password) with
// Edit/Save, plus an Approve toggle that sets 'OF Login Confirmed' (tile = done).
function OfLoginAction({ tile, hqId, onboardingId, onRefresh, flash }) {
  const a = tile.action || {}
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(null) // 'save' | 'approve'
  const [v, setV] = useState({
    freeEmail: a.freeEmail || '', freePass: a.freePass || '',
    paidEmail: a.paidEmail || '', paidPass: a.paidPass || '',
  })
  const confirmed = tile.status === 'done'

  const inputStyle = {
    width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: editing ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
    color: editing ? 'var(--foreground)' : 'var(--foreground-muted)', outline: 'none',
  }
  const labelStyle = { fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-subtle)', marginBottom: '2px' }
  const btn = (bg, color) => ({ flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: bg, color, opacity: busy ? 0.6 : 1 })

  const field = (key, label, ph) => (
    <div>
      <div style={labelStyle}>{label}</div>
      <input value={v[key]} placeholder={ph} disabled={!editing || !!busy}
        onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} style={inputStyle} />
    </div>
  )

  const save = async () => {
    setBusy('save')
    try {
      const res = await fetch('/api/admin/onboarding/of-login', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, fields: {
          'OF Email': v.freeEmail, 'OF Password': v.freePass,
          '2nd OF Email': v.paidEmail, '2nd OF Password': v.paidPass,
        } }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed')
      setEditing(false)
      flash('OF login saved')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const approve = async () => {
    setBusy('approve')
    try {
      const res = await fetch('/api/admin/onboarding/checklist', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingId, fields: { 'OF Login Confirmed': !confirmed } }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed')
      flash(confirmed ? 'Approval cleared' : 'OF login approved')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {field('freeEmail', 'Free email', 'free page email')}
        {field('freePass', 'Free password', '—')}
        {field('paidEmail', 'Paid/VIP email', 'paid page email')}
        {field('paidPass', 'Paid/VIP password', '—')}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {editing ? (
          <>
            <button onClick={save} disabled={!!busy} style={btn('rgba(232,160,160,0.16)', 'var(--palm-pink)')}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setEditing(false); setV({ freeEmail: a.freeEmail || '', freePass: a.freePass || '', paidEmail: a.paidEmail || '', paidPass: a.paidPass || '' }) }} disabled={!!busy} style={btn('rgba(255,255,255,0.05)', 'var(--foreground-muted)')}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} disabled={!!busy} style={btn('rgba(255,255,255,0.05)', 'var(--foreground)')}>Edit</button>
            <button onClick={approve} disabled={!!busy} style={btn(confirmed ? 'rgba(67,160,71,0.18)' : '#43A047', confirmed ? '#43A047' : '#fff')}>{busy === 'approve' ? '…' : confirmed ? 'Approved ✓' : 'Approve'}</button>
          </>
        )}
      </div>
    </div>
  )
}

// Contract card: copy the onboarding link, or paste the creator's requested
// contract changes → AI drafts amendment clauses → admin accepts/rejects each →
// accepted set saves to 'Contract Amendments' and the wizard contract (and the
// signed PDF) regenerate with a numbered Amendments section. "Concession" rows
// (real business gives — payout timing, exclusivity, renewal…) start UNCHECKED.
function ContractAmendAction({ tile, hqId, onRefresh, flash }) {
  const [open, setOpen] = useState(false)
  const [reqText, setReqText] = useState('')
  const [busy, setBusy] = useState(null) // 'draft' | 'save' | 'copy' | 'clear' | 'compare'
  const [proposals, setProposals] = useState(null) // [{title, request, current, proposed, kind, accepted}]
  const [compare, setCompare] = useState(null) // { oldHtml, newHtml }
  const count = tile.action?.count || 0

  // Render the FULL contract twice — as saved today vs with the accepted
  // proposals — so the admin sees exactly what the creator will see.
  const openCompare = async () => {
    setBusy('compare')
    try {
      const accepted = (proposals || []).filter((p) => p.accepted).map((p) => ({ title: p.title, text: p.proposed }))
      const call = (body) => fetch('/api/admin/onboarding/contract-amendments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Preview failed'); return j.html })
      const [oldHtml, newHtml] = await Promise.all([
        call({ hqId, mode: 'preview' }),                       // saved state (what she sees today)
        call({ hqId, mode: 'preview', amendments: accepted }), // with accepted proposals
      ])
      setCompare({ oldHtml, newHtml })
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const copyLink = async () => {
    setBusy('copy')
    try {
      const res = await fetch('/api/admin/onboarding/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.onboardingUrl) {
        try { await navigator.clipboard.writeText(j.onboardingUrl) } catch { /* clipboard blocked */ }
        flash('Onboarding link copied')
      } else throw new Error(j.error || 'Failed')
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const draft = async () => {
    if (!reqText.trim()) { flash('Paste the creator’s requested changes first'); return }
    setBusy('draft')
    try {
      const res = await fetch('/api/admin/onboarding/contract-amendments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, mode: 'draft', requestText: reqText }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Draft failed')
      setProposals(j.proposals.map((p) => ({ ...p, accepted: p.kind !== 'concession' })))
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const save = async (list) => {
    setBusy('save')
    try {
      const accepted = (list || proposals || []).filter((p) => p.accepted).map((p) => ({ title: p.title, text: p.proposed }))
      const res = await fetch('/api/admin/onboarding/contract-amendments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, mode: 'save', amendments: accepted }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Save failed')
      flash(accepted.length ? `Saved ${accepted.length} amendment${accepted.length === 1 ? '' : 's'} — her contract now includes them` : 'Amendments cleared')
      setProposals(null); setReqText(''); setOpen(false)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const KIND = {
    fix: { label: 'FIX', color: '#7AC97A' },
    clarification: { label: 'CLARIFY', color: '#E8C878' },
    concession: { label: 'CONCESSION', color: '#E87878' },
  }
  const btn = (bg, color) => ({ flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: bg, color, opacity: busy ? 0.6 : 1 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button onClick={copyLink} disabled={!!busy} style={btn('rgba(255,255,255,0.05)', 'var(--foreground)')}>{busy === 'copy' ? '…' : 'Copy link'}</button>
        <button onClick={() => setOpen((o) => !o)} disabled={!!busy} style={btn('rgba(232,160,160,0.14)', 'var(--palm-pink)')}>{open ? 'Close' : 'Request changes'}</button>
      </div>
      {count > 0 && !open && (
        <button onClick={() => save([])} disabled={!!busy} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-subtle)', fontSize: '11px', cursor: 'pointer', padding: '2px', textDecoration: 'underline' }}>
          {busy === 'save' ? '…' : `Clear ${count} amendment${count === 1 ? '' : 's'}`}
        </button>
      )}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <textarea
            value={reqText}
            onChange={(e) => setReqText(e.target.value)}
            placeholder="Paste the creator’s message with her requested changes…"
            rows={4}
            style={{ width: '100%', padding: '7px 9px', fontSize: '12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)', resize: 'vertical' }}
          />
          <button onClick={draft} disabled={!!busy || !reqText.trim()} style={btn('#43A047', '#fff')}>{busy === 'draft' ? 'Drafting…' : 'Draft amendments with AI'}</button>
          {proposals && proposals.map((p, i) => {
            const k = KIND[p.kind] || KIND.clarification
            return (
              <div key={i} style={{ border: `1px solid ${p.accepted ? 'rgba(122,201,122,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '8px', padding: '8px 9px', background: 'rgba(255,255,255,0.02)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', marginBottom: '4px' }}>
                  <input type="checkbox" checked={p.accepted} onChange={(e) => setProposals((ps) => ps.map((x, j) => j === i ? { ...x, accepted: e.target.checked } : x))} />
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)' }}>{p.title}</span>
                  <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', color: k.color, border: `1px solid ${k.color}55`, borderRadius: '4px', padding: '1px 5px' }}>{k.label}</span>
                </label>
                {p.current && <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', marginBottom: '3px' }}>Now: {p.current}</div>}
                <div style={{ fontSize: '11.5px', color: 'var(--foreground)', lineHeight: 1.45 }}>{p.proposed}</div>
              </div>
            )
          })}
          {proposals && (
            <>
              <button onClick={openCompare} disabled={!!busy} style={btn('rgba(255,255,255,0.05)', 'var(--foreground)')}>
                {busy === 'compare' ? 'Rendering…' : 'Preview old vs new'}
              </button>
              <button onClick={() => save()} disabled={!!busy} style={btn('#43A047', '#fff')}>
                {busy === 'save' ? 'Saving…' : `Save ${proposals.filter((p) => p.accepted).length} accepted — regenerate her contract`}
              </button>
            </>
          )}
        </div>
      )}
      {compare && (
        <ContractCompareModal
          oldHtml={compare.oldHtml}
          newHtml={compare.newHtml}
          onClose={() => setCompare(null)}
          onSave={async () => { setCompare(null); await save() }}
          saving={busy === 'save'}
          acceptedCount={(proposals || []).filter((p) => p.accepted).length}
        />
      )}
    </div>
  )
}

// Full-page side-by-side of the rendered agreement: as saved today vs with the
// accepted amendments — the exact HTML the wizard preview and signed PDF use,
// isolated in iframes so the contract's own styling shows true to life.
function ContractCompareModal({ oldHtml, newHtml, onClose, onSave, saving, acceptedCount }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pane = (label, html, highlight) => (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: highlight ? '#7AC97A' : 'var(--foreground-muted)' }}>{label}</div>
      <iframe
        srcDoc={html}
        title={label}
        sandbox=""
        style={{ flex: 1, width: '100%', border: `1px solid ${highlight ? 'rgba(122,201,122,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '10px', background: '#fff' }}
      />
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: 'min(1500px, 100%)', height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>Contract — current vs with amendments</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--foreground-muted)', width: '28px', height: '28px', borderRadius: '7px', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: '14px', padding: '14px 18px', minHeight: 0 }}>
          {pane('Current — what she sees today', oldHtml, false)}
          {pane(`With ${acceptedCount} amendment${acceptedCount === 1 ? '' : 's'} — after save`, newHtml, true)}
        </div>
        <div style={{ padding: '11px 18px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)' }}>Back to edits</button>
          <button onClick={onSave} disabled={saving} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: saving ? 'default' : 'pointer', background: '#43A047', color: '#fff', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : `Looks right — save ${acceptedCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// Inline Yes/No for "Social media managed?" — flips the same `Social Media
// Editing` flag the dashboard "Editor" toggle writes (via the pipeline PATCH),
// so you can decide it right on the onboarding card instead of leaving to the
// profile. The board re-renders after, collapsing/expanding social-only steps.
function SocialToggleAction({ tile, opsId, onRefresh, flash }) {
  const [busy, setBusy] = useState(false)
  const on = tile.status === 'done' // done ⟺ Social Media Editing = true

  const set = async (value) => {
    if (busy || value === on) return
    if (!opsId) { flash('No Ops creator record for this creator yet'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/creators/pipeline', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: opsId, socialMediaEditing: value }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Update failed')
      flash(value ? 'Palm runs their socials — social steps enabled' : 'Socials not managed — social steps hidden')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  const seg = (active, activeBg) => ({
    flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 700, borderRadius: '7px',
    border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
    background: active ? activeBg : 'rgba(255,255,255,0.05)',
    color: active ? '#fff' : 'var(--foreground-muted)',
  })

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <button onClick={() => set(true)} disabled={busy} style={seg(on, '#43A047')}>Yes</button>
      <button onClick={() => set(false)} disabled={busy} style={seg(!on, '#8a6b74')}>No</button>
    </div>
  )
}

// Survey → chat team card: Preview (renders the answered Q&A in an in-app modal)
// and Send (deliver to the Palm Chatting group + stamp). Both call the local-only
// route; preview no longer opens Numbers/Acrobat.
function SurveySendAction({ tile, hqId, onboardingId, sentToTeam, onRefresh, flash }) {
  const [busy, setBusy] = useState(null) // 'preview' | 'send' | 'mark'
  const [preview, setPreview] = useState(null) // { items, answered, total, creator, team, skipped }
  // "sent" now tracks whether it went to the chat TEAM (not the card's overall
  // done state, which reflects survey submission on the merged card).
  const sent = !!sentToTeam

  const run = async (mode) => {
    setBusy(mode)
    try {
      const res = await fetch('/api/admin/onboarding/survey-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, mode }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed')
      if (mode === 'preview') {
        setPreview(j)
      } else {
        flash(`Sent to Palm Chatting — ${j.answered} of ${j.total} answered${j.stamped ? '' : ' (mark sent manually)'}`)
        await onRefresh()
      }
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  // Manual "already handled it" — flips Survey Sent to Chat Team without sending
  // anything (for creators onboarded before this flow, or already delivered).
  const markSent = async () => {
    if (!onboardingId) { flash('No onboarding record yet'); return }
    setBusy('mark')
    try {
      const res = await fetch('/api/admin/onboarding/checklist', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingId, fields: { 'Survey Sent to Chat Team': !sent, 'Survey Sent to Chat Team At': sent ? null : new Date().toISOString() } }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Update failed')
      flash(sent ? 'Marked not sent' : 'Marked sent to chat team')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const btn = (bg, color) => ({ flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: bg, color, opacity: busy ? 0.6 : 1 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button onClick={() => run('preview')} disabled={!!busy} style={btn('rgba(255,255,255,0.05)', 'var(--foreground)')}>{busy === 'preview' ? 'Loading…' : 'View answers'}</button>
        <button onClick={() => run('send')} disabled={!!busy} style={btn(sent ? 'rgba(67,160,71,0.18)' : '#43A047', sent ? '#43A047' : '#fff')}>{busy === 'send' ? 'Sending…' : sent ? 'Re-send' : 'Send to chat'}</button>
      </div>
      <button onClick={markSent} disabled={!!busy} style={{ ...btn('transparent', 'var(--foreground-subtle)'), fontSize: '11px', fontWeight: 600, padding: '3px', textDecoration: 'underline' }}>
        {busy === 'mark' ? '…' : sent ? 'Unmark sent' : 'Mark as already sent'}
      </button>
      {preview && <SurveyPreviewModal data={preview} onClose={() => setPreview(null)} onSend={async () => { setPreview(null); await run('send') }} sending={busy === 'send'} sent={sent} />}
    </div>
  )
}

// In-app preview of the survey brief (replaces opening PDF/CSV in Numbers/Acrobat).
// Renders the answered Q&A grouped by section, with a Send button to deliver.
function SurveyPreviewModal({ data, onClose, onSend, sending, sent }) {
  const items = Array.isArray(data?.items) ? data.items : []
  // Group answered items by section, preserving order.
  const groups = []
  for (const it of items) {
    let g = groups[groups.length - 1]
    if (!g || g.section !== it.section) { g = { section: it.section, rows: [] }; groups.push(g) }
    g.rows.push(it)
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: 'min(680px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
      >
        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--foreground)' }}>{data?.creator || 'Creator'} — Chat Team Brief</div>
            <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '2px' }}>
              Onboarding survey{data?.team ? ` · ${data.team}` : ''} · Answered {data?.answered ?? items.length} of {data?.total ?? items.length}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--foreground-muted)', width: '28px', height: '28px', borderRadius: '7px', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}>×</button>
        </div>

        {/* body */}
        <div style={{ padding: '8px 20px 16px', overflowY: 'auto' }}>
          {items.length === 0 && (
            <div style={{ fontSize: '13px', color: 'var(--foreground-muted)', padding: '24px 0', textAlign: 'center' }}>No answered questions to show.</div>
          )}
          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--palm-pink)', padding: '16px 0 6px' }}>{g.section}</div>
              {g.rows.map((r, ri) => (
                <div key={ri} style={{ padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '11.5px', color: 'var(--foreground-subtle)', marginBottom: '3px' }}>{r.label}</div>
                  <div style={{ fontSize: '13.5px', color: 'var(--foreground)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{r.answer}</div>
                </div>
              ))}
            </div>
          ))}
          {Array.isArray(data?.skipped) && data.skipped.length > 0 && (
            <div style={{ marginTop: '16px', padding: '9px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', fontSize: '11px', color: 'var(--foreground-subtle)', lineHeight: 1.5 }}>
              Not provided ({data.skipped.length}): {data.skipped.join(', ')}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)' }}>Close</button>
          <button onClick={onSend} disabled={sending} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: sending ? 'default' : 'pointer', background: '#43A047', color: '#fff', opacity: sending ? 0.6 : 1 }}>
            {sending ? 'Sending…' : sent ? 'Re-send to chat' : 'Send to chat'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Telegram group linker: shows the Add-bot link + the Telegram chats the bot has
// discovered (Pending, or already mapped to THIS creator). One tap on "This is
// her group" assigns the chat to the creator AND flips it to Watching (which
// starts task/to-do extraction for the dashboard). "Not hers" ignores a chat so
// it stops cluttering. Reuses the inbox's chats GET + per-chat PATCH endpoints.
function TelegramAssignAction({ tile, hqId, onboardingId, creatorAka, onRefresh, flash }) {
  const a = tile.action || {}
  const [chats, setChats] = useState(null) // null = not loaded yet
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState('')

  const akaLc = (creatorAka || '').trim().toLowerCase()

  const loadChats = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/inbox/chats')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not load chats')
      // Telegram only. Show chats that are candidates (Pending) or already this
      // creator's (mapped by HQ id, or title starts with her AKA — the bot's
      // "PALM x {aka}" auto-map). Hide unrelated watched/ignored chats.
      const rows = (j.chats || []).filter((c) => {
        if (c.source !== 'telegram') return false
        const mine = (c.creatorHqId && c.creatorHqId === hqId) ||
          (akaLc && String(c.title || '').toLowerCase().includes(akaLc)) ||
          (akaLc && String(c.subtitle || '').toLowerCase().includes(akaLc))
        return c.status === 'Pending Review' || mine
      })
      setChats(rows)
    } catch (e) { setErr(e.message); setChats([]) } finally { setLoading(false) }
  }, [hqId, akaLc])

  useEffect(() => { loadChats() }, [loadChats])

  const patchChat = async (chat, body, okMsg) => {
    setBusyId(chat.id)
    try {
      const res = await fetch(`/api/admin/inbox/chats/${chat.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Update failed')
      flash(okMsg)
      // First successful link auto-completes the "Telegram group" tile.
      if (body.status === 'Watching' && onboardingId) {
        try {
          await fetch('/api/admin/onboarding/checklist', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onboardingId, fields: { 'Telegram Bot Added': true } }),
          })
        } catch { /* non-fatal */ }
      }
      await loadChats()
      await onRefresh()
    } catch (e) { flash(e.message) } finally { setBusyId(null) }
  }

  const claim = (chat) => patchChat(
    chat,
    { status: 'Watching', category: 'Creator', creatorAka: creatorAka || '', creatorHqId: hqId },
    `Linked to ${creatorAka || 'creator'} — now tracking`,
  )
  const ignore = (chat) => patchChat(chat, { category: 'Personal' }, 'Marked personal — ignored')

  const linkBtn = 'https://t.me/palmmanage_bot?startgroup=true'
  const smallBtn = (bg, color) => ({ padding: '5px 9px', fontSize: '11px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: 'pointer', background: bg, color, whiteSpace: 'nowrap' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <a href={a.deepLink || linkBtn} target="_blank" rel="noreferrer"
          style={{ ...smallBtn('rgba(255,255,255,0.05)', 'var(--foreground)'), flex: 1, textAlign: 'center', textDecoration: 'none', lineHeight: '1.6' }}>
          {a.deepLinkLabel || 'Add bot'}
        </a>
        <button onClick={loadChats} disabled={loading} style={{ ...smallBtn('rgba(255,255,255,0.05)', 'var(--foreground-muted)'), opacity: loading ? 0.6 : 1 }}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {err && <div style={{ fontSize: '11px', color: '#E87878' }}>{err}</div>}

      {chats && chats.length === 0 && !err && (
        <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)', lineHeight: 1.4 }}>
          No group found yet. Add the bot, post any message in her group, then Refresh.
        </div>
      )}

      {chats && chats.map((c) => {
        const watching = c.status === 'Watching'
        const b = busyId === c.id
        return (
          <div key={c.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.title}>{c.title || '(untitled group)'}</div>
              {c.lastMessageSnippet && (
                <div style={{ fontSize: '10px', color: 'var(--foreground-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.lastMessageSnippet}</div>
              )}
            </div>
            {watching ? (
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#7AC97A' }}>✓ Tracking{c.creatorAka ? ` · ${c.creatorAka}` : ''}</div>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => claim(c)} disabled={b} style={{ ...smallBtn('rgba(232,160,160,0.14)', 'var(--palm-pink)'), flex: 1, opacity: b ? 0.6 : 1 }}>
                  {b ? 'Linking…' : `This is ${creatorAka || 'her'}’s group`}
                </button>
                <button onClick={() => ignore(c)} disabled={b} style={{ ...smallBtn('rgba(255,255,255,0.05)', 'var(--foreground-muted)'), opacity: b ? 0.6 : 1 }}>
                  Not hers
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function actionLabel(tile) {
  const a = tile.action
  if (!a) return ''
  if (a.label) return a.label
  if (a.type === 'run-setup') return tile.status === 'done' ? 'Re-run setup' : 'Run setup'
  if (a.type === 'check') return tile.status === 'done' ? 'Mark undone' : 'Mark done'
  if (a.type === 'analyze-dna') return tile.status === 'done' ? 'Re-run Analyze' : 'Run Analyze'
  if (a.type === 'reminder') return 'Copy onboarding link'
  return 'Open'
}

function GoLiveTile({ isActive, readiness, busy, onGo, startDate }) {
  if (isActive) {
    return (
      <div style={{ gridColumn: '1 / -1', background: 'rgba(67,160,71,0.08)', border: '1px solid rgba(67,160,71,0.3)', borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <CheckIcon size={18} />
        <span style={{ fontSize: '13px', color: 'var(--foreground)' }}>
          Live since {startDate ? new Date(startDate).toLocaleDateString() : 'today'}
        </span>
      </div>
    )
  }
  const ready = readiness?.ready
  return (
    <div style={{ gridColumn: '1 / -1', background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 16px' }}>
      {!ready && readiness?.missing?.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginBottom: '10px' }}>
          {readiness.missing.length} required item{readiness.missing.length === 1 ? '' : 's'} left: <span style={{ color: '#F9A825' }}>{readiness.missing.join(' · ')}</span>
        </div>
      )}
      <button
        onClick={onGo}
        disabled={!ready || busy}
        style={{
          width: '100%', padding: '11px', fontSize: '13px', fontWeight: 700, borderRadius: '9px', border: 'none',
          background: (!ready || busy) ? 'rgba(255,255,255,0.06)' : '#43A047',
          color: (!ready || busy) ? 'var(--foreground-subtle)' : '#fff',
          cursor: (!ready || busy) ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Going live…' : ready ? 'Mark Active — Go Live' : 'Complete required items to go live'}
      </button>
    </div>
  )
}

const backLink = {
  background: 'transparent', border: 'none', color: 'var(--foreground-muted)',
  fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0,
}
