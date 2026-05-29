// 90-day AI account warm-up playbook. Source of truth for the per-account
// task instantiation that happens on "Mark Account Created."
//
// Tasks live at decision-point days only (Day 0, 1, 4, 5, 7, 8, 10, 14, 15,
// 21, 22, 23, 30, 45, 60, 90). Multi-day cadences (e.g. "Days 5-7 daily
// stories") are represented as one task on the starting day with a cadence
// note in the description — instantiating one row per day for 90 days would
// bury the operator in noise.
//
// PLAYBOOK_VERSION is bumped when the task list changes meaningfully. Each
// instantiated task row records the version it was created from; a future
// "patch in-flight accounts" admin action can overlay newer-version tasks
// onto existing accounts (Day >= today + 1 only — done tasks stay frozen).
//
// Day-21 (FB compound) and Day-45 (OF CTA flip) get special treatment:
//   - Day-21 is split into 5 sub-tasks with prerequisiteTaskKey chaining
//     (Step N blocked until Step N-1 = Done). This is the highest-risk day
//     in the playbook — wrong link cascades cause permanent BM restriction.
//   - Day-45 has requiresOwnerApproval=true. The "Mark Done" path checks
//     Owner Approved before allowing the flip. This is the second-highest
//     risk action (OF CTA premature = account flagged).
//
// Source: docs/build-plans/publer-ai-account-creation-playbook.md
// Reconciliation: docs/build-plans/smm-consolidation/master-plan.md
//   (Decision: Day-21 5-step chain, Day-45 owner-approval gate)

export const PLAYBOOK_VERSION = 1

