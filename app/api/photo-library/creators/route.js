export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAdminOrChatManager, fetchAirtableRecords } from '@/lib/adminAuth'

const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif']
const IMAGE_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)/i

const getLinkedIds = (val) => (val || []).map(c => typeof c === 'string' ? c : c?.id).filter(Boolean)
const getSelectName = (val) => (typeof val === 'string' ? val : val?.name || '').toLowerCase()

function isImageAsset(fields) {
  const ext = (fields['File Extension'] || '').toLowerCase()
  const link = fields['Dropbox Shared Link'] || ''
  const type = getSelectName(fields['Asset Type'])
  return IMAGE_EXTS.includes(ext) || IMAGE_RE.test(link) || type === 'photo' || type === 'image'
}

// GET /api/photo-library/creators
//
// Returns active Palm Creators (Ops) joined with Chat Team from HQ Creators.
//
// Scoping rules:
//   - Real chat managers (role === 'chat_manager') are auto-scoped to the
//     team in their publicMetadata.chatTeam ("A" | "B").
//   - Admins see everyone by default (handy for spot-checking both teams).
//   - Admins can pass ?viewAsUserId=<clerkUserId> to impersonate a specific
//     chat manager — page behaves exactly as that user would see it. We
//     fetch that user's chatTeam from Clerk and apply identical scoping;
//     the response's `viewer` block reports isRealChatManager=true so the
//     UI hides the team filter and shows the "Showing your assigned
//     creators" banner.
export async function GET(request) {
  let user
  try {
    user = await requireAdminOrChatManager()
  } catch (e) {
    return e
  }

  const role = user?.publicMetadata?.role
  const realChatManager = role === 'chat_manager'
  const isAdmin = role === 'admin' || role === 'super_admin'

  // Default scope: caller's own metadata.
  let isRealChatManager = realChatManager
  let userTeam = (user?.publicMetadata?.chatTeam || '').toString().toUpperCase()

  // Admin "view as specific chat manager" override.
  const { searchParams } = new URL(request.url)
  const viewAsUserId = isAdmin ? searchParams.get('viewAsUserId') : null
  if (viewAsUserId) {
    try {
      const client = await clerkClient()
      const target = await client.users.getUser(viewAsUserId)
      const targetRole = target?.publicMetadata?.role
      const targetTeam = (target?.publicMetadata?.chatTeam || '').toString().toUpperCase()
      if (targetRole === 'chat_manager') {
        isRealChatManager = true
        userTeam = targetTeam
      }
      // If the target isn't actually a chat_manager, we silently fall back
      // to the admin's full view rather than 500-ing.
    } catch (err) {
      console.warn('[chat-wall/creators] viewAsUserId lookup failed:', err.message)
    }
  }

  try {
    // Active Ops creators + photo counts in parallel. Photo count is needed
    // so we can hide creators with 0 photos from the picker — chat manager
    // shouldn't see empty buttons.
    const [opsRecords, photoAssets] = await Promise.all([
      fetchAirtableRecords('Palm Creators', {
        filterByFormula: `OR({Status} = 'Active', {Status} = 'Onboarding')`,
        fields: ['Creator', 'AKA', 'Status', 'HQ Record ID'],
        sort: [{ field: 'Creator', direction: 'asc' }],
      }),
      fetchAirtableRecords('Assets', {
        filterByFormula: `AND(NOT({Dropbox Shared Link}=''),OR({Asset Type}='Photo',{Asset Type}='Image',{Asset Type}=BLANK()))`,
        fields: ['Palm Creators', 'Asset Type', 'File Extension', 'Dropbox Shared Link'],
      }),
    ])

    // Tally photos per creator. Filter out non-image assets (e.g. PDFs that
    // slipped through the Asset Type narrowing).
    const photoCountByCreator = {}
    for (const a of photoAssets) {
      if (!isImageAsset(a.fields || {})) continue
      for (const cId of getLinkedIds(a.fields?.['Palm Creators'])) {
        photoCountByCreator[cId] = (photoCountByCreator[cId] || 0) + 1
      }
    }

    const creators = opsRecords.map(r => ({
      id: r.id,
      hqId: r.fields?.['HQ Record ID'] || null,
      name: r.fields?.Creator || '',
      aka: r.fields?.AKA || '',
      status: typeof r.fields?.Status === 'string' ? r.fields.Status : (r.fields?.Status?.name || ''),
      chatTeam: null,
      photoCount: photoCountByCreator[r.id] || 0,
    }))

    // Pull Chat Team for each from HQ
    const hqIds = creators.map(c => c.hqId).filter(Boolean)
    if (hqIds.length > 0) {
      const headers = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }
      const params = new URLSearchParams()
      params.set('returnFieldsByFieldId', 'true')
      params.append('fields[]', 'fld4wToCuDZmVmFHb') // Chat Team
      hqIds.forEach(id => params.append('recordIds[]', id))
      const res = await fetch(`https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS}?${params}`, { headers, cache: 'no-store' })
      const data = await res.json()
      const map = {}
      for (const rec of (data.records || [])) {
        const v = rec.fields?.['fld4wToCuDZmVmFHb']
        map[rec.id] = typeof v === 'string' ? v : (v?.name || null)
      }
      for (const c of creators) {
        c.chatTeam = c.hqId ? (map[c.hqId] || null) : null
      }
    }

    // Hide creators with 0 photos — empty buttons confuse the chat manager.
    // Their record stays visible everywhere else; this is just a UX filter
    // on the chat-wall picker.
    const withPhotos = creators.filter(c => c.photoCount > 0)

    // Real chat managers only see creators on their team. If their metadata
    // is missing chatTeam, they see no creators (fail closed) — admin must
    // set it in Clerk before they can use the page.
    let scopedCreators = withPhotos
    if (isRealChatManager) {
      if (!userTeam) {
        scopedCreators = []
      } else {
        scopedCreators = withPhotos.filter(c => (c.chatTeam || '').toUpperCase().startsWith(userTeam))
      }
    }

    return NextResponse.json({
      creators: scopedCreators,
      // Echo the caller's role + assigned team so the UI can decide whether
      // to render the team-filter pills (admin previewing) or hide them
      // (real chat manager — already scoped server-side).
      viewer: {
        role: role || null,
        chatTeam: userTeam || null,
        // True when the request is being scoped as a chat_manager — either
        // the caller is one, OR an admin is impersonating one via
        // viewAsUserId. The page hides the team filter in either case.
        isRealChatManager,
        // Tells the page it's currently impersonating, so it can show a
        // banner like "Viewing as Val (Team B)" instead of just the team.
        impersonatingUserId: viewAsUserId || null,
      },
    })
  } catch (err) {
    console.error('[chat-wall/creators] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
