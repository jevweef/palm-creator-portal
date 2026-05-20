'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { ModalHost, OutfitSwapPanel, StageBPanel } from '@/components/recreate/panels'
import { GuidedTour, TourTriggerButton } from '@/components/recreate/tour'

const TABS = [
  { key: 'stageb', label: 'Create Scene' },
  { key: 'outfit', label: 'Outfit Swap' },
]

// Tour for the Stage B workflow. We anchor to elements inside the
// shared panel (#tour-stageb-creator, etc.) so missing-element steps
// degrade gracefully if the user lands on the Outfit Swap tab first.
const STAGEB_TOUR_STEPS = [
  {
    placement: 'center',
    title: '🎨 Create Scene — the big slow step',
    body: `This step puts your creator into her room, posed exactly like an inspo reel. It's the slowest part of the whole process (about 3–6 minutes per scene) and the most important one — once the scene looks right, everything downstream (outfits, motion control) is fast and cheap on top of it.

Each scene gets a name like "Amelia_R042_S01" that follows it everywhere. If admin rejects the final video, you can trace it straight back to the scene it came from by name.`,
  },
  {
    target: '#tour-stageb-creator',
    placement: 'bottom',
    title: 'Creator',
    body: `Pick the creator. The system shows you how many face/front/back reference photos she has on file — more reference photos = a better likeness match. It also auto-picks one of her rooms based on the framing of whatever pose you choose.

⚠️ If she has no rooms set up yet, you'll see a warning — an admin needs to create one in the Rooms tab first.`,
  },
  {
    target: '#tour-stageb-mode',
    placement: 'bottom',
    title: 'Two ways to make a scene',
    body: `Start from an inspo reel — the normal path. You'll pick a reel, scrub to the exact pose, and the system places your creator there.

I already have a photo of her — for when you already have a finished image of the creator from TJP and just want to drop her into a different room. Skips the reel and reference-photo steps entirely.`,
  },
  {
    target: '#tour-stageb-reels',
    placement: 'top',
    title: 'Pick a reel & scrub the pose',
    body: `Each tile is one inspo reel for this creator (anything she's already used is hidden). Click one and a scrubbing window opens.

In that window: drag the slider to the exact pose you want, then click Capture. The system reads how tight or wide the framing is, and automatically picks the room angle that matches.`,
  },
  {
    target: '#tour-stageb-generate',
    placement: 'top',
    title: 'Generate the scene',
    body: `Click 👤 Generate. The AI takes about 3–6 minutes. You can navigate away — it keeps running in the background and the result shows up in the gallery below as soon as it's done.

Default model is Wan (recommended — best results for this). The other two options exist for experimenting; usually leave Wan selected.`,
  },
  {
    target: '#stageb-outputs',
    placement: 'top',
    title: 'Scenes gallery — approve & bundle outfits',
    body: `Each finished scene appears here. ✓ to approve the keepers, ✕ to reject the misses (you can leave a reason — it helps us tune the system).

Once a scene is Approved, click 👗 Fan out outfits to pair it with multiple outfit photos. Or use 👗 Fan out across all approved at the top to bundle the same set of outfits with every approved scene in one click.

When you're ready: ⬇ Bulk ZIP per scene, or ⬇ Download all to grab the whole day's work in one archive.`,
  },
  {
    placement: 'center',
    title: '🚚 To TJP and back',
    body: `Your TJP workflow:

1. Unzip the bundle. Each subfolder has the scene, the inspo reel, the outfit reference photos, and a manifest.txt explaining what's what.
2. In TJP: do the outfit transfer + motion control. You'll end up with one finished mp4 per (scene × outfit) combination.
3. Name the finished videos to match the scene + outfit (e.g. Amelia_R042_S01_O03.mp4) so the system knows where each one belongs.
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
          {tab === 'stageb' && <TourTriggerButton storageKey="ai-editor-stageb-v2" label="? Guide" />}
        </div>
        <TabBar tab={tab} setTab={setTab} />
        {tab === 'stageb'
          ? <StageBPanel initialCreatorId={initialCreatorId} initialReelRecordId={initialReelRecordId} />
          : <OutfitSwapPanel />}
        <ModalHost />
        {tab === 'stageb' && <GuidedTour steps={STAGEB_TOUR_STEPS} storageKey="ai-editor-stageb-v2" />}
      </div>
    </div>
  )
}
