/**
 * Onboarding readiness BOARD — the single source of truth for the full-page
 * admin onboarding workspace at /admin/onboarding/[creatorId].
 *
 * Where checklist.js drives the legacy 4-phase drawer, this module describes the
 * complete per-creator readiness board: every input we need FROM the creator and
 * every backend task WE have to do, grouped into sections of status tiles.
 *
 * DESIGN RULES (2026-07-17 rework, per Evan):
 *   - The workspace is the ONE place setup happens. Cards act INLINE wherever
 *     possible (create records, connect APIs, save numbers, upload files, pick
 *     chats) — deep-links only where the work truly lives elsewhere (SMM queue).
 *   - Groups follow the creator journey and a dependency NEVER renders after
 *     its dependents: Inputs → Decisions → OnlyFans → Provisioning → Social →
 *     Profile & Comms → Go-Live.
 *   - Whatever provisions itself (webhooks, crons, topic auto-create) gets a
 *     status-only card or none at all.
 *
 * Mechanics:
 *   - The API route (app/api/admin/onboarding/board/route.js) fetches the raw
 *     records from both bases and assembles a normalized `ctx` object.
 *   - computeBoard(ctx) turns that into grouped tiles, each with a status
 *     ('done' | 'todo' | 'na'), a human detail string, `instructions`, an
 *     `action` descriptor, and dependency state (`blocked` + `blockedBy`).
 *     It also flags the single `isNext` tile — the next thing to do.
 *   - Tile ordering in BOARD_TILES is workflow order — the "next step" picker
 *     walks the catalog top-to-bottom.
 *
 * Reuses checklist.js for the manual Phase-3 items + go-live readiness so the
 * board and the drawer/go-live route agree.
 */

import { computePhase1, computeReadiness } from './checklist'
import { SURVEY_QUESTIONS } from './surveyQuestions'

// Two distinct facts about a survey:
//  • SUBMITTED = the creator hit Submit (gave it to us) — the `Survey Completed`
//    flag. This is what "submitted" means.
//  • COMPLETENESS = how many of the questions they answered (SURVEY_TOTAL) — so
//    we can chase whatever they skipped, independent of whether they submitted.
// The card goes green on submit OR a near-full answer set (self-heal for a
// dropped submit ping), but the detail always distinguishes the two.
const SURVEY_TOTAL = SURVEY_QUESTIONS.length
const SURVEY_MIN_FOR_DONE = Math.max(1, SURVEY_TOTAL - 5)

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
 * Group metadata, in display order (= dependency order — nothing in a later
 * group is a prerequisite of an earlier one).
 */
