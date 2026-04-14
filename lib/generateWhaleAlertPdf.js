import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'
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

function buildWhaleAlertHtml({ creatorName, alert, analysis }) {
  const a = alert
  const logoUri = imgToDataUri(path.join(ASSETS_DIR, 'logo_compressed.png'))

  const urgColors = {
    critical: { bg: '#FEE2E2', text: '#DC2626', border: '#FECACA' },
    high: { bg: '#FFF3CD', text: '#D97706', border: '#FDE68A' },
    warning: { bg: '#FEF9C3', text: '#A16207', border: '#FDE68A' },
  }
  const uc = urgColors[a.urgency] || urgColors.warning

  // Trigger text
  let triggerText = ''
  if (a.triggerReason === 'gap') {
    triggerText = `Purchase gap ${a.currentGap}d exceeds ${a.medianGap * 2}d threshold (2\u00d7 median)`
  } else if (a.triggerReason === 'spend_drop') {
    triggerText = `30-day spend dropped to ${Math.round(a.spendDropRatio * 100)}% of normal`
  } else {
    triggerText = `Gap ${a.gapRatio}\u00d7 overdue + spending at ${Math.round(a.spendDropRatio * 100)}% of normal`
  }

  // Monthly chart bars
  const monthlyHistory = a.monthlyHistory || []
  const maxMo = Math.max(...monthlyHistory.map(m => m.spend), 1)
  const barsHtml = monthlyHistory.map(m => {
    const h = Math.max((m.spend / maxMo) * 80, m.spend > 0 ? 4 : 0)
    const moNum = parseInt(m.month.slice(5))
    const barColor = m.spend === 0 ? '#F3F4F6' : m.spend < (a.monthlyAvg90 || 1) * 0.25 ? '#FECACA' : '#E88FAC'
    return `
      <div style="display:flex;flex-direction:column;align-items:center;flex:1;">
        <div style="font-size:10px;color:#666;margin-bottom:3px;">${m.spend > 0 ? fmtMoney(m.spend) : ''}</div>
        <div style="width:100%;max-width:50px;height:${h}px;background:${barColor};border-radius:4px 4px 0 0;min-height:2px;"></div>
        <div style="font-size:10px;color:#999;margin-top:4px;">${MO_NAMES[moNum] || ''}</div>
      </div>`
  }).join('')

  // Manager brief section
  let managerBriefHtml = ''
  if (analysis?.managerBrief) {
    managerBriefHtml = `
      <div style="margin-top:24px;">
        <div style="font-size:11px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">Chat Manager Brief</div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;font-size:13px;color:#1a1a1a;line-height:1.7;">
          ${formatAnalysisText(analysis.managerBrief, '#334155')}
        </div>
      </div>`
  }

  // Full analysis section
  let fullAnalysisHtml = ''
  if (analysis?.analysis) {
    fullAnalysisHtml = `
      <div style="margin-top:24px;${analysis?.managerBrief ? 'page-break-before:auto;' : ''}">
        <div style="font-size:11px;font-weight:700;color:#EA580C;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">Detailed Analysis</div>
        <div style="background:#FFFBF5;border:1px solid #FED7AA;border-radius:8px;padding:16px 20px;font-size:13px;color:#1a1a1a;line-height:1.7;">
          ${formatAnalysisText(analysis.analysis, '#EA580C')}
        </div>
      </div>`
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #fff; color: #1a1a1a; padding: 32px; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #F3F4F6;">
    <div>
      <div style="font-size:22px;font-weight:700;color:#1a1a1a;">${creatorName}</div>
      <div style="font-size:14px;color:#666;margin-top:2px;">Whale Alert</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px;">
      <span style="background:${uc.bg};color:${uc.text};border:1px solid ${uc.border};padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;">${a.urgency}</span>
      <img src="${logoUri}" style="height:28px;opacity:0.7;" />
    </div>
  </div>

  <!-- Fan info -->
  <div style="margin-bottom:20px;">
    <span style="font-size:18px;font-weight:600;color:#1a1a1a;">${a.fan}</span>
    ${a.username ? `<span style="font-size:14px;color:#E88FAC;margin-left:8px;">@${a.username}</span>` : ''}
  </div>

  <!-- Stats grid -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;">
    <div style="background:#FAFAFA;border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.03em;">Median Gap</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px;">${a.medianGap}d</div>
    </div>
    <div style="background:#FAFAFA;border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.03em;">Current Gap</div>
      <div style="font-size:18px;font-weight:600;color:${a.currentGap > a.medianGap * 3 ? '#DC2626' : '#EA580C'};margin-top:4px;">${a.currentGap}d <span style="font-size:12px;color:#999;font-weight:400;">(${a.gapRatio}x)</span></div>
    </div>
    <div style="background:#FAFAFA;border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.03em;">Last 30 Days</div>
      <div style="font-size:18px;font-weight:600;color:${a.rolling30 === 0 ? '#DC2626' : '#1a1a1a'};margin-top:4px;">${fmtMoney(a.rolling30)}</div>
    </div>
    <div style="background:#FAFAFA;border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.03em;">90d Avg/Mo</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px;">${fmtMoney(a.monthlyAvg90)}</div>
    </div>
    <div style="background:#FAFAFA;border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.03em;">Lifetime</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px;">${fmtMoney(a.lifetime)}</div>
    </div>
  </div>

  <!-- Trigger -->
  <div style="background:#FFFBF5;border:1px solid #FED7AA;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
    <div style="display:flex;gap:24px;flex-wrap:wrap;">
      <div>
        <div style="font-size:10px;color:#999;margin-bottom:2px;">Trigger</div>
        <div style="font-size:13px;color:#1a1a1a;">${triggerText}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#999;margin-bottom:2px;">Last Purchase</div>
        <div style="font-size:13px;color:#1a1a1a;">${a.lastPurchaseDate || 'Unknown'}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#999;margin-bottom:2px;">Total Purchases</div>
        <div style="font-size:13px;color:#1a1a1a;">${a.totalPurchases || 0} sessions</div>
      </div>
    </div>
  </div>

  <!-- Monthly spend chart -->
  ${monthlyHistory.length > 0 ? `
  <div style="margin-bottom:20px;">
    <div style="font-size:11px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:16px;">Monthly Spending (last 6 months)</div>
    <div style="display:flex;gap:6px;align-items:flex-end;height:100px;">
      ${barsHtml}
    </div>
  </div>` : ''}

  ${managerBriefHtml}
  ${fullAnalysisHtml}

  <!-- Footer -->
  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #F3F4F6;font-size:10px;color:#bbb;text-align:center;">
    Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} &middot; Palm Management
  </div>
</body>
</html>`
}

function formatAnalysisText(text, accentColor) {
  if (!text) return ''
  return text.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return '<div style="height:8px;"></div>'

    // Section header: **Header**
    const headerMatch = trimmed.match(/^\*\*([^*]+)\*\*:?\s*(.*)/)
    if (headerMatch) {
      const rest = (headerMatch[2] || '').replace(/\*\*([^*]+)\*\*/g, '$1')
      return `<div style="margin-top:14px;margin-bottom:4px;">
        <div style="font-size:12px;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:0.03em;">${headerMatch[1]}</div>
        ${rest ? `<div style="margin-top:2px;">${rest}</div>` : ''}
      </div>`
    }

    // Numbered item
    const numMatch = trimmed.match(/^(\d+)\.\s*(.*)/)
    if (numMatch) {
      const content = numMatch[2].replace(/\*\*([^*]+)\*\*/g, '$1')
      return `<div style="display:flex;gap:8px;margin-bottom:4px;padding-left:4px;">
        <span style="color:${accentColor};font-weight:700;font-size:12px;min-width:16px;">${numMatch[1]}.</span>
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
          <span style="color:#ccc;margin-top:2px;">\u2022</span>
          <span><strong style="color:#333;">${labelMatch[1]}:</strong> ${labelMatch[2]}</span>
        </div>`
      }
      return `<div style="display:flex;gap:8px;margin-bottom:4px;padding-left:4px;">
        <span style="color:#ccc;margin-top:2px;">\u2022</span>
        <span>${content.replace(/\*\*([^*]+)\*\*/g, '$1')}</span>
      </div>`
    }

    // Regular text
    return `<div style="margin-bottom:2px;">${trimmed.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/"([^"]+)"/g, '\u201c$1\u201d')}</div>`
  }).join('\n')
}

export async function generateWhaleAlertPdf({ creatorName, alert, analysis }) {
  const html = buildWhaleAlertHtml({ creatorName, alert, analysis })

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 800, height: 1200, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(CHROMIUM_URL),
    headless: chromium.headless,
  })

  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10000 })

  const pdfBuffer = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
  })

  await browser.close()
  return Buffer.from(pdfBuffer)
}

export { buildWhaleAlertHtml }
