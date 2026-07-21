import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Short invite link: app.palm-mgmt.com/join/<invitationId> → resolves the Clerk
// invitation, pulls its one-time ticket, and forwards to OUR OWN sign-up page
// (app domain) with the ticket attached. Keeps the shared link short and on
// app.palm-mgmt.com instead of the giant clerk.palm-mgmt.com/v1/tickets/... URL.
const CLERK = 'https://api.clerk.com/v1'

export async function GET(request, { params }) {
  const id = params.code
  try {
    const res = await fetch(`${CLERK}/invitations?status=pending&limit=100`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      cache: 'no-store',
    })
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data?.data || [])
    const inv = list.find((i) => i.id === id)
    if (inv?.url) {
      // Keep the accept flow on our domain by handing the ticket to our sign-up.
      const ticket = (() => { try { return new URL(inv.url).searchParams.get('ticket') } catch { return null } })()
      if (ticket) {
        return NextResponse.redirect(new URL(`/sign-up?__clerk_ticket=${encodeURIComponent(ticket)}`, request.url))
      }
      return NextResponse.redirect(inv.url)
    }
  } catch { /* fall through */ }
  // Invite not found / already used / revoked → send them to sign-in.
  return NextResponse.redirect(new URL('/sign-in', request.url))
}
