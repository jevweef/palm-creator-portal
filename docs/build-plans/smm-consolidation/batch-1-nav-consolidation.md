# Batch 1 — Sidebar additions + AI Content tab strip

**Status:** READY TO EXECUTE
**Branch:** `smm-consolidation` (off `dev`)
**Estimated time:** 6-9 hours (narrower than original synthesizer scope; rewritten 2026-05-27 after owner review)
**Airtable changes:** NONE
**Predecessor:** master-plan.md (read the "Scope correction" section at the top first)

## Goal

Add one new admin-only sidebar item (**Marketing Content**), relabel the existing `AI Source` sidebar entry to `AI Content`, and convert `/admin/recreate-source` into a 4-tab strip (Workflow / Setup / Warm-Up / Strategy) where Warm-Up and Strategy are placeholder cards until later batches. AI editor user role gets access to the same `/admin/recreate-source` page (their workflow tab) while keeping `/ai-editor` working as before for deep links and back-compat.

**What this batch does NOT do** (deferred or explicitly out of scope):
- No `/admin/smm` parent route.
- No structural changes to Editor sidebar item or its tabs (deferred to Batch 3 when post-prep automation lands).
- No archive of dead routes (`/admin/tonio`, `/sonnet-test`, `/creator/[id]/vault` left alone).
- No Inspo Board changes.
- No editor two-hop redirect fix.
- No bug-hunt for missing AI edits or hidden carousels (deferred at owner request).
- No refactor of the `/ai-editor` page's 1242-line workflow into a shared component — Batch 1's "Workflow" tab launches a new browser navigation to `/ai-editor` (placeholder behavior). A later batch can extract the shared component if the seam shows.

## Prerequisites

- [ ] Branch `smm-consolidation` exists off latest `dev`. Worktree at `.claude/worktrees/smm-consolidation` if using EnterWorktree.
- [ ] `npm install` clean (no lockfile drift).
- [ ] `next build` passes from clean checkout of `dev`.
- [ ] Read `master-plan.md` "Scope correction" section.

## Files to touch

Exhaustive list. If you find yourself editing a file not on this list, **stop and confirm**.

| File | Action | Why |
|---|---|---|
| `app/admin/layout.js` | Edit | Add `Marketing Content` to `ADMIN_NAV` (slot 3, between Inspo Board and AI Source). Rename `AI Source` label → `AI Content`. Flip `aiEditorAllowedPath` so ai_editor can reach `/admin/recreate-source` (currently hard-blocked at line ~84). |
| `app/admin/recreate-source/page.js` | Edit | Wrap existing content in a tab strip. 4 tabs: Workflow (default for ai_editor), Setup (default for admin — contains current page content), Warm-Up (placeholder), Strategy (placeholder). H1 changes from "AI Source" to "AI Content". |
| `app/admin/recreate-source/SetupTab.js` | **NEW** | Move current `/admin/recreate-source` page body into this tab component. |
| `app/admin/recreate-source/WorkflowTab.js` | **NEW** | Currently just renders a card with "Open AI Workflow →" button linking to `/ai-editor`. Future batch may merge `/ai-editor` content here. |
| `app/admin/recreate-source/WarmupTab.js` | **NEW** | Placeholder card: "Account Warm-Up — shipping in Batch 2. See `docs/build-plans/smm-consolidation/batch-2-warmup-flow.md`." |
| `app/admin/recreate-source/StrategyTab.js` | **NEW** | Placeholder card: "Content Strategy Engine — shipping in Batch 3. See `docs/build-plans/smm-consolidation/batch-3-content-strategy.md`." |
| `app/admin/marketing-content/page.js` | **NEW** | Admin dashboard hub. Cross-stream KPIs (counts via existing APIs), quick links to Editor / AI Content / Warm-Up / Publer / OFTV. |
| `app/admin/marketing-content/layout.js` | **NEW** | Thin `requireAdmin()` gate. |
| `components/Header.js` | Edit | Add "AI Content" link for `ai_editor` role pointing to `/admin/recreate-source?tab=workflow`. Keep existing `/ai-editor` link. |
| `app/api/admin/marketing-content/overview/route.js` | **NEW** | GET endpoint that returns counts: `aiPostsInFlight`, `realPostsInFlight`, `forReviewCount`, `warmupAccountsActive`, `todaysScheduledCount`. Read-only aggregation from existing tables. |

