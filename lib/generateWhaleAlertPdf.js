import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'
const ASSETS_DIR = path.join(process.cwd(), 'lib', 'invoice-assets')

function imgToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  const data = fs.readFileSync(filePath)
  return `data:${mime};base64,${data.toString('base64')}`
}

function fmtMoney(n) {
  if (n == null) return '$0'
  return '$' + Math.round(n).toLocaleString('en-US')
}

const MO_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function buildWhaleAlertHtml({ creatorName, creatorAka, alert, analysis }) {
  const a = alert
  // Prefer AKA (stage name) in PDF header — that's what chatters know the creator as.
  // Fall back to creatorName (legal name) for backwards compat with callers that don't pass AKA.
  const displayCreator = creatorAka || creatorName
  const logoUri = imgToDataUri(path.join(ASSETS_DIR, 'logo_compressed.png'))

  const urgColors = {
    critical: { bg: '#FEE2E2', text: '#DC2626', border: '#FECACA' },
    high: { bg: '#FFF3CD', text: '#D97706', border: '#FDE68A' },
    warning: { bg: '#FEF9C3', text: '#A16207', border: '#FDE68A' },
  }
  const uc = urgColors[a.urgency] || urgColors.warning

  // Monthly chart bars — all months from first purchase → now (capped at 12).
  // Empty months render as grey bars so the cool-off is visible.
  const monthlyHistory = a.monthlyHistory || []
  const accountNames = a.accountNames || []
  const multiAccount = accountNames.length > 1
  const chartMonths = monthlyHistory.slice(-12)
  const maxMo = Math.max(...chartMonths.map(m => m.spend), 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxMo)))
  const niceSteps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const chartMax = niceSteps.map(s => s * magnitude).find(s => s >= maxMo) || maxMo

  const chartBarMaxH = 90
  // Account color palette: Free = blue, VIP = purple, fallback = pink
  const acctColor = (acct) => /free/i.test(acct) ? '#60A5FA' : /vip/i.test(acct) ? '#A78BFA' : '#E88FAC'
  const barsHtml = chartMonths.map(m => {
    const barH = Math.max(Math.round((m.spend / chartMax) * chartBarMaxH), m.spend > 0 ? 4 : 0)
    const moNum = parseInt(m.month.slice(5))
    const isLow = m.spend > 0 && m.spend < (a.monthlyAvg90 || 1) * 0.25
    // Stacked segments per account when multi-account; flat bar otherwise
    let barInner = ''
    if (multiAccount && m.byAccount && m.spend > 0) {
      barInner = accountNames
        .map(acct => {
          const acctSpend = m.byAccount[acct] || 0
          if (acctSpend <= 0) return ''
          const segH = Math.round((acctSpend / chartMax) * chartBarMaxH)
          return `<div style="width:100%;height:${segH}px;background:${acctColor(acct)};"></div>`
        })
        .reverse()
        .join('')
    } else {
      const barColor = m.spend === 0 ? '#F3F4F6' : isLow ? '#FECACA' : '#E88FAC'
      barInner = `<div style="width:100%;height:${barH}px;background:${barColor};"></div>`
    }
    return `
      <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
        <div style="font-size:11px;font-weight:600;color:${isLow ? '#DC2626' : 'rgba(0,0,0,0.55)'};min-height:16px;margin-bottom:2px;">${m.spend > 0 ? fmtMoney(m.spend) : ''}</div>
        <div style="width:100%;max-width:55px;height:${chartBarMaxH}px;display:flex;flex-direction:column;justify-content:flex-end;border-radius:4px 4px 0 0;overflow:hidden;">${barInner}</div>
        <div style="font-size:11px;font-weight:500;color:rgba(0,0,0,0.35);margin-top:4px;">${MO_NAMES[moNum] || ''}</div>
      </div>`
  }).join('')

  // Legend for multi-account creators — clarifies which color is which page
  const legendHtml = multiAccount
    ? `<div style="display:flex;justify-content:center;gap:16px;margin-top:10px;font-size:10px;color:rgba(0,0,0,0.55);">
        ${accountNames.map(acct => `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:9px;height:9px;border-radius:2px;background:${acctColor(acct)};"></span>${acct}</span>`).join('')}
      </div>`
    : ''

  // Manager brief is sent as Telegram text, not in the PDF

  // Full analysis section
  let fullAnalysisHtml = ''
  if (analysis?.analysis) {
    fullAnalysisHtml = `
      <div style="margin-top:20px;">
        <div style="font-size:10px;font-weight:700;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:2.5px;margin-bottom:10px;">Detailed Analysis</div>
        <div style="background:rgba(255,255,255,0.6);border:1px solid rgba(0,0,0,0.06);border-radius:12px;padding:16px 20px;font-size:13px;color:rgba(0,0,0,0.75);line-height:1.7;">
          ${formatAnalysisText(analysis.analysis)}
        </div>
      </div>`
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      color: #1a1a1a;
      padding: 32px;
      background: linear-gradient(165deg, #fef5f0 0%, #fdf2f8 30%, #faf5ff 60%, #fff 100%);
      min-height: 100%;
      position: relative;
    }
    body::before {
      content: '';
      position: absolute;
      top: -20%;
      right: -10%;
      width: 50%;
      height: 50%;
      background: radial-gradient(circle, rgba(232,160,160,0.08) 0%, transparent 70%);
      pointer-events: none;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div>
      <div style="font-size:10px;font-weight:700;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:2.5px;">Whale Alert</div>
      <div style="font-size:13px;font-weight:600;color:rgba(0,0,0,0.4);margin-top:2px;">${displayCreator}</div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="background:${uc.bg};color:${uc.text};border:1px solid ${uc.border};padding:4px 12px;border-radius:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${a.urgency}</span>
      <img src="${logoUri}" style="height:24px;opacity:0.5;" />
    </div>
  </div>

  <!-- Fan info -->
  <div style="margin-bottom:20px;">
    <div style="font-size:28px;font-weight:800;color:rgba(0,0,0,0.85);letter-spacing:-0.5px;">${a.fan}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap;">
      ${a.username ? `<div style="font-size:14px;font-weight:500;color:#E88FAC;">@${a.username}</div>` : ''}
      ${(a.creatorAccounts && a.creatorAccounts.length > 1 && a.accountNames && a.accountNames.length > 0)
        ? a.accountNames.map(acct => {
            const isFree = /free/i.test(acct)
            const bg = isFree ? '#DBEAFE' : '#EDE9FE'
            const color = isFree ? '#1D4ED8' : '#7C3AED'
            return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${acct}</span>`
          }).join('')
        : ''}
    </div>
  </div>

  <!-- Gradient divider -->
  <div style="height:1.5px;background:linear-gradient(to right, rgba(232,143,172,0.35), rgba(124,58,237,0.15), transparent);margin-bottom:20px;"></div>

  <!-- Stats row -->
  <div style="display:flex;gap:10px;margin-bottom:20px;">
    <div style="flex:1;background:rgba(255,255,255,0.6);border:1px solid rgba(0,0,0,0.04);border-radius:10px;padding:12px;">
      <div style="font-size:10px;font-weight:600;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:1px;">Lifetime</div>
      <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.85);margin-top:4px;">${fmtMoney(a.lifetime)}</div>
    </div>
    <div style="flex:1;background:rgba(255,255,255,0.6);border:1px solid rgba(0,0,0,0.04);border-radius:10px;padding:12px;">
      <div style="font-size:10px;font-weight:600;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:1px;">Last 30 Days</div>
      <div style="font-size:20px;font-weight:800;color:${a.rolling30 === 0 ? '#DC2626' : 'rgba(0,0,0,0.85)'};margin-top:4px;">${fmtMoney(a.rolling30)}</div>
    </div>
    <div style="flex:1;background:rgba(255,255,255,0.6);border:1px solid rgba(0,0,0,0.04);border-radius:10px;padding:12px;">
      <div style="font-size:10px;font-weight:600;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:1px;">Current Gap</div>
      <div style="font-size:20px;font-weight:800;color:${a.currentGap > a.medianGap * 3 ? '#DC2626' : '#EA580C'};margin-top:4px;">${a.currentGap}d <span style="font-size:12px;font-weight:500;color:rgba(0,0,0,0.3);">(${a.gapRatio}x median)</span></div>
    </div>
    <div style="flex:1;background:rgba(255,255,255,0.6);border:1px solid rgba(0,0,0,0.04);border-radius:10px;padding:12px;">
      <div style="font-size:10px;font-weight:600;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:1px;">Peak Avg/Mo</div>
      <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.85);margin-top:4px;">${fmtMoney(a.peakMonthlyAvg || a.monthlyAvg90)}</div>
      ${a.peakRange ? `<div style="font-size:10px;font-weight:500;color:rgba(0,0,0,0.3);margin-top:2px;">${a.peakRange}</div>` : ''}
    </div>
  </div>

  <!-- Monthly spend chart -->
  ${chartMonths.length > 0 ? `
  <div style="background:rgba(255,255,255,0.6);border:1px solid rgba(0,0,0,0.04);border-radius:12px;padding:20px;margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;color:rgba(0,0,0,0.25);text-transform:uppercase;letter-spacing:2.5px;margin-bottom:16px;">Monthly Spending</div>
    <div style="display:flex;gap:6px;align-items:flex-end;height:110px;">
      ${barsHtml}
    </div>
    ${legendHtml}
  </div>` : ''}

  ${fullAnalysisHtml}

  <!-- Footer -->
  <div style="margin-top:24px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.04);display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:10px;color:rgba(0,0,0,0.2);">Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}</div>
    <div style="font-size:10px;font-weight:600;color:rgba(0,0,0,0.15);letter-spacing:1px;">PALM MANAGEMENT</div>
  </div>
