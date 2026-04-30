import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

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
