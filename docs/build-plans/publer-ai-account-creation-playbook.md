# OF-Adjacent AI Account Creation Playbook (May 2026)

**Scope:** Operational runbook for creating brand-new Instagram + Facebook Page accounts that will run AI-generated content of real OnlyFans-managed creators, minimizing ban risk during creation and the first 90 days.
**First two launches:** Amelia (Briel), then Katie Rosie.
**Source:** Research synthesis 2026-05-27, citations at end. Hardware/OS direction (GrapheneOS + Pixel) from evan's web-Publer operator contact; cross-checked against grapheneos.org docs.

---

## The chosen stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| OS | **GrapheneOS** on factory-unlocked **Pixel 8a / 8 / 9** | No Google attestation cross-linking accounts. Hardware Titan security chip. 32 sandboxed profiles per device → one phone can host up to 3 personas safely. |
| Phone | One Pixel per **3 personas max** | One device covers Amelia + Katie Rosie + room for one more. 6 personas → 2 Pixels. |
| Network | One SIM per persona (Mint $15/mo or Ultra PayGo $3/mo) | Cellular IP isolation per persona via SIM swap or per-profile eSIM. |
| Publishing | Publer web/API (server-side) | The Pixel is for **trust anchor + manual engagement**; Publer does the daily scheduled posting via Graph API — no daily phone fiddling for the operator. |
| FB structure | **Max 3 FB Profiles per FB login account** | Operator contact's hard rule. Additional Profiles feature consolidates 3 personas under one auth without tripping bot-detection. |
| Link-in-bio | Beacons (free tier) | Content-warning toggle allows OF routing. Linktree/Stan/Carrd all ban OF. |

**Initial cost: 1 Pixel 8a refurb (~$250) + SIMs.**
**Recurring: ~$15/persona/month for SIM. Pixel amortized.**

For 2 personas: **$250 one-time + $30/mo.** For 6: **~$500 one-time + $90/mo.**

This replaces the Multilogin + Coronium proxy stack ($175-220/persona/month) at roughly **1/15th the cost** with better isolation, because GrapheneOS profiles + Titan-chip-rooted attestation isolation is stronger than any browser fingerprint emulator.

---

## TL;DR — the rules that matter most

