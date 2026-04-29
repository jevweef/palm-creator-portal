'use client'

import { useUser } from '@clerk/nextjs'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

const SUPER_ADMIN_EMAILS = ['evan@flylisted.com', 'evan@palm-mgmt.com']

export default function SuperAdminBar() {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const pathname = usePathname()
  const [creators, setCreators] = useState([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedCreator, setSelectedCreator] = useState(null)
  const dropdownRef = useRef(null)
  // Chat-manager impersonation list (lazy-loaded once on first hover).
  const [chatManagers, setChatManagers] = useState([])
  const [chatManagersLoaded, setChatManagersLoaded] = useState(false)
  const [chatMgrDropdownOpen, setChatMgrDropdownOpen] = useState(false)
  const [selectedChatManager, setSelectedChatManager] = useState(null)
  const chatMgrDropdownRef = useRef(null)

  const email = user?.primaryEmailAddress?.emailAddress
  const role = user?.publicMetadata?.role
  const isSuperAdmin = isLoaded && (role === 'super_admin' || SUPER_ADMIN_EMAILS.includes(email))

  // Determine active tab from pathname
  const isCreatorTab = pathname?.startsWith('/creator')
  const isEditorTab = pathname?.startsWith('/editor')
  const isChatManagerTab = pathname?.startsWith('/admin/chat-wall')
  const isAdminTab = !isCreatorTab && !isEditorTab && !isChatManagerTab

  // Fetch creators for picker, then reconcile with stored selection
  useEffect(() => {
    if (!isSuperAdmin) return
    fetch('/api/admin/palm-creators')
      .then(r => r.json())
      .then(data => {
        const list = data.creators || []
        setCreators(list)
        // Reconcile localStorage with fresh data so hqId is always current
        try {
          const stored = localStorage.getItem('superadmin_creator')
          if (stored) {
            const parsed = JSON.parse(stored)
            const fresh = list.find(c => c.id === parsed.id)
            if (fresh) {
              setSelectedCreator(fresh)
              localStorage.setItem('superadmin_creator', JSON.stringify(fresh))
            } else {
              setSelectedCreator(parsed)
            }
          }
        } catch {}
      })
      .catch(() => {})
  }, [isSuperAdmin])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
      if (chatMgrDropdownRef.current && !chatMgrDropdownRef.current.contains(e.target)) {
        setChatMgrDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Hydrate the selected chat manager from localStorage on mount, so the
  // selection survives refreshes the same way Creator does.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem('superadmin_chatManager')
      if (stored) setSelectedChatManager(JSON.parse(stored))
    } catch {}
  }, [])

  // Lazy-load the chat manager list. Triggered when the dropdown opens
  // (or before, on tab hover) so the cost of one Clerk API call only
  // happens for super admins who actually use the impersonation feature.
  const ensureChatManagersLoaded = async () => {
    if (chatManagersLoaded) return
    try {
      const res = await fetch('/api/admin/chat-wall/list-chat-managers')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setChatManagers(data.users || [])
    } catch (err) {
      console.warn('[SuperAdminBar] failed to load chat managers:', err)
    } finally {
      setChatManagersLoaded(true)
    }
  }

  if (!isSuperAdmin || pathname?.startsWith('/onboarding')) return null

  const tabStyle = (active) => ({
    padding: '4px 14px',
    fontSize: '10px',
    fontWeight: 500,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    borderRadius: '4px',
    cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--palm-pink)' : 'transparent',
    color: active ? '#060606' : 'var(--foreground-muted)',
    transition: 'all 0.3s var(--ease-stripe)',
  })

  const handleAdminTab = () => router.push('/admin/dashboard')
  const handleEditorTab = () => router.push('/editor')

  const handleChatManagerSelect = (cm) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('superadmin_chatManager', JSON.stringify(cm))
    }
    setSelectedChatManager(cm)
    setChatMgrDropdownOpen(false)
    router.push('/admin/chat-wall')
  }
  const handleClearChatManager = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('superadmin_chatManager')
    }
    setSelectedChatManager(null)
    setChatMgrDropdownOpen(false)
    router.push('/admin/chat-wall')
  }
  const handleCreatorSelect = (creator) => {
    setSelectedCreator(creator)
    localStorage.setItem('superadmin_creator', JSON.stringify(creator))
    setDropdownOpen(false)
    const hqParam = creator.hqId ? `?hqId=${creator.hqId}` : ''
    router.push(`/creator/${creator.id}/dashboard${hqParam}`)
  }

  const creatorLabel = selectedCreator?.aka || selectedCreator?.name || 'Select creator'

  return (
    <div style={{
      background: 'rgba(232, 160, 160, 0.04)',
      borderBottom: '1px solid var(--card-border)',
      padding: '8px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    }}>
      <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--palm-pink)', textTransform: 'uppercase', letterSpacing: '0.2em', marginRight: '12px', opacity: 0.7 }}>
        View as
      </span>

      <button style={tabStyle(isAdminTab)} onClick={handleAdminTab}>Admin</button>
      <button style={tabStyle(isEditorTab)} onClick={handleEditorTab}>Editor</button>

      {/* Chat Manager tab — clicking opens a dropdown with every chat
          manager user from Clerk so the admin can impersonate a specific
          one (and see exactly what that user sees, scoped to their team).
          "Anyone (admin view)" clears the selection and goes back to
          unscoped admin browsing. */}
      <div ref={chatMgrDropdownRef} style={{ position: 'relative' }}>
        <button
          onMouseEnter={ensureChatManagersLoaded}
          onClick={() => {
            ensureChatManagersLoaded()
            setChatMgrDropdownOpen(o => !o)
          }}
          style={{
            ...tabStyle(isChatManagerTab),
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          Chat Manager
          {selectedChatManager && (
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', opacity: 0.8 }}>
              · {selectedChatManager.firstName || selectedChatManager.fullName || 'user'}
            </span>
          )}
          <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
        </button>

        {chatMgrDropdownOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            background: '#0a0a0a',
            border: '1px solid var(--card-border)',
            borderRadius: '12px',
            minWidth: '240px',
            zIndex: 1000,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(20px)',
          }}>
            <button
              onClick={handleClearChatManager}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 16px',
                textAlign: 'left',
                background: !selectedChatManager ? 'rgba(232, 160, 160, 0.08)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                color: !selectedChatManager ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                fontSize: '12px',
                fontStyle: 'italic',
                cursor: 'pointer',
              }}
            >
              Anyone (admin view)
            </button>
            {!chatManagersLoaded && (
              <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>Loading...</div>
            )}
            {chatManagersLoaded && chatManagers.length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>
                No chat manager users yet.
              </div>
            )}
            {chatManagers.map(cm => (
              <button
                key={cm.id}
                onClick={() => handleChatManagerSelect(cm)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  background: selectedChatManager?.id === cm.id ? 'rgba(232, 160, 160, 0.08)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  color: selectedChatManager?.id === cm.id ? 'var(--palm-pink)' : 'var(--foreground)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'background 0.2s var(--ease-stripe)',
                }}
                onMouseEnter={e => { if (selectedChatManager?.id !== cm.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if (selectedChatManager?.id !== cm.id) e.currentTarget.style.background = 'transparent' }}
              >
                {cm.fullName || cm.email}
                {cm.chatTeam && (
                  <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginLeft: '8px' }}>
                    · {cm.chatTeam}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Creator tab with dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          style={{
            ...tabStyle(isCreatorTab),
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          onClick={() => {
            if (isCreatorTab) {
              setDropdownOpen(o => !o)
            } else if (selectedCreator) {
              const hqParam = selectedCreator.hqId ? `?hqId=${selectedCreator.hqId}` : ''
              router.push(`/creator/${selectedCreator.id}/dashboard${hqParam}`)
            } else {
              setDropdownOpen(true)
            }
          }}
        >
          Creator
          {isCreatorTab && selectedCreator && (
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', opacity: 0.8 }}>
              · {creatorLabel}
            </span>
          )}
          <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            background: '#0a0a0a',
            border: '1px solid var(--card-border)',
            borderRadius: '12px',
            minWidth: '200px',
            zIndex: 1000,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(20px)',
          }}>
            {creators.length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--foreground-muted)' }}>Loading...</div>
            )}
            {creators.map(c => (
              <button
                key={c.id}
                onClick={() => handleCreatorSelect(c)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  background: selectedCreator?.id === c.id ? 'rgba(232, 160, 160, 0.08)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  color: selectedCreator?.id === c.id ? 'var(--palm-pink)' : 'var(--foreground)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'background 0.2s var(--ease-stripe)',
                }}
                onMouseEnter={e => { if (selectedCreator?.id !== c.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if (selectedCreator?.id !== c.id) e.currentTarget.style.background = 'transparent' }}
              >
                {c.aka || c.name}
                <span style={{ fontSize: '10px', color: 'var(--foreground-subtle)', marginLeft: '8px' }}>{c.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
