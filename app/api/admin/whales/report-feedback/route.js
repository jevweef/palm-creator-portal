import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { resolveChatTeamScope } from '@/lib/chatTeamScope'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FB_PATH = '/Palm Ops/Whale Intel/feedback.json'

// The training surface for the overnight analyst. Two kinds of feedback live
// here, both fed into the nightly judge prompt as calibration:
//   items — Evan's "real issue / this is fine" verdicts (admin-only buttons)
//   notes — WRITTEN feedback on a flag, from anyone on the team (typed or
//           dictated via the mic), attributed to whoever is signed in.
// Multiple people can leave notes on the same flag; nothing is overwritten.

async function loadFeedback(token, ns) {
  try {
    const buf = await downloadFromDropbox(token, ns, FB_PATH)
    if (buf) {
      const fb = JSON.parse(buf.toString('utf8'))
      return { items: fb.items || [], notes: fb.notes || [] }
    }
  } catch { /* first use */ }
  return { items: [], notes: [] }
}

export async function GET(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const fb = await loadFeedback(token, ns)
    const date = new URL(request.url).searchParams.get('date')
    return NextResponse.json({
      items: date ? fb.items.filter((x) => x.date === date) : fb.items,
      notes: date ? fb.notes.filter((x) => x.date === date) : fb.notes,
    })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = await resolveChatTeamScope(request)
  if (!scope.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { date, creator, fan, message, issues, severity, note, verdict, text } = await request.json()
    if (!creator || !message) return NextResponse.json({ error: 'creator + message required' }, { status: 400 })
    if (!verdict && !String(text || '').trim()) return NextResponse.json({ error: 'verdict or text required' }, { status: 400 })

    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const fb = await loadFeedback(token, ns)
    const id = `${date}|${creator}|${fan}|${String(message).slice(0, 60)}`

    if (verdict) {
      // Verdict buttons stay the admin's calibration surface.
      if (scope.scoped) return NextResponse.json({ error: 'Verdicts are admin-only' }, { status: 403 })
      if (!['real', 'fine'].includes(verdict)) return NextResponse.json({ error: 'verdict must be real|fine' }, { status: 400 })
      fb.items = fb.items.filter((x) => x.id !== id)
      fb.items.push({ id, date, creator, fan, message: String(message).slice(0, 300), issues: issues || [], severity, note: String(note || '').slice(0, 300), verdict, at: new Date().toISOString() })
      if (fb.items.length > 400) fb.items = fb.items.slice(-400)
    }

    let saved = null
    if (String(text || '').trim()) {
      const u = await currentUser()
      const author = [u?.firstName, u?.lastName].filter(Boolean).join(' ')
        || u?.emailAddresses?.[0]?.emailAddress || 'unknown'
      saved = {
        flagId: id, date, creator, fan, message: String(message).slice(0, 300),
        issues: issues || [], severity,
        author, authorEmail: u?.emailAddresses?.[0]?.emailAddress || '',
        text: String(text).trim().slice(0, 2000), at: new Date().toISOString(),
      }
      fb.notes.push(saved)
      if (fb.notes.length > 800) fb.notes = fb.notes.slice(-800)
    }

    await uploadToDropbox(token, ns, FB_PATH, Buffer.from(JSON.stringify(fb), 'utf8'), { overwrite: true })
    return NextResponse.json({ ok: true, id, note: saved })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
