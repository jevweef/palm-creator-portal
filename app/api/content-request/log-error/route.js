import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const OPS_BASE = 'applLIT2t83plMqNx'
const UPLOAD_ERRORS = 'tblb5Ew0VClg9X3Lw' // Portal Upload Errors

// Client-side upload failures happen on the CREATOR'S phone — without this
// endpoint they vanish unless the creator screenshots them. The upload modal
// fire-and-forgets a report here on any failure; we stamp who/what/where and
// keep it in Airtable so failures are visible and fixable. Never throws back
// to the client — logging must not break the upload UI.
export async function POST(request) {
  try {
    const { userId } = auth()
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { error, details, section, fileName, fileSize, stage, creatorHqId, page } = body

    const user = await currentUser().catch(() => null)
    const creatorName =
      user?.publicMetadata?.creatorName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      user?.emailAddresses?.[0]?.emailAddress ||
      userId

    // Always in the server logs too (Vercel runtime logs, greppable).
    console.error('[content-request upload error]', JSON.stringify({
      creatorName, creatorHqId, section, fileName, fileSize, stage, error,
    }))

    await fetch(`https://api.airtable.com/v0/${OPS_BASE}/${UPLOAD_ERRORS}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        records: [{
          fields: {
            'Error': String(error || 'Unknown error').slice(0, 250),
            'Details': String(details || '').slice(0, 5000),
            'Creator': String(creatorName).slice(0, 250),
            'Creator HQ ID': String(creatorHqId || ''),
            'Section': String(section || ''),
            'File Name': String(fileName || '').slice(0, 250),
            'File Size': Number(fileSize) || 0,
            'Stage': ['token', 'upload', 'metadata'].includes(stage) ? stage : 'other',
            'User Agent': String(request.headers.get('user-agent') || '').slice(0, 250),
            'Page': String(page || '').slice(0, 250),
            'Reported At': new Date().toISOString(),
          },
        }],
      }),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    // Logging must never surface an error of its own.
    console.error('[log-error] failed:', err.message)
    return NextResponse.json({ ok: false })
  }
}