export const BOARD_GROUPS = [
  { key: 'inputs',       title: 'Creator Inputs',      subtitle: 'What we need from the creator' },
  { key: 'decisions',    title: 'Decisions',           subtitle: 'Calls that unlock everything else' },
  { key: 'onlyfans',     title: 'OnlyFans & Earnings', subtitle: 'Wire up her money engine — per account' },
  { key: 'provisioning', title: 'Provisioning',        subtitle: 'One click builds accounts, storage & intake' },
  { key: 'social',       title: 'Social Media',        subtitle: 'Only when Palm runs her socials' },
  { key: 'profile',      title: 'Profile & Comms',     subtitle: 'DNA, music & message routing' },
  { key: 'golive',       title: 'Go-Live',             subtitle: 'Final operational readiness' },
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
 *   { type: 'of-login' | 'survey-send' | 'toggle-social' | 'contract-amend' |
 *     'telegram-assign' | 'revenue-accounts' | 'of-api' | 'tg-topics' |
 *     'inline-number' | 'doc-upload' | 'photo-upload' | 'comms-chat' |
 *     'music-dna' | 'publer-sync' }  inline card components (page.js)
 */
export const BOARD_TILES = [
  // ── Creator Inputs ─────────────────────────────────────────────
  {
    key: 'portal-account', group: 'inputs', label: 'Portal account', dependsOn: [],
    instructions: 'The creator opens the onboarding link and starts the wizard. If this stays blank a day or two after you sent the link, nudge them — nothing else can begin until they sign in.',
    status: ({ cf }) => (hasText(String(cf['Onboarding Started At'] ?? '')) ? 'done' : 'todo'),
    detail: ({ cf }) => (cf['Onboarding Started At'] ? `Started ${String(cf['Onboarding Started At']).slice(0, 10)}` : 'Link not opened yet'),
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'basic-info', group: 'inputs', label: 'Basic info', dependsOn: [],
    instructions: 'Captured when the creator completes step 1 of the wizard. If it’s blank, copy the onboarding link and send it to them.',
    status: ({ phase1 }) => stepDone(phase1, 'basic-info'),
    detail: ({ cf }) => [cf['AKA'] && `AKA ${cf['AKA']}`, cf['Time Zone']].filter(Boolean).join(' · ') || null,
    action: () => ({ type: 'reminder' }),
  },
  {
    key: 'of-login', group: 'inputs', label: 'OnlyFans login', dependsOn: [],
    instructions: 'Review the free + paid/VIP login (email & password). Edit if needed, then Approve when it’s correct and covers the page(s) we manage.',
    // Field map (HQ Creators / cf): Free = OF Email / OF Password ; Paid/VIP = 2nd OF Email / 2nd OF Password.
    // Done = admin clicked Approve ('OF Login Confirmed' on HQ Onboarding). The card itself
    // (rendered by the page's OfLoginAction) shows 4 editable inputs + Edit/Save + Approve.
    status: ({ of }) => (isTrue(of['OF Login Confirmed']) ? 'done' : 'todo'),
    detail: ({ cf }) => {
      const paid = hasText(cf['2nd OF Email']); const free = hasText(cf['OF Email'])
      const parts = []
      if (paid) parts.push('Paid: ' + cf['2nd OF Email'])
      if (free) parts.push('Free: ' + cf['OF Email'])
      return parts.length ? parts.join('   ·   ') : 'No OF login submitted yet'
    },
    action: ({ cf, of }) => ({
      type: 'of-login',
      freeEmail: cf['OF Email'] || '',
      freePass: cf['OF Password'] || '',
      paidEmail: cf['2nd OF Email'] || '',
      paidPass: cf['2nd OF Password'] || '',
      confirmed: isTrue(of['OF Login Confirmed']),
    }),
  },
  {
    // One Survey card: submission status (self-healing) + View answers + Send to
    // the chat team. Replaces the old split "Survey" / "Survey → chat team" pair.
    key: 'survey', group: 'inputs', label: 'Survey', dependsOn: [],
    instructions: '“Submitted” = the creator hit Submit (gave it to us). The answered count shows completeness so you can chase anything they skipped — the two are separate. View the answers, then Send to the chat team.',
    status: ({ phase1, surveyAnswerCount = 0 }) =>
      (stepDone(phase1, 'survey') === 'done' || surveyAnswerCount >= SURVEY_MIN_FOR_DONE) ? 'done' : 'todo',
    detail: ({ phase1, surveyAnswerCount = 0, of }) => {
      if (!surveyAnswerCount) return 'Not started'
      const clickedSubmit = stepDone(phase1, 'survey') === 'done' // they hit Submit
      const unanswered = Math.max(0, SURVEY_TOTAL - surveyAnswerCount)
      const state = clickedSubmit
        ? 'submitted'
        : (surveyAnswerCount >= SURVEY_MIN_FOR_DONE ? 'answered, not submitted' : 'in progress')
      const gaps = unanswered > 0 ? ` · ${unanswered} unanswered` : ''
      const sent = isTrue(of['Survey Sent to Chat Team']) ? ' · sent to team' : ''
      return `${surveyAnswerCount} answers · ${state}${gaps}${sent}`
    },
    action: ({ of }) => ({ type: 'survey-send', sentToTeam: isTrue(of['Survey Sent to Chat Team']) }),
  },
  {
    key: 'contract', group: 'inputs', label: 'Contract signed', dependsOn: [],
    instructions: 'The creator e-signs the management agreement in the wizard. If she asks for changes, paste her message under "Request changes" — AI drafts the amendments, you accept/reject each, and her contract regenerates with them. Required before go-live.',
    status: ({ phase1 }) => stepDone(phase1, 'contract'),
    detail: ({ phase1, cf }) => {
      const base = stepDetail(phase1, 'contract')
      const edited = hasText(cf['Contract Body Override'])
      let n = 0
      try { n = cf['Contract Amendments'] ? JSON.parse(cf['Contract Amendments']).length : 0 } catch { /* ignore */ }
      const parts = [base, edited ? 'hand-edited' : (n ? `${n} amendment${n === 1 ? '' : 's'}` : null)].filter(Boolean)
      return parts.join(' · ') || null
    },
    action: ({ cf }) => {
      let n = 0
      try { n = cf['Contract Amendments'] ? JSON.parse(cf['Contract Amendments']).length : 0 } catch { /* ignore */ }
      return { type: 'contract-amend', count: n, hasOverride: hasText(cf['Contract Body Override']) }
    },
  },
  {
    key: 'voice-memo', group: 'inputs', label: 'Voice memo / docs', dependsOn: [],
    instructions: 'Creator records this in the wizard — or drop her voice memo / docs right here (audio counts as the voice memo). Then run Analyze on the DNA profile card.',
    status: ({ phase1, profileDocs }) => ((stepDone(phase1, 'voice-memo') === 'done' || profileDocs?.hasAudio) ? 'done' : 'todo'),
    detail: ({ phase1, profileDocs }) => {
      if (stepDone(phase1, 'voice-memo') === 'done') return stepDetail(phase1, 'voice-memo') || 'Received'
      if (profileDocs?.hasAudio) return 'Audio uploaded'
      return profileDocs?.count ? `${profileDocs.count} doc${profileDocs.count === 1 ? '' : 's'} (no audio yet)` : 'Not received'
    },
    action: ({ cf }) => ({ type: 'doc-upload', creatorName: cf['Creator'] || cf['AKA'] || '' }),
  },
  {
    key: 'profile-photos', group: 'inputs', label: 'Profile photos', dependsOn: [],
    instructions: 'Drop the creator’s headshots / reference photos here — they go to her Dropbox + profile and feed the IG profile pics and SM setup.',
    status: ({ cf }) => (hasArr(cf['Profile Photos']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasArr(cf['Profile Photos']) ? `${cf['Profile Photos'].length} uploaded` : 'None uploaded'),
    action: ({ creator }) => ({ type: 'photo-upload', href: `/admin/onboarding/${creator.id}/photos` }),
  },

  // ── Decisions (admin calls that unlock everything else) ────────
  {
    key: 'chat-team', group: 'decisions', label: 'Chat team (A / B)', dependsOn: [],
    instructions: 'Decide whether this creator is A-team or B-team and assign them — it sets which chatters staff them, which survey handoff they get, and where whale alerts route. Use the dropdown.',
    status: ({ cf }) => (hasText(cf['Chat Team']) ? 'done' : 'todo'),
    detail: ({ cf }) => (hasText(cf['Chat Team']) ? cf['Chat Team'] : 'Unassigned — A or B?'),
    action: () => ({ type: 'set-chat-team' }),
  },
  {
    key: 'social-media', group: 'decisions', label: 'Social media managed?', dependsOn: [],
    instructions: 'Does Palm run this creator’s social media? Toggle it right here — Yes reveals the whole Social Media section AND auto-creates her Telegram delivery topics. (Same flag as the dashboard “Editor” toggle.)',
    status: ({ ops }) => (isTrue(ops['Social Media Editing']) ? 'done' : 'todo'),
    detail: ({ ops }) => (isTrue(ops['Social Media Editing']) ? 'Yes — Palm runs socials' : 'No / not set'),
    action: () => ({ type: 'toggle-social' }),
  },
  {
    key: 'commission', group: 'decisions', label: 'Commission', dependsOn: [],
    instructions: 'Set the creator’s commission % right here — invoicing snapshots it onto every invoice, so set it before the first one generates.',
    status: ({ cf }) => (Number(cf['Commission %']) > 0 ? 'done' : 'todo'),
    detail: ({ cf }) => (Number(cf['Commission %']) > 0 ? `${Math.round(Number(cf['Commission %']) * 100)}%` : 'Not set'),
    action: ({ cf }) => ({ type: 'inline-number', target: 'hq', field: 'Commission %', mode: 'percent', value: Number(cf['Commission %']) || 0 }),
  },
  {
    key: 'ai-consent', group: 'decisions', label: 'AI content consent', dependsOn: [],
    instructions: 'Confirm the creator has consented to AI-generated content of their likeness, then check this. Required before any AI / Publer setup.',
    status: ({ of }) => (isTrue(of['AI Content Consent']) ? 'done' : 'todo'),
    detail: ({ of }) => (isTrue(of['AI Content Consent']) ? 'On record' : 'Not confirmed'),
    action: () => ({ type: 'check', field: 'AI Content Consent' }),
  },

  // ── OnlyFans & Earnings (per ACCOUNT) ──────────────────────────
  {
    key: 'revenue', group: 'onlyfans', label: 'Revenue accounts', dependsOn: ['of-login'],
    instructions: 'One record per OF page (Free / VIP) — earnings, invoicing and the whale audit all find her by these. Create any missing one with one click; the name is derived from her AKA automatically.',
    status: ({ revenueAccounts = [], expectedOfAccounts = [] }) => {
      const active = revenueAccounts.filter((a) => a.status === 'Active')
      if (!expectedOfAccounts.length) return active.length ? 'done' : 'todo'
      const have = (t) => active.some((a) => a.name.toLowerCase().endsWith(`- ${t.toLowerCase()}`))
      return expectedOfAccounts.every(have) ? 'done' : 'todo'
    },
    detail: ({ revenueAccounts = [], expectedOfAccounts = [] }) => {
      if (!revenueAccounts.length) return expectedOfAccounts.length ? `Missing: ${expectedOfAccounts.join(', ')}` : 'No accounts yet'
      return revenueAccounts.map((a) => `${a.name.split(' - ').slice(1).join(' - ')} ${a.status === 'Active' ? '✓' : `(${a.status})`}`).join(' · ')
    },
    action: ({ revenueAccounts = [], expectedOfAccounts = [] }) => ({ type: 'revenue-accounts', accounts: revenueAccounts, expected: expectedOfAccounts }),
  },
  {
    // Per-ACCOUNT call: connect this OF page to onlyfansapi.com, or record a
    // deliberate Skip. "Undecided" is the only bad state — the tile stays todo
    // until every active account has an answer, so nothing is silently forgotten.
    key: 'of-api', group: 'onlyfans', label: 'OF API — connect accounts?', dependsOn: ['revenue'],
    instructions: 'For EACH OF page: connect it at app.onlyfansapi.com and paste the acct_… ID here, or hit Skip if it isn’t worth the credits. Connecting unlocks earnings pulls, the whale audit, live chat and webhooks — pulls, nightly true-up, sheet tabs and Fan Tracker all wire themselves after this.',
    status: ({ revenueAccounts = [] }) => {
      const active = revenueAccounts.filter((a) => a.status === 'Active')
      if (!active.length) return 'todo'
      return active.every((a) => a.connect === 'Skip' || (a.connect === 'Connect' && a.acctId)) ? 'done' : 'todo'
    },
    detail: ({ revenueAccounts = [] }) => {
      const active = revenueAccounts.filter((a) => a.status === 'Active')
      if (!active.length) return 'Create her revenue accounts first'
      const n = { connected: 0, skipped: 0, undecided: 0 }
      for (const a of active) {
        if (a.connect === 'Connect' && a.acctId) n.connected += 1
        else if (a.connect === 'Skip') n.skipped += 1
        else n.undecided += 1
      }
      return [n.connected && `${n.connected} connected`, n.skipped && `${n.skipped} skipped`, n.undecided && `${n.undecided} undecided`].filter(Boolean).join(' · ')
    },
    action: ({ revenueAccounts = [] }) => ({ type: 'of-api', accounts: revenueAccounts.filter((a) => a.status === 'Active') }),
  },

  {
    // Standing VAULT intake per account — the content-request page's sections
    // are OF vault material (PPVs, sexting sets…), and a Free + VIP creator
    // needs one intake per ACCOUNT. Auto-created with each Revenue Account;
    // this card is the backup + the red flag.
    key: 'vault-intake', group: 'onlyfans', label: 'Vault content intake', dependsOn: ['revenue'],
    instructions: 'Every OF account gets a standing Content Request where the creator uploads her VAULT content (PPVs, sexting sets, feed material). Created automatically with the revenue account — this button fills any gap. She uploads at Content Request on her portal.',
    status: ({ revenueAccounts = [], vaultRequests = [] }) => {
      const active = revenueAccounts.filter((a) => a.status === 'Active')
      if (!active.length) return 'todo'
      const has = (name) => vaultRequests.some((r) => (r.account || '').toLowerCase() === name.toLowerCase())
        || (active.length === 1 && vaultRequests.some((r) => !r.account)) // legacy single-request creators
      return active.every((a) => has(a.name)) ? 'done' : 'todo'
    },
    detail: ({ revenueAccounts = [], vaultRequests = [] }) => {
      const active = revenueAccounts.filter((a) => a.status === 'Active')
      if (!active.length) return 'Create her revenue accounts first'
      return active.map((a) => {
        const short = a.name.split(' - ').slice(1).join(' - ')
        const has = vaultRequests.some((r) => (r.account || '').toLowerCase() === a.name.toLowerCase())
          || (active.length === 1 && vaultRequests.some((r) => !r.account))
        return `${short} ${has ? '✓' : '—'}`
      }).join(' · ')
    },
    action: () => ({ type: 'vault-requests' }),
  },

  // ── Provisioning (one click, applies to every creator) ─────────
  {
    // Merged card (was 4: social accounts / credentials / Dropbox / file
    // requests) — they're all ONE Run Setup click, so they're ONE card.
    key: 'social-accounts', group: 'provisioning', label: 'Run Setup', dependsOn: ['basic-info'],
    instructions: 'One click builds it all: TikTok/YouTube/OFTV account records (+ IG Main if she gave a handle), credentials records, her Dropbox folder tree, and both content-intake upload links. Safe to re-run — it only fills gaps.',
    status: ({ of }) => (
      isTrue(of['Default Social Accounts Created']) && isTrue(of['Credentials Records Created']) &&
      isTrue(of['Dropbox Folder Structure Created']) && isTrue(of['Social File Request Created']) &&
      isTrue(of['Longform File Request Created']) ? 'done' : 'todo'
    ),
    detail: ({ of }) => {
      const m = (v) => (isTrue(v) ? '✓' : '—')
      return [
        `Accounts ${m(of['Default Social Accounts Created'])}`,
        `Credentials ${m(of['Credentials Records Created'])}`,
        `Dropbox ${m(of['Dropbox Folder Structure Created'])}`,
        `Intake links ${isTrue(of['Social File Request Created']) && isTrue(of['Longform File Request Created']) ? '✓' : '—'}`,
      ].join(' · ')
    },
    action: ({ of }) => (of['Social File Request URL']
      ? { type: 'run-setup', intakeUrl: of['Social File Request URL'] }
      : { type: 'run-setup' }),
  },

  // ── Social Media (hidden unless Palm runs her socials) ─────────
  {
    key: 'palm-ig', group: 'social', label: 'Palm IG set up', dependsOn: ['social-accounts'],
    instructions: 'Run Setup files an SM request; an SMM then creates the 3 Palm IG accounts and marks it complete. This is the SMM’s queue — track it there.',
    status: ({ smSetup }) => (smSetup?.complete ? 'done' : 'todo'),
    detail: ({ smSetup }) => (smSetup?.complete ? 'SMM completed' : smSetup?.exists ? `SM request: ${smSetup.status || 'Pending'}` : 'No SM setup request'),
    action: () => ({ type: 'link', href: '/admin/social?tab=setup-requests', label: 'SM requests' }),
  },
  {
    key: 'bios', group: 'social', label: 'Bios written', dependsOn: ['palm-ig'],
    instructions: 'Once the SMM has created the IG accounts, write each account’s bio, then check this off.',
    status: ({ of }) => (isTrue(of['Bios Filled']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Bios Filled' }),
  },
  {
    key: 'profile-pics', group: 'social', label: 'Profile pics set', dependsOn: ['palm-ig', 'profile-photos'],
    instructions: 'Set each IG account’s profile picture using the uploaded photos, then check this off.',
    status: ({ of }) => (isTrue(of['Profile Pics Set']) ? 'done' : 'todo'),
    detail: () => null,
    action: () => ({ type: 'check', field: 'Profile Pics Set' }),
  },
  {
    key: 'cpd', group: 'social', label: 'Platform directory', dependsOn: ['palm-ig'],
    instructions: 'Auto-fills as the SMM completes accounts — verify the new accounts show up with their handles.',
    status: ({ cpdCount }) => (cpdCount > 0 ? 'done' : 'todo'),
    detail: ({ cpdCount }) => (cpdCount > 0 ? `${cpdCount} account${cpdCount === 1 ? '' : 's'} in CPD` : 'No CPD accounts'),
    action: () => ({ type: 'link', href: '/admin/social', label: 'Open directory' }),
  },
  {
    // The three delivery-topic ids gate ALL Post Prep / Penny / Grid Planner
    // sends. Auto-created when Social flips to Yes; this card is the backup
    // button + the red flag if that auto-create ever failed.
    key: 'tg-topics', group: 'social', label: 'Delivery topics (IG / FB / AI)', dependsOn: [],
    instructions: 'Post Prep and Grid Planner can’t deliver ANYTHING for this creator until these Telegram topics exist. Created automatically when you toggle Social ON — this button is the backup. AI topic only applies when AI content is enabled.',
    status: ({ ops }) => {
      const ig = hasText(String(ops['Telegram IG Topic ID'] ?? ''))
      const fb = hasText(String(ops['Telegram FB Topic ID'] ?? ''))
      const ai = hasText(String(ops['Telegram AI Topic ID'] ?? ''))
      const needAi = isTrue(ops['TJP Enabled'])
      return ig && fb && (!needAi || ai) ? 'done' : 'todo'
    },
    detail: ({ ops }) => {
      const mark = (v) => (hasText(String(v ?? '')) ? '✓' : '—')
      const bits = [`IG ${mark(ops['Telegram IG Topic ID'])}`, `FB ${mark(ops['Telegram FB Topic ID'])}`]
      if (isTrue(ops['TJP Enabled'])) bits.push(`AI ${mark(ops['Telegram AI Topic ID'])}`)
      return bits.join(' · ')
    },
    action: () => ({ type: 'tg-topics' }),
  },
  {
    key: 'reel-quota', group: 'social', label: 'Weekly reel quota', dependsOn: ['social-media'],
    instructions: 'How many reels per week we produce for this creator — drives the editor + Content Movement runway. Set it right here.',
    status: ({ ops }) => (!isTrue(ops['Social Media Editing']) ? 'na' : (Number(ops['Weekly Reel Quota']) > 0 ? 'done' : 'todo')),
    detail: ({ ops }) => (!isTrue(ops['Social Media Editing'])
      ? 'Social not managed'
      : (Number(ops['Weekly Reel Quota']) > 0 ? `${ops['Weekly Reel Quota']}/week` : 'Not set')),
    action: ({ ops }) => ({ type: 'inline-number', target: 'ops', field: 'Weekly Reel Quota', mode: 'int', suffix: '/week', value: Number(ops['Weekly Reel Quota']) || 0 }),
  },
  {
    key: 'multi-link', group: 'social', label: 'Multi-link', dependsOn: [],
    // N/A unless an admin flags the creator as needing a link-in-bio.
    instructions: 'If the creator needs a link-in-bio (Beacons / Linktree / Link Pages), build it, store the credentials, and check it off. Mark "Multi-link Needed" on the onboarding record first; otherwise this stays N/A.',
    status: ({ of }) => (!isTrue(of['Multi-link Needed']) ? 'na' : (isTrue(of['Multi-link Created']) ? 'done' : 'todo')),
    detail: ({ of }) => (!isTrue(of['Multi-link Needed']) ? 'Not needed' : (hasText(of['Multi-link URL']) ? 'Created' : 'Needed — not built yet')),
    action: ({ of }) => (hasText(of['Multi-link URL'])
      ? { type: 'link', href: of['Multi-link URL'], label: 'Open link', external: true }
      : { type: 'check', field: 'Multi-link Created' }),
  },
  {
    key: 'publer', group: 'social', label: 'Publer / AI', dependsOn: ['palm-ig', 'ai-consent'],
    // Only relevant for TJP/AI creators — otherwise N/A so it doesn't read as a gap.
    instructions: 'AI creators only: connect the IG inside Publer’s dashboard, then Sync here — the account appears and gets mapped so AI content can schedule.',
    status: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? (publerActive ? 'done' : 'todo') : 'na'),
    detail: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? (publerActive ? 'AI account active' : 'Not wired') : 'AI not enabled'),
    action: ({ ops, publerActive }) => (isTrue(ops['TJP Enabled']) ? { type: 'publer-sync', active: !!publerActive } : null),
  },

  // ── Profile & Comms ────────────────────────────────────────────
  {
    key: 'telegram-bot', group: 'profile', label: 'Telegram group', dependsOn: [],
    instructions: 'Add @palmmanage_bot to her group, post any message, then Refresh below and tap “This is her group” to link + start tracking.',
    status: ({ of }) => (isTrue(of['Telegram Bot Added']) ? 'done' : 'todo'),
    detail: () => '@palmmanage_bot in groups',
    action: () => ({ type: 'telegram-assign', field: 'Telegram Bot Added', deepLink: 'https://t.me/palmmanage_bot?startgroup=true', deepLinkLabel: 'Add bot' }),
  },
  {
    key: 'telegram-thread', group: 'profile', label: 'Telegram thread', dependsOn: ['telegram-bot'],
    instructions: 'Wires ITSELF once the bot is in the group and the first message lands — nothing to do here unless it stays red.',
    status: ({ ops }) => (hasText(String(ops['Telegram Thread ID'] ?? '')) ? 'done' : 'todo'),
    detail: ({ ops }) => (ops['Telegram Thread ID'] ? `Thread ${ops['Telegram Thread ID']} · auto-wired` : 'Waiting for her group’s first message'),
    action: () => null,
  },
  {
    key: 'comms-chat', group: 'profile', label: 'Comms chat', dependsOn: ['telegram-bot'],
    instructions: 'Pick the creator’s master communication chat right here so portal automations (OFTV deliveries, etc.) route to the right place.',
    status: ({ ops }) => (hasArr(ops['Communication Chat']) ? 'done' : 'todo'),
    detail: ({ ops }) => (hasArr(ops['Communication Chat']) ? 'Master chat set' : 'No master chat'),
    action: () => ({ type: 'comms-chat' }),
  },
  {
    key: 'dna', group: 'profile', label: 'DNA profile — Analyze', dependsOn: ['voice-memo'],
    instructions: 'After the voice memo / docs are uploaded, click Run Analyze to build the DNA profile. Survey answers enrich it but aren’t required to run.',
    status: ({ ops }) => (hasText(ops['Profile Summary']) ? 'done' : 'todo'),
    detail: ({ ops, profileDocs }) => (hasText(ops['Profile Summary'])
      ? 'Profile generated'
      : (profileDocs?.count ? `${profileDocs.count} doc${profileDocs.count === 1 ? '' : 's'} ready — click Analyze` : 'No docs yet')),
    action: () => ({ type: 'analyze-dna' }),
  },
  {
    // ONE music card (was two: taste input + processing) — paste her playlist,
    // hit Process, done. process-dna saves the input AND the DNA in one call.
    key: 'music-dna', group: 'profile', label: 'Music DNA', dependsOn: [],
    instructions: 'Paste the creator’s Spotify / Apple Music playlist link (or a plain list of songs) and hit Process — powers music suggestions in the editor.',
    status: ({ ops }) => (musicProcessed(ops) ? 'done' : 'todo'),
    detail: ({ ops }) => (musicProcessed(ops) ? 'Processed' : hasText(ops['Music DNA Input']) ? 'Input saved — not processed yet' : 'No playlist yet'),
    action: ({ ops }) => ({ type: 'music-dna', input: ops['Music DNA Input'] || '', processed: musicProcessed(ops) }),
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
    key: 'golive-cadence', group: 'golive', label: 'Cadence set', dependsOn: ['golive-strategy'],
    instructions: 'Set the creator’s initial posting cadence (how often / what mix), then check this off. Feeds the first-week schedule.',
    status: ({ of }) => (isTrue(of['Initial Cadence Set']) ? 'done' : 'todo'),
    detail: ({ of }) => (hasText(of['Cadence Notes']) ? 'Set' : null),
    action: () => ({ type: 'check', field: 'Initial Cadence Set' }),
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
// Tiles that only apply when Palm runs the creator's socials. Hidden entirely
// (not greyed) unless "Social media managed?" is Yes — flipping it on reveals
// them as fresh to-dos. Keep in sync with checklist.js `socialOnly` items.
const SOCIAL_ONLY_KEYS = new Set([
  'palm-ig', 'bios', 'profile-pics', 'cpd', 'telegram-thread',
  'tg-topics', 'reel-quota', 'music-dna', 'golive-pillars', 'golive-cadence',
  'golive-firstweek', 'golive-qa',
])

export function computeBoard(ctx) {
  const phase1 = ctx.phase1 || computePhase1(ctx.cf || {}, ctx.of || {})
  const fullCtx = { ...ctx, phase1 }

  const socialManaged = isTrue(ctx.ops?.['Social Media Editing'])
  const applicableTiles = BOARD_TILES.filter((t) => socialManaged || !SOCIAL_ONLY_KEYS.has(t.key))

  // First pass — status + content for every applicable tile.
  const tiles = applicableTiles.map((t) => ({
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

  // A dependency is "satisfied" when it's done, N/A, or filtered out entirely
  // (a hidden social-only prerequisite must never permanently block a core tile
  // like Comms chat, whose dep Telegram-thread disappears when social is off).
  const depSatisfied = (key) => !(key in statusByKey) || statusByKey[key] === 'done' || statusByKey[key] === 'na'

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
  }).filter((g) => g.tiles.length > 0)

  return {
    groups,
    counts: { done, total },
    nextKey,
    readiness: computeReadiness(phase1, ctx.of || {}, socialManaged),
  }
}
