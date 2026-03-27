import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

export async function POST() {
  try {
    await requireAdmin()

    const webhookUrl = process.env.MAKE_ANALYSIS_WEBHOOK_URL

    if (!webhookUrl) {
      return NextResponse.json({
        error: 'MAKE_ANALYSIS_WEBHOOK_URL not configured. Set it in Vercel env vars.',
      }, { status: 500 })
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'admin-dashboard', timestamp: new Date().toISOString() }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Make webhook returned ${res.status}: ${text}`)
    }

    return NextResponse.json({ message: 'Analysis pipeline triggered via Make.' })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('Trigger analysis error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