## Step-by-step build order

### Step 1 — Branch setup

```
cd /Users/jevanleith/palm-creator-portal
git checkout dev && git pull
git checkout -b smm-consolidation
```

If using worktree:
```
git worktree add ../palm-creator-portal-smm smm-consolidation
cd ../palm-creator-portal-smm
```

### Step 2 — `app/admin/layout.js` edits

In `ADMIN_NAV` array (around line 8-52):

1. Insert new entry at slot 3 (after Inspo Board, before the current `AI Source`):
   ```js
   { href: '/admin/marketing-content', label: 'Marketing Content', icon: '📱' },
   ```
2. Change the existing entry:
   ```js
   { href: '/admin/recreate-source', label: 'AI Source', icon: '🎞️' },
   ```
   to:
   ```js
   { href: '/admin/recreate-source', label: 'AI Content', icon: '🎨' },
   ```
3. Update the `aiEditorAllowedPath` logic around line 84:
   ```js
   // BEFORE
   const isAiEditor = role === 'ai_editor'
   const aiEditorAllowedPath = false

   // AFTER
   const isAiEditor = role === 'ai_editor'
   const aiEditorAllowedPath = pathname?.startsWith('/admin/recreate-source')
   ```
4. Update the AI editor `NAV_ITEMS` block to render a single-item nav when ai_editor lands inside `/admin/recreate-source`:
   ```js
   const NAV_ITEMS = (isAiEditor
       ? [{ href: '/admin/recreate-source?tab=workflow', label: 'AI Content', icon: '🎨' }]
       : isAdmin ? ADMIN_NAV : EDITOR_NAV)
     .filter(...)
   ```

### Step 3 — Convert `/admin/recreate-source/page.js` to a tab strip

The current file is the single AI Source page. Read it first to understand what's there.

1. **Extract current page body** into `app/admin/recreate-source/SetupTab.js`:
   - Move everything inside the current `export default function` body into a new exported component `SetupTab`.
   - The `'use client'` directive stays on the tab file.
   - All imports the page uses come along.

2. **Create the three other tab files** as small placeholders:
   - `WorkflowTab.js`:
     ```jsx
     'use client'
     export default function WorkflowTab() {
       return (
         <div style={{ padding: 24 }}>
           <h2>AI Workflow</h2>
           <p>Pick reels, run image-to-image in TJP, batch upload, and handle revisions.</p>
           <a
             href="/ai-editor"
             style={{
               display: 'inline-block',
               marginTop: 16,
               padding: '10px 18px',
               background: 'var(--palm-pink)',
               color: '#fff',
               borderRadius: 8,
               textDecoration: 'none',
               fontWeight: 600,
             }}
           >
             Open AI Workflow →
           </a>
           <p style={{ marginTop: 24, color: 'var(--foreground-muted)', fontSize: 12 }}>
             A future batch may inline this workflow directly into this tab. For now it opens
             the existing /ai-editor page.
           </p>
         </div>
       )
     }
     ```
   - `WarmupTab.js`:
     ```jsx
     'use client'
     export default function WarmupTab() {
       return (
         <div style={{ padding: 24 }}>
           <h2>Account Warm-Up</h2>
           <p>Per-account 90-day daily task lists for AI personas (Brielle, Lily, Katie Rosie).</p>
           <p style={{ color: 'var(--foreground-muted)', marginTop: 16 }}>
             Shipping in Batch 2. See <code>docs/build-plans/smm-consolidation/batch-2-warmup-flow.md</code>.
           </p>
         </div>
       )
     }
     ```
   - `StrategyTab.js`:
     ```jsx
     'use client'
     export default function StrategyTab() {
       return (
         <div style={{ padding: 24 }}>
           <h2>Content Strategy</h2>
           <p>"What's next for [creator]" engine — pillar rotation, caption picks, hashtag pools.</p>
           <p style={{ color: 'var(--foreground-muted)', marginTop: 16 }}>
             Shipping in Batch 3. See <code>docs/build-plans/smm-consolidation/batch-3-content-strategy.md</code>.
           </p>
         </div>
       )
     }
     ```

