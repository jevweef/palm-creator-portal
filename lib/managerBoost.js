/**
 * Manager Boost — agency-side editorial weighting on top of each creator's
 * personal DNA. Per Amin's feedback (May 2026): push more funnel-signal
 * content (talking to camera with NSFW, direct flirting, implied scenarios,
 * POV) so reels make it obvious the creator has an OF.
 *
 * Values are tag-name → bonus weight (0-1 scale). Mixed into the For You
 * formula at 15% so it nudges, doesn't dominate.
 *
 * Edit this map to retune. Eventually moves to an Airtable config + admin
 * UI so it can be tweaked without a deploy.
 */
export const MANAGER_BOOST_WEIGHTS = {
  // Funnel-signal vibe
  'Direct Flirt': 0.40,
  'Soft Tease': 0.20,

  // Viewer placed inside the fantasy
  'Implied Scenario': 0.45,
  'POV': 0.40,
  'POV / Personal Attention': 0.40,
  'Personal Attention': 0.35,
  'Roleplay': 0.30,

  // Voice-driven content with NSFW dialogue
  'Talking to Camera': 0.40,
  'Voice Behind the Camera': 0.25,
}

/**
 * Compute the manager-boost score for a single reel.
 * Returns 0-1 normalized.
 */
export function managerBoostScore(reel) {
  const tags = [...(reel.tags || []), ...(reel.filmFormat || [])]
  let score = 0
  for (const tag of tags) {
    score += MANAGER_BOOST_WEIGHTS[tag] || 0
  }
  // Normalize: cap raw score at 1.0 (a reel hitting 3 strong boosts = max).
  // Anything beyond saturates.
  return Math.min(1, score)
}
