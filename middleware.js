import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes that don't require auth
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/admin/apify-callback(.*)',
  '/api/admin/promote-handle(.*)',
  '/api/admin/score-reels(.*)',
])

// Admin-only routes
const isAdminRoute = createRouteMatcher([
  '/admin(.*)',
  '/api/admin(.*)',
])

// Editor-only routes
const isEditorRoute = createRouteMatcher([
  '/editor(.*)',
  '/api/editor(.*)',
])

// Creator-allowed routes (creator paths + shared pages)
const isCreatorRoute = createRouteMatcher([
  '/creator(.*)',
  '/dashboard(.*)',
  '/inspo(.*)',
  '/my-content(.*)',
  '/api/creator(.*)',
  '/api/inspiration(.*)',
  '/api/saved-inspo(.*)',
  '/api/content-pipeline(.*)',
  '/api/creator-profile(.*)',
])

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return

  const { userId, sessionClaims } = auth()
  if (!userId) {
    auth().protect()
    return
  }

  // Debug: log sessionClaims keys to find correct paths
  if (req.nextUrl.pathname === '/admin') {
    console.log('[middleware] sessionClaims keys:', JSON.stringify(Object.keys(sessionClaims || {})))
    console.log('[middleware] sessionClaims:', JSON.stringify(sessionClaims))
  }

  const role = sessionClaims?.publicMetadata?.role || sessionClaims?.metadata?.role || sessionClaims?.public_metadata?.role
  const userType = sessionClaims?.publicMetadata?.userType || sessionClaims?.metadata?.userType || sessionClaims?.public_metadata?.userType
  const email = sessionClaims?.email || sessionClaims?.primaryEmail || sessionClaims?.emailAddresses?.[0] || ''

  const url = req.nextUrl

  // Super admin by email or role — can access everything
  const SUPER_ADMIN_EMAILS = ['evan@flylisted.com', 'evan@palm-mgmt.com']
  if (role === 'admin' || role === 'super_admin' || SUPER_ADMIN_EMAILS.includes(email)) return

  // Editor can access editor routes + shared routes, not admin
  if (role === 'editor') {
    if (isAdminRoute(req)) {
      return NextResponse.redirect(new URL('/editor', url))
    }
    return
  }

  // Creator: block admin and editor routes entirely
  if (userType === 'creator') {
    if (isAdminRoute(req) || isEditorRoute(req)) {
      const opsId = sessionClaims?.publicMetadata?.airtableOpsId || sessionClaims?.metadata?.airtableOpsId
      return NextResponse.redirect(new URL(opsId ? `/creator/${opsId}/dashboard` : '/dashboard', url))
    }
    return
  }

  // Default logged-in user with no role — block admin/editor
  if (isAdminRoute(req) || isEditorRoute(req)) {
    return NextResponse.redirect(new URL('/dashboard', url))
  }
})

export const config = {
  matcher: [
    // Skip static files and Next.js internals
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