3. **Rewrite `app/admin/recreate-source/page.js`** as the tab strip wrapper:
   ```jsx
   'use client'
   import { useUser } from '@clerk/nextjs'
   import { useSearchParams, useRouter, usePathname } from 'next/navigation'
   import SetupTab from './SetupTab'
   import WorkflowTab from './WorkflowTab'
   import WarmupTab from './WarmupTab'
   import StrategyTab from './StrategyTab'

   const TABS = [
     { key: 'workflow', label: 'Workflow', roles: ['admin', 'super_admin', 'ai_editor'] },
     { key: 'setup',    label: 'Setup',    roles: ['admin', 'super_admin'] },
     { key: 'warmup',   label: 'Warm-Up',  roles: ['admin', 'super_admin'] },
     { key: 'strategy', label: 'Strategy', roles: ['admin', 'super_admin'] },
   ]

   export default function AiContentPage() {
     const { user } = useUser()
     const role = user?.publicMetadata?.role
     const isAiEditor = role === 'ai_editor'
     const searchParams = useSearchParams()
     const router = useRouter()
     const pathname = usePathname()

     const visibleTabs = TABS.filter(t => t.roles.includes(role))
     const defaultTab = isAiEditor ? 'workflow' : 'setup'
     const currentTab = searchParams.get('tab') || defaultTab
     const active = visibleTabs.find(t => t.key === currentTab) || visibleTabs[0]

     const goTab = (key) => router.replace(`${pathname}?tab=${key}`)

     return (
       <div>
         <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '14px 24px' }}>
           <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>AI Content</h1>
         </div>
         <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
           {visibleTabs.map(t => (
             <button
               key={t.key}
               onClick={() => goTab(t.key)}
               style={{
                 padding: '10px 16px',
                 background: 'transparent',
                 border: 'none',
                 borderBottom: `2px solid ${active.key === t.key ? 'var(--palm-pink)' : 'transparent'}`,
                 color: active.key === t.key ? 'var(--palm-pink)' : 'var(--foreground-muted)',
                 fontWeight: active.key === t.key ? 600 : 400,
                 cursor: 'pointer',
                 fontSize: 13,
               }}
             >
               {t.label}
             </button>
           ))}
         </div>
         <div>
           {active.key === 'workflow' && <WorkflowTab />}
           {active.key === 'setup'    && <SetupTab />}
           {active.key === 'warmup'   && <WarmupTab />}
           {active.key === 'strategy' && <StrategyTab />}
         </div>
       </div>
     )
   }
   ```

### Step 4 — Marketing Content hub

1. Create `app/admin/marketing-content/layout.js`:
   ```jsx
   import { requireAdmin } from '@/lib/adminAuth'

   export default async function Layout({ children }) {
     try { await requireAdmin() } catch (e) { return e }
     return <>{children}</>
   }
   ```

2. Create `app/admin/marketing-content/page.js` as a client component that fetches `/api/admin/marketing-content/overview` and renders:
   - Hero: today's date, brief "what to look at"
   - Tile row: 4 KPI tiles (AI in flight / Real in flight / Needs review / Active warm-ups)
   - Quick links: Editor For Review · AI Content · Account Warm-Up · Publer Mappings
   - "Coming soon" block listing future enhancements (reach trend, posted-this-week sparkline) when Phase 3 data exists

