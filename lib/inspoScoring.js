'use client'

/**
 * Single source of truth for inspo board "For You" ranking.
 *
 * Both the inspo board (`/inspo`) and the dashboard "Picked For You" strip
 * import from here so the top reels match exactly between views.
 *
 * Score formula (with thumbs):
 *   0.40·semantic + 0.25·DNA-tag + 0.10·virality + 0.15·manager + 0.10·personal
 * Score formula (no thumbs yet):
 *   0.45·semantic + 0.30·DNA-tag + 0.10·virality + 0.15·manager
 *
 * Optional per-record jitter (±15%) is sourced from sessionStorage so the
 * shuffle order stays consistent across tab navigations within a session.
 * Clear the cache via clearShuffleSeeds() to reroll.
 */

import { managerBoostScore } from '@/lib/managerBoost'

const SESSION_SEEDS_KEY = 'inspo_shuffle_seeds'

function readSeeds() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(SESSION_SEEDS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function writeSeeds(seeds) {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(SESSION_SEEDS_KEY, JSON.stringify(seeds)) } catch {}
}

export function clearShuffleSeeds() {
  writeSeeds({})
}

/** Stable ±amplitude jitter per record id, persisted in sessionStorage. */
export function jitterForRecord(id, amplitude = 0.15) {
  const seeds = readSeeds()
  if (seeds[id] === undefined) {
    seeds[id] = 1 + (Math.random() - 0.5) * amplitude * 2
    writeSeeds(seeds)
  }
  return seeds[id]
}

/**
 * Score + rank a record list for a creator. Returns a sorted copy with
 * `forYouScore` stamped on each. Mutates nothing.
 *
 * @param {object[]} records — inspiration records (from /api/inspiration)
 * @param {object} ctx
 * @param {string} ctx.creatorOpsId — the creator's Ops record id
 * @param {object} ctx.creatorTagWeights — { tag: weight }
 * @param {object} [ctx.creatorFormatWeights] — { format: weight }
 * @param {object} [ctx.tagBumps] — signed bumps from thumbs up/down
 * @param {Set<string>} [ctx.hiddenIds] — record ids to omit from the result
 * @param {boolean} [ctx.hideNiche=true] — drop Niche reels
 * @param {boolean} [ctx.applyJitter=false] — apply per-record ±15% jitter
 */
export function scoreAndRankForYou(records, ctx = {}) {
  const {
    creatorOpsId,
    creatorTagWeights = {},
    creatorFormatWeights = {},
    tagBumps = {},
    hiddenIds = null,
    hideNiche = true,
    applyJitter = false,
  } = ctx

  if (!Array.isArray(records) || records.length === 0) return []
  if (!creatorOpsId || Object.keys(creatorTagWeights).length === 0) {
    // No DNA → return engagement-sorted fallback so callers always get
    // a deterministic ranked list to slice from.
    return [...records].sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
  }

  let pool = records
  if (hiddenIds && hiddenIds.size > 0) {
    pool = pool.filter((r) => !hiddenIds.has(r.id))
  }
  if (hideNiche) {
    pool = pool.filter((r) => r.effort !== 'Niche')
  }

  const hasPersonal = Object.keys(tagBumps).length > 0
  const W_SEM = hasPersonal ? 0.40 : 0.45
  const W_DNA = hasPersonal ? 0.25 : 0.30
  const W_VIR = 0.10
  const W_MGR = 0.15
  const W_PER = hasPersonal ? 0.10 : 0

  const tagScores = pool.map((r) => {
    const t = [...(r.tags || []), ...(r.suggestedTags || [])].reduce(
      (s, x) => s + (creatorTagWeights[x] || 0), 0,
    )
    const f = (r.filmFormat || []).reduce(
      (s, x) => s + (creatorFormatWeights[x] || 0), 0,
    ) * 0.5
    return t + f
  })
  const maxTag = Math.max(...tagScores, 1)

  const managerScores = pool.map((r) => managerBoostScore(r))

  const personalRaw = pool.map((r) => {
    let s = 0
    const all = [...(r.tags || []), ...(r.suggestedTags || []), ...(r.filmFormat || [])]
    for (const t of all) s += (tagBumps[t] || 0)
    return s
  })
  const maxPersonalAbs = Math.max(...personalRaw.map(Math.abs), 1)
  const personalScores = personalRaw.map((s) => 0.5 + 0.5 * (s / maxPersonalAbs))

  const zScores = pool.map((r) => r.zScore || 0)
  const maxZ = Math.max(...zScores.map(Math.abs), 1)

  const stamped = pool.map((r, i) => {
    const semantic = (r.semanticScores && r.semanticScores[creatorOpsId]) || 0
    const tag = tagScores[i] / maxTag
    const viral = (zScores[i] + maxZ) / (2 * maxZ)
    const mgr = managerScores[i]
    const per = personalScores[i]
    const base = W_SEM * semantic + W_DNA * tag + W_VIR * viral + W_MGR * mgr + W_PER * per
    const jit = applyJitter ? jitterForRecord(r.id) : 1
    return {
      ...r,
      forYouScore: base * jit,
      forYouComponents: { semantic, tag, viral, manager: mgr, personal: hasPersonal ? per : null },
    }
  })

  stamped.sort((a, b) => b.forYouScore - a.forYouScore)
  return stamped
}
