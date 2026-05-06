'use client'

/**
 * Per-creator communication routing manager. Sits at
 * /admin/creators?tab=communication.
 *
 * Lists every active creator and shows which chat the portal will use
 * for ANY automated outbound to them — OFTV cut deliveries today,
 * future inspo digests, etc. Click a row to open a modal that lists
 * every chat already linked to that creator (any source / status) and
 * pick one as the master. Picking writes to the Communication Chat
 * field on Palm Creators (Ops).
 *
 * Why this lives in /admin/creators and not /admin/editor: routing is
 * a creator-level setting, not OFTV-specific. As we add more automation
 * channels (weekly inspo digest, posting reminders, billing nudges)
 * they all read from the same Communication Chat field.
 */

import { useEffect, useState, useCallback } from 'react'
import { useBackdropDismiss } from '@/lib/useBackdropDismiss'
import { useToast } from '@/lib/useToast'

function fmtRel(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

function SourceBadge({ source }) {
  const map = {
    imessage: { label: 'iMessage', bg: 'rgba(125, 211, 164, 0.10)', color: '#7DD3A4' },
    telegram: { label: 'Telegram', bg: 'rgba(120, 180, 232, 0.10)', color: '#78B4E8' },
  }
  const s = map[source] || { label: source || '—', bg: 'rgba(255,255,255,0.04)', color: 'var(--foreground-muted)' }
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '9999px',
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

function StatusBadge({ status }) {
  const map = {
    'Watching': { color: '#7DD3A4' },
    'Pending Review': { color: '#E8C878' },
    'Ignored': { color: '#9ca3af' },
  }
  const s = map[status] || { color: 'var(--foreground-muted)' }
  return (
    <span style={{ fontSize: '10px', color: s.color, fontWeight: 500 }}>{status || '—'}</span>
  )
}

function ChatPickerModal({ creator, onClose, onSaved, toast }) {
  const [data, setData] = useState(null)
  const [saving, setSaving] = useState('')
  const dismiss = useBackdropDismiss(onClose, () => !saving)

  useEffect(() => {
    fetch(`/api/admin/creators/${creator.opsId}/communication-chat`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ error: 'Failed to load' }))
  }, [creator.opsId])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const setMaster = async (recordId) => {
    setSaving(recordId || 'clear')
    try {
      const res = await fetch(`/api/admin/creators/${creator.opsId}/communication-chat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatRecordId: recordId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      toast(recordId ? 'Master chat updated' : 'Master chat cleared', 'success')
      onSaved()
      onClose()
    } catch (e) {
      toast(e.message || 'Save failed', 'error')
    } finally {
      setSaving('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" {...dismiss}>
      <div style={{
        background: 'var(--card-bg-solid)', borderRadius: '20px', width: '100%', maxWidth: '720px',
        maxHeight: '90vh', overflow: 'auto', margin: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0, color: 'var(--foreground)' }}>
              Communication chat for {creator.aka}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
              All automated outbound (OFTV deliveries, future inspo digests, etc.) lands in the chat you pick here.
            </p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--foreground-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {!data ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading chats…</div>
          ) : data.error ? (
            <div style={{ color: '#E87878', fontSize: '13px' }}>{data.error}</div>
          ) : data.chats.length === 0 ? (
            <div style={{
              padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px',
              border: '1px dashed rgba(255,255,255,0.10)', textAlign: 'center',
            }}>
              <div style={{ fontSize: '13px', color: 'var(--foreground)', fontWeight: 600, marginBottom: '6px' }}>
                No chats linked to this creator yet
              </div>
              <div style={{ fontSize: '12px', color: 'var(--foreground-muted)' }}>
                Go to Inbox → assign a chat to this creator (Watch / Assign to Creator). Once tagged, it'll show up here.
              </div>
            </div>
          ) : (
            <>
              {data.chats.map(c => (
                <div key={c.recordId} style={{
                  marginBottom: '8px', padding: '12px 14px', borderRadius: '10px',
                  background: c.isCurrentMaster ? 'rgba(232, 160, 160, 0.06)' : 'rgba(255,255,255,0.03)',
                  border: c.isCurrentMaster ? '1px solid rgba(232, 160, 160, 0.30)' : '1px solid transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)' }}>
                          {c.title || '(untitled chat)'}
                        </span>
                        <SourceBadge source={c.source} />
                        <StatusBadge status={c.status} />
                        {c.isCurrentMaster && (
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--palm-pink)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            ★ master
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>
                        {c.type || 'chat'} · {c.messageCount} messages · last {fmtRel(c.lastMessageAt)}
                      </div>
                    </div>
                    {!c.isCurrentMaster ? (
                      <button
                        onClick={() => setMaster(c.recordId)}
                        disabled={!!saving}
                        style={{
                          padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                          background: 'var(--palm-pink)', color: '#1a1a1a', border: 'none',
                          borderRadius: '9999px', cursor: saving ? 'not-allowed' : 'pointer',
                          opacity: saving === c.recordId ? 0.5 : 1, whiteSpace: 'nowrap',
                        }}
                      >{saving === c.recordId ? 'Setting…' : 'Set as master'}</button>
                    ) : (
                      <button
                        onClick={() => setMaster(null)}
                        disabled={!!saving}
                        style={{
                          padding: '7px 14px', fontSize: '12px', fontWeight: 600,
                          background: 'transparent', color: 'var(--foreground-muted)',
                          border: '1px solid rgba(255,255,255,0.10)', borderRadius: '9999px',
                          cursor: saving ? 'not-allowed' : 'pointer',
                        }}
                      >Clear master</button>
                    )}
                  </div>
                </div>
              ))}
              <div style={{
                marginTop: '16px', padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(120, 180, 232, 0.05)', border: '1px solid rgba(120, 180, 232, 0.15)',
                fontSize: '11px', color: 'var(--foreground-muted)',
              }}>
                💡 Setting a master overrides the auto-pick (which prefers iMessage chats in Watching status).
                If you don't set one, the system falls back to the first watched iMessage chat for this creator.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CreatorsCommunication() {
  const [rows, setRows] = useState(null)
  const [picking, setPicking] = useState(null) // { opsId, aka }
  const { toast, ToastViewport } = useToast()

  const load = useCallback(() => {
    fetch('/api/admin/oftv-projects/notification-routing')
      .then(r => r.json())
      .then(d => setRows(d.rows || []))
      .catch(() => setRows([]))
  }, [])

  useEffect(() => { load() }, [load])

  if (rows === null) {
    return <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-muted)', fontSize: '13px' }}>Loading…</div>
  }

  const ready = rows.filter(r => r.readyToSend).length
  const total = rows.length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Communication routing</h2>
          <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '4px' }}>
            Where automated outbound from the portal lands for each creator. Click any row to pick or change the master chat.
          </p>
        </div>
        <div style={{
          fontSize: '12px', color: ready === total ? '#7DD3A4' : '#E8C878',
          padding: '6px 12px', borderRadius: '9999px',
          background: ready === total ? 'rgba(125, 211, 164, 0.08)' : 'rgba(232, 200, 120, 0.08)',
        }}>
          {ready} / {total} ready
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {rows.map(r => {
          const chatOk = !!r.chat?.chatId && r.readyToSend
          return (
            <div
              key={r.creatorOpsId}
              onClick={() => setPicking({ opsId: r.creatorOpsId, aka: r.aka })}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px',
                padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
                background: 'var(--card-bg-solid)',
                border: chatOk ? '1px solid transparent' : '1px solid rgba(232, 200, 120, 0.20)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--card-bg-solid)' }}
            >
              <div style={{ minWidth: 0, flex: '0 0 180px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--foreground)' }}>{r.aka || '—'}</div>
                {r.communicationName && r.communicationName !== r.aka && (
                  <div style={{ fontSize: '11px', color: 'var(--foreground-subtle)' }}>called "{r.communicationName}"</div>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {r.chat ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', color: 'var(--foreground)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
                      {r.chat.title || '(untitled)'}
                    </span>
                    <SourceBadge source={r.chat.source} />
                    <StatusBadge status={r.chat.status} />
                    {r.chat.isOverride && (
                      <span style={{ fontSize: '10px', color: 'var(--palm-pink)', fontWeight: 600 }}>★ pinned</span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: '12px', color: '#E8A878' }}>no chat assigned</span>
                )}
                {r.issues.length > 0 && (
                  <div style={{ fontSize: '11px', color: '#E8A878', marginTop: '4px' }}>
                    {r.issues.join(' · ')}
                  </div>
                )}
              </div>

              <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {chatOk ? (
                  <span style={{ fontSize: '11px', color: '#7DD3A4', fontWeight: 600 }}>✓ ready</span>
                ) : (
                  <span style={{ fontSize: '11px', color: '#E8A878', fontWeight: 600 }}>needs setup</span>
                )}
                <span style={{ color: 'var(--foreground-subtle)', fontSize: '16px' }}>→</span>
              </div>
            </div>
          )
        })}
      </div>

      {picking && (
        <ChatPickerModal
          creator={picking}
          onClose={() => setPicking(null)}
          onSaved={load}
          toast={toast}
        />
      )}

      <ToastViewport />
    </div>
  )
}
