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
 *     ('done' | 'todo' | 'na'), a human detail string, and an `action`
 *     descriptor the client knows how to dispatch.
 *   - The client page renders groups/tiles and fires actions by descriptor, so
 *     server and client never disagree about what's done.
 *
 * Reuses checklist.js for the manual Phase-3 items + go-live readiness so the
 * board and the drawer/go-live route agree.
 */

import {
  PHASE3_ITEMS,
  computePhase1,
  computeReadiness,
} from './checklist'

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
    // Non-JSON but present — treat as processed rather than crash.
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
 * The tile catalog. Each tile:
 *   key      — stable id
 *   group    — one of BOARD_GROUPS[].key
 *   label    — short title
 *   status(ctx) → 'done' | 'todo' | 'na'
 *   detail(ctx) → string | null   (small line under the label)
 *   action(ctx) → descriptor | null
 *
 * Action descriptors the client understands:
 *   { type: 'run-setup' }                          POST run-setup
 *   { type: 'check', field }                       PATCH checklist (toggle Onboarding bool)
 *   { type: 'analyze-dna' }                         POST creator-profile/analyze
 *   { type: 'process-music' }                       POST music/process-dna (needs input)
 *   { type: 'go-live' }                             POST go-live
 *   { type: 'reminder' }                            re-copy the onboarding link
 *   { type: 'set-chat-team' }                       PATCH chat-team (inline select)
 *   { type: 'link', href, label }                   navigate to an existing surface
 */
