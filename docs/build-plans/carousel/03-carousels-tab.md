# Step 3 — Carousels tab in `/admin/editor`

## Goal
A new tab in the Admin Editor where admin assembles carousel posts from photos in the library, then submits them to the Ready-to-Go queue.

## Prereq reads
- `gotchas.md` (especially the React Hooks rule — this is a hooks-heavy component)
- `app/admin/editor/page.js` — the existing tab structure (tabs are defined ~line 2628; reuse the same pattern)
- `app/api/admin/photos/library/route.js` — the GET endpoint you'll call. Returns photos with: `id, sourceType, sourceHandle, sourcePostUrl, carouselIndex, carouselTotal, image, cdnUrl, creator, status, outfitType, isOutfit, caption, postedAt, ...`
- `app/api/admin/posts/carousel/route.js` — the POST endpoint you'll call to submit. Accepts `{ creatorIds: [recXXX], assetIds: [recAAA, recBBB, ...], caption?, hashtags? }`. Verify it sets `Type='Carousel'` and `Status='Ready to Go'` on the created Post — if not, patch the route.

## UI spec

Add a new tab key `'carousels'` next to existing tabs. Label: `📸 Carousels`. Position: between **For Review** and **Post Prep** (it sits in the assembly workflow).

### Layout (single page, three columns at md+, stacked on mobile)

**Top bar (full width):**
- Creator picker (single-select dropdown) — required, controls everything below
- Source filter pills: `All` `Scraped IG` `AI Generated` `Creator Upload` `Pinterest`
- Search input (filters by `sourceHandle`, `caption`, or filename — client-side substring match)

**Left column (~60% width on desktop): Photo browser**
- Grid of cards. Lazy-load if there are >100.
- **Scraped IG photos are grouped by `sourcePostUrl`** into a single "carousel pack" card. The card shows:
  - The first photo as cover, with a "📸 N" badge in the corner
  - `@{sourceHandle}` + relative posted date
  - Click → expands inline to show all N photos in order; "Add all" button + each can be individually clicked
- **AI Generated / Creator Upload / Pinterest photos** appear as individual tiles. No grouping.
- Each tile has a Source Type chip in the corner (color-coded matching the Airtable choice colors).
- Already-in-tray photos show a checkmark overlay.

**Right column (~40% width): Selection tray (sticky)**
- Title: "Carousel post" + slide count "(3/10)"
- Ordered list of selected photos as thumbnails. Drag to reorder. ✕ to drop.
- Max 10 (Instagram's cap). When at 10, hide "Add" CTAs / show disabled state with tooltip.
- Caption textarea (optional, placeholder: "Caption (optional — you can fill this in later)")
- Submit button: `Submit to Queue`. Disabled if `selected.length < 1` or no creator picked.
- After successful submit: clear tray, show toast "Carousel submitted to queue", refresh browser (so the just-used photos show "used" state if you choose to add that later).

### State shape (React)
```js
const [creatorId, setCreatorId] = useState(null)
const [sourceFilter, setSourceFilter] = useState('all')
const [searchQ, setSearchQ] = useState('')
const [photos, setPhotos] = useState([])           // from /api/admin/photos/library
const [loading, setLoading] = useState(false)
const [tray, setTray] = useState([])                // array of photo objects in order
const [caption, setCaption] = useState('')
const [submitting, setSubmitting] = useState(false)
```

### Data fetch
- On mount + when `creatorId` changes: `GET /api/admin/photos/library?creatorId={creatorId}` (verify the endpoint supports that query param; if not, fetch all and filter client-side)
- Cache for 60s in sessionStorage to avoid re-fetching when switching tabs

### Submit
```js
const res = await fetch('/api/admin/posts/carousel', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    creatorIds: [creatorId],
    assetIds: tray.map(p => p.id),
    caption: caption.trim() || undefined,
  })
})
```

Then handle response → toast → clear tray.

## Gotchas
- **React Hooks rule**: All hooks at the top, before any `if (loading) return ...` or similar
- The `photos[].id` field is the Photo record ID. The `posts/carousel` endpoint expects these as Asset IDs in the linked field — verify the endpoint already handles this conversion or passes them through to a `Photos`-linked field on Posts (look at the route, don't guess)
- Photos table and Assets table are separate. Confirm whether a carousel Post links to **Photos** records or to **Assets** records. Look at `app/api/admin/posts/carousel/route.js` and adapt the UI to send the right kind of IDs.

## Verify before next step
- Manually create a carousel of 3 photos via the new UI for a test creator
- Open Airtable: confirm a new Posts row exists with `Type=Carousel, Status=Ready to Go`, the Asset (or Photos) field has the 3 records linked in order, caption present if set
- Push to dev, verify on Vercel preview URL with the real browser
