'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
          {nextTile.action && !['set-chat-team', 'of-login', 'survey-send', 'toggle-social', 'contract-amend', 'telegram-assign', 'revenue-accounts', 'of-api', 'tg-topics', 'vault-requests', 'inline-number', 'doc-upload', 'photo-upload', 'comms-chat', 'music-dna', 'publer-sync'].includes(nextTile.action.type) && (
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
        ) : a?.type === 'revenue-accounts' ? (
          <RevenueAccountsAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'of-api' ? (
          <OfApiAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'tg-topics' ? (
          <TgTopicsAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'vault-requests' ? (
          <VaultRequestsAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'inline-number' ? (
          <InlineNumberAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'doc-upload' ? (
          <DocUploadAction tile={tile} opsId={opsId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'photo-upload' ? (
          <PhotoUploadAction tile={tile} hqId={hqId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'comms-chat' ? (
          <CommsChatAction tile={tile} opsId={opsId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'music-dna' ? (
          <MusicDnaAction tile={tile} opsId={opsId} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'publer-sync' ? (
          <PublerSyncAction tile={tile} onRefresh={onRefresh} flash={flash} />
        ) : a?.type === 'toggle-social' ? (
          <SocialToggleAction tile={tile} opsId={opsId} hqId={hqId} onRefresh={onRefresh} flash={flash} />
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
  // Resync from the server after every board refresh (unless mid-edit) —
  // otherwise creds the creator submits AFTER the board loaded never appear
  // and the admin concludes "no login yet" (reviewer finding, 2026-07-17).
  useEffect(() => {
    if (!editing && !busy) {
      setV({
        freeEmail: a.freeEmail || '', freePass: a.freePass || '',
        paidEmail: a.paidEmail || '', paidPass: a.paidPass || '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.freeEmail, a.freePass, a.paidEmail, a.paidPass])
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

// Revenue-accounts card: one row per OF page. Existing accounts show their
// status; missing ones get a one-click Create (name derived from AKA, so the
// prefix convention every reader depends on can't be typo'd).
function RevenueAccountsAction({ tile, hqId, onRefresh, flash }) {
  const [busy, setBusy] = useState(null) // accountType being created
  const a = tile.action || {}
  const accounts = a.accounts || []
  const expected = a.expected || []
  const has = (t) => accounts.find((acc) => acc.name.toLowerCase().endsWith(`- ${t.toLowerCase()}`))

  const create = async (accountType) => {
    setBusy(accountType)
    try {
      const res = await fetch('/api/admin/onboarding/of-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, action: 'create-account', accountType }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Create failed')
      flash(`${j.created} created`)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {['Free OF', 'VIP OF'].map((t) => {
        const acc = has(t)
        const wanted = expected.includes(t)
        if (acc) {
          return (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: acc.status === 'Active' ? '#43A047' : 'var(--foreground-muted)' }}>
              <span style={{ fontWeight: 600 }}>{t}</span>
              <span>{acc.status === 'Active' ? '✓ record exists' : `(${acc.status})`}</span>
            </div>
          )
        }
        if (!wanted) return null // she didn't select this page type — don't nag
        return (
          <button key={t} onClick={() => create(t)} disabled={!!busy}
            style={{ width: '100%', padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
            {busy === t ? 'Creating…' : `Create ${t} record`}
          </button>
        )
      })}
    </div>
  )
}

// OF-API card: the per-ACCOUNT connect decision. Each active OF page is either
// Connected (verified acct_… id), Skipped (deliberate no), or undecided (the
// only state the tile nags about). Connect verifies the id against the live
// API before saving and the route re-syncs the ops comma list.
function OfApiAction({ tile, hqId, onRefresh, flash }) {
  const [busy, setBusy] = useState(null) // `${accountId}:connect|skip|undo`
  const [ids, setIds] = useState({})     // revenueAccountId -> typed acct id
  const accounts = tile.action?.accounts || []

  const post = async (body, busyKey, okMsg) => {
    setBusy(busyKey)
    try {
      const res = await fetch('/api/admin/onboarding/of-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, ...body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed')
      flash(okMsg(j))
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  if (!accounts.length) {
    return <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '4px 0' }}>No active OF accounts yet — create them on the Revenue accounts card.</div>
  }

  const smallBtn = (bg, color, disabled) => ({ padding: '5px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '6px', border: 'none', cursor: disabled ? 'default' : 'pointer', background: bg, color, opacity: disabled ? 0.6 : 1, flexShrink: 0 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {accounts.map((acc) => {
        const short = acc.name.split(' - ').slice(1).join(' - ') || acc.name
        if (acc.connect === 'Connect' && acc.acctId) {
          return (
            <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{short}</span>
              <span style={{ color: '#43A047' }}>Connected</span>
              <span style={{ color: 'var(--foreground-subtle)', fontFamily: 'monospace', fontSize: '10px' }}>…{acc.acctId.slice(-6)}</span>
            </div>
          )
        }
        if (acc.connect === 'Skip') {
          return (
            <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{short}</span>
              <span style={{ color: 'var(--foreground-muted)' }}>Skipped — not connecting</span>
              <button onClick={() => post({ action: 'set-decision', revenueAccountId: acc.id, decision: '' }, `${acc.id}:undo`, () => 'Back to undecided')}
                disabled={!!busy} style={smallBtn('rgba(255,255,255,0.05)', 'var(--foreground-muted)', !!busy)}>
                {busy === `${acc.id}:undo` ? '…' : 'Undo'}
              </button>
            </div>
          )
        }
        return (
          <div key={acc.id} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground)' }}>{short}</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                value={ids[acc.id] || ''}
                placeholder="acct_…"
                disabled={!!busy}
                onChange={(e) => setIds((s) => ({ ...s, [acc.id]: e.target.value }))}
                style={{ flex: 1, minWidth: 0, padding: '5px 8px', fontSize: '11px', fontFamily: 'monospace', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)', outline: 'none' }}
              />
              <button
                onClick={() => post({ action: 'connect', revenueAccountId: acc.id, acctId: (ids[acc.id] || '').trim() }, `${acc.id}:connect`, (j) => `Connected${j.username ? ` — verified @${j.username}` : ''}`)}
                disabled={!!busy || !(ids[acc.id] || '').trim()}
                style={smallBtn('#43A047', '#fff', !!busy || !(ids[acc.id] || '').trim())}>
                {busy === `${acc.id}:connect` ? 'Verifying…' : 'Connect'}
              </button>
              <button
                onClick={() => post({ action: 'set-decision', revenueAccountId: acc.id, decision: 'Skip' }, `${acc.id}:skip`, () => `${short} marked as skipped`)}
                disabled={!!busy}
                style={smallBtn('rgba(255,255,255,0.05)', 'var(--foreground-muted)', !!busy)}>
                {busy === `${acc.id}:skip` ? '…' : 'Skip'}
              </button>
            </div>
          </div>
        )
      })}
      <a href="https://app.onlyfansapi.com" target="_blank" rel="noopener noreferrer"
        style={{ fontSize: '10px', color: 'var(--foreground-subtle)', textDecoration: 'underline' }}>
        Get the ID at app.onlyfansapi.com →
      </a>
    </div>
  )
}

// Delivery-topics card: one click creates the creator's missing IG / FB / AI
// forum topics in the SMM master group and writes the thread ids to ops Palm
// Creators — the fields ALL Post Prep / Penny / Grid Planner delivery keys on.
function TgTopicsAction({ tile, hqId, onRefresh, flash }) {
  const [busy, setBusy] = useState(false)
  const done = tile.status === 'done'

  const create = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/onboarding/telegram-topics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Topic creation failed')
      const made = Object.keys(j.created || {}).length
      flash(made ? `${made} topic${made === 1 ? '' : 's'} created and wired` : 'Nothing to create — all topics already set')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  if (done) {
    return <div style={{ fontSize: '11px', color: '#43A047', padding: '5px 0' }}>All delivery topics wired</div>
  }
  return (
    <button onClick={create} disabled={busy}
      style={{ width: '100%', padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Creating topics…' : 'Create missing topics'}
    </button>
  )
}

// Vault intake — ensure one standing Content Request per active OF account.
function VaultRequestsAction({ tile, hqId, onRefresh, flash }) {
  const [busy, setBusy] = useState(false)
  const done = tile.status === 'done'

  const create = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/onboarding/vault-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed')
      const n = (j.created || []).length + (j.stamped || []).length
      flash(n ? `${n} vault request${n === 1 ? '' : 's'} set up` : 'All accounts already covered')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  if (done) {
    return <div style={{ fontSize: '11px', color: '#43A047', padding: '5px 0' }}>Vault intake live for every account</div>
  }
  return (
    <button onClick={create} disabled={busy}
      style={{ width: '100%', padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Setting up…' : 'Create vault request(s)'}
    </button>
  )
}

// Inline number editor (commission %, weekly reel quota) — type, Save, done.
// mode 'percent' shows whole percents but stores the decimal (0.45).
function InlineNumberAction({ tile, hqId, onRefresh, flash }) {
  const a = tile.action || {}
  const initial = a.mode === 'percent' ? Math.round((a.value || 0) * 100) : (a.value || 0)
  const [v, setV] = useState(String(initial || ''))
  const [busy, setBusy] = useState(false)
  // Track the server value across refreshes (visible in Show-all mode).
  useEffect(() => { setV(String(initial || '')) }, [initial])

  const save = async () => {
    const num = Number(v)
    if (!Number.isFinite(num) || num < 0) { flash('Enter a number'); return }
    setBusy(true)
    try {
      const value = a.mode === 'percent' ? num / 100 : num
      const res = await fetch('/api/admin/onboarding/field', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, target: a.target, field: a.field, value }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Save failed')
      flash(`${a.field} saved`)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <input value={v} onChange={(e) => setV(e.target.value)} disabled={busy} inputMode="numeric"
        style={{ width: '70px', padding: '5px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)', outline: 'none' }} />
      <span style={{ fontSize: '11px', color: 'var(--foreground-muted)' }}>{a.mode === 'percent' ? '%' : (a.suffix || '')}</span>
      <button onClick={save} disabled={busy}
        style={{ flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// Voice memo / DNA docs — drop a file right on the card. Same 3-step flow as
// the DNA→Documents uploader: short-lived Dropbox token → direct browser
// upload (bypasses the Vercel body limit) → register the Airtable doc record.
function DocUploadAction({ tile, opsId, onRefresh, flash }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const creatorName = tile.action?.creatorName || ''

  const upload = async (file) => {
    if (!file) return
    if (!opsId) { flash('No Ops creator record yet — run Start Onboarding first'); return }
    setBusy(true)
    try {
      const tokenRes = await fetch(`/api/admin/creator-profile/upload-token?creatorName=${encodeURIComponent(creatorName)}`)
      const tokenData = await tokenRes.json().catch(() => ({}))
      if (!tokenRes.ok) throw new Error(tokenData.error || 'Failed to get upload token')
      const { accessToken, namespaceId, uploadPathPrefix } = tokenData
      const dropboxPath = `${uploadPathPrefix}/${file.name}`
      const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true, mute: true }),
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: namespaceId }),
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      })
      const uploadData = await uploadRes.json().catch(() => ({}))
      if (!uploadRes.ok) throw new Error(uploadData.error_summary || 'Dropbox upload failed')
      const isAudio = /\.(mp3|m4a|wav|ogg|flac|webm)$/i.test(file.name)
      const res = await fetch('/api/admin/creator-profile/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: opsId, fileType: isAudio ? 'Audio' : 'Document', notes: 'Uploaded from onboarding board',
          fileName: file.name, dropboxPath: uploadData.path_display || dropboxPath,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to register document')
      flash(`${file.name} uploaded${isAudio ? ' — counts as her voice memo' : ''}`)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div>
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        style={{ width: '100%', padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Uploading…' : 'Upload voice memo / doc'}
      </button>
    </div>
  )
}

// Profile photos — multi-file drop straight to Dropbox + her profile.
function PhotoUploadAction({ tile, hqId, onRefresh, flash }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const href = tile.action?.href

  const upload = async (files) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('file', f)
      const res = await fetch(`/api/admin/onboarding/${hqId}/photos`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Upload failed')
      flash(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded`)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => upload([...(e.target.files || [])])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        style={{ flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Uploading…' : 'Upload photos'}
      </button>
      {href && (
        <button onClick={() => window.open(href, '_self')} disabled={busy}
          style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--foreground-muted)' }}>
          View
        </button>
      )}
    </div>
  )
}

// Comms chat — pick the master communication chat inline (same route the
// Creators→Communication tab uses).
function CommsChatAction({ tile, opsId, onRefresh, flash }) {
  const [chats, setChats] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!opsId) { setChats([]); return }
    let alive = true
    fetch(`/api/admin/creators/${opsId}/communication-chat`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setChats(d?.chats || []) })
      .catch(() => { if (alive) setChats([]) })
    return () => { alive = false }
  }, [opsId])

  const pick = async (chatRecordId) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/creators/${opsId}/communication-chat`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatRecordId: chatRecordId || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Save failed')
      flash(chatRecordId ? 'Master chat set' : 'Master chat cleared')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  if (chats === null) return <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '5px 0' }}>Loading chats…</div>
  if (!chats.length) return <div style={{ fontSize: '11px', color: 'var(--foreground-muted)', padding: '5px 0' }}>No chats linked yet — add the bot to her group first.</div>

  const current = chats.find((c) => c.isCurrentMaster)
  return (
    <select value={current?.recordId || ''} disabled={busy} onChange={(e) => pick(e.target.value)}
      style={{ width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--foreground)' }}>
      <option value="">— pick her master chat —</option>
      {chats.map((c) => (
        <option key={c.recordId} value={c.recordId}>
          {c.title || c.chatId} ({c.source}{c.messageCount ? ` · ${c.messageCount} msgs` : ''})
        </option>
      ))}
    </select>
  )
}

// Music DNA — paste her playlist link (or a plain song list) and process, in
// one card. process-dna saves the input AND writes the processed DNA.
function MusicDnaAction({ tile, opsId, onRefresh, flash }) {
  const a = tile.action || {}
  const [v, setV] = useState(a.input || '')
  const [busy, setBusy] = useState(false)
  // Track the server value across refreshes (visible in Show-all mode).
  useEffect(() => { setV(a.input || '') }, [a.input])

  const detectType = (s) => (/spotify\.com/i.test(s) ? 'spotify_playlist' : /music\.apple\.com/i.test(s) ? 'apple_music' : 'text_list')

  const process = async () => {
    const raw = v.trim()
    if (!raw) { flash('Paste a playlist link or song list first'); return }
    if (!opsId) { flash('No Ops creator record yet'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/music/process-dna', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: opsId, inputType: detectType(raw), rawInput: raw }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Processing failed')
      flash(`Music DNA processed${j.tracks?.length ? ` — ${j.tracks.length} tracks` : ''}`)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <input value={v} placeholder="Spotify / Apple Music link or song list" disabled={busy}
        onChange={(e) => setV(e.target.value)}
        style={{ flex: 1, minWidth: 0, padding: '5px 8px', fontSize: '11px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--foreground)', outline: 'none' }} />
      <button onClick={process} disabled={busy || !v.trim()}
        style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy || !v.trim() ? 0.6 : 1, flexShrink: 0 }}>
        {busy ? 'Processing…' : (tile.status === 'done' ? 'Re-process' : 'Process')}
      </button>
    </div>
  )
}

// Publer — external connect happens in Publer's dashboard; the Sync pull +
// mapping check live here so you don't have to go hunting.
function PublerSyncAction({ tile, onRefresh, flash }) {
  const [busy, setBusy] = useState(false)

  const sync = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/publer/sync-accounts', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Sync failed')
      flash('Synced from Publer — map the account to her below if it just appeared')
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <button onClick={sync} disabled={busy}
        style={{ flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: busy ? 'default' : 'pointer', background: 'rgba(232,160,160,0.12)', color: 'var(--palm-pink)', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Syncing…' : 'Sync from Publer'}
      </button>
      <button onClick={() => window.open('/admin/social?tab=publer', '_self')}
        style={{ padding: '6px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--foreground-muted)' }}>
        Mapping
      </button>
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
  const [editor, setEditor] = useState(null)   // { editorHtml }
  const count = tile.action?.count || 0
  const hasOverride = !!tile.action?.hasOverride

  // Open the current effective contract with the body region contenteditable.
  const openEditor = async () => {
    setBusy('editor')
    try {
      const res = await fetch('/api/admin/onboarding/contract-amendments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, mode: 'get-body' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not load the contract')
      setEditor({ editorHtml: j.editorHtml })
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  const saveBody = async (body) => {
    setBusy('save-body')
    try {
      const res = await fetch('/api/admin/onboarding/contract-amendments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hqId, mode: 'save-body', bodyHtml: body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Save failed')
      flash(body ? 'Contract text saved — this is now exactly what she sees and signs' : 'Hand edits cleared — back to template + amendments')
      setEditor(null)
      await onRefresh()
    } catch (err) { flash(err.message) } finally { setBusy(null) }
  }

  // Render the FULL contract twice — as saved today vs with the accepted
  // proposals — so the admin sees exactly what the creator will see.
  const openCompare = async () => {
    setBusy('compare')
    try {
      const accepted = (proposals || []).filter((p) => p.accepted).map((p) => (
        p.applied ? { title: p.title, find: p.find, replace: p.replace } : { title: p.title, text: p.text || p.proposed }
      ))
      const call = (body) => fetch('/api/admin/onboarding/contract-amendments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Preview failed'); return j.html })
      const [oldHtml, newHtml] = await Promise.all([
        call({ hqId, mode: 'preview' }),                                        // saved state (what she sees today)
        call({ hqId, mode: 'preview', amendments: accepted, highlight: true }), // accepted edits, changes highlighted
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
      const accepted = (list || proposals || []).filter((p) => p.accepted).map((p) => (
        p.applied ? { title: p.title, find: p.find, replace: p.replace } : { title: p.title, text: p.text || p.proposed }
      ))
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
        <button onClick={openEditor} disabled={!!busy} style={btn('rgba(255,255,255,0.05)', 'var(--foreground)')}>{busy === 'editor' ? 'Loading…' : 'Edit text'}</button>
      </div>
      {(count > 0 || hasOverride) && !open && (
        <div style={{ display: 'flex', gap: '10px' }}>
          {count > 0 && (
            <button onClick={() => save([])} disabled={!!busy} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-subtle)', fontSize: '11px', cursor: 'pointer', padding: '2px', textDecoration: 'underline' }}>
              {busy === 'save' ? '…' : `Clear ${count} amendment${count === 1 ? '' : 's'}`}
            </button>
          )}
          {hasOverride && (
            <button onClick={() => saveBody('')} disabled={!!busy} style={{ background: 'transparent', border: 'none', color: 'var(--foreground-subtle)', fontSize: '11px', cursor: 'pointer', padding: '2px', textDecoration: 'underline' }}>
              {busy === 'save-body' ? '…' : 'Reset hand edits'}
            </button>
          )}
        </div>
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
                  {!p.applied && (
                    <span title="No clean in-place match — this one gets added as a numbered amendment at the end instead" style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--foreground-subtle)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '1px 5px' }}>ADDS AT END</span>
                  )}
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
      {editor && (
        <ContractEditorModal
          editorHtml={editor.editorHtml}
          onClose={() => setEditor(null)}
          onSave={saveBody}
          saving={busy === 'save-body'}
        />
      )}
    </div>
  )
}

// Full-document contract editor: the agreement renders true-to-life in an
// iframe with the body sections contenteditable (dashed outline). On save we
// read the edited region back and store it as the creator's Contract Body
// Override — from then on that EXACT text is her wizard preview + signed PDF.
function ContractEditorModal({ editorHtml, onClose, onSave, saving }) {
  const frameRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = () => {
    const doc = frameRef.current?.contentDocument
    const el = doc?.getElementById('palm-editable')
    if (!el) return
    onSave(el.innerHTML)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card-bg-solid)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: 'min(980px, 100%)', height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--foreground)' }}>Edit contract text</div>
            <div style={{ fontSize: '11.5px', color: 'var(--foreground-muted)', marginTop: '2px' }}>Click into the dashed area and edit like a document. What you save is exactly what she sees and signs.</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--foreground-muted)', width: '28px', height: '28px', borderRadius: '7px', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}>×</button>
        </div>
        <iframe
          ref={frameRef}
          srcDoc={editorHtml}
          title="Contract editor"
          style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
        />
        <div style={{ padding: '11px 18px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--foreground)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: saving ? 'default' : 'pointer', background: '#43A047', color: '#fff', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save contract text'}
          </button>
        </div>
      </div>
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
function SocialToggleAction({ tile, opsId, hqId, onRefresh, flash }) {
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
      // Flipping social ON auto-provisions her Telegram delivery topics
      // (IG/FB, +AI when TJP) — the fields all Post Prep delivery keys on.
      // Best-effort: a Telegram hiccup shouldn't block the toggle itself.
      let topicsNote = ''
      if (value && hqId) {
        try {
          const tr = await fetch('/api/admin/onboarding/telegram-topics', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hqId }),
          })
          const tj = await tr.json().catch(() => ({}))
          if (tr.ok) {
            const made = Object.keys(tj.created || {}).length
            topicsNote = made ? ` — ${made} delivery topic${made === 1 ? '' : 's'} created` : ''
          } else {
            topicsNote = ` — delivery topics NOT created (${tj.error || 'error'}); use the Delivery topics card`
          }
        } catch { topicsNote = ' — delivery topics not created; use the Delivery topics card' }
      }
      flash(value ? `Palm runs their socials — social steps enabled${topicsNote}` : 'Socials not managed — social steps hidden')
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
      {/* A-team CSV: the 62 CREATOR INTAKE FORM questions in Typeform order, filled
          from this creator's onboarding answers — what we hand the A-team. */}
      <a href={`/api/admin/onboarding/ateam-export?hqId=${hqId}`} style={{ ...btn('rgba(90,140,255,0.14)', '#7ea6ff'), textDecoration: 'none', textAlign: 'center', pointerEvents: hqId ? 'auto' : 'none' }}>
        Download A-Team CSV
      </a>
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
