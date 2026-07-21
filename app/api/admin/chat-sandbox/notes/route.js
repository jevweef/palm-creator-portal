import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

// Behavioral coaching notes for the chat sandbox. GENERAL guidance on how a
// creator should behave/communicate (character, tone, energy) — not scripted
// "if he says X, say Y" pairs. Injected into her sandbox persona on every reply.
const OPS_BASE = 'applLIT2t83plMqNx'
const TABLE = 'Sandbox Coaching'
const H = { Authorization: `Bearer ${process.env.AIRTABLE_PAT}`, 'Content-Type': 'application/json' }
const URL_BASE = `https://api.airtable.com/v0/${OPS_BASE}/${encodeURIComponent(TABLE)}`

export async function GET(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const creatorId = new URL(request.url).searchParams.get('creatorId') || ''
    const q = new URLSearchParams({ pageSize: '100', 'sort[0][field]': 'Note', 'sort[0][direction]': 'asc' })
    const res = await fetch(`${URL_BASE}?${q}`, { headers: H, cache: 'no-store' })
    const data = await res.json()
    const notes = (data.records || [])
      .filter((r) => !creatorId || r.fields?.['Creator ID'] === creatorId)
      .map((r) => ({ id: r.id, note: r.fields?.Note || '', context: r.fields?.Context || '', createdTime: r.createdTime }))
    return NextResponse.json({ notes })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const { creatorId, creator, note, context } = await request.json()
    if (!creatorId || !note || !String(note).trim()) return NextResponse.json({ error: 'creatorId and note required' }, { status: 400 })
    const res = await fetch(URL_BASE, {
      method: 'POST', headers: H,
      body: JSON.stringify({ fields: { Note: String(note).trim(), 'Creator ID': creatorId, Creator: creator || '', Context: context || '' } }),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data?.error?.message || 'save failed' }, { status: 400 })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try { await requireAdmin() } catch (e) { return e }
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const res = await fetch(`${URL_BASE}/${id}`, { method: 'DELETE', headers: H })
    if (!res.ok) return NextResponse.json({ error: 'delete failed' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
