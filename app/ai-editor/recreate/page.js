'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { ModalHost, OutfitSwapPanel, StageBPanel } from '@/components/recreate/panels'
import { GuidedTour, TourTriggerButton } from '@/components/recreate/tour'

const TABS = [
  { key: 'stageb', label: 'Stage B' },
  { key: 'outfit', label: 'Outfit Swap' },
]

// Tour for the Stage B workflow. We anchor to elements inside the
// shared panel (#tour-stageb-creator, etc.) so missing-element steps
// degrade gracefully if the user lands on the Outfit Swap tab first.
const STAGEB_TOUR_STEPS = [
  {
    placement: 'center',
    title: '🎨 Stage B — the expensive anchor',
    body: `Stage B composites your creator into her room with an inspo reel's pose. It's the slowest, most expensive step (~3–6 min per still) — so once it looks right, you'll fan out cheaply with outfits.

The slug you'll see (e.g. Amelia_R042_S01) travels with this work all the way to admin review, so any rejection traces straight back here.`,
  },
  {
    target: '#tour-stageb-creator',
    placement: 'bottom',
    title: 'Creator',
    body: `Pick the creator. The system tells you how many AI Super Clone face/front/back refs are on file (more = better identity match), and auto-picks one of her rooms to match the reel's framing.

⚠️ If she has no rooms yet, you'll see a warning — create one in the Rooms tab first.`,
  },
  {
    target: '#tour-stageb-mode',
    placement: 'bottom',
    title: 'Standard vs Subject mode',
    body: `Standard — start from an inspo reel (the usual path).

Subject — you already have a finished TJP photo of your creator and just want the background swapped to a different room. Skips the reel grid + identity-ref steps entirely.`,
  },
  {
    target: '#tour-stageb-reels',
    placement: 'top',
    title: 'Pick a reel & scrub the pose',
    body: `Each tile is one inspo reel for this creator (already-produced reels are hidden). Click one → a scrub modal opens.

In the modal: scrub to the exact pose you want, then Capture. The system reads the framing (full-body / cropped / tight) and matches it to the right room angle automatically.`,
  },
  {
    target: '#tour-stageb-generate',
    placement: 'top',
    title: 'Generate',
    body: `Click 👤 Generate. WaveSpeed runs the composite (~3–6 min). You can navigate away — generation continues server-side and the result lands in the gallery below automatically.

Default model is Wan 2.7 (recommended). Nano-Banana sometimes hits an adult-content filter; GPT-Image-2 is experimental.`,
  },
  {
    target: '#stageb-outputs',
    placement: 'top',
    title: 'Outputs gallery — approve & fan out',
    body: `Generated stills land here. Approve ✓ keepers, reject ✕ misses (reason saved for tuning).

Once a still is Approved, click 👗 Fan out outfits to spawn multiple outfit variants of the same pose. Or use 👗 Fan out across all N approved at the top to bulk-spread outfits across every approved still.

When you're ready for TJP: ⬇ Bulk ZIP on each still, or ⬇ Download all (1 mega-ZIP) for the whole day.`,
  },
  {
    placement: 'center',
    title: '🚚 To TJP and back',
    body: `Your TJP workflow:

1. Unzip a mega-ZIP locally — each subfolder has a still, the source reel, and the outfit variant images, plus a manifest.txt explaining which slug = which outfit.
2. In TJP: pair each still with the reel for motion control. Output one mp4 per outfit variant.
3. Name the output files with the slug (e.g. Amelia_R042_S01_O03.mp4) — that's how Batch Upload knows where each one belongs.
4. Back on /ai-editor → 📦 Batch Upload — drop them all in.`,
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
  const tabParam = sp.get('tab')
  const tab = tabParam === 'outfit' ? 'outfit' : 'stageb'
  const initialCreatorId = sp.get('creator') || undefined
  const initialReelRecordId = sp.get('reel') || undefined
  const setTab = (k) => router.replace(`${pathname}?tab=${k}`, { scroll: false })

  return (
    <div style={{ minHeight: 'calc(100vh - 49px)', background: 'var(--background)', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 32px)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <a href="/ai-editor" style={{ fontSize: 12, color: 'var(--foreground-muted)', textDecoration: 'none' }}>← AI Recreate Pool</a>
          {tab === 'stageb' && <TourTriggerButton storageKey="ai-editor-stageb-v1" label="? Guide" />}
        </div>
        <TabBar tab={tab} setTab={setTab} />
        {tab === 'stageb'
          ? <StageBPanel initialCreatorId={initialCreatorId} initialReelRecordId={initialReelRecordId} />
          : <OutfitSwapPanel />}
        <ModalHost />
        {tab === 'stageb' && <GuidedTour steps={STAGEB_TOUR_STEPS} storageKey="ai-editor-stageb-v1" />}
      </div>
    </div>
  )
}
