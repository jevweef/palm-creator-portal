// Palm's own link-in-bio ("link pages"). Public page at /l/{slug}; gated links
// (the OnlyFans "More of me") route through /l/{slug}/go/{linkId} so the real
// destination NEVER appears in the page HTML — Instagram's link scrapers see
// only our domain. The OF URL is fetched by JS from /api/l/resolve after an
// interstitial, and resolved server-side from Airtable.

const OPS_BASE = 'applLIT2t83plMqNx'
const TABLE = 'tbllAQmY3WFMWGJVl'
const H = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }
const BASE_URL = `https://api.airtable.com/v0/${OPS_BASE}/${TABLE}`

export function parseLinks(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

function shape(rec) {
  const f = rec.fields || {}
  return {
    id: rec.id,
    slug: f.Slug || '',
    displayName: f['Display Name'] || f.Slug || '',
    avatarUrl: f['Avatar URL'] || '',
    coverImageUrl: f['Cover Image URL'] || '',
    handle: f.Handle || '',
    verified: !!f.Verified,
    bio: f.Bio || '',
    customDomain: f['Custom Domain'] || '',
    published: !!f.Published,
    theme: f.Theme || 'Dark',
    links: parseLinks(f.Links).map((l, i) => ({ order: i, ...l })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    clickLog: (() => { try { return JSON.parse(f['Click Log'] || '{}') } catch { return {} } })(),
  }
}

async function fetchOne(formula) {
  const q = new URLSearchParams({ filterByFormula: formula, maxRecords: '1' })
  const res = await fetch(`${BASE_URL}?${q}`, { headers: H, cache: 'no-store' })
  if (!res.ok) return null
  const rec = (await res.json()).records?.[0]
  return rec ? shape(rec) : null
}

const esc = (s) => String(s || '').replace(/'/g, '')

export async function getLinkPageBySlug(slug) {
  return fetchOne(`LOWER({Slug})='${esc(slug).toLowerCase()}'`)
}

export async function getLinkPageByDomain(domain) {
  const d = esc(domain).toLowerCase().replace(/^www\./, '')
  return fetchOne(`LOWER({Custom Domain})='${d}'`)
}

// Resolve a gated link's real URL by slug + linkId, and best-effort tally the
// click. Returns the destination URL or null.
export async function resolveGatedLink(slug, linkId) {
  const page = await getLinkPageBySlug(slug)
  if (!page) return null
  const link = page.links.find((l) => String(l.id) === String(linkId))
  if (!link || !link.url) return null
  // Best-effort click tally (fire-and-forget; races are fine for a counter).
  try {
    const log = { ...page.clickLog, [linkId]: (page.clickLog[linkId] || 0) + 1 }
    fetch(`${BASE_URL}/${page.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: { 'Click Log': JSON.stringify(log) } }) }).catch(() => {})
  } catch { /* non-fatal */ }
  return link.url
}
