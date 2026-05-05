import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

// Remote chromium binary for serverless environments
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'

const ASSETS_DIR = path.join(process.cwd(), 'lib', 'invoice-assets')

function imgToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  const data = fs.readFileSync(filePath)
  return `data:${mime};base64,${data.toString('base64')}`
}

function fmtCurrency(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtPercent(n) { return Math.round(n * 100) + '%' }

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtPeriod(startStr, endStr) {
  const s = new Date(startStr + 'T12:00:00')
  const e = new Date(endStr + 'T12:00:00')
  const sMonth = s.toLocaleDateString('en-US', { month: 'long' })
  const eMonth = e.toLocaleDateString('en-US', { month: 'long' })
  if (sMonth === eMonth && s.getFullYear() === e.getFullYear()) {
    return `${sMonth} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`
  }
  if (s.getFullYear() === e.getFullYear()) {
    return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`
  }
  return `${sMonth} ${s.getDate()}, ${s.getFullYear()} – ${eMonth} ${e.getDate()}, ${e.getFullYear()}`
}

// Pay-by rule:
//   Period ends on the 14th (bi-monthly first half)  → pay by the 20th of the same month
//   Period ends on the last day of the month (second half) → pay by the 6th of the following month
function payByDateFor(periodEnd) {
  const d = new Date(periodEnd)
  const day = d.getDate()
  const month = d.getMonth()
  const year = d.getFullYear()
  // Last day of this month
  const lastDay = new Date(year, month + 1, 0).getDate()
  if (day === lastDay) {
    // 6th of next month
    return new Date(year, month + 1, 6)
  }
  // Default: 20th of same month (covers the 14th and any mid-month end date)
  return new Date(year, month, 20)
}

function buildInvoiceHtml(invoice) {
  const periods = invoice.periods
  const isMulti = periods.length > 1
  const totalDue = periods.reduce((s, p) => s + p.commission_amt, 0)

  const latestEnd = new Date(Math.max(...periods.map(p => new Date(p.end + 'T12:00:00'))))
  const invoiceDate = new Date(latestEnd)
  invoiceDate.setDate(invoiceDate.getDate() + 2)
  const payBy = payByDateFor(latestEnd)

  let serviceTitle, lineItems
  if (isMulti) {
    serviceTitle = 'Management Services'
    lineItems = periods.map((p, i) => {
      const periodLabel = p.custom_label
        ? p.custom_label
        : (p.label ? `${p.label} — ${fmtPeriod(p.start, p.end)}` : fmtPeriod(p.start, p.end))
      return `
        <div class="line-item period-header">
          <span class="line-item-label period-name">${periodLabel}</span>
          <span class="line-item-value"></span>
        </div>
        <div class="line-item">
          <span class="line-item-label">Revenue</span>
          <span class="line-item-value">${fmtCurrency(p.earnings)}</span>
        </div>
        <div class="line-item">
          <span class="line-item-label">Commission (${fmtPercent(p.commission_pct)})</span>
          <span class="line-item-value">${fmtCurrency(p.commission_amt)}</span>
        </div>
        ${i < periods.length - 1 ? '<div class="line-item-divider" style="margin: 8px 0;"></div>' : ''}
      `
    }).join('') + `
      <div class="line-item-divider" style="margin: 4px 0;"></div>
      <div class="line-item" style="padding-top: 4px;">
        <span class="line-item-label" style="font-weight: 700; color: rgba(0,0,0,0.7);">Total</span>
        <span class="line-item-value" style="font-weight: 800;">${fmtCurrency(totalDue)}</span>
      </div>`
  } else {
    const p = periods[0]
    serviceTitle = p.custom_label
      ? p.custom_label
      : `Management Services &mdash; ${fmtPeriod(p.start, p.end)}`
    lineItems = `
      <div class="line-item">
        <span class="line-item-label">Total Revenue</span>
        <span class="line-item-value">${fmtCurrency(p.earnings)}</span>
      </div>
      <div class="line-item-divider"></div>
      <div class="line-item">
        <span class="line-item-label">Commission Rate</span>
        <span class="line-item-value">${fmtPercent(p.commission_pct)}</span>
      </div>
      <div class="line-item-divider"></div>
      <div class="line-item">
        <span class="line-item-label">Total Commission</span>
        <span class="line-item-value">${fmtCurrency(p.commission_amt)}</span>
      </div>`
  }

  const logoUri = imgToDataUri(path.join(ASSETS_DIR, 'logo_compressed.png'))
  const qrUri = imgToDataUri(path.join(ASSETS_DIR, 'zelle_compressed.jpeg'))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #fdf5f0; color: #000; width: 800px; height: 1130px;
    position: relative; overflow: hidden;
  }
  .page {
    padding: 45px 60px 35px; position: relative; height: 1130px;
    display: flex; flex-direction: column;
    background: linear-gradient(180deg, rgba(254,247,240,0.9) 0%, rgba(253,242,248,0.6) 30%, rgba(250,245,255,0.3) 55%, rgba(255,255,255,0) 75%);
  }
  .bg-glow { position: absolute; top: -100px; right: -100px; width: 500px; height: 500px; background: radial-gradient(circle, rgba(252,175,69,0.05) 0%, transparent 70%); pointer-events: none; }
  .bg-glow-bottom { position: absolute; bottom: -100px; left: -100px; width: 450px; height: 450px; background: radial-gradient(circle, rgba(131,58,180,0.03) 0%, transparent 70%); pointer-events: none; }
  .gradient-text { background: linear-gradient(135deg, #fcaf45 0%, #f77737 20%, #e1306c 40%, #c13584 55%, #833ab4 75%, #5b51d8 100%) !important; -webkit-background-clip: text !important; -webkit-text-fill-color: transparent !important; background-clip: text !important; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; position: relative; z-index: 1; }
  .logo img { height: 52px; }
  .invoice-meta { text-align: right; padding-top: 8px; }
  .invoice-number { font-size: 13px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(0,0,0,0.3); margin-bottom: 4px; }
  .invoice-date { font-size: 13px; font-weight: 400; color: rgba(0,0,0,0.3); }
  .divider { height: 1.5px; background: linear-gradient(90deg, rgba(225,48,108,0.35) 0%, rgba(131,58,180,0.25) 50%, transparent 100%); margin-bottom: 42px; position: relative; z-index: 1; }
  .bill-to { margin-bottom: 42px; position: relative; z-index: 1; }
  .bill-to-label { font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(0,0,0,0.25); margin-bottom: 10px; }
  .bill-to-name { font-size: 32px; font-weight: 800; letter-spacing: -0.8px; line-height: 1.08; color: #000; }
  .bill-to-aka { font-size: 17px; font-weight: 400; color: rgba(0,0,0,0.35); margin-top: 5px; }
  .service-card { background: rgba(255,255,255,0.6); border: 1px solid rgba(0,0,0,0.04); border-radius: 20px; padding: 30px 34px; margin-bottom: 38px; position: relative; z-index: 1; box-shadow: 0 2px 20px rgba(0,0,0,0.03); }
  .service-title { font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(0,0,0,0.25); margin-bottom: 24px; }
  .line-items { display: flex; flex-direction: column; gap: 14px; }
  .line-item { display: flex; justify-content: space-between; align-items: center; }
  .line-item-label { font-size: 15px; font-weight: 500; color: rgba(0,0,0,0.45); }
  .line-item-value { font-size: 15px; font-weight: 700; color: rgba(0,0,0,0.85); }
  .line-item-divider { height: 1px; background: rgba(0,0,0,0.04); }
  .period-name { font-weight: 600; color: rgba(0,0,0,0.6); font-size: 13px; letter-spacing: 0.3px; }
  .total-section { display: flex; justify-content: space-between; align-items: center; margin-bottom: 42px; position: relative; z-index: 1; }
  .total-label-group { display: flex; flex-direction: column; }
  .total-label { font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(0,0,0,0.25); margin-bottom: 6px; }
  .due-date { font-size: 14px; font-weight: 400; color: rgba(0,0,0,0.35); }
  .total-amount { font-size: 52px; font-weight: 900; letter-spacing: -2px; line-height: 1; }
  .payment-section { display: flex; gap: 40px; align-items: flex-start; position: relative; z-index: 1; flex: 1; }
  .payment-details { flex: 1; }
  .payment-title { font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(0,0,0,0.25); margin-bottom: 18px; }
  .payment-info { display: flex; flex-direction: column; gap: 10px; }
  .payment-row { display: flex; gap: 12px; }
  .payment-row-label { font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.3); min-width: 110px; }
  .payment-row-value { font-size: 13px; font-weight: 600; color: rgba(0,0,0,0.65); }
  .payment-entity { font-size: 11px; font-weight: 600; letter-spacing: 1px; color: rgba(0,0,0,0.2); margin-top: 8px; text-transform: uppercase; }
  .payment-address { font-size: 11px; font-weight: 500; color: rgba(0,0,0,0.3); margin-top: 2px; }
  .qr-section { flex-shrink: 0; }
  .qr-code img { width: 175px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .footer { margin-top: auto; padding-top: 25px; text-align: center; position: relative; z-index: 1; }
  .thank-you { font-size: 38px; font-weight: 900; letter-spacing: 6px; text-transform: uppercase; color: rgba(0,0,0,0.06); }
</style>
</head>
<body>
<div class="page">
  <div class="bg-glow"></div>
  <div class="bg-glow-bottom"></div>
  <div class="header">
    <div class="logo"><img src="${logoUri}" alt="Palm"></div>
    <div class="invoice-meta">
      <div class="invoice-number">Invoice #${invoice.invoice_number}</div>
      <div class="invoice-date">${fmtDate(invoiceDate.toISOString().split('T')[0])}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="bill-to">
    <div class="bill-to-label">Invoice To</div>
    <div class="bill-to-name">${invoice.creator_name}</div>
    <div class="bill-to-aka">${invoice.aka}</div>
  </div>
  <div class="service-card">
    <div class="service-title">${serviceTitle}</div>
    <div class="line-items">${lineItems}</div>
  </div>
  <div class="total-section">
    <div class="total-label-group">
      <div class="total-label">Total Due</div>
      <div class="due-date">Please pay by ${fmtDate(payBy.toISOString().split('T')[0])}</div>
    </div>
    <div class="total-amount gradient-text">${fmtCurrency(totalDue)}</div>
  </div>
  <div class="payment-section">
    <div class="payment-details">
      <div class="payment-title">Payment Instructions</div>
      <div class="payment-info">
        <div class="payment-row"><span class="payment-row-label">Bank</span><span class="payment-row-value">Chase</span></div>
        <div class="payment-row"><span class="payment-row-label">Account Number</span><span class="payment-row-value">2900308524</span></div>
        <div class="payment-row"><span class="payment-row-label">Routing Number</span><span class="payment-row-value">267084131</span></div>
        <div class="payment-entity">Palm Digital Management LLC</div>
        <div class="payment-address">401 NE 2nd Ave, Delray Beach, FL 33444</div>
      </div>
    </div>
    <div class="qr-section">
      <div class="qr-code"><img src="${qrUri}" alt="Zelle QR Code"></div>
    </div>
  </div>
  <div class="footer"><div class="thank-you">Thank You</div></div>
</div>
</body>
</html>`
}

export async function generateInvoicePdf(invoice) {
  const html = buildInvoiceHtml(invoice)

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 800, height: 1130, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(CHROMIUM_URL),
    headless: chromium.headless,
  })

  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 8000 })

  // Screenshot as JPEG then wrap in PDF — same approach as Python version
  // This preserves exact visual rendering (gradients, fonts, etc.)
  const screenshotBuffer = await page.screenshot({
    type: 'jpeg',
    quality: 92,
    clip: { x: 0, y: 0, width: 800, height: 1130 },
  })

  await browser.close()

  // Wrap JPEG screenshot in a proper PDF using pdf-lib
  const pdfDoc = await PDFDocument.create()
  const jpegImage = await pdfDoc.embedJpg(screenshotBuffer)
  // Page size at 72 DPI (screenshot is 2x, so divide by 2)
  const pageWidth = 800 / 2 * 72 / 72 // 400pt
  const pageHeight = 1130 / 2 * 72 / 72 // 565pt
  const pdfPage = pdfDoc.addPage([pageWidth, pageHeight])
  pdfPage.drawImage(jpegImage, {
    x: 0, y: 0,
    width: pageWidth,
    height: pageHeight,
  })
  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}