export const PLAYBOOK_TASKS = [
  // ─── DAY 0 — SETUP (pre-account-creation prep) ──────────────────────────
  {
    key: 's0-vault-store',
    day: 0,
    phase: 'Setup',
    title: 'Store credentials in vault (IG, FB, Gmail, recovery codes)',
    description: 'Create vault items for: IG login, FB login, persona Gmail, recovery codes. Paste the vault item IDs into the AI Account Profile fields (IG Vault Item ID, FB Vault Item ID, Gmail Vault Item ID, Recovery Codes Vault Item ID). NEVER paste plain passwords here — only the item IDs.',
    required: true,
  },
  {
    key: 's0-pixel-slot',
    day: 0,
    phase: 'Setup',
    title: 'Assign Pixel device + OS profile slot',
    description: 'Note which Pixel + which GrapheneOS profile slot this persona owns. Each persona = its own OS profile. Fill the "Pixel Device" field on AI Account Profile (e.g. "Pixel-01 / Profile-A").',
    required: true,
  },
  {
    key: 's0-sim',
    day: 0,
    phase: 'Setup',
    title: 'Verify SIM is active + paired to this Pixel',
    description: 'One Mint Mobile SIM per Pixel. Confirm the SIM is active and the phone has cellular service. All profiles share the cellular IP — that is expected and acceptable.',
    required: true,
  },
  {
    key: 's0-gmail-aged',
    day: 0,
    phase: 'Setup',
    title: 'Confirm persona Gmail has aged ≥ 48 hours',
    description: 'Fresh-on-creation Gmail accounts trigger IG signup heuristics. Aged ≥ 48h with a few sent emails reduces flag risk.',
    required: true,
  },

  // ─── DAY 1 — ACCOUNT CREATION + NEUTRAL PROFILE ─────────────────────────
  {
    key: 'd1-create-ig',
    day: 1,
    phase: 'Build',
    title: 'Create the IG account on the phone (app, not browser)',
    description: 'Open the Instagram app on the assigned OS profile. Sign up using the persona Gmail. Username should already be picked. Phone verification: use the SIM. No bio, no link, no profile pic yet.',
    required: true,
  },
  {
    key: 'd1-bio-neutral',
    day: 1,
    phase: 'Build',
    title: 'Set neutral, minimal bio (NO AI disclosure, NO link yet)',
    description: 'Bio should be 1-2 sentences, neutral hobby/vibe language. No mention of "AI", "OnlyFans", "18+", "DM for collabs", no fire/peach/eggplant emojis. NO link in bio yet (Day 10).',
    required: true,
  },
  {
    key: 'd1-mark-created',
    day: 1,
    phase: 'Build',
    title: 'Mark account as created — flip Warmup Status to "Warming Up"',
    description: 'Click "Mark Account Created" in the per-account view. This locks the Warmup Start Date and starts the day-counter.',
    required: true,
  },

  // ─── DAY 4 — PROFILE COMPLETION ─────────────────────────────────────────
  {
    key: 'd4-profile-pic',
    day: 4,
    phase: 'Build',
    title: 'Add profile picture (AI-of-creator face shot)',
    description: 'Use an AI-generated face shot of the creator persona. No logos, no watermarks visible at thumbnail size. Square crop, smiling, well-lit. This is the first AI content visible on the profile.',
    required: true,
  },
  {
    key: 'd4-bio-disclosure',
    day: 4,
    phase: 'Build',
    title: 'Add AI disclosure to bio',
    description: 'Update bio to include: "AI-generated content of @[real_handle] · posted with consent · 18+". Keep it brief, factual. The AI label disclosure satisfies EU AI Act Article 50 (enforceable Aug 2 2026) and reduces "deceptive AI" flag risk.',
    required: true,
  },

  // ─── DAYS 5-7 — STORIES + ENGAGEMENT ────────────────────────────────────
  {
    key: 'd5-stories-daily',
    day: 5,
    phase: 'Build',
    title: 'Start daily stories (Days 5-7, then ongoing)',
    description: 'Post 1-3 stories per day starting Day 5. Vibe content — sunsets, coffee, gym mirror selfies, music stickers. No links in stories. This warms the algorithm by showing daily activity.',
    required: true,
  },
  {
    key: 'd5-engagement-light',
    day: 5,
    phase: 'Build',
    title: 'Start light engagement (~30 likes/day, follow 8-15 creators)',
    description: 'Follow 8-15 inspiration creators in the same niche. Like ~30 posts per day spread across them. Comment on 2-3 posts/day with short non-spammy text. No DMs.',
    required: true,
  },
  {
    key: 'd7-flag-check',
    day: 7,
    phase: 'Build',
    title: 'Spot-check for any flag or restriction notice',
    description: 'Open the app, check Account Status (Settings → Account → Account Status). Should be clean. If anything is flagged, file an appeal once (max), pause the warmup, log to Persona Notes.',
    required: true,
  },

  // ─── DAY 8 — FIRST CONTENT POST ─────────────────────────────────────────
  {
    key: 'd8-first-post',
    day: 8,
    phase: 'Build',
    title: 'Post first AI-of-creator content (1 reel)',
    description: 'Single reel, watermark visible (small "AI" mark, bottom-right corner). AI label TOGGLE ON (Settings on the post → Advanced → "AI generated"). IPTC Digital Source Type metadata preserved — do NOT strip via re-encoding. Caption: lifestyle/relatable, no OF/link mention.',
    required: true,
  },

  // ─── DAY 10 — LINK IN BIO ───────────────────────────────────────────────
  {
    key: 'd10-beacons-setup',
    day: 10,
    phase: 'Build',
    title: 'Verify Beacons page is configured (content-warning ON, NO OF link)',
    description: 'Open Beacons editor for this persona. Toggle the content-warning gate ON. Add links to: persona portfolio, maybe a Spotify, maybe a free-content gallery. DO NOT add OF link yet — Day 45 minimum (with owner approval).',
    required: true,
  },
  {
    key: 'd10-bio-link-add',
    day: 10,
    phase: 'Build',
    title: 'Add Beacons URL to IG bio',
    description: 'Edit IG bio → add the Beacons URL as the single bio link. This is the first link the account ever has. Linktree/Stan/Carrd silently ban OF-adjacent — Beacons is the only safe choice.',
    required: true,
  },

  // ─── DAY 14 — CADENCE INCREASE (BUILD) ──────────────────────────────────
  {
    key: 'd14-cadence-build',
    day: 14,
    phase: 'Build',
    title: 'Increase to BUILD cadence: 2-3 posts/day (reels + carousels)',
    description: 'From Day 14 through Day 21, post 2-3 pieces of AI-of-creator content per day. Mix reels and carousels. All with watermark + AI label + IPTC metadata. Caption template rotation kicks in (see Content Strategy engine).',
    required: true,
  },
  {
    key: 'd14-engagement-up',
    day: 14,
    phase: 'Build',
    title: 'Increase engagement: ~40-50 likes/day, 5-8 comments/day',
    description: 'Higher activity now that the account has a profile + first content. Continue following 3-5 new creators per week. Don\'t spike too fast — Meta\'s velocity heuristics flag sudden engagement bursts.',
    required: true,
  },

  // ─── DAY 15 — BUILD PHASE START ─────────────────────────────────────────
  {
    key: 'd15-comments-reply',
    day: 15,
    phase: 'Build',
    title: 'Reply to comments on own posts within 4 hours (Days 15+)',
    description: 'Engagement signal — replied comments boost reach. Use varied wording, don\'t reply with identical "thanks 💕" 50 times.',
    required: true,
  },

  // ─── DAY 21 — FB COMPOUND DAY (5-STEP CHAIN, HIGHEST BUSINESS RISK) ─────
  {
    key: 'd21-1-fb-additional-profile',
    day: 21,
    phase: 'Build',
    title: 'Day 21 Step 1/5 — Create FB Additional Profile on the agency FB account',
    description: 'CRITICAL: log in to the clean agency FB account. Use Profile-switcher → "Add another profile" → create the new Additional Profile for this persona. Persona name should match the IG handle / Beacons URL. Profile pic = same as IG. Hard cap: 3 Additional Profiles per FB account.',
    required: true,
  },
  {
    key: 'd21-2-fb-page',
    day: 21,
    phase: 'Build',
    title: 'Day 21 Step 2/5 — Create FB Page admin\'d by the new Profile',
    description: 'Switch INTO the new Additional Profile. Create a new FB Page. Page name = persona name. Category = Personal Blog or Public Figure. Page admin = the Additional Profile you just created (NOT the agency profile).',
    required: true,
    prerequisiteTaskKey: 'd21-1-fb-additional-profile',
  },
  {
    key: 'd21-3-fb-business-portfolio',
    day: 21,
    phase: 'Build',
    title: 'Day 21 Step 3/5 — Create Business Portfolio for this persona',
    description: 'In Meta Business Suite, create a new Business Portfolio just for this persona. Add the FB Page from Step 2 into the Portfolio. This isolates the persona\'s business assets from the agency\'s main accounts.',
    required: true,
    prerequisiteTaskKey: 'd21-2-fb-page',
  },
  {
    key: 'd21-4-fb-ig-link',
    day: 21,
    phase: 'Build',
    title: 'Day 21 Step 4/5 — Link IG to FB Page via Account Center',
    description: 'In the Additional Profile\'s Account Center, link the persona\'s IG account to the new FB Page. This is what enables "Professional via Facebook" posting in Publer. WRONG-LINK RISK: ensure the IG you link is the persona\'s IG, NOT the real creator\'s. Triple-check the handle before clicking Link.',
    required: true,
    prerequisiteTaskKey: 'd21-3-fb-business-portfolio',
  },
  {
    key: 'd21-5-publer-prep',
    day: 21,
    phase: 'Build',
    title: 'Day 21 Step 5/5 — Verify Business Portfolio is ready for Publer auth',
    description: 'In Meta Business Suite, confirm: Page is in Portfolio, IG is linked to Page, the Additional Profile is the only admin. Take a screenshot. Do NOT authorize Publer yet — that happens Day 23.',
    required: true,
    prerequisiteTaskKey: 'd21-4-fb-ig-link',
  },

  // ─── DAY 22 — BUILD-STEADY TRANSITION ───────────────────────────────────
  {
    key: 'd22-cadence-down',
    day: 22,
    phase: 'Build-Steady',
    title: 'Reduce cadence: 2 posts/day (Days 22-30)',
    description: 'Step down from BUILD (3/day) to BUILD-STEADY. Engagement stays at Day-14 levels. This is the "settle in" phase before STEADY.',
    required: true,
  },

  // ─── DAY 23 — PUBLER AUTHORIZATION ──────────────────────────────────────
  {
    key: 'd23-publer-auth',
    day: 23,
    phase: 'Build-Steady',
    title: 'Authorize Publer access to IG + FB Page',
    description: 'In the Publer dashboard, connect the new accounts. Use "Professional (via Facebook)" — preferred path. Authenticate via the persona\'s Additional Profile. Connect both IG and FB Page.',
    required: true,
    prerequisiteTaskKey: 'd21-5-publer-prep',
  },
  {
    key: 'd23-publer-mapping',
    day: 23,
    phase: 'Build-Steady',
    title: 'Map Publer accounts in the admin (Publer Mappings page)',
    description: 'Navigate to /admin/publer. Click "Sync from Publer" — the new accounts appear. Set Creator (or N/A for standalone), Account Type = AI, Status = Active, AI Consent on File = (reference TGP record). Link these Publer Accounts rows to this AI Account Profile via the new "AI Account Profile" link field on Publer Accounts.',
    required: true,
    prerequisiteTaskKey: 'd23-publer-auth',
  },

  // ─── DAY 30 — STEADY CADENCE ────────────────────────────────────────────
  {
    key: 'd30-cadence-steady',
    day: 30,
    phase: 'Steady',
    title: 'Transition to STEADY cadence: 1 post per 2-3 days',
    description: 'Steady state. Continue engagement at Day-14 levels. Posts now go through Publer (auto-scheduled via Content Strategy engine).',
    required: true,
  },
  {
    key: 'd30-health-check',
    day: 30,
    phase: 'Steady',
    title: 'Day-30 health check',
    description: 'Review: reach trend (should be growing slowly), engagement rate (>2% is healthy), follower count, any flags. Log findings to Persona Notes.',
    required: true,
  },

  // ─── DAY 45 — OF CTA FLIP (OWNER APPROVAL GATE) ─────────────────────────
  {
    key: 'd45-owner-approval',
    day: 45,
    phase: 'Steady',
    title: '⚠️ OWNER APPROVAL — add OF CTA to Beacons',
    description: 'Day-45 OF CTA flip is the second-highest business-risk action in the playbook. Owner reviews the persona\'s health (reach, engagement, no recent flags) and approves. Once approved, the d45-add-of-cta task unlocks. NOT before Day 45. NEVER add OF link directly to IG bio — Beacons only.',
    required: true,
    requiresOwnerApproval: true,
  },
  {
    key: 'd45-add-of-cta',
    day: 45,
    phase: 'Steady',
    title: 'Add OF CTA link to Beacons',
    description: 'Once owner approval is on file (d45-owner-approval), add the OF link to the Beacons landing page. Content-warning gate must be ON. The OF link is NEVER in the IG bio — Beacons gates it behind the warning click.',
    required: true,
    prerequisiteTaskKey: 'd45-owner-approval',
  },

  // ─── DAY 60 — MONETIZATION PREP ─────────────────────────────────────────
  {
    key: 'd60-monetization',
    day: 60,
    phase: 'Steady',
    title: 'Begin monetization activities',
    description: 'Story Stickers / question boxes / poll engagement. DMs OK now but at low volume (5-10/day). Voice / video CTAs in stories. Continue feeding the Content Strategy engine.',
    required: true,
  },
  {
    key: 'd60-health-check',
    day: 60,
    phase: 'Steady',
    title: 'Day-60 health check',
    description: 'Detailed audit: reach trend, engagement rate, OF traffic from Beacons, any flags or shadow-ban indicators. Decide whether to extend warmup or proceed to Day 90 graduation.',
    required: true,
  },

  // ─── DAY 90 — GRADUATE TO LIVE ──────────────────────────────────────────
  {
    key: 'd90-graduate',
    day: 90,
    phase: 'Live',
    title: 'Graduate account — flip Warmup Status to "Live"',
    description: 'Account is past the 90-day warmup. Engine writes to Posts (not Warmup Tasks) from now on. Amin pipe stops firing for this account; Publer takes over. Manual posts still possible but exceptional.',
    required: true,
  },
]

