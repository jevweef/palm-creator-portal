import { NextResponse } from 'next/server'
import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'
import { buildWhaleAlertHtml } from '@/lib/generateWhaleAlertPdf'

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'

export const maxDuration = 60

export async function POST(req) {
  try {
    const { creatorName, alert, analysis } = await req.json()
    if (!alert) return NextResponse.json({ error: 'Missing alert data' }, { status: 400 })

    const html = buildWhaleAlertHtml({ creatorName, alert, analysis })

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 800, height: 1130, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(CHROMIUM_URL),
      headless: chromium.headless,
    })

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10000 })

    const contentHeight = await page.evaluate(() => document.body.scrollHeight)
    const captureHeight = Math.min(Math.max(contentHeight, 600), 2400)

    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 90,
      clip: { x: 0, y: 0, width: 800, height: captureHeight },
    })

    await browser.close()

    const base64 = Buffer.from(screenshotBuffer).toString('base64')
    return NextResponse.json({ image: `data:image/jpeg;base64,${base64}` })
  } catch (e) {
    console.error('Whale alert preview error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
