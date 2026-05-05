// Sum gross + chargebacks per account for April 2026 from the OF earnings Sheet.
// Run from palm-creator-portal: node scripts/april-chat-cost.js

// Load .env.local manually (no dotenv dep)
const fs = require('fs')
const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { google } = require('googleapis')

const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID

function authClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return oauth2
}

function parseMoney(v) {
  if (v == null) return 0
  const s = String(v).replace(/[$,\s]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: authClient() })

  // List all tabs
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const allTabs = meta.data.sheets.map(s => s.properties.title)
  const salesTabs = allTabs.filter(t => /-\s*Sales$/i.test(t) && t.split(/\s*-\s*/).length >= 3)
  const cbTabs = allTabs.filter(t => /-\s*Chargebacks$/i.test(t))
  const skipped = allTabs.filter(t => /-\s*Sales$/i.test(t) && !salesTabs.includes(t))
  if (skipped.length) console.log(`Skipping legacy tabs: ${skipped.join(', ')}`)
  console.log(`Sales tabs: ${salesTabs.length}, Chargeback tabs: ${cbTabs.length}`)

  // Build per-account chargeback totals first
  const cbByAccount = {}
  for (const tab of cbTabs) {
    let res
    try {
      res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A4:I` })
    } catch (e) { console.warn(`CB ${tab}: ${e.message}`); continue }
    const rows = res.data.values || []
    const accountKey = tab.replace(/\s*-\s*Chargebacks$/i, '') // e.g. "Sunny - Free OF"
    let total = 0
    for (const row of rows) {
      const dateTime = row[0]
      if (!dateTime) continue
      const datePart = String(dateTime).split(' ')[0]
      const inApril = /^2026-04-/.test(datePart) || /^04?\/\d{1,2}\/2026/.test(datePart)
      if (!inApril) continue
      total += Math.abs(parseMoney(row[1]))
    }
    if (total > 0) cbByAccount[accountKey] = total
  }

  const results = []

  for (const tab of salesTabs) {
    let res
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tab}'!A4:I`,
      })
    } catch (e) {
      console.warn(`Failed ${tab}: ${e.message}`)
      continue
    }
    const rows = res.data.values || []
    let grossSales = 0
    let netSales = 0
    let chargebackAmt = 0
    let saleCount = 0
    let cbCount = 0

    for (const row of rows) {
      const [dateTime, gross, ofFee, net, type] = row
      if (!dateTime) continue
      const datePart = String(dateTime).split(' ')[0]
      let inApril = false
      if (/^2026-04-/.test(datePart)) inApril = true
      else if (/^04\/\d{2}\/2026/.test(datePart)) inApril = true
      else if (/^4\/\d{1,2}\/2026/.test(datePart)) inApril = true
      if (!inApril) continue

      const g = parseMoney(gross)
      const n = parseMoney(net)
      if ((type || '').toLowerCase() === 'chargeback') {
        chargebackAmt += Math.abs(g)
        cbCount++
      } else {
        grossSales += g
        netSales += n
        saleCount++
      }
    }

    const accountKey = tab.replace(/\s*-\s*Sales$/i, '')
    const cbFromTab = cbByAccount[accountKey] || 0
    chargebackAmt += cbFromTab
    if (grossSales === 0 && chargebackAmt === 0) continue
    const netGross = grossSales - chargebackAmt
    const netRevenue = netSales - chargebackAmt * 0.8 // approximate: CBs reverse net by ~80% of gross
    results.push({
      tab,
      grossSales,
      netSales,
      chargebackAmt,
      netGross,
      netRevenue,
      saleCount,
      cbCount,
    })
  }

  results.sort((a, b) => b.netGross - a.netGross)

  console.log('\n=== April 2026 by account (raw sheet) ===')
  console.log('Account'.padEnd(28), 'Gross'.padStart(11), 'CB'.padStart(7), 'NetGross'.padStart(11), 'NetRev'.padStart(11))
  let totalGross = 0, totalCb = 0, totalNetRev = 0
  for (const r of results) {
    console.log(
      r.tab.replace(/ - Sales$/i, '').padEnd(28),
      r.grossSales.toFixed(2).padStart(11),
      r.chargebackAmt.toFixed(2).padStart(7),
      r.netGross.toFixed(2).padStart(11),
      r.netRevenue.toFixed(2).padStart(11)
    )
    totalGross += r.grossSales
    totalCb += r.chargebackAmt
    totalNetRev += r.netRevenue
  }
  const totalNetGross = totalGross - totalCb
  console.log('-'.repeat(72))
  console.log(
    'TOTAL'.padEnd(28),
    totalGross.toFixed(2).padStart(11),
    totalCb.toFixed(2).padStart(7),
    totalNetGross.toFixed(2).padStart(11),
    totalNetRev.toFixed(2).padStart(11)
  )

  const chatTeamPct = 0.20
  const chatTeamCost = totalNetRev * chatTeamPct
  console.log(`\nChat team cost (20% of net revenue): $${chatTeamCost.toFixed(2)}`)

  // ── Inflow tier lookup ────────────────────────────────────────────────
  // [bottom (exclusive of prior top), top, oldPrice, newPrice]
  const tiers = [
    [0,         500,    40,  40],
    [500.01,    1000,   50,  50],
    [1000.01,   2000,   60,  65],
    [2000.01,   5000,   65,  70],
    [5000.01,   7500,   75,  90],
    [7500.01,   10000, 100, 125],
    [10000.01,  15000, 150, 175],
    [15000.01,  30000, 200, 225],
    [30000.01,  45000, 250, 275],
    [45000.01,  60000, 250, 300],
    [60000.01,  75000, 250, 400],
    [75000.01,  Infinity, 250, 500],
  ]
  function lookupTier(rev) {
    for (const [lo, hi, oldP, newP] of tiers) if (rev <= hi) return { oldP, newP }
    return tiers[tiers.length-1]
  }

  console.log('\n=== Inflow fees per account (NEW pricing; charged once per month) ===')
  console.log('Account'.padEnd(28), 'NetGross'.padStart(11), 'Tier fee'.padStart(10))
  let inflowMo = 0
  for (const r of results) {
    const t = lookupTier(r.netGross)
    inflowMo += t.newP
    console.log(
      r.tab.replace(/ - Sales$/i, '').padEnd(28),
      r.netGross.toFixed(2).padStart(11),
      ('$' + t.newP).padStart(10)
    )
  }
  console.log('-'.repeat(72))
  console.log('TOTAL MONTHLY INFLOW (NEW)'.padEnd(28), '', '', `$${inflowMo}`.padStart(10))

  const totalOld = chatTeamCost
  const totalNew = chatTeamCost + inflowMo
  const pctIncrease = ((totalNew - totalOld) / totalOld) * 100

  console.log('\n=== Monthly chat operations cost (April) ===')
  console.log(`Chat team payouts (20% of net rev):  $${chatTeamCost.toFixed(2)}`)
  console.log(`Inflow (OLD = $0):                   $0.00`)
  console.log(`Inflow (NEW pricing):                $${inflowMo.toFixed(2)}`)
  console.log(`TOTAL OLD (chat team only):          $${totalOld.toFixed(2)}`)
  console.log(`TOTAL NEW (chat team + Inflow):      $${totalNew.toFixed(2)}`)
  console.log(`Increase:                            $${(totalNew-totalOld).toFixed(2)}`)
  console.log(`% increase in chat cost:             ${pctIncrease.toFixed(2)}%`)
}

main().catch(e => { console.error(e); process.exit(1) })
