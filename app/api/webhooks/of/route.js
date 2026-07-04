// Palm's OWN onlyfansapi webhook endpoint — distinct from Brett's
// (/api/webhooks/onlyfansapi, registered 2026-06-06 for his site rebuild).
// Same receiver logic; separate address so each webhook has one clear owner
// and Brett can repoint his without touching our transaction feed.
export { GET, POST } from '../onlyfansapi/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
