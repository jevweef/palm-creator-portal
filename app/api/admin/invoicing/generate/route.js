import { requireAdmin } from '@/lib/adminAuth'
import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'

const execAsync = promisify(exec)

// Calls the local Python environment to generate + upload the invoice PDF.
// Requires: ~/inspo_test/.venv with playwright, img2pdf, and valid .env credentials.
// This runs locally (npm run dev). For production, replace with a Node.js PDF generator.
export async function POST(request) {
  try { await requireAdmin() } catch (e) { return e }

  const { recordId } = await request.json()
  if (!recordId) return Response.json({ error: 'recordId required' }, { status: 400 })

  const inspoDir = process.env.INSPO_DIR || path.join(os.homedir(), 'inspo_test')
  const cmd = `cd "${inspoDir}" && .venv/bin/python invoices/generate_single.py ${recordId}`

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 90_000 })

    const parse = (key) => {
      const m = stdout.match(new RegExp(`${key}: (.+)`))
      return m ? m[1].trim() : null
    }

    if (!stdout.includes('SUCCESS: true')) {
      console.error('generate_single.py stderr:', stderr)
      return Response.json({ error: 'Generation failed', detail: stderr }, { status: 500 })
    }

    return Response.json({
      ok: true,
      dropboxLink: parse('DROPBOX_LINK'),
      invoiceNumber: parse('INVOICE_NUMBER'),
      filename: parse('FILENAME'),
    })
  } catch (err) {
    console.error('Generate invoice error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