// Compute current warmup day based on start date + paused days.
// Returns null if account has no start date (still in Setup).
// Returns 0 on the exact start date.
export function computeCurrentDay({ warmupStartDate, daysPaused = 0 } = {}) {
  if (!warmupStartDate) return null
  const start = new Date(warmupStartDate)
  if (Number.isNaN(start.getTime())) return null
  const today = new Date()
  // Use UTC midnight comparisons to avoid timezone day-boundary drift.
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const diffDays = Math.floor((todayUtc - startUtc) / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays - (Number(daysPaused) || 0))
}

// Tasks DUE (scheduled day <= current day) AND not yet Done/Skipped.
// Pass the account's current task rows; this filters them.
export function filterDueTasks(taskRows, currentDay) {
  if (currentDay == null) return []
  return taskRows
    .filter(t => (t.fields?.Day ?? 0) <= currentDay)
    .filter(t => !['Done', 'Skipped'].includes(t.fields?.Status))
}

// Build the Airtable create payload for instantiating all playbook tasks
// against a freshly-created AI Account Profile row.
export function buildTaskInstantiationPayload(accountId, { version = PLAYBOOK_VERSION } = {}) {
  return PLAYBOOK_TASKS.map(t => ({
    fields: {
      'Task Title': t.title,
      'Account': [accountId],
      'Day': t.day,
      'Phase': t.phase,
      'Task Key': t.key,
      'Description': t.description,
      'Required': !!t.required,
      'Status': 'Pending',
      'Requires Owner Approval': !!t.requiresOwnerApproval,
      'Owner Approved': false,
      'Prerequisite Task Key': t.prerequisiteTaskKey || '',
      'Template Version': version,
    },
  }))
}