</body>
</html>`
}

function formatAnalysisText(text) {
  if (!text) return ''
  return text.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return '<div style="height:8px;"></div>'

    // Section header: **Header**
    const headerMatch = trimmed.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
    if (headerMatch) {
      const rest = (headerMatch[2] || '').replace(/\*\*([^*]+)\*\*/g, '$1')
      return `<div style="margin-top:14px;margin-bottom:4px;">
        <div style="font-size:11px;font-weight:700;color:#E88FAC;text-transform:uppercase;letter-spacing:0.5px;">${headerMatch[1]}</div>
        ${rest ? `<div style="margin-top:2px;">${rest}</div>` : ''}
      </div>`
    }

    // Numbered item
    const numMatch = trimmed.match(/^(\d+)\.\s*(.*)/)
    if (numMatch) {
      const content = numMatch[2].replace(/\*\*([^*]+)\*\*/g, '$1')
      return `<div style="display:flex;gap:8px;margin-bottom:4px;padding-left:4px;">
        <span style="color:#E88FAC;font-weight:700;font-size:12px;min-width:16px;">${numMatch[1]}.</span>
        <span>${content}</span>
      </div>`
    }

    // Bullet
    const bulletMatch = trimmed.match(/^[-\u2022]\s*(.*)/)
    if (bulletMatch) {
      const content = bulletMatch[1]
      const labelMatch = content.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
      if (labelMatch) {
        return `<div style="display:flex;gap:8px;margin-bottom:4px;padding-left:4px;">
          <span style="color:rgba(0,0,0,0.2);margin-top:2px;">\u2022</span>
          <span><strong style="color:rgba(0,0,0,0.7);">${labelMatch[1]}:</strong> ${labelMatch[2]}</span>
        </div>`
      }
      return `<div style="display:flex;gap:8px;margin-bottom:4px;padding-left:4px;">
        <span style="color:rgba(0,0,0,0.2);margin-top:2px;">\u2022</span>
        <span>${content.replace(/\*\*([^*]+)\*\*/g, '$1')}</span>
      </div>`
    }

    // Regular text
    return `<div style="margin-bottom:2px;">${trimmed.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/"([^"]+)"/g, '\u201c$1\u201d')}</div>`
  }).join('\n')
}

