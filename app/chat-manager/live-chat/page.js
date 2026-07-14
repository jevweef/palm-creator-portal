'use client'

// Chat-manager Live Chat — an EXACT mirror of the admin console. It renders the
// same component (@/app/admin/live-chat/page), so the two can never drift: any
// change to the admin view shows up here automatically.
//
// Access is enforced server-side on every /api/admin/live-chat/* call via
// requireLiveChatAccess() (admin, or a chat_manager with the liveChatAccess
// flag). This client guard is just UX — if her flag is off, the APIs 403 and
// this shows a clean message instead of a broken console.
import { useUser } from '@clerk/nextjs'
import AdminLiveChat from '@/app/admin/live-chat/page'

export default function ChatManagerLiveChat() {
  const { user, isLoaded } = useUser()
  if (!isLoaded) return <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>Loading…</div>

  const role = user?.publicMetadata?.role
  const allowed = role === 'admin' || role === 'super_admin' || (role === 'chat_manager' && user?.publicMetadata?.liveChatAccess === true)
  if (!allowed) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: '#8B8680' }}>
        Live Chat isn’t enabled for your account. Ask Evan to turn it on.
      </div>
    )
  }

  return <AdminLiveChat chatManagerView />
}
