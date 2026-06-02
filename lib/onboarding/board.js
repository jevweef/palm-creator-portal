/**
 * Onboarding readiness BOARD — the single source of truth for the full-page
 * admin onboarding workspace at /admin/onboarding/[creatorId].
 *
 * Where checklist.js drives the legacy 4-phase drawer, this module describes the
 * complete per-creator readiness board: every input we need FROM the creator and
 * every backend task WE have to do (provisioning + routing + go-live), grouped
 * into sections of status tiles.
 *
 * Design:
 *   - The API route (app/api/admin/onboarding/board/route.js) fetches the raw
 *     records from both bases and assembles a normalized `ctx` object.
 *   - computeBoard(ctx) turns that into grouped tiles, each with a status
 *     ('done' | 'todo' | 'na'), a human detail string, step-by-step
 *     `instructions`, an `action` descriptor, and dependency state (`blocked` +
 *     `blockedBy`). It also flags the single `isNext` tile — the next thing to do.
 *   - The client page renders groups/tiles, a "do this next" banner, and dims
 *     blocked tiles, so server and client never disagree.
 *
 * Tile ordering in BOARD_TILES is workflow order — the "next step" picker walks
 * the catalog top-to-bottom and returns the first actionable (todo + unblocked)
 * tile. Edit `instructions` / `dependsOn` here to retune guidance and ordering.
 *
 * Reuses checklist.js for the manual Phase-3 items + go-live readiness so the
 * board and the drawer/go-live route agree.
 */

import { computePhase1, computeReadiness } from './checklist'

// ---- helpers ----
const hasText = (v) => typeof v === 'string' && v.trim() !== ''
const hasArr = (v) => Array.isArray(v) && v.length > 0
const isTrue = (v) => v === true

function musicProcessed(ops) {
  const raw = ops['Music DNA Processed']
  if (!raw) return false
  if (typeof raw === 'object') return hasArr(raw.tracks)
  try {
    const j = JSON.parse(raw)
    return hasArr(j?.tracks)
  } catch {
    return hasText(raw)
  }
}

/**
 * Group metadata, in display order. Titles match the workspace layout.
 */
export const BOARD_GROUPS = [
  { key: 'inputs',       title: 'Creator Inputs',  subtitle: 'What we need from the creator' },
  { key: 'provisioning', title: 'Provisioning',    subtitle: 'Accounts, storage & file intake we build' },
  { key: 'routing',      title: 'Routing & Integration', subtitle: 'Wiring the new accounts into our systems' },
  { key: 'golive',       title: 'Go-Live',         subtitle: 'Final operational readiness' },
]

/**
 * The tile catalog, in workflow order. Each tile:
 *   key          — stable id (also used as a dependency target)
 *   group        — one of BOARD_GROUPS[].key
 *   label        — short title
 *   instructions — one-line "what to do / how" guidance (always shown)
 *   dependsOn    — array of tile keys that must be 'done' (or 'na') first
 *   status(ctx)  → 'done' | 'todo' | 'na'
 *   detail(ctx)  → string | null   (small data line under the label)
 *   action(ctx)  → descriptor | null
 *
 * Action descriptors the client understands:
 *   { type: 'run-setup' }            POST run-setup
 *   { type: 'check', field }         PATCH checklist (toggle Onboarding bool)
 *   { type: 'analyze-dna' }          POST creator-profile/analyze
 *   { type: 'go-live' }              POST go-live
 *   { type: 'reminder' }             re-copy the onboarding link
 *   { type: 'set-chat-team' }        PATCH chat-team (inline select)
 *   { type: 'link', href, label }    navigate to an existing surface
 */
