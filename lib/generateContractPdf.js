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

function fmtDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(dateStr) {
  const d = new Date(dateStr)
  const tz = 'America/New_York'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: tz }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }) + ' EST'
}

function buildContractHtml(contract) {
  const {
    creatorName,
    commissionPct,
    creatorState,
    effectiveDate,
    signatureDataUrl,
    signedName,
    signedDate,
    agencySignature,
    agencyName,
    agencySignDate,
  } = contract

  const pctDisplay = Math.round(commissionPct * 100) + '%'
  const logoUri = imgToDataUri(path.join(ASSETS_DIR, 'logo_compressed.png'))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; overflow-x: hidden; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #fdf5f0; color: #000; width: 100%; max-width: 800px;
    position: relative;
  }
  .page {
    padding: 45px 40px 35px; position: relative; overflow: hidden;
    background: linear-gradient(180deg, rgba(254,247,240,0.9) 0%, rgba(253,242,248,0.6) 30%, rgba(250,245,255,0.3) 55%, rgba(255,255,255,0) 75%);
  }
  .bg-glow { position: absolute; top: -100px; right: -100px; width: 500px; height: 500px; background: radial-gradient(circle, rgba(252,175,69,0.05) 0%, transparent 70%); pointer-events: none; }
  .gradient-text { background: linear-gradient(135deg, #fcaf45 0%, #f77737 20%, #e1306c 40%, #c13584 55%, #833ab4 75%, #5b51d8 100%) !important; -webkit-background-clip: text !important; -webkit-text-fill-color: transparent !important; background-clip: text !important; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; position: relative; z-index: 1; }
  .logo img { height: 52px; }
  .header-meta { text-align: right; padding-top: 8px; }
  .header-label { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(0,0,0,0.3); }
  .divider { height: 1.5px; background: linear-gradient(90deg, rgba(225,48,108,0.35) 0%, rgba(131,58,180,0.25) 50%, transparent 100%); margin-bottom: 32px; }
  .title { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #000; margin-bottom: 24px; }
  .parties { margin-bottom: 24px; font-size: 14px; line-height: 1.6; color: rgba(0,0,0,0.7); }
  .parties strong { color: #000; }
  .intro { font-size: 13px; line-height: 1.7; color: rgba(0,0,0,0.6); margin-bottom: 28px; }
  .section { margin-bottom: 22px; }
  .section-title { font-size: 14px; font-weight: 700; color: #000; margin-bottom: 8px; }
  .section-body { font-size: 12.5px; line-height: 1.7; color: rgba(0,0,0,0.6); }
  .section-body strong { color: rgba(0,0,0,0.8); }
  .section-body ul { margin: 8px 0 0 20px; }
  .section-body li { margin-bottom: 4px; }
  .highlight { font-size: 14px; font-weight: 700; color: #000; margin: 8px 0; }
  .signature-block { margin-top: 36px; display: flex; gap: 60px; }
  .sig-col { flex: 1; }
  .sig-label { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(0,0,0,0.3); margin-bottom: 12px; }
  .sig-field { border-bottom: 1px solid rgba(0,0,0,0.15); padding-bottom: 4px; margin-bottom: 10px; min-height: 36px; font-size: 14px; color: #000; }
  .sig-field-label { font-size: 11px; color: rgba(0,0,0,0.35); margin-bottom: 4px; }
  .sig-image { max-height: 50px; }
  .footer { margin-top: 40px; text-align: center; }
  .thank-you { font-size: 28px; font-weight: 900; letter-spacing: 6px; text-transform: uppercase; color: rgba(0,0,0,0.04); }
</style>
</head>
<body>
<div class="page">
  <div class="bg-glow"></div>
  <div class="header">
    <div class="logo"><img src="${logoUri}" alt="Palm"></div>
    <div class="header-meta">
      <div class="header-label">Creator Agreement</div>
    </div>
  </div>
  <div class="divider"></div>

  <div class="title">OnlyFans Agency Creator Agreement</div>

  <div class="parties">
    This <strong>Creator Agreement</strong> ("Agreement") is made and entered into by and between:<br>
    <strong>Palm Digital Agency</strong> ("Agency")<br>
    and<br>
    <strong>${creatorName}</strong> ("Creator")
  </div>

  <div class="intro">
    This Agreement sets forth the terms and conditions under which the Creator will collaborate with the Agency in connection with the management, promotion, and monetization of the Creator's OnlyFans and Fansly account.
  </div>

  <div class="section">
    <div class="section-title">1. Agreement Term</div>
    <div class="section-body">
      The initial term of this Agreement is <strong>3 months</strong>, commencing on the effective date of this Agreement, and shall automatically renew for subsequent periods unless either party provides written notice of non-renewal at least <strong>two (2) weeks before</strong> the expiration of the current term.
      <br><br>The agency will provide the following services to the creator:
      <ul>
        <li>Full account management and chat team</li>
        <li>Social media strategist and account manager for secondary accounts</li>
        <li>Overall brand strategy for the maintained growth of the page</li>
        <li>Youtube editor</li>
        <li>OFTV editor for Youtube AND OFTV videos and repurposing</li>
        <li>Personalized inspiration board curated to the Creator's brand, aesthetic, and content style</li>
        <li>Access to the Creator Portal including performance dashboard, earnings tracking, and content management tools</li>
        <li>Dedicated content strategy pipeline with trend analysis and creator-specific recommendations</li>
        <li>DMCA leak prevention and takedown services are available as an add-on for an additional fee, or included at no extra cost for Creators generating $10,000 or more in monthly revenue</li>
      </ul>
    </div>
  </div>

  <div class="section">
    <div class="section-title">2. Revenue Share</div>
    <div class="section-body">
      The Agency and the Creator agree that the Agency's compensation will be a percentage of the revenue generated by the Creator on OnlyFans and/or Fansly.
      <div class="highlight">${pctDisplay} of the page PER MONTH</div>
      These percentages are subject to change due to unforeseen factors such as but not limited to travel, social media account recovery services, or special exceptions. Any changes to the revenue share will be communicated in writing by the Agency prior to any business being done that should require, and the Creator agrees to adhere to these updated terms. Any of the above can not be changed unless there is explicit written agreement by the creator prior.
    </div>
  </div>

  <div class="section">
    <div class="section-title">3. Payment Terms</div>
    <div class="section-body">
      The Creator agrees to make instant payments to the Agency via the Melon App or bank transfer. Payments will be made promptly based on the agreed percentage of monthly revenue generated on OnlyFans.
    </div>
  </div>

  <div class="section">
    <div class="section-title">4. Confidentiality</div>
    <div class="section-body">
      The Creator agrees to maintain strict confidentiality regarding the terms of this Agreement. The Creator shall not disclose, share, or discuss any aspect of this Agreement, including the revenue-sharing percentages, terms, or business practices, with any third parties without prior written consent from the Agency.
    </div>
  </div>

  <div class="section">
    <div class="section-title">5. Exclusivity</div>
    <div class="section-body">
      The Creator agrees that, for the duration of this Agreement, they will exclusively work with the Agency to manage and promote their OnlyFans account. Any other representation or partnership that interferes with the Creator's obligations under this Agreement must be disclosed to and approved by the Agency in writing.
    </div>
  </div>

  <div class="section">
    <div class="section-title">6. Renewal</div>
    <div class="section-body">
      At least two (2) weeks prior to the expiration of the Agreement, both parties will evaluate the collaboration, and either party may provide notice to renew the contract or terminate it at the end of the current term. Failure to renew will result in the termination of the Agreement.
    </div>
  </div>

  <div class="section">
    <div class="section-title">7. Termination</div>
    <div class="section-body">
      This Agreement may be terminated by either party with written notice if there is a material breach of this Agreement or if either party no longer wishes to proceed with the relationship. Upon termination, any outstanding payments owed to the Agency by the Creator will remain due and payable.
    </div>
  </div>

  <div class="section">
    <div class="section-title">8. Miscellaneous</div>
    <div class="section-body">
      <ul>
        <li><strong>Governing Law/Venue:</strong> This Agreement shall be governed by and construed in accordance with the laws of the State of Florida and the State of California and the State of <strong>${creatorState || '________'}</strong>, which is where the Creator is based. Any action to enforce, or for breach of this Agreement, shall be brought exclusively in the state or federal courts of the County of Palm Beach County, Florida.</li>
        <li><strong>Entire Agreement:</strong> This Agreement constitutes the entire understanding between the parties with respect to its subject matter, and supersedes any prior discussions or agreements.</li>
        <li><strong>Amendments:</strong> Any changes or modifications to this Agreement must be made in writing and signed by both parties.</li>
        <li><strong>Ownership:</strong> The creator owns his or her page and the agency is acting on behalf of the creator. The creator's passwords or banking information will not be altered or changed by the agency.</li>
        <li><strong>Security:</strong> The agency agrees to maintain absolute security over the account while working on behalf of the creator.</li>
        <li><strong>Payment:</strong> Payment will be made each time the page is cashed out via Melon, Wire Transfer, or Zelle.</li>
        <li><strong>Content:</strong> Creator is expected to generate a reasonable and agreed upon amount of content each week for the agency and for her page.</li>
        <li><strong>Creator Rights:</strong> When the contract should end, the passwords, media, and all materials related to the page are turned over to the creator.</li>
        <li><strong>Referrals:</strong> If a creator refers an additional creator to the Agency, and the referred creator successfully completes the Agency's audit and enters into a management agreement, the referring creator shall be entitled to an agreed-upon percentage of the net revenue generated by the referred creator's account.</li>
      </ul>
    </div>
  </div>

  <div class="section">
    <div class="section-title">9. Acknowledgement</div>
    <div class="section-body">
      By signing this Agreement, both parties acknowledge that they have read, understood, and agreed to all terms and conditions outlined herein.
    </div>
  </div>

  <div class="signature-block">
    <div class="sig-col">
      <div class="sig-label">Creator</div>
      <div class="sig-field-label">Name</div>
      <div class="sig-field">${signedName || creatorName || ''}</div>
      <div class="sig-field-label">Signature</div>
      <div class="sig-field">${signatureDataUrl ? `<img src="${signatureDataUrl}" class="sig-image" />` : (signedName ? `<span style="font-family: Georgia, serif; font-style: italic; font-size: 18px;">${signedName}</span>` : '')}</div>
      <div class="sig-field-label">Date</div>
      <div class="sig-field">${signedDate ? fmtDateTime(signedDate) : ''}</div>
    </div>
    <div class="sig-col">
      <div class="sig-label">Agency</div>
      <div class="sig-field-label">Name</div>
      <div class="sig-field">${agencyName || 'Josh Voto'}</div>
      <div class="sig-field-label">Signature</div>
      <div class="sig-field">${agencySignature ? `<img src="${agencySignature}" class="sig-image" />` : ''}</div>
      <div class="sig-field-label">Date</div>
      <div class="sig-field">${agencySignDate ? fmtDate(agencySignDate) : ''}</div>
    </div>
  </div>

  <div class="footer"><div class="thank-you">Palm Digital</div></div>
</div>
</body>
</html>`
}

export async function generateContractPdf(contract) {
  const html = buildContractHtml(contract)

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 800, height: 1200, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(CHROMIUM_URL),
    headless: chromium.headless,
  })

  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 10000 })

  // Use Puppeteer's native PDF generation — handles pagination automatically
  const pdfBuffer = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
  })

  await browser.close()

  return Buffer.from(pdfBuffer)
}

// Export HTML builder for preview rendering
export { buildContractHtml }
