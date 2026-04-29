export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAdmin } from '@/lib/adminAuth'

// GET /api/photo-library/list-chat-managers
//
// Admin-only. Returns every Clerk user whose publicMetadata.role is
// 'chat_manager', so the admin's "View As" bar can list them and
// impersonate one. Also returns each user's chatTeam so the bar can
// show "(Team B)" next to the name.
//
// Clerk doesn't support server-side filtering by publicMetadata, so we
// pull a page of users and filter client-side. Limit kept low; if the
// org ever grows past ~100 chat managers we'd need pagination.
export async function GET() {
  try {
    await requireAdmin()
  } catch (e) { return e }

  try {
    const client = await clerkClient()
    const list = await client.users.getUserList({ limit: 100 })
    const users = (list?.data || list || [])
      .filter(u => u?.publicMetadata?.role === 'chat_manager')
      .map(u => ({
        id: u.id,
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.publicMetadata?.name || ''),
        email: u.primaryEmailAddress?.emailAddress || u.emailAddresses?.[0]?.emailAddress || '',
        chatTeam: u.publicMetadata?.chatTeam || null,
      }))
      // Sort by first name for a stable dropdown order
      .sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email))

    return NextResponse.json({ users })
  } catch (err) {
    console.error('[list-chat-managers] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