export async function generateWhaleAlertPdf({ creatorName, creatorAka, alert, analysis }) {
  const html = buildWhaleAlertHtml({ creatorName, creatorAka, alert, analysis })

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 800, height: 1130, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(CHROMIUM_URL),
    headless: chromium.headless,
  })

  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10000 })

  // Get actual content height for dynamic page sizing.
  // Ceiling raised 2400 → 4500 to fit full ~1000-word patron-tier briefs —
  // the shorter briefs still render at their natural height, so no impact
  // on smaller fan briefs.
  const contentHeight = await page.evaluate(() => document.body.scrollHeight)
  const captureHeight = Math.min(Math.max(contentHeight, 600), 4500)

  // Flatten: screenshot as JPEG then wrap in PDF (same as invoice)
  const screenshotBuffer = await page.screenshot({
    type: 'jpeg',
    quality: 92,
    clip: { x: 0, y: 0, width: 800, height: captureHeight },
  })

  await browser.close()

  // Wrap JPEG in PDF using pdf-lib
  const pdfDoc = await PDFDocument.create()
  const jpegImage = await pdfDoc.embedJpg(screenshotBuffer)
  const pageWidth = 800 / 2
  const pageHeight = captureHeight / 2
  const pdfPage = pdfDoc.addPage([pageWidth, pageHeight])
  pdfPage.drawImage(jpegImage, {
    x: 0, y: 0,
    width: pageWidth,
    height: pageHeight,
  })
  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

export { buildWhaleAlertHtml }
