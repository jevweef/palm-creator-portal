// 90-day AI account warm-up playbook. Source of truth for the per-account
// task instantiation that happens on "Mark Account Created."
//
// Tasks live at decision-point days only (Day 0, 1, 2, 3, 4, 5, 7, 10, 14, 15,
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
// VERSION 2 (2026-06-03) — folded in the 8-specialist deep-research findings
// (docs/build-plans/ig-warmup-research-2026-06-03.md). Key changes vs v1:
//   - Profile pic + bio + 1-2 Story Highlights now Day 1 (complete-profile-
//     first is a trust signal; was Day 4). First 48-72h = observe-only.
//   - First FEED post pulled to Day 3, first Story Day 4, first Reel Day 5
//     (was a single Day-8 reel). Posting during warmup is MANUAL on the phone.
//   - NEW Day-7 reach gate: post a near-offer creative WITHOUT a link, confirm
//     reach is healthy BEFORE adding the bio link. Gates the Day-10 link tasks.
//   - Story Highlights expand to 4-6 at Day 7.
//   - Steady cadence revised DOWN to the researched safe rate (≈2 Reels/week +
//     3-5 feed/week, ≤2 feed/day, ≤1 reel/day) — v1's "2-3 posts/day" was high.
//   - Engagement numbers aligned to the phase cheat-sheet, run at the LOW end
//     (OF-adjacent = higher scrutiny). Hashtag HARD CAP = 5 (IG, Dec 2025).
//   - NEW unique-content rule: never post identical Reels/photos or identical
//     action scripts across personas (duplicate-across-accounts is a ban pattern).
//   - NEW Day-30 Publer go-live task: after the health check passes, flip the
//     account's Publer Live Mode -> Scheduled (ties into Publer Phase 3 gate).
//
// Day-21 (FB compound) and Day-45 (OF CTA flip) keep special treatment:
//   - Day-21 is split into 5 sub-tasks with prerequisiteTaskKey chaining
//     (Step N blocked until Step N-1 = Done). Highest-risk day in the playbook.
//   - Day-45 has requiresOwnerApproval=true (OF CTA premature = account flagged).
//   - Day-10 bio-link tasks are chained behind the Day-7 reach gate.
//
// Source: docs/build-plans/ig-warmup-research-2026-06-03.md (v2 research)
//         docs/build-plans/publer-ai-account-creation-playbook.md (original)
// Reconciliation: docs/build-plans/smm-consolidation/master-plan.md
//   (Decision: Day-21 5-step chain, Day-45 owner-approval gate)

