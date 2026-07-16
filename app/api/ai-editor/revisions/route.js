import { NextResponse } from 'next/server'
import { requireAdminOrAiEditor, fetchAirtableRecords } from '@/lib/adminAuth'
import { quoteAirtableString } from '@/lib/airtableFormula'

export const dynamic = 'force-dynamic'

// GET — the AI editor's pending revision work. Returns all Tasks where
// Admin Review Status='Needs Revision' AND the linked Asset is a
// Source Type='AI Generated' one (so we don't show human-editor
// revisions on the AI editor surface). Joined with admin feedback,
// screenshots, the original reel URL, and — when the Asset name is a
// slug — a back-link to the parent Stage B Output for re-running.
export async function GET(request) {
  try {
    await requireAdminOrAiEditor()
    const url = new URL(request.url)
    const creatorId = url.searchParams.get('creatorId')

    // 1. All open revision tasks. Cheap formula scan.
    const tasks = await fetchAirtableRecords('Tasks', {
      filterByFormula: `{Admin Review Status} = 'Needs Revision'`,
      fields: ['Name', 'Status', 'Admin Review Status', 'Admin Feedback', 'Admin Screenshots',
        'Revision History', 'Asset', 'Creator'],
    })
    if (!tasks.length) return NextResponse.json({ revisions: [] })

    // 2. Pull the linked Assets so we can filter to AI Generated only +
    //    surface reference reel URL, dropbox link, thumbnail.
    const assetIds = [...new Set(tasks.flatMap(t => (t.fields?.Asset || [])))]
    const assets = assetIds.length
      ? await fetchAirtableRecords('Assets', {
          filterByFormula: `OR(${assetIds.map(id => `RECORD_ID() = ${quoteAirtableString(id)}`).join(',')})`,
          fields: ['Asset Name', 'Source Type', 'Reference Source URL',
            'Dropbox Shared Link', 'Dropbox Path (Current)', 'Thumbnail', 'Pipeline Status',
            'Stream Raw ID', 'Stream Edit ID'],
        })
      : []
    const assetById = Object.fromEntries(assets.map(a => [a.id, a.fields || {}]))

    // 3. Look up Stage B parents when the slug pattern lets us — gives
    //    the editor a one-click path back to the original still.
    const slugRe = /^([A-Za-z]+)_R(\d{1,4})_S(\d{1,3})/
    const stageBOutputs = await fetchAirtableRecords('Stage B Outputs', {
      fields: ['Slug', 'Creator', 'Source Reel'],
    })
    const stageBBySlug = {}
    for (const s of stageBOutputs) {
      const sl = s.fields?.Slug
      if (sl) stageBBySlug[sl] = { id: s.id, reelId: (s.fields?.['Source Reel'] || [])[0] || null, creatorId: (s.fields?.Creator || [])[0] || null }
    }

    const list = tasks
      .map(t => {
        const aId = (t.fields?.Asset || [])[0]
        const af = aId ? assetById[aId] : null
        if (!af || af['Source Type'] !== 'AI Generated') return null
        const tCreator = (t.fields?.Creator || [])[0] || null
        if (creatorId && tCreator !== creatorId) return null

        // Pull the leading slug out of the asset/task name so we can
        // back-link to the parent still.
        const slugMatch = String(af['Asset Name'] || t.fields?.Name || '').match(slugRe)
        const slug = slugMatch ? slugMatch[0] : null
        const parent = slug ? (stageBBySlug[slug] || null) : null

        // Admin Screenshots is a multi-attachment.
        const screenshots = Array.isArray(t.fields?.['Admin Screenshots'])
          ? t.fields['Admin Screenshots'].map(s => s.url).filter(Boolean)
          : []
        let history = []
        try { history = JSON.parse(t.fields?.['Revision History'] || '[]') } catch {}

        const thumb = Array.isArray(af.Thumbnail) && af.Thumbnail[0]
          ? (af.Thumbnail[0].thumbnails?.large?.url || af.Thumbnail[0].url)
          : null

        return {
          taskId: t.id,
          assetId: aId,
          name: af['Asset Name'] || t.fields?.Name || '',
          slug,
          creatorId: tCreator,
          adminFeedback: t.fields?.['Admin Feedback'] || '',
          adminScreenshots: screenshots,
          revisionHistory: history,
          referenceReelUrl: af['Reference Source URL'] || '',
          dropboxLink: af['Dropbox Shared Link'] || '',
          dropboxPath: af['Dropbox Path (Current)'] || '',
          thumbnail: thumb,
          // For playback: prefer the raw upload on CF Stream, fall back to the
          // edited stream, then the Dropbox raw URL in the client.
          streamUid: af['Stream Raw ID'] || af['Stream Edit ID'] || null,
          stageBParent: parent ? {
            id: parent.id,
            slug,
            reelRecordId: parent.reelId,
            creatorId: parent.creatorId,
          } : null,
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.slug || '').localeCompare(b.slug || ''))

    return NextResponse.json({ revisions: list })
  } catch (err) {
    if (err instanceof Response) return err
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
