import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { pollWaveSpeedTask } from '@/lib/wavespeed'

export const dynamic = 'force-dynamic'

// POST — body: { taskId }
// Status-only check. Returns { status, outputUrl?, error? }. The save-to-
// Dropbox-and-attach-to-Airtable step lives in /approve so the user can
// pick which candidate becomes the official reference.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  try {
    const { taskId } = await request.json()
    if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })

    const task = await pollWaveSpeedTask(taskId)

    if (task.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: task.error || 'WaveSpeed task failed' })
    }
    if (task.status !== 'completed') {
      return NextResponse.json({ status: task.status })
    }
    const outputUrl = (task.outputs || [])[0]
    if (!outputUrl) {
      return NextResponse.json({ status: 'failed', error: 'Task completed but no output URL' })
    }
    return NextResponse.json({ status: 'completed', outputUrl })
  } catch (err) {
    console.error('[creator-ai-clone/poll] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