3. Create `app/api/admin/marketing-content/overview/route.js`:
   ```js
   export const dynamic = 'force-dynamic'
   import { NextResponse } from 'next/server'
   import { requireAdmin, fetchAirtableRecords } from '@/lib/adminAuth'

   export async function GET() {
     try { await requireAdmin() } catch (e) { return e }
     try {
       const [aiInFlight, realInFlight, needsReview, activeWarmups] = await Promise.all([
         fetchAirtableRecords('Posts', {
           filterByFormula: "AND({Publer Status}='Submitted', {Publer Status}!='')",
           fields: ['Status'],
         }).then(r => r.length).catch(() => 0),
         fetchAirtableRecords('Posts', {
           filterByFormula: "OR({Status}='Queued for Telegram',{Status}='Sending to Telegram')",
           fields: ['Status'],
         }).then(r => r.length).catch(() => 0),
         fetchAirtableRecords('Tasks', {
           filterByFormula: "AND({Status}='Done',{Admin Review Status}='Pending Review')",
           fields: ['Status'],
         }).then(r => r.length).catch(() => 0),
         // Warmup table doesn't exist yet — return 0 until Batch 2 ships
         Promise.resolve(0),
       ])
       return NextResponse.json({
         aiInFlight,
         realInFlight,
         needsReview,
         activeWarmups,
         asOf: new Date().toISOString(),
       })
     } catch (err) {
       return NextResponse.json({ error: err.message }, { status: 500 })
     }
   }
   ```

### Step 5 — `components/Header.js` ai_editor link

Find the section that renders the ai_editor header (search for `'ai_editor'` in the file). Add a new link "AI Content" pointing to `/admin/recreate-source?tab=workflow`. Keep the existing `/ai-editor` link in place — it's still the primary URL for ai_editor user-role landing during this transition.

Pattern roughly:
```jsx
{role === 'ai_editor' && (
  <>
    <Link href="/ai-editor">TJP Workspace</Link>
    <Link href="/admin/recreate-source?tab=workflow">AI Content</Link>
  </>
)}
```

