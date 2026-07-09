import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// Admin-only invitation management for chat managers. Uses Clerk invitations:
// the invitee gets an email with a one-time sign-up link, and the account is
// BORN with the role/team baked into public_metadata — open signup never
// grants a role, so uninvited accounts see nothing.

const CLERK = 'https://api.clerk.com/v1'
const headers = () => ({
  Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
  'Content-Type': 'application/json',
})

export async function GET() {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const res = await fetch(`${CLERK}/invitations?status=pending&limit=50`, { headers: headers(), cache: 'no-store' })
    const data = await res.json()
    const invites = (Array.isArray(data) ? data : data?.data || []).map((i) => ({
      id: i.id,
      email: i.email_address,
      role: i.public_metadata?.role || '',
      chatTeam: i.public_metadata?.chatTeam || '',
      createdAt: i.created_at,
    }))
    return NextResponse.json({ invites })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { email, chatTeam } = await request.json()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }
    if (!['A', 'B'].includes(chatTeam)) {
      return NextResponse.json({ error: 'chatTeam must be A or B' }, { status: 400 })
    }
    const res = await fetch(`${CLERK}/invitations`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        email_address: email.trim(),
        public_metadata: { role: 'chat_manager', chatTeam },
        notify: true,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      const msg = data?.errors?.[0]?.long_message || data?.errors?.[0]?.message || 'Clerk rejected the invitation'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ ok: true, id: data.id, email: data.email_address, status: data.status })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const res = await fetch(`${CLERK}/invitations/${id}/revoke`, { method: 'POST', headers: headers() })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data?.errors?.[0]?.message || 'revoke failed' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
