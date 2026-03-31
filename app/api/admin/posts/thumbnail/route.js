export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, patchAirtableRecord } from '@/lib/adminAuth'

async function getDropboxAccessToken() {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const form = await request.formData()
    const file = form.get('file')
    const postId = form.get('postId')

    if (!file || !postId) return NextResponse.json({ error: 'file and postId required' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const fileName = `thumbnail_${postId}_${Date.now()}.${file.name.split('.').pop()}`
    const dropboxPath = `/Palm Ops/Thumbnails/${fileName}`

    const token = await getDropboxAccessToken()

    // Upload to Dropbox
    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode: 'add',
          autorename: true,
        }),
      },
      body: buffer,
    })

    if (!uploadRes.ok) {
      const err = await uploadRes.text()
      throw new Error(`Dropbox upload failed: ${err}`)
    }

    // Get shared link
    const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: 'public' } }),
    })

    let sharedUrl
    if (linkRes.ok) {
      const linkData = await linkRes.json()
      sharedUrl = linkData.url?.replace('dl=0', 'raw=1')
    } else {
      const existRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dropboxPath }),
      })
      const existData = await existRes.json()
      sharedUrl = existData.links?.[0]?.url?.replace('dl=0', 'raw=1')
    }

    if (!sharedUrl) throw new Error('Could not get shared URL for thumbnail')

    // Save to Airtable Post record
    await patchAirtableRecord('Posts', postId, {
      'Thumbnail': [{ url: sharedUrl }],
    })

    return NextResponse.json({ ok: true, url: sharedUrl })
  } catch (err) {
    console.error('[Thumbnail Upload] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