(Adjust to match the file's actual JSX style — read first, then edit.)

### Step 6 — Build + smoke test

```
npm run build
```

Manual click-through (use multiple browser sessions or `view as` if available):
- **admin**: log in → sidebar shows 13 items with Marketing Content in slot 3 + AI Content (renamed). Click Marketing Content → hub loads with 4 KPI tiles. Click AI Content → land on Setup tab by default. Click Workflow tab → see the placeholder card with "Open AI Workflow" button. Click button → land on `/ai-editor`.
- **ai_editor**: log in → land on `/ai-editor` as before. Header now has "AI Content" link → click → land on `/admin/recreate-source?tab=workflow` (the new tab strip, single-tab visible since other tabs are admin-only) → see the placeholder workflow card.
- **editor**: log in → land on `/editor` as before. Header unchanged. No access to `/admin/marketing-content` (403 via layout's requireAdmin) and no access to `/admin/recreate-source` beyond what they had (which is none).
- **creator, chat_manager, social_media**: no changes — confirm with one click-through each.

## Airtable changes

**NONE.** Batch 1 is pure code.

## Sidebar tree — final (target state)

```
ADMIN SIDEBAR (13 items, was 12)
├── 📊  Dashboard                /admin/dashboard
├── 🎬  Inspo Board              /admin/inspo
├── 📱  Marketing Content        /admin/marketing-content     ← NEW
├── 🎨  AI Content               /admin/recreate-source       ← relabeled, tab strip added
├── ✂️  Editor                   /admin/editor
├── 🎭  Creators                 /admin/creators
├── 🐋  Whale Hunting            /admin/whale-hunting
├── 🖼️  Photo Library            /photo-library
├── 📅  Publer                   /admin/publer
├── 📋  Onboarding               /admin/onboarding
├── 💸  Invoicing                /admin/invoicing
├── 📥  Inbox                    /admin/inbox  (owner-only, unchanged)
└── ❓  Help                     /admin/help
```

Note: Marketing Content slots above AI Content because it's the admin's at-a-glance entry point — operator opens admin shell, sees the hub first.

## Test plan

For each role:

1. **admin** — visit `/admin/dashboard` (unchanged). Click new "Marketing Content" entry → land on hub. Verify 4 KPI tiles render (counts may be 0 — that's fine for now). Click "Editor For Review" quick link → navigates to `/admin/editor?tab=review`. Click "AI Content" sidebar → land on `/admin/recreate-source` with Setup tab active. Click Workflow tab → placeholder. Click Warm-Up tab → placeholder. Click Strategy tab → placeholder.

2. **ai_editor** — visit `/ai-editor` (unchanged). Header shows "AI Content" link → click → land on `/admin/recreate-source?tab=workflow` with admin shell sidebar showing single AI Content entry. Verify no other admin nav is visible. Try direct URL `/admin/dashboard` → bounced back.

3. **editor** — visit `/editor` (unchanged). Header unchanged. Direct URL `/admin/marketing-content` → forbidden (requireAdmin rejects).

4. **creator** — no changes — confirm `/creator/[id]/dashboard` still works.

5. **chat_manager** — no changes — confirm `/photo-library` still works.

6. **social_media** — confirm wherever they land today still works (likely `/admin/editor?tab=grid` per grid-planner usage).

Additional:
- `next build` clean, no missing-import warnings.
- `/admin/recreate-source` (the renamed page) still serves all existing deep links — paste any current bookmark and confirm the Setup tab is the default.
- Inspo Board, Creators, Whale Hunting, Onboarding, Invoicing, Inbox, Help, Publer — all untouched. Verify no incidental breakage by opening each once.

## Rollback procedure

```
git checkout dev
git branch -D smm-consolidation
```

Or if pushed:
```
git push origin :smm-consolidation
```

No Airtable changes to reverse.

## Estimated time

6-9 hours. Breakdown:
- Step 1-2 (branch + layout edits): 1h
- Step 3 (tab strip + 4 tab files): 2-3h
- Step 4 (Marketing Content hub + API): 2-3h
- Step 5 (Header.js edit): 30m
- Step 6 (build + 6-role click-through): 1-2h

## Success criteria

- [ ] `next build` passes from a clean checkout of the branch.
- [ ] Admin sees 13-item sidebar with Marketing Content in slot 3.
- [ ] Marketing Content hub loads with 4 KPI tiles (any values — including 0 — are acceptable, as long as no error).
- [ ] AI Content (renamed from AI Source) loads as a tab strip with 4 tabs. Setup tab is the default for admin and contains the original AI Source page body intact (no broken UI).
- [ ] ai_editor can click "AI Content" in their header and land inside the admin shell on the Workflow tab. Only one tab visible (Workflow). No access to admin-only tabs.
- [ ] ai_editor still has `/ai-editor` working as before — that URL is unchanged.
- [ ] No file outside the "Files to touch" list was modified.
- [ ] No Airtable interaction during the batch.
- [ ] Handoff doc `batch-1-handoff.md` exists, lists every file touched + rollback command.

## Open questions to surface to owner during Batch 1

(If any of these come up, STOP and ask.)

1. The Workflow tab is a placeholder linking to `/ai-editor`. Owner may prefer to inline the workflow directly in Batch 1 — that's a ~1242-line refactor and a separate decision. **Default: leave as placeholder; revisit after Batches 2-3 ship.**
2. The Marketing Content hub's "warmup accounts active" tile returns 0 until Batch 2 ships the Warmup table. Owner may want a "Setup pending — see Batch 2" tooltip on that tile.
3. Sidebar icon for Marketing Content: 📱 chosen for "marketing surface." Owner may prefer 📋 or 🎯.
