import { clerkMiddleware, createRouteMatcher, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes that don't require auth
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/not-authorized(.*)',
  '/onboarding',
  '/api/webhooks(.*)',
  '/api/onboarding/validate-token(.*)',
  '/api/admin/apify-callback(.*)',
  '/api/admin/promote-handle(.*)',
  '/api/admin/score-reels(.*)',
  '/api/admin/mirror-asset(.*)',
  '/api/admin/mirror-inspiration(.*)',
  // Cron routes carry no Clerk session — Vercel hits them with a Bearer
  // CRON_SECRET header. Without this exemption Clerk middleware redirects
  // them and they all return 404. Each cron route enforces its own auth
  // via CRON_SECRET, so this is safe to bypass at the middleware layer.
  '/api/cron(.*)',
  // Telegram send endpoint is called both by admins (UI) AND by the cron
  // worker internally (via x-cron-secret header). The route enforces its
  // own auth: admin session OR cron-secret. Without this exemption the
  // cron's internal POST gets 404'd by Clerk before the route's own auth
  // check runs.
  '/api/telegram/send(.*)',
  '/api/inbox/telegram(.*)',
  '/api/inbox/imessage(.*)',
  '/demo(.*)',
])

// Routes a signed-in user with no role can still hit (so they can finish
// onboarding via the tokenized link, or sign out from the holding page).
const isRoleExemptRoute = createRouteMatcher([
  '/not-authorized(.*)',
  '/onboarding(.*)',
  '/api/onboarding(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return

  const { userId } = auth().protect()

  // Defense in depth: any signed-in user with no role gets bounced to a
  // holding page. New self-serve sign-ups land here with no metadata.role —
  // we don't want them seeing the inspo board, dashboard, etc.
  // Roles are set via Clerk publicMetadata when an admin links the account
  // to a creator/editor/chat_manager record (or grants admin).
  // Note: sessionClaims doesn't reliably include publicMetadata in Clerk v5
  // without custom JWT template config, so we fetch the user inline.
  if (!isRoleExemptRoute(req) && userId) {
    try {
      const user = await clerkClient().users.getUser(userId)
      const role = user?.publicMetadata?.role
      if (!role) {
        const url = req.nextUrl.clone()
        url.pathname = '/not-authorized'
        url.search = ''
        return NextResponse.redirect(url)
      }
    } catch (err) {
      // If Clerk user lookup fails for any reason, fail open for now —
      // we don't want to lock everyone out of the portal during an outage.
      // The page-level checks in app/page.js and per-section layouts still
      // do role-based routing.
      console.error('[middleware] role check failed', err)
    }
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
