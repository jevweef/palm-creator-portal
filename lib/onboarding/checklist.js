/**
 * Single source of truth for the admin onboarding checklist (drawer on
 * /admin/onboarding). Shared by:
 *   - app/api/admin/onboarding/checklist/route.js  (GET signal + PATCH writes)
 *   - app/api/admin/onboarding/go-live/route.js     (server-side gating)
 *   - app/admin/onboarding/page.js                  (drawer UI + client gating)
 *
 * Keeping the field names, item config, and readiness rules here means the UI
 * and the server can never disagree about what "ready to go live" means.
 */

// ---- Phase 3: manual admin tasks (checkbox items, in display order) ----
// Each item has a primary checkbox `field` and optional companion inputs.
export const PHASE3_ITEMS = [
  {
    field: 'Telegram Bot Added',
    label: 'Add @palmmanage_bot to the creator’s Telegram groups',
    required: true,
    deepLink: 'https://t.me/palmmanage_bot?startgroup=true',
    deepLinkLabel: 'Open bot-add link',
    hint: 'Required for heartbeat ingestion to read group messages.',
  },
  {
    field: 'Niches Confirmed',
    label: 'Confirm content niches',
    required: true,
    hint: 'Validate against the survey’s “content niche” answer.',
  },
  {
    field: 'Content Pillars Confirmed',
    label: 'Confirm content pillars',
    required: false,
    socialOnly: true,
  },
  {
    field: 'Kickoff Call Completed',
    label: 'Kickoff call completed',
    required: true,
    dateField: 'Kickoff Call Date/Time',
    dateLabel: 'Call date / time',
  },
  {
    field: 'Strategy Doc Created',
    label: 'Strategy doc drafted',
    required: true,
    urlField: 'Strategy Doc Link',
    urlLabel: 'Strategy doc link',
    notesField: 'Strategy Notes',
    notesLabel: 'Strategy notes (incl. posting cadence)',
  },
  {
    field: 'Bios Filled',
    label: 'IG account bios written',
    required: true,
    socialOnly: true,
    hint: 'After SMM creates the accounts.',
  },
  {
    field: 'Profile Pics Set',
    label: 'IG profile pics set',
    required: true,
    socialOnly: true,
  },
  {
    field: 'First Week Scheduled',
    label: 'First week of content scheduled',
    required: true,
    socialOnly: true,
  },
  {
    field: 'Accounts QA Complete',
    label: 'Accounts QA pass',
    required: true,
    socialOnly: true,
  },
]

// ---- Free-text reference fields (no checkbox, never gate go-live) ----
export const PHASE3_NOTES = [
  { field: 'Inspo Accounts', label: 'Inspo accounts (3–5 they want to model)', kind: 'textarea' },
  { field: 'Content Library Link', label: 'Existing content library link', kind: 'url' },
]

// Phase-2 (auto-setup) status fields that must be true before going live.
export const REQUIRED_SETUP_FIELDS = [
  { field: 'Default Social Accounts Created', label: 'Social accounts created' },
  { field: 'Dropbox Folder Structure Created', label: 'Dropbox folders created' },
]

// Phase-1 (portal) step keys that must be complete before going live.
export const REQUIRED_PORTAL_STEPS = ['survey', 'contract']

// Every Onboarding field the drawer is allowed to write.
export const EDITABLE_ONBOARDING_FIELDS = new Set([
  ...PHASE3_ITEMS.flatMap((it) => [it.field, it.dateField, it.urlField, it.notesField].filter(Boolean)),
  ...PHASE3_NOTES.map((n) => n.field),
  // Board-only toggles — editable from the readiness board but intentionally
  // NOT part of the Phase-3 go-live gate (they don't hard-block go-live).
  'Multi-link Created',
  'Initial Cadence Set',
  'AI Content Consent',
  'OF Login Confirmed',
  // Survey → chat team send state — lets an admin mark it sent manually (e.g.
  // the info was delivered before this flow existed / the creator is already live).
  'Survey Sent to Chat Team',
  'Survey Sent to Chat Team At',
])

const hasVal = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/**
 * Compute the 6 portal-step completion signals from raw Creator + Onboarding
 * field maps. Read-only Phase 1 panel. Server-side (needs raw records).
 * @returns {Array<{key,label,done,detail}>}
 */
export function computePhase1(cf = {}, of = {}) {
  const contractSigned = hasVal(cf['Contract Sign Date']) || (Array.isArray(cf['Contract']) && cf['Contract'].length > 0)
  const voiceMemoDone =
    of['Audio Ramble Received'] === true ||
    (Array.isArray(cf['Voice Memo']) && cf['Voice Memo'].length > 0) ||
    cf['Voice Memo Status'] === 'Received' || cf['Voice Memo Status'] === 'Completed'
  const surveyDone = of['Survey Completed'] === true || hasVal(of['Survey Completed At'])

  return [
    {
      key: 'basic-info',
      label: 'Basic info',
      done: hasVal(cf['Creator']) && (hasVal(cf['AKA']) || hasVal(cf['Birthday']) || hasVal(cf['Time Zone'])),
      detail: [cf['AKA'] && `AKA ${cf['AKA']}`, cf['Time Zone']].filter(Boolean).join(' · ') || null,
    },
    {
      key: 'accounts',
      label: 'Accounts & platforms',
      done: hasVal(cf['Onlyfans URL']) || hasVal(cf['OF Email']) || hasVal(cf['Selected Platforms']),
      detail: cf['Onlyfans URL'] ? 'OnlyFans linked' : (cf['Selected Platforms'] ? 'Platforms selected' : null),
    },
    {
      key: 'survey',
      label: 'Survey',
      done: surveyDone,
      detail: of['Survey Completed At'] ? `Completed ${new Date(of['Survey Completed At']).toLocaleDateString()}` : null,
    },
    {
      key: 'contract',
      label: 'Contract signed',
      done: contractSigned,
      detail: cf['Contract Sign Date'] ? `Signed ${new Date(cf['Contract Sign Date']).toLocaleDateString()}` : null,
    },
    {
      key: 'voice-memo',
      label: 'Voice memo',
      done: voiceMemoDone,
      detail: cf['Voice Memo Status'] || null,
    },
    {
      key: 'review',
      label: 'Reviewed & submitted',
      done: cf['Onboarding Status'] === 'Completed',
      detail: cf['Onboarding Status'] || null,
    },
  ]
}

/**
 * Compute go-live readiness from the GET payload shapes (phase1 array +
 * onboarding field map). Portable: works on both server and client.
 * @returns {{ items: Array<{label,done,group}>, missing: string[], ready: boolean }}
 */
export function computeReadiness(phase1 = [], obFields = {}, socialManaged = true) {
  const items = []

  // Phase 1 — required portal steps
  for (const key of REQUIRED_PORTAL_STEPS) {
    const step = phase1.find((s) => s.key === key)
    items.push({ label: step?.label || key, done: !!step?.done, group: 'Portal' })
  }

  // Phase 2 — required auto-setup
  for (const f of REQUIRED_SETUP_FIELDS) {
    items.push({ label: f.label, done: obFields[f.field] === true, group: 'Setup' })
  }

  // Phase 3 — required manual tasks. Social-only tasks (bios, pics, first-week,
  // QA) don't gate go-live when Palm isn't running the creator's socials.
  for (const it of PHASE3_ITEMS) {
    if (!it.required) continue
    if (it.socialOnly && !socialManaged) continue
    items.push({ label: it.label, done: obFields[it.field] === true, group: 'Manual' })
  }

  const missing = items.filter((i) => !i.done).map((i) => i.label)
  return { items, missing, ready: missing.length === 0 }
}
