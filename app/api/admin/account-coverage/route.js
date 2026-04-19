import { auth } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'
const REVENUE_ACCOUNTS_TABLE = 'tblQqPWlsjiyJA0ba'
const CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

const ACCT_FIELDS = {
  accountName: 'fldkEi3jW9tUXSTc5',
  platform: 'fld28V2weZs1sZr1z',
  accountType: 'fldxQMmYU6Ep6AkKR',
  status: 'fldUfbiP4uDMOGktD',
  creator: 'fldiO0GNTmM7XbL31',
  earningsStart: 'fldIFvqIOE1mFCFbq',
  earningsEnd: 'fldZtO52nDZXKY0R7',
  earningsLastUpload: 'fldxD7iDFZHWttC9n',
  chargebackStart: 'fldcWM6RkZUsNyUlp',
  chargebackEnd: 'fldCbyspe7EiJo0iW',
  chargebacksLastUpload: 'fldNCy327oIndVw2R',
}

const CREATOR_FIELDS = {
  aka: 'fldi2BNvf928yVuZx',
  managementStart: 'flddRQe5WGegIBomQ',
}

async function airtableFetch(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable error ${res.status}: ${text}`)
  }
  return res.json()
}

// GET: Fetch all active OF Revenue Accounts with coverage fields + creator info
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // 1. Fetch all active Revenue Accounts (OF only, skip Fansly)
    const acctParams = new URLSearchParams()
    Object.values(ACCT_FIELDS).forEach(id => acctParams.append('fields[]', id))
    acctParams.append('filterByFormula', `AND({Status}="Active", {Platform}="OnlyFans")`)
    acctParams.append('returnFieldsByFieldId', 'true')
    acctParams.append('pageSize', '100')

    const acctData = await airtableFetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${REVENUE_ACCOUNTS_TABLE}?${acctParams}`
    )

    // 2. Collect unique creator IDs to fetch AKA + management start
    const creatorIds = new Set()
    for (const rec of acctData.records || []) {
      const linked = rec.fields[ACCT_FIELDS.creator]
      if (linked && linked.length > 0) creatorIds.add(linked[0])
    }

    // 3. Fetch creator details
    const creatorMap = {}
    if (creatorIds.size > 0) {
      const ids = [...creatorIds]
      // Fetch in batches of 10 (Airtable formula limit)
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10)
        const formula = `OR(${batch.map(id => `RECORD_ID()="${id}"`).join(',')})`
        const crParams = new URLSearchParams()
        crParams.append('fields[]', CREATOR_FIELDS.aka)
        crParams.append('fields[]', CREATOR_FIELDS.managementStart)
        crParams.append('filterByFormula', formula)
        crParams.append('returnFieldsByFieldId', 'true')
        crParams.append('pageSize', '100')

        const crData = await airtableFetch(
          `https://api.airtable.com/v0/${HQ_BASE}/${CREATORS_TABLE}?${crParams}`
        )
        for (const rec of crData.records || []) {
          creatorMap[rec.id] = {
            aka: rec.fields[CREATOR_FIELDS.aka] || '',
            managementStart: rec.fields[CREATOR_FIELDS.managementStart] || null,
          }
        }
      }
    }

    // 4. Build response
    const accounts = (acctData.records || []).map(rec => {
      const f = rec.fields
      const creatorId = f[ACCT_FIELDS.creator]?.[0] || null
      const creator = creatorId ? creatorMap[creatorId] : null
      return {
        id: rec.id,
        accountName: f[ACCT_FIELDS.accountName] || '',
        platform: f[ACCT_FIELDS.platform]?.name || '',
        accountType: f[ACCT_FIELDS.accountType]?.name || '',
        creatorAka: creator?.aka || '',
        managementStart: creator?.managementStart || null,
        earningsStart: f[ACCT_FIELDS.earningsStart] || null,
        earningsEnd: f[ACCT_FIELDS.earningsEnd] || null,
        earningsLastUpload: f[ACCT_FIELDS.earningsLastUpload] || null,
        chargebackStart: f[ACCT_FIELDS.chargebackStart] || null,
        chargebackEnd: f[ACCT_FIELDS.chargebackEnd] || null,
        chargebacksLastUpload: f[ACCT_FIELDS.chargebacksLastUpload] || null,
      }
    })

    // Sort: group by creator AKA, then by account type (Free before VIP)
    accounts.sort((a, b) => {
      const cmp = a.creatorAka.localeCompare(b.creatorAka)
      if (cmp !== 0) return cmp
      // Free before VIP
      if (a.accountType === 'Free' && b.accountType !== 'Free') return -1
      if (a.accountType !== 'Free' && b.accountType === 'Free') return 1
      return a.accountName.localeCompare(b.accountName)
    })

    return Response.json({ accounts })
  } catch (err) {
    console.error('Account coverage GET error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