export const BOARD_TILES = [
  // ── Creator Inputs ─────────────────────────────────────────────
  {
    key: 'basic-info', group: 'inputs', label: 'Basic info', dependsOn: [],
    instructions: 'Captured when the creator completes step 1 of the wizard. If it’s blank, copy the onboarding link and send it to them.',
    status: ({ phase1 }) => stepDone(phase1, 'basic-info'),
    detail: ({ cf }) => [cf['AKA'] && `AKA ${cf['AKA']}`, cf['Time Zone']].filter(Boolean).join(' · ') || null,
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'of-login', group: 'inputs', label: 'OnlyFans login', dependsOn: [],
    instructions: 'The creator enters their OF email + password in the wizard. We can’t manage or pull earnings without it — remind them if blank.',
    status: ({ cf }) => (hasText(cf['OF Email']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasText(cf['OF Email']) ? cf['OF Email'] : 'No OF email/password captured'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'survey', group: 'inputs', label: 'Survey', dependsOn: [],
    instructions: 'The creator fills out the onboarding questionnaire. Required before go-live, and it feeds the DNA profile.',
    status: ({ phase1 }) => stepDone(phase1, 'survey'),
    detail: ({ phase1 }) => stepDetail(phase1, 'survey'),
    action: ({ creator }) => ({ type: 'link', href: `/api/admin/onboarding/survey-export?hqId=${creator.id}&format=csv`, label: 'Download answers', external: true }),
  },
  {
    key: 'contract', group: 'inputs', label: 'Contract signed', dependsOn: [],
    instructions: 'The creator e-signs the management agreement in the wizard. Required before go-live.',
    status: ({ phase1 }) => stepDone(phase1, 'contract'),
    detail: ({ phase1 }) => stepDetail(phase1, 'contract'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'voice-memo', group: 'inputs', label: 'Voice memo', dependsOn: [],
    instructions: 'The creator records a short voice ramble in the wizard. Feeds the DNA profile — nudge them if it’s missing.',
    status: ({ phase1 }) => stepDone(phase1, 'voice-memo'),
    detail: ({ phase1 }) => stepDetail(phase1, 'voice-memo'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'profile-photos', group: 'inputs', label: 'Profile photos', dependsOn: [],
    instructions: 'Upload the creator’s headshots / reference photos here. Used for the IG profile pics and SM setup.',
    status: ({ cf }) => (hasArr(cf['Profile Photos']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasArr(cf['Profile Photos']) ? `${cf['Profile Photos'].length} uploaded` : 'None uploaded'),
    action: ({ creator }) => ({ type: 'link', href: `/admin/onboarding/${creator.id}/photos`, label: 'Upload photos' }),
  },
  {
    key: 'music-input', group: 'inputs', label: 'Music taste', dependsOn: [],
    instructions: 'Get the creator’s Spotify or playlist link onto their profile. Needed before Music DNA can be processed.',
    status: ({ ops }) => (hasText(ops['Music DNA Input']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasText(ops['Music DNA Input']) ? (ops['Music DNA Type'] || 'Provided') : 'No Spotify/playlist given'),
    action: ({ creator }) => ({ type: 'link', href: `/admin/creators?creator=${creator.opsId || ''}`, label: 'Open profile' }),
  },

  // ── Provisioning ───────────────────────────────────────────────
  {
    key: 'social-accounts', group: 'provisioning', label: 'Social accounts', dependsOn: ['basic-info'],
    instructions: 'Click Run Setup to create the standard accounts (TikTok, YouTube, OFTV, + IG Main if a handle was given). One click does all of provisioning.',
    status: ({ of }) => (isTrue(of['Default Social Accounts Created']) ? 'done' : 'todo'),
    detail: () => 'TikTok · YouTube · OFTV (+ IG Main)',
    action: () => ({ type: 'run-setup' }),
  },
  {
    key: 'credentials', group: 'provisioning', label: 'Credentials records', dependsOn: ['social-accounts'],
    instructions: 'Created automatically by Run Setup — one credentials record per account. No manual step.',
    status: ({ of }) => (isTrue(of['Credentials Records Created']) ? 'done' : 'todo'),
    detail: () => 'One per account',
    action: () => ({ type: 'run-setup' }),
  },
  {
    key: 'dropbox-folders', group: 'provisioning', label: 'Dropbox folders', dependsOn: ['basic-info'],
    instructions: 'Run Setup builds the creator’s Dropbox folder tree under /Palm Ops/Creators/{AKA}/.',
    status: ({ of }) => (isTrue(of['Dropbox Folder Structure Created']) ? 'done' : 'todo'),
    detail: ({ of }) => of['Dropbox Creator Root Path'] || 'Folder tree',
    action: () => ({ type: 'run-setup' }),
  },
  {
    key: 'file-requests', group: 'provisioning', label: 'File requests', dependsOn: ['dropbox-folders'],
    instructions: 'Run Setup creates the Social + Long Form upload links. Send these to the creator so they can drop in content.',
    status: ({ of }) => (isTrue(of['Social File Request Created']) && isTrue(of['Longform File Request Created']) ? 'done' : 'todo'),
    detail: ({ of }) => (of['Social File Request URL'] ? 'Social + Long Form intake' : 'Upload intake links'),
    action: ({ of }) => (of['Social File Request URL']
      ? { type: 'link', href: of['Social File Request URL'], label: 'Open intake', external: true }
      : { type: 'run-setup' }),
  },
  {
    key: 'palm-ig', group: 'provisioning', label: 'Palm IG set up', dependsOn: ['social-accounts'],
    instructions: 'Run Setup files an SM request; an SMM then creates the 3 Palm IG accounts and marks it complete. Track it in SM requests.',
    status: ({ smSetup }) => (smSetup?.complete ? 'done' : 'todo'),
    detail: ({ smSetup }) => (smSetup?.complete ? 'SMM completed' : smSetup?.exists ? `SM request: ${smSetup.status || 'Pending'}` : 'No SM setup request'),
    action: () => ({ type: 'link', href: '/admin/social?tab=setup-requests', label: 'SM requests' }),
  },
  {
    key: 'bios', group: 'provisioning', label: 'Bios written', dependsOn: ['palm-ig'],
    instructions: 'Once the SMM has created the IG accounts, write each account’s bio, then check this off.',
    status: ({ of }) => (isTrue(of['Bios Filled']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Bios Filled' }),
  },
  {
    key: 'profile-pics', group: 'provisioning', label: 'Profile pics set', dependsOn: ['palm-ig', 'profile-photos'],
    instructions: 'Set each IG account’s profile picture using the uploaded photos, then check this off.',
    status: ({ of }) => (isTrue(of['Profile Pics Set']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Profile Pics Set' }),
  },

  // ── Routing & Integration ──────────────────────────────────────
  {
    key: 'cpd', group: 'routing', label: 'Platform directory', dependsOn: ['palm-ig'],
    instructions: 'Verify the new accounts show up in the Creator Platform Directory with their handles filled in.',
    status: ({ cpdCount }) => (cpdCount > 0 ? 'done' : 'todo'),
    detail: ({ cpdCount }) => (cpdCount > 0 ? `${cpdCount} account${cpdCount === 1 ? '' : 's'} in CPD` : 'No CPD accounts'),
    action: () => ({ type: 'link', href: '/admin/social', label: 'Open directory' }),
  },
  {
    key: 'telegram-bot', group: 'routing', label: 'Telegram bot added', dependsOn: [],
    instructions: 'Add @palmmanage_bot to the creator’s Telegram group(s) using the link, then check this off. Required for message ingestion.',
    status: ({ of }) => (isTrue(of['Telegram Bot Added']) ? 'done' : 'todo'),
    detail: () => '@palmmanage_bot in groups',
    action: () => ({ type: 'check', field: 'Telegram Bot Added', deepLink: 'https://t.me/palmmanage_bot?startgroup=true', deepLinkLabel: 'Add bot' }),
  },
  {
    key: 'telegram-thread', group: 'routing', label: 'Telegram thread', dependsOn: ['telegram-bot'],
    instructions: 'Once the bot is in the group and the first message lands, the thread auto-wires. Check the Social hub if it hasn’t.',
    status: ({ ops }) => (hasText(String(ops['Telegram Thread ID'] ?? '')) ? 'done' : 'todo'),
    detail: ({ ops }) => (ops['Telegram Thread ID'] ? `Thread ${ops['Telegram Thread ID']}` : 'Not wired'),
    action: () => ({ type: 'link', href: '/admin/social', label: 'Social hub' }),
  },
  {
    key: 'comms-chat', group: 'routing', label: 'Comms chat', dependsOn: ['telegram-thread'],
    instructions: 'Pick the creator’s master communication chat so portal automations (OFTV deliveries, etc.) route to the right place.',
    status: ({ ops }) => (hasArr(ops['Communication Chat']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasArr(ops['Communication Chat']) ? 'Master chat set' : 'No master chat'),
    action: () => ({ type: 'link', href: '/admin/creators?tab=communication', label: 'Assign chat' }),
  },
  {
    key: 'chat-team', group: 'routing', label: 'Chat team', dependsOn: [],
    instructions: 'Assign the creator to the A or B chat team using the dropdown.',
    status: ({ cf }) => (hasText(cf['Chat Team']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasText(cf['Chat Team']) ? cf['Chat Team'] : 'Unassigned'),
    action: () => ({ type: 'set-chat-team' }),
  },
  {
    key: 'revenue', group: 'routing', label: 'Revenue account', dependsOn: ['of-login'],
    instructions: 'Create/link the active OnlyFans revenue account so earnings and runway populate for this creator.',
    status: ({ revenueLinked }) => (revenueLinked ? 'done' : 'todo'),
    detail: ({ revenueLinked }) => (revenueLinked ? 'OnlyFans account linked' : 'No active revenue account'),
    action: () => ({ type: 'link', href: '/admin/earnings', label: 'Earnings' }),
  },
  {
    key: 'publer', group: 'routing', label: 'Publer / AI', dependsOn: ['palm-ig'],
    // Only relevant for TJP/AI creators — otherwise N/A so it doesn't read as a gap.
    instructions: 'For AI creators only: connect the creator’s Publer account so AI content can be scheduled. Skipped if AI isn’t enabled.',
    status: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? (publerActive ? 'done' : 'todo') : 'na'),
    detail: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? (publerActive ? 'AI account active' : 'Not wired') : 'AI not enabled'),
    action: ({ ops }) => (isTrue(ops['TJP Enabled']) ? { type: 'link', href: '/admin/social?tab=publer', label: 'Publer' } : null),
  },
  {
    key: 'dna', group: 'routing', label: 'DNA profile', dependsOn: ['survey', 'voice-memo'],
    instructions: 'Once the survey and voice memo are in, run the profile builder to generate the creator’s DNA profile.',
    status: ({ ops }) => (hasText(ops['Profile Summary']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasText(ops['Profile Summary']) ? 'Generated' : 'Not generated'),
    action: () => ({ type: 'analyze-dna' }),
  },
  {
    key: 'music-dna', group: 'routing', label: 'Music DNA', dependsOn: ['music-input'],
    instructions: 'Process the creator’s playlist into Music DNA from their profile (powers music suggestions in the editor).',
    status: ({ ops }) => (musicProcessed(ops) ? 'done' : 'todo'),
    detail: ({ ops }) => (musicProcessed(ops) ? 'Processed' : hasText(ops['Music DNA Input']) ? 'Input ready — process it' : 'No input yet'),
    action: ({ creator, ops }) => ({
      type: 'link',
      href: `/admin/creators?creator=${creator.opsId || ''}`,
      label: hasText(ops['Music DNA Input']) ? 'Process input' : 'Add playlist',
    }),
  },

  // ── Go-Live (manual ops items + the gate) ──────────────────────
  {
    key: 'golive-niches', group: 'golive', label: 'Niches confirmed', dependsOn: ['survey'],
    instructions: 'Validate the creator’s content niches against their survey answer, then check this off. Required for go-live.',
    status: ({ of }) => (isTrue(of['Niches Confirmed']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Niches Confirmed' }),
  },
  {
    key: 'golive-pillars', group: 'golive', label: 'Content pillars', dependsOn: ['survey'],
    instructions: 'Confirm the creator’s content pillars (optional — doesn’t block go-live).',
    status: ({ of }) => (isTrue(of['Content Pillars Confirmed']) ? 'done' : 'todo'),
    detail: () => 'optional',
    action: () => ({ type: 'check', field: 'Content Pillars Confirmed' }),
  },
  {
    key: 'golive-kickoff', group: 'golive', label: 'Kickoff call', dependsOn: [],
    instructions: 'Hold the kickoff call with the creator and check this off (log the date in the drawer if needed). Required for go-live.',
    status: ({ of }) => (isTrue(of['Kickoff Call Completed']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Kickoff Call Completed' }),
  },
  {
    key: 'golive-strategy', group: 'golive', label: 'Strategy doc', dependsOn: ['golive-kickoff'],
    instructions: 'After the kickoff, draft the strategy doc (posting cadence, content plan) and mark it done. Required for go-live.',
    status: ({ of }) => (isTrue(of['Strategy Doc Created']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Strategy Doc Created' }),
  },
  {
    key: 'golive-firstweek', group: 'golive', label: 'First week scheduled', dependsOn: ['golive-strategy', 'social-accounts'],
    instructions: 'Schedule the creator’s first week of content, then check this off. Required for go-live.',
    status: ({ of }) => (isTrue(of['First Week Scheduled']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'First Week Scheduled' }),
  },
  {
    key: 'golive-qa', group: 'golive', label: 'Accounts QA', dependsOn: ['bios', 'profile-pics'],
    instructions: 'Final pass: verify every account is set up correctly (bios, pics, links), then check this off. Required for go-live.',
    status: ({ of }) => (isTrue(of['Accounts QA Complete']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Accounts QA Complete' }),
  },
]

function stepDone(phase1 = [], key) {
  const s = phase1.find((p) => p.key === key)
  return s?.done ? 'done' : 'todo'
}
function stepDetail(phase1 = [], key) {
  const s = phase1.find((p) => p.key === key)
  return s?.detail || null
}

/**
 * Build the grouped board from a normalized context.
 * @returns {{ groups, readiness, counts, nextKey }}
 */
export function computeBoard(ctx) {
  const phase1 = ctx.phase1 || computePhase1(ctx.cf || {}, ctx.of || {})
  const fullCtx = { ...ctx, phase1 }

  // First pass — status + content for every tile.
  const tiles = BOARD_TILES.map((t) => ({
    key: t.key,
    group: t.group,
    label: t.label,
    instructions: t.instructions || null,
    dependsOn: t.dependsOn || [],
    status: t.status(fullCtx),
    detail: t.detail ? t.detail(fullCtx) : null,
    action: t.action ? t.action(fullCtx) : null,
  }))

  const statusByKey = {}
  const labelByKey = {}
  for (const t of tiles) { statusByKey[t.key] = t.status; labelByKey[t.key] = t.label }

  // A dependency is "satisfied" when it's done OR not-applicable. Only an
  // outstanding ('todo') prerequisite blocks a tile.
  const depSatisfied = (key) => statusByKey[key] === 'done' || statusByKey[key] === 'na'

  let done = 0
  let total = 0
  let nextKey = null

  for (const t of tiles) {
    const unmet = t.dependsOn.filter((d) => !depSatisfied(d))
    t.blocked = t.status === 'todo' && unmet.length > 0
    t.blockedBy = unmet.map((d) => labelByKey[d] || d)

    if (t.status !== 'na') {
      total += 1
      if (t.status === 'done') done += 1
    }
    // Next step = first actionable tile in workflow order.
    if (!nextKey && t.status === 'todo' && !t.blocked) {
      nextKey = t.key
      t.isNext = true
    }
  }

  const groups = BOARD_GROUPS.map((g) => {
    const groupTiles = tiles.filter((t) => t.group === g.key)
    const counted = groupTiles.filter((t) => t.status !== 'na')
    return {
      ...g,
      tiles: groupTiles,
      done: counted.filter((t) => t.status === 'done').length,
      total: counted.length,
    }
  })

  return {
    groups,
    counts: { done, total },
    nextKey,
    readiness: computeReadiness(phase1, ctx.of || {}),
  }
}
