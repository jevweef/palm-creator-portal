import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getDropboxAccessToken, getDropboxRootNamespaceId, uploadToDropbox, downloadFromDropbox } from '@/lib/dropbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FB_PATH = '/Palm Ops/Whale Intel/feedback.json'

// The training surface for the overnight analyst. Evan marks each flag
// "real" or "fine"; the nightly cron feeds recent verdicts back into the
// judge prompt as calibration examples, so what gets flagged converges on
// his taste. Single admin writer, so read-modify-write here is safe.

async function loadFeedback(token, ns) {
  try {
    const buf = await downloadFromDropbox(token, ns, FB_PATH)
    if (buf) return JSON.parse(buf.toString('utf8'))
  } catch { /* first use */ }
  return { items: [] }
}

export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const fb = await loadFeedback(token, ns)
    const date = new URL(request.url).searchParams.get('date')
    const items = date ? fb.items.filter((x) => x.date === date) : fb.items
    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { date, creator, fan, message, issues, severity, note, verdict } = await request.json()
    if (!verdict || !['real', 'fine'].includes(verdict)) return NextResponse.json({ error: 'verdict must be real|fine' }, { status: 400 })
    if (!creator || !message) return NextResponse.json({ error: 'creator + message required' }, { status: 400 })
    const token = await getDropboxAccessToken()
    const ns = await getDropboxRootNamespaceId(token)
    const fb = await loadFeedback(token, ns)
    const id = `${date}|${creator}|${fan}|${String(message).slice(0, 60)}`
    fb.items = fb.items.filter((x) => x.id !== id)
    fb.items.push({ id, date, creator, fan, message: String(message).slice(0, 300), issues: issues || [], severity, note: String(note || '').slice(0, 300), verdict, at: new Date().toISOString() })
    if (fb.items.length > 400) fb.items = fb.items.slice(-400)
    await uploadToDropbox(token, ns, FB_PATH, Buffer.from(JSON.stringify(fb), 'utf8'), { overwrite: true })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
