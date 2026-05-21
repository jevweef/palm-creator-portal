// HD image URL resolution for Instagram photo posts.
//
// The feed endpoint /get_ig_user_posts.php only ships ~480px candidates
// — fine for the picker thumbnails but useless for outfit reference
// inputs. /get_media_data.php?type=post returns the full GraphQL post
// node, which includes display_resources up to 1080w (4× the bytes).
//
// One call per post code yields URLs for every carousel position, so
// callers should batch by code rather than per image.

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'instagram-scraper-stable-api.p.rapidapi.com'

// Returns a Map<carouselIndex(1-based), url> with the largest available
// resource per position. Null on failure so callers can fall back to
// whatever URL they already had.
export async function fetchPostHdUrls(code) {
  if (!RAPIDAPI_KEY || !code) return null
  try {
    const r = await fetch(
      `https://${RAPIDAPI_HOST}/get_media_data.php?reel_post_code_or_url=${encodeURIComponent(code)}&type=post`,
      { headers: { 'x-rapidapi-host': RAPIDAPI_HOST, 'x-rapidapi-key': RAPIDAPI_KEY } }
    )
    if (!r.ok) return null
    const d = await r.json()
    const result = new Map()
    // Carousel posts have edge_sidecar_to_children with per-child display
    // resources. Singles have display_resources at the top level.
    const sidecar = d?.edge_sidecar_to_children?.edges
    if (Array.isArray(sidecar) && sidecar.length > 0) {
      for (let i = 0; i < sidecar.length; i++) {
        const node = sidecar[i]?.node || {}
        const best = pickBest(node.display_resources) || node.display_url || null
        if (best) result.set(i + 1, best)
      }
    } else {
      const best = pickBest(d?.display_resources) || d?.display_url || null
      if (best) result.set(1, best)
    }
    return result.size > 0 ? result : null
  } catch {
    return null
  }
}

// Pick the largest display_resource by config_width. Falls back to the
// last entry if widths aren't populated (older GraphQL shapes).
function pickBest(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return null
  const sorted = [...resources].sort((a, b) => (b.config_width || 0) - (a.config_width || 0))
  return sorted[0]?.src || resources[resources.length - 1]?.src || null
}
