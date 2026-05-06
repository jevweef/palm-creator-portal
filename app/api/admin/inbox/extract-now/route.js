// Admin-triggered manual run of the task extractor. Mirrors the cron logic
// directly (rather than HTTP-proxying) so we don't have to deal with
// passing CRON_SECRET around.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { requireInboxOwner } from '@/lib/adminAuth'
import { GET as runExtractor } from '@/app/api/cron/extract-tasks/route'

export async function POST(request) {
  const auth = await requireInboxOwner()
  if (auth instanceof NextResponse) return auth

  // Inject the bearer header so the underlying handler's auth check passes.
  // Add ?bypassCooldown=true — manual button means "look right now even if
  // Daily chats are mid-cooldown" (still respects skip-if-idle + filter).
  const cronSecret = process.env.CRON_SECRET
  const proxyHeaders = new Headers(request.headers)
  if (cronSecret) proxyHeaders.set('authorization', `Bearer ${cronSecret}`)
  const proxyUrl = new URL(request.url)
  proxyUrl.searchParams.set('bypassCooldown', 'true')
  const proxyReq = new Request(proxyUrl.toString(), { method: 'GET', headers: proxyHeaders })

  return runExtractor(proxyReq)
}
