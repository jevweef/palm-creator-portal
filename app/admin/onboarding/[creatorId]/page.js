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
          flash('Reminder link copied')
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

      {/* groups */}
      {groups.map((g) => (
        <section key={g.key} style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{g.title}</h2>
            <span style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>{g.subtitle}</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: g.done === g.total ? '#43A047' : 'var(--foreground-muted)', fontWeight: 600 }}>
              {g.done}/{g.total}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' }}>
            {g.tiles.map((t) => (
              <Tile
                key={t.key}
                tile={t}
                busy={busy}
                onAction={() => runAction(t)}
                chatTeam={creator?.chatTeam}
                onChatTeam={setChatTeam}
              />
            ))}
            {g.key === 'golive' && (
              <GoLiveTile isActive={isActive} readiness={readiness} busy={busy === 'golive:go-live'} onGo={() => runAction({ key: 'golive', action: { type: 'go-live' } })} startDate={creator?.managementStartDate} />
            )}
          </div>
        </section>
      ))}

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

function Tile({ tile, busy, onAction, chatTeam, onChatTeam }) {
  const a = tile.action
  const isNa = tile.status === 'na'
  const blocked = tile.blocked
  const Icon = tile.status === 'done' ? CheckIcon : isNa ? NaIcon : WarnIcon
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
          {tile.detail && (
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

function actionLabel(tile) {
  const a = tile.action
  if (!a) return ''
  if (a.label) return a.label
  if (a.type === 'run-setup') return tile.status === 'done' ? 'Re-run setup' : 'Run setup'
  if (a.type === 'check') return tile.status === 'done' ? 'Mark undone' : 'Mark done'
  if (a.type === 'analyze-dna') return tile.status === 'done' ? 'Re-run builder' : 'Run builder'
  if (a.type === 'reminder') return 'Copy reminder'
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