1. **GrapheneOS on factory-unlocked Pixel 8a/8/9, one OS profile per persona.** Up to 3 personas per phone — never more on one device. Carrier-locked Pixels won't work (can't OEM unlock).
2. **Real non-VoIP SIM per persona.** Free VoIP (Google Voice, TextNow) is dead. Mint $15/mo or Ultra Mobile PayGo $3/mo per persona — treat the number as a permanent asset.
3. **One Gmail per persona, no AI/bot naming.** `amelia.briel.creator@gmail.com` ✅. `briel.ai@…` ❌.
4. **Max 3 FB Profiles per FB account login.** Use the Additional Profiles feature to cluster 3 personas under one auth; never go to 5 (FB's max) — staying under triggers bot-detection.
5. **Never log into the AI persona from any device that touches the real creator's account.** Meta's Entity Lineage model in 2026 cross-links aggressively.
6. **No "OnlyFans" link in bio until ≥ day 45.** Day-1 OF link = #1 cause of early ban.
7. **Never use Linktree** for OF-adjacent. Use **Beacons** (free tier, content-warning toggle) or AllMyLinks as backup.
8. **Always toggle Publer's AI-content label + small visible "AI" watermark.** Reach penalty for the label is small; for being detected-and-undisclosed is 60-80%.
9. **Publer publishes server-side via Graph API** — the Pixel is for account creation, 2FA, and manual engagement only (likes/comments/follows/DMs/stories). No daily posting from the phone.
10. **Twin/insurance account at day 7.** Add a parallel persona on a different OS profile, low-touch consumption-only cadence. Loss of a 60-day primary is more expensive than the extra SIM.

---

## Tooling stack — what to actually buy

| Layer | Tool | Cost | Notes |
|---|---|---|---|
| Phone | **Pixel 8a refurb, factory unlocked** | ~$250 one-time | Carrier-locked won't work. Confirm OEM-unlockable before buying. Pixel 8 (~$400) or 9 (~$650) if budget allows. |
| OS | **GrapheneOS** | $0 | Install via [grapheneos.org/install/web](https://grapheneos.org/install/web). One OS profile per persona, max 3/phone. |
| SIM | Mint Mobile $15/mo or Ultra PayGo $3/mo | $3-15/mo per persona | Real non-VoIP only. One per persona, forever. Mint 5GB plan gives data for warmup engagement. |
| Link-in-bio | **Beacons** (free tier) | $0 | Content-warning toggle allows OF routing. Linktree/Stan/Carrd all ban OF. |
| Link-in-bio backup | AllMyLinks | $0 | TOS-explicit OF allowance. |
| Scheduler | **Publer** (already paid) | $5-10/mo per connected social account | Server-side Graph API publishing — no daily phone fiddling. |
| (Optional) anti-detect for desktop fallback | — | $0 | Only needed if you ever need to log into IG from a desktop. Phone-first means we don't. |

**Per-persona monthly: ~$15-25** (mostly SIM). One-time amortized hardware: ~$85-200/persona depending on how many you cluster per phone.

**Cost for first 2 personas (Amelia + Katie Rosie):**
- 1× Pixel 8a refurb: **$250 one-time**
- 2× Mint SIMs: **$30/mo**
- Beacons + Publer: **$0 incremental**

**Cost for 6 personas:**
- 2× Pixel 8a refurbs: $500 one-time
- 6× Mint SIMs: $90/mo
- ≈ $15-25 per persona/month all-in

(vs. the original Multilogin + Coronium gold-plated stack at ~$175-220/mo per persona — this is ~10-15× cheaper with stronger isolation guarantees.)

---

## Account creation environment (the hard rules)

### Hardware: GrapheneOS on Pixel
- **Required device:** factory-unlocked Pixel 8a, 8, 8 Pro, 9, 9 Pro, 9 Pro XL, or 9 Pro Fold. **Carrier-locked Pixels will not work** — OEM unlock is disabled and can't be reversed without manufacturer support.
- **Where to buy:** Google Store direct ($499 new for 8a) is the safest path. Refurb on Swappa / Back Market is fine if the listing explicitly says "factory unlocked" — verify before purchase. Avoid Amazon's third-party Pixel listings (high carrier-locked rate).
- **Install GrapheneOS** via the official web installer at [grapheneos.org/install/web](https://grapheneos.org/install/web). Steps:
  1. Enable Developer Options (Settings → About → tap Build Number 7×).
  2. Enable OEM Unlocking in Developer Options.
  3. Boot to bootloader (power off, hold Volume Down + Power).
  4. Use Chromium-based browser at install URL, follow prompts. ~15 min including firmware flash.
- Use a **quality USB-C cable directly to the computer** (no hubs).

### Profile-per-persona on GrapheneOS
- One OS user profile per persona — fully sandboxed: separate apps, app data, encryption keys, VPN config.
- GrapheneOS allows up to 32 profiles per device. **Operational cap: 3 personas per phone** — keeps engagement-time-per-phone reasonable and avoids hardware-level cellular IP clustering.
- Install Instagram + Facebook in each profile via sandboxed Google Play (works exactly like Play Store, just sandboxed per profile).
- "End session" each profile after use so apps fully exit (Meta scores background-task patterns).

### Network / SIM
- **One real non-VoIP SIM per persona.** Mint Mobile ($15/mo, 5GB) or Ultra Mobile PayGo ($3/mo, voice-only).
- Pixel 8/9 supports physical SIM + eSIM simultaneously — one device can host 2 personas with native SIM isolation. For the 3rd persona, swap SIMs when active, or route through a per-profile WireGuard VPN to a different carrier.
- SMS-Activate shut down Dec 2025. Survivors (SMSPool, 5SIM, Quackr, PVAPins) work for one-shot verification only.
- Free VoIP (Google Voice, TextNow) is dead for IG verification.
- Never recycle a number, never share across personas.

### Email
- Gmail or Outlook only. ProtonMail/Tutanota are flagged as bot-correlated.
- One per persona. No AI/bot naming: `amelia.briel.creator@gmail.com` ✅, `briel.ai@…` ❌.
- Age each Gmail at least 48h before using it for IG signup.
- Recovery email/phone graph is one of Meta's strongest cross-account linking signals.

### Device hygiene
- **Never log into the AI persona from any device that touches the real creator's account.** This includes desktop browsers — if your laptop is signed into the real creator's IG, don't open Publer from that same browser profile to manage the AI persona. Use a separate browser profile or different machine.
- Each GrapheneOS profile maintains its own VPN configuration, encryption keys, and app sandboxes — but the Titan-chip-level hardware identifiers are the same across profiles on the same physical device. **Meta cannot cross-link sandboxed profiles**, but a logical mistake (signing the same Gmail into two profiles) defeats the isolation.
- One Gmail, one IG, one Beacons, one SIM, one OS profile per persona. No exceptions.

---

## The first 48 hours

Meta scores a "trust score" inside the first 72 hours. ~80% of accounts that perform any automation in those 3 days get banned within 30 days.

| Window | Action |
|---|---|
| Hour 0 — Creation | Create from the official iOS or Android app (web is lower trust). Confirm email immediately. Profile photo + 1-2 line bio with NO link, NO platform name, NO spicy language. |
| Hour 0-2 | Do NOT post. Scroll feed 15-20 min. Watch 8-10 Reels to completion. No likes, no follows. |
| Hour 2-24 | Confirm phone (real SIM). Add 2 lifestyle photos to Story. Like 3-5 posts. Follow 3-5 mainstream/personal accounts (not your niche yet). 1 first post — neutral lifestyle, NOT the AI character's hero shot. |
| Day 2 | Browse 20 min, 8-12 likes, 10 stories watched, follow 5-7. Still no hashtags, no link, no DMs. |

---

## Warmup days 1-30

| Phase | Cadence | Content | Engagement |
|---|---|---|---|
| **Days 1-7** Consumption | 15-20 min/day | 1-2 lifestyle posts total. NO hashtags or max 3-5 ultra-generic (#sunset, #coffee). | 5-8 likes/session. 8-10 stories watched. Follow ≤5/day. **No comments, no DMs.** |
| **Days 8-14** Light engagement | 20-30 min/day | 2-3 posts. Daily stories. **Add bio link day 10** (Beacons, no OF yet). | 10-15 likes, 1-2 thoughtful comments, follow 3-5 niche/day. |
| **Days 15-21** Build | 30-45 min/day | 3-4 posts (mix Reels + feed). 8-10 hashtags, safe-niche set. | 15-25 likes, 3-5 comments, follow 5-10/day. |
| **Days 22-30** Steady | Mobile-user behavior | Daily stories. 1 post every 2-3 days. | Reply to DMs but don't initiate to non-followers. |

**Content mix during warmup:** 70/30 lifestyle-to-suggestive. By week 4 can move to 50/50, but suggestive content must be swimwear/lingerie-tier, NOT implied-explicit. Bikini/lingerie still gets Explore-suppressed even when guideline-compliant.

**Following the real creator from the AI account: DON'T.** Single biggest manual cross-link.

**Common warmup pitfalls:** identical warmup Reels across personas (Meta's pixel-level dedup catches it), identical posting timestamps, identical hashtag sets, adding the bio link on day 1.

---

## OnlyFans-space red flags to avoid

### Bio language that triggers
| ❌ Banned | ✅ Safe |
|---|---|
| "OnlyFans" | "VIP" |
| "18+" / "NSFW" | "members only" |
| "Nudes" / "spicy" | "exclusive content" |
| "DM for collabs" / "DM for price" | "extended version" |
| 🍑 🍆 emojis | "behind the scenes" |
| "Link in bio for X" | "my link" |

For AI accounts add: **"AI-generated content of @[real_handle] · posted with consent · 18+"**

### Hashtag denylist (shadow-flagged for OF-adjacent)
`#onlyfans #onlyfansgirl #spicycontent #linkinbio #nsfw #18plus #adultcontent #milf #curvy #alone #models #beauty`

One flagged tag can cut reach 90%.

**Safe replacements:** `#lingeriemodel #fitnessmotivation #contentcreator #lifestyleblogger`

### Link routing
- **Linktree, Stan Store, Carrd all ban OF.** Bans are silent and instant.
- **Beacons** is the operator default — allows adult content with the content-warning toggle, $0-10/mo, analytics + email capture.
- **AllMyLinks** is the hot backup.
- IG bio → Beacons → OnlyFans (behind content warning) so IG's crawler sees a neutral landing page.

### Monetized-link timing
- Day 1-9: no link.
- Day 10-20: Beacons link, but no OF on the Beacons page yet. Free newsletter / Discord / Twitter only.
- Day 21-44: still no OF on Beacons.
- **Day 45-60: add OnlyFans CTA on Beacons** (still not in IG bio directly).
- Day 60+: bio can swap to softer monetization language ("VIP / extended on my link").

### Cross-promotion mistakes
- Tagging the real creator's account.
- Identical caption phrasings between real + AI accounts.
- Identical follower overlap (Meta clusters by mutual-follower graph).
- Same payment method used to boost both accounts.

### DM behavior
- Instagram auto-flags DMs containing "OnlyFans," shortened adult-domain links, or repetitive copy-paste.
- Comment-to-DM automation (public side stays clean) is safer than caption CTAs.

### Photo content removed
Visible nipple (even with translucent tape — skin-tone gradient classifier), explicit sexual poses, OF screenshots, suggestive angles implying genitals. Swimwear/lingerie tolerated but Explore-suppressed.

---

## Facebook setup (with the 3-profiles-per-account rule)

The operator pattern from evan's contact: **one FB account login → up to 3 Additional Profiles → each Profile admins one persona's FB Page.** This consolidates 3 personas under a single authentication while staying below Meta's bot-detection threshold for the Additional Profiles feature (5 max, but going to 5 is a flag).

### Architecture
- **1 main FB account** per phone (clean, real, ideally 6+ months aged, 2FA on)
- **Up to 3 Additional Profiles** under that account (one per persona on this phone)
- **1 dedicated FB Page** per Additional Profile (this is the Page that pairs with IG)
- **1 Meta Business Portfolio per persona** (still — 95% of permanently-restricted BMs can't be revived; cross-persona BM sharing risks cascades even with isolated Profiles)

### Rules
- The main FB account's admin must NOT also admin the real creator's Page. Use a dedicated agency-side FB account, never a personal one signed into anything else.
- **2FA: authenticator app (Authy / Google Authenticator), not SMS.** SMS 2FA on virtual numbers gets locked at first review. Don't disable for Publer — Publer uses OAuth and works fine with 2FA on.
- **Link IG↔FB Page on day 21+, not at creation.** Linking on day 1 doubles surface area.
- **Publer connection:** authorize Publer with the **persona's Additional Profile**, via "Professional (via Facebook)." Each Additional Profile admins exactly one Page → pairs with one IG account → one Publer connection per persona.
- If a Profile gets flagged, the main account's other Profiles typically survive (unlike a fully-cascaded BM ban) — but the Page that Profile admined is at risk. The BM-per-persona isolation is what keeps the Page itself recoverable.

---

## AI disclosure mechanics

- **Preserve IPTC Digital Source Type metadata** at render time. Don't strip — Meta's pixel classifier catches AI anyway, and "absence of disclosure is itself the violation."
- **Toggle Publer's AI-content label on every post.** Meta says the label is reach-neutral; undisclosed-and-detected AI is 60-80% reach suppression.
- **Small visible "AI" watermark** on each piece. Satisfies the EU AI Act Article 50 transparency obligation enforceable Aug 2, 2026. Creates a documented consent + disclosure trail.
- **FTC double-disclosure for any sponsored posts:** relationship + AI nature, both required. Platform AI label does NOT substitute.
- **In bio:** "AI-generated content of @[real_handle] · posted with consent · 18+."

---

## Recovery if things go sideways

| Situation | Action |
|---|---|
| Suspended at creation (day 0-7) | One appeal via Help + instagram.com/accounts/appeal. Have consent paperwork + real creator's ID ready. First-appeal success <30% — if denied within 7 days, **abandon and start fresh**. |
| Shadowban (reach collapse) | Run the two-minute test (post with niche tag, have non-follower search). 48-72h hard pause, scrub flagged hashtags/posts, file ONE Help report, resume at 10-20 daily actions. Soft bans clear 7-14 days; 30 days → migrate. |
| Page disabled | Appeal via Meta Business Help. 95% of permanently-restricted Business Portfolios cannot be revived → migrate to fresh portfolio. |
| Multiple appeals | DON'T. Multiple appeals within short windows = auto-deny template detection. **One appeal, then wait.** |
| Insurance | **Twin account at day 7.** Parallel persona, low-touch consumption-only cadence (5 min/day, lifestyle posts only, no monetized link). |

---

## 90-day launch template — Amelia (briel.ai)

### Day −7 to 0 — Hardware prep
- Order factory-unlocked Pixel 8a from Google Store (or verified-unlocked refurb from Swappa/Back Market)
- Install GrapheneOS via [official web installer](https://grapheneos.org/install/web)
- Create the **Amelia OS profile** on the Pixel (sandboxed, separate encryption key, separate VPN config)
- Activate Mint Mobile SIM ($15/mo) in Amelia's profile
- Create `amelia.briel.creator@gmail.com` (or similar, no AI/bot naming) — let age 48h+ before use
- Set up agency's clean FB account if it doesn't exist (verified, 2FA via Authy, 6+ months aged)

### Days 1-3 — Creation
- Sign in to the Amelia OS profile on the Pixel
- Install Instagram via sandboxed Google Play (within this profile only)
- Create IG account from the app on day 1 using `amelia.briel.creator@gmail.com` + Mint SIM
- Profile photo + 1-2 line neutral bio ("art · lifestyle · 18+"); **NO link**
- Email + phone confirmed in first session
- 1 lifestyle post day 1; scroll/watch only otherwise
- **FB Profile: NOT yet created** (waits until day 21)

### Days 4-7 — Profile completion
- 2-3 lifestyle posts added
- Stories daily
- Follow 3-5/day mainstream + niche
- 5-10 likes/day, no DMs, no comments yet
- Beacons page built offline (not linked yet)

### Days 8-14 — First on-brand content + bio link
- First clearly-AI-of-Amelia content posted
  - "AI" watermark
  - IPTC tag preserved
  - Publer AI-content label ON
- Bio updated **day 10** to add Beacons link
- Beacons page: newsletter signup + free Discord + Twitter — **NO OnlyFans yet**
- 8-10 hashtags per post, niche-safe set
- Follow real creator's actual fans (NOT the creator)

### Days 15-30 — Warmup
- 4-5 posts in window, mix Reels + feed
- DMs replied to, not initiated
- Stories daily
- **Day 21:** From the agency's clean FB account, create the **first Additional Profile ("Amelia Briel")**. Create a FB Page admin'd by that Profile. Create a dedicated Business Portfolio. Link the Page to Amelia's IG via Account Center.
- **Day 23:** Authorize Publer for FB Page + IG via "Professional (via Facebook)" — sign in as the Amelia Additional Profile, not the main FB account.
- **Day 25:** Begin scheduling via Publer.

### Days 30-60 — Steady state
- 4-5 posts/week, mix Reels + feed
- 1-2 stories/day
- Comments engaged within 1h (mobile-pattern signal)
- **Day 45:** add OnlyFans CTA on Beacons page (still NOT in IG bio directly)
- Weekly reach check — if drop >40% W/W, run shadowban test + pause 48h

### Days 60-90 — Monetization on
- OnlyFans CTA fully live on Beacons
- Bio swap to softer monetization language ("VIP / extended on my link")
- DM auto-replies for "price"/"more" → comment-to-DM flow
- Twin account confirmed running
- Scale content to ~1/day
- **Day 75-90:** evaluate moving to Reels-primary cadence (higher reach yield)

---

## Hard rules across all 90 days

- AI label ON every post, no exceptions
- One OS profile per persona, max 3 personas per Pixel
- Max 3 FB Additional Profiles per FB account login
- Never log in from real-creator hardware (including desktop browsers signed into real-creator IG)
- One appeal max if flagged
- Daily proxy connectivity check
- Weekly shadowban test
- Beacons content-warning toggle stays ON

---

## Sources

- [Inro — Instagram rules for OF creators 2026](https://www.inro.social/blog/avoid-instagram-bans-onlyfans)
- [Sirency — Best link-in-bio for OF 2026](https://www.sirency.com/blog/best-link-in-bio-tools-onlyfans-2026)
- [Enforcity — Promoting OF on Instagram](https://www.enforcity.com/onlyfans-success/promoting-onlyfans-on-instagram)
- [Phoenix Creators — Does IG allow nudes?](https://www.phoenix-creators.com/onlyfans-blog/does-instagram-allow-nudes)
- [Phoenix Creators — Shadowban fix](https://www.phoenix-creators.com/onlyfans-blog/shadow-banned-on-instagram-how-to-fix-it)
- [ShadowPhone — IG warm-up 2026](https://www.shadowphone.io/blog/instagram-account-warm-up-guide-2026)
- [Multilogin — Warm up IG 2026](https://multilogin.com/blog/mobile/how-to-warm-up-instagram-account/)
- [Multilogin — vs GoLogin vs AdsPower 2026](https://multilogin.com/blog/multilogin-vs-gologin-vs-adspower/)
- [360Uniquizer — IG warmup 2026 day-by-day](https://360uniquizer.com/en/news/instagram-account-warmup-2026)
- [Coronium — IG mobile proxies 2026](https://www.coronium.io/mobile-proxies/instagram)
- [Coronium — VoidMob review](https://www.coronium.io/partners/sms-activation/voidmob-review)
- [VoidMob — Non-VoIP SMS 2026](https://voidmob.com/blog/best-non-voip-sms-verification-services-2026)
- [IPRoyal — Best IG proxies 2026](https://iproyal.com/blog/best-instagram-proxies/)
- [aimultiple — IG proxies 2026](https://aimultiple.com/instagram-proxies)
- [Pixelscan — Non-VoIP numbers 2026](https://pixelscan.net/blog/best-non-voip-numbers-for-sms-verification/)
- [Optimal.to — FB BM disabled 2026](https://optimal.to/facebook-business-manager-disabled/)
- [Send.win — FB BM multi-account 2026](https://blog.send.win/facebook-business-manager-multiple-accounts-multi-account-management-guide-2026/)
- [Octo Browser — Creating AI model for OF](https://blog.octobrowser.net/how-to-create-an-ai-model-for-onlyfans-and-start-earning)
- [Meta Transparency — Labeling AI content](https://transparency.meta.com/governance/tracking-impact/labeling-ai-content/)
- [AuditSocials — Meta AI label policy 2026](https://www.auditsocials.com/blog/meta-ai-generated-content-label-policy-2026)
- [EU AI Act Article 50](https://artificialintelligenceact.eu/article/50/)
- [HumanAds — FTC AI disclosure 2026](https://humanadsai.com/blog/ftc-ai-generated-content-disclosure)
- [aitechtonic — IG shadowban 2026](https://aitechtonic.com/instagram-shadowban-guide/)
- [SocialRails — IG bans/restrictions 2026](https://socialrails.com/blog/instagram-bans-and-restrictions-guide)
- [Post-Bridge — Appeal disabled IG](https://www.post-bridge.com/blog/instagram-disabled-account-appeal)
- [RecoverInstagramAccount — Appeal denied 2026](https://recoverinstagramaccount.com/blog/instagram-appeal-denied)
- [Stay Close Travel Far — IG bikini suppression](https://stayclosetravelfar.com/instagram-shadowban-bikini/)