export const BOARD_TILES = [
  // ── Creator Inputs ─────────────────────────────────────────────
  {
    key: 'basic-info', group: 'inputs', label: 'Basic info',
    status: ({ phase1 }) => stepDone(phase1, 'basic-info'),
    detail: ({ cf }) => [cf['AKA'] && `AKA ${cf['AKA']}`, cf['Time Zone']].filter(Boolean).join(' · ') || null,
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'of-login', group: 'inputs', label: 'OnlyFans login',
    status: ({ cf }) => (hasText(cf['OF Email']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasText(cf['OF Email']) ? cf['OF Email'] : 'No OF email/password captured'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'survey', group: 'inputs', label: 'Survey',
    status: ({ phase1 }) => stepDone(phase1, 'survey'),
    detail: ({ phase1 }) => stepDetail(phase1, 'survey'),
    action: ({ creator }) => ({ type: 'link', href: `/api/admin/onboarding/survey-export?hqId=${creator.id}&format=csv`, label: 'Download answers', external: true }),
  },
  {
    key: 'contract', group: 'inputs', label: 'Contract signed',
    status: ({ phase1 }) => stepDone(phase1, 'contract'),
    detail: ({ phase1 }) => stepDetail(phase1, 'contract'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'voice-memo', group: 'inputs', label: 'Voice memo',
    status: ({ phase1 }) => stepDone(phase1, 'voice-memo'),
    detail: ({ phase1 }) => stepDetail(phase1, 'voice-memo'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'profile-photos', group: 'inputs', label: 'Profile photos',
    status: ({ cf }) => (hasArr(cf['Profile Photos']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasArr(cf['Profile Photos']) ? `${cf['Profile Photos'].length} uploaded` : 'None uploaded'),
    action: ({ creator }) => ({ type: 'link', href: `/admin/onboarding/${creator.id}/photos`, label: 'Upload photos' }),
  },
  {
    key: 'music-input', group: 'inputs', label: 'Music taste',
    status: ({ ops }) => (hasText(ops['Music DNA Input']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasText(ops['Music DNA Input']) ? (ops['Music DNA Type'] || 'Provided') : 'No Spotify/playlist given'),
    action: ({ creator }) => ({ type: 'link', href: `/admin/creators?creator=${creator.opsId || ''}`, label: 'Open profile' }),
  },

  // ── Provisioning ───────────────────────────────────────────────
  {
    key: 'social-accounts', group: 'provisioning', label: 'Social accounts',
    status: ({ of }) => (isTrue(of['Default Social Accounts Created']) ? 'done' : 'todo'),
    detail: () => 'TikTok · YouTube · OFTV (+ IG Main)',
    action: () => ({ type: 'run-setup' }),
  },
  {
    key: 'credentials', group: 'provisioning', label: 'Credentials records',
    status: ({ of }) => (isTrue(of['Credentials Records Created']) ? 'done' : 'todo'),
    detail: () => 'One per account',
    action: () => ({ type: 'run-setup' }),
  },
  {
    key: 'dropbox-folders', group: 'provisioning', label: 'Dropbox folders',
    status: ({ of }) => (isTrue(of['Dropbox Folder Structure Created']) ? 'done' : 'todo'),
    detail: ({ of }) => of['Dropbox Creator Root Path'] || 'Folder tree',
    action: () => ({ type: 'run-setup' }),
  },
  {
    key: 'file-requests', group: 'provisioning', label: 'File requests',
    status: ({ of }) => (isTrue(of['Social File Request Created']) && isTrue(of['Longform File Request Created']) ? 'done' : 'todo'),
    detail: ({ of }) => (of['Social File Request URL'] ? 'Social + Long Form intake' : 'Upload intake links'),
    action: ({ of }) => (of['Social File Request URL']
      ? { type: 'link', href: of['Social File Request URL'], label: 'Open intake', external: true }
      : { type: 'run-setup' }),
  },
  {
    key: 'palm-ig', group: 'provisioning', label: 'Palm IG set up',
    status: ({ smSetup }) => (smSetup?.complete ? 'done' : smSetup?.exists ? 'todo' : 'todo'),
    detail: ({ smSetup }) => (smSetup?.complete ? 'SMM completed' : smSetup?.exists ? `SM request: ${smSetup.status || 'Pending'}` : 'No SM setup request'),
    action: () => ({ type: 'link', href: '/admin/social?tab=setup-requests', label: 'SM requests' }),
  },
  {
    key: 'bios', group: 'provisioning', label: 'Bios written',
    status: ({ of }) => (isTrue(of['Bios Filled']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Bios Filled' }),
  },
  {
    key: 'profile-pics', group: 'provisioning', label: 'Profile pics set',
    status: ({ of }) => (isTrue(of['Profile Pics Set']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Profile Pics Set' }),
  },

  // ── Routing & Integration ──────────────────────────────────────
  {
    key: 'cpd', group: 'routing', label: 'Platform directory',
    status: ({ cpdCount }) => (cpdCount > 0 ? 'done' : 'todo'),
    detail: ({ cpdCount }) => (cpdCount > 0 ? `${cpdCount} account${cpdCount === 1 ? '' : 's'} in CPD` : 'No CPD accounts'),
    action: () => ({ type: 'link', href: '/admin/social', label: 'Open directory' }),
  },
  {
    key: 'telegram-bot', group: 'routing', label: 'Telegram bot added',
    status: ({ of }) => (isTrue(of['Telegram Bot Added']) ? 'done' : 'todo'),
    detail: () => '@palmmanage_bot in groups',
    action: () => ({ type: 'check', field: 'Telegram Bot Added', deepLink: 'https://t.me/palmmanage_bot?startgroup=true', deepLinkLabel: 'Add bot' }),
  },
  {
    key: 'telegram-thread', group: 'routing', label: 'Telegram thread',
    status: ({ ops }) => (hasText(String(ops['Telegram Thread ID'] ?? '')) ? 'done' : 'todo'),
    detail: ({ ops }) => (ops['Telegram Thread ID'] ? `Thread ${ops['Telegram Thread ID']}` : 'Not wired'),
    action: () => ({ type: 'link', href: '/admin/social', label: 'Social hub' }),
  },
  {
    key: 'comms-chat', group: 'routing', label: 'Comms chat',
    status: ({ ops }) => (hasArr(ops['Communication Chat']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasArr(ops['Communication Chat']) ? 'Master chat set' : 'No master chat'),
    action: () => ({ type: 'link', href: '/admin/creators?tab=communication', label: 'Assign chat' }),
  },
  {
    key: 'chat-team', group: 'routing', label: 'Chat team',
    status: ({ cf }) => (hasText(cf['Chat Team']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasText(cf['Chat Team']) ? cf['Chat Team'] : 'Unassigned'),
    action: () => ({ type: 'set-chat-team' }),
  },
  {
    key: 'revenue', group: 'routing', label: 'Revenue account',
    status: ({ revenueLinked }) => (revenueLinked ? 'done' : 'todo'),
    detail: ({ revenueLinked }) => (revenueLinked ? 'OnlyFans account linked' : 'No active revenue account'),
    action: () => ({ type: 'link', href: '/admin/earnings', label: 'Earnings' }),
  },
  {
    key: 'publer', group: 'routing', label: 'Publer / AI',
    // Only relevant for TJP/AI creators — otherwise N/A so it doesn't read as a gap.
    status: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? (publerActive ? 'done' : 'todo') : 'na'),
    detail: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? (publerActive ? 'AI account active' : 'Not wired') : 'AI not enabled'),
    action: ({ ops }) => (isTrue(ops['TJP Enabled']) ? { type: 'link', href: '/admin/social?tab=publer', label: 'Publer' } : null),
  },
  {
    key: 'dna', group: 'routing', label: 'DNA profile',
    status: ({ ops }) => (hasText(ops['Profile Summary']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasText(ops['Profile Summary']) ? 'Generated' : 'Not generated'),
    action: () => ({ type: 'analyze-dna' }),
  },
  {
    key: 'music-dna', group: 'routing', label: 'Music DNA',
    status: ({ ops }) => (musicProcessed(ops) ? 'done' : 'todo'),
    detail: ({ ops }) => (musicProcessed(ops) ? 'Processed' : hasText(ops['Music DNA Input']) ? 'Input ready — process it' : 'No input yet'),
    action: ({ creator, ops }) => ({
      type: 'link',
      href: `/admin/creators?creator=${creator.opsId || ''}`,
      label: hasText(ops['Music DNA Input']) ? 'Process input' : 'Add playlist',
    }),
  },

  // ── Go-Live (manual ops items + the gate) ──────────────────────
  ...PHASE3_ITEMS
    .filter((it) => ['Niches Confirmed', 'Content Pillars Confirmed', 'Kickoff Call Completed', 'Strategy Doc Created', 'First Week Scheduled', 'Accounts QA Complete'].includes(it.field))
    .map((it) => ({
      key: `golive-${it.field}`, group: 'golive', label: it.label.replace(/^Confirm /, '').replace(/^IG /, ''),
      status: ({ of }) => (isTrue(of[it.field]) ? 'done' : 'todo'),
      detail: () => (it.required ? null : 'optional'),
      action: () => ({ type: 'check', field: it.field }),
    })),
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
 * @returns {{ groups: Array, readiness: object, counts: {done,total} }}
 */
export function computeBoard(ctx) {
  const phase1 = ctx.phase1 || computePhase1(ctx.cf || {}, ctx.of || {})
  const fullCtx = { ...ctx, phase1 }

  const tilesByGroup = {}
  let done = 0
  let total = 0

  for (const t of BOARD_TILES) {
    const status = t.status(fullCtx)
    const tile = {
      key: t.key,
      group: t.group,
      label: t.label,
      status,
      detail: t.detail ? t.detail(fullCtx) : null,
      action: t.action ? t.action(fullCtx) : null,
    }
    if (status !== 'na') {
      total += 1
      if (status === 'done') done += 1
    }
    ;(tilesByGroup[t.group] ||= []).push(tile)
  }

  const groups = BOARD_GROUPS.map((g) => {
    const tiles = tilesByGroup[g.key] || []
    const counted = tiles.filter((t) => t.status !== 'na')
    return {
      ...g,
      tiles,
      done: counted.filter((t) => t.status === 'done').length,
      total: counted.length,
    }
  })

  return {
    groups,
    counts: { done, total },
    readiness: computeReadiness(phase1, ctx.of || {}),
  }
}
