import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Public routes that don't require auth
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding',
  // Public creator link-in-bio pages + their gate/resolve (no auth).
  '/l/(.*)',
  '/api/l/(.*)',
  '/api/webhooks(.*)',
  '/api/onboarding/validate-token(.*)',
  '/api/admin/apify-callback(.*)',
  '/api/admin/recreate-callback(.*)',
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
  // Telegram reaction webhook (❤️ in a topic = post used → drops off runway).
  // Called by Telegram servers, which can't hold a Clerk session.
  '/api/telegram/reactions(.*)',
  // Penny immediate single-reel test+send. Reachable by an admin session (Evan
  // in the browser) OR a Bearer CRON_SECRET (headless trigger/validation). The
  // route enforces both itself; without this exemption Clerk 404s the bearer
  // call before the route's own auth runs (same pattern as the cron routes).
  '/api/admin/posts/penny-test-send(.*)',
  '/api/inbox/telegram(.*)',
  '/api/inbox/imessage(.*)',
  '/demo(.*)',
])

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return

  auth().protect()
})

export const config = {
  matcher: [
    // Skip static files and Next.js internals
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
