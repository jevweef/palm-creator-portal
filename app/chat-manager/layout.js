'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, UserButton } from '@clerk/nextjs'

// Chat-manager section — the team's own login area, with a left sidebar menu:
//   /chat-manager/photo-library     the photo library they already use
//   /chat-manager/whale-hunting      sent whale analyses, admin-identical grid+modal
//   /chat-manager/chat-team-report   overnight coaching report, read-only + team-scoped
// The sidebar greets the manager by name and holds the tab menu. All pages
// render inside one fixed-width content column so every tab is the same width.
export default function ChatManagerLayout({ children }) {
  const pathname = usePathname()
  const { user, isLoaded } = useUser()
  const role = user?.publicMetadata?.role
  const allowed = ['admin', 'super_admin', 'chat_manager'].includes(role)

  if (!isLoaded) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Loading…</div>
  if (!user) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Sign in to view this page.</div>
  if (!allowed) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>This area is for the chat team. Ask Evan for access.</div>

  const firstName = user?.firstName || user?.fullName?.split(' ')[0] || 'there'
  // Live Chat is an opt-in per-person tool (toggled from /admin/team). Admins
  // always see it; a chat manager only sees the tab when her flag is on. The
  // server-side gate is the real enforcement — this just hides the entry point.
  const liveChatOn = ['admin', 'super_admin'].includes(role) || user?.publicMetadata?.liveChatAccess === true
  const tabs = [
    ['/chat-manager/photo-library', 'Photo Library'],
    ['/chat-manager/whale-hunting', 'Whale Hunting'],
    ...(liveChatOn ? [['/chat-manager/live-chat', 'Live Chat']] : []),
    ['/chat-manager/content-requests', 'Content Requests'],
    ['/chat-manager/chat-team-report', 'Chat Team Report'],
  ]

  return (
    <div className="cm-shell" style={{ minHeight: '100vh', background: 'var(--background, #141414)', color: 'var(--foreground, #F0ECE8)' }}>
      <style>{`
        .cm-shell { display: flex; align-items: stretch; }
        .cm-sidebar { width: 200px; flex-shrink: 0; border-right: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; gap: 16px; padding: 20px 12px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
        .cm-nav { display: flex; flex-direction: column; gap: 4px; }
        .cm-navlink { padding: 9px 14px; border-radius: 8px; font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; transition: background 0.12s; }
        .cm-userbtn { margin-top: auto; padding-top: 14px; }
        .cm-main { flex: 1; min-width: 0; padding: 24px clamp(12px, 2vw, 32px) 80px; }
        .cm-content { max-width: 1600px; margin: 0 auto; width: 100%; }
        @media (max-width: 768px) {
          .cm-shell { flex-direction: column; }
          .cm-sidebar { width: auto; height: auto; position: static; flex-direction: row; align-items: center; gap: 10px; padding: 12px 14px; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.07); overflow-x: auto; }
          .cm-hello { display: none; }
          .cm-nav { flex-direction: row; gap: 4px; }
          .cm-userbtn { margin-top: 0; margin-left: auto; padding-top: 0; }
          .cm-main { padding: 16px; }
        }
      `}</style>

      <aside className="cm-sidebar">
        <div>
          <div style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-0.01em' }}>Palm</div>
          <div className="cm-hello" style={{ fontSize: '13px', color: 'var(--foreground-muted, #8B8680)', marginTop: '8px' }}>
            Hello, <span style={{ color: 'var(--foreground)', fontWeight: 700 }}>{firstName}</span>
          </div>
        </div>
        <nav className="cm-nav">
          {tabs.map(([href, label]) => {
            const active = pathname.startsWith(href)
            return (
              <Link key={href} href={href} className="cm-navlink"
                style={{ background: active ? 'rgba(232,160,160,0.15)' : 'transparent', color: active ? 'var(--palm-pink, #E8A0A0)' : 'var(--foreground-muted, #8B8680)' }}>
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="cm-userbtn"><UserButton /></div>
      </aside>

      <main className="cm-main">
        <div className="cm-content">{children}</div>
      </main>
    </div>
  )
}
