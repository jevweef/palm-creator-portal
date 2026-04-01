export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdminOrEditor } from '@/lib/adminAuth'

export async function GET(req, { params }) {
  try { await requireAdminOrEditor() } catch (e) { return e }

  const { renderId } = params
  const apiKey = process.env.CREATOMATE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'CREATOMATE_API_KEY not configured' }, { status: 500 })

  const res = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: 500 })
  }

  const render = await res.json()
  return NextResponse.json({
    status: render.status,   // planned | rendering | succeeded | failed
    url: render.url || null,
    errorMessage: render.error_message || null,
  })
}
