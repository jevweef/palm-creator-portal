const fs = require('fs')
const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { google } = require('googleapis')
const SPREADSHEET_ID = process.env.OF_TRANSACTIONS_SPREADSHEET_ID
const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
const sheets = google.sheets({ version: 'v4', auth: oauth2 })

;(async () => {
  for (const tab of ['Sunny - Sales', 'Sunny - Free OF - Sales', 'Sunny - VIP OF - Sales']) {
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A4:I` })
      const rows = res.data.values || []
      const aprilRows = rows.filter(r => r[0] && /^2026-04-/.test(String(r[0]).split(' ')[0]))
      const minDate = aprilRows.length ? aprilRows.map(r=>r[0]).sort()[0] : null
      const maxDate = aprilRows.length ? aprilRows.map(r=>r[0]).sort().slice(-1)[0] : null
      const sumGross = aprilRows.reduce((s,r) => s + (parseFloat(String(r[1]||'').replace(/[$,\s]/g,''))||0), 0)
      console.log(`${tab.padEnd(30)}: ${aprilRows.length} April rows, $${sumGross.toFixed(2)}, ${minDate} → ${maxDate}`)
    } catch (e) {
      console.log(`${tab}: error ${e.message}`)
    }
  }
})()
