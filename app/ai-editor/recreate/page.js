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
    title: '🎨 Create Scene — the one generation step',
    body: `The portal does one piece of the workflow: takes a TJP photo of your creator (already in the inspo reel's pose & outfit, but still in the reel's environment) and swaps the background to her saved room. About 3–6 minutes per scene.

Everything else — the initial face/body composite, the outfit transfer, the motion control — happens in TJP off-site. The portal's job is to keep everything organized and produce the final still that TJP then animates.

Each scene gets a name like "Amelia_R042_S01" that follows it everywhere.`,
  },
  {
    target: '#tour-stageb-creator',
    placement: 'bottom',
    title: '1 · Creator',
    body: `Pick the creator. The portal will auto-pick one of her saved rooms based on the framing of the photo you upload.

⚠️ If she has no rooms set up yet, an admin needs to create one in the Rooms tab first.`,
  },
  {
    target: '#tour-stageb-reels',
    placement: 'top',
    title: '2 · Pick the inspo reel',
    body: `Each tile is one inspo reel available for this creator (anything she's already used is hidden). Click one to mark it as this scene's source reel.

This is just for tracking — the reel becomes part of the bundle when you download for TJP later (so TJP has the motion source).`,
  },
  {
    placement: 'center',
    title: '3, 4 · Upload your TJP files (optional organization)',
    body: `Between steps 2 and 5 you'll see two optional upload slots — Raw Screenshot and Upscaled Screenshot. These are for keeping the TJP intermediate files attached to the project record so you can find them later. Skip them if you don't care about archival; they're not needed to generate.`,
  },
  {
    target: '#tour-stageb-subject',
    placement: 'top',
    title: '5 · Upload the TJP image-to-image output',
    body: `This one IS required — it's the photo the portal will keep as-is and just swap her background.

It's the TJP output where your creator is already in the reel's pose & outfit (still in the reel's environment). The portal places her into her saved room and relights.`,
  },
  {
    target: '#tour-stageb-generate',
    placement: 'top',
    title: '6 · Generate the scene',
    body: `Click 🪄 Generate scene. Takes about 3–6 minutes — you can navigate away. The result shows up in the Scenes gallery below as soon as it's done.`,
  },
  {
    target: '#stageb-outputs',
    placement: 'top',
    title: 'Scenes gallery — approve & download',
    body: `Each finished scene lands here. ✓ to approve the keepers, ✕ to reject the misses (you can leave a reason — it helps us tune the system).

Once approved: ⬇ ZIP for TJP gives you the scene + reel for motion control. ⬇ Download all approved bundles everything for the day in one archive.`,
  },
  {
    placement: 'center',
    title: '🚚 To TJP and back',
    body: `Your TJP workflow:

1. Unzip the bundle. Each subfolder has the scene + the inspo reel + a manifest.txt.
2. In TJP: do outfit transfer (with your outfit reference images) and motion control. You'll end up with finished mp4s.
3. Name each finished video to match the scene it came from (e.g. Amelia_R042_S01_O03.mp4) so the system knows where to put it.
4. Come back to AI Recreate Pool → 📦 Batch Upload — drop them all in at once.`,
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
          <TourTriggerButton storageKey="ai-editor-stageb-v3" label="? Guide" />
        </div>
        <TabBar tab={tab} setTab={setTab} />
        <StageBPanel initialCreatorId={initialCreatorId} initialReelRecordId={initialReelRecordId} />
        <ModalHost />
        <GuidedTour steps={STAGEB_TOUR_STEPS} storageKey="ai-editor-stageb-v3" />
      </div>
    </div>
  )
}
