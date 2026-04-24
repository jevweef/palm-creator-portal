import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes that don't require auth
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding',
  '/api/webhooks(.*)',
  '/api/onboarding/validate-token(.*)',
  '/api/admin/apify-callback(.*)',
  '/api/admin/promote-handle(.*)',
  '/api/admin/score-reels(.*)',
  '/demo(.*)',
])

// Routes a social_media user should be bounced out of. They belong in /sm/*.
// Admins are never restricted — they can preview any surface via the role toggle.
const isSmmBlockedRoute = createRouteMatcher([
  '/admin(.*)',
  '/dashboard(.*)',
  '/editor(.*)',
  '/my-content(.*)',
  '/inspo(.*)',
  '/creator(.*)',
  '/content-request(.*)',
])

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return

  auth().protect()

  // Role-based redirect for social_media users. Requires a Clerk session token
  // template that exposes publicMetadata on session claims — otherwise the
  // redirect silently no-ops, and all /api/admin/* routes still enforce auth
  // via requireAdmin() / requireAdminOrSocialMedia() regardless.
  const { sessionClaims } = auth()
  const role = sessionClaims?.publicMetadata?.role
    || sessionClaims?.metadata?.role
    || sessionClaims?.role

  if (role === 'social_media' && isSmmBlockedRoute(req)) {
    const url = req.nextUrl.clone()
    url.pathname = '/sm'
    url.search = ''
    return NextResponse.redirect(url)
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
