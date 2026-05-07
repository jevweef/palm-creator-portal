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

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return

  auth().protect()

  // ROLE CHECK DISABLED 2026-05-06 — was bouncing legitimate creators to
  // /not-authorized. Cause under investigation: some creator accounts
  // appear to not have publicMetadata.role populated even though they
  // have full Airtable creator records. Re-enable after fixing.
})

export const config = {
  matcher: [
    // Skip static files and Next.js internals
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
