'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, UserButton } from '@clerk/nextjs'

// Chat-manager section — the team's own login area:
//   /chat-manager/photo-library     the photo library they already use
//   /chat-manager/whale-hunting      sent whale analyses, admin-identical grid+modal
//   /chat-manager/chat-team-report   overnight coaching report, read-only + team-scoped
export default function ChatManagerLayout({ children }) {
  const pathname = usePathname()
  const { user, isLoaded } = useUser()
  const role = user?.publicMetadata?.role
  const allowed = ['admin', 'super_admin', 'chat_manager'].includes(role)

  if (!isLoaded) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Loading…</div>
  if (!user) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Sign in to view this page.</div>
  if (!allowed) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>This area is for the chat team. Ask Evan for access.</div>

  const tabs = [
    ['/chat-manager/photo-library', 'Photo Library'],
    ['/chat-manager/whale-hunting', 'Whale Hunting'],
    ['/chat-manager/chat-team-report', 'Chat Team Report'],
  ]
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background, #141414)', color: 'var(--foreground, #F0ECE8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px', padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <span style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-0.01em' }}>Palm</span>
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '3px' }}>
          {tabs.map(([href, label]) => (
            <Link key={href} href={href}
              style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', textDecoration: 'none', background: pathname.startsWith(href) ? 'rgba(232,160,160,0.15)' : 'transparent', color: pathname.startsWith(href) ? 'var(--palm-pink, #E8A0A0)' : 'var(--foreground-muted, #8B8680)' }}>
              {label}
            </Link>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}><UserButton /></div>
      </div>
      <div style={{ padding: '20px 24px 80px' }}>{children}</div>
    </div>
  )
}
