'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { ModalHost, StageBPanel } from '@/components/recreate/panels'
import { GuidedTour, TourTriggerButton } from '@/components/recreate/tour'

// Single-tab page now — Outfit Swap was retired (TJP handles outfit
// transfer natively, so the WaveSpeed swap path was redundant).
const TABS = [
  { key: 'stageb', label: 'Create Scene' },
]

// Tour for the Create Scene workflow. The portal does ONE generation
// step now (background swap into the creator's saved room); the rest
// of the work (composite, outfit transfer, motion) happens in TJP.
const STAGEB_TOUR_STEPS = [
  {
    placement: 'center',
    title: '🎨 Create Scene — what this page does',
    body: `One job: take a TJP photo of your creator (already in the reel's pose & outfit but in the reel's original environment) and swap her background to her saved room.

Everything else — the initial face/body composite, outfit transfer, motion control — happens in TJP off-site. This page exists to organize your work and produce the clean "creator in HER room" still that TJP then animates.

Each scene gets a name like "Amelia_R042_S01" that follows the work from here through admin review.`,
  },
  {
    target: '#tour-stageb-creator',
    placement: 'bottom',
    title: 'Step 1 · Pick the creator',
    body: `The portal auto-picks one of her saved rooms based on the framing of the photo you upload — wide shot → her wide room, tight shot → her tight room.

⚠️ If she has no rooms set up, an admin needs to create one in the Rooms tab first.`,
  },
  {
    target: '#tour-stageb-reels',
    placement: 'top',
    title: 'Step 2 · Pick the inspo reel',
    body: `Click the reel this scene goes with. Anything already produced for this creator is hidden.

This is mostly for tracking — the reel video becomes part of the bundle you download for TJP later (so TJP has the motion source).`,
  },
  {
    placement: 'center',
    title: 'Steps 3 + 4 · Optional uploads',
    body: `Two optional file slots after step 2 — Raw Screenshot and Upscaled Screenshot. Skip if you don't care about archival; they don't change the result.

The point is just to attach the TJP intermediate files to this project record so you can find them later (instead of digging through TJP).`,
  },
  {
    target: '#tour-stageb-subject',
    placement: 'top',
    title: 'Step 5 · TJP photo (the one upload that matters)',
    body: `This is the only upload the portal actually uses to generate. It's the TJP image-to-image output: your creator in the reel's pose & outfit, in the reel's original environment.

The portal will keep her exactly as-is and just swap the background.`,
  },
  {
    target: '#tour-stageb-generate',
    placement: 'top',
    title: 'Step 6 · Generate',
    body: `Click 🪄 Generate scene. Takes about 3–6 minutes. You can navigate away — the result shows up automatically in the Scenes gallery below.`,
  },
  {
    target: '#stageb-outputs',
    placement: 'top',
    title: 'Scenes gallery — approve & download',
    body: `Each finished scene lands here.

✓ approves a keeper. Approved scenes get the ⬇ ZIP for TJP button.
✕ rejects a miss — you can leave a reason, which helps tune the system.

⬇ Download all approved gives you one mega-ZIP of every approved scene + its reel, for batch processing in TJP.`,
  },
  {
    placement: 'center',
    title: '🚚 To TJP and back',
    body: `1. Unzip the bundle. Each subfolder has the scene + its inspo reel + a manifest.txt.
2. In TJP: do outfit transfer (with your outfit reference images) and motion control. You'll end up with finished mp4s.
3. Name each finished video to match its scene (e.g. Amelia_R042_S01.mp4) so the portal knows where to put it.
4. Back on AI Recreate Pool → 📦 Batch Upload — drop them all in at once.`,
  },
]


function TabBar({ tab, setTab }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 }}>
      {TABS.map(t => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          style={{
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: tab === t.key ? 'var(--foreground)' : 'var(--foreground-muted)',
            background: 'none',
            border: 'none',
            borderBottom: tab === t.key ? '2px solid var(--palm-pink)' : '2px solid transparent',
            cursor: 'pointer',
            marginBottom: -1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function AiEditorRecreatePage() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = 'stageb' // only one tab now — single source of truth
  const initialCreatorId = sp.get('creator') || undefined
  const initialReelRecordId = sp.get('reel') || undefined
  const setTab = () => {} // no-op: single tab, kept so TabBar API stays the same

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 32px)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <a href="/ai-editor" style={{ fontSize: 12, color: 'var(--foreground-muted)', textDecoration: 'none' }}>← AI Recreate Pool</a>
          <TourTriggerButton storageKey="ai-editor-stageb-v4" label="? Guide" />
        </div>
        <TabBar tab={tab} setTab={setTab} />
        <StageBPanel initialCreatorId={initialCreatorId} initialReelRecordId={initialReelRecordId} />
        <ModalHost />
        <GuidedTour steps={STAGEB_TOUR_STEPS} storageKey="ai-editor-stageb-v4" />
      </div>
    </div>
  )
}
