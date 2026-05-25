import { fetchHqRecords } from '@/lib/hqAirtable'
import { quoteAirtableString } from '@/lib/airtableFormula'

const HQ_CREATORS = 'tblYhkNvrNuOAHfgw'

// Validate an onboarding token against HQ Creators. Returns the same shape
// as /api/onboarding/validate-token so callers — the API route and any
// server-rendered onboarding pages — share one implementation.
export async function validateOnboardingToken(token) {
  if (!token) {
    return { valid: false, error: 'No token provided' }
  }

  try {
    const records = await fetchHqRecords(HQ_CREATORS, {
      filterByFormula: `{Onboarding Token} = ${quoteAirtableString(token)}`,
      maxRecords: 1,
      fields: ['Creator', 'Communication Email', 'Onboarding Status'],
    })

    if (records.length === 0) {
      return { valid: false, error: 'Invalid or expired token' }
    }

    const rec = records[0]
    return {
      valid: true,
      name: rec.fields['Creator'] || '',
      email: rec.fields['Communication Email'] || '',
      hqId: rec.id,
      status: rec.fields['Onboarding Status'] || '',
    }
  } catch (err) {
    console.error('[validateOnboardingToken] Error:', err.message)
    return { valid: false, error: 'Server error' }
  }
}