export const PLAYBOOK_VERSION = 2

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
    description: 'Note which Pixel + which GrapheneOS profile slot this persona owns. Each persona = its own OS profile. Fill the "Pixel Device" field on AI Account Profile (e.g. "Pixel-01 / Profile-A"). One sandboxed profile per persona — never share a profile or log a persona in from another persona\'s slot.',
    required: true,
  },
  {
    key: 's0-sim',
    day: 0,
    phase: 'Setup',
    title: 'Verify SIM is active + paired to this Pixel',
    description: 'One real Mint Mobile SIM per Pixel. Confirm the SIM is active and the phone has cellular service. Verification at signup uses THIS SIM — never a VOIP/virtual number (high-volume VOIP ranges are themselves a 2026 flag). All profiles on one Pixel share the cellular IP — that is expected and acceptable.',
    required: true,
  },
  {
    key: 's0-gmail-aged',
    day: 0,
    phase: 'Setup',
    title: 'Confirm persona Gmail has aged ≥ 48 hours',
    description: 'Fresh-on-creation Gmail accounts trigger IG signup heuristics. Aged ≥ 48h with a few sent emails reduces flag risk. This Gmail is the permanent recovery email — keep it.',
    required: true,
  },

  // ─── DAY 1 — ACCOUNT CREATION + COMPLETE PROFILE + OBSERVE ───────────────
  // Research: complete the profile FIRST (trust signal), then do almost
  // nothing for the first 48-72h. Aggressive/automated action in the first
  // 72h is the strongest predictor of a ban within 30 days.
  {
    key: 'd1-create-ig',
    day: 1,
    phase: 'Build',
    title: 'Create the IG account on the phone (app, mobile data, real SIM)',
    description: 'Open the Instagram app on the assigned OS profile. Sign up on MOBILE DATA (4G/5G), NOT Wi-Fi. Use the persona Gmail + verify with the real Mint SIM. Username pre-picked. Stay a PERSONAL account for now — do NOT switch to Business yet (that happens Day 21 when the FB Page is linked). No VPN/proxy, ever.',
    required: true,
  },
  {
    key: 'd1-profile-pic',
    day: 1,
    phase: 'Build',
    title: 'Add profile picture (AI-of-creator face shot, SFW)',
    description: 'Use an AI-generated face shot of the creator persona. SFW, square crop, smiling, well-lit, no logos/watermarks visible at thumbnail size. A complete profile on Day 1 reads as established; an empty profile taking actions reads as a bot.',
    required: true,
  },
  {
    key: 'd1-bio',
    day: 1,
    phase: 'Build',
    title: 'Set SFW bio + AI disclosure (NO link, NO banned words)',
    description: 'Bio = 1-2 neutral, SFW sentences + a factual AI disclosure, e.g. "AI-generated imagery of @[real_handle] · made with consent". Keep every word SFW enough to "work for a fitness coach". NO link yet (Day 10). NO banned words/CTAs: no "OnlyFans/OF", "18+" + CTA, "NSFW", "DM for price", "link in bio for X", no 🍑/🍆/💦. The per-POST AI label (not the bio) is what satisfies EU AI Act Art. 50; the OF age-gate lives on Beacons, not the bio.',
    required: true,
  },
  {
    key: 'd1-highlights',
    day: 1,
    phase: 'Build',
    title: 'Add 1-2 SFW Story Highlight covers',
    description: 'Create 1-2 Highlight covers (e.g. "about", "lifestyle") with SFW on-brand art. Part of looking like a real persona before taking any social action. Expand to 4-6 around Day 7 once you have Stories worth saving.',
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
  {
    key: 'd1-observe-only',
    day: 1,
    phase: 'Build',
    title: 'Rest of Day 1: observe only (scroll ~15 min, almost zero actions)',
    description: 'After the profile is complete, just browse. Scroll the feed ~15 min. Follow at most ~5 niche accounts. NO posting, NO comments, NO DMs, NO links. The first 48-72h is the make-or-break window — looking like a real person doing very little beats any activity.',
    required: true,
  },

  // ─── DAY 2 — LIGHT CONSUME ──────────────────────────────────────────────
  {
    key: 'd2-light',
    day: 2,
    phase: 'Build',
    title: 'Light activity: scroll + 5-8 likes (no follows/comments yet)',
    description: 'Scroll 15-20 min. Like ~5-8 posts on niche content. Watch ~10 Stories. Still NO follows, comments, posts, DMs, or links. Pacing matters more than totals — never burst.',
    required: true,
  },

  // ─── DAY 3 — FIRST FOLLOWS + FIRST FEED POST ────────────────────────────
  {
    key: 'd3-first-actions',
    day: 3,
    phase: 'Build',
    title: 'First follows + comments (5-10 follows, 1-3 comments, 10-15 likes)',
    description: 'Follow 5-10 niche/inspiration creators. Leave 1-3 genuine, non-spammy comments. ~10-15 likes spread across the day. Keep ≤5 follows/hr — pacing beats totals.',
    required: true,
  },
  {
    key: 'd3-first-post',
    day: 3,
    phase: 'Build',
    title: 'First FEED post (neutral/lifestyle, SFW, no link)',
    description: 'Single neutral/lifestyle post. SFW. Watermark visible (small "AI" mark) + AI label TOGGLE ON (post → Advanced → "AI generated"). Preserve IPTC Digital Source Type metadata — do NOT strip via re-encoding. Caption SFW, no OF/link mention. Hashtags: 3-5 niche tags MAX (IG hard cap is 5 since Dec 2025); rotate sets, never reuse one block. Posted MANUALLY on the phone (not Publer yet). Unique to this persona — never the same asset another persona posts.',
    required: true,
  },

  // ─── DAY 4 — FIRST STORY ────────────────────────────────────────────────
  {
    key: 'd4-first-story',
    day: 4,
    phase: 'Build',
    title: 'First Story (+ optional 2nd feed post)',
    description: 'Post your first Story — vibe content (coffee, gym mirror, music sticker), SFW, NO links. Optionally a 2nd feed post. Engagement ~Day-3 levels (5-10 follows, ~15 likes, ~3 comments).',
    required: true,
  },

  // ─── DAY 5 — FIRST REEL + DAILY STORIES + ENGAGEMENT ────────────────────
  {
    key: 'd5-first-reel',
    day: 5,
    phase: 'Build',
    title: 'First Reel (neutral, no CTA/link) + start daily Stories',
    description: 'Post your first Reel — neutral, no CTA, no link. Watermark + AI label ON, IPTC preserved. From here, 1-2 Stories/day ongoing. Reels are the growth engine (≈2x non-follower reach vs other formats), but ≤1 Reel/day. Unique per persona.',
    required: true,
  },
  {
    key: 'd5-engagement',
    day: 5,
    phase: 'Build',
    title: 'Engagement (Days 5-7): follow 5-10/day, ~15-20 likes, 3-5 comments',
    description: 'Run at the LOW end (OF-adjacent = higher scrutiny). Follow 5-10/day, ~15-20 likes/day, 3-5 comments/day. NO DMs yet. NO follow/unfollow churn (a top shadowban trigger). Randomize timing — evenly-spaced actions are themselves a bot signal.',
    required: true,
  },

  // ─── DAY 7 — REACH GATE + FLAG CHECK + HIGHLIGHTS ───────────────────────
  {
    key: 'd7-reach-gate',
    day: 7,
    phase: 'Build',
    title: '⚑ Reach gate — post a near-offer creative WITHOUT a link, check reach',
    description: 'GO/NO-GO before the bio link. Post a creative close to your real offer but with NO link/CTA. Watch reach (non-follower reach in Insights). Healthy reach → warmup is passing, proceed to the Day-10 link. Suppressed reach → do NOT add the link; run 3-5 more neutral days and re-test. This task gates the Day-10 Beacons tasks.',
    required: true,
  },
  {
    key: 'd7-flag-check',
    day: 7,
    phase: 'Build',
    title: 'Spot-check for any flag or restriction notice',
    description: 'Settings → Account Status (should show "eligible to be recommended" / green). If anything is flagged: go fully dark 48-72h (no posting/liking/DMs), remove offending content/tags, file ONE appeal describing the symptom (never the word "shadowban"), pause the warmup, log to Persona Notes.',
    required: true,
  },
  {
    key: 'd7-highlights-expand',
    day: 7,
    phase: 'Build',
    title: 'Expand Story Highlights to 4-6 (SFW)',
    description: 'Now that you have a few Stories, save them into 4-6 SFW Highlight categories (about / lifestyle / BTS). Keep covers and content SFW — Highlights are machine-scanned like the bio.',
    required: true,
  },

  // ─── DAY 10 — LINK IN BIO (gated behind the Day-7 reach gate) ───────────
  {
    key: 'd10-beacons-setup',
    day: 10,
    phase: 'Build',
    title: 'Configure Beacons page (content-warning ON, NO OF link yet)',
    description: 'Open the Beacons editor for this persona. Toggle the content-warning/age-gate ON. Add SFW links (portfolio, free gallery, maybe Spotify). DO NOT add the OF link yet — Day 45 minimum, with owner approval. Beacons (or AllMyLinks backup) is the only safe host — AVOID Linktree (2026 reports: bans adult creators).',
    required: true,
    prerequisiteTaskKey: 'd7-reach-gate',
  },
  {
    key: 'd10-bio-link-add',
    day: 10,
    phase: 'Build',
    title: 'Add Beacons URL to IG bio',
    description: 'Edit IG bio → add the Beacons URL as the single bio link. This is the first link the account ever has — adding a link before the account is warmed is the single most-cited instant-shadowban trigger. Never the raw onlyfans.com URL or the word "OnlyFans" in bio (machine-scanned). Don\'t swap the bio link frequently — it\'s a trust-score risk.',
    required: true,
    prerequisiteTaskKey: 'd10-beacons-setup',
  },

  // ─── DAY 14 — BUILD CADENCE ─────────────────────────────────────────────
  {
    key: 'd14-cadence-build',
    day: 14,
    phase: 'Build',
    title: 'BUILD cadence (Days 14-21): 3 feed + 1-2 Reels/week, daily Stories',
    description: 'Ramp posting GRADUALLY — 3 feed posts + 1-2 Reels per week, daily Stories. NOT multiple posts/day (content velocity on a young account is a flag). Ceilings: ≤2 feed/day, ≤1 Reel/day, space posts by hours. Still posted manually on the phone. Every asset/caption unique to this persona.',
    required: true,
  },
  {
    key: 'd14-engagement-up',
    day: 14,
    phase: 'Build',
    title: 'Engagement up (Days 8-14 band): ~20-40 follows, 50-100 likes, 10-20 comments/day',
    description: 'Higher activity now the account has a profile + content. Run the LOW end for OF-adjacent. Follow 3-5 new creators per week beyond replies. Hashtags still 3-5 MAX, rotate sets. Don\'t spike — Meta\'s velocity heuristics flag sudden engagement bursts.',
    required: true,
  },

  // ─── DAY 15 — REPLIES + UNIQUE-CONTENT RULE ─────────────────────────────
  {
    key: 'd15-comments-reply',
    day: 15,
    phase: 'Build',
    title: 'Reply to comments on own posts within ~4h (Days 15+)',
    description: 'Engagement signal — replied comments boost reach. Use varied wording; don\'t reply with identical "thanks 💕" 50 times.',
    required: true,
  },
  {
    key: 'd15-unique-content',
    day: 15,
    phase: 'Build',
    title: 'Confirm content is UNIQUE per persona (multi-account safety)',
    description: 'Load-bearing rule for the fleet: NEVER post the same AI Reel/photo, the same caption, or run identical follow/like scripts across personas. Duplicate content across accounts is itself a ban pattern that links and sinks correlated accounts. Vary content, captions, posting times, and follow targets per persona.',
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
    title: 'Day 21 Step 4/5 — Switch IG to Business + link to FB Page via Account Center',
    description: 'Switch the persona\'s IG to a BUSINESS account (required for Graph API / Publer publishing — Creator accounts cannot publish via API). In the Additional Profile\'s Account Center, link the persona\'s IG to the new FB Page. WRONG-LINK RISK: ensure the IG you link is the persona\'s IG, NOT the real creator\'s. Triple-check the handle before clicking Link.',
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
    title: 'BUILD-STEADY cadence (Days 22-30): 3-4 feed + 2 Reels/week',
    description: 'Settle-in phase before STEADY. 3-4 feed posts + 2 Reels per week, 2 Stories/day. Engagement holds at Day-14 levels (30-50 follows/day band, LOW end). Still manual on the phone until Publer goes live (Day 30).',
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
    title: 'Map Publer accounts in the admin (leave Live Mode = Draft)',
    description: 'Go to /admin/publer → "Sync from Publer" — the new accounts appear. Set Creator, Account Type = AI, Status = Active, AI Consent on File. Link these Publer Accounts rows to this AI Account Profile. LEAVE "Live Mode" = Draft for now — Publer will only create drafts (round-trip check), nothing publishes live until the Day-30 go-live task after the health check passes.',
    required: true,
    prerequisiteTaskKey: 'd23-publer-auth',
  },

  // ─── DAY 30 — STEADY CADENCE + PUBLER GO-LIVE ───────────────────────────
  {
    key: 'd30-health-check',
    day: 30,
    phase: 'Steady',
    title: 'Day-30 health check',
    description: 'Review: non-follower reach trend (should be growing slowly), engagement rate (>2% is healthy), follower count, Account Status (eligible to be recommended), any flags. Log findings to Persona Notes. This gates the Publer go-live.',
    required: true,
  },
  {
    key: 'd30-publer-golive',
    day: 30,
    phase: 'Steady',
    title: 'Flip Publer Live Mode → Scheduled (account goes live)',
    description: 'Only after the Day-30 health check passes: in /admin/publer set this account\'s "Live Mode" = Scheduled. Publer now publishes for real with jittered scheduled_at (Phase 3 gate). If anything looked off in the health check, leave it Draft and extend warmup.',
    required: true,
    prerequisiteTaskKey: 'd30-health-check',
  },
  {
    key: 'd30-cadence-steady',
    day: 30,
    phase: 'Steady',
    title: 'STEADY cadence: ~2 Reels/week + 3-5 feed/week + 1-3 Stories/day',
    description: 'Steady state via Publer (jittered timing). Ceilings: ≤2 feed/day, ≤1 Reel/day, never burst-publish a backlog. Follows 30-50/day (credibility signal, not a growth lever). Best times for OF-leaning audiences ≈ 7-11pm local — verify against the account\'s own Insights once ~2 weeks of data exist.',
    required: true,
  },

  // ─── DAY 45 — OF CTA FLIP (OWNER APPROVAL GATE) ─────────────────────────
  {
    key: 'd45-owner-approval',
    day: 45,
    phase: 'Steady',
    title: '⚠️ OWNER APPROVAL — add OF CTA to Beacons',
    description: 'Day-45 OF CTA flip is the second-highest business-risk action in the playbook. Owner reviews the persona\'s health (reach, engagement, no recent flags) and approves. Once approved, the d45-add-of-cta task unlocks. NOT before Day 45. NEVER add the OF link directly to IG bio — Beacons only.',
    required: true,
    requiresOwnerApproval: true,
  },
  {
    key: 'd45-add-of-cta',
    day: 45,
    phase: 'Steady',
    title: 'Add OF CTA link to Beacons',
    description: 'Once owner approval is on file (d45-owner-approval), add the OF link to the Beacons landing page. Content-warning/age-gate must be ON. The OF link is NEVER in the IG bio — Beacons gates it behind the warning click. Keep the CTA wording off the IG bio text entirely.',
    required: true,
    prerequisiteTaskKey: 'd45-owner-approval',
  },

  // ─── DAY 60 — MONETIZATION PREP ─────────────────────────────────────────
  {
    key: 'd60-monetization',
    day: 60,
    phase: 'Steady',
    title: 'Begin monetization activities',
    description: 'Story Stickers / question boxes / poll engagement. DMs OK now but WARM REPLIES ONLY, low volume (5-10/day) — never cold-blast, never put OF/Beacons links in DMs (hard spam trigger). Voice/video CTAs in Stories. Continue feeding the Content Strategy engine.',
    required: true,
  },
  {
    key: 'd60-health-check',
    day: 60,
    phase: 'Steady',
    title: 'Day-60 health check',
    description: 'Detailed audit: reach trend, engagement rate, OF traffic from Beacons, any flags or shadow-ban indicators (search your username + a niche tag from a non-following account — if your post never appears, you\'re suppressed). Decide whether to extend warmup or proceed to Day 90 graduation.',
    required: true,
  },

  // ─── DAY 90 — GRADUATE TO LIVE ──────────────────────────────────────────
  {
    key: 'd90-graduate',
    day: 90,
    phase: 'Live',
    title: 'Graduate account — flip Warmup Status to "Live"',
    description: 'Account is past the 90-day warmup. Engine writes to Posts (not Warmup Tasks) from now on. Amin pipe stops firing for this account; Publer takes over fully. Manual posts still possible but exceptional.',
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
