import { NextResponse } from 'next/server'
import { requireAdmin, fetchAirtableRecords, createAirtableRecord, patchAirtableRecord } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LINK_PAGES = 'Link Pages'
const PLATFORM_DIR = 'Creator Platform Directory'
const CREATORS = 'Palm Creators'

// GET            → { pages, creators }
// GET ?socials=<creatorId> → { socials:[{platform,url,label}] } prefill from
//                  the Creator Platform Directory.
export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const socialsFor = new URL(request.url).searchParams.get('socials')

    if (socialsFor) {
      // Pull existing social accounts for this creator (Platform + URL).
      const rows = await fetchAirtableRecords(PLATFORM_DIR, {
        fields: ['Creator', 'Platform', 'Handle/ Username', 'URL', 'Status', 'Account Type'],
      })
      const socials = rows
        .filter((r) => (r.fields?.Creator || []).includes(socialsFor) && r.fields?.URL)
        .map((r) => ({
          platform: r.fields.Platform || 'link',
          url: r.fields.URL,
          label: r.fields.Platform || (r.fields['Handle/ Username'] || 'Link'),
          accountType: r.fields['Account Type'] || '',
        }))
      return NextResponse.json({ socials })
    }

    const [pages, creators] = await Promise.all([
      fetchAirtableRecords(LINK_PAGES, {
        fields: ['Slug', 'Creator', 'Display Name', 'Custom Domain', 'Published', 'Avatar URL', 'Cover Image URL', 'Handle', 'Verified', 'Bio', 'Theme', 'Links'],
      }),
      fetchAirtableRecords(CREATORS, { fields: ['Creator', 'AKA'] }),
    ])
    return NextResponse.json({
      pages: pages.map((p) => ({
        id: p.id,
        slug: p.fields?.Slug || '',
        displayName: p.fields?.['Display Name'] || '',
        creatorId: (p.fields?.Creator || [])[0] || null,
        customDomain: p.fields?.['Custom Domain'] || '',
        published: !!p.fields?.Published,
        avatarUrl: p.fields?.['Avatar URL'] || '',
        coverImageUrl: p.fields?.['Cover Image URL'] || '',
        handle: p.fields?.Handle || '',
        verified: !!p.fields?.Verified,
        bio: p.fields?.Bio || '',
        theme: p.fields?.Theme || 'Dark',
        links: (() => { try { return JSON.parse(p.fields?.Links || '[]') } catch { return [] } })(),
      })),
      creators: creators
        .map((c) => ({ id: c.id, name: c.fields?.AKA || c.fields?.Creator || 'Unknown' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST — create or update a link page. Body: { id?, slug, creatorId, displayName,
// avatarUrl, bio, customDomain, published, theme, links:[{id,label,url,platform,gated}] }
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const b = await request.json()
    if (!b.slug || !/^[a-z0-9-]+$/i.test(b.slug)) {
      return NextResponse.json({ error: 'Slug required (letters, numbers, dashes only)' }, { status: 400 })
    }
    const links = Array.isArray(b.links)
      ? b.links.filter((l) => l && l.label).map((l, i) => ({
          id: l.id || `l${i}_${Math.abs(hash(l.label + i))}`,
          label: String(l.label).slice(0, 60),
          url: String(l.url || '').slice(0, 500),
          platform: String(l.platform || 'link').slice(0, 40),
          image: String(l.image || '').slice(0, 500),
          gated: !!l.gated,
          order: i,
        }))
      : []
    const fields = {
      Slug: String(b.slug).toLowerCase(),
      'Display Name': b.displayName || '',
      'Avatar URL': b.avatarUrl || '',
      'Cover Image URL': b.coverImageUrl || '',
      Handle: b.handle || '',
      Verified: !!b.verified,
      Bio: b.bio || '',
      'Custom Domain': (b.customDomain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      Published: !!b.published,
      Theme: b.theme === 'Light' ? 'Light' : 'Dark',
      Links: JSON.stringify(links),
    }
    if (b.creatorId) fields.Creator = [b.creatorId]

    const rec = b.id
      ? await patchAirtableRecord(LINK_PAGES, b.id, fields, { typecast: true })
      : await createAirtableRecord(LINK_PAGES, fields, { typecast: true })
    return NextResponse.json({ ok: true, id: rec.id || b.id })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 } return h }
