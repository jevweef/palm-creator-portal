import { auth } from '@clerk/nextjs/server'

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const HQ_BASE = 'appL7c4Wtotpz07KS'
const HQ_CREATORS_TABLE = 'tblYhkNvrNuOAHfgw'

// Field IDs
const FIELDS = {
  aka: 'fldi2BNvf928yVuZx',
  status: 'fld0YKTjBw4vYMbFy',
  earningsStart: 'fldiMIvM5hf2MNzck',
  earningsEnd: 'fld6n02I6LXpaAQMC',
  chargebackStart: 'fldnl6I0NQm3LohCJ',
  chargebackEnd: 'fldw4KB1rCJULWje1',
}

async function airtableFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Airtable error ${res.status}: ${text}`)
  }
  return res.json()
}

// GET: Fetch all active creators with their date coverage fields
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const fieldIds = [
      FIELDS.aka,
      FIELDS.status,
      FIELDS.earningsStart,
      FIELDS.earningsEnd,
      FIELDS.chargebackStart,
      FIELDS.chargebackEnd,
    ]
    const params = new URLSearchParams()
    fieldIds.forEach(id => params.append('fields[]', id))
    params.append('filterByFormula', `{Status}="Active"`)
    params.append('pageSize', '100')

    const data = await airtableFetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS_TABLE}?${params}`
    )

    const creators = (data.records || []).map(rec => ({
      id: rec.id,
      aka: rec.fields[FIELDS.aka] || '',
      earningsStart: rec.fields[FIELDS.earningsStart] || null,
      earningsEnd: rec.fields[FIELDS.earningsEnd] || null,
      chargebackStart: rec.fields[FIELDS.chargebackStart] || null,
      chargebackEnd: rec.fields[FIELDS.chargebackEnd] || null,
    }))

    return Response.json({ creators })
  } catch (err) {
    console.error('Earnings coverage GET error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// PATCH: Update date range fields for a specific creator record
export async function PATCH(request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { recordId, earningsStart, earningsEnd, chargebackStart, chargebackEnd } = await request.json()
    if (!recordId) return Response.json({ error: 'Missing recordId' }, { status: 400 })

    const fields = {}
    if (earningsStart !== undefined) fields[FIELDS.earningsStart] = earningsStart
    if (earningsEnd !== undefined) fields[FIELDS.earningsEnd] = earningsEnd
    if (chargebackStart !== undefined) fields[FIELDS.chargebackStart] = chargebackStart
    if (chargebackEnd !== undefined) fields[FIELDS.chargebackEnd] = chargebackEnd

    if (Object.keys(fields).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 })
    }

    const data = await airtableFetch(
      `https://api.airtable.com/v0/${HQ_BASE}/${HQ_CREATORS_TABLE}/${recordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      }
    )

    return Response.json({ success: true, record: data })
  } catch (err) {
    console.error('Earnings coverage PATCH error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
